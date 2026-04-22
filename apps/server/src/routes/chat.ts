import { Hono } from "hono";
import { projectOutlines, editingPlans, assets, projects } from "@clipmind/db";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages, UIMessage, stepCountIs, SystemModelMessage, hasToolCall } from "ai";
import { z } from "zod";
import { inArray, eq } from "drizzle-orm";
import { db } from "../db";
import { generateEmbeddings } from "../utils/embeddings";
import { searchVectors } from "../utils/qdrant";
import { ossClient } from "../utils/oss";
import { globalHotTopicsCache } from "../utils/hot-topics";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { messages, projectId, currentOutline, isDirty } = body as { messages: UIMessage[]; projectId: string; currentOutline?: string; isDirty?: boolean; };

  // [Arch] SSOT: 在请求起点先行获取项目实体，作为后续 Prompt 注入与写链路的单一真理源
  const [currProject] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!currProject) return c.json({ error: "Project not found" }, 404);

  // 动态注入上下文，解决防冲撞与幻觉覆盖问题
  let dynamicSystemPrompt = SYSTEM_PROMPT;

  // 动态注入每日全网热点情报作为 RAG 上下文雏形
  dynamicSystemPrompt += `\n\n${globalHotTopicsCache}\n\n`;

  // 强制 AI 主动使用热点进行破冰与策划引导
  dynamicSystemPrompt += `**你的行动指南 (Hot Topics Guidance)**:\n`;
  dynamicSystemPrompt += `1. **破冰引导**: 当用户不知拍什么，或你们刚刚开始对话时，你必须主动从上述《今日全网热点风向标》中挑选 1-2 个最具短视频传播潜力的热点，向用户抛出话题建议。\n`;
  dynamicSystemPrompt += `2. **大纲结合**: 当用户要求策划内容时，尽可能结合当日热点的情绪价值或讨论度，帮助用户“蹭流量”。但在回 复中只需提一句“结合了今日的XX热点”，保持对话极简，绝不要大段复述 榜单。\n\n`;

  dynamicSystemPrompt += `\n\n你现在是资深短视频编导。当用户要求基于素材生成剪辑方案时，你必须先调用 \`searchFootage\` 检索素材，然后根据检索到的内容，调用 \`generateEditingPlan\` 工具输出并保存结构化的剪辑方案。禁止在对话中输出大段方案文本。\n\n`;

  // [Arch] 意图收敛军规 (Prevent Tool-Calling Race Conditions)
  dynamicSystemPrompt += `\n\n**核心军规 (意图收敛与频道隔离)**:\n`;
  dynamicSystemPrompt += `为了保证 UI 焦点的稳定性，你绝对禁止在同一次思考/步骤中并发调用跨频道的工具。你必须严格遵守以下频道隔离规则：\n`;
  dynamicSystemPrompt += `- 【频道 A: 策划】: 仅包含 \`generate_outline\`, \`updateOutline\`。若涉及大纲修改，禁止同时搜索素材。\n`;
  dynamicSystemPrompt += `- 【频道 B: 素材】: 仅包含 \`search_assets\`。若涉及素材检索，禁止同时修改大纲。\n`;
  dynamicSystemPrompt += `- 【频道 C: 剪辑】: 仅包含 \`generateEditingPlan\`。\n`;
  dynamicSystemPrompt += `- 【频道 B: 素材 (增补)】: 包含 \`manage_footage_basket\`，用于将素材移入或移出精选篮子。当你发现用户对某个素材表示满意时，应主动将其加入篮子。\n`;
  dynamicSystemPrompt += `- 【隐式工具】: \`search_clips\` 是底层微观切片检索工具。它不会触发 UI 面板跳转，属于静默工具。你【必须且只能】在【精细检索素材内容】或【生成剪辑方案排期】时使用它。严禁在常规对话或大纲策划阶段滥用此工具。\n\n`;
  dynamicSystemPrompt += `**操作要求**: 如果用户的指令包含多个频道（如“搜一下关于猫的素材并帮我改一下大纲”），你必须分两步走：第一回合仅执行其中一个频道的工具，在回复中告知用户已完成该步骤，并询问是否继续执行下一步。禁止在单次响应中同时触发两个面板的更新。\n\n`;

                // [Arch] 将资产聚合状态注入 Agent 记忆，作为剪辑方案生成的 SSOT 依赖
                const retrievedIds = (currProject.retrievedAssetIds as string[]) || [];
                const selectedIds = (currProject.selectedAssetIds as string[]) || [];
                const allInvolvedIds = Array.from(new Set([...retrievedIds, ...selectedIds]));

                if (allInvolvedIds.length > 0) {
                  // [Arch] 解决大模型“内容盲区”：拿 UUID 去 assets 表换取真实的文件名与内容摘要(summary)
                  const involvedAssets = await db.select({
                    id: assets.id,
                    filename: assets.filename,
                    summary: assets.summary
                  }).from(assets).where(inArray(assets.id, allInvolvedIds));

                  if (retrievedIds.length > 0) {
                    const retrievedNames = involvedAssets.filter(a => retrievedIds.includes(a.id)).map(a => `【${a.filename}】(内容: ${a.summary || '暂无摘要'})`);
                    dynamicSystemPrompt += `\n- **Retrieved Assets (Spotlight)**: AI has focused on these assets: ${retrievedNames.join('; ')}.\n`;
                  }

                  if (selectedIds.length > 0) {
                    const selectedNames = involvedAssets.filter(a => selectedIds.includes(a.id)).map(a => `- 【${a.filename}】(ID: ${a.id}) | 内容摘要: ${a.summary || '暂无摘要'}`);
                    dynamicSystemPrompt += `\n- **Selected Assets (User's Pick)**: The user has hand-picked these assets for the final edit:\n${selectedNames.join('\n')}\n`;
                    dynamicSystemPrompt += `> [系统强烈提示]：你必须明确知道用户已经选好了上述具体文件，并深度理解其【内容摘要】。当用户要求构思剧情、修改大纲或生成剪辑方案时，你必须基于这些摘要进行推理！\n`;
                  }
                }

  if (currentOutline) {
    dynamicSystemPrompt += `\n\n## Current Project State\n\n`;
    dynamicSystemPrompt += `The user has an existing outline on the canvas. `;
    if (isDirty) {
      dynamicSystemPrompt += `**CRITICAL: The user has manually edited this outline since you last saw it.** You MUST base any future modifications on this exact current content, not your previous memory of it.\n\n`;
    }
    dynamicSystemPrompt += `=== CURRENT OUTLINE CONTENT ===\n${currentOutline}\n===============================\n\n`;
    dynamicSystemPrompt += `When calling \`updateOutline\`, you must provide the FULL updated markdown content, combining the user's manual edits with your new additions.\n\n`;
    dynamicSystemPrompt += `**DON'T DO (聊天区霸屏)**: 严禁在普通的对话回复中直接倾泻数百字的大纲、长篇转录总结或复杂的结构化长文本。这会撑爆聊天气泡，破坏用户的沉浸式体验与视觉焦点。\n\n`;
    dynamicSystemPrompt += `**规范 (极简对话流)**: 在通过工具完成内容写入后，你在对话区的回复必须保持极致克制。仅需提供一句简短的状态通报即可（例如：“大纲已生成并推送到右侧画布，请审阅或修改。”），**绝对禁止**在聊天区重复复述已写入工作区的内容。\n\n`;
  }

  const model = createAIModel();

  // [Arch] 读写分离重构 (写链路)：抛弃前端传入的伪造历史，以数据库中的 CoreMessage 为单一真理源
  const rawHistory: any[] = (currProject.uiMessages as any[]) || [];

  // 清洗防线：确保从数据库读出的历史记录严格符合 CoreMessage，防止被早期脏数据污染
  const coreHistory = rawHistory.map((msg: any) => {
    if (msg.role === 'tool') return msg;
    return {
      role: msg.role,
      content: typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) ? (msg.content.some((c: any) => c.type === 'tool-call') ? msg.content : msg.content.map((c: any) => c.text || '').join('\n')) : '')
    };
  });

  const lastUserMsg = messages[messages.length - 1];
  // 核心大修：绝对禁止手动拼接 { content: lastUserMsg.content }！
  // AI SDK v6 的前端 UIMessage 中 content 可能为空，真实文本在 parts 数组中。
  // 必须调用官方 convertToModelMessages 将其安全提取提纯为 CoreMessage。
  const userCoreMessages = await convertToModelMessages([lastUserMsg]);

  const safeMessages = [...coreHistory, ...userCoreMessages];

  const MAX_STEPS = 20;

  // 核心修复 2：针对大模型提前结束生命周期导致文本为空的问题，注入强制结语指令
  const finalSystemPrompt = dynamicSystemPrompt + `\n\n【系统高优先级指令】：在执行完任何工具（Tool）后，你绝对不能静默结束对话。你必须在收到工具结果后，追加一段面向用户的自然语言（Text）说明，告知用户工具的执行结果或下一步建议！`;
  console.log('--- [Debug] Dynamic System Prompt ---');
  console.log(finalSystemPrompt);
  console.log('-------------------------------------');


  const result = streamText({
    model, system: finalSystemPrompt, messages: safeMessages,
    maxRetries: 3,
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('generateEditingPlan')],

    // 硬约束：利用 prepareStep 在执行流中动态拦截，防止 Agent 哑火
    prepareStep: async ({ stepNumber, messages }) => {
      // 场景判定：如果已经到了最后一步的边缘（stepNumber 从 0 开始计算）
      if (stepNumber === MAX_STEPS - 1) {
        const systemMsg = messages.find(msg => msg.role === `system`) as SystemModelMessage
        systemMsg.content +=
          '\r\n【系统高优先级警告】：这是你本次响应的最后一步。当前所有工具已被禁用。你必须立刻根据上文的所有对话历史和已获取的工具结果，输出一段面向用户的最终纯文本总结。严禁直接终止对话。'
        return {
          // 强制该步无法调用任何工具
          toolChoice: 'none',
          // 动态注入针对最后一步的强烈指令
          system: systemMsg
        };
      }
      return {};
    },

    tools: {
      generateEditingPlan: tool({
        description: "基于素材检索结果，生成结构化的剪辑方案（Editing Plan）并持久化到数据库。禁止在对话中输出大段方案，必须调用此工具。",
        inputSchema: z.object({
          title: z.string().describe("剪辑方案的标题"),
          platform: z.string().describe("目标发布平台（如抖音、B站、小红书等）"),
          targetDuration: z.number().describe("目标视频时长（秒）"),
          clips: z.array(z.object({
            startTime: z.number().describe("切片起始时间（毫秒）"),
            endTime: z.number().describe("切片结束时间（毫秒）"),
            text: z.string().describe("切片台词内容"),
            description: z.string().describe("编导对该切片的剪辑意图与画面描述")
          })).describe("选用的视频切片列表")
        }).strict(),
        execute: async (args) => {
          try {
            if (!args || !args.title || !args.clips || !Array.isArray(args.clips)) {
              console.warn("⚠️ [AI WARN] generateEditingPlan 拦截到空传参，已触发重试");
              return { success: false, error: "Missing required parameters. 'title' and 'clips' are mandatory." };
            }

            const insertPayload = {
              id: crypto.randomUUID(),
              projectId: projectId,
              title: args.title,
              platform: args.platform,
              targetDuration: args.targetDuration,
              clips: args.clips
            };
            console.log(`\n======================================`);
            console.log(`📍 [PROBE 1 - WRITE] 准备落盘 EditingPlan!`);
            console.log(`[Payload 预览]:`, JSON.stringify(insertPayload).slice(0, 150) + "...");

            await db.insert(editingPlans).values(insertPayload);
            console.log(`📍 [PROBE 1.5 - WRITE SUCCESS] 数据库写入无报错！`);
            console.log(`======================================\n`);

            return { success: true, message: '剪辑方案已成功生成并保存至数据库' };
          } catch (dbError) {
            console.error("❌ generateEditingPlan 数据库写入失败:", dbError);
            return { success: false, error: "Database error during editing plan insertion" };
          }
        }
      }),
      updateOutline: tool({
        description: "生成、覆盖或修改当前的视频 Markdown 大纲。注意：你必须提供 contentMd 参数。",
        inputSchema: z.object({ contentMd: z.string().describe('最新版本的完整 Markdown 内容') }).strict(),
        execute: async (args) => {
          try {
            // 防御与自愈 (Self-Healing)：拦截大模型幻觉导致的空传参
            // 借助 maxSteps: 5 机制，直接将错误信息返回给大模型，强制其在 Step 2 修正重试
            if (!args || typeof args.contentMd !== 'string' || args.contentMd.trim() === "") {
              console.warn("⚠️ [AI WARN] 拦截到空传参 {}，已驳回并触发 AI SDK 代理重试机制");
              return { success: false, error: "Missing required parameter 'contentMd'. You MUST provide the full markdown content as a string." };
            }
            const safeContent = args.contentMd;

            // 核心修复：直接使用外部 request.json() 解构出来的真实 projectId，禁止 LLM 瞎猜
            await db.insert(projectOutlines).values({
              id: crypto.randomUUID(),
              projectId: projectId,
              contentMd: safeContent
            }).onDuplicateKeyUpdate({
              set: { contentMd: safeContent }
            });
            return { success: true, message: '大纲已同步至工作区' };
          } catch (dbError) {
            console.error("❌ 数据库写入失败:", dbError);
            return { success: false, error: "Database error" };
          }
        }
      }),
      search_assets: tool({
        description: "【宏观检索】基于用户意图，在大盘视频库中进行鸟瞰式检索。返回的是视频素材的全局ID(assetId)和宏观总结(Summary)。当需要寻找特定主题或题材的视频时，必须优先调用此工具以防Token爆炸。",
        inputSchema: z.object({
          query: z.string().describe('搜索意图，例如：海滩风景、某人发表演讲'),
          limit: z.number().min(1).max(10).optional().default(5)
        }),
        execute: async ({ query, limit }) => {
          try {
            console.log(`[RAG-Macro] LLM 请求视频大盘检索: "${query}"`);
            const [vector] = await generateEmbeddings([query]);

            // 强制路由至 summary collection
            const { searchVectors, QDRANT_SUMMARY_COLLECTION } = await import("../utils/qdrant");
            const results = await searchVectors(vector, limit, QDRANT_SUMMARY_COLLECTION);

            const assetsFound = results.map((r: any) => ({
              score: r.score,
              assetId: r.payload.assetId,
              summary: r.payload.text
            }));

            // [Arch] 状态持久化：将宏观检索命中的资产ID写入聚合根，驱动前端聚光灯UI
            const hitAssetIds = assetsFound.map(a => a.assetId);
            await db.update(projects).set({ retrievedAssetIds: hitAssetIds }).where(eq(projects.id, projectId));

            console.log(`[RAG-Macro] 命中 ${assetsFound.length} 个视频资产并已持久化至 Project。`);
            return { success: true, assets: assetsFound };
          } catch (error: any) {
            console.error("❌ search_assets 宏观检索失败:", error);
            return { success: false, error: error.message };
          }
        }
      }),

      manage_footage_basket: tool({
        description: "【精挑素材】将指定的视频素材(assetIds)加入或移出精选篮子。精选篮子里的素材是后续生成剪辑方案的唯一合法来源。",
        inputSchema: z.object({
          action: z.enum(['add', 'remove']).describe('操作类型：add(加入篮子), remove(移出篮子)'),
          assetIds: z.array(z.string()).describe('素材 ID 数组')
        }),
        execute: async ({ action, assetIds }) => {
          try {
            const currentSelected = (currProject.selectedAssetIds as string[]) || [];
            let nextSelected = [...currentSelected];

            if (action === 'add') {
              nextSelected = Array.from(new Set([...nextSelected, ...assetIds]));
            } else {
              nextSelected = nextSelected.filter(id => !assetIds.includes(id));
            }

            await db.update(projects)
              .set({ selectedAssetIds: nextSelected, updatedAt: new Date() })
              .where(eq(projects.id, projectId));

            return { success: true, action, count: assetIds.length, totalInBasket: nextSelected.length };
          } catch (error: any) {
            console.error("❌ manage_footage_basket 失败:", error);
            return { success: false, error: error.message };
          }
        }
      }),

      search_clips: tool({
        description: "【微观检索】在指定的视频资产（assetIds）范围内，深入检索符合条件的台词/画面切片。用于支撑剪辑方案(Editing Plan)的精确排期。注意：必须传入 assetIds 数组进行定向狙击。",
        inputSchema: z.object({
          action: z.enum(['add', 'remove']).describe('操作类型：add(加入篮子), remove(移出篮子)'),
          assetIds: z.array(z.string()).describe('素材 ID 数组')
        }),
        execute: async ({ action, assetIds }) => {
          try {
            // 读取当前项目状态
            const existingProject = await db.select({ selectedAssetIds: projects.selectedAssetIds })
              .from(projects).where(eq(projects.id, projectId)).limit(1);
            const currentSelected = existingProject[0]?.selectedAssetIds as string[] || [];

            let nextSelected = [...currentSelected];
            if (action === 'add') {
              nextSelected = Array.from(new Set([...nextSelected, ...assetIds]));
            } else {
              nextSelected = nextSelected.filter(id => !assetIds.includes(id));
            }

            // 落盘
            await db.update(projects)
              .set({ selectedAssetIds: nextSelected })
              .where(eq(projects.id, projectId));

            return { success: true, action, count: assetIds.length, totalInBasket: nextSelected.length };
          } catch (error: any) {
            console.error("❌ manage_footage_basket 失败:", error);
            return { success: false, error: error.message };
          }
        }
      }),

      search_clips: tool({
        description: "【微观检索】在指定的视频资产（assetIds）范围内，深入检索符合条件的台词/画面切片。用于支撑剪辑方案(Editing Plan)的精确排期。注意：必须传入 assetIds 数组进行定向狙击。",
        inputSchema: z.object({
          query: z.string().describe('具体的台词或微观动作意图'),
          assetIds: z.array(z.string()).describe('目标视频的 ID 数组 (可从选材篮子或 search_assets 中获取)'),
          limit: z.number().min(1).max(20).optional().default(10)
        }),
        execute: async ({ query, assetIds, limit }) => {
          try {
            if (!assetIds || assetIds.length === 0) {
              return { success: false, error: "必须提供 assetIds 才能进行精搜。请提示用户先挑素材，或先调用 search_assets 圈定范围。" };
            }

            console.log(`[RAG-Micro] LLM 在指定视频中精搜切片: "${query}", assetIds: ${assetIds.length}`);
            const [vector] = await generateEmbeddings([query]);

            const { searchVectorsWithFilter } = await import("../utils/qdrant");
            const qdrantResults = await searchVectorsWithFilter(vector, assetIds, limit);

            const clips = qdrantResults.map((p: any) => ({
              score: p.score,
              assetId: p.payload?.assetId,
              text: p.payload?.text,
              startTime: p.payload?.startTime,
              endTime: p.payload?.endTime,
            }));

            console.log(`[RAG-Micro] 精搜命中 ${clips.length} 个特定切片。`);
            return { success: true, clips };
          } catch (error: any) {
            console.error("❌ search_clips 微观检索失败:", error);
            return { success: false, error: error.message };
          }
        }
      })
    },
    onFinish: async ({ response }) => {
      try {
        console.log(`[Chat] streamText 结束，开始持久化对话到 Project: ${projectId}`);

        // 获取当前数据库中已有的历史消息
        const existingProject = await db.select({
          uiMessages: projects.uiMessages
        }).from(projects).where(eq(projects.id, projectId)).limit(1);

        if (existingProject.length === 0) {
          console.warn(`⚠️ [Chat] 未找到对应项目 ${projectId}，放弃持久化。`);
          return;
        }

        let existingMessages: UIMessage[] = [];
        if (existingProject[0].uiMessages && Array.isArray(existingProject[0].uiMessages)) {
          existingMessages = existingProject[0].uiMessages as UIMessage[];
        }

        // [Arch] 读写分离重构 (写链路)：100% 底层数据无损落盘。
        // 写入经过安全清洗的 coreHistory，结合官方规范解析的 userCoreMessages
        const updatedMessages = [...coreHistory, ...userCoreMessages, ...response.messages];

        await db.update(projects)
          .set({ uiMessages: updatedMessages })
          .where(eq(projects.id, projectId));

        console.log(`[Chat] ✅ 对话持久化成功，当前总消息数: ${updatedMessages.length}`);
      } catch (error) {
        console.error(`❌ [Chat] 对话持久化失败:`, error);
      }
    }
  });


  return result.toUIMessageStreamResponse();

});

export default app;
