import type { Route } from "./+types/api.chat";
import { db } from "../db/client";
import { projectOutlines } from "../db/schema";
import { eq } from "drizzle-orm";
import { createAIModel, SYSTEM_PROMPT } from "../utils/ai.server";
// 修复：引入最新的 convertToModelMessages
import { streamText, tool, convertToModelMessages } from "ai";
import { z } from "zod";

export async function action({ request }: Route.ActionArgs) {
  try {
    const body = await request.json();
    const { messages, projectId } = body as {
      messages: any[];
      projectId: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "messages is required and must be an array" }, { status: 400 });
    }

    if (!projectId || typeof projectId !== "string") {
      return Response.json({ error: "projectId is required" }, { status: 400 });
    }

    const model = createAIModel();

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      // 修复：AI SDK v5 官方要求的异步转换写法
      messages: await convertToModelMessages(messages),
      // 修复：v5 推荐的开启多轮工具调用方式，替代废弃的 stopWhen
      maxSteps: 5,
      tools: {
        updateOutline: tool({
          description: "Update the Markdown outline for the current project. Call this when the user explicitly asks to write, modify, or create an outline.",
          inputSchema: z.object({
            contentMd: z.string().describe("The complete Markdown content of the outline"),
            projectId: z.string().describe("The project ID to update"),
          }),
          execute: async ({ contentMd, projectId: pid }) => {
            const [existing] = await db
              .select()
              .from(projectOutlines)
              .where(eq(projectOutlines.projectId, pid))
              .limit(1);

            let version: number;

            if (existing) {
              version = existing.version + 1;
              await db
                .update(projectOutlines)
                .set({ contentMd, version })
                .where(eq(projectOutlines.projectId, pid));
            } else {
              version = 1;
              await db.insert(projectOutlines).values({
                id: crypto.randomUUID(),
                projectId: pid,
                contentMd,
                version,
              });
            }

            return { success: true, projectId: pid, version };
          },
        }),
        searchFootage: tool({
          description: "Search the user's video library for clips matching a natural language query. Call this when the user explicitly asks to search for video clips.",
          inputSchema: z.object({
            query: z.string().describe("The search query in natural language"),
          }),
          execute: async ({ query }) => {
            return {
              clips: [
                {
                  id: "mock-clip-1",
                  assetId: "mock-asset-1",
                  filename: "sample_video_1.mp4",
                  startTime: 0,
                  endTime: 15000,
                  transcriptText: `[Mock] This is a placeholder clip matching: "${query}". Real implementation coming in Stage 6.`,
                  score: 0.95,
                },
              ],
              total: 1,
              message: "Mock data - Stage 6 will implement real semantic + lexical search",
            };
          },
        }),
      },
    });

    // 修复：AI SDK v5 官方的流式返回接口
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json(
      { error: "AI service unavailable. Please try again." },
      { status: 500 }
    );
  }
}
