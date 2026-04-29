import { Hono } from "hono";
import { projectOutlines, editingPlans, mediaFiles, projectAssets, assetChunks, projects } from "@clipmind/db";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages, UIMessage, stepCountIs, hasToolCall } from "ai";
import { z } from "zod";
import { inArray, eq, and } from "drizzle-orm";
import { db } from "../db";
import { generateEmbeddings } from "../utils/embeddings";
import { searchVectors } from "../utils/qdrant";
import { MATERIAL_MODE_PROMPT_CONTEXT, IDEA_MODE_PROMPT_CONTEXT, FREECHAT_PROMPT_CONTEXT } from "../utils/workflow-copy";
import { serverConfig } from "../env";
import { googleSearch } from "../utils/searchapi";
import { scrapeWebpage } from "../utils/firecrawl";
import { requireAuth } from "../middleware/auth";

const app = new Hono();

app.use('*', requireAuth);

app.post("/", async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { messages, projectId, currentOutline, isDirty } = body as { messages: UIMessage[]; projectId: string; currentOutline?: string; isDirty?: boolean; };

  // [Arch] SSOT: 在请求起点先行获取项目实体（owner-scoped），作为后续 Prompt 注入与写链路的单一真理源
  const [currProject] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!currProject) return c.json({ error: "Project not found" }, 404);

  // 动态注入上下文，解决防冲撞与幻觉覆盖问题
  let dynamicSystemPrompt = SYSTEM_PROMPT;
  const isFreeChat = currProject.workflowMode === 'freechat';

  // 注入工作流模式上下文，引导 AI 针对当前创作模式给出合适的响应
  if (currProject.workflowMode === 'material') {
    dynamicSystemPrompt += `\n\n**【工作流上下文】**: ${MATERIAL_MODE_PROMPT_CONTEXT}\n\n`;
  } else if (currProject.workflowMode === 'idea') {
    dynamicSystemPrompt += `\n\n**【工作流上下文】**: ${IDEA_MODE_PROMPT_CONTEXT}\n\n`;
  } else if (isFreeChat) {
    dynamicSystemPrompt += `\n\n**【工作流上下文】**: ${FREECHAT_PROMPT_CONTEXT}\n\n`;
  }

  if (!isFreeChat) {
    dynamicSystemPrompt += `\n\n你现在是资深短视频编导。当用户要求基于素材生成剪辑方案时，你必须先调用 \`searchFootage\` 检索素材，然后根据检索到的内容，调用 \`generateEditingPlan\` 工具输出并保存结构化的剪辑方案。禁止在对话中输出大段方案文本。\n\n`;
  }

  if (serverConfig.SEARCHAPI_KEY) {
    dynamicSystemPrompt += `**【网络检索能力】**: 你拥有 \`search_web\` 工具，可实时搜索最新信息。`;
    if (serverConfig.FIRECRAWL_API_KEY) {
      dynamicSystemPrompt += `结合 \`fetch_webpage\` 可获取完整的网页正文。`;
    }
    dynamicSystemPrompt += `当用户询问当下热点、事实核查、实时资讯等需要互联网知识的问题时，你必须主动调用这些工具，而非依赖训练数据。\n\n`;
  }

  // [Arch] 意图收敛军规 (Prevent Tool-Calling Race Conditions) — 只在结构化工作流中生效
  if (!isFreeChat) {
  dynamicSystemPrompt += `\n\n**核心军规 (意图收敛与频道隔离)**:\n`;
  dynamicSystemPrompt += `为了保证 UI 焦点的稳定性，你绝对禁止在同一次思考/步骤中并发调用跨频道的工具。你必须严格遵守以下频道隔离规则：\n`;
  dynamicSystemPrompt += `- 【频道 A: 策划】: 仅包含 \`updateOutline\`。若涉及大纲修改，禁止同时搜索素材。\n`;
  dynamicSystemPrompt += `- 【频道 B: 素材】: 仅包含 \`search_assets\`。若涉及素材检索，禁止同时修改大纲。\n`;
  dynamicSystemPrompt += `- 【频道 C: 剪辑】: 仅包含 \`generateEditingPlan\`。\n`;
  dynamicSystemPrompt += `- 【精挑（人工操作）】: 精挑是纯人工操作，**AI 不得替用户执行精挑**。当用户对某个素材满意、或询问如何精挑时，你应明确告知：请在右侧素材面板中点击素材上的"精挑"按钮进行手动精挑。你的职责是推荐与描述，最终的精挑决策权归用户。\n`;
  dynamicSystemPrompt += `- 【隐式工具】: \`search_clips\` 是底层微观切片检索工具。它不会触发 UI 面板跳转，属于静默工具。你【必须且只能】在【精细检索素材内容】或【生成剪辑方案排期】时使用它。严禁在常规对话阶段滥用此工具。\n\n`;
  dynamicSystemPrompt += `**【大纲生成规范】**: 当用户要求生成大纲时，若系统提示中已注入了 Selected Assets 的内容摘要，你必须直接基于已提供的摘要进行创作，立即调用 \`updateOutline\` 工具，绝对禁止以"先了解内容"为由推迟或跳过工具调用。此规范仅适用于大纲生成，不影响剪辑方案生成。\n\n`;
  dynamicSystemPrompt += `**【剪辑方案强制流程】**: 生成剪辑方案时，无论是否已有摘要，必须先调用 \`search_clips\` 获取精确的台词切片，再把切片的 id 传入 \`generateEditingPlan\` 的 clipId 字段。禁止跳过 \`search_clips\` 直接生成方案。\n\n`;
  dynamicSystemPrompt += `**【素材缺失/相关性不足保护规则】**: 当用户要求基于素材生成剪辑方案时，必须严格执行以下检查：\n`;
  dynamicSystemPrompt += `  - 若 \`search_clips\` 返回结果为空，立即停止，告知用户缺少相关切片，等待用户明确指示后才能继续；\n`;
  dynamicSystemPrompt += `  - 若搜索到的切片与目标主题明显无关（如用户要生成"火星探索"方案但切片内容全是"美食"），同样必须停止，向用户说明当前素材库中找不到相关内容，询问用户是否仍要继续（可使用 broll 占位）或上传相关素材；\n`;
  dynamicSystemPrompt += `  - 严禁在没有匹配切片的情况下凭空生成剪辑方案，也严禁将不相关切片强行套入方案。\n\n`;
  dynamicSystemPrompt += `**【切片内容严禁篡改军规】**: 使用 clipId 引用某个切片时，该切片原有的台词/画面/内容是客观事实，你绝对不能通过修改 \`text\` 字段来"改写"或"替换"切片本身讲的内容。\n`;
  dynamicSystemPrompt += `  - \`text\` 字段只用于填写该片段在成片中叠加的字幕文案或旁白，不得与切片实际内容矛盾；\n`;
  dynamicSystemPrompt += `  - 切片的实际内容（原始台词、原始主题）不可被篡改、不可被掩盖、不可被"重新诠释"为与原内容无关的主题；\n`;
  dynamicSystemPrompt += `  - 若没有合适的切片，该片段应省略 clipId 标记为待补录（broll），而不是强行使用不相关的切片并修改文案来凑数。\n\n`;
  dynamicSystemPrompt += `**操作要求**: 如果用户的指令包含多个频道（如“搜一下关于猫的素材并帮我改一下大纲”），你必须分两步走：第一回合仅执行其中一个频道的工具，在回复中告知用户已完成该步骤，并询问是否继续执行下一步。禁止在单次响应中同时触发两个面板的更新。\n\n`;
  // 【剪辑方案格式要求】注入
  dynamicSystemPrompt += `\n\n**【剪辑方案格式要求】**\n`;
  dynamicSystemPrompt += `1. 每个 clip 只需要你提供两个创作字段：\n`;
  dynamicSystemPrompt += `   - text：该片段在成片中呈现的台词 / 旁白 / 字幕文案\n`;
  dynamicSystemPrompt += `   - description：剪辑意图，必须写明镜头、画面、节奏、转场等具有直接指导价值的信息，不要笼统概述\n`;
  dynamicSystemPrompt += `2. 若要使用某段源素材，把 search_clips 返回结果中对应切片的 id 字段原样填到 clipId。后端会据此自动补全 assetId、startTime、endTime 及片段类型，你【不需要也禁止】重复输出这些字段。\n`;
  dynamicSystemPrompt += `3. 对于不依赖具体源素材的片段（空镜、纯旁白、转场、待补录镜头），省略 clipId 即可，后端会自动识别为 broll。\n`;
  dynamicSystemPrompt += `4. 禁止自造 clipId —— clipId 必须来自 search_clips 的返回结果。\n\n`;
  } // end of !isFreeChat structured-prompt block

                // [Arch] 将资产聚合状态注入 Agent 记忆，作为剪辑方案生成的 SSOT 依赖
                const retrievedIds = (currProject.retrievedAssetIds as string[]) || [];
                const selectedIds = (currProject.selectedAssetIds as string[]) || [];
                const allInvolvedIds = Array.from(new Set([...retrievedIds, ...selectedIds]));

                if (allInvolvedIds.length > 0) {
                  // IDs are project_assets.id — join media_files for summary
                  const involvedAssets = await db.select({
                    id: projectAssets.id,
                    filename: projectAssets.filename,
                    summary: mediaFiles.summary,
                  }).from(projectAssets)
                    .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
                    .where(and(inArray(projectAssets.id, allInvolvedIds), eq(projectAssets.userId, user.id)));

                  if (retrievedIds.length > 0) {
                    const retrievedNames = involvedAssets.filter(a => retrievedIds.includes(a.id)).map(a => `【${a.filename}】(内容: ${a.summary || '暂无摘要'})`);
                    dynamicSystemPrompt += `\n- **Retrieved Assets (Spotlight)**: AI has focused on these assets: ${retrievedNames.join('; ')}.\n`;
                  }

                  if (selectedIds.length > 0) {
                    const selectedNames = involvedAssets.filter(a => selectedIds.includes(a.id)).map(a => `- 【${a.filename}】| 内容摘要: ${a.summary || '暂无摘要'}`);
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
  // 同时支持 UIMessage parts 形状（含 HITL widget 的 tool-* 部件）：抽取 text 部分送模型，
  // tool-* widget 部件对模型不可见（无副作用，不需要回灌历史）。
  const coreHistory = rawHistory.map((msg: any) => {
    if (msg.role === 'tool') return msg;
    let content: any = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.some((c: any) => c.type === 'tool-call')
        ? msg.content
        : msg.content.map((c: any) => c.text || '').join('\n');
    } else if (Array.isArray(msg.parts)) {
      // UIMessage parts → 抽取所有 text 部件拼接；tool-* widget 部件不送模型。
      content = msg.parts
        .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
        .map((p: any) => p.text)
        .join('\n');
    }
    return { role: msg.role, content };
  });

  const lastUserMsg = messages[messages.length - 1];
  // 核心大修：绝对禁止手动拼接 { content: lastUserMsg.content }！
  // AI SDK v6 的前端 UIMessage 中 content 可能为空，真实文本在 parts 数组中。
  // 必须调用官方 convertToModelMessages 将其安全提取提纯为 CoreMessage。
  const userCoreMessages = await convertToModelMessages([lastUserMsg]);

  // [Arch] 防重复: 热点播种场景下，coreHistory 末尾已是 user 消息（DB 已存该种子）。
  // regenerate() 会把同一条 user 消息再次发给后端，若直接追加会造成 [seed, seed] 重复。
  // 当 coreHistory 末尾已是 user 消息时，前端只是触发 AI 回复而非新增消息，跳过追加。
  const lastHistoryMsg = coreHistory[coreHistory.length - 1];
  const isUserAlreadyLast = lastHistoryMsg?.role === 'user';
  const safeMessages = isUserAlreadyLast
    ? [...coreHistory]
    : [...coreHistory, ...userCoreMessages];

  const MAX_STEPS = 20;

  // 核心修复 2：针对大模型提前结束生命周期导致文本为空的问题，注入强制结语指令
  const finalSystemPrompt = dynamicSystemPrompt + `\n\n【系统高优先级指令】：在执行完任何工具（Tool）后，你绝对不能静默结束对话。你必须在收到工具结果后，追加一段面向用户的自然语言（Text）说明，告知用户工具的执行结果或下一步建议！`;
  const stopConditions = isFreeChat
    ? [stepCountIs(MAX_STEPS)]
    : [stepCountIs(MAX_STEPS), hasToolCall('generateEditingPlan')];
  const result = streamText({
    model, system: finalSystemPrompt, messages: safeMessages,
    maxRetries: 3,
    stopWhen: stopConditions,

    // 硬约束：利用 prepareStep 在执行流中动态拦截，防止 Agent 哑火
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === MAX_STEPS - 1) {
        return {
          toolChoice: 'none',
          system: finalSystemPrompt + '\n\n【系统高优先级警告】：这是你本次响应的最后一步。当前所有工具已被禁用。你必须立刻根据上文的所有对话历史和已获取的工具结果，输出一段面向用户的最终纯文本总结。严禁直接终止对话。',
        };
      }
      return {};
    },

    tools: {
      ...(isFreeChat ? {} : {
      generateEditingPlan: tool({
        description: "基于素材检索结果，生成结构化的剪辑方案（Editing Plan）并持久化到数据库。禁止在对话中输出大段方案，必须调用此工具。",
        inputSchema: z.object({
          title: z.string().describe("剪辑方案的标题"),
          platform: z.string().describe("目标发布平台（如抖音、B站、小红书等）"),
          targetDuration: z.number().describe("目标视频时长（秒）"),
          clips: z.array(z.object({
            text: z.string().describe("该片段在成片中呈现的台词 / 旁白 / 字幕文案"),
            description: z.string().describe("剪辑意图，写明镜头、画面、节奏、转场等具有直接指导价值的信息"),
            clipId: z.string().optional().describe("源素材切片的 id，必须从 search_clips 返回结果的 clips[i].id 原样复制；若为空镜/转场/纯旁白等不依赖源素材的片段则省略")
          })).describe("选用的片段列表。只需提供 text/description，以及可选的 clipId 指向源切片；其它字段（assetId、startTime、endTime、clipType）由后端自动补全")
        }).strict(),
        execute: async (args) => {
          try {
            if (!args || !args.title || !args.clips || !Array.isArray(args.clips)) {
              console.warn("⚠️ [AI WARN] generateEditingPlan 拦截到空传参，已触发重试");
              return { success: false, error: "Missing required parameters. 'title' and 'clips' are mandatory." };
            }

            // 后端补全：只收 text/description/clipId，其它字段由此处从 assetChunks 查表反查
            // 防越权：通过 INNER JOIN assets + userId 过滤，确保只能引用当前用户拥有的素材切片
            const clipIds = Array.from(new Set(
              args.clips.map((c: any) => c.clipId).filter((id: any) => typeof id === 'string' && id.length > 0)
            ));
            // Join projectAssets to get project_assets.id (the assetId stored in editing plan clips)
            const chunks = clipIds.length > 0
              ? await db.select({
                  id: assetChunks.id,
                  mediaFileId: assetChunks.mediaFileId,
                  projectAssetId: projectAssets.id,
                  startTime: assetChunks.startTime,
                  endTime: assetChunks.endTime,
                })
                .from(assetChunks)
                .innerJoin(mediaFiles, eq(mediaFiles.id, assetChunks.mediaFileId))
                .innerJoin(projectAssets, and(
                  eq(projectAssets.mediaFileId, assetChunks.mediaFileId),
                  eq(projectAssets.projectId, projectId)
                ))
                .where(and(inArray(assetChunks.id, clipIds), eq(mediaFiles.userId, user.id)))
              : [];
            const chunkMap = new Map(chunks.map(c => [c.id, c]));

            const missing = clipIds.filter(id => !chunkMap.has(id));
            if (missing.length > 0) {
              console.warn(`⚠️ [generateEditingPlan] 无效 clipId: ${missing.join(', ')}`);
              return {
                success: false,
                error: `clipId 不存在: ${missing.join(', ')}。请先调用 search_clips 获取有效切片 id，再以原样传入 clipId。`
              };
            }

            const enrichedClips = args.clips.map((clip: any) => {
              if (clip.clipId) {
                const chunk = chunkMap.get(clip.clipId)!;
                return {
                  text: clip.text,
                  description: clip.description,
                  clipType: 'footage' as const,
                  clipId: chunk.id,
                  assetId: chunk.projectAssetId, // project_assets.id for JIT enrichment in projects.ts
                  startTime: chunk.startTime,
                  endTime: chunk.endTime,
                };
              }
              return {
                text: clip.text,
                description: clip.description,
                clipType: 'broll' as const,
              };
            });

            const insertPayload = {
              id: crypto.randomUUID(),
              projectId: projectId,
              title: args.title,
              platform: args.platform,
              targetDuration: args.targetDuration,
              clips: enrichedClips
            };
            await db.insert(editingPlans).values(insertPayload);

            return { success: true, message: '剪辑方案已成功生成并保存至数据库' };
          } catch (dbError) {
            console.error("❌ generateEditingPlan 数据库写入失败:", dbError);
            return { success: false, error: "Database error during editing plan insertion" };
          }
        }
      }),
      updateOutline: tool({
        description: "生成、覆盖或修改当前的视频 Markdown 大纲。注意：你必须提供 contentMd 参数。大纲格式规范：使用 `##` 作为主章节、`###` 作为子章节，禁止使用 `#`（项目标题已在 UI 层单独展示）。",
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
      }),
      // [HITL Widget] 无副作用工具：仅向前端发出"请展示素材选择/上传 UI"的请求。
      // 在所有模式（含 freechat）开放——是用户进入素材工作流的入口。
      request_asset_import: tool({
        description: "当用户表达【需要导入/上传/挑选/查看自己的素材库】意图时调用。例如：用户说\"我想用我之前拍的视频\"、\"怎么上传素材\"、\"看看我的素材库里都有什么\"，或在素材驱动工作流里尚未指明素材线索时。调用后，前端会在你这条消息下方渲染一个【素材库轮播 + 上传按钮】卡片，让用户直接挑选或上传。**注意**：此工具只是发出 UI 请求，不做任何数据写入；调用后请用一句简短的中文文本提示用户在下方卡片中操作。",
        inputSchema: z.object({
          reason: z.enum(['workflow-init', 'user-intent', 'no-assets-found']).describe('触发原因：workflow-init=工作流启动、user-intent=用户主动表达、no-assets-found=检索为空建议补素材'),
        }).strict(),
        execute: async ({ reason }) => {
          return { ok: true, reason };
        },
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

            const rawAssets = results.map((r: any) => ({
              score: r.score,
              assetId: r.payload.assetId,
              summary: r.payload.text
            }));

            // Qdrant returns mediaFileId in payload.assetId — translate to project_assets.id
            const rawMediaFileIds = rawAssets.map(a => a.assetId);
            const ownedPAs = rawMediaFileIds.length > 0
              ? await db.select({
                  id: projectAssets.id,
                  mediaFileId: projectAssets.mediaFileId,
                  filename: projectAssets.filename,
                }).from(projectAssets)
                  .where(and(
                    inArray(projectAssets.mediaFileId, rawMediaFileIds),
                    eq(projectAssets.projectId, projectId),
                    eq(projectAssets.userId, user.id)
                  ))
              : [];
            const existingIdSet = new Set(ownedPAs.map(a => a.mediaFileId));
            const mediaFileToPAId = new Map(ownedPAs.map(a => [a.mediaFileId, a.id]));
            const filenameMap = new Map(ownedPAs.map(a => [a.mediaFileId, a.filename]));
            const assetsFound = rawAssets
              .filter(a => existingIdSet.has(a.assetId))
              .map(a => ({
                ...a,
                assetId: mediaFileToPAId.get(a.assetId) ?? a.assetId, // return project_assets.id
                filename: filenameMap.get(a.assetId) ?? '',
              }));

            const hitAssetIds = assetsFound.map(a => a.assetId); // project_assets.id values
            await db.update(projects).set({ retrievedAssetIds: hitAssetIds }).where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));

            console.log(`[RAG-Macro] 命中 ${assetsFound.length} 个视频资产（已过滤 ${rawAssets.length - assetsFound.length} 个幽灵向量）并已持久化至 Project。`);
            return { success: true, assets: assetsFound };
          } catch (error: any) {
            console.error("❌ search_assets 宏观检索失败:", error);
            return { success: false, error: error.message };
          }
        }
      }),

      ...(serverConfig.SEARCHAPI_KEY ? {
        search_web: tool({
          description: "Search the web for up-to-date information on any topic. Use when the user asks about current events, trends, facts, or anything that requires real-world knowledge beyond your training data.",
          inputSchema: z.object({
            query: z.string().describe('The search query'),
          }),
          execute: async ({ query }) => {
            try {
              console.log(`[WebSearch] Searching: "${query}"`);
              const results = await googleSearch(query);
              return results
                .map(r => `<result>\n<title>${r.title}</title>\n<url>${r.link}</url>\n<snippet>${r.snippet}</snippet>\n</result>`)
                .join('\n');
            } catch (error: any) {
              console.error('❌ search_web failed:', error);
              return { success: false, error: error.message };
            }
          },
        }),
      } : {}),

      ...(serverConfig.FIRECRAWL_API_KEY ? {
        fetch_webpage: tool({
          description: "Fetch and read the full content of one or more web pages. Use after search_web when you need the complete article or page content, not just the snippet.",
          inputSchema: z.object({
            url: z.union([z.string(), z.array(z.string())]).describe('A URL or list of URLs to fetch'),
          }),
          execute: async ({ url }) => {
            const urls = Array.isArray(url) ? url : [url];
            const parts = await Promise.all(
              urls.map(async (u) => {
                console.log(`[WebFetch] Reading ${u}`);
                const content = await scrapeWebpage(u);
                return `<webpage><url>${u}</url><content>${content ?? 'Failed to fetch content'}</content></webpage>`;
              }),
            );
            return parts.join('\n\n');
          },
        }),
      } : {}),

      search_clips: tool({
        description: "【微观检索】在指定的视频资产（assetIds）范围内，深入检索符合条件的台词/画面切片。用于支撑剪辑方案(Editing Plan)的精确排期。注意：必须传入 assetIds 数组进行定向狙击。",
        inputSchema: z.object({
          query: z.string().describe('具体的台词或微观动作意图'),
          assetIds: z.array(z.string()).describe('目标视频的 ID 数组 (可从用户已精挑的素材或 search_assets 返回的结果中获取)'),
          limit: z.number().min(1).max(20).optional().default(10)
        }),
        execute: async ({ query, assetIds, limit }) => {
          try {
            if (!assetIds || assetIds.length === 0) {
              return { success: false, error: "必须提供 assetIds 才能进行精搜。请提示用户先挑素材，或先调用 search_assets 圈定范围。" };
            }

            console.log(`[RAG-Micro] LLM 在指定视频中精搜切片: "${query}", assetIds: ${assetIds.length}`);

            // assetIds are project_assets.id — translate to mediaFileId for Qdrant filter
            const ownedRows = await db
              .select({ id: projectAssets.id, mediaFileId: projectAssets.mediaFileId, filename: projectAssets.filename })
              .from(projectAssets)
              .where(and(
                inArray(projectAssets.id, assetIds),
                eq(projectAssets.projectId, projectId),
                eq(projectAssets.userId, user.id)
              ));
            if (ownedRows.length === 0) {
              return { success: true, clips: [] };
            }
            const mediaFileIds = ownedRows.map(r => r.mediaFileId);
            // Reverse map: mediaFileId → project_assets.id (for response) and filename
            const mediaIdToPAId = new Map(ownedRows.map(r => [r.mediaFileId, r.id]));
            const mediaIdToFilename = new Map(ownedRows.map(r => [r.mediaFileId, r.filename]));

            const [vector] = await generateEmbeddings([query]);

            const { searchVectorsWithFilter } = await import("../utils/qdrant");
            const qdrantResults = await searchVectorsWithFilter(vector, mediaFileIds, limit);

            const clips = qdrantResults.map((p: any) => {
              const mfId = p.payload?.assetId; // mediaFileId in Qdrant payload
              return {
                id: p.id,
                score: p.score,
                assetId: mediaIdToPAId.get(mfId) ?? mfId, // expose project_assets.id to LLM
                filename: mediaIdToFilename.get(mfId) ?? '',
                text: p.payload?.text,
                startTime: p.payload?.startTime,
                endTime: p.payload?.endTime,
              };
            });

            console.log(`[RAG-Micro] 精搜命中 ${clips.length} 个特定切片。`);
            return {
              success: true,
              clips,
              reminder: "⚠️ 调用 generateEditingPlan 时，要使用某切片就把它的 id 字段原样填到对应 clip 的 clipId；其余字段（assetId、startTime、endTime）由后端自动补全，无需你重复传递。",
            };
          } catch (error: any) {
            console.error("❌ search_clips 微观检索失败:", error);
            return { success: false, error: error.message };
          }
        }
      })
    },
    onStepFinish: async ({ toolResults }) => {
      if (toolResults?.length) {
        console.log(`[Step] tools:`, toolResults.map(t => t.toolName).join(', '));
      }
    },
    onFinish: async ({ response }) => {
      try {
        // [Arch] 持久化原则：保留 rawHistory 的原始形状（含 UIMessage parts，例如 HITL widget 的
        // tool-* 部件），不要使用 coreHistory（那是为送模型而做的清洗版本，会丢失 parts）。
        // 否则首轮对话后，seed 消息中的 widget 部件就会从 DB 中消失。
        const updatedMessages = isUserAlreadyLast
          ? [...rawHistory, ...response.messages]
          : [...rawHistory, ...userCoreMessages, ...response.messages];
        await db.update(projects)
          .set({ uiMessages: updatedMessages })
          .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
        console.log(`[Chat] ✅ 对话持久化成功，当前总消息数: ${updatedMessages.length}`);
      } catch (error) {
        console.error(`❌ [Chat] 对话持久化失败:`, error);
      }
    }
  });


  return result.toUIMessageStreamResponse();

});

export default app;
