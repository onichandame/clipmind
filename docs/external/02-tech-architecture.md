# ClipMind · 技术架构文档 V1

**版本**:V1 (2026-05)
**适用范围**:Phase 0-4 工程实施
**状态**:待启动

---

## 0. 文档定位

这是 ClipMind 下一阶段的**技术架构总图**。涵盖:

- 数据模型(DB schema 设计)
- 后端 API 设计
- 前端架构(状态管理、路由、组件结构)
- AI 调用链路与 Workspace context 注入策略
- Rust 端关键模块

**这份文档不涉及具体代码**(那是实施指令文档的事),只规定**"系统该长什么样"**。

---

## 1. 数据模型

### 1.1 完整 schema 概览

```
workspaces                  ← 工作空间(组织)
  └── workspace_members     ← 成员关系
  └── workspace_settings    ← 基础信息 / 品牌画像 / 素材偏好
  └── products              ← 产品矩阵
  └── invite_links          ← 邀请链接

assets                      ← 独立素材资产
  └── project_assets        ← 项目-素材多对多关联

projects                    ← 项目(visibility: personal/team)
  └── project_messages      ← 项目对话消息
  └── project_widgets       ← 对话内嵌 widget 数据

templates                   ← 模板库(visibility: personal/team)
  └── template_products     ← 模板-产品多对多关联(适用产品)
  └── template_usage_log    ← 使用记录(用过几次)

users(已存在)              ← 用户账号
  └── user_workspace        ← 当前所在 workspace(单选)
```

### 1.2 关键表详细设计

#### workspaces

```sql
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY,
  name            varchar(120) NOT NULL,
  industry        varchar(50),
  positioning     text,          -- 一句话定位
  logo_url        varchar(500),
  created_at      timestamp NOT NULL,
  updated_at      timestamp NOT NULL
);
```

#### workspace_members

```sql
CREATE TABLE workspace_members (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            enum('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at       timestamp NOT NULL,
  UNIQUE(workspace_id, user_id)
);
CREATE INDEX idx_wm_user ON workspace_members(user_id);
CREATE INDEX idx_wm_workspace ON workspace_members(workspace_id);
```

**约束**:每个 workspace 至少保留 1 个 admin(在应用层校验)。

#### workspace_settings

存储品牌画像和素材偏好。设计为 1:1 跟 workspace,字段较多但变更不频繁,放在单表。

```sql
CREATE TABLE workspace_settings (
  workspace_id           uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- 品牌画像
  brand_persona          text,            -- AI 第一人称设定
  global_taboos          jsonb,           -- 禁忌话题 array<string>
  duration_preferences   jsonb,           -- ['30s', '60s']
  platforms              jsonb,           -- ['douyin', 'xhs']
  subtitle_style         varchar(50),
  
  -- 素材偏好
  voice_preferences      jsonb,           -- array<string>
  bgm_preferences        jsonb,           -- array<string>
  brand_colors           jsonb,           -- {primary: '#...', secondary: ['#...']}
  
  updated_at             timestamp NOT NULL
);
```

**为什么用 jsonb 而不是单独的子表**:这些字段都是简单 array<string>,极少独立查询,jsonb 简单且查询性能足够。

#### products(产品矩阵)

```sql
CREATE TABLE products (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            varchar(120) NOT NULL,
  brief           varchar(500) NOT NULL,        -- 一句话简介
  
  -- 目标用户(jsonb 内嵌)
  target_user     jsonb,           
  /* 结构示例:
    {
      "age_range": "16-19岁",
      "identity": ["高中生", "国际学校学生"],
      "pain_points": ["不知道怎么准备", "家长焦虑"],
      "decision_makers": ["家长", "学生本人"]
    }
  */
  
  selling_points  jsonb,                          -- array<string>
  visual_tone     enum('professional', 'warm', 'sincere', 'playful'),
  compliance      jsonb,                          -- 不能说什么 array<string>
  
  display_order   int DEFAULT 0,                  -- 列表排序
  created_at      timestamp NOT NULL,
  updated_at      timestamp NOT NULL
);
CREATE INDEX idx_products_workspace ON products(workspace_id);
```

#### invite_links

```sql
CREATE TABLE invite_links (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token           varchar(40) UNIQUE NOT NULL,    -- 用于 URL
  created_by      uuid NOT NULL REFERENCES users(id),
  expires_at      timestamp NOT NULL,             -- 7 天后
  revoked         boolean DEFAULT false,
  created_at      timestamp NOT NULL
);
CREATE UNIQUE INDEX idx_invite_token ON invite_links(token) WHERE revoked = false;
```

**生效约束**:同一 workspace 同一时间只能有 1 个有效 link(老的 revoke 掉)。

#### assets(独立素材资产)

```sql
CREATE TABLE assets (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- 文件元信息
  filename        varchar(255) NOT NULL,
  file_hash       varchar(64) NOT NULL,           -- SHA-256,去重用
  file_size       bigint NOT NULL,
  mime_type       varchar(50),
  duration_ms     int,                            -- 视频时长
  width           int,
  height          int,
  
  -- 存储位置
  oss_key_video   varchar(500),
  oss_key_audio   varchar(500),
  oss_key_thumb   varchar(500),
  
  -- AI 分析结果(异步填充)
  ai_analysis     jsonb,                          -- 见下方结构
  /* ai_analysis 结构:
    {
      "people": [{"role": "母亲", "age_range": "40-50"}],
      "scene": "客厅",
      "audio_quality": "clear",
      "emotions": ["沉重", "释怀"],
      "key_quotes": [
        {"text": "...", "start_ms": 42000, "end_ms": 68000}
      ],
      "shots": [...],          -- 镜头切分
      "is_b_roll": false       -- 是否空镜
    }
  */
  
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamp NOT NULL,
  deleted_at      timestamp,                      -- 软删
  
  UNIQUE(workspace_id, file_hash)                 -- 同 workspace 内文件去重
);
CREATE INDEX idx_assets_workspace ON assets(workspace_id) WHERE deleted_at IS NULL;
```

**关键变化**:
- ❌ 不再有 `project_id`(原 schema 强约束)
- ✅ 文件去重以 `(workspace_id, file_hash)` 为粒度
- ✅ 软删(支持 toast 撤销)

#### project_assets(关联表)

```sql
CREATE TABLE project_assets (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at        timestamp NOT NULL,
  added_by        uuid NOT NULL REFERENCES users(id),
  UNIQUE(project_id, asset_id)
);
CREATE INDEX idx_pa_project ON project_assets(project_id);
CREATE INDEX idx_pa_asset ON project_assets(asset_id);
```

#### projects(项目)

```sql
CREATE TABLE projects (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            varchar(255),
  
  visibility      enum('personal', 'team') NOT NULL DEFAULT 'personal',
  workflow_mode   enum('material', 'inspiration', 'template_clone', 'free'),
  
  -- 创作上下文
  product_id      uuid REFERENCES products(id) ON DELETE SET NULL,
  template_id     uuid REFERENCES templates(id) ON DELETE SET NULL,
  
  -- 元信息
  is_pinned       boolean DEFAULT false,
  pinned_at       timestamp,
  created_by      uuid NOT NULL REFERENCES users(id),
  last_edited_by  uuid REFERENCES users(id),
  last_edited_at  timestamp,
  
  created_at      timestamp NOT NULL,
  deleted_at      timestamp                     -- 软删
);
CREATE INDEX idx_projects_workspace ON projects(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_personal ON projects(workspace_id, created_by) WHERE visibility='personal' AND deleted_at IS NULL;
```

**关键约束**:
- 个人草稿:只 `created_by = current_user` 可访问
- 团队项目:所有 workspace 成员可访问
- API 层强制校验,不依赖前端

#### templates(模板库)

```sql
CREATE TABLE templates (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  name            varchar(255) NOT NULL,
  source_url      varchar(500),                   -- 来源链接
  source_meta     jsonb,                          -- {platform, author}
  
  template_type   enum('A', 'C') NOT NULL,        -- A=结构借鉴, C=逐镜对标
  visibility      enum('personal', 'team') NOT NULL DEFAULT 'personal',
  
  -- 模板内容(双层存储)
  summary         text,                           -- 人类可读摘要
  structure       jsonb NOT NULL,                 -- 结构化数据
  /* structure 结构:
    {
      "duration_target": 30,
      "hook": {...},
      "segments": [...],
      "shots": [...]   // 类型 C 用,A 可空
    }
  */
  
  saved_by        uuid NOT NULL REFERENCES users(id),
  created_at      timestamp NOT NULL,
  updated_at      timestamp NOT NULL,
  deleted_at      timestamp
);
CREATE INDEX idx_templates_workspace ON templates(workspace_id) WHERE deleted_at IS NULL;
```

#### template_products(适用产品关联)

```sql
CREATE TABLE template_products (
  template_id     uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY(template_id, product_id)
);
```

#### template_usage_log

```sql
CREATE TABLE template_usage_log (
  id              uuid PRIMARY KEY,
  template_id     uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  used_by         uuid NOT NULL REFERENCES users(id),
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  used_at         timestamp NOT NULL
);
CREATE INDEX idx_template_log_template ON template_usage_log(template_id);
```

---

## 2. 后端 API 设计

### 2.1 总体规范

- RESTful 风格,资源命名复数(`/api/workspaces/:id`)
- 所有 API 需要认证(已有的 JWT)
- 所有 API 自动注入 `workspace_id` context(从用户 session 拉)
- 所有写操作走权限中间件(check Admin/Member)
- 软删除接口和真删除接口分开

### 2.2 Workspace API

```
POST   /api/workspaces                 创建 workspace(注册时自动调用)
GET    /api/workspaces/current         获取当前用户的 workspace
PATCH  /api/workspaces/:id             更新基础信息(Admin)
DELETE /api/workspaces/:id             删除(Admin,危险操作,需要二次确认)
```

### 2.3 Workspace Settings API

```
GET    /api/workspaces/:id/settings    获取所有 settings
PATCH  /api/workspaces/:id/settings    更新(Admin)
```

### 2.4 Members API

```
GET    /api/workspaces/:id/members             成员列表
PATCH  /api/workspaces/:id/members/:userId     改角色(Admin)
DELETE /api/workspaces/:id/members/:userId     移除成员(Admin)

POST   /api/workspaces/:id/invite-link         生成邀请链接(Admin)
DELETE /api/workspaces/:id/invite-link         作废当前链接(Admin)
GET    /api/invite/:token                      公开:查看 workspace 简介
POST   /api/invite/:token/accept               加入 workspace(已登录用户)
```

### 2.5 Products API

```
GET    /api/products                  当前 workspace 的产品列表
POST   /api/products                  新建(Admin)
GET    /api/products/:id              详情
PATCH  /api/products/:id              更新(Admin)
DELETE /api/products/:id              删除(Admin)
```

### 2.6 Assets API(变化较大)

```
GET    /api/assets                    当前 workspace 的素材库
GET    /api/assets/:id                单个素材详情(含 AI 分析)
DELETE /api/assets/:id                软删
POST   /api/assets/:id/restore        撤销删除(toast 撤销)

POST   /api/assets/preflight          上传预检(hash 去重)
POST   /api/assets                    预登记新 asset
POST   /api/upload-token              签发 OSS 预签名

POST   /api/projects/:id/assets       关联素材到项目
DELETE /api/projects/:id/assets/:aid  解关联(不删素材)
```

**关键变化**:
- 上传 API 不再要求 `projectId`
- 关联通过独立 endpoint
- 删除资产时检查是否还被项目引用,有则只软删,无则可硬删

### 2.7 Projects API

```
GET    /api/projects                       当前 workspace 项目列表
                                           ?visibility=personal/team
                                           只看我可见的
POST   /api/projects                       新建(可指定 visibility)
GET    /api/projects/:id                   详情(权限校验)
PATCH  /api/projects/:id                   更新
PATCH  /api/projects/:id/visibility        草稿转团队 / 团队转草稿
DELETE /api/projects/:id                   软删
POST   /api/projects/:id/restore           撤销删除
```

### 2.8 Templates API

```
GET    /api/templates                      模板列表 ?visibility=&type=&product=
POST   /api/templates                      新建模板
GET    /api/templates/:id                  详情
PATCH  /api/templates/:id                  更新(saved_by 或 Admin)
DELETE /api/templates/:id                  删除(saved_by 或 Admin)
PATCH  /api/templates/:id/visibility       团队/私有切换
POST   /api/templates/:id/products         添加适用产品标签
POST   /api/templates/:id/use              记录使用(返回模板内容用于创作)
```

### 2.9 AI Workflows API

```
POST   /api/ai/inspiration                灵感探索流
POST   /api/ai/template-decompose         爆款拆解
POST   /api/ai/material-analyze           素材内容分析(异步)
POST   /api/ai/script-generate            生成完整剪辑方案

POST   /api/ai/messages/:projectId        在项目中发送消息(含 widget 渲染)
```

**关键设计**:这些都是流式接口,SSE 或 WebSocket。AI 输出可以包含特殊指令告诉前端"渲染 X widget"。

---

## 3. 前端架构

### 3.1 路由结构

```
/                          → 重定向到 /assistant
/login                     → 登录
/signup                    → 注册
/invite/:token             → 接受邀请

/assistant                 → AI 助理欢迎页(原 home)
/projects/:projectId       → 项目对话页
/library                   → 素材库
/templates                 → 模板库
/templates/:templateId     → 模板详情
/settings                  → Workspace 设置(Admin 才能进)
  /settings/basic
  /settings/products
  /settings/products/:productId
  /settings/brand
  /settings/media
  /settings/members
```

### 3.2 状态管理(zustand)

#### useWorkspaceStore

```typescript
{
  currentWorkspace: Workspace | null,
  members: Member[],
  products: Product[],
  settings: WorkspaceSettings,
  
  fetchWorkspace: () => Promise<void>,
  updateSettings: (...) => Promise<void>,
  refreshProducts: () => Promise<void>,
  ...
}
```

不持久化(每次进入应用从 API 拉,保证一致性)。

#### useLayoutStore(已存在)

```typescript
{
  sidebarExpanded: boolean,    // 持久化
}
```

#### useToastStore(已存在)

通用 toast 队列。

### 3.3 组件结构

```
apps/desktop/app/
├── components/
│   ├── Sidebar.tsx                    主 sidebar(单栏)
│   ├── DropdownMenu.tsx               通用 dropdown
│   ├── Toast.tsx                      toast 系统
│   ├── workspace/
│   │   ├── WorkspaceHeader.tsx        sidebar 顶部 brand
│   │   ├── ProductPicker.tsx          产品选择 widget(对话内用)
│   │   └── InviteLinkCard.tsx         邀请链接 UI
│   ├── widgets/                       对话内嵌 widget
│   │   ├── AssetPickerWidget.tsx      已存在
│   │   ├── TemplateAnalysisWidget.tsx 爆款拆解过程
│   │   ├── TemplateStructureWidget.tsx 模板结构展示/编辑
│   │   ├── InspirationCardsWidget.tsx 灵感卡列表
│   │   ├── SeriesOutlineWidget.tsx    系列大纲
│   │   ├── AssetAnalysisWidget.tsx    素材内容分析
│   │   ├── PlanComparisonWidget.tsx   多方案对比
│   │   ├── ScriptShotListWidget.tsx   分镜表
│   │   └── SaveConfirmWidget.tsx      保存确认
│   └── chat/
│       ├── ChatPanel.tsx              对话主容器(已存在)
│       └── MessageRenderer.tsx        消息+widget 渲染
├── routes/
│   ├── home.tsx                       → 重定向
│   ├── assistant.tsx                  AI 助理欢迎页
│   ├── projects.$projectId.tsx        项目对话(主战场)
│   ├── library.tsx                    素材库
│   ├── templates._index.tsx           模板库列表
│   ├── templates.$templateId.tsx      模板详情
│   └── settings/                      Workspace 设置(嵌套路由)
│       ├── _layout.tsx
│       ├── basic.tsx
│       ├── products._index.tsx
│       ├── products.$productId.tsx
│       ├── brand.tsx
│       ├── media.tsx
│       └── members.tsx
├── store/
│   ├── useWorkspaceStore.ts
│   ├── useLayoutStore.ts            已存在
│   └── ...
└── lib/
    ├── route-helpers.ts             已存在
    ├── asset-import.ts              已存在,改 projectId 为可选
    └── workspace-context.ts         workspace context 拼装(供 AI)
```

### 3.4 Widget 渲染机制

ChatPanel 接收 AI 消息,如果消息体含 widget 指令:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "好的,我看一下这条小红书。" },
    { "type": "widget", "name": "TemplateAnalysis", "data": {...} }
  ]
}
```

`MessageRenderer` 根据 `name` 渲染对应的 widget 组件。每个 widget 是独立 React 组件,接收 `data` props,可以有自己的内部交互(用户编辑、点按钮)。

Widget 用户交互通过统一的 `widgetAction(action, payload)` 反馈到对话流——本质上是发一条新消息(可能是隐藏的元消息)。

---

## 4. AI 调用链路

### 4.1 Workspace Context 注入

每次 AI 调用前,后端从 workspace 拉取相关数据,拼装成 system prompt 头部。

#### 完整 context 模板

```
## 当前工作空间上下文

工作空间:{workspace.name}
行业:{workspace.industry}
内容定位:{workspace.positioning}

## 品牌画像
品牌人设:{settings.brand_persona}
全局禁忌话题:
- {taboo_1}
- {taboo_2}

视频通用规格:
- 时长偏好:{settings.duration_preferences}
- 平台分发:{settings.platforms}
- 字幕样式:{settings.subtitle_style}

## 当前服务的产品(用户在 UI 选定的)
产品名:{product.name}
简介:{product.brief}

目标用户:
- 年龄:{product.target_user.age_range}
- 身份:{product.target_user.identity}
- 痛点:{product.target_user.pain_points}
- 决策人:{product.target_user.decision_makers}

卖点:
- {selling_point_1}
- {selling_point_2}

视觉调性:{product.visual_tone} ({tone_description})

合规口径(不能说什么):
- {compliance_1}
- {compliance_2}

## 素材偏好
配音音色:{voice_preferences}
BGM 风格:{bgm_preferences}
```

### 4.2 Token 优化

如果用户没选定具体产品,**只注入 workspace 基础信息 + 品牌画像**,不塞产品矩阵(可能很多个,token 爆)。

如果选了产品,只注入**那一个**产品的完整画像。

如果是模板创作,**额外注入**模板的 structure 字段。

### 4.3 缓存

Workspace context 数据相对稳定(产品矩阵和品牌画像变更频率低),前端缓存 + 后端缓存(Redis,TTL 5 分钟)。

### 4.4 更新通知

管理员改了产品矩阵后,**正在进行的对话不变**(用旧 context),新对话才用新数据。这避免对话中途上下文突变。

### 4.5 流式响应与 widget 交错

AI 响应是流式的。文本 chunk 实时显示;widget 必须等 chunk 完整(因为 JSON 不能流式渲染)。

策略:
- AI 先输出文本"好的,我来分析..."
- 文本完成后输出 `[widget:start]` 信号
- 后端拼好完整 widget JSON 后发出
- 前端渲染 widget
- 继续后续文本

---

## 5. Rust 端关键模块

### 5.1 已有模块(保留)

- `process_video_asset`:视频处理(SHA-256、FFmpeg 分离音轨、生成缩略图、上传 OSS)
- `tauri-plugin-updater`:自动更新

### 5.2 需要修改

#### `process_video_asset`

- ✅ `project_id` 改为可选参数
- ✅ 上传完成后调用新 API `POST /api/assets`(不带 project_id),拿到 asset_id
- ✅ 如果用户在某项目内上传(传了 project_id),额外调 `POST /api/projects/:id/assets`
- ✅ 触发异步 AI 分析(调后端 API,后端再调 AI 服务)

### 5.3 新增模块

#### `analyze_asset`(可选,Phase 后期)

- 接收 asset_id
- 在 Rust 端调用本地 AI 模型 / 远程视觉 API
- 提取关键帧、识别场景、提取对白
- 写回 `assets.ai_analysis` 字段

如果 AI 分析做服务端,Rust 端不需要这个模块。

---

## 6. 关键架构决策汇总

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 多租户实现 | 所有数据加 workspace_id,中间件强制隔离 | 标准做法,工程简单 |
| 2 | 项目可见性 | 字段 visibility + API 层校验 | 简单清晰,无需独立 ACL 系统 |
| 3 | 素材去重 | (workspace_id, file_hash) UNIQUE | 同 workspace 内去重,不跨 workspace |
| 4 | 软删除 | 关键资源都用 deleted_at + restore 接口 | 配合 toast 撤销 UX |
| 5 | 邀请机制 | 数据库存 token + 7 天 TTL | 不依赖邮件系统,工程简单 |
| 6 | Widget 数据 | 内嵌 message JSON 而非独立表 | 跟消息生命周期绑定,无孤儿 widget |
| 7 | AI context 注入 | 后端拼装 + 前端缓存 + Redis 二级缓存 | 性能与一致性平衡 |
| 8 | 流式 + widget | 文本流式 + widget 完整体一次性 | JSON 不能流式 |
| 9 | 模板 structure | jsonb 而非独立表 | 灵活,变更频繁 |
| 10 | 产品矩阵 | 独立表(不嵌入 workspace_settings) | 数量可变,需要独立 CRUD |

---

## 7. 数据迁移路径(Phase 0)

由于**当前没有真实用户**,迁移可以激进:

1. 备份现有 dev 数据库(防万一)
2. 改 schema(增加 workspaces 等新表)
3. 写 migration 脚本:
   - 现有用户全部加入一个新建的"默认 workspace"(或每人一个,看实际情况)
   - 现有 project_assets 表数据迁移到新的 assets + project_assets 双表结构
   - 现有 projects 加 visibility 默认 'personal'
4. 跑 migration,验证
5. 删除旧表(确认迁移成功后)

---

## 8. 性能与扩展性预估

### 8.1 当前规模假设

- 用户:< 100
- 单 workspace 项目:< 200
- 单 workspace 素材:< 500
- 单 workspace 模板:< 50

### 8.2 性能关注点

- AI context 拼装(每次 AI 调用)→ 必须缓存
- 项目列表 + 素材分组 → 加索引,前端虚拟滚动(已有 IntersectionObserver)
- 模板库筛选 → 前端做(数量小)

### 8.3 长期扩展(超出本期)

- 单 workspace 数据量超过 1 万项目时,需要分页 + 索引优化
- 多 workspace 切换时,需要 workspace 切换上下文管理
- 实时协作时,需要引入 CRDT 或操作转换

---

## 9. 安全与合规

### 9.1 权限校验

- **每个 API 端点**校验当前用户是否属于目标 workspace
- 涉及 Admin 操作的端点二次校验角色
- 不依赖前端 hide UI——前端只是优化体验,后端是真权威

### 9.2 数据隔离

- 所有查询自动加 `WHERE workspace_id = current_user.workspace_id`
- 用 ORM 中间件实现,不能在业务代码里漏

### 9.3 邀请链接安全

- token 用 crypto.randomBytes 生成,40 字符
- 7 天 TTL
- 通过链接加入需登录(或注册新账号)
- Admin 可随时 revoke

### 9.4 文件存储

- OSS 预签名 URL,有 TTL
- 私有 bucket,不可公开访问
- 删除文件时逻辑删 + 异步物理删

---

**文档完。**
