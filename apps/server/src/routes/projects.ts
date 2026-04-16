import { Hono } from 'hono';
import { db } from '../db';
import { projects, basketItems, projectOutlines, editingPlans, assets } from '@clipmind/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { ossClient } from '../utils/oss';

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
    // [Arch] 读写分离：使用纯净 CoreMessage 结构入库
    await db.insert(projects).values({
      id: newId,
      title: "未命名大纲",
      uiMessages: [{
        role: 'assistant',
        content: GREETING,
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
    const planRes = await db.select().from(editingPlans).where(eq(editingPlans.projectId, id));

    // [Arch] 读写分离重构 (读链路)：将底层 CoreMessage 动态投影为前端 UIMessage
    const rawMessages = projectRes[0].uiMessages || [];
    const initialMessages: any[] = [];

    if (Array.isArray(rawMessages)) {
      for (const msg of rawMessages) {
        if (msg.role === 'user' || msg.role === 'system') {
          initialMessages.push({
            id: msg.id || crypto.randomUUID(),
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : '',
            parts: typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
          });
        } else if (msg.role === 'assistant') {
          let textContent = "";
          const parts: any[] = [];

          if (typeof msg.content === "string") {
            textContent = msg.content;
            parts.push({ type: "text", text: msg.content });
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text") {
                textContent += part.text;
                parts.push(part);
              } else if (part.type === "tool-call") {
                parts.push({
                  type: "tool-invocation",
                  toolInvocation: {
                    state: "call",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    args: part.args
                  }
                });
              }
            }
          }
          initialMessages.push({
            id: msg.id || crypto.randomUUID(),
            role: "assistant",
            content: textContent,
            parts: parts
          });
        } else if (msg.role === "tool" && Array.isArray(msg.content)) {
          // 将工具结果回填至 UIMessage 的 parts 中
          for (const toolResult of msg.content) {
            if (toolResult.type === "tool-result") {
              const targetAssistant = initialMessages.find(m =>
                m.parts?.some((p: any) => p.type === "tool-invocation" && p.toolInvocation?.toolCallId === toolResult.toolCallId)
              );
              if (targetAssistant && targetAssistant.parts) {
                const targetPart = targetAssistant.parts.find((p: any) => p.type === "tool-invocation" && p.toolInvocation?.toolCallId === toolResult.toolCallId);
                if (targetPart) {
                  targetPart.toolInvocation.state = "result";
                  targetPart.toolInvocation.result = toolResult.result;
                }
              }
            }
          }
        }
      }
    }

    // [Arch] 读链路 JIT 签发：拦截 retrievedClips，将物理 Object Key 重新签发为 2 小时临时 URL
    const projectData = projectRes[0] as any;

    // [Arch] 缝合脑裂：将物理表查询到的 planRes 注入 projectData，供前端画布流式卡片渲染
    projectData.editingPlans = planRes;

    console.log(`\n======================================`);
    console.log(`📍 [PROBE 2 - READ] 拦截 GET /projects/:id`);
    console.log(`[planRes 数组长度]:`, planRes?.length);
    console.log(`[下发前端的 editingPlans]:`, JSON.stringify(projectData.editingPlans).slice(0, 150) + "...");
    console.log(`======================================\n`);

    if (Array.isArray(projectData.retrievedClips)) {
      // [Arch] JIT 签发升级：遍历并异步补齐原片下载链接
      for (let i = 0; i < projectData.retrievedClips.length; i++) {
        const clip = projectData.retrievedClips[i];

        // 1. 签名缩略图
        if (clip.thumbnailUrl && !clip.thumbnailUrl.startsWith('http')) {
          clip.thumbnailUrl = ossClient.signatureUrl(clip.thumbnailUrl, { expires: 7200, secure: true });
        }

        // 2. 溯源防线：根据 assetId 去底层查出真实视频 ossUrl，并强制签发下载 Header
        if (clip.assetId) {
          try {
            const [assetRecord] = await db.select({ ossUrl: assets.ossUrl }).from(assets).where(eq(assets.id, clip.assetId));
            if (assetRecord && assetRecord.ossUrl) {
              // 编码文件名防中文乱码
              const safeFilename = encodeURIComponent(clip.filename || 'clipmind_video.mp4');
              clip.videoUrl = ossClient.signatureUrl(assetRecord.ossUrl, {
                expires: 7200,
                secure: true,
                // 注入强制下载响应头，绕过前端 iframe/沙盒预览拦截
                response: { 'content-disposition': `attachment; filename="${safeFilename}"` }
              });
            }
          } catch (e) {
            console.error(`🚨 无法为素材切片注入下载链接 (AssetID: ${clip.assetId})`, e);
          }
        }
      }
    }

    // [Arch] 读链路 JIT 签发：拦截 editingPlans，将物理 Object Key 重新签发为下载/预览 URL
    if (Array.isArray(projectData.editingPlans)) {
      projectData.editingPlans = projectData.editingPlans.map((plan: any) => {
        if (Array.isArray(plan.clips)) {
          plan.clips = plan.clips.map((clip: any) => {
            const signedClip = { ...clip };
            if (clip.thumbnailUrl && !clip.thumbnailUrl.startsWith('http')) {
              signedClip.thumbnailUrl = ossClient.signatureUrl(clip.thumbnailUrl, { expires: 7200, secure: true });
            }
            if (clip.videoUrl && !clip.videoUrl.startsWith('http')) {
              // 签发下载授权，强迫浏览器下载而不是在线播放
              signedClip.videoUrl = ossClient.signatureUrl(clip.videoUrl, { expires: 7200, secure: true, response: { 'content-disposition': `attachment; filename="${clip.fileName || 'clipmind_video.mp4'}"` } });
            }
            return signedClip;
          });
        }
        return plan;
      });
    }

    return c.json({
      project: projectData,
      outline: outlineRes.length > 0 ? outlineRes[0] : null,
      initialMessages: initialMessages.length > 0 ? initialMessages : [{ id: 'fallback', role: 'assistant', content: ' ', parts: [{ type: 'text', text: ' ' }] }]
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
