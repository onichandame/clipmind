import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { serverConfig } from '../env';

// ---- Password hashing (argon2id) ----

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    return false;
  }
}

// ---- Session tokens (opaque, sha256 stored) ----

const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const tokenHash = sha256Hex(token);
  return { token, tokenHash };
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sessionExpiresAt(): Date {
  return new Date(Date.now() + serverConfig.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---- Webhook HMAC (callback payload signing) ----

export type WebhookKind = 'audio' | 'thumbnail' | 'video-backup';

export interface WebhookPayload {
  userId: string;
  assetId: string;
  kind: WebhookKind;
  // Object key is bound into the signed payload so the callback handler never
  // trusts a caller-supplied path (blocker 2).
  objectKey: string;
  // Issued-at, unix seconds. Verified against WEBHOOK_TTL_SECONDS to bound replay window.
  iat: number;
  // Single-use nonce; the callback handler atomically inserts into webhook_nonces
  // to enforce one-shot semantics within the TTL.
  nonce: string;
}

// Validity window for a callback token. Aligned with the 1h OSS pre-signed PUT TTL.
export const WEBHOOK_TTL_SECONDS = 60 * 60;

// Sign a payload with HMAC-SHA256 -> base64url(payloadJson).base64url(sig)
export function signWebhookPayload(payload: WebhookPayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const sig = createHmac('sha256', serverConfig.WEBHOOK_HMAC_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export type WebhookVerifyError = 'malformed' | 'bad-signature' | 'bad-shape' | 'expired';

export function verifyWebhookPayload(
  token: string,
  now: number = Math.floor(Date.now() / 1000),
): { ok: true; payload: WebhookPayload } | { ok: false; reason: WebhookVerifyError } {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed' };

  const expected = createHmac('sha256', serverConfig.WEBHOOK_HMAC_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const shapeOk =
    typeof parsed?.userId === 'string' &&
    typeof parsed?.assetId === 'string' &&
    typeof parsed?.objectKey === 'string' &&
    typeof parsed?.nonce === 'string' &&
    typeof parsed?.iat === 'number' &&
    (parsed.kind === 'audio' || parsed.kind === 'thumbnail' || parsed.kind === 'video-backup');
  if (!shapeOk) return { ok: false, reason: 'bad-shape' };

  if (now - parsed.iat > WEBHOOK_TTL_SECONDS) return { ok: false, reason: 'expired' };
  if (parsed.iat - now > 60) return { ok: false, reason: 'expired' }; // clock-skew guard

  return { ok: true, payload: parsed as WebhookPayload };
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}
