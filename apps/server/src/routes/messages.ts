import { Hono } from 'hono';
import { db, projectMessages } from '@clipmind/db';
import { eq } from 'drizzle-orm';

const app = new Hono();

app.post('/:projectId/messages', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { message } = body as { message: { id?: string; role: string; content?: string; parts?: unknown[]; [key: string]: unknown } };

  if (!message) {
    return c.json({ error: 'Missing message field' }, 400);
  }

  if (message.role !== 'user' && message.role !== 'assistant') {
    return c.json({ error: `Invalid role: ${message.role}. Only 'user' and 'assistant' are accepted.` }, 400);
  }

  const messageId = message.id || crypto.randomUUID();

  try {
    await db.insert(projectMessages).values({
      id: messageId,
      projectId,
      message,
    }).onDuplicateKeyUpdate({
      set: { message },
    });

    return c.json({ success: true, id: messageId }, 201);
  } catch (error) {
    console.error('Failed to persist message:', error);
    return c.json({ error: 'Failed to persist message' }, 500);
  }
});

export default app;