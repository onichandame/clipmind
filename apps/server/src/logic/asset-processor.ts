import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { assets } from "@clipmind/db";
import { createAIModel } from "../utils/ai";
import { generateEmbeddings } from "../utils/embeddings";
import { upsertVectors, QDRANT_CHUNKS_COLLECTION, QDRANT_SUMMARY_COLLECTION } from "../utils/qdrant";

/**
 * 资产后处理中枢：处理 ASR 切片，生成 LLM 总结，并分别推入 Qdrant。
 */
export async function processAssetPostASR(assetId: string, chunks: any[]) {
  try {
    console.log(`[Processor] 🕒 ${new Date().toISOString()} - 资产 ${assetId} 进入中枢处理管线...`);
    
    // ============================================
    // 阶段 1: 建立微观片段的向量索引 (Chunks)
    // ============================================
    const texts = chunks.map(c => c.transcriptText);
    const chunkVectors = await generateEmbeddings(texts);
    
    const chunkPoints = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: chunkVectors[i],
      payload: {
        assetId: chunk.assetId,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        text: chunk.transcriptText
      }
    }));
    
    await upsertVectors(chunkPoints, QDRANT_CHUNKS_COLLECTION);
    console.log(`[Processor] ✅ 资产 ${assetId} 的 ${chunkPoints.length} 个片段已推入 Qdrant。`);

    // ============================================
    // 阶段 2: 提取全量文本并呼叫 LLM 提炼宏观总结
    // ============================================
    const fullTranscript = chunks.map(c => c.transcriptText).join(" ");
    console.log(`[Processor] 🕒 请求 LLM 生成资产总结 (文本长度: ${fullTranscript.length})...`);
    
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
    const [summaryVector] = await generateEmbeddings([summary]);
    const summaryPoint = {
      id: crypto.randomUUID(), // 此处用 UUID 作为 PointID，通过 Payload 绑定 assetId
      vector: summaryVector,
      payload: {
        assetId,
        text: summary,
        type: 'summary'
      }
    };
    
    await upsertVectors([summaryPoint], QDRANT_SUMMARY_COLLECTION);
    console.log(`[Processor] ✅ 资产总结向量已推入 Qdrant (${QDRANT_SUMMARY_COLLECTION})。`);

    // ============================================
    // 阶段 4: DB 流转终态落盘
    // ============================================
    await db.update(assets).set({ 
      status: 'ready',
      summary: summary 
    }).where(eq(assets.id, assetId));
    
    console.log(`✅ [Processor] 资产 ${assetId} 全链路处理完毕，状态扭转为 ready。`);
    
  } catch (error) {
    await db.update(assets).set({ status: 'error' }).where(eq(assets.id, assetId));
    console.error(`❌ [Processor] Task failed for asset ${assetId}:`, error);
  }
}
