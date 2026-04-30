import { Hono } from 'hono';
import { db } from '../db';
import { projects, projectOutlines, editingPlans, mediaFiles, projectAssets, hotspots } from '@clipmind/db/schema';
import { desc, eq, inArray, and, sql } from 'drizzle-orm';
import { signAssetViewUrl, signAssetDownloadUrl } from '../utils/oss';
import { INITIAL_GREETING, MATERIAL_MODE_FOLLOWUP, IDEA_MODE_FOLLOWUP } from '../utils/workflow-copy';
import { requireAuth } from '../middleware/auth';

const app = new Hono();

app.use('*', requireAuth);

// idea 模式首条消息：text followup + 留学热点 carousel widget。
// 复用 material 模式 request_asset_import 的 seed 套路 —— 用 AI SDK 标准 tool-* part
// 形状伪造一次"工具已完成调用"，前端 widgetRegistry 按 `tool-show_hotspots` 渲染
// HotspotsCarouselWidget。output.hotspots 在创建时一次性查 DB 注入，之后即使热点表
// 变化，本项目内看到的卡片都是创建时的快照。
async function buildIdeaModeSeedMessage() {
  let items: any[] = [];
  try {
    items = await db
      .select({
        id: hotspots.id,
        category: hotspots.category,
        title: hotspots.title,
        description: hotspots.description,
        source: hotspots.source,
        heatMetric: hotspots.heatMetric,
      })
      .from(hotspots)
      .where(eq(hotspots.isActive, true))
      .orderBy(desc(hotspots.heatScore))
      .limit(12);
  } catch (e) {
    console.error('[Projects] idea-seed 取热点失败，将以空 carousel 继续:', e);
  }
  return {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    parts: [
      { type: 'text', text: IDEA_MODE_FOLLOWUP },
      {
        type: 'tool-show_hotspots',
        toolCallId: `seed-${crypto.randomUUID()}`,
        state: 'output-available',
        input: { reason: 'workflow-init' },
        output: { hotspots: items },
      },
    ],
  };
}

// 1. 获取项目列表（按当前登录用户限定）。
//    ?pinned=true   仅置顶项目（无分页，按 pinnedAt 降序）
//    ?pinned=false  仅未置顶项目（支持 limit/offset 分页）
//    省略 pinned    全部项目，置顶在前 (兼容旧调用)
app.get('/', async (c) => {
  const user = c.get('user');
  const pinnedParam = c.req.query('pinned');
  const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
  const offsetParam = Number.parseInt(c.req.query('offset') ?? '', 10);
  const paginated = Number.isFinite(limitParam) && limitParam > 0;
  const limit = paginated ? Math.min(limitParam, 100) : null;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  try {
    const conds = [eq(projects.userId, user.id)];
    let orderBy;
    if (pinnedParam === 'true') {
      conds.push(sql`${projects.pinnedAt} IS NOT NULL`);
      orderBy = [desc(projects.pinnedAt)];
    } else if (pinnedParam === 'false') {
      conds.push(sql`${projects.pinnedAt} IS NULL`);
      orderBy = [desc(projects.updatedAt)];
    } else {
      orderBy = [desc(sql`${projects.pinnedAt} IS NOT NULL`), desc(projects.pinnedAt), desc(projects.updatedAt)];
    }

    const baseQuery = db
      .select({
        id: projects.id,
        title: projects.title,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        workflowMode: projects.workflowMode,
        pinnedAt: projects.pinnedAt,
      })
      .from(projects)
      .where(and(...conds))
      .orderBy(...orderBy);

    if (limit !== null) {
      // Fetch limit+1 to detect whether more rows exist without a separate COUNT.
      const rows = await baseQuery.limit(limit + 1).offset(offset);
      const hasMore = rows.length > limit;
      return c.json({
        projects: hasMore ? rows.slice(0, limit) : rows,
        nextOffset: hasMore ? offset + limit : null,
      });
    }

    const data = await baseQuery;
    return c.json({ projects: data, nextOffset: null });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return c.json({ projects: [], nextOffset: null }, 500);
  }
});

app.post('/', async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json().catch(() => ({}));
    const requestedMode = body?.workflowMode;
    const workflowMode =
      requestedMode === 'material' || requestedMode === 'idea' || requestedMode === 'freechat'
        ? requestedMode
        : null;
    const seedMessage = typeof body?.seedMessage === 'string' && body.seedMessage.trim().length > 0
      ? body.seedMessage.trim()
      : null;

    // 默认初始消息：结构化模式给一段引导；自由对话模式更轻量。
    const initialMessages: any[] = [];
    if (seedMessage) {
      // 自由对话来自 landing page 的"直接说想法" — 把它作为第一条 user 消息，
      // ChatPanel 的 autoTriggeredRef 会自动触发 AI 回复。
      initialMessages.push({ id: crypto.randomUUID(), role: 'user', content: seedMessage });
    } else if (workflowMode === 'freechat') {
      initialMessages.push({
        role: 'assistant',
        content: '随便聊吧。我可以帮你检索素材、查询资讯，或者只是给你建议。',
      });
    } else if (workflowMode === 'material') {
      // [HITL] 素材驱动模式：followup 文案后内嵌素材库轮播 + 上传按钮 widget。
      // 用 AI SDK 标准 tool-* part 形状伪造一次"工具已完成调用"，前端 widgetRegistry
      // 会按 `tool-request_asset_import` 名字渲染 AssetPickerWidget。
      initialMessages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [
          { type: 'text', text: MATERIAL_MODE_FOLLOWUP },
          {
            type: 'tool-request_asset_import',
            toolCallId: `seed-${crypto.randomUUID()}`,
            state: 'output-available',
            input: { reason: 'workflow-init' },
            output: { ok: true, reason: 'workflow-init' },
          },
        ],
      });
    } else if (workflowMode === 'idea') {
      // [HITL] 想法驱动模式：followup 文案后内嵌留学热点 carousel widget（同 material 套路）。
      initialMessages.push(await buildIdeaModeSeedMessage());
    } else {
      initialMessages.push({ role: 'assistant', content: INITIAL_GREETING });
    }

    const newId = crypto.randomUUID();

    const defaultTitleByMode: Record<string, string> = {
      material: '未命名素材项目',
      idea: '未命名灵感项目',
      freechat: '未命名对话',
    };
    const fallbackTitle = workflowMode ? defaultTitleByMode[workflowMode] : '未命名大纲';

    await db.insert(projects).values({
      id: newId,
      userId: user.id,
      title: body?.title?.trim() || (seedMessage ? seedMessage.slice(0, 40) : fallbackTitle),
      workflowMode,
      uiMessages: initialMessages,
    });

    return c.json({ success: true, id: newId });
  } catch (error) {
    console.error("Failed to create project:", error);
    return c.json({ success: false }, 500);
  }
});

// 3. 删除项目（owner-scoped）
app.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return c.json({ success: false }, 500);
  }
});

// 4. 获取项目详情及会话上下文
app.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const projectRes = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    if (projectRes.length === 0) return c.json({ error: 'Not found' }, 404);

    const outlineRes = await db.select().from(projectOutlines).where(eq(projectOutlines.projectId, id));
    const planRes = await db.select().from(editingPlans).where(eq(editingPlans.projectId, id)).orderBy(desc(editingPlans.displayOrder), desc(editingPlans.createdAt));

    // [Arch] 读写分离重构 (读链路)：将底层 CoreMessage 动态投影为前端 UIMessage
    const rawMessages = projectRes[0].uiMessages || [];
    const initialMessages: any[] = [];

    if (Array.isArray(rawMessages)) {
      for (const msg of rawMessages) {
        // [Passthrough] 消息若已是 UIMessage 形状（带 parts 数组），直接保留。
        // 用于：(a) 项目创建时 seed 的带 HITL widget 部件的助手消息；
        //       (b) 任何已经是前端规范 parts 形状的入库记录。
        if (Array.isArray(msg.parts) && msg.parts.length > 0 && !Array.isArray(msg.content)) {
          initialMessages.push({
            id: msg.id || crypto.randomUUID(),
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : '',
            parts: msg.parts,
          });
          continue;
        }
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
                // v6 typed tool part shape — name encoded in `type`.
                parts.push({
                  type: `tool-${part.toolName}`,
                  toolCallId: part.toolCallId,
                  state: 'input-available',
                  input: part.args,
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
          for (const toolResult of msg.content) {
            if (toolResult.type === "tool-result") {
              const targetAssistant = initialMessages.find(m =>
                m.parts?.some((p: any) => typeof p.type === 'string' && p.type.startsWith('tool-') && p.toolCallId === toolResult.toolCallId)
              );
              if (targetAssistant && targetAssistant.parts) {
                const targetPart = targetAssistant.parts.find((p: any) => typeof p.type === 'string' && p.type.startsWith('tool-') && p.toolCallId === toolResult.toolCallId);
                if (targetPart) {
                  targetPart.state = 'output-available';
                  targetPart.output = toolResult.result;
                }
              }
            }
          }
        }
      }
    }

    const projectData = projectRes[0] as any;
    projectData.editingPlans = planRes;

    if (Array.isArray(projectData.retrievedClips)) {
      for (let i = 0; i < projectData.retrievedClips.length; i++) {
        const clip = projectData.retrievedClips[i];

        clip.thumbnailUrl = signAssetViewUrl(clip.thumbnailUrl);

        // 本地优先：从 assets 表反查归属信息。仅在 videoOssKey 存在（已云备份）时签发 download URL；
        // 否则前端通过 useAssetUri(assetId) 走本地 asset:// 协议解析。
        if (clip.assetId) {
          try {
            const [paRecord] = await db
              .select({
                videoOssKey: projectAssets.videoOssKey,
                filename: projectAssets.filename,
                backupStatus: projectAssets.backupStatus,
                originDeviceId: projectAssets.originDeviceId,
                thumbnailOssKey: mediaFiles.thumbnailOssKey,
              })
              .from(projectAssets)
              .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
              .where(and(eq(projectAssets.id, clip.assetId), eq(projectAssets.userId, user.id)));

            if (paRecord) {
              clip.filename = paRecord.filename;
              clip.backupStatus = paRecord.backupStatus;
              clip.originDeviceId = paRecord.originDeviceId;
              clip.thumbnailUrl = signAssetViewUrl(paRecord.thumbnailOssKey);
              if (paRecord.videoOssKey) {
                clip.videoUrl = signAssetDownloadUrl(paRecord.videoOssKey, paRecord.filename);
              }
            }
          } catch (e) {
            console.error(`🚨 无法为素材切片注入元数据 (AssetID: ${clip.assetId})`, e);
          }
        }
      }
    }

    // [Arch] JIT 元数据补齐 editing plan clips：批量写入 backupStatus/originDeviceId/filename，
    // 仅在已云备份时附带可签发的 videoUrl，本地优先方案由前端通过 useAssetUri 解析。
    if (projectData.editingPlans && Array.isArray(projectData.editingPlans)) {
      for (const plan of projectData.editingPlans) {
        if (!plan.clips || !Array.isArray(plan.clips)) continue;
        const assetIds = plan.clips
          .map((clip: any) => clip.assetId)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
        if (assetIds.length === 0) continue;

        const paRows = await db
          .select({
            id: projectAssets.id,
            filename: projectAssets.filename,
            videoOssKey: projectAssets.videoOssKey,
            backupStatus: projectAssets.backupStatus,
            originDeviceId: projectAssets.originDeviceId,
            thumbnailOssKey: mediaFiles.thumbnailOssKey,
          })
          .from(projectAssets)
          .innerJoin(mediaFiles, eq(mediaFiles.id, projectAssets.mediaFileId))
          .where(and(inArray(projectAssets.id, assetIds), eq(projectAssets.userId, user.id)));

        const assetMap = new Map(paRows.map((a: any) => [a.id, a]));

        for (const clip of plan.clips) {
          if (!clip.assetId) continue;
          const asset = assetMap.get(clip.assetId);
          if (!asset) continue;
          clip.fileName = asset.filename;
          clip.thumbnailUrl = signAssetViewUrl(asset.thumbnailOssKey);
          clip.backupStatus = asset.backupStatus;
          clip.originDeviceId = asset.originDeviceId;
          clip.videoUrl = asset.videoOssKey ? signAssetDownloadUrl(asset.videoOssKey, asset.filename) : null;
        }
      }
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
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { uiMessages } = body as { uiMessages: unknown[] };

  if (!Array.isArray(uiMessages)) {
    return c.json({ error: 'uiMessages must be an array' }, 400);
  }

  try {
    await db
      .update(projects)
      .set({ uiMessages, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to update messages:', error);
    return c.json({ error: 'Failed to update messages' }, 500);
  }
});

app.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  const updatePayload: Record<string, any> = { updatedAt: new Date() };

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return c.json({ error: 'title must be a non-empty string' }, 400);
    }
    updatePayload.title = body.title.trim();
  }

  if (body.workflowMode !== undefined) {
    if (
      body.workflowMode !== 'material' &&
      body.workflowMode !== 'idea' &&
      body.workflowMode !== 'freechat' &&
      body.workflowMode !== null
    ) {
      return c.json({ error: 'Invalid workflowMode' }, 400);
    }
    updatePayload.workflowMode = body.workflowMode;

    if (body.workflowMode === 'material' || body.workflowMode === 'idea') {
      const [current] = await db
        .select({ uiMessages: projects.uiMessages })
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
        .limit(1);

      if (current) {
        const existingMessages = (current.uiMessages as any[]) || [];
        const followupContent = body.workflowMode === 'material'
          ? MATERIAL_MODE_FOLLOWUP
          : IDEA_MODE_FOLLOWUP;
        // 兼容两种 seed 形状：旧 plain-content 和带 parts 的 widget 消息。
        const alreadyPresent = existingMessages.some((m: any) => {
          if (m.role !== 'assistant') return false;
          if (m.content === followupContent) return true;
          return Array.isArray(m.parts)
            && m.parts.some((p: any) => p.type === 'text' && p.text === followupContent);
        });
        if (!alreadyPresent) {
          // idea 模式追加完整 seed（含热点 carousel widget）；material 维持原 plain-text 行为。
          const followupMessage = body.workflowMode === 'idea'
            ? await buildIdeaModeSeedMessage()
            : { role: 'assistant', content: followupContent };
          updatePayload.uiMessages = [...existingMessages, followupMessage];
        }
      }
    }
  }

  if (body.selectedAssetIds !== undefined) {
    if (!Array.isArray(body.selectedAssetIds)) {
      return c.json({ error: 'selectedAssetIds must be an array' }, 400);
    }
    updatePayload.selectedAssetIds = body.selectedAssetIds;
  }

  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') {
      return c.json({ error: 'pinned must be a boolean' }, 400);
    }
    updatePayload.pinnedAt = body.pinned ? new Date() : null;
  }

  if (Object.keys(updatePayload).length === 1) {
    return c.json({ success: true, message: 'No fields to update' });
  }

  try {
    await db
      .update(projects)
      .set(updatePayload)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to patch project:', error);
    return c.json({ error: 'Failed to update project' }, 500);
  }
});

// DELETE /api/projects/:id/plans/:planId — remove an editing plan from a project
app.delete('/:id/plans/:planId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const planId = c.req.param('planId');
  try {
    // Verify project ownership before touching the plan.
    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!proj) return c.json({ error: 'Project not found' }, 404);
    await db.delete(editingPlans).where(and(eq(editingPlans.id, planId), eq(editingPlans.projectId, projectId)));
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ 删除剪辑方案失败:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// PATCH /api/projects/:id/plans/reorder — body: { planIds: string[] } (top-to-bottom order)
app.patch('/:id/plans/reorder', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.planIds)) return c.json({ error: 'planIds array required' }, 400);
  const planIds = body.planIds as string[];
  try {
    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!proj) return c.json({ error: 'Project not found' }, 404);

    // Top of the user's list gets the highest displayOrder so DESC sort puts it first.
    // Use len-i so values stay positive and stable; new plans inserted later
    // (with MAX+1) naturally appear above any existing user-ordered list.
    await db.transaction(async (tx) => {
      for (let i = 0; i < planIds.length; i++) {
        await tx.update(editingPlans)
          .set({ displayOrder: planIds.length - i })
          .where(and(eq(editingPlans.id, planIds[i]), eq(editingPlans.projectId, projectId)));
      }
    });
    return c.json({ success: true });
  } catch (error) {
    console.error('❌ 重排剪辑方案失败:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

export default app;
