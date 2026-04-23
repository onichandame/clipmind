# 热点库（Hotspot Library）功能设计方案

> 状态：设计稿，未开始实现
> 决策基线：
> - 旧的 `apps/server/src/jobs/fetch-hot-topics.ts`（只抓百度热搜 + 内存字符串）**完全替换**
> - 热点分类：**大模型自由分类**（无固定白名单，但有收敛策略，见 §4.4）
> - 内容来源：**小红书 + 微信生态为主，抖音 / B 站为辅**，必须是中文来源
> - 创建项目 UX：**一键直达 chat**，自动注入热点信息并进入"我有想法"工作流
> - 网络搜索能力：**严格复用** `apps/server/src/utils/searchapi.ts` 的 `googleSearch` 和 `apps/server/src/utils/firecrawl.ts` 的 `scrapeWebpage`，不新增 HTTP 客户端

---

## 1. 功能定位

热点库是一个与「素材库」「项目」同级的顶级页面，让用户从"每日更新的中文社媒热点"出发创作短视频，解决"不知道做什么"的冷启动问题。核心动线：

```
用户进入热点库 → 按分类浏览热点卡片 → 点击"用这个热点创作"
  → 后端生成项目、注入热点上下文、标记 workflowMode='idea'
  → 前端跳转 /projects/{id}
  → 大模型基于 IDEA_MODE_PROMPT_CONTEXT 接住用户的首条消息，开始引导
```

热点库不是信息流产品，它是创作工作流的**入口**——卡片设计服务于"这个话题值不值得拍"的快速决策。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  定时管道 (node-cron, 每日 05:00)                            │
│  + 冷启动兜底 (server 启动时若 hotspots 表无 active 数据)      │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌─────────┐  │
│  │ 种子查询  │ → │ googleSearch│→│ scrapeWebpage│→│ 大模型  │  │
│  │ 生成器    │   │ (复用)     │   │ (复用)     │   │ 结构化  │  │
│  └──────────┘   └──────────┘   └────────────┘   │ 输出    │  │
│                                                  └────┬────┘  │
│                                                       ↓       │
│                                               ┌──────────┐    │
│                                               │ hotspots │    │
│                                               │  (MySQL) │    │
│                                               └──────────┘    │
└──────────────────────────────────────┬──────────────────────┘
                                        │
         ┌──────────────────────────────┴──────────────────────┐
         ↓                                                     ↓
┌──────────────────┐                              ┌────────────────────┐
│ GET /api/hotspots │                              │ POST /api/projects/│
│ (列表 + 分类筛选)  │                              │     from-hotspot   │
└────────┬─────────┘                              └──────────┬─────────┘
         ↓                                                     ↓
┌──────────────────┐                              ┌────────────────────┐
│  前端: /hotspots  │ ─ "用这个热点创作" 按钮 ─→  │ 建项目 + 注入 user  │
│   (React Router) │                              │ message + idea 模式 │
└──────────────────┘                              └────────────────────┘
```

三个关键边界：
- **采集管道只用复用的工具**，不自己写爬虫（合规、不重复造轮子）
- **DB 是唯一真实状态**，内存缓存只是可选旁路（见 §4.7）
- **前端不感知管道**，只查 API

---

## 3. 数据模型

新增一张表 `hotspots`，跟现有 schema 风格一致（UUID + varchar + JSON + 时间戳）。

在 `packages/db/src/schema.ts` 追加：

```ts
export const hotspots = mysqlTable('hotspots', {
  id: varchar('id', { length: 36 }).primaryKey(),          // UUID
  batchId: varchar('batch_id', { length: 36 }).notNull(),  // 同一次抓取的热点共享一个 batchId
  isActive: boolean('is_active').default(true).notNull(),  // 当前批次=true，被新批次取代后置 false
  category: varchar('category', { length: 40 }).notNull(), // 大模型生成，非枚举
  title: varchar('title', { length: 200 }).notNull(),      // 热点标题，用于卡片主标题
  description: text('description').notNull(),              // 1-3 句话描述，用于卡片副文案
  source: varchar('source', { length: 20 }).notNull(),     // 'xiaohongshu' | 'wechat' | 'douyin' | 'bilibili' | 'mixed'
  sourceUrls: json('source_urls').$type<string[]>().notNull(), // 原始搜索/抓取命中的 URL 列表（0-5 个）
  heatMetric: varchar('heat_metric', { length: 50 }).notNull(), // 展示字符串，如 "10万+讨论 / 周增 45%"
  heatScore: int('heat_score').notNull(),                  // 大模型打分 0-100，用于排序（不展示给用户）
  rationale: text('rationale'),                            // 大模型说明"为什么是热点"，仅内部审计用
  rawContext: json('raw_context'),                         // 保留抓取到的原始片段（可删，便于 debug）
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  activeByCategory: index('idx_hotspots_active_category').on(t.isActive, t.category, t.heatScore),
  batchIdx: index('idx_hotspots_batch').on(t.batchId),
}));
```

字段决策备注：
- `source` 是**粗分来源**，只有五个值；`sourceUrls` 才是真实命中链接（可跨平台）。这样前端展示图标简单（只看 `source`），而溯源审计用 `sourceUrls`
- `heatMetric` vs `heatScore`：前者是大模型**口语化整理**的展示字符串（"10万+播放 / 本周上升 45%"），后者是排序用的数字。用户要求"一个字段存储热度"——我们对外展示一个字段（`heatMetric`），但内部多存一个分数用于 ORDER BY，是实现细节，不破坏产品定义
- `batchId + isActive`：用批次号做原子切换。新批次**全部**成功写入后，再把旧批次的 `isActive` 置为 `false`，保证 UI 永远看得到一份完整数据
- 不加外键关系：热点和项目不建硬关联（项目里如果想回溯源头，在 `uiMessages` 的首条注入里已经有 `hotspotId` 文本，够用）

迁移文件通过 `cd packages/db && pnpm drizzle-kit generate` 生成。

---

## 4. 数据采集管道（核心）

### 4.1 管道入口

**新文件** `apps/server/src/jobs/hotspots-pipeline.ts`（完全替换旧的 `fetch-hot-topics.ts`）。导出两个函数：

- `runHotspotsPipeline(): Promise<{ inserted: number; batchId: string }>`——单次完整管道
- `startHotspotsPipeline()`——注册 cron + 启动兜底，被 `apps/server/src/index.ts` 调用

启动兜底逻辑（**仅在无有效数据时触发**，区别于旧实现的"每次启动都跑"）：

```
startHotspotsPipeline() {
  cron.schedule(CRON_SCHEDULE, runHotspotsPipeline);  // 每日定时

  // 异步检查冷启动（不阻塞 server bootstrap）
  setImmediate(async () => {
    const activeCount = await db.select({ c: count() })
      .from(hotspots).where(eq(hotspots.isActive, true));
    if (activeCount[0].c === 0) {
      console.log('[Hotspots] 冷启动: 无活跃热点, 立即拉取');
      runHotspotsPipeline().catch(err => console.error('[Hotspots] 冷启动失败', err));
    }
  });
}
```

旧的 `fetch-hot-topics.ts` 和 `utils/hot-topics.ts`（内存缓存）一并删除，注册点从 `index.ts` 改为 `startHotspotsPipeline()`。

### 4.2 种子查询生成

因为分类由大模型自由生成（不走白名单），种子查询**不按分类**展开，而是按**平台 × 时间修饰**展开。默认 12 条种子查询（可 env 调参）：

| 平台权重 | 查询模板（示例） | 预期命中 |
|---|---|---|
| 小红书 (5 条) | `site:xiaohongshu.com 本周热门话题`、`小红书 {月份} 爆款笔记`、`小红书 热榜 趋势`、`小红书 {月份} 高赞话题`、`小红书 这周爆火` | xiaohongshu.com 域名 |
| 微信 (4 条) | `site:mp.weixin.qq.com 10万+ {月份}`、`微信公众号 本周爆款`、`视频号 热门话题`、`微信 爆文 {月份}` | mp.weixin.qq.com / weixin.qq.com |
| 抖音 (2 条) | `抖音 本周热榜`、`抖音 挑战赛 {月份}` | douyin.com / 第三方榜单页 |
| B站 (1 条) | `bilibili 本周排行榜 {月份}` | bilibili.com |

`{月份}` 在运行时注入当前年月（如 "2026 年 4 月"），提高时效性。

种子查询数量与权重分配通过环境变量可调（见 §9），默认值在代码顶部 `const SEED_QUERIES = [...]` 静态定义。

### 4.3 抓取流程

```
对每条种子 q in SEED_QUERIES:
  results = await googleSearch(q, pageSize=5)
  for r in results:
    if domain(r.link) in ALLOWED_DOMAINS:
      // 白名单: xiaohongshu.com, mp.weixin.qq.com, weixin.qq.com,
      //        douyin.com, bilibili.com, 常见榜单站 (toutiao.com, zhihu.com 兜底)
      push { url: r.link, title: r.title, snippet: r.snippet, source: classifyDomain(r.link) }

// 并发抓取正文（限流 3 并发，避免 Firecrawl 配额爆）
await pMap(candidates, async c => {
  c.markdown = await scrapeWebpage(c.url);  // 可能返回 null，保留
}, { concurrency: 3 });

// 过滤：保留 markdown 非空，或者 snippet 足够长（>= 60 字）的候选
const corpus = candidates.filter(c => c.markdown || c.snippet.length >= 60);
```

**故障容错**：
- 单条查询 / 单页抓取失败 → 只记 warn 日志，**不**中断整个管道
- `googleSearch` 已内置 `p-retry`（3 次），`scrapeWebpage` 抓失败返回 null，不 throw
- 若 `corpus.length < MIN_CORPUS`（默认 5）→ 放弃本次批次，保留旧数据继续服役，error 日志告警

### 4.4 大模型结构化理解

用 **Vercel AI SDK 的 `generateObject`**（非 stream），一次性喂所有 corpus，输出结构化热点数组。

**为什么不用 streamObject**：管道是后台作业，无前端消费；一次拿完整结果便于写 DB 事务。

**模型选择**：默认 `gpt-4.1` 或同级（配置在 `HOTSPOTS_LLM_MODEL` 环境变量，复用 `OPENAI_API_KEY` + `OPENAI_BASE_URL`）。成本估算：每日 1 次，输入 ~30K token（12 个搜索结果 × 2-3K markdown）、输出 ~5K token，按当前 OpenAI 兼容接口定价约 $0.2-0.5 / 天。用户可根据预算切到更便宜的模型。

**Zod schema**（核心）：

```ts
const HotspotSchema = z.object({
  title: z.string().min(4).max(60),
  description: z.string().min(10).max(200),
  category: z.string().min(2).max(20),   // 大模型自由给
  source: z.enum(['xiaohongshu', 'wechat', 'douyin', 'bilibili', 'mixed']),
  sourceUrls: z.array(z.string().url()).min(1).max(5),
  heatMetric: z.string().min(2).max(50), // 例 "8.5万讨论 / 本周+120%"
  heatScore: z.number().int().min(0).max(100),
  rationale: z.string().max(200),
});
const PipelineOutputSchema = z.object({
  hotspots: z.array(HotspotSchema).min(8).max(30),
});
```

**prompt 骨架**（放在同目录 `hotspots-prompt.ts`）：

```
你是一个中文社媒趋势分析师。基于下方抓取到的 {N} 份原始资料（来自小红书、微信公众号、视频号、抖音、B站），
提炼出 10-20 个目前最具传播潜力的独立热点话题。

【已有分类参考】（优先复用下列分类标签，若新热点确实无法归入，可创建新分类，但新分类需言之有物）：
{EXISTING_CATEGORIES}

【输出要求】
1. title：一句话概括，不超过 30 字，不含"#"、引号、emoji
2. description：1-3 句，说明热点是什么、为什么火，不含平台隐性推销语
3. category：2-8 字中文名词性短语，如"美妆教程"、"职场吐槽"。优先复用参考列表
4. source：heat 命中最强的那个平台；若跨平台，用 'mixed'
5. sourceUrls：2-5 个最有代表性的原始链接（从原始资料里选）
6. heatMetric：口语化热度描述，必须含一个数字维度 + 一个趋势维度，如 "8.5万讨论 / 本周+120%"
7. heatScore：0-100 整数，综合传播潜力打分，用于排序
8. rationale：一句话说明你为什么认为这是热点
9. 去重：同一话题只留一条，合并多个来源到 sourceUrls
10. 按 heatScore 降序输出

【原始资料】
{CORPUS_MARKDOWN}
```

### 4.4 分类收敛（关键：防止大模型漂移）

因为是"自由分类"，必须防止每天 LLM 造一堆同义不同名的标签（"美妆教程" / "美妆" / "化妆分享" / "彩妆"）。策略：

1. **每次运行前**，从 DB 查 `SELECT category, COUNT(*) FROM hotspots WHERE isActive=true GROUP BY category ORDER BY COUNT(*) DESC LIMIT 30`
2. **把已有分类列表注入 prompt**（§4.4 里的 `{EXISTING_CATEGORIES}`），明确"优先复用"
3. 冷启动时列表为空，LLM 完全自由创建——这是可接受的初始化代价
4. **可选后续迭代**：加一个月度清理 cron，用 LLM 跑一次"把近义分类合并"建议，生成 diff 让用户手工 confirm 后 UPDATE。首版不做

### 4.5 去重

同一批次内去重交给 LLM（prompt 第 9 条）。跨批次无需处理——旧批次整体 `isActive=false`，前端看不到重复。

如果未来要做"热点延续追踪"（某话题连续多周上榜）再引入 `hotspot_groups` 表，现在不做。

### 4.6 批次写入（原子切换）

```ts
async function runHotspotsPipeline() {
  const batchId = crypto.randomUUID();
  const corpus = await collectCorpus();         // §4.3
  if (corpus.length < MIN_CORPUS) throw ...;
  const { hotspots: items } = await generateObject({ schema: PipelineOutputSchema, ... });  // §4.4

  await db.transaction(async tx => {
    // 插新批次
    await tx.insert(hotspots).values(items.map(it => ({
      id: crypto.randomUUID(),
      batchId,
      isActive: true,
      ...it,
      rawContext: corpus.find(c => it.sourceUrls.includes(c.url)) ?? null,
    })));
    // 把旧批次置为 inactive
    await tx.update(hotspots)
      .set({ isActive: false })
      .where(and(eq(hotspots.isActive, true), ne(hotspots.batchId, batchId)));
  });

  // 软清理：删除 30 天前的 inactive 记录，避免表无限膨胀
  await db.delete(hotspots).where(
    and(eq(hotspots.isActive, false), lt(hotspots.fetchedAt, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`))
  );
}
```

- 保留 30 天历史批次便于审计和回滚；活跃集永远单批次
- 事务保证："旧数据消失"和"新数据出现"同时发生，前端不会看到空列表中间态

### 4.7 对 chat 背景知识的影响

旧实现把每日热点 markdown 塞给 chat 当 system prompt 补充。新方案做法：

- **删除** `utils/hot-topics.ts`（全局内存字符串）以及 chat.ts 里对 `globalHotTopicsCache` 的引用
- 若后续需要"让 chat 感知今日热点"，在 `chat.ts` 的 system prompt 构建处**按需**执行 `SELECT title, category FROM hotspots WHERE isActive=true ORDER BY heatScore DESC LIMIT 10` 拼成一段 markdown 注入。这比内存字符串更新鲜，也不用双向同步
- 首版**不做**这一步（用户没有提这个诉求；IDEA_MODE_PROMPT_CONTEXT 已经说"从今日热点中推荐话题"——可以在下个迭代接上）

---

## 5. 调度与冷启动

| 项 | 值 | 理由 |
|---|---|---|
| cron 表达式 | `'0 5 * * *'`（每日 05:00） | 错开现有的 03:00 OSS 清理、04:00 旧热点任务（删）；凌晨人少，API 配额稳定 |
| 冷启动触发 | `hotspots WHERE isActive=true` 计数为 0 时 | 避免每次 server 重启都吃 LLM 成本；只有**真的没数据**才跑 |
| 失败策略 | log error + 保留旧批次 active | 宁可数据过期一天，不要首页空白 |
| 超时 | 总预算 10 分钟（抓取 + LLM） | Firecrawl 并发 3 条，单条 30s，LLM 一次调用 2-3 分钟 |
| 幂等 | 同时只允许一个 pipeline 运行 | 用简单的 in-process `let isRunning = false` 守门；跨进程不保证（当前 server 单实例部署） |

环境变量可覆盖：`HOTSPOTS_CRON_SCHEDULE`、`HOTSPOTS_MIN_CORPUS`、`HOTSPOTS_LLM_MODEL`（见 §9）。

---

## 6. 后端 API

新文件 `apps/server/src/routes/hotspots.ts`，挂在 `app.route('/api/hotspots', hotspotsRouter)`。

### 6.1 `GET /api/hotspots`

Query 参数：
- `category?: string` — 按分类过滤
- `source?: string` — 按来源过滤
- `limit?: number`（默认 50，最大 100）

返回：
```json
{
  "hotspots": [
    {
      "id": "...",
      "category": "美妆教程",
      "title": "显白冷棕发色自己染的教程",
      "description": "...",
      "source": "xiaohongshu",
      "heatMetric": "5.8 万讨论 / 本周+80%",
      "fetchedAt": "2026-04-23T05:00:02Z"
    }
  ],
  "categories": [
    { "name": "美妆教程", "count": 8 },
    { "name": "职场吐槽", "count": 3 }
  ]
}
```

排序：`ORDER BY heatScore DESC`，默认 WHERE `isActive=true`。

**不返回** `sourceUrls` / `rationale` / `rawContext`——前端不需要，避免响应膨胀（`rawContext` 可能很大）。

**不返回** `heatScore`——排序用，不展示。

### 6.2 `POST /api/projects/from-hotspot`

Body：`{ hotspotId: string }`

行为（单事务）：
1. `SELECT * FROM hotspots WHERE id = ? AND isActive = true`；找不到返回 404
2. `crypto.randomUUID()` 得到 `newProjectId`
3. 组装注入模板（§7）成第一条 user message
4. `INSERT INTO projects` 带上：
   - `id: newProjectId`
   - `title: 热点.title`（前端可以再改名）
   - `workflowMode: 'idea'`
   - `uiMessages: [{ role: 'user', id: crypto.randomUUID(), content: 注入文本 }]`
5. 返回 `{ success: true, id: newProjectId }`

前端拿到 id 后 `navigate('/projects/' + id)`。进入项目页面后，`useChat` 加载已有 `initialMessages`，第一条是 user message → 自动触发大模型回复（结合 `IDEA_MODE_PROMPT_CONTEXT`）。

**为什么不走通用 `POST /api/projects` + PATCH**：
- 需要**同一事务**内完成创建 + 注入，避免中间态（一个空项目）
- 注入 user message 是服务端权威行为（前端不应该构造包含 hotspot 内部字段的消息）

---

## 7. 创建项目时注入的 user message 模板

这条 user message 进入 `uiMessages[0]`，会被大模型视为用户的第一句话。模板（服务端生成，字段替换）：

```
我想基于下面这个热点做一个短视频，帮我规划一下。

【热点标题】{hotspot.title}
【分类】{hotspot.category}
【来源】{source_label}   // xiaohongshu → "小红书", wechat → "微信公众号/视频号", etc.
【热度】{hotspot.heatMetric}
【背景描述】{hotspot.description}

请基于以上信息，帮我生成一个拍摄大纲。
```

设计要点：
- 用**第一人称**写，让大模型像面对用户的自然请求那样回应
- 不暴露 `hotspotId` 或内部字段名（`heatScore`、`rationale`、`sourceUrls`）——这些是内部信号，给 LLM 只会引入噪声
- 结尾明确请求"生成拍摄大纲"，触发 IDEA 模式的 `updateOutline` 工具链
- 不依赖 IDEA_MODE_FOLLOWUP（因为那是"用户点按钮选工作流"后的提示语）——我们跳过了选按钮这一步，直接注入一条 user message，大模型通过 `workflowMode='idea'` + system prompt 的 `IDEA_MODE_PROMPT_CONTEXT` 自然走到正确流程

---

## 8. 前端

### 8.1 新路由

`apps/desktop/app/routes.ts` 追加：
```ts
route("hotspots", "routes/hotspots.tsx"),
```

文件 `apps/desktop/app/routes/hotspots.tsx`：
- `loader`：拉 `GET /api/hotspots`
- 组件：
  - 顶部分类 tabs（`categories` 数组渲染；"全部" tab 默认选中）
  - 卡片网格：展示 title / description / 来源 icon / `heatMetric` badge / 分类 tag
  - 每张卡片一个 **"用这个热点创作"** 按钮
- Mutation：`POST /api/projects/from-hotspot` → `navigate(/projects/${id})`
- 空状态：如果 `hotspots.length === 0`（通常是冷启动期），显示"正在拉取今日热点，稍等..."，轮询刷新（30s 一次）

### 8.2 Sidebar 入口

`apps/desktop/app/components/GlobalSidebar.tsx` 在 `/assets` 条目旁追加一个 Link：
```
<Link to="/hotspots" title="热点库"><Flame /></Link>
```
图标用 lucide-react 的 `Flame`（或 `TrendingUp`，看视觉风格）。

### 8.3 来源图标映射

`source → 图标 + 展示名` 映射硬编码在前端常量：
```ts
const SOURCE_META = {
  xiaohongshu: { label: '小红书', color: 'bg-red-500' },
  wechat:      { label: '微信',   color: 'bg-green-500' },
  douyin:      { label: '抖音',   color: 'bg-black' },
  bilibili:    { label: 'B站',    color: 'bg-pink-500' },
  mixed:       { label: '多平台', color: 'bg-gray-500' },
};
```

Tailwind 类要同时给 light / dark 两套（CLAUDE.md 硬规则）。

---

## 9. 环境变量

`apps/server/src/env.ts` 追加（全部 optional，不配置就用默认）：

```ts
HOTSPOTS_CRON_SCHEDULE: z.string().default('0 5 * * *'),
HOTSPOTS_MIN_CORPUS: z.coerce.number().int().min(1).default(5),
HOTSPOTS_LLM_MODEL: z.string().default('gpt-4.1'),
HOTSPOTS_MAX_ITEMS: z.coerce.number().int().min(1).default(20),
```

依赖已有的：`SEARCHAPI_KEY`、`FIRECRAWL_API_KEY`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`。若 `SEARCHAPI_KEY` 或 `FIRECRAWL_API_KEY` 未配置 → 管道启动时打 warn，跳过定时注册（不要让整个 server 启动失败）。

---

## 10. 实施阶段建议

按**能否独立验收**拆分，不追求一次性合并：

**阶段 1：后端数据层 + 管道**（不含前端）
- schema.ts 加 `hotspots` 表 → `drizzle-kit generate`
- 新建 `jobs/hotspots-pipeline.ts`、`utils/hotspots-prompt.ts`
- 删除 `jobs/fetch-hot-topics.ts`、`utils/hot-topics.ts`
- index.ts 切换注册
- 人工触发一次 `runHotspotsPipeline()` 验证写入 ≥ 10 条、分类合理
- 验收：`SELECT * FROM hotspots WHERE isActive=true` 肉眼看数据质量

**阶段 2：后端 API**
- `routes/hotspots.ts` 两个接口
- Postman / curl 验收
- 冷启动逻辑验证：drop 表后重启 server，观察 5 秒内自动拉取

**阶段 3：前端页面**
- 路由 + 页面 + 卡片
- Sidebar 入口
- 空状态 + 轮询
- 验收：UI 自然浏览 → 点击创建 → 跳转到 chat → 大模型合理回复

**阶段 4（可选，下一迭代）**
- 把 hotspots 反哺到 chat system prompt（§4.7 后半段）
- 分类合并 cron（§4.4 末尾）
- 用户收藏 / 忽略热点

---

## 11. 风险与权衡

| 风险 | 应对 | 备注 |
|---|---|---|
| 小红书 / 微信没有公开 API，Google 搜索里命中率不高 | 种子查询多条 + 站外榜单（如新榜、飞瓜）兜底；corpus 不够就放弃本次 | 首期可能出现"抖音/B 站占比偏高"，长期观察再调种子 |
| Firecrawl 抓小红书可能被反爬拒绝 | 单页失败返回 null，已有容错；保留 snippet 作降级信号 | 若长期抓不到小红书正文，考虑引入更强的抓取服务（超出本方案） |
| 大模型分类漂移（同义词爆炸） | §4.4 注入已有分类 + 月度合并 job | 首版容忍；月度合并在阶段 4 |
| 每日 LLM 成本 | 模型可通过 env 切换；单次 ~$0.2-0.5 | 可接受 |
| 爬取合规性 | 只抓搜索引擎提供的公开页面 + Firecrawl（第三方服务承担合规），不爬账号主页、不绕反爬 | 不碰灰色地带 |
| 冷启动空窗 | 前端显示"正在拉取..."轮询 | 首次拉取 3-5 分钟，用户可感知但可接受 |
| 热点不够新鲜 | cron 每日跑；可手动触发一个 admin 接口（暂不做） | 阶段 4 再看 |
| 管道在 LLM 幻觉下生成虚假热点 | Zod schema 卡最低字段数；保留 `sourceUrls` + `rawContext` 可审计 | 若真出现用户举报的假热点，加管理后台删除（不在本方案内） |

---

## 12. 开放问题（留给后续决策，不阻塞本方案落地）

- **热点详情页**：首版不做，卡片一键进 chat 就够。若用户反馈想"先看看热点详情再决定做不做"，再加 `/hotspots/{id}` 页面展示 `sourceUrls` 和 `rawContext`
- **用户个性化**：现在所有用户看同一份全局热点。若未来引入用户账号体系，可做"根据历史项目分类过滤感兴趣分类"
- **热点和素材的联动**：热点驱动创作进入 chat 后，大模型可能需要搜素材。现有 `search_assets` 工具已经能工作，不需要额外打通
- **管理后台**：暂不需要管理员删/隐藏热点的能力；靠 LLM 自律 + 每日刷新 + 30 天自动淘汰
- **小红书/微信数据源进一步优化**：若 Firecrawl 抓不动，评估接入新榜 / 飞瓜 API（付费），本方案先不选

---

## 13. 关键文件清单

实现阶段将新建或修改：

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/db/src/schema.ts` | 改 | 追加 `hotspots` 表 |
| `packages/db/drizzle/0XXX_*.sql` | 新增 | drizzle-kit 生成的迁移 |
| `apps/server/src/jobs/hotspots-pipeline.ts` | 新增 | 管道入口 |
| `apps/server/src/utils/hotspots-prompt.ts` | 新增 | LLM prompt 模板常量 |
| `apps/server/src/routes/hotspots.ts` | 新增 | 两个 API |
| `apps/server/src/routes/projects.ts` | 改 | 追加 `from-hotspot` 路由 |
| `apps/server/src/index.ts` | 改 | 替换任务注册 |
| `apps/server/src/env.ts` | 改 | 追加 4 个可选变量 |
| `apps/server/src/jobs/fetch-hot-topics.ts` | **删** | 被替换 |
| `apps/server/src/utils/hot-topics.ts` | **删** | 被替换 |
| `apps/desktop/app/routes.ts` | 改 | 追加 `/hotspots` 路由 |
| `apps/desktop/app/routes/hotspots.tsx` | 新增 | 页面 |
| `apps/desktop/app/components/GlobalSidebar.tsx` | 改 | 追加入口 |
