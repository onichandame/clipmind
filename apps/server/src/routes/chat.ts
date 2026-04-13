import { Hono } from "hono";
import { db, projectOutlines, projectMessages } from "@clipmind/db";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages, UIMessage, isTextUIPart, stepCountIs, SystemModelMessage } from "ai";
import { z } from "zod";

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
    dynamicSystemPrompt += `When calling \`updateOutline\`, you must provide the FULL updated markdown content, combining the user's manual edits with your new additions.`;
  }

  // 1. 提问前置入库：拉开时间差，彻底解决对话排序倒置问题
  try {
    const lastUserMessage = [...messages].reverse().find(msg => msg.role === `user`);
    let userContent = lastUserMessage?.parts ?
      lastUserMessage.parts.filter(p => isTextUIPart(p)).map((p) => p.text).join("") : ``
    await db.insert(projectMessages).values({
      id: crypto.randomUUID(), projectId, role: "user", content: userContent,
    });
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }

  // 2. 启动流式响应
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

    // 提取完整的 event 对象以获取 toolResults，用于构建前端所需标准的 toolInvocations
    onFinish: async (event) => {
      try {
        const { text, toolCalls, toolResults } = event;
        let cleanContent = text || "";

        console.log("\n================ [🌊 STREAM FINISH EVENT] ================");
        console.log("-> 1. RAW text:", JSON.stringify(text));
        console.log("-> 2. RAW toolCalls:", JSON.stringify(toolCalls, null, 2));
        console.log("-> 3. RAW toolResults:", JSON.stringify(toolResults, null, 2));

        // 构建 Vercel AI SDK 兼容的 toolInvocations
        // 核心修复 1：填平 AI SDK 运行时字段 (input/output) 与前端注水规范 (args/result) 的断层
        const invocations = toolCalls?.map(call => {
          const res = toolResults?.find(r => r.toolCallId === call.toolCallId);
          return {
            state: res ? 'result' : 'call',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            args: call.input,
            result: res?.output
          };
        });

        console.log("\n================ [💾 DB PERSISTENCE INTENT] ================");
        console.log("-> 4. db.content:", JSON.stringify(cleanContent));
        console.log("-> 5. db.toolInvocations:", JSON.stringify(invocations, null, 2));
        console.log("==============================================================\n");

        await db.insert(projectMessages).values({
          id: crypto.randomUUID(),
          projectId,
          role: "assistant",
          content: cleanContent,
          toolInvocations: invocations && invocations.length > 0 ? invocations : null
        });
      } catch (error) {
        console.error("Chat persistence error:", error);
      }
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
