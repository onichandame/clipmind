import { Hono } from "hono";
import { z } from "zod";
import { mediaFiles, projectAssets, projects } from "@clipmind/db";
import { desc, eq, and, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "../db";
import { signAssetViewUrl, signAssetDownloadUrl, deleteAsset } from "../utils/oss";
import { deleteVectorsByAssetId, QDRANT_SUMMARY_COLLECTION } from "../utils/qdrant";
import { requireAuth } from "../middleware/auth";

const app = new Hono();

app.use('*', requireAuth);

// GET /api/assets/library — list all of the user's underlying media files
// (deduped by file hash) along with which projects use each one. Used by the
// global "素材库" page; preview-only (no upload).
app.get("/library", async (c) => {
  const user = c.get('user');
  try {
    // Pull every project_assets row for the user joined with media_files and
    // owning project title. We do client-side grouping by mediaFileId — each
    // user has bounded asset count so this is fine.
    const rows = await db
      .select({
        // project_assets fields (per-use)
        projectAssetId: projectAssets.id,
        projectId: projectAssets.projectId,
        projectTitle: projects.title,
        filename: projectAssets.filename,
        paCreatedAt: projectAssets.createdAt,
        // media_files fields (canonical, per-content)
        mediaFileId: mediaFiles.id,
        fileHash: mediaFiles.fileHash,
        fileSize: mediaFiles.fileSize,
        duration: mediaFiles.duration,
        status: mediaFiles.status,
        asrStatus: mediaFiles.asrStatus,
        summary: mediaFiles.summary,
        audioOssKey: mediaFiles.audioOssKey,
        thumbnailOssKey: mediaFiles.thumbnailOssKey,
        videoOssKey: mediaFiles.videoOssKey,
        backupStatus: mediaFiles.backupStatus,
        createdAt: mediaFiles.createdAt,
      })
      .from(projectAssets)
      .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
      .innerJoin(projects, eq(projects.id, projectAssets.projectId))
      .where(eq(projectAssets.userId, user.id))
      .orderBy(desc(mediaFiles.createdAt));

    // Each media_file may have multiple project_asset variants (one per project
    // it was imported into). Backup state lives on media_files (per-content,
    // shared across projects); variants only carry per-project identity.
    type Variant = {
      projectId: string;
      projectTitle: string;
      projectAssetId: string;
    };
    type MediaGroup = {
      mediaFileId: string;
      filename: string;
      sha256: string;
      audioOssUrl: string | null;
      thumbnailUrl: string | null;
      videoOssUrl: string | null;
      backupStatus: string;
      fileSize: number;
      duration: number | null;
      status: string;
      asrStatus: string | null;
      summary: string | null;
      createdAt: Date;
      variants: Variant[];
    };

    const grouped = new Map<string, MediaGroup>();
    for (const r of rows) {
      let g = grouped.get(r.mediaFileId);
      if (!g) {
        g = {
          mediaFileId: r.mediaFileId,
          filename: r.filename,
          sha256: r.fileHash,
          audioOssUrl: r.audioOssKey ? signAssetViewUrl(r.audioOssKey) : null,
          thumbnailUrl: r.thumbnailOssKey ? signAssetViewUrl(r.thumbnailOssKey) : null,
          videoOssUrl: r.videoOssKey ? signAssetViewUrl(r.videoOssKey) : null,
          backupStatus: r.backupStatus ?? 'local_only',
          fileSize: r.fileSize,
          duration: r.duration ?? null,
          status: r.status ?? 'processing',
          asrStatus: r.asrStatus ?? null,
          summary: r.summary ?? null,
          createdAt: r.createdAt,
          variants: [],
        };
        grouped.set(r.mediaFileId, g);
      }
      g.variants.push({
        projectId: r.projectId,
        projectTitle: r.projectTitle,
        projectAssetId: r.projectAssetId,
      });
    }

    return c.json(Array.from(grouped.values()));
  } catch (error) {
    console.error('❌ 获取素材库失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

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
        createdAt: projectAssets.createdAt,
        // from media_files (canonical per-content state)
        sha256: mediaFiles.fileHash,
        fileSize: mediaFiles.fileSize,
        duration: mediaFiles.duration,
        status: mediaFiles.status,
        asrStatus: mediaFiles.asrStatus,
        summary: mediaFiles.summary,
        audioOssKey: mediaFiles.audioOssKey,
        thumbnailOssKey: mediaFiles.thumbnailOssKey,
        videoOssKey: mediaFiles.videoOssKey,
        backupStatus: mediaFiles.backupStatus,
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

// POST /api/assets/preflight — hash-only dedup check before FFmpeg.
// Hit: creates project_assets pointing at the existing media_files row, returns
//   { dedupHit: true, assetId, mediaFileId, alreadyProcessed }.
//   Caller skips FFmpeg + uploads entirely.
// Miss: returns { dedupHit: false }. Caller must proceed to FFmpeg, then POST /api/assets.
app.post("/preflight", async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const { projectId, fileHash, filename } = body || {};
    if (!projectId || !fileHash || !filename) {
      return c.json({ error: 'projectId, fileHash, filename required' }, 400);
    }

    const [existing] = await db
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.userId, user.id), eq(mediaFiles.fileHash, fileHash)))
      .limit(1);

    if (!existing) {
      return c.json({ dedupHit: false });
    }

    const projectAssetId = crypto.randomUUID();
    await db.insert(projectAssets).values({
      id: projectAssetId,
      projectId,
      userId: user.id,
      mediaFileId: existing.id,
      filename,
    });

    const alreadyProcessed = existing.status === 'ready'
      && (existing.asrStatus === 'completed' || existing.asrStatus === 'skipped');
    return c.json({ dedupHit: true, assetId: projectAssetId, mediaFileId: existing.id, alreadyProcessed });
  } catch (error) {
    console.error('❌ 资产 preflight 失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

// POST /api/assets — pre-register + dedup by fileHash
// Returns { assetId, mediaFileId, alreadyProcessed }
app.post("/", async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const { projectId, fileHash, filename, fileSize, duration, asrStatus } = body || {};

    if (!projectId || !fileHash || !filename || typeof fileSize !== 'number') {
      return c.json({ error: 'projectId, fileHash, filename, fileSize required' }, 400);
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
    });

    return c.json({ assetId: projectAssetId, mediaFileId, alreadyProcessed });
  } catch (error) {
    console.error('❌ 资产预登记失败:', error);
    return c.json({ error: 'Database Insert Error' }, 500);
  }
});

// Note: the legacy `POST /api/assets/:id/relink` endpoint has been removed.
// Per-device path bindings now live in the desktop SQLite store
// (apps/desktop/src-tauri/src/local_db.rs); the desktop calls
// `local_assets_relink` directly via Tauri IPC.

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

// POST /api/assets/:mediaFileId/backup-status — Rust 在 PUT 之前/失败时上报。
// 仅允许 uploading / failed —— backed_up 唯一写入路径是 HMAC-verified oss-callback，
// 防客户端伪造已备份。
const backupStatusSchema = z.object({
  status: z.enum(['uploading', 'failed']),
});

app.post('/:mediaFileId/backup-status', async (c) => {
  const user = c.get('user');
  const mediaFileId = c.req.param('mediaFileId');
  const body = await c.req.json().catch(() => null);
  const parsed = backupStatusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid', issues: parsed.error.issues }, 400);
  }

  const result = await db
    .update(mediaFiles)
    .set({ backupStatus: parsed.data.status })
    .where(and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.userId, user.id)));

  // mysql2 returns [ResultSetHeader, undefined]; affectedRows surfaces on header
  const affected = (result as any)?.[0]?.affectedRows ?? 0;
  if (affected === 0) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json({ success: true });
});

// POST /api/assets/:mediaFileId/unbackup —— 用户主动取消云备份。
//
// 跨用户引用计数：video-backup 的 OSS object key 是 hash-derived (assets/by-hash/{sha256}.{ext})，
// 多个用户备份同一份内容时共享一个 OSS 对象。本 endpoint 先清掉本用户的 videoOssKey/backupStatus，
// 再扫一遍是否还有其它用户在同一 fileHash 上保留 videoOssKey；都没有时才真正删 OSS。
//
// 失败模式：DB 永远先一致地清理；若 OSS DELETE 因网络/权限失败，留下 orphan 由后续 sweep 回收，
// 不让 endpoint 整体失败（用户 UI 已经按 local_only 显示）。
app.post('/:mediaFileId/unbackup', async (c) => {
  const user = c.get('user');
  const mediaFileId = c.req.param('mediaFileId');

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        fileHash: mediaFiles.fileHash,
        videoOssKey: mediaFiles.videoOssKey,
      })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.userId, user.id)))
      .limit(1);
    if (!row) return { found: false as const };

    await tx
      .update(mediaFiles)
      .set({ videoOssKey: null, backupStatus: 'local_only' })
      .where(and(eq(mediaFiles.id, mediaFileId), eq(mediaFiles.userId, user.id)));

    // 是否还有其它 media_files 行在同一 hash 上挂着 videoOssKey
    const stillReferenced = await tx
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(and(
        eq(mediaFiles.fileHash, row.fileHash),
        isNotNull(mediaFiles.videoOssKey),
        ne(mediaFiles.id, mediaFileId),
      ))
      .limit(1);

    return {
      found: true as const,
      isLastReferrer: row.videoOssKey != null && stillReferenced.length === 0,
      ossKey: row.videoOssKey,
    };
  });

  if (!result.found) {
    return c.json({ error: 'Not found' }, 404);
  }

  let ossDeleted = false;
  if (result.isLastReferrer && result.ossKey) {
    try {
      await deleteAsset(result.ossKey);
      ossDeleted = true;
    } catch (e) {
      // DB is already consistent; orphaned object can be swept later.
      console.error('[unbackup] OSS delete failed, leaving orphan:', result.ossKey, e);
    }
  }

  return c.json({ success: true, ossDeleted });
});

export default app;
