import { Hono } from 'hono';
import { db } from '@clipmind/db';
import { projects, basketItems, projectOutlines, projectMessages } from '@clipmind/db/schema';
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

// 2. 创建新项目
app.post('/', async (c) => {
  try {
    const newId = crypto.randomUUID();
    await db.insert(projects).values({
      id: newId,
      title: "未命名大纲",
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
    const messagesRes = await db.select().from(projectMessages).where(eq(projectMessages.projectId, id));
    
    // 按时间顺序对历史消息进行升序排序
    const sortedMessages = messagesRes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return c.json({
      project: projectRes[0],
      outline: outlineRes.length > 0 ? outlineRes[0] : null,
      initialMessages: sortedMessages
    });
  } catch (error) {
    console.error("Failed to fetch project details:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

export default app;
