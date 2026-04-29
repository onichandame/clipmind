import { Hono } from "hono";
import { mediaFiles, assetChunks } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { processAssetPostASR } from "../logic/asset-processor";

const app = new Hono();

app.post("/", async (c) => {
  try {
    console.log("\n******************************************");
    console.log("[DEBUG: ASR-Callback] 1. 收到阿里云的回调 POST 请求!");
    const body = await c.req.json();
    console.log("[DEBUG: ASR-Callback] 2. 回调请求体:", JSON.stringify(body));

    // 依据阿里云 FileTrans Webhook 官方结构解析
    const taskId = body.TaskId;
    const statusCode = body.StatusCode;
    const result = body.Result;

    if (!taskId) {
      return new Response(JSON.stringify({ error: 'Missing TaskId' }), { status: 400 });
    }

    // 1. 反查 media_files 中的 asrTaskId
    const [mfRecord] = await db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.asrTaskId, taskId)).limit(1);
    if (!mfRecord) {
      console.error(`❌ Webhook 找不到对应的 TaskId: ${taskId}`);
      return new Response(JSON.stringify({ success: true, msg: "Task ignored" }), { status: 200 });
    }

    const mediaFileId = mfRecord.id;

    if (statusCode === 21050000) {
      await db.update(mediaFiles).set({ asrStatus: 'completed' }).where(eq(mediaFiles.id, mediaFileId));

      if (result && result.Sentences && result.Sentences.length > 0) {
        const chunksToInsert = result.Sentences.map((sentence: any) => ({
          id: crypto.randomUUID(),
          mediaFileId,
          startTime: sentence.BeginTime,
          endTime: sentence.EndTime,
          transcriptText: sentence.Text
        }));

        await db.insert(assetChunks).values(chunksToInsert);
        console.log(`✅ ASR 切片落盘成功：媒体文件 ${mediaFileId}，共生成 ${chunksToInsert.length} 条 RAG 索引片段。`);

        processAssetPostASR(mediaFileId, chunksToInsert).catch(console.error);
      }
    } else {
      await db.update(mediaFiles).set({ status: 'error', asrStatus: 'failed' }).where(eq(mediaFiles.id, mediaFileId));
      console.error(`❌ ASR 任务底层失败: ${taskId}, 状态码: ${statusCode}`);
    }

    // 强制向阿里云返回 200 OK，否则会导致重试死循环
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ ASR Webhook 解析致命错误:', error);
    // 依然返回 200 斩断阿里云重试
    return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 200 });
  }
});

export default app;
