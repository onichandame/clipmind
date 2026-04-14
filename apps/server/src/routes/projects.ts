import { Hono } from 'hono';
import { db } from '../db';
import { projects, basketItems, projectOutlines } from '@clipmind/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

const app = new Hono();

// 1. 获取项目列表
app.get('/', async (c) => {
  try {
    const data = await db
      .select({
        id: projects.id,
        title: projects.title,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        basketCount: sql<number>`count(${basketItems.id})`.mapWith(Number),
      })
      .from(projects)
      .leftJoin(basketItems, eq(projects.id, basketItems.projectId))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));

    return c.json({ projects: data });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return c.json({ projects: [] }, 500);
  }
});

app.post('/', async (c) => {
  try {
    const newId = crypto.randomUUID();
    const GREETING = "你好！我是你的创作助理 ClipMind。今天打算怎么开启工作？是想先聊聊灵感、策划一个新短视频大纲，还是脑子里已经有确切的画面，直接去库里精准找素材片段？";

    // 1. 物理创建项目记录（包含初始 Greeting 消息）
    await db.insert(projects).values({
      id: newId,
      title: "未命名大纲",
      uiMessages: [{
        id: crypto.randomUUID(),
        role: 'assistant',
        content: GREETING,
        parts: [{ type: 'text', text: GREETING }],
      }],
    });

    return c.json({ success: true, id: newId });
  } catch (error) {
    console.error("Failed to create project:", error);
    return c.json({ success: false }, 500);
  }
});

// 3. 删除项目
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await db.delete(projects).where(eq(projects.id, id));
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return c.json({ success: false }, 500);
  }
});

// 4. 获取项目详情及会话上下文
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const projectRes = await db.select().from(projects).where(eq(projects.id, id));
    if (projectRes.length === 0) return c.json({ error: 'Not found' }, 404);

    const outlineRes = await db.select().from(projectOutlines).where(eq(projectOutlines.projectId, id));

    const initialMessages = (() => {
      try {
        return projectRes[0].uiMessages || [];
      } catch {
        return [{ id: 'fallback', role: 'assistant', content: ' ', parts: [{ type: 'text', text: ' ' }] }];
      }
    })();

    return c.json({
      project: projectRes[0],
      outline: outlineRes.length > 0 ? outlineRes[0] : null,
      initialMessages: initialMessages
    });
  } catch (error) {
    console.error("Failed to fetch project details:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// 5. 更新项目消息（替换整个 uiMessages 数组）
app.put('/:id/messages', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { uiMessages } = body as { uiMessages: unknown[] };

  if (!Array.isArray(uiMessages)) {
    return c.json({ error: 'uiMessages must be an array' }, 400);
  }

  try {
    await db.update(projects)
      .set({ uiMessages, updatedAt: new Date() })
      .where(eq(projects.id, id));
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to update messages:', error);
    return c.json({ error: 'Failed to update messages' }, 500);
  }
});

export default app;
