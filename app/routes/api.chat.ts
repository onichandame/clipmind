import type { Route } from "./+types/api.chat";
import { db } from "../db/client";
import { projectOutlines, projectMessages } from "../db/schema";
import { eq } from "drizzle-orm";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai.server";
import { streamText, tool, convertToModelMessages } from "ai";
import { z } from "zod";

export async function action({ request }: Route.ActionArgs) {
  const body = await request.json();
  const { messages, projectId } = body as { messages: any[]; projectId: string; };

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
      const result = streamText({
        model, system: SYSTEM_PROMPT, messages: await convertToModelMessages(messages), 
        maxSteps: 1, // 核心修复：基于日志实锤，禁止多步回调，拿到 Tool 结果后立刻关闭流，释放前端状态机
        onFinish: async ({ text, toolCalls, toolResults }) => {
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
            inputSchema: z.object({ contentMd: z.string().describe('最新版本的完整 Markdown 内容') }),
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
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => { return { clips: [], total: 0, message: "Mock" }; }
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
