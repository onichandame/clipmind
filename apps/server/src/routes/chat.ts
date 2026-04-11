import { Hono } from "hono";
import { db, projectOutlines, projectMessages } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai";
import { streamText, tool, convertToModelMessages} from "ai";
import { z } from "zod";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const { messages, projectId, currentOutline, isDirty } = body as { messages: any[]; projectId: string; currentOutline?: string; isDirty?: boolean; };

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
      
      // 架构师干预：根据官方安全规范，手动进行安全的向下兼容映射，防止 SDK 内部崩溃
      const safeMessages = (messages || []).map((m: any) => {
            let textContent = typeof m.content === "string" ? m.content : "";
            
            // 核心修复：解析 V6 的 parts 结构
            if (Array.isArray(m.parts) && m.parts.length > 0) {
                textContent = m.parts.map((p: any) => p.text || "").join("");
            } else if (!textContent && m.content) {
                textContent = JSON.stringify(m.content);
            }
            
            return {
                role: m.role || "user",
                content: textContent
            };
          });

          const result = streamText({
        model, system: dynamicSystemPrompt, messages: safeMessages as any,
        // TODO: [High Priority] 恢复 maxSteps: 5 (当前注销以规避 Vercel AI SDK 3.4+ stream-start 上游崩溃 bug)
        maxSteps: 5,

            onFinish: async ({ text, toolCalls }) => {
              try {
                // 防御：只存纯文本，千万不要把 Tool JSON 存成文本漏给前端
                let cleanContent = text || "";
                
                await db.insert(projectMessages).values({
                  id: crypto.randomUUID(), 
                  projectId, 
                  role: "assistant", 
                  // 如果有内容存内容，如果完全是纯 Tool 调用（如静默更新大纲），则存一个友好提示
                  content: cleanContent || (toolCalls && toolCalls.length > 0 ? "大纲已更新完成。" : "[Empty]")
                });
              } catch (error) {
                console.error("Chat persistence error:", error);
              }
            },
            tools: {
                    updateOutline: tool({
            description: "生成、覆盖或局部修改当前的视频 Markdown 大纲。",
            parameters: z.object({ contentMd: z.string().describe('最新版本的完整 Markdown 内容') }),
                                    execute: async ({ contentMd }) => {
              try {
                // 核心修复：直接使用外部 request.json() 解构出来的真实 projectId，禁止 LLM 瞎猜
                await db.insert(projectOutlines).values({
                  id: crypto.randomUUID(),
                  projectId: projectId, 
                  contentMd: contentMd
                }).onDuplicateKeyUpdate({
                  set: { contentMd: contentMd }
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
