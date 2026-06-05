import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { assetChunks, mediaFiles } from "@clipmind/db";
import { createAIModel } from "../utils/ai";
import { generateEmbeddings } from "../utils/embeddings";
import { deleteVectorsByAssetId, upsertVectors, QDRANT_CHUNKS_COLLECTION, QDRANT_SUMMARY_COLLECTION } from "../utils/qdrant";

export const EMPTY_TRANSCRIPT_SUMMARY = '未识别到有效语音内容，可作为无口播或环境声素材使用。';

async function upsertSummaryVector(assetId: string, summary: string) {
  const [summaryVector] = await generateEmbeddings([summary]);
  const summaryPoint = {
    id: assetId,
    vector: summaryVector,
    payload: {
      assetId,
      text: summary,
      type: 'summary'
    }
  };

  await upsertVectors([summaryPoint], QDRANT_SUMMARY_COLLECTION);
}

export async function completeAssetWithoutTranscript(
  mediaFileId: string,
  summary = EMPTY_TRANSCRIPT_SUMMARY,
  transcriptKind: 'empty' | 'skipped' = 'empty',
  expectedAsrTaskId: string | null = null,
) {
  const assetId = mediaFileId;
  const whereCurrent = expectedAsrTaskId
    ? and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.asrTaskId, expectedAsrTaskId))
    : eq(mediaFiles.id, mediaFileId);

  if (expectedAsrTaskId) {
    const [current] = await db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(whereCurrent)
      .limit(1);
    if (!current) {
      console.log(`[Processor] 忽略 stale 空转写完成: mediaFileId=${mediaFileId}, taskId=${expectedAsrTaskId}`);
      return;
    }
  }

  try {
    await deleteVectorsByAssetId(assetId, QDRANT_CHUNKS_COLLECTION);
  } catch (error) {
    await db.update(mediaFiles).set({
      status: 'failed',
      processingStage: null,
      failureStage: 'qdrant',
      failureReason: String(error),
    }).where(whereCurrent);
    throw error;
  }

  await db.delete(assetChunks).where(eq(assetChunks.mediaFileId, mediaFileId));

  try {
    await upsertSummaryVector(assetId, summary);
  } catch (error) {
    await db.update(mediaFiles).set({
      status: 'failed',
      processingStage: null,
      failureStage: 'qdrant',
      failureReason: String(error),
    }).where(whereCurrent);
    throw error;
  }

  await db.update(mediaFiles).set({
    status: 'ready',
    transcriptKind,
    processingStage: null,
    failureStage: null,
    failureReason: null,
    summary,
  }).where(whereCurrent);
  console.log(`[Processor] ✅ 空转写资产 ${assetId} 的 fallback summary 已推入 Qdrant。`);
}

/**
 * 资产后处理中枢：处理 ASR 切片，生成 LLM 总结，并分别推入 Qdrant。
 */
export async function processAssetPostASR(mediaFileId: string, chunks: any[]) {
  const expectedAsrTaskId = chunks[0]?.asrTaskId ?? null;
  const assetId = mediaFileId; // Qdrant payload field name kept as 'assetId' for compatibility
  const whereCurrent = expectedAsrTaskId
    ? and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.asrTaskId, expectedAsrTaskId))
    : eq(mediaFiles.id, mediaFileId);
  const whereCurrentProcessing = expectedAsrTaskId
    ? and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.asrTaskId, expectedAsrTaskId), eq(mediaFiles.status, 'processing'))
    : and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.status, 'processing'));
  let failureStage: 'embedding' | 'qdrant' | 'processing' = 'processing';
  try {
    if (expectedAsrTaskId) {
      const [current] = await db
        .select({ id: mediaFiles.id })
        .from(mediaFiles)
        .where(whereCurrent)
        .limit(1);
      if (!current) {
        console.log(`[Processor] 忽略 stale ASR 后处理: mediaFileId=${mediaFileId}, taskId=${expectedAsrTaskId}`);
        return;
      }
    }

    console.log(`[Processor] 🕒 ${new Date().toISOString()} - 媒体文件 ${mediaFileId} 进入中枢处理管线...`);
    
    const texts = chunks.map(c => c.transcriptText);
    failureStage = 'embedding';
    const chunkVectors = await generateEmbeddings(texts);
    
    const chunkPoints = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: chunkVectors[i],
      payload: {
        // Per-project assets refactor renamed the column on chunks to mediaFileId.
        // The Qdrant payload field is still called assetId for filter-shape stability.
        assetId: chunk.mediaFileId,
        chunkId: chunk.id,
        asrTaskId: chunk.asrTaskId ?? null,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        text: chunk.transcriptText
      }
    }));
    
    failureStage = 'qdrant';
    await upsertVectors(chunkPoints, QDRANT_CHUNKS_COLLECTION);
    console.log(`[Processor] ✅ 资产 ${assetId} 的 ${chunkPoints.length} 个片段已推入 Qdrant。`);

    // ============================================
    // 阶段 2: 提取全量文本并呼叫 LLM 提炼宏观总结
    // ============================================
    const fullTranscript = chunks.map(c => c.transcriptText).join(" ");
    console.log(`[Processor] 🕒 请求 LLM 生成资产总结 (文本长度: ${fullTranscript.length})...`);
    
    failureStage = 'processing';
    const { text: summary } = await generateText({
      model: createAIModel(),
      system: `你是一位专业的短视频分析师。请根据下方提供的视频 ASR 转录语音文本，生成一段极致精简的【视频摘要总结】。
要求：
1. 聚焦于视频的核心意图、讲述主体、场景氛围。
2. 用词精炼，不要出现“这段视频讲述了”、“大家好”等废话。
3. 长度严格控制在 50-100 字以内，以便作为搜索引擎的精准靶标。`,
      prompt: `=== 视频转录内容 ===\n${fullTranscript}`
    });

    console.log(`[Processor] ✅ 资产 ${assetId} 总结生成完毕: ${summary}`);

    // ============================================
    // 阶段 3: 将宏观总结向量化并推入 Qdrant (Summary)
    // ============================================
    failureStage = 'qdrant';
    await upsertSummaryVector(assetId, summary);
    console.log(`[Processor] ✅ 资产总结向量已推入 Qdrant (${QDRANT_SUMMARY_COLLECTION})。`);

    // ============================================
    // 阶段 4: DB 流转终态落盘
    // ============================================
    await db.update(mediaFiles).set({
      status: 'ready',
      transcriptKind: 'speech',
      processingStage: null,
      failureStage: null,
      failureReason: null,
      summary: summary
    }).where(whereCurrent);

    console.log(`✅ [Processor] 媒体文件 ${mediaFileId} 全链路处理完毕，状态扭转为 ready。`);

  } catch (error) {
    await db.update(mediaFiles).set({
      status: 'failed',
      processingStage: null,
      failureStage,
      failureReason: String(error),
    }).where(whereCurrentProcessing);
    console.error(`❌ [Processor] Task failed for asset ${assetId}:`, error);
  }
}
