import { Hono } from "hono";
import { db, projectOutlines, projectMessages } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages, UIMessage } from "ai";
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
    const lastUserMessage = messages[messages.length - 1];
    let userContent = "";
    if (typeof lastUserMessage.content === "string") {
      userContent = lastUserMessage.content;
    } else if (Array.isArray(lastUserMessage.parts)) {
      userContent = lastUserMessage.parts.map((p: any) => p.text || "").join("");
    } else {
      userContent = lastUserMessage.text || JSON.stringify(lastUserMessage);
    }
    await db.insert(projectMessages).values({
      id: crypto.randomUUID(), projectId, role: "user", content: userContent || "[Empty]",
    });
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }

  // 2. 启动流式响应
  const model = createAIModel();

  // 架构师干预：彻底修复 v6 异步边界与 parts 强制结构 (向下兼容处理)
  const normalizedMessages = (messages || []).map((msg: any) => {
    if (!msg.parts || !Array.isArray(msg.parts)) {
      return {
        ...msg,
        parts: [{ type: 'text', text: msg.content || "" }]
      };
    }
    return msg;
  }) as UIMessage[];

  const safeMessages = await convertToModelMessages(normalizedMessages);

  const result = streamText({
    model, system: dynamicSystemPrompt, messages: safeMessages,
    maxSteps: 5, // 恢复 ReAct Agent 循环，允许大模型在调用工具后继续输出总结文本
    // TODO: [High Priority] 恢复 maxSteps: 5 (当前注销以规避 Vercel AI SDK 3.4+ stream-start 上游崩溃 bug)
    maxSteps: 5,

    // 提取完整的 event 对象以获取 toolResults，用于构建前端所需标准的 toolInvocations
            onFinish: async (event) => {
              try {
                const { text, toolCalls, toolResults } = event;
                let cleanContent = text || "";

                // 构建 Vercel AI SDK 兼容的 toolInvocations
                const invocations = toolCalls?.map(call => {
                  const res = toolResults?.find(r => r.toolCallId === call.toolCallId);
                  return {
                    state: res ? 'result' : 'call',
                    toolCallId: call.toolCallId,
                    toolName: call.toolName,
                    args: call.args,
                    result: res?.result
                  };
                });

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
        parameters: z.object({ contentMd: z.string().describe('最新版本的完整 Markdown 内容') }),
        execute: async (args) => {
          try {
            // 防御与自愈 (Self-Healing)：拦截大模型幻觉导致的空传参
            // 借助 maxSteps: 5 机制，直接将错误信息返回给大模型，强制其在 Step 2 修正重试
            if (!args || !args.contentMd || args.contentMd.trim() === "") {
              console.warn("⚠️ [AI WARN] 拦截到空传参 {}，已驳回并触发 AI SDK 代理重试机制");
              return "Error: Missing required parameter 'contentMd'. You MUST provide the full markdown content.";
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
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => { return { clips: [], total: 0, message: "Mock" }; }
      }),
    },
  });


  return result.toUIMessageStreamResponse();

});

export default app;
