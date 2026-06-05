import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverConfig } from '../env';

const ASR_CALLBACK_TTL_SECONDS = 24 * 60 * 60;

export function signAsrCallbackToken(mediaFileId: string, iat = Math.floor(Date.now() / 1000)): string {
  const body = Buffer.from(JSON.stringify({ mediaFileId, iat }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', serverConfig.WEBHOOK_HMAC_SECRET).update(`asr:${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAsrCallbackToken(
  token: string | null | undefined,
  mediaFileId: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!token || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  const expected = createHmac('sha256', serverConfig.WEBHOOK_HMAC_SECRET).update(`asr:${body}`).digest('base64url');
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (parsed?.mediaFileId !== mediaFileId || typeof parsed?.iat !== 'number') return false;
    if (now - parsed.iat > ASR_CALLBACK_TTL_SECONDS) return false;
    if (parsed.iat - now > 60) return false;
    return true;
  } catch {
    return false;
  }
}
