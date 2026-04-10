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
        model, system: SYSTEM_PROMPT, messages: await convertToModelMessages(messages), maxSteps: 5,
        onFinish: async ({ text, toolCalls, toolResults }) => {
          try {
            let aiContent = text || "";
        if (toolCalls && toolCalls.length > 0) aiContent += "\n\n" + JSON.stringify({ toolCalls, toolResults });

        await db.insert(projectMessages).values({
          id: crypto.randomUUID(), projectId, role: "assistant", content: aiContent || "[Tool Executed]",
        });
      } catch (error) {
        console.error("Chat persistence error:", error);
      }
    },
    tools: {
      updateOutline: tool({
        description: "Update outline",
        inputSchema: z.object({ contentMd: z.string(), projectId: z.string() }),
        execute: async ({ contentMd, projectId: pid }) => { return { success: true }; }
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
