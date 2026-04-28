import type { MiddlewareHandler } from 'hono';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db';
import { users, sessions } from '@clipmind/db/schema';
import { sha256Hex } from '../utils/auth';

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// Reads `Authorization: Bearer <session-token>`, validates against sessions table,
// populates c.set('user', ...). Returns 401 on any failure.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = match[1].trim();
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
