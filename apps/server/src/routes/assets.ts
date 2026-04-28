import { Hono } from "hono";
import { assets } from "@clipmind/db";
import { desc, eq, and } from "drizzle-orm";
import { db } from "../db";
import { signAssetViewUrl } from "../utils/oss";
import { deleteVectorsByAssetId } from "../utils/qdrant";
import { requireAuth } from "../middleware/auth";

const app = new Hono();

app.use('*', requireAuth);

app.get("/", async (c) => {
  const user = c.get('user');
  try {
    const allAssets = await db
      .select()
      .from(assets)
      .where(eq(assets.userId, user.id))
      .orderBy(desc(assets.createdAt));

    // 本地优先：仅签发音频/缩略图（始终上云）和已云备份的视频对象 key。
    // 视频未云备份时，videoOssKey 为 null，前端通过 useAssetUri(assetId) 走本地协议解析。
    const mappedAssets = allAssets.map(asset => ({
      ...asset,
      videoOssUrl: asset.videoOssKey ? signAssetViewUrl(asset.videoOssKey) : null,
      audioOssUrl: signAssetViewUrl(asset.audioOssUrl),
      thumbnailUrl: signAssetViewUrl(asset.thumbnailUrl),
    }));

    return c.json(mappedAssets);
  } catch (error) {
    console.error('❌ 获取资产列表失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

// [Local-First] 客户端在 FFmpeg 提取/上传开始之前预先创建资产行，
// 以便在签发 OSS 上传 token 时把 assetId 绑入 HMAC，杜绝跨用户回填。
app.post("/", async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const {
      id,
      filename,
      localPath,
      originDeviceId,
      fileSize,
      duration,
      checksum,
      asrStatus,
    } = body || {};

    if (!filename || !localPath || !originDeviceId || typeof fileSize !== 'number') {
      return c.json({ error: 'filename, localPath, originDeviceId, fileSize required' }, 400);
    }

    const allowedAsr = new Set(['pending', 'skipped']);
    const initialAsrStatus = allowedAsr.has(asrStatus) ? asrStatus : 'pending';

    const assetId = (typeof id === 'string' && id.length > 0) ? id : crypto.randomUUID();

    await db.insert(assets).values({
      id: assetId,
      userId: user.id,
      filename,
      localPath,
      originDeviceId,
      fileSize,
      duration: duration ?? null,
      checksum: checksum ?? null,
      status: 'processing',
      asrStatus: initialAsrStatus,
      backupStatus: 'local_only',
    });

    return c.json({ success: true, assetId });
  } catch (error) {
    console.error('❌ 资产预登记失败:', error);
    return c.json({ error: 'Database Insert Error' }, 500);
  }
});

// 重新定位本地原片（资产迁移到新机器或文件被移动时使用）
app.post('/:id/relink', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const localPath = typeof body?.localPath === 'string' ? body.localPath : null;
  const originDeviceId = typeof body?.originDeviceId === 'string' ? body.originDeviceId : null;
  if (!localPath || !originDeviceId) {
    return c.json({ error: 'localPath and originDeviceId required' }, 400);
  }
  try {
    await db
      .update(assets)
      .set({ localPath, originDeviceId })
      .where(and(eq(assets.id, id), eq(assets.userId, user.id)));
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ relink 失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

app.delete("/:id", async (c) => {
  const user = c.get('user');
  try {
    const id = c.req.param("id");
    await db.delete(assets).where(and(eq(assets.id, id), eq(assets.userId, user.id)));

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
