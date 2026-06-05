import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db';
import { mediaFiles, projectAssets } from '@clipmind/db/schema';
import { headAsset, signUploadUrl } from '../utils/oss';
import { signWebhookPayload, newNonce } from '../utils/auth';
import { requireAuth } from '../middleware/auth';

const app = new Hono();

app.use('*', requireAuth);

const tokenSchema = z.object({
  kind: z.enum(['audio', 'thumbnail', 'video-backup']),
  assetId: z.string().uuid(),
  filename: z.string().min(1).max(255),
});

const KIND_TO_KEY: Record<z.infer<typeof tokenSchema>['kind'], (assetId: string, ext: string) => string> = {
  audio: (id) => `assets/${id}/audio.aac`,
  thumbnail: (id) => `assets/${id}/thumb.jpg`,
  'video-backup': (id, ext) => `assets/${id}/video.${ext || 'mp4'}`,
};

const KIND_CONTENT_TYPE: Record<z.infer<typeof tokenSchema>['kind'], (filename: string) => string> = {
  audio: () => 'audio/aac',
  thumbnail: () => 'image/jpeg',
  'video-backup': (fn) => {
    const ext = (fn.split('.').pop() || 'mp4').toLowerCase();
    return ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  },
};

function isMissingOssObject(error: unknown) {
  const anyError = error as any;
  return anyError?.status === 404
    || anyError?.code === 'NoSuchKey'
    || String(anyError?.message || '').includes('NoSuchKey');
}

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }
  const { kind, assetId, filename } = parsed.data;

  if (kind !== 'video-backup') {
    return c.json({ error: 'Legacy import upload-token path is closed; use /api/assets/import-token' }, 410);
  }

  // media_files is global; user ownership is proven by at least one project_assets ref.
  const [owned] = await db
    .select({
      id: mediaFiles.id,
      fileHash: mediaFiles.fileHash,
      videoOssKey: mediaFiles.videoOssKey,
      backupStatus: mediaFiles.backupStatus,
    })
    .from(projectAssets)
    .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
    .where(and(eq(projectAssets.mediaFileId, assetId), eq(projectAssets.userId, user.id)))
    .limit(1);
  if (!owned) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (owned.videoOssKey) {
    try {
      const headers = await headAsset(owned.videoOssKey);
      const storedSha256 = headers['x-oss-meta-sha256'];
      if (storedSha256 === owned.fileHash) {
        await db
          .update(mediaFiles)
          .set({ backupStatus: 'backed_up' })
          .where(eq(mediaFiles.id, assetId));
        return c.json({ alreadyUploaded: true, objectKey: owned.videoOssKey });
      }
      if (owned.backupStatus === 'backed_up') {
        return c.json({ error: 'Existing backup metadata mismatch' }, 409);
      }
      console.warn('[upload-token] video backup metadata mismatch, forcing reupload:', owned.videoOssKey);
    } catch (error) {
      if (owned.backupStatus === 'backed_up') {
        if (!isMissingOssObject(error)) {
          return c.json({ error: 'Existing backup verification failed, retry later' }, 503);
        }
        const missingResult = await db
          .update(mediaFiles)
          .set({ videoOssKey: null, backupStatus: 'failed' })
          .where(and(eq(mediaFiles.id, assetId), eq(mediaFiles.backupStatus, 'backed_up')));
        const missingAffected = (missingResult as any)?.[0]?.affectedRows ?? 0;
        if (missingAffected === 0) {
          return c.json({ error: 'Backup state changed, retry' }, 409);
        }
      } else {
        console.warn('[upload-token] video backup HEAD failed, forcing reupload:', owned.videoOssKey, error);
      }
    }
    const clearResult = await db
      .update(mediaFiles)
      .set({ videoOssKey: null, backupStatus: 'failed' })
      .where(and(eq(mediaFiles.id, assetId), ne(mediaFiles.backupStatus, 'backed_up')));
    const affected = (clearResult as any)?.[0]?.affectedRows ?? 0;
    if (affected === 0) {
      const [current] = await db
        .select({ videoOssKey: mediaFiles.videoOssKey, backupStatus: mediaFiles.backupStatus })
        .from(mediaFiles)
        .where(eq(mediaFiles.id, assetId))
        .limit(1);
      if (current?.backupStatus === 'backed_up' && current.videoOssKey) {
        return c.json({ alreadyUploaded: true, objectKey: current.videoOssKey });
      }
      return c.json({ error: 'Backup state changed, retry' }, 409);
    }
  }

  const objectKey = `assets/by-hash/${owned.fileHash}.${ext || 'mp4'}`;
  const contentType = KIND_CONTENT_TYPE[kind](filename);
  const uploadHeaders = { 'x-oss-meta-sha256': owned.fileHash };

  const callbackToken = signWebhookPayload({
    userId: user.id,
    assetId,
    kind,
    objectKey,
    iat: Math.floor(Date.now() / 1000),
    nonce: newNonce(),
  });

  return c.json({
    alreadyUploaded: false,
    uploadUrl: signUploadUrl(objectKey, contentType, uploadHeaders),
    objectKey,
    contentType,
    uploadHeaders,
    callbackToken,
  });
});

export default app;
