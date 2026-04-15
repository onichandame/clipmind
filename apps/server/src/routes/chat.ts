import { Hono } from "hono";
import { projectOutlines, editingPlans, assets, projects } from "@clipmind/db";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages, UIMessage, stepCountIs, SystemModelMessage } from "ai";
import { z } from "zod";
import { inArray, eq } from "drizzle-orm";
import { db } from "../db";
import { generateEmbeddings } from "../utils/embeddings";
import { searchVectors } from "../utils/qdrant";
import { ossClient } from "../utils/oss";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { messages, projectId, currentOutline, isDirty } = body as { messages: UIMessage[]; projectId: string; currentOutline?: string; isDirty?: boolean; };

  // 动态注入上下文，解决防冲撞与幻觉覆盖问题
  let dynamicSystemPrompt = SYSTEM_PROMPT;

  dynamicSystemPrompt += `\n\n你现在是资深短视频编导。当用户要求基于素材生成剪辑方案时，你必须先调用 \`searchFootage\` 检索素材，然后根据检索到的内容，调用 \`generateEditingPlan\` 工具输出并保存结构化的剪辑方案。禁止在对话中输出大段方案文本。\n\n`;

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
  const existingProject = await db.select({ uiMessages: projects.uiMessages }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const coreHistory: any[] = (existingProject[0]?.uiMessages as any[]) || [];

  const lastUserMsg = messages[messages.length - 1];
  const safeMessages = [...coreHistory, { role: 'user', content: lastUserMsg.content }];

  const MAX_STEPS = 5;

  // 核心修复 2：针对大模型提前结束生命周期导致文本为空的问题，注入强制结语指令
  const finalSystemPrompt = dynamicSystemPrompt + `\n\n【系统高优先级指令】：在执行完任何工具（Tool）后，你绝对不能静默结束对话。你必须在收到工具结果后，追加一段面向用户的自然语言（Text）说明，告知用户工具的执行结果或下一步建议！`;


  const result = streamText({
    model, system: finalSystemPrompt, messages: safeMessages,
    maxRetries: 3,
    stopWhen: stepCountIs(MAX_STEPS),

    // 硬约束：利用 prepareStep 在执行流中动态拦截，防止 Agent 哑火
    prepareStep: async ({ stepNumber, messages }) => {
      // 场景判定：如果已经到了最后一步的边缘（stepNumber 从 0 开始计算）
      if (stepNumber === MAX_STEPS - 1) {
        const systemMsg = messages.find(msg => msg.role = `system`) as SystemModelMessage
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
            await db.insert(editingPlans).values({
              id: crypto.randomUUID(),
              projectId: projectId,
              title: args.title,
              platform: args.platform,
              targetDuration: args.targetDuration,
              clips: args.clips
            });
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
      searchFootage: tool({
        description: "根据用户查询的文本意图，在全局视频素材库（Qdrant）中进行向量语义检索，寻找最匹配的视频文本切片。当用户询问具体视频内容或需要补充素材时调用此工具。",
        inputSchema: z.object({
          query: z.string().describe('用于执行语义检索的查询关键词'),
          limit: z.number().min(1).max(20).optional().default(20).describe('期望返回的视频片段最大数量（上限20）')
        }),
        execute: async ({ query, limit }) => {
          try {
            console.log(`[RAG] LLM 触发向量检索: query="${query}", limit=${limit}`);
            const embeddings = await generateEmbeddings([query]);
            if (!embeddings || embeddings.length === 0) {
              return { success: false, error: "生成文本向量失败" };
            }

            // 全局搜索视频切片
            const qdrantResults = await searchVectors(embeddings[0], limit);

            // 过滤提取核心 payload，剥离高维向量数组，降低 LLM Context Token 消耗
            const baseClips = qdrantResults.map((p: any) => ({
              score: p.score,
              assetId: p.payload?.assetId,
              text: p.payload?.text,
              startTime: p.payload?.startTime,
              endTime: p.payload?.endTime,
            }));

            // 提取去重的 assetIds 防止 N+1 查询
            const assetIds = [...new Set(baseClips.map((c: any) => c.assetId).filter(Boolean))];
            const assetMap: Record<string, { filename: string, thumbnailUrl: string | null }> = {};

            if (assetIds.length > 0) {
              const dbAssets = await db.select({
                id: assets.id,
                filename: assets.filename,
                thumbnailUrl: assets.thumbnailUrl
              }).from(assets).where(inArray(assets.id, assetIds as string[]));

              for (const a of dbAssets) {
                let signedThumb = null;
                if (a.thumbnailUrl) {
                  // 动态签发 2 小时有效期的 HTTPS 链接
                  signedThumb = ossClient.signatureUrl(a.thumbnailUrl, { expires: 7200, secure: true });
                }
                assetMap[a.id] = { filename: a.filename || '未知素材', thumbnailUrl: signedThumb };
              }
            }

            // 缝合元数据与预签名 URL
            const clips = baseClips.map((c: any) => ({
              ...c,
              filename: c.assetId ? (assetMap[c.assetId]?.filename || '未知素材') : '未知素材',
              thumbnailUrl: c.assetId ? (assetMap[c.assetId]?.thumbnailUrl || null) : null
            }));

            console.log(`[RAG] 检索完成，召回 ${clips.length} 条相关切片`);
            return { success: true, clips, total: clips.length };
          } catch (error) {
            console.error("❌ RAG 检索失败:", error);
            return { success: false, error: "向量数据库检索异常" };
          }
        }
      }),
    },
    onFinish: async ({ response }) => {
      try {
        console.log(`[Chat] streamText 结束，开始持久化对话到 Project: ${projectId}`);
        // 获取用户的最后一条消息
        const lastUserMessage = messages[messages.length - 1];

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
        // 直接将原生 CoreMessage 追加，不进行任何转换！
        const updatedMessages = [...existingMessages, { role: 'user', content: lastUserMessage.content }, ...response.messages];

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
