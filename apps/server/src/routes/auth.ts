import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, sessions } from '@clipmind/db/schema';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  sessionExpiresAt,
  sha256Hex,
} from '../utils/auth';
import { DESKTOP_AUTH_HEADER, getSessionTokenFromAuthorization, hasAllowedAuthOrigin, requireAuth } from '../middleware/auth';

const app = new Hono();

const credentialsSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(128),
});

async function issueSession(userId: string, userAgent: string | undefined) {
  const { token, tokenHash } = generateSessionToken();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    userAgent: userAgent?.slice(0, 255),
    expiresAt: sessionExpiresAt(),
  });
  return token;
}

app.post('/signup', async (c) => {
  if (!hasAllowedAuthOrigin(c.req.header('Origin'), c.req.header(DESKTOP_AUTH_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid email or password (min 8 chars)' }, 400);
  }
  const { email, password } = parsed.data;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    // v1: trust-on-signup so users can use the app immediately. v1.1 adds verification enforcement.
    emailVerifiedAt: new Date(),
  });

  const token = await issueSession(userId, c.req.header('User-Agent'));
  return c.json({ user: { id: userId, email }, token }, 201);
});

app.post('/login', async (c) => {
  if (!hasAllowedAuthOrigin(c.req.header('Origin'), c.req.header(DESKTOP_AUTH_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid credentials' }, 400);
  }
  const { email, password } = parsed.data;

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Constant-ish work even on miss to avoid trivial user-existence oracle
  const passwordHash = rows[0]?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$placeholder$placeholder';
  const ok = await verifyPassword(passwordHash, password);
  if (rows.length === 0 || !ok) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await issueSession(rows[0].id, c.req.header('User-Agent'));
  return c.json({ user: { id: rows[0].id, email }, token });
});

app.post('/logout', async (c) => {
  if (!hasAllowedAuthOrigin(c.req.header('Origin'), c.req.header(DESKTOP_AUTH_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const token = getSessionTokenFromAuthorization(c.req.header('Authorization'));
  if (token) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, sha256Hex(token)))
      .catch((error) => {
        console.warn('[auth] session revoke failed during logout:', error);
      });
  }
  return c.json({ success: true });
});

app.get('/me', requireAuth, async (c) => {
  return c.json({ user: c.get('user') });
});

export default app;
