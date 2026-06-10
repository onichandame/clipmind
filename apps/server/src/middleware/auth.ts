import type { MiddlewareHandler } from 'hono';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db';
import { users, sessions } from '@clipmind/db/schema';
import { sha256Hex } from '../utils/auth';
import { serverConfig } from '../env';

export interface AuthUser {
  id: string;
  email: string;
}

export const DESKTOP_AUTH_HEADER = 'X-ClipMind-Desktop';
export const DESKTOP_AUTH_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'];

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export function getSessionTokenFromAuthorization(authorizationHeader: string | undefined): string | undefined {
  const [scheme, token, extra] = authorizationHeader?.trim().split(/\s+/) ?? [];
  if (extra || scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

export function getAllowedAuthOrigins() {
  return Array.from(new Set([...serverConfig.CORS_ORIGIN, ...DESKTOP_AUTH_ORIGINS]));
}

export function hasAllowedAuthOrigin(origin: string | undefined, desktopHeader: string | undefined) {
  if (desktopHeader === '1') return true;
  if (origin) return getAllowedAuthOrigins().includes(origin);
  return false;
}

// Reads the bearer session token, validates against sessions table,
// populates c.set('user', ...). Returns 401 on any failure.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!hasAllowedAuthOrigin(c.req.header('Origin'), c.req.header(DESKTOP_AUTH_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const token = getSessionTokenFromAuthorization(c.req.header('Authorization'));
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const tokenHash = sha256Hex(token);
  const now = new Date();

  const rows = await db
    .select({
      userId: sessions.userId,
      email: users.email,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const row = rows[0];
  c.set('user', { id: row.userId, email: row.email });

  // Fire-and-forget lastSeenAt bump (don't block the request)
  db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId)).catch(() => { /* swallow */ });

  await next();
};
