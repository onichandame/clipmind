import { Hono } from "hono";
import { z } from "zod";
import { mediaFiles, projectAssets, webhookNonces } from "@clipmind/db";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { verifyWebhookPayload } from "../utils/auth";
import { headAsset } from "../utils/oss";

const app = new Hono();

const callbackSchema = z.object({
  callbackToken: z.string().min(1),
});

// HMAC-verified upload-completion webhook. The Rust shell calls this after each
// successful PUT to OSS, presenting the callbackToken returned by /api/upload-token.
//
// Trust model:
// - HMAC-signed payload binds userId+assetId+kind+objectKey+iat+nonce.
// - iat is rejected if older than WEBHOOK_TTL_SECONDS (1h) — bounded replay window.
// - nonce is consumed atomically via webhook_nonces dup-key insert — single-use within TTL.
// - objectKey is read from the verified payload, never from the request body.
app.post("/", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const parsed = callbackSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid payload' }, 400);
    }
    const { callbackToken } = parsed.data;

    const result = verifyWebhookPayload(callbackToken);
    if (!result.ok) {
      console.warn('[OSS-Callback] HMAC verification failed:', result.reason);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const { userId, assetId, kind, objectKey, nonce } = result.payload;

    // Atomically consume the nonce — duplicate insert means replay → reject.
    try {
      await db.insert(webhookNonces).values({ nonce });
    } catch (e: any) {
      const msg = String(e?.code || e?.message || '');
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('Duplicate')) {
        console.warn('[OSS-Callback] nonce replay rejected:', nonce.slice(0, 8));
        return c.json({ error: 'Token already used' }, 409);
      }
      throw e;
    }

    if (kind === 'audio' || kind === 'thumbnail') {
      return c.json({ success: true, ignored: 'legacy import callback closed' });
    }

    if (kind === 'video-backup') {
      const [owned] = await db
        .select({ mediaFileId: projectAssets.mediaFileId, fileHash: mediaFiles.fileHash })
        .from(projectAssets)
        .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
        .where(and(eq(projectAssets.mediaFileId, assetId), eq(projectAssets.userId, userId)))
        .limit(1);
      if (!owned) return c.json({ error: 'Asset not found' }, 404);

      const headers = await headAsset(objectKey);
      if (headers['x-oss-meta-sha256'] !== owned.fileHash) {
        return c.json({ error: 'Backup object hash metadata mismatch' }, 409);
      }
      await db
        .update(mediaFiles)
        .set({ videoOssKey: objectKey, backupStatus: 'backed_up' })
        .where(eq(mediaFiles.id, assetId));
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('❌ OSS callback error:', error);
    return c.json({ error: 'Internal Error' }, 500);
  }
});

export default app;
