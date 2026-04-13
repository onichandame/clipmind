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

app.post('/', async (c) => {
  try {
    const newId = crypto.randomUUID();
    // 1. 物理创建项目记录
    await db.insert(projects).values({
      id: newId,
      title: "未命名大纲",
    });

    // 2. 物理入库初始 Greeting 消息，确保历史一致性
    const GREETING = "你好！我是你的创作助理 ClipMind。今天打算怎么开启工作？是想先聊聊灵感、策划一个新短视频大纲，还是脑子里已经有确切的画面，直接去库里精准找素材片段？";
    await db.insert(projectMessages).values({
      id: crypto.randomUUID(),
      projectId: newId,
      role: "assistant",
      content: GREETING,
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
    const messagesRes = await db.select().from(projectMessages).where(eq(projectMessages.projectId, id)).orderBy(desc(projectMessages.createdAt));

    // 按时间顺序对历史消息进行升序排序
    // 按时间顺序对历史消息进行升序排序并格式化为 AI SDK Message 结构
    const sortedMessages = messagesRes.map(msg => {
      const parsedInvocations = msg.toolInvocations ? (typeof msg.toolInvocations === 'string' ? JSON.parse(msg.toolInvocations) : msg.toolInvocations) : undefined;

      // 核心修复：严格对齐 Vercel AI SDK 最新版的 parts 协议，防止前端注水时丢失状态
      const parts: any[] = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      if (parsedInvocations && Array.isArray(parsedInvocations)) {
        parsedInvocations.forEach(inv => {
          parts.push({ type: 'tool-invocation', toolInvocation: inv });
        });
      }

      return {
        ...msg,
        toolInvocations: parsedInvocations, // 保持向下兼容
        parts: parts.length > 0 ? parts : undefined
      };
    });

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
