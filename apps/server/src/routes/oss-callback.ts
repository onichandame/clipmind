import { Hono } from "hono";
import { z } from "zod";
import { mediaFiles, webhookNonces } from "@clipmind/db";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { verifyWebhookPayload } from "../utils/auth";

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

    // All kinds (audio / thumbnail / video-backup) are keyed by media_files.id —
    // backup state is per-content, shared across all project_assets that point at this file.
    if (kind === 'audio') {
      await db
        .update(mediaFiles)
        .set({ audioOssKey: objectKey, asrStatus: 'pending' })
        .where(and(eq(mediaFiles.id, assetId), eq(mediaFiles.userId, userId)));

      import('../utils/aliyun-asr').then(({ submitAliyunAsrTask }) => {
        submitAliyunAsrTask(assetId, objectKey).catch(err => {
          console.error("[OSS-Callback] submitAliyunAsrTask failed:", err);
        });
      }).catch(err => {
        console.error("[OSS-Callback] aliyun-asr import failed:", err);
      });
    } else if (kind === 'thumbnail') {
      await db
        .update(mediaFiles)
        .set({ thumbnailOssKey: objectKey, status: 'ready' })
        .where(and(eq(mediaFiles.id, assetId), eq(mediaFiles.userId, userId)));
    } else if (kind === 'video-backup') {
      await db
        .update(mediaFiles)
        .set({ videoOssKey: objectKey, backupStatus: 'backed_up' })
        .where(and(eq(mediaFiles.id, assetId), eq(mediaFiles.userId, userId)));
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('❌ OSS callback error:', error);
    return c.json({ error: 'Internal Error' }, 500);
  }
});

export default app;
