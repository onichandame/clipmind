import { Hono } from "hono";
import { mediaFiles, assetChunks } from "@clipmind/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { completeAssetWithoutTranscript, processAssetPostASR } from "../logic/asset-processor";
import { deleteVectorsByAssetId, QDRANT_CHUNKS_COLLECTION } from "../utils/qdrant";
import { withFileHashLock } from "../utils/import-locks";
import { verifyAsrCallbackToken } from "../utils/asr-callback-token";

const app = new Hono();

const ASR_SUCCESS = 21050000;
const ASR_SUCCESS_WITH_NO_VALID_FRAGMENT = 21050003;

function deterministicChunkId(mediaFileId: string, sentence: any, index: number) {
  const hex = createHash('sha256')
    .update(`${mediaFileId}:${index}:${sentence.BeginTime}:${sentence.EndTime}:${sentence.Text}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function hasValidSentenceShape(sentence: any) {
  return sentence
    && typeof sentence === 'object'
    && typeof sentence.Text === 'string'
    && Number.isFinite(sentence.BeginTime)
    && Number.isFinite(sentence.EndTime)
    && sentence.BeginTime >= 0
    && sentence.EndTime > sentence.BeginTime;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findMediaByAsrTaskId(taskId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [record] = await db
      .select({ id: mediaFiles.id, fileHash: mediaFiles.fileHash, status: mediaFiles.status, asrTaskId: mediaFiles.asrTaskId })
      .from(mediaFiles)
      .where(eq(mediaFiles.asrTaskId, taskId))
      .limit(1);
    if (record) return record;
    if (attempt < 2) await sleep(500);
  }
  return null;
}

async function claimAsrEmbeddingStage(mediaFileId: string, taskId: string) {
  const result = await db.update(mediaFiles)
    .set({ processingStage: 'embedding' })
    .where(and(
      eq(mediaFiles.id, mediaFileId),
      eq(mediaFiles.asrTaskId, taskId),
      eq(mediaFiles.status, 'processing'),
      eq(mediaFiles.processingStage, 'asr'),
    ));
  const affected = (result as any)?.[0]?.affectedRows ?? 0;
  return affected > 0;
}

async function failCurrentAsrTask(mediaFileId: string, taskId: string, failureReason: string) {
  await db.update(mediaFiles).set({
    status: 'failed',
    processingStage: null,
    failureStage: 'asr',
    failureReason,
  }).where(and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.asrTaskId, taskId)));
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
    const mediaFileIdFromQuery = c.req.query('mediaFileId');
    const callbackToken = c.req.query('token');

    if (!taskId) {
      console.error('❌ ASR Webhook 缺少 TaskId，忽略该回调以避免重试死循环');
      return new Response(JSON.stringify({ success: true, msg: 'Missing TaskId ignored' }), { status: 200 });
    }

    // 1. 反查 media_files 中的 asrTaskId。阿里云可能在 submitter 写库前回调，做一次短重试。
    const mfRecord = await findMediaByAsrTaskId(taskId);
    if (!mfRecord) {
      console.error(`❌ Webhook 找不到对应的 TaskId: ${taskId}`);
      return new Response(JSON.stringify({ success: true, msg: "Task ignored" }), { status: 200 });
    }

    const mediaFileId = mfRecord.id;

    if (!mediaFileIdFromQuery || mediaFileIdFromQuery !== mediaFileId || !verifyAsrCallbackToken(callbackToken, mediaFileId)) {
      console.error(`❌ ASR Webhook callback token 校验失败: ${taskId}`);
      return new Response(JSON.stringify({ success: true, msg: 'Invalid callback token ignored' }), { status: 200 });
    }

    if (mfRecord.status === 'ready') {
      console.log(`ℹ️ ASR 回调重复送达，媒体文件 ${mediaFileId} 已完成，直接忽略。`);
      return new Response(JSON.stringify({ success: true, msg: 'Duplicate ignored' }), { status: 200 });
    }

    return await withFileHashLock(mfRecord.fileHash, async () => {
      const freshRecord = await findMediaByAsrTaskId(taskId);
      if (!freshRecord || freshRecord.id !== mediaFileId) {
        console.log(`ℹ️ ASR stale callback ignored after lock: ${taskId}`);
        return new Response(JSON.stringify({ success: true, msg: 'Stale ignored' }), { status: 200 });
      }
      if (freshRecord.status === 'ready') {
        console.log(`ℹ️ ASR duplicate callback ignored after lock: ${taskId}`);
        return new Response(JSON.stringify({ success: true, msg: 'Duplicate ignored' }), { status: 200 });
      }

    if (statusCode === ASR_SUCCESS) {
      const sentences = result?.Sentences;

      if (!Array.isArray(sentences)) {
        await failCurrentAsrTask(mediaFileId, taskId, 'ASR success callback missing Sentences array');
        console.error(`❌ ASR 成功回调缺少合法 Sentences 数组: ${taskId}`);
      } else {
        const hasMalformedSentence = sentences.some((sentence: any) => !hasValidSentenceShape(sentence));

        if (hasMalformedSentence) {
          await failCurrentAsrTask(mediaFileId, taskId, 'ASR success callback contained malformed sentence');
          console.error(`❌ ASR 成功回调包含结构不合法的句子: ${taskId}`);
        } else {
          const textSentences = sentences.filter((sentence: any) => sentence.Text.trim().length > 0);

          if (textSentences.length > 0) {
            const chunksToInsert = textSentences.map((sentence: any, index: number) => ({
              id: deterministicChunkId(mediaFileId, sentence, index),
              mediaFileId,
              startTime: sentence.BeginTime,
              endTime: sentence.EndTime,
              transcriptText: sentence.Text,
              asrTaskId: taskId,
            }));

            if (!(await claimAsrEmbeddingStage(mediaFileId, taskId))) {
              console.log(`ℹ️ ASR stale/duplicate callback ignored before chunk write: ${taskId}`);
              return new Response(JSON.stringify({ success: true, msg: 'Stale ignored' }), { status: 200 });
            }
            try {
              await deleteVectorsByAssetId(mediaFileId, QDRANT_CHUNKS_COLLECTION);
            } catch (error) {
              await db.update(mediaFiles).set({
                status: 'failed',
                processingStage: null,
                failureStage: 'qdrant',
                failureReason: String(error),
              }).where(and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.asrTaskId, taskId)));
              throw error;
            }
            await db.delete(assetChunks).where(eq(assetChunks.mediaFileId, mediaFileId));
            await db.insert(assetChunks).values(chunksToInsert);
            console.log(`✅ ASR 切片落盘成功：媒体文件 ${mediaFileId}，共生成 ${chunksToInsert.length} 条 RAG 索引片段。`);

            processAssetPostASR(mediaFileId, chunksToInsert).catch(console.error);
          } else {
            await completeAssetWithoutTranscript(mediaFileId, undefined, 'empty', taskId);
            console.log(`✅ ASR 成功但无有效句子：媒体文件 ${mediaFileId} 按空转写完成导入。`);
          }
        }
      }
    } else if (statusCode === ASR_SUCCESS_WITH_NO_VALID_FRAGMENT) {
      await completeAssetWithoutTranscript(mediaFileId, undefined, 'empty', taskId);
      console.log(`✅ ASR 无有效语音片段：媒体文件 ${mediaFileId} 按空转写完成导入。`);
    } else {
      await failCurrentAsrTask(mediaFileId, taskId, `ASR failed with status code ${statusCode}`);
      console.error(`❌ ASR 任务底层失败: ${taskId}, 状态码: ${statusCode}`);
    }

    // 强制向阿里云返回 200 OK，否则会导致重试死循环
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    });

  } catch (error) {
    console.error('❌ ASR Webhook 解析致命错误:', error);
    // 依然返回 200 斩断阿里云重试
    return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 200 });
  }
});

export default app;
