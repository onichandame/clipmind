import { Hono } from "hono";
import { projectOutlines } from "@clipmind/db";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages, UIMessage, stepCountIs, SystemModelMessage } from "ai";
import { z } from "zod";
import { db } from "../db";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { messages, projectId, currentOutline, isDirty } = body as { messages: UIMessage[]; projectId: string; currentOutline?: string; isDirty?: boolean; };

  // 动态注入上下文，解决防冲撞与幻觉覆盖问题
  let dynamicSystemPrompt = SYSTEM_PROMPT;
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

  const safeMessages = await convertToModelMessages(messages);
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
        description: "Search footage",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ }) => { return { clips: [], total: 0, message: "Mock" }; }
      }),
    },
  });


  return result.toUIMessageStreamResponse();

});

export default app;
