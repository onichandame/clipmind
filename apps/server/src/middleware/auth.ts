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

export const SESSION_COOKIE = 'clipmind_session';
export const DESKTOP_AUTH_HEADER = 'X-ClipMind-Desktop';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export function getSessionTokenFromCookie(cookieHeader: string | undefined): string | undefined {
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function hasAllowedAuthOrigin(origin: string | undefined, desktopHeader: string | undefined) {
  if (origin) return serverConfig.CORS_ORIGIN.includes(origin);
  return desktopHeader === '1';
}

// Reads the HttpOnly session cookie, validates against sessions table,
// populates c.set('user', ...). Returns 401 on any failure.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!hasAllowedAuthOrigin(c.req.header('Origin'), c.req.header(DESKTOP_AUTH_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const cookieToken = getSessionTokenFromCookie(c.req.header('Cookie'));
  if (!cookieToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = cookieToken;
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

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
