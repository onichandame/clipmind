import { Hono } from "hono";
import { mediaFiles, projectAssets } from "@clipmind/db";
import { desc, eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { signAssetViewUrl, signAssetDownloadUrl } from "../utils/oss";
import { deleteVectorsByAssetId, QDRANT_SUMMARY_COLLECTION } from "../utils/qdrant";
import { requireAuth } from "../middleware/auth";

const app = new Hono();

app.use('*', requireAuth);

// GET /api/assets?projectId=xxx — list project-scoped assets joining media_files for processing state
app.get("/", async (c) => {
  const user = c.get('user');
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId query param required' }, 400);
  }
  try {
    const rows = await db
      .select({
        id: projectAssets.id,
        mediaFileId: projectAssets.mediaFileId,
        projectId: projectAssets.projectId,
        filename: projectAssets.filename,
        localPath: projectAssets.localPath,
        originDeviceId: projectAssets.originDeviceId,
        videoOssKey: projectAssets.videoOssKey,
        backupStatus: projectAssets.backupStatus,
        createdAt: projectAssets.createdAt,
        // from media_files
        fileSize: mediaFiles.fileSize,
        duration: mediaFiles.duration,
        status: mediaFiles.status,
        asrStatus: mediaFiles.asrStatus,
        summary: mediaFiles.summary,
        audioOssKey: mediaFiles.audioOssKey,
        thumbnailOssKey: mediaFiles.thumbnailOssKey,
      })
      .from(projectAssets)
      .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
      .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.userId, user.id)))
      .orderBy(desc(projectAssets.createdAt));

    const mapped = rows.map(row => ({
      ...row,
      videoOssUrl: row.videoOssKey ? signAssetViewUrl(row.videoOssKey) : null,
      audioOssUrl: row.audioOssKey ? signAssetViewUrl(row.audioOssKey) : null,
      thumbnailUrl: row.thumbnailOssKey ? signAssetViewUrl(row.thumbnailOssKey) : null,
    }));

    return c.json(mapped);
  } catch (error) {
    console.error('❌ 获取项目资产列表失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

// POST /api/assets — pre-register + dedup by fileHash
// Returns { assetId, mediaFileId, alreadyProcessed }
app.post("/", async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const { projectId, fileHash, filename, localPath, originDeviceId, fileSize, duration, asrStatus } = body || {};

    if (!projectId || !fileHash || !filename || !localPath || !originDeviceId || typeof fileSize !== 'number') {
      return c.json({ error: 'projectId, fileHash, filename, localPath, originDeviceId, fileSize required' }, 400);
    }

    const allowedAsr = new Set(['pending', 'skipped']);
    const initialAsrStatus = allowedAsr.has(asrStatus) ? asrStatus : 'pending';

    // 1. Dedup check: same user + same file hash
    const [existing] = await db
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.userId, user.id), eq(mediaFiles.fileHash, fileHash)))
      .limit(1);

    let mediaFileId: string;
    let alreadyProcessed = false;

    if (existing) {
      mediaFileId = existing.id;
      alreadyProcessed = existing.status === 'ready' && existing.asrStatus === 'completed';
    } else {
      // New file: create media_files row
      mediaFileId = crypto.randomUUID();
      try {
        await db.insert(mediaFiles).values({
          id: mediaFileId,
          userId: user.id,
          fileHash,
          fileSize,
          duration: duration ?? null,
          status: 'processing',
          asrStatus: initialAsrStatus,
        });
      } catch (e: any) {
        const msg = String(e?.code || e?.message || '');
        if (msg.includes('ER_DUP_ENTRY') || msg.includes('Duplicate')) {
          // Lost the race — another concurrent upload won; re-select
          const [winner] = await db
            .select()
            .from(mediaFiles)
            .where(and(eq(mediaFiles.userId, user.id), eq(mediaFiles.fileHash, fileHash)))
            .limit(1);
          if (!winner) throw e;
          mediaFileId = winner.id;
          alreadyProcessed = winner.status === 'ready' && winner.asrStatus === 'completed';
        } else {
          throw e;
        }
      }
    }

    // 2. Create project_assets row (always, even for dedup)
    const projectAssetId = crypto.randomUUID();
    await db.insert(projectAssets).values({
      id: projectAssetId,
      projectId,
      userId: user.id,
      mediaFileId,
      filename,
      localPath,
      originDeviceId,
      backupStatus: 'local_only',
    });

    return c.json({ assetId: projectAssetId, mediaFileId, alreadyProcessed });
  } catch (error) {
    console.error('❌ 资产预登记失败:', error);
    return c.json({ error: 'Database Insert Error' }, 500);
  }
});

// POST /api/assets/:id/relink — update local path on project_assets
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
      .update(projectAssets)
      .set({ localPath, originDeviceId })
      .where(and(eq(projectAssets.id, id), eq(projectAssets.userId, user.id)));
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ relink 失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

// DELETE /api/assets/:id — delete project_asset; clean up media_file if last reference for this user
app.delete("/:id", async (c) => {
  const user = c.get('user');
  try {
    const id = c.req.param("id");

    // MySQL state changes (project_assets row, possibly media_files row) run in
    // one transaction so we never end up with project_assets gone but media_files
    // dangling. Qdrant cleanup is fire-and-forget after commit — cross-system
    // atomicity isn't possible; cron sweeps OSS orphans and is the safety net.
    const result = await db.transaction(async (tx) => {
      const [pa] = await tx
        .select({ mediaFileId: projectAssets.mediaFileId })
        .from(projectAssets)
        .where(and(eq(projectAssets.id, id), eq(projectAssets.userId, user.id)))
        .limit(1);

      if (!pa) return { found: false as const };

      await tx.delete(projectAssets).where(and(eq(projectAssets.id, id), eq(projectAssets.userId, user.id)));

      const remaining = await tx
        .select({ id: projectAssets.id })
        .from(projectAssets)
        .where(and(eq(projectAssets.mediaFileId, pa.mediaFileId), eq(projectAssets.userId, user.id)))
        .limit(1);

      const isLastReference = remaining.length === 0;
      if (isLastReference) {
        await tx.delete(mediaFiles).where(eq(mediaFiles.id, pa.mediaFileId));
      }
      return { found: true as const, mediaFileId: pa.mediaFileId, isLastReference };
    });

    if (!result.found) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    if (result.isLastReference) {
      deleteVectorsByAssetId(result.mediaFileId).catch(e =>
        console.error(`❌ [Qdrant] 清理 ${result.mediaFileId} chunks 向量失败:`, e));
      deleteVectorsByAssetId(result.mediaFileId, QDRANT_SUMMARY_COLLECTION).catch(e =>
        console.error(`❌ [Qdrant] 清理 ${result.mediaFileId} summary 向量失败:`, e));
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('❌ 删除资产失败:', error);
    return c.json({ error: 'Database Delete Error' }, 500);
  }
});

export default app;
