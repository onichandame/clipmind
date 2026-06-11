import { Hono } from 'hono';
import { db } from '../db';
import { projects, projectOutlines, editingPlans, mediaFiles, projectAssets, hotspots, userMediaFiles } from '@clipmind/db/schema';
import { desc, eq, inArray, and, sql } from 'drizzle-orm';
import { signAssetViewUrl, signAssetDownloadUrl } from '../utils/oss';
import { INITIAL_GREETING, MATERIAL_MODE_FOLLOWUP, IDEA_MODE_FOLLOWUP } from '../utils/workflow-copy';
import { requireAuth } from '../middleware/auth';
import { createChatHistory } from '../chat/history';

const app = new Hono();

app.use('*', requireAuth);

function toInitialModelMessage(message: any) {
  const role = message?.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;
  const text = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.parts)
      ? message.parts
        .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('')
      : '';
  if (!text.trim()) return null;
  return { role, content: text };
}

function toStoredUiMessage(message: any) {
  if (Array.isArray(message?.parts)) {
    return { ...message, id: message.id || crypto.randomUUID() };
  }
  const role = message?.role === 'user' || message?.role === 'system' ? message.role : 'assistant';
  const text = typeof message?.content === 'string' ? message.content : '';
  return { id: message?.id || crypto.randomUUID(), role, parts: [{ type: 'text', text }] };
}

async function loadAssetMetadataByIds(assetIds: string[], userId: string, projectId: string) {
  if (assetIds.length === 0) return new Map<string, any>();

  const userMediaRows = await db
    .select({
      id: userMediaFiles.id,
      filename: userMediaFiles.filename,
      mediaFileId: userMediaFiles.mediaFileId,
      videoOssKey: mediaFiles.videoOssKey,
      backupStatus: mediaFiles.backupStatus,
      sha256: mediaFiles.fileHash,
      thumbnailOssKey: mediaFiles.thumbnailOssKey,
    })
    .from(userMediaFiles)
    .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
    .where(and(inArray(userMediaFiles.id, assetIds), eq(userMediaFiles.userId, userId)));

  const assetMap = new Map<string, any>(userMediaRows.map((a: any) => [a.id, a]));
  const legacyIds = assetIds.filter((id) => !assetMap.has(id));
  if (legacyIds.length === 0) return assetMap;

  const legacyRows = await db
    .select({
      id: projectAssets.id,
      filename: userMediaFiles.filename,
      mediaFileId: userMediaFiles.mediaFileId,
      videoOssKey: mediaFiles.videoOssKey,
      backupStatus: mediaFiles.backupStatus,
      sha256: mediaFiles.fileHash,
      thumbnailOssKey: mediaFiles.thumbnailOssKey,
    })
    .from(projectAssets)
    .innerJoin(userMediaFiles, eq(userMediaFiles.id, projectAssets.userMediaFileId))
    .innerJoin(mediaFiles, eq(mediaFiles.id, userMediaFiles.mediaFileId))
    .where(and(
      inArray(projectAssets.id, legacyIds),
      eq(projectAssets.projectId, projectId),
      eq(projectAssets.userId, userId),
      eq(userMediaFiles.userId, userId),
    ));

  for (const row of legacyRows) assetMap.set(row.id, row);
  return assetMap;
}

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
      orderBy = [desc(projects.createdAt)];
    } else {
      orderBy = [desc(sql`${projects.pinnedAt} IS NOT NULL`), desc(projects.pinnedAt), desc(projects.createdAt)];
    }

    const baseQuery = db
      .select({
        id: projects.id,
        title: projects.title,
        titleInitialized: projects.titleInitialized,
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
    const explicitTitle = typeof body?.title === 'string' && body.title.trim().length > 0
      ? body.title.trim()
      : null;

    const storedInitialMessages = initialMessages.map(toStoredUiMessage);

    await db.insert(projects).values({
      id: newId,
      userId: user.id,
      title: explicitTitle || (seedMessage ? seedMessage.slice(0, 40) : fallbackTitle),
      titleInitialized: explicitTitle !== null,
      workflowMode,
      chatHistory: createChatHistory(storedInitialMessages, storedInitialMessages.map(toInitialModelMessage).filter(Boolean)),
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
  const t0 = Date.now();
  console.info(`[project-detail] start project=${id} user=${user.id}`);
  try {
    const projectRes = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        title: projects.title,
        titleInitialized: projects.titleInitialized,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        workflowMode: projects.workflowMode,
        pinnedAt: projects.pinnedAt,
        retrievedClips: projects.retrievedClips,
        retrievedAssetIds: projects.retrievedAssetIds,
        selectedAssetIds: projects.selectedAssetIds,
        editingPlans: projects.editingPlans,
      })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    console.info(`[project-detail] project-select project=${id} ms=${Date.now() - t0} found=${projectRes.length > 0}`);
    if (projectRes.length === 0) return c.json({ error: 'Not found' }, 404);

    const outlineRes = await db.select().from(projectOutlines).where(eq(projectOutlines.projectId, id));
    console.info(`[project-detail] outline-select project=${id} ms=${Date.now() - t0} count=${outlineRes.length}`);
    const planRes = await db.select().from(editingPlans).where(eq(editingPlans.projectId, id)).orderBy(desc(editingPlans.displayOrder), desc(editingPlans.createdAt));
    console.info(`[project-detail] plans-select project=${id} ms=${Date.now() - t0} count=${planRes.length}`);

    const projectData = projectRes[0] as any;
    projectData.editingPlans = planRes;

    if (Array.isArray(projectData.retrievedClips)) {
      const retrievedAssetIds = Array.from(new Set(
        projectData.retrievedClips
          .map((clip: any) => clip?.assetId)
          .filter((assetId: any): assetId is string => typeof assetId === 'string' && assetId.length > 0),
      ));
      const retrievedAssetMap = await loadAssetMetadataByIds(retrievedAssetIds, user.id, id);

      for (let i = 0; i < projectData.retrievedClips.length; i++) {
        const clip = projectData.retrievedClips[i];

        clip.thumbnailUrl = signAssetViewUrl(clip.thumbnailUrl);

        // 本地优先：从 user_media_files 反查归属信息。仅在 videoOssKey 存在（已云备份）时签发 download URL；
        // 否则前端通过 useAssetUri(assetId) 走本地 asset:// 协议解析。
        // 注意：videoOssKey / backupStatus 已上提至 media_files（per-content）。
        if (clip.assetId) {
          const paRecord = retrievedAssetMap.get(clip.assetId);

          if (paRecord) {
            clip.filename = paRecord.filename;
            clip.backupStatus = paRecord.backupStatus;
            clip.mediaFileId = paRecord.mediaFileId;
            clip.sha256 = paRecord.sha256;
            clip.thumbnailUrl = signAssetViewUrl(paRecord.thumbnailOssKey);
            if (paRecord.backupStatus === 'backed_up' && paRecord.videoOssKey) {
              clip.videoUrl = signAssetDownloadUrl(paRecord.videoOssKey, paRecord.filename);
            }
          }
        }
      }
    }

    // [Arch] JIT 元数据补齐 editing plan clips：批量写入 backupStatus/mediaFileId/sha256/filename，
    // 仅在已云备份时附带可签发的 videoUrl，本地优先方案由前端通过 useAssetUri 解析
    // (前端用 mediaFileId 反查桌面端 SQLite 里的 local_path)。
    if (projectData.editingPlans && Array.isArray(projectData.editingPlans)) {
      const planAssetIds = Array.from(new Set(
        projectData.editingPlans.flatMap((plan: any) => Array.isArray(plan.clips)
          ? plan.clips
            .map((clip: any) => clip?.assetId)
            .filter((assetId: any): assetId is string => typeof assetId === 'string' && assetId.length > 0)
          : []),
      ));
      const planAssetMap = await loadAssetMetadataByIds(planAssetIds, user.id, id);

      for (const plan of projectData.editingPlans) {
        if (!plan.clips || !Array.isArray(plan.clips)) continue;

        for (const clip of plan.clips) {
          if (!clip.assetId) continue;
          const asset = planAssetMap.get(clip.assetId);
          if (!asset) continue;
          clip.fileName = asset.filename;
          clip.thumbnailUrl = signAssetViewUrl(asset.thumbnailOssKey);
          clip.backupStatus = asset.backupStatus;
          clip.mediaFileId = asset.mediaFileId;
          clip.sha256 = asset.sha256;
          clip.videoUrl = asset.backupStatus === 'backed_up' && asset.videoOssKey
            ? signAssetDownloadUrl(asset.videoOssKey, asset.filename)
            : null;
        }
      }
    }

    return c.json({
      project: projectData,
      outline: outlineRes.length > 0 ? outlineRes[0] : null,
    });
  } catch (error) {
    console.error(`[project-detail] failed project=${id} ms=${Date.now() - t0}`, error);
    console.error("Failed to fetch project details:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// 5. Legacy message overwrite endpoint disabled; chat history now flows through SSE/POST.
app.put('/:id/messages', async (c) => {
  return c.json({ error: 'Deprecated messages endpoint' }, 410);
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
    updatePayload.titleInitialized = true;
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

  }

  if (body.selectedAssetIds !== undefined) {
    if (!Array.isArray(body.selectedAssetIds)) {
      return c.json({ error: 'selectedAssetIds must be an array' }, 400);
    }
    if (body.selectedAssetIds.length > 100 || body.selectedAssetIds.some((assetId: any) => typeof assetId !== 'string')) {
      return c.json({ error: 'selectedAssetIds must be an array of up to 100 strings' }, 400);
    }
    const requestedIds = Array.from(new Set(body.selectedAssetIds)) as string[];
    if (requestedIds.length === 0) {
      updatePayload.selectedAssetIds = [];
    } else {
      const ownedUserMediaRows = await db
        .select({ id: userMediaFiles.id })
        .from(userMediaFiles)
        .where(and(inArray(userMediaFiles.id, requestedIds), eq(userMediaFiles.userId, user.id)));
      const normalizedIds = new Set(ownedUserMediaRows.map((row) => row.id));
      const validRequestedIds = new Set(ownedUserMediaRows.map((row) => row.id));
      const legacyIds = requestedIds.filter((assetId) => !normalizedIds.has(assetId));
      if (legacyIds.length > 0) {
        const legacyRows = await db
          .select({ projectAssetId: projectAssets.id, userMediaFileId: userMediaFiles.id })
          .from(projectAssets)
          .innerJoin(userMediaFiles, eq(userMediaFiles.id, projectAssets.userMediaFileId))
          .where(and(
            inArray(projectAssets.id, legacyIds),
            eq(projectAssets.projectId, id),
            eq(projectAssets.userId, user.id),
            eq(userMediaFiles.userId, user.id),
          ));
        for (const row of legacyRows) {
          validRequestedIds.add(row.projectAssetId);
          normalizedIds.add(row.userMediaFileId);
        }
      }
      if (validRequestedIds.size !== requestedIds.length) {
        return c.json({ error: 'selectedAssetIds contains assets that are not in your library' }, 400);
      }
      updatePayload.selectedAssetIds = Array.from(normalizedIds);
    }
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

app.put('/:id/outline', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : null;
  if (contentMd === null) return c.json({ error: 'contentMd is required' }, 400);
  const expectedVersion = Number.isInteger(body?.expectedVersion) ? Number(body.expectedVersion) : null;
  const [project] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const [currentOutline] = await db
    .select({ version: projectOutlines.version, contentMd: projectOutlines.contentMd })
    .from(projectOutlines)
    .where(eq(projectOutlines.projectId, projectId))
    .limit(1);
  if (expectedVersion !== null && currentOutline && currentOutline.version !== expectedVersion) {
    return c.json({ error: 'Outline has changed', outline: currentOutline }, 409);
  }
  if (expectedVersion !== null && currentOutline) {
    const result: any = await db.execute(sql`
      UPDATE ${projectOutlines}
      SET ${projectOutlines.contentMd} = ${contentMd}, ${projectOutlines.version} = ${projectOutlines.version} + 1
      WHERE ${projectOutlines.projectId} = ${projectId} AND ${projectOutlines.version} = ${expectedVersion}
    `);
    const affectedRows = result?.[0]?.affectedRows ?? result?.rowsAffected ?? 0;
    if (affectedRows === 0) {
      const [latestOutline] = await db
        .select({ version: projectOutlines.version, contentMd: projectOutlines.contentMd })
        .from(projectOutlines)
        .where(eq(projectOutlines.projectId, projectId))
        .limit(1);
      return c.json({ error: 'Outline has changed', outline: latestOutline ?? currentOutline }, 409);
    }
    return c.json({ success: true, version: expectedVersion + 1 });
  }
  await db.insert(projectOutlines).values({
    id: crypto.randomUUID(),
    projectId,
    contentMd,
    version: 1,
  }).onDuplicateKeyUpdate({
    set: { contentMd, version: sql`${projectOutlines.version} + 1` },
  });
  return c.json({ success: true, version: currentOutline ? currentOutline.version + 1 : 1 });
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
