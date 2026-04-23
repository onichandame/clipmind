import { Hono } from 'hono';
import { db } from '../db';
import { projects, projectOutlines, editingPlans, assets } from '@clipmind/db/schema';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { ossClient } from '../utils/oss';
import { INITIAL_GREETING, MATERIAL_MODE_FOLLOWUP, IDEA_MODE_FOLLOWUP } from '../utils/workflow-copy';

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
      })
      .from(projects)
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
          const GREETING = INITIAL_GREETING;

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
    const planRes = await db.select().from(editingPlans).where(eq(editingPlans.projectId, id)).orderBy(desc(editingPlans.createdAt));

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
            const [assetRecord] = await db.select({
              ossUrl: assets.ossUrl,
              filename: assets.filename
            }).from(assets).where(eq(assets.id, clip.assetId));

            if (assetRecord && assetRecord.ossUrl) {
              // 补齐文件名元数据
              clip.filename = assetRecord.filename;
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

    // [Arch] JIT 签发 editing plan clips：批量补齐 asset 元数据并签发签名 URL
    if (projectData.editingPlans && Array.isArray(projectData.editingPlans)) {
      for (const plan of projectData.editingPlans) {
        if (!plan.clips || !Array.isArray(plan.clips)) continue;
        console.log(`\n[PROBE-ENRICH] plan "${plan.title}" clips: ${plan.clips.length}`);
        plan.clips.forEach((clip: any, i: number) => {
          console.log(`  clip[${i}] clipType=${clip.clipType ?? '(unset)'} assetId=${clip.assetId ?? '(none)'}`);
        });
        const assetIds = plan.clips
          .map((clip: any) => clip.assetId)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
        console.log(`[PROBE-ENRICH] assetIds to lookup: [${assetIds.join(', ')}]`);
        if (assetIds.length === 0) { console.log(`[PROBE-ENRICH] ⚠️ no assetIds → enrichment skipped`); continue; }

        const assetRows = await db.select({
          id: assets.id,
          filename: assets.filename,
          ossUrl: assets.ossUrl,
          thumbnailUrl: assets.thumbnailUrl,
        }).from(assets).where(inArray(assets.id, assetIds));

        const assetMap = new Map(assetRows.map((a: any) => [a.id, a]));
        console.log(`[PROBE-ENRICH] DB returned ${assetRows.length}/${assetIds.length} assets`);

        for (const clip of plan.clips) {
          if (!clip.assetId) continue;
          const asset = assetMap.get(clip.assetId);
          if (!asset) { console.log(`[PROBE-ENRICH] ❌ assetId=${clip.assetId} not found in DB`); continue; }
          clip.fileName = asset.filename;
          console.log(`[PROBE-ENRICH] ✅ enriched clip assetId=${clip.assetId} → fileName=${asset.filename} thumbnailUrl=${asset.thumbnailUrl ? 'set' : 'null'} ossUrl=${asset.ossUrl ? 'set' : 'null'}`);
          if (asset.thumbnailUrl) {
            clip.thumbnailUrl = ossClient.signatureUrl(asset.thumbnailUrl, { expires: 7200 });
          }
          if (asset.ossUrl) {
            clip.videoUrl = ossClient.signatureUrl(asset.ossUrl, { expires: 7200 });
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

// [Arch] 局部增量更新 (PATCH) - 支持项目名称等元数据修改
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const updatePayload: Record<string, any> = { updatedAt: new Date() };

  // 遵循 PATCH 原则，仅处理传递的增量字段
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return c.json({ error: 'title must be a non-empty string' }, 400);
    }
    updatePayload.title = body.title.trim();
  }


      // [Arch] 允许更新工作流模式起点
      if (body.workflowMode !== undefined) {
        if (body.workflowMode !== 'material' && body.workflowMode !== 'idea' && body.workflowMode !== null) {
          return c.json({ error: 'Invalid workflowMode' }, 400);
        }
        updatePayload.workflowMode = body.workflowMode;

        // Append a mode-specific follow-up assistant message on first mode selection.
        // Dedup guard: only appends if the identical message is not already present.
        if (body.workflowMode === 'material' || body.workflowMode === 'idea') {
          const [current] = await db
            .select({ uiMessages: projects.uiMessages })
            .from(projects)
            .where(eq(projects.id, id))
            .limit(1);

          if (current) {
            const existingMessages = (current.uiMessages as any[]) || [];
            const followupContent = body.workflowMode === 'material'
              ? MATERIAL_MODE_FOLLOWUP
              : IDEA_MODE_FOLLOWUP;
            const alreadyPresent = existingMessages.some(
              (m: any) => m.role === 'assistant' && m.content === followupContent
            );
            if (!alreadyPresent) {
              updatePayload.uiMessages = [
                ...existingMessages,
                { role: 'assistant', content: followupContent },
              ];
            }
          }
        }
      }

      // [Arch] 允许更新精挑素材篮子 (Asset 级别)
      if (body.selectedAssetIds !== undefined) {
        if (!Array.isArray(body.selectedAssetIds)) {
          return c.json({ error: 'selectedAssetIds must be an array' }, 400);
        }
        updatePayload.selectedAssetIds = body.selectedAssetIds;
      }

      if (Object.keys(updatePayload).length === 1) {
    return c.json({ success: true, message: 'No fields to update' });
  }

  try {
    await db.update(projects)
      .set(updatePayload)
      .where(eq(projects.id, id));
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to patch project:', error);
    return c.json({ error: 'Failed to update project' }, 500);
  }
});

export default app;
