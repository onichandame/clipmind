import { Hono } from "hono";
import { z } from "zod";
import { editingPlans, mediaFiles, projectAssets, projects, userMediaFiles } from "@clipmind/db";
import { desc, eq, and, ne, sql } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { signAssetViewUrl, signUploadUrl, copyAsset, deleteAssets, headAsset } from "../utils/oss";
import { deleteVectorsByAssetId, QDRANT_SUMMARY_COLLECTION } from "../utils/qdrant";
import { requireAuth } from "../middleware/auth";
import { serverConfig } from "../env";
import { submitAliyunAsrTask } from "../utils/aliyun-asr";
import { completeAssetWithoutTranscript } from "../logic/asset-processor";
import { withFileHashLock } from "../utils/import-locks";

const app = new Hono();

app.use('*', requireAuth);

const IMPORT_TOKEN_TTL_SECONDS = 60 * 60;
const IMPORT_TOKEN_VERSION = 1;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

type ImportFinalizePayload = {
  v: number;
  userId: string;
  fileHash: string;
  hasAudio: boolean;
  audioTempKey?: string;
  thumbnailTempKey: string;
  iat: number;
  nonce: string;
};

function signImportFinalizePayload(payload: ImportFinalizePayload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', serverConfig.WEBHOOK_HMAC_SECRET).update(`import:${body}`).digest('base64url');
  return `${body}.${sig}`;
}

function verifyImportFinalizeToken(token: string): ImportFinalizePayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', serverConfig.WEBHOOK_HMAC_SECRET).update(`import:${body}`).digest('base64url');
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ImportFinalizePayload;
    const now = Math.floor(Date.now() / 1000);
    if (parsed.v !== IMPORT_TOKEN_VERSION) return null;
    if (now - parsed.iat > IMPORT_TOKEN_TTL_SECONDS || parsed.iat - now > 60) return null;
    if (!sha256Schema.safeParse(parsed.fileHash).success) return null;
    if (typeof parsed.userId !== 'string' || typeof parsed.thumbnailTempKey !== 'string') return null;
    if (typeof parsed.hasAudio !== 'boolean') return null;
    if (parsed.hasAudio && typeof parsed.audioTempKey !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isReusableProcessingMedia(row: {
  status: string | null;
  thumbnailOssKey?: string | null;
  processingStage?: string | null;
  asrTaskId?: string | null;
}) {
  if (row.status !== 'processing') return false;
  if (!row.thumbnailOssKey) return false;
  return (row.processingStage === 'asr' || row.processingStage === 'embedding') && !!row.asrTaskId;
}

function isReusableExistingMedia(row: {
  status: string | null;
  thumbnailOssKey?: string | null;
  processingStage?: string | null;
  asrTaskId?: string | null;
}) {
  return row.status === 'ready' || isReusableProcessingMedia(row);
}

async function ensureProjectOwned(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return !!project;
}

async function createUserMediaFile(userId: string, mediaFileId: string, filename: string) {
  const [existing] = await db
    .select({ id: userMediaFiles.id })
    .from(userMediaFiles)
    .where(and(eq(userMediaFiles.userId, userId), eq(userMediaFiles.mediaFileId, mediaFileId)))
    .limit(1);
  if (existing) return existing.id;

  const userMediaFileId = crypto.randomUUID();
  try {
    await db.insert(userMediaFiles).values({
      id: userMediaFileId,
      userId,
      mediaFileId,
      filename,
    });
  } catch (error: any) {
    const msg = String(error?.code || error?.message || '');
    if (!msg.includes('ER_DUP_ENTRY') && !msg.includes('Duplicate')) throw error;
    const [winner] = await db
      .select({ id: userMediaFiles.id })
      .from(userMediaFiles)
      .where(and(eq(userMediaFiles.userId, userId), eq(userMediaFiles.mediaFileId, mediaFileId)))
      .limit(1);
    if (!winner) throw error;
    return winner.id;
  }
  return userMediaFileId;
}

async function createProjectAsset(projectId: string, userId: string, userMediaFileId: string, filename: string) {
  return db.transaction(async (tx) => {
    // Lock the owning project row until commit; this serializes concurrent
    // project_asset creation for the same project without deleting historical
    // duplicate rows that saved JSON may still reference.
    await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${userId} FOR UPDATE`);

      const [existing] = await tx
        .select({ id: projectAssets.id })
        .from(projectAssets)
        .where(and(
          eq(projectAssets.projectId, projectId),
          eq(projectAssets.userId, userId),
          eq(projectAssets.userMediaFileId, userMediaFileId),
        ))
        .limit(1);
      if (existing) return existing.id;

      const projectAssetId = crypto.randomUUID();
      try {
        await tx.insert(projectAssets).values({
          id: projectAssetId,
          projectId,
          userId,
          userMediaFileId,
          filename,
        });
      } catch (error: any) {
        const msg = String(error?.code || error?.message || '');
        if (!msg.includes('ER_DUP_ENTRY') && !msg.includes('Duplicate')) throw error;
        const [winner] = await tx
          .select({ id: projectAssets.id })
          .from(projectAssets)
          .where(and(
            eq(projectAssets.projectId, projectId),
            eq(projectAssets.userId, userId),
            eq(projectAssets.userMediaFileId, userMediaFileId),
          ))
          .limit(1);
        if (!winner) throw error;
        return winner.id;
      }
      return projectAssetId;
  });
}

async function assertTempArtifactsExist(token: ImportFinalizePayload) {
  const thumbHeaders = await headAsset(token.thumbnailTempKey);
  const thumbSize = Number(thumbHeaders['content-length'] ?? 0);
  if (!Number.isFinite(thumbSize) || thumbSize <= 0 || thumbSize > 10 * 1024 * 1024) {
    throw new Error('Invalid thumbnail temp object size');
  }
  if (token.hasAudio) {
    if (!token.audioTempKey) throw new Error('finalize token missing audio temp key');
    const audioHeaders = await headAsset(token.audioTempKey);
    const audioSize = Number(audioHeaders['content-length'] ?? 0);
    if (!Number.isFinite(audioSize) || audioSize <= 0 || audioSize > 200 * 1024 * 1024) {
      throw new Error('Invalid audio temp object size');
    }
  }
}

async function markMediaFailed(mediaFileId: string, failureStage: string, error: unknown) {
  await db.update(mediaFiles).set({
    status: 'failed',
    processingStage: null,
    failureStage,
    failureReason: error instanceof Error ? error.message : String(error),
  }).where(eq(mediaFiles.id, mediaFileId));
}

type ProjectUsageVariant = {
  projectId: string;
  projectTitle: string;
  projectAssetId?: string;
};

function addProjectUsage(
  usage: Map<string, ProjectUsageVariant[]>,
  userMediaFileId: string,
  variant: ProjectUsageVariant,
) {
  const variants = usage.get(userMediaFileId) ?? [];
  if (!variants.some((v) => v.projectId === variant.projectId)) {
    variants.push(variant);
    usage.set(userMediaFileId, variants);
  }
}

function assetIdReferencesUserMedia(assetId: unknown, userMediaFileId: string, legacyProjectAssetIds: Set<string>) {
  return assetId === userMediaFileId || (typeof assetId === 'string' && legacyProjectAssetIds.has(assetId));
}

function projectJsonReferencesUserMedia(
  project: { selectedAssetIds: any; retrievedAssetIds: any; retrievedClips?: any },
  userMediaFileId: string,
  legacyProjectAssetIds = new Set<string>(),
) {
  const selectedAssetIds = Array.isArray(project.selectedAssetIds) ? project.selectedAssetIds : [];
  const retrievedAssetIds = Array.isArray(project.retrievedAssetIds) ? project.retrievedAssetIds : [];
  const retrievedClipAssetIds = Array.isArray(project.retrievedClips)
    ? project.retrievedClips.map((clip: any) => clip?.assetId)
    : [];
  return [...selectedAssetIds, ...retrievedAssetIds, ...retrievedClipAssetIds]
    .some((assetId) => assetIdReferencesUserMedia(assetId, userMediaFileId, legacyProjectAssetIds));
}

function planReferencesUserMedia(plan: { clips: any }, userMediaFileId: string, legacyProjectAssetIds = new Set<string>()) {
  return Array.isArray(plan.clips)
    && plan.clips.some((clip: any) => assetIdReferencesUserMedia(clip?.assetId, userMediaFileId, legacyProjectAssetIds));
}

async function loadUserMediaProjectUsages(userId: string) {
  const usage = new Map<string, ProjectUsageVariant[]>();

  const legacyRows = await db
    .select({
      userMediaFileId: projectAssets.userMediaFileId,
      projectAssetId: projectAssets.id,
      projectId: projectAssets.projectId,
      projectTitle: projects.title,
    })
    .from(projectAssets)
    .innerJoin(projects, eq(projects.id, projectAssets.projectId))
    .innerJoin(userMediaFiles, eq(userMediaFiles.id, projectAssets.userMediaFileId))
    .where(and(eq(projectAssets.userId, userId), eq(userMediaFiles.userId, userId)));
  const legacyIdToUserMediaId = new Map(legacyRows.map((row) => [row.projectAssetId, row.userMediaFileId]));
  const legacyRowById = new Map(legacyRows.map((row) => [row.projectAssetId, row]));

  const projectRows = await db
    .select({
      id: projects.id,
      title: projects.title,
      selectedAssetIds: projects.selectedAssetIds,
      retrievedAssetIds: projects.retrievedAssetIds,
      retrievedClips: projects.retrievedClips,
    })
    .from(projects)
    .where(eq(projects.userId, userId));
  for (const project of projectRows) {
    const ids = [
      ...(Array.isArray(project.selectedAssetIds) ? project.selectedAssetIds : []),
      ...(Array.isArray(project.retrievedAssetIds) ? project.retrievedAssetIds : []),
      ...(Array.isArray(project.retrievedClips) ? project.retrievedClips.map((clip: any) => clip?.assetId) : []),
    ];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      addProjectUsage(usage, legacyIdToUserMediaId.get(id) ?? id, {
        projectId: project.id,
        projectTitle: project.title ?? '未命名项目',
      });
    }
  }

  const planRows = await db
    .select({
      projectId: editingPlans.projectId,
      projectTitle: projects.title,
      clips: editingPlans.clips,
    })
    .from(editingPlans)
    .innerJoin(projects, eq(projects.id, editingPlans.projectId))
    .where(eq(projects.userId, userId));
  for (const plan of planRows) {
    if (!Array.isArray(plan.clips)) continue;
    for (const clip of plan.clips) {
      const assetId = clip?.assetId;
      if (typeof assetId !== 'string') continue;
      const userMediaFileId = legacyIdToUserMediaId.get(assetId) ?? assetId;
      const legacyRow = legacyRowById.get(assetId);
      addProjectUsage(usage, userMediaFileId, {
        projectId: plan.projectId,
        projectTitle: plan.projectTitle ?? '未命名项目',
        projectAssetId: legacyRow?.projectAssetId,
      });
    }
  }

  return usage;
}

// GET /api/assets/library — list all user-library media rows along with which
// projects use each one. The underlying media_files row stays global and
// deduped by file hash.
app.get("/library", async (c) => {
  const user = c.get('user');
  try {
    const rows = await db
      .select({
        userMediaFileId: userMediaFiles.id,
        filename: userMediaFiles.filename,
        userMediaCreatedAt: userMediaFiles.createdAt,
        // media_files fields (canonical, per-content)
        mediaFileId: mediaFiles.id,
        fileHash: mediaFiles.fileHash,
        fileSize: mediaFiles.fileSize,
        duration: mediaFiles.duration,
        status: mediaFiles.status,
        transcriptKind: mediaFiles.transcriptKind,
        processingStage: mediaFiles.processingStage,
        failureStage: mediaFiles.failureStage,
        failureReason: mediaFiles.failureReason,
        summary: mediaFiles.summary,
        audioOssKey: mediaFiles.audioOssKey,
        thumbnailOssKey: mediaFiles.thumbnailOssKey,
        videoOssKey: mediaFiles.videoOssKey,
        backupStatus: mediaFiles.backupStatus,
        createdAt: mediaFiles.createdAt,
      })
      .from(userMediaFiles)
      .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
      .where(eq(userMediaFiles.userId, user.id))
      .orderBy(desc(userMediaFiles.createdAt));
    const usageByUserMediaFile = await loadUserMediaProjectUsages(user.id);

    // Each user-library row may be referenced by multiple projects via project
    // JSON fields or editing plans. Backup state lives on media_files
    // (per-content, shared across projects); variants only carry project usage.
    type Variant = {
      projectId: string;
      projectTitle: string;
      projectAssetId?: string;
    };
    type MediaGroup = {
      userMediaFileId: string;
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
      transcriptKind: string | null;
      processingStage: string | null;
      failureStage: string | null;
      failureReason: string | null;
      summary: string | null;
      createdAt: Date;
      variants: Variant[];
    };

    const grouped = new Map<string, MediaGroup>();
    for (const r of rows) {
      let g = grouped.get(r.userMediaFileId);
      if (!g) {
        g = {
          userMediaFileId: r.userMediaFileId,
          mediaFileId: r.mediaFileId,
          filename: r.filename,
          sha256: r.fileHash,
          audioOssUrl: r.audioOssKey ? signAssetViewUrl(r.audioOssKey) : null,
          thumbnailUrl: r.thumbnailOssKey ? signAssetViewUrl(r.thumbnailOssKey) : null,
          videoOssUrl: r.backupStatus === 'backed_up' && r.videoOssKey ? signAssetViewUrl(r.videoOssKey) : null,
          backupStatus: r.backupStatus ?? 'local_only',
          fileSize: r.fileSize,
          duration: r.duration ?? null,
          status: r.status ?? 'processing',
          transcriptKind: r.transcriptKind ?? null,
          processingStage: r.processingStage ?? null,
          failureStage: r.failureStage ?? null,
          failureReason: r.failureReason ?? null,
          summary: r.summary ?? null,
          createdAt: r.userMediaCreatedAt,
          variants: [],
        };
        grouped.set(r.userMediaFileId, g);
      }
      g.variants = usageByUserMediaFile.get(r.userMediaFileId) ?? [];
    }

    return c.json(Array.from(grouped.values()));
  } catch (error) {
    console.error('❌ 获取素材库失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

// GET /api/assets — list the current user's full material library for project chat.
// project_assets still exist for legacy project references, but this read path
// exposes user_media_files as the selectable material identity.
app.get("/", async (c) => {
  const user = c.get('user');
  const projectId = c.req.query('projectId');
  try {
    const selectFields = {
      id: userMediaFiles.id,
      userMediaFileId: userMediaFiles.id,
      mediaFileId: userMediaFiles.mediaFileId,
      filename: userMediaFiles.filename,
      createdAt: userMediaFiles.createdAt,
      // from media_files (canonical per-content state)
      sha256: mediaFiles.fileHash,
      fileSize: mediaFiles.fileSize,
      duration: mediaFiles.duration,
      status: mediaFiles.status,
      transcriptKind: mediaFiles.transcriptKind,
      processingStage: mediaFiles.processingStage,
      failureStage: mediaFiles.failureStage,
      failureReason: mediaFiles.failureReason,
      summary: mediaFiles.summary,
      audioOssKey: mediaFiles.audioOssKey,
      thumbnailOssKey: mediaFiles.thumbnailOssKey,
      videoOssKey: mediaFiles.videoOssKey,
      backupStatus: mediaFiles.backupStatus,
    };
    const rows = projectId
      ? await db
        .select({ ...selectFields, projectAssetId: projectAssets.id })
        .from(userMediaFiles)
        .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
        .leftJoin(projectAssets, and(
          eq(projectAssets.userMediaFileId, userMediaFiles.id),
          eq(projectAssets.userId, user.id),
          eq(projectAssets.projectId, projectId),
        ))
        .where(eq(userMediaFiles.userId, user.id))
        .orderBy(desc(userMediaFiles.createdAt))
      : await db
        .select({ ...selectFields, projectAssetId: sql<string | null>`NULL` })
        .from(userMediaFiles)
        .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
        .where(eq(userMediaFiles.userId, user.id))
        .orderBy(desc(userMediaFiles.createdAt));

    const mapped = rows.map(row => ({
      ...row,
      projectAssetIds: row.projectAssetId ? [row.projectAssetId] : [],
      videoOssUrl: row.backupStatus === 'backed_up' && row.videoOssKey ? signAssetViewUrl(row.videoOssKey) : null,
      audioOssUrl: row.audioOssKey ? signAssetViewUrl(row.audioOssKey) : null,
      thumbnailUrl: row.thumbnailOssKey ? signAssetViewUrl(row.thumbnailOssKey) : null,
    }));

    const deduped = new Map<string, (typeof mapped)[number]>();
    for (const row of mapped) {
      const existing = deduped.get(row.userMediaFileId);
      if (!existing) {
        deduped.set(row.userMediaFileId, row);
        continue;
      }
      if (row.projectAssetId && !existing.projectAssetIds.includes(row.projectAssetId)) {
        existing.projectAssetIds.push(row.projectAssetId);
      }
      if (!existing.projectAssetId && row.projectAssetId) {
        existing.projectAssetId = row.projectAssetId;
      }
    }

    return c.json(Array.from(deduped.values()));
  } catch (error) {
    console.error('❌ 获取用户素材列表失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

// POST /api/assets/preflight — read-only hash check before FFmpeg.
// Failed rows deliberately return dedupHit=false so the desktop retries processing
// against the same global media_files row during finalize.
app.post("/preflight", async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const parsed = z.object({
      projectId: z.string().uuid().optional(),
      fileHash: sha256Schema,
      filename: z.string().min(1).max(255),
    }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    }
    const { projectId, fileHash } = parsed.data;
    if (projectId && !(await ensureProjectOwned(projectId, user.id))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const [existing] = await db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.fileHash, fileHash))
      .limit(1);

    if (!existing) {
      return c.json({ dedupHit: false });
    }

    const [owned] = await db
      .select({ id: userMediaFiles.id })
      .from(userMediaFiles)
      .where(and(eq(userMediaFiles.userId, user.id), eq(userMediaFiles.mediaFileId, existing.id)))
      .limit(1);

    return c.json({
      dedupHit: !!owned && isReusableExistingMedia(existing),
      mediaFileId: existing.id,
      status: existing.status,
      alreadyProcessed: existing.status === 'ready',
    });
  } catch (error) {
    console.error('❌ 资产 preflight 失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

const attachSchema = z.object({
  projectId: z.string().uuid().optional(),
  fileHash: sha256Schema,
  filename: z.string().min(1).max(255),
});

// POST /api/assets/attach — attach an existing ready/processing global media row
// to the user's library, and optionally to a project.
app.post("/attach", async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const parsed = attachSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const { projectId, fileHash, filename } = parsed.data;
    if (projectId && !(await ensureProjectOwned(projectId, user.id))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const [existing] = await db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.fileHash, fileHash))
      .limit(1);
    let owned: { id: string } | null = null;
    if (existing) {
      [owned] = await db
        .select({ id: userMediaFiles.id })
        .from(userMediaFiles)
        .where(and(eq(userMediaFiles.userId, user.id), eq(userMediaFiles.mediaFileId, existing.id)))
        .limit(1);
    }
    if (!existing || !owned || !isReusableExistingMedia(existing)) {
      return c.json({ error: 'No attachable media for hash' }, 404);
    }
    const userMediaFileId = owned.id;
    const assetId = projectId
      ? await createProjectAsset(projectId, user.id, userMediaFileId, filename)
      : null;
    return c.json({ assetId, userMediaFileId, mediaFileId: existing.id, alreadyProcessed: existing.status === 'ready' });
  } catch (error) {
    console.error('❌ 资产 attach 失败:', error);
    return c.json({ error: 'Database Error' }, 500);
  }
});

const importTokenSchema = z.object({
  fileHash: sha256Schema,
  hasAudio: z.boolean(),
});

app.post('/import-token', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = importTokenSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  const { fileHash, hasAudio } = parsed.data;
  const nonce = randomBytes(12).toString('base64url');
  const tempPrefix = `assets/tmp/import/${user.id}/${fileHash}/${nonce}`;
  const thumbnailTempKey = `${tempPrefix}/thumb.jpg`;
  const audioTempKey = hasAudio ? `${tempPrefix}/audio.aac` : undefined;
  const payload: ImportFinalizePayload = {
    v: IMPORT_TOKEN_VERSION,
    userId: user.id,
    fileHash,
    hasAudio,
    audioTempKey,
    thumbnailTempKey,
    iat: Math.floor(Date.now() / 1000),
    nonce,
  };

  return c.json({
    finalizeToken: signImportFinalizePayload(payload),
    thumbnail: {
      uploadUrl: signUploadUrl(thumbnailTempKey, 'image/jpeg'),
      objectKey: thumbnailTempKey,
      contentType: 'image/jpeg',
    },
    audio: audioTempKey ? {
      uploadUrl: signUploadUrl(audioTempKey, 'audio/aac'),
      objectKey: audioTempKey,
      contentType: 'audio/aac',
    } : null,
  });
});

const finalizeSchema = z.object({
  projectId: z.string().uuid().optional(),
  fileHash: sha256Schema,
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative().nullable().optional(),
  hasAudio: z.boolean(),
  finalizeToken: z.string().min(1),
});

app.post('/finalize', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  const input = parsed.data;
  if (input.projectId && !(await ensureProjectOwned(input.projectId, user.id))) {
    return c.json({ error: 'Project not found' }, 404);
  }
  const token = verifyImportFinalizeToken(input.finalizeToken);
  if (!token || token.userId !== user.id || token.fileHash !== input.fileHash || token.hasAudio !== input.hasAudio) {
    return c.json({ error: 'Invalid finalize token' }, 401);
  }

  try {
    await assertTempArtifactsExist(token);
    const result = await withFileHashLock(input.fileHash, async () => {
      const [existing] = await db.select().from(mediaFiles).where(eq(mediaFiles.fileHash, input.fileHash)).limit(1);
      if (existing && isReusableExistingMedia(existing)) {
        const userMediaFileId = await createUserMediaFile(user.id, existing.id, input.filename);
        const assetId = input.projectId
          ? await createProjectAsset(input.projectId, user.id, userMediaFileId, input.filename)
          : null;
        deleteAssets([token.thumbnailTempKey, token.audioTempKey]).catch((e) => console.error('[assets/finalize] temp cleanup failed:', e));
        return { assetId, userMediaFileId, mediaFileId: existing.id, alreadyProcessed: existing.status === 'ready' };
      }

      let mediaFileId = existing?.id ?? crypto.randomUUID();
      if (existing) {
        await db.update(mediaFiles).set({
          fileSize: input.fileSize,
          duration: input.duration ?? null,
          status: 'processing',
          asrTaskId: null,
          transcriptKind: null,
          processingStage: 'thumbnail',
          failureStage: null,
          failureReason: null,
          summary: null,
          audioOssKey: null,
          thumbnailOssKey: null,
        }).where(eq(mediaFiles.id, mediaFileId));
      } else {
        try {
          await db.insert(mediaFiles).values({
            id: mediaFileId,
            fileHash: input.fileHash,
            fileSize: input.fileSize,
            duration: input.duration ?? null,
            status: 'processing',
            processingStage: 'thumbnail',
            backupStatus: 'local_only',
          });
        } catch (e: any) {
          const msg = String(e?.code || e?.message || '');
          if (!msg.includes('ER_DUP_ENTRY') && !msg.includes('Duplicate')) throw e;
          const [winner] = await db.select().from(mediaFiles).where(eq(mediaFiles.fileHash, input.fileHash)).limit(1);
          if (!winner) throw e;
          if (isReusableExistingMedia(winner)) {
            const userMediaFileId = await createUserMediaFile(user.id, winner.id, input.filename);
            const assetId = input.projectId
              ? await createProjectAsset(input.projectId, user.id, userMediaFileId, input.filename)
              : null;
            deleteAssets([token.thumbnailTempKey, token.audioTempKey]).catch((err) => console.error('[assets/finalize] temp cleanup failed:', err));
            return { assetId, userMediaFileId, mediaFileId: winner.id, alreadyProcessed: winner.status === 'ready' };
          }
          mediaFileId = winner.id;
          await db.update(mediaFiles).set({
            fileSize: input.fileSize,
            duration: input.duration ?? null,
            status: 'processing',
            asrTaskId: null,
            transcriptKind: null,
            processingStage: 'thumbnail',
            failureStage: null,
            failureReason: null,
            summary: null,
            audioOssKey: null,
            thumbnailOssKey: null,
          }).where(eq(mediaFiles.id, mediaFileId));
        }
      }

      const userMediaFileId = await createUserMediaFile(user.id, mediaFileId, input.filename);
      const assetId = input.projectId
        ? await createProjectAsset(input.projectId, user.id, userMediaFileId, input.filename)
        : null;
      const thumbnailOssKey = `assets/${mediaFileId}/thumb.jpg`;
      const audioOssKey = `assets/${mediaFileId}/audio.aac`;

      try {
        await assertTempArtifactsExist(token);
        try {
          await copyAsset(thumbnailOssKey, token.thumbnailTempKey);
        } catch (error) {
          await markMediaFailed(mediaFileId, 'thumbnail', error);
          throw error;
        }
        await db.update(mediaFiles).set({ thumbnailOssKey, processingStage: input.hasAudio ? 'upload' : 'processing' }).where(eq(mediaFiles.id, mediaFileId));

        if (input.hasAudio) {
          if (!token.audioTempKey) throw new Error('finalize token missing audio temp key');
          try {
            await copyAsset(audioOssKey, token.audioTempKey);
          } catch (error) {
            await markMediaFailed(mediaFileId, 'upload', error);
            throw error;
          }
          await db.update(mediaFiles).set({ audioOssKey, processingStage: 'asr' }).where(eq(mediaFiles.id, mediaFileId));
          await submitAliyunAsrTask(mediaFileId, audioOssKey);
        } else {
          await completeAssetWithoutTranscript(mediaFileId, undefined, 'skipped');
        }
      } catch (error) {
        throw error;
      } finally {
        deleteAssets([token.thumbnailTempKey, token.audioTempKey]).catch((e) => console.error('[assets/finalize] temp cleanup failed:', e));
      }

      return { assetId, userMediaFileId, mediaFileId, alreadyProcessed: false };
    });

    return c.json(result);
  } catch (error) {
    console.error('❌ 资产 finalize 失败:', error);
    return c.json({ error: 'Finalize failed' }, 500);
  }
});

app.post('/', async (c) => {
  return c.json({ error: 'Legacy asset create path is closed; use /api/assets/finalize' }, 410);
});

// Note: the legacy `POST /api/assets/:id/relink` endpoint has been removed.
// Per-device path bindings now live in the desktop SQLite store
// (apps/desktop/src-tauri/src/local_db.rs); the desktop calls
// `local_assets_relink` directly via Tauri IPC.

// DELETE /api/assets/library/:id — delete a user-library material. It is blocked
// while any project still references it. If this was the last user-library ref,
// clean up the global media_files row as well.
app.delete('/library/:id', async (c) => {
  const user = c.get('user');
  try {
    const id = c.req.param('id');
    const result = await db.transaction(async (tx) => {
      const [umf] = await tx
        .select({
          mediaFileId: userMediaFiles.mediaFileId,
          audioOssKey: mediaFiles.audioOssKey,
          thumbnailOssKey: mediaFiles.thumbnailOssKey,
          videoOssKey: mediaFiles.videoOssKey,
        })
        .from(userMediaFiles)
        .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
        .where(and(eq(userMediaFiles.id, id), eq(userMediaFiles.userId, user.id)))
        .limit(1);
      if (!umf) return { found: false as const };

      const legacyProjectAssetRows = await tx
        .select({ id: projectAssets.id })
        .from(projectAssets)
        .where(and(eq(projectAssets.userMediaFileId, id), eq(projectAssets.userId, user.id)));
      const legacyProjectAssetIds = new Set(legacyProjectAssetRows.map((row) => row.id));

      const projectRows = await tx
        .select({
          selectedAssetIds: projects.selectedAssetIds,
          retrievedAssetIds: projects.retrievedAssetIds,
          retrievedClips: projects.retrievedClips,
        })
        .from(projects)
        .where(eq(projects.userId, user.id));
      if (projectRows.some((project) => projectJsonReferencesUserMedia(project, id, legacyProjectAssetIds))) {
        return { found: true as const, blocked: true as const };
      }

      const planRows = await tx
        .select({ clips: editingPlans.clips })
        .from(editingPlans)
        .innerJoin(projects, eq(projects.id, editingPlans.projectId))
        .where(eq(projects.userId, user.id));
      if (planRows.some((plan) => planReferencesUserMedia(plan, id, legacyProjectAssetIds))) {
        return { found: true as const, blocked: true as const };
      }

      await tx.delete(projectAssets).where(and(eq(projectAssets.userMediaFileId, id), eq(projectAssets.userId, user.id)));
      await tx.delete(userMediaFiles).where(and(eq(userMediaFiles.id, id), eq(userMediaFiles.userId, user.id)));

      const [remainingUserRef] = await tx
        .select({ id: userMediaFiles.id })
        .from(userMediaFiles)
        .where(eq(userMediaFiles.mediaFileId, umf.mediaFileId))
        .limit(1);
      if (!remainingUserRef) {
        await tx.delete(mediaFiles).where(eq(mediaFiles.id, umf.mediaFileId));
        return {
          found: true as const,
          blocked: false as const,
          deletedMediaFileId: umf.mediaFileId,
          deletedOssKeys: [umf.audioOssKey, umf.thumbnailOssKey, umf.videoOssKey],
        };
      }
      return { found: true as const, blocked: false as const, deletedMediaFileId: null, deletedOssKeys: [] };
    });

    if (!result.found) {
      return c.json({ error: 'Asset not found' }, 404);
    }
    if (result.blocked) {
      return c.json({ error: 'Asset is still used by projects' }, 409);
    }
    if (result.deletedMediaFileId) {
      deleteAssets(result.deletedOssKeys).catch(e =>
        console.error(`❌ [OSS] 清理 ${result.deletedMediaFileId} 底层对象失败:`, e));
      deleteVectorsByAssetId(result.deletedMediaFileId).catch(e =>
        console.error(`❌ [Qdrant] 清理 ${result.deletedMediaFileId} chunks 向量失败:`, e));
      deleteVectorsByAssetId(result.deletedMediaFileId, QDRANT_SUMMARY_COLLECTION).catch(e =>
        console.error(`❌ [Qdrant] 清理 ${result.deletedMediaFileId} summary 向量失败:`, e));
    }
    return c.json({ success: true, deletedMedia: !!result.deletedMediaFileId });
  } catch (error) {
    console.error('❌ 删除素材库资产失败:', error);
    return c.json({ error: 'Database Delete Error' }, 500);
  }
});

// DELETE /api/assets/:id — delete only the project_asset reference. The user's
// library material and global media_file are intentionally retained.
app.delete("/:id", async (c) => {
  const user = c.get('user');
  try {
    const id = c.req.param("id");
    const result = await db.transaction(async (tx) => {
      const [pa] = await tx
        .select({ id: projectAssets.id, projectId: projectAssets.projectId })
        .from(projectAssets)
        .where(and(eq(projectAssets.id, id), eq(projectAssets.userId, user.id)))
        .limit(1);

      if (!pa) return { found: false as const };

      const [project] = await tx
        .select({
          selectedAssetIds: projects.selectedAssetIds,
          retrievedAssetIds: projects.retrievedAssetIds,
          retrievedClips: projects.retrievedClips,
        })
        .from(projects)
        .where(and(eq(projects.id, pa.projectId), eq(projects.userId, user.id)))
        .limit(1);
      if (project) {
        const planRows = await tx
          .select({ id: editingPlans.id, clips: editingPlans.clips })
          .from(editingPlans)
          .where(eq(editingPlans.projectId, pa.projectId));
        if (planRows.some((plan) => planReferencesUserMedia(plan, id))) {
          return { found: true as const, blocked: true as const };
        }

        const selectedAssetIds = Array.isArray(project.selectedAssetIds)
          ? project.selectedAssetIds.filter((assetId) => assetId !== id)
          : [];
        const retrievedAssetIds = Array.isArray(project.retrievedAssetIds)
          ? project.retrievedAssetIds.filter((assetId) => assetId !== id)
          : [];
        const retrievedClips = Array.isArray(project.retrievedClips)
          ? project.retrievedClips.filter((clip: any) => clip?.assetId !== id)
          : [];
        await tx.update(projects).set({ selectedAssetIds, retrievedAssetIds, retrievedClips }).where(eq(projects.id, pa.projectId));
      }
      await tx.delete(projectAssets).where(and(eq(projectAssets.id, id), eq(projectAssets.userId, user.id)));
      return { found: true as const };
    });

    if (!result.found) {
      return c.json({ error: 'Asset not found' }, 404);
    }
    if (result.blocked) {
      return c.json({ error: 'Asset is still used by editing plans' }, 409);
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

  const [owned] = await db
    .select({ backupStatus: mediaFiles.backupStatus })
    .from(userMediaFiles)
    .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
    .where(and(eq(userMediaFiles.mediaFileId, mediaFileId), eq(userMediaFiles.userId, user.id)))
    .limit(1);
  if (!owned) return c.json({ error: 'Not found' }, 404);
  if (owned.backupStatus === 'backed_up') {
    return c.json({ success: true });
  }

  const result = await db
    .update(mediaFiles)
    .set({ backupStatus: parsed.data.status })
    .where(and(eq(mediaFiles.id, mediaFileId), ne(mediaFiles.backupStatus, 'backed_up')));

  // mysql2 returns [ResultSetHeader, undefined]; affectedRows surfaces on header
  const affected = (result as any)?.[0]?.affectedRows ?? 0;
  if (affected === 0) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json({ success: true });
});

// POST /api/assets/:mediaFileId/unbackup —— disabled for global media_files.
// Backup state is now per-content, not per-user; clearing it here would remove
// cloud availability for every project/user attached to the same hash.
app.post('/:mediaFileId/unbackup', async (c) => {
  const user = c.get('user');
  const mediaFileId = c.req.param('mediaFileId');
  const [owned] = await db
    .select({ mediaFileId: userMediaFiles.mediaFileId })
    .from(userMediaFiles)
    .where(and(eq(userMediaFiles.mediaFileId, mediaFileId), eq(userMediaFiles.userId, user.id)))
    .limit(1);

  if (!owned) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json({ success: true, disabled: true, ossDeleted: false });
});

export default app;
