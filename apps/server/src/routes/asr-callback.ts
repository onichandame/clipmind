import { Hono } from "hono";
import { assets, assetChunks } from "@clipmind/db";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { generateEmbeddings } from "../utils/embeddings";
import { upsertVectors } from "../utils/qdrant";

const app = new Hono();

async function processVectorization(assetId: string, chunks: any[]) {
  try {
    console.log(`[PROBE: VECTOR] 🕒 ${new Date().toISOString()} - 资产 ${assetId} 开始向量化...`);
    const texts = chunks.map(c => c.transcriptText);
    const vectors = await generateEmbeddings(texts);

    const points = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: vectors[i],
      payload: {
        assetId: chunk.assetId,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        text: chunk.transcriptText
      }
    }));

    await upsertVectors(points);
    console.log(`[PROBE: VECTOR] 🕒 ${new Date().toISOString()} - Qdrant 写入完成，准备更新数据库为 ready...`);
    await db.update(assets).set({ status: 'ready' }).where(eq(assets.id, assetId));
    console.log(`✅ [PROBE: VECTOR] 🕒 ${new Date().toISOString()} - 资产 ${assetId} 数据库状态已正式流转为 ready。`);
  } catch (error) {
    await db.update(assets).set({ status: 'error' }).where(eq(assets.id, assetId));
    console.error(`❌ [Vectorization] Task failed for asset ${assetId}:`, error);
  }
}

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

    // 1. 提取 TaskId 并在 assets 表中反查 assetId
    const assetRecord = await db.select().from(assets).where(eq(assets.asrTaskId, taskId)).limit(1);
    if (assetRecord.length === 0) {
      console.error(`❌ Webhook 找不到对应的 TaskId: ${taskId}`);
      // 找不到任务属于幽灵回调，直接返回 200 防止阿里云不断重试风暴
      return new Response(JSON.stringify({ success: true, msg: "Task ignored" }), { status: 200 });
    }

    const assetId = assetRecord[0].id;

    if (statusCode === 21050000) {
      // 2. 状态扭转为成功
      await db.update(assets).set({ asrStatus: 'completed' }).where(eq(assets.id, assetId));

      // 3. 毫秒级时间轴与切片台词批量落盘
      if (result && result.Sentences && result.Sentences.length > 0) {
        const chunksToInsert = result.Sentences.map((sentence: any) => ({
          id: crypto.randomUUID(),
          assetId: assetId,
          startTime: sentence.BeginTime,
          endTime: sentence.EndTime,
          transcriptText: sentence.Text
        }));

        await db.insert(assetChunks).values(chunksToInsert);
        console.log(`✅ ASR 切片落盘成功：资产 ${assetId}，共生成 ${chunksToInsert.length} 条 RAG 索引片段。`);

        processVectorization(assetId, chunksToInsert).catch(console.error);
      }
    } else {
      // 失败状态流转
      await db.update(assets).set({ status: 'error', asrStatus: 'failed' }).where(eq(assets.id, assetId));
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
