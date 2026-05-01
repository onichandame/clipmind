import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { mediaFiles } from '@clipmind/db/schema';
import { signUploadUrl } from '../utils/oss';
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

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }
  const { kind, assetId, filename } = parsed.data;

  // All three kinds (audio / thumbnail / video-backup) are now keyed by media_files.id
  // — backup state moved to media_files (per-content), so we can do a single ownership check.
  const [owned] = await db
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.id, assetId), eq(mediaFiles.userId, user.id)))
    .limit(1);
  if (!owned) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  const ext = (filename.split('.').pop() || '').toLowerCase();
  const objectKey = KIND_TO_KEY[kind](assetId, ext);
  const contentType = KIND_CONTENT_TYPE[kind](filename);

  const callbackToken = signWebhookPayload({
    userId: user.id,
    assetId,
    kind,
    objectKey,
    iat: Math.floor(Date.now() / 1000),
    nonce: newNonce(),
  });

  return c.json({
    uploadUrl: signUploadUrl(objectKey, contentType),
    objectKey,
    contentType,
    callbackToken,
  });
});

export default app;
