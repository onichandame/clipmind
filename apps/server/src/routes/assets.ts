import { Hono } from "hono";
import { assets } from "@clipmind/db";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { signAssetViewUrl } from "../utils/oss";
import { deleteVectorsByAssetId } from "../utils/qdrant";

const app = new Hono();

app.get("/", async (c) => {
  try {
    const allAssets = await db.select().from(assets).orderBy(desc(assets.createdAt));

    // 架构升级：私有 Bucket 动态签名策略
    // 数据库仅存储 Key，分发层实时生成带有 Expires/Signature 的临时链接 (统一走 utils/oss 签发器，强制 HTTPS)
    const mappedAssets = allAssets.map(asset => ({
      ...asset,
      ossUrl: signAssetViewUrl(asset.ossUrl),
      audioOssUrl: signAssetViewUrl(asset.audioOssUrl),
      thumbnailUrl: signAssetViewUrl(asset.thumbnailUrl),
    }));

    return c.json(mappedAssets);
  } catch (error) {
    console.error('❌ 获取资产列表失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

app.post("/report", async (c) => {
  try {
    const body = await c.req.json();
    const { id, filename, duration, ossUrl, audioOssUrl, thumbnailUrl, fileSize } = body;

    await db.insert(assets).values({
      id,
      filename,
      ossUrl,
      audioOssUrl,
      thumbnailUrl,
      fileSize,
      duration,
      status: 'processing',
    });

    return c.json({ success: true, assetId: id });
  } catch (error) {
    console.error('❌ 资产入库失败:', error);
    return c.json({ error: 'Database Insert Error' }, 500);
  }
});

app.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    await db.delete(assets).where(eq(assets.id, id));

    // 触发 Qdrant 幽灵向量清理 (Fire-and-forget 防阻塞)，同时清理 chunks 和 summary 两个 collection
    const { QDRANT_SUMMARY_COLLECTION } = await import("../utils/qdrant");
    deleteVectorsByAssetId(id).catch(e => console.error(`❌ [Qdrant] 清理资产 ${id} 的 chunks 向量失败:`, e));
    deleteVectorsByAssetId(id, QDRANT_SUMMARY_COLLECTION).catch(e => console.error(`❌ [Qdrant] 清理资产 ${id} 的 summary 向量失败:`, e));

    return c.json({ success: true });
  } catch (error) {
    console.error('❌ 删除资产失败:', error);
    return c.json({ error: 'Database Delete Error' }, 500);
  }
});

export default app;
