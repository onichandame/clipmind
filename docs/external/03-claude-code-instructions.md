# ClipMind · Claude Code 实施指令文档 V1

**版本**:V1 (2026-05)
**用途**:可直接复制粘贴给 Claude Code 执行的开发指令
**配套文档**:01-product-spec.md(产品)、02-tech-architecture.md(技术)

---

## 0. 使用说明

### 0.1 这份文档的定位

跟前两份文档不同,这份文档**直接面向 Claude Code**。每个 Phase 的章节都包含:

- 上下文(让 Claude Code 知道为什么做)
- 阶段一:勘探指令(只读,不允许写文件)
- 你的检查点(Claude Code 报告完等你 GO)
- 阶段二:实施指令(等你 GO 才执行)
- 验收标准(e2e 验证清单)

### 0.2 工作流程

每个 Phase 都按这个流程走:

1. **复制本文档对应 Phase 的"阶段一指令"** 给 Claude Code
2. **Claude Code 输出勘探报告** → 你 review
3. **你回复 "GO" + 任何决策点的回复** → 进入阶段二
4. **Claude Code 实施 + 输出 e2e 清单** → 你手动验证
5. **验证通过** → 提交 PR,合并到 main
6. **进入下一个 Phase**

### 0.3 通用约束(每个 Phase 都遵守)

- **按 CLAUDE.md 不跑 typecheck**,你手动 e2e 验证
- 沿用项目现有 lucide-react 图标、zustand 状态管理、react-router 路由
- 不要顺手"优化"无关代码
- 不要假设任何字段、API、路径——勘探阶段先核实
- 完成后输出文件清单(每个文件一句话改动概述)
- 大改动建议拆多个 PR,小改动可合一个

---

## Phase 0:救火(优先级最高)

**目标**:在大改动启动前,修复几个明显的产品体验问题。这些不依赖架构改造,可以独立做。

### Phase 0.1:流程文案修复

#### 上下文

当前"探索灵感"流程的 AI 引导文案中,第 3 步是"匹配素材 & 生成方案",但用户在灵感探索阶段还没有素材,AI 强行匹配会幻觉。

#### 阶段一:勘探(只读)

```
任务:修改"探索灵感"流程的引导文案和 AI 行为,移除"匹配素材"步骤。

先勘探,等我 GO 再实施。

阶段一勘探(只读):

1. 在项目中搜索"匹配素材"、"探索灵感"、"我有想法"、"探索灵感"等关键词,
   定位以下文件:
   - 引导文案在哪个文件里(可能是 prompt template、welcome message、
     或前端硬编码常量)
   - "我有素材 / 探索灵感 / 自由对话"三个模式的 system prompt 在哪里

2. 对应文案是硬编码在前端,还是从后端 prompt template 拉的?

3. 贴出"探索灵感"模式当前的完整 system prompt 和引导步骤文案。

4. 是否还有其他地方提到"匹配素材"这个步骤(可能在多处文案里)?

报告输出后停下来等我 GO。中间不动文件。
```

#### 阶段二:实施(等 GO)

```
GO,实施。

修改内容:

1. 把"探索灵感"流程第三步从"匹配素材 & 生成方案"改为"拍摄/制作建议"

2. 三步引导文案对应改为:
   ① 选个起点 — 下方是最近的留学行业热点,点中意的卡片我会接着展开;
     不感兴趣就直接在输入框里写你的创意
   ② 完善大纲 — 审阅并修改右侧大纲,直到满意为止
   ③ 拍摄/制作建议 — 大纲确定后,AI 给出脚本框架、镜头建议、可参考的开源素材方向

3. system prompt 中明确禁止 AI 主动尝试匹配/搜索素材:
   "在'探索灵感'模式下,你不应该主动尝试匹配或搜索素材。用户在这个阶段
   还没有素材。你可以建议用户'这个段落需要城市夜景空镜,可以从 Pexels
   找类似素材',但不要假装自己已经匹配好了。"

约束:
- 不动其他模式的 prompt
- 不跑 typecheck
- 完成后输出文件改动清单 + 一句话验证步骤
```

#### 验收

- 打开"探索灵感"流程,确认引导文案变成新版本
- 跟 AI 对话,确认它不再说"我去搜索/匹配素材"

---

### Phase 0.2:素材独立资产化(方案 D)

**注意**:这是 3 个 PR 串联的工程,不是一次完成。Step 1 完成验证后才进 Step 2。

#### Phase 0.2 - Step 1:DB schema + 后端 API 改造

##### 上下文

当前 schema:`project_assets` 表强制 `projectId NOT NULL`,意味着素材必须依附项目。这导致"素材库"这个独立功能本质上跟产品架构矛盾。本次重构成"素材独立 + 项目多对多关联"。

由于**项目当前无用户**,迁移可以激进。

##### 阶段一:勘探

```
任务:重构素材数据模型,从"素材依附项目"改为"素材独立 + 项目多对多关联"。

这是 Step 1 / 3:只改 schema 和后端,前端暂不动。

先勘探,等我 GO 再实施。

1. 现有 schema 完整盘点:
   - 0001_db_schema.ts 里所有跟素材相关的表(project_assets 或类似)
   - 完整字段定义、外键、索引、enum

2. 后端 API 全面扫描:
   - routes.ts 所有素材相关 endpoint
   - 每个 endpoint 当前的查询逻辑
   - 哪些地方硬编码假设"素材一定有 projectId"

3. Rust 端依赖:
   - src-tauri/src/lib.rs::process_video_asset 完整源码
   - 是否假设 projectId 必填
   - 上传链路里 projectId 在哪些环节被用到

4. 现有数据:
   - dev 数据库里现在有多少条 project_assets 数据?

5. 给出新 schema 提议(参照 02-tech-architecture.md 第 1.2 节):
   - 新的 assets 表完整字段
   - 新的 project_assets 关联表
   - 删除资产时的引用计数策略(给方案让我选)
   - 索引和约束设计

6. 风险点 / 待我拍板:
   - 删除被多项目引用的素材的语义
   - 资产 ownership 是否绑到 user
   - file_hash 去重策略(workspace 内 vs 全局)

报告输出后停下来等我 GO。
```

##### 阶段二:实施

```
GO,按勘探报告中的方案执行。

只改 Step 1 范围:
- DB schema 文件
- 数据库迁移脚本(直接 drop 旧表重建,因为没有用户数据)
- 所有素材相关后端 API
- Rust 端必要调整(process_video_asset 改 projectId 为可选)

不动:
- 前端任何文件
- Library UI

完成后输出:
- 文件改动清单
- 后端 API curl 测试步骤(我手动验证)
```

##### 验收

用 curl 或 Postman 测试:
- 创建素材(不带 projectId)
- 关联素材到项目
- 解关联(不删素材)
- 删除被多项目引用的素材(应拒绝或软删)

---

#### Phase 0.2 - Step 2:前端上传逻辑解耦

##### 阶段一:勘探

```
任务:Step 2 / 3。前端上传逻辑解耦 projectId,让上传不再强制需要项目上下文。

先勘探:

1. 现有上传链路:
   - apps/desktop/app/lib/asset-import.ts 完整源码
   - selectAndImportAssets 函数签名
   - 当前所有调用点(在哪些组件被调用)

2. AssetPickerWidget.tsx 完整源码:
   - 它怎么传 projectId 给 selectAndImportAssets
   - 上传成功后怎么处理

3. 上传过程的 UI 组件(进度展示等)

4. 风险点:
   - 解耦后,在 library.tsx 里上传时 projectId 怎么处理?
   - 在项目对话页里上传时,projectId 怎么传?
   - 现有 useGlobalAssetImportListeners 是否需要改?

报告输出后停下来等我 GO。
```

##### 阶段二:实施

```
GO,实施。

修改:
1. selectAndImportAssets 签名改为 selectAndImportAssets(options: { projectId?: string })
2. 在 library.tsx 里调用时不传 projectId
3. 在项目对话页(AssetPickerWidget)里调用时仍传 projectId
4. 上传成功后:
   - 如果传了 projectId:调 POST /api/projects/:id/assets 关联
   - 如果没传:只上传到 workspace 资产池
5. UI 上区分"上传到当前项目"和"上传到资产池"两种状态

约束:沿用现有 zustand store 和 React Query
完成后输出:文件改动清单 + e2e 验证清单
```

##### 验收

- 在 library 页面上传素材 → 出现在素材库,不属于任何项目
- 在某项目内上传素材 → 出现在素材库 + 关联到该项目
- 撤销删除一个被多项目引用的素材 → 关联恢复

---

#### Phase 0.2 - Step 3:Library 添加素材按钮 + 反向关联

##### 阶段一:勘探

```
任务:Step 3 / 3。在 Library 页面加"添加素材"按钮,并支持把已有素材关联到项目。

先勘探:

1. apps/desktop/app/routes/library.tsx 完整源码
2. Library 页面布局结构(头部、列表、空状态)
3. 现有 LibraryPage 的状态管理和 React Query

报告输出后停下来等我 GO。
```

##### 阶段二:实施

```
GO,实施。

UI 改动:
1. Library 头部右上角加"+ 添加素材"主按钮
   - 直接调 selectAndImportAssets()(不传 projectId)
2. 空状态居中加"导入第一个素材"大按钮
3. 每个素材卡片加 ⋯ 菜单:
   - "关联到项目"(下拉选项目列表)
   - "删除"(软删 + toast 撤销)

约束:
- 复用 DropdownMenu 组件
- 复用 Toast 组件
- 不改素材卡片本身的视觉

完成后输出:文件改动 + e2e 清单
```

##### 验收

- 点 Library 头部按钮 → 选文件 → 上传 → 出现在网格
- 点素材 ⋯ → 关联到项目 → 选择 → 该素材出现在所选项目的素材中
- 点素材 ⋯ → 删除 → toast"已删除,撤销" → 撤销 → 素材回来

---

## Phase 1:Workspace 基础(2-3 周)

**目标**:多租户架构落地,但 UI 上**不暴露成员邀请**(Step 5 单独做)。让现有用户自动属于一个默认 workspace。

### Phase 1.1:DB schema + 数据迁移

#### 上下文

引入 workspace 概念,所有现有数据要绑定 workspace_id。由于无真实用户,可以激进迁移。

#### 阶段一:勘探

```
任务:Phase 1.1。引入 workspaces / workspace_members 表,所有现有数据加 workspace_id。

先勘探:

1. 现有所有表的列表(不只素材),哪些将来需要加 workspace_id:
   - users 表是否需要 current_workspace_id?
   - projects、templates、assets 这些当前的所有权字段
   
2. 现有迁移机制:
   - 项目用什么 ORM(drizzle / prisma / 手写 SQL)
   - 现有迁移脚本在哪
   
3. 现有用户数据状态:
   - dev 库里有多少用户
   - 每个用户的数据规模

4. 给出迁移方案:
   - 是否所有用户共享 1 个默认 workspace,还是每人一个?
   - 第一个注册的人自动是 admin?
   - workspaces.id 怎么生成

报告输出后停下来等我 GO。
```

#### 阶段二:实施

```
GO,按报告执行。

新增表(参照 02-tech-architecture.md 第 1.2 节):
- workspaces
- workspace_members
- workspace_settings(空记录,Phase 1.3 填充)
- products(空记录,Phase 2 填充)

修改:
- projects 加 workspace_id + visibility
- templates 加 workspace_id + visibility(模板表如果不存在,这次也建,但留空字段)
- assets 加 workspace_id

迁移脚本:
- 创建 1 个默认 workspace,名为"默认工作空间"
- 所有现有用户加入,第一个注册的人为 admin,其余 member
- 现有 projects/assets/templates 全部归到默认 workspace

完成后输出:文件改动 + 数据库验证 SQL(让我手动跑确认数据状态)
```

#### 验收

- 新建用户能创建/进入 workspace
- 老用户登录后能看到自己之前的项目
- 数据库 query 验证:所有 projects/assets 都有有效 workspace_id

---

### Phase 1.2:后端 Workspace API + 权限中间件

#### 阶段一:勘探

```
任务:实现 Workspace 相关后端 API + 权限中间件。

先勘探:

1. 现有认证机制:
   - JWT 怎么签发的
   - 中间件链路(每个 request 怎么注入 user)

2. 现有 ORM 查询模式:
   - 是否已有"自动加 user_id 条件"的 helper

3. 提议如何实现"自动加 workspace_id 条件":
   - 中间件层 vs ORM 钩子 vs 显式 helper
   - 给我两个方案对比
```

#### 阶段二:实施

```
GO,按报告方案。

实现 API(参照 02-tech-architecture.md 第 2 节):
- GET /api/workspaces/current
- PATCH /api/workspaces/:id (Admin)
- GET /api/workspaces/:id/settings
- PATCH /api/workspaces/:id/settings (Admin)
- GET /api/workspaces/:id/members
- PATCH /api/workspaces/:id/members/:userId (Admin)
- DELETE /api/workspaces/:id/members/:userId (Admin)

权限中间件:
- requireWorkspaceMember:校验当前用户是否属于 :workspaceId
- requireWorkspaceAdmin:进一步校验是 admin

约束:
- 至少保留 1 个 admin(降级最后一个 admin 应被拒绝)
- 不能移除自己(在 UI 上提示,API 也拒绝)

完成后输出 API 测试用例(curl)
```

---

### Phase 1.3:前端 Workspace context + Sidebar 顶部 workspace 显示

#### 阶段一:勘探

```
任务:前端引入 workspace 全局 context。

先勘探:

1. 现有 Sidebar.tsx 的 brand 区域(顶部)
2. 现有 zustand stores 列表
3. React Query 配置(workspace 数据是否要缓存)

报告输出后等我 GO。
```

#### 阶段二:实施

```
GO,实施。

新建:
- store/useWorkspaceStore.ts
- 应用初始化时调 GET /api/workspaces/current,放进 store

修改:
- Sidebar.tsx 顶部 brand 改为显示 workspace 名 + Logo(从 store 拉)
- 收起态不变(还是首字母图标)

不持久化(每次启动从 API 拉)

完成后输出文件改动 + e2e 清单
```

---

### Phase 1.4:Workspace Settings 路由 + 基础信息 tab

#### 阶段一:勘探

```
任务:实现 Workspace Settings 入口和基础信息 tab。

先勘探:

1. 现有路由配置(routes.ts)
2. 现有表单组件(input、select 是否有统一封装)
3. 现有"全屏覆盖"页面的实现模式

报告输出等我 GO。
```

#### 阶段二:实施

```
GO,实施。

新增路由:
- /settings → 重定向到 /settings/basic
- /settings/_layout.tsx → 二级 nav + content area
- /settings/basic.tsx → 基础信息 tab(参照 workspace-settings.html)

新增 nav 入口:
- Sidebar 底部加 ⚙️ Workspace 设置(只 Admin 可见)

实现:
- 基础信息表单:工作空间名称、行业、内容定位、Logo
- 调 PATCH /api/workspaces/:id/settings 保存
- 不变更其他 4 个 tab(下个 PR 做)

完成后输出文件改动 + e2e 清单
```

---

### Phase 1.5:成员邀请机制

(细节略,按 02-tech-architecture.md 第 2.4 节实现)

---

## Phase 2:产品矩阵 + 品牌画像 + AI Context 注入(2-3 周)

### Phase 2.1:产品矩阵 CRUD

#### 阶段一:勘探

```
任务:实现产品矩阵的完整 CRUD。

先勘探:

1. 现有 products 表(Phase 1.1 已建)的字段
2. 02-tech-architecture.md 第 1.2 节的 products 表设计是否完全对得上现有表
3. 现有"卡片网格"组件(模板库或别处)是否可复用

报告输出等我 GO。
```

#### 阶段二:实施

按 workspace-settings.html 状态 B(产品矩阵列表)和状态 C(产品编辑详情)实现。

详细字段参照 02-tech-architecture.md 第 1.2 节。

---

### Phase 2.2:品牌画像 + 素材偏好 tab

按 workspace-settings.html 状态 D 实现。

### Phase 2.3:AI Workspace Context 注入

#### 阶段一:勘探

```
任务:实现 AI 调用前的 workspace context 拼装与注入。

先勘探:

1. 现有 AI 调用入口(后端):
   - 哪些 API 调用 AI 服务
   - prompt 怎么构造
   - system prompt 现在长什么样

2. 现有 chat message 结构

3. 给出 workspace context 注入方案:
   - 中间件层 vs 显式 helper
   - Token 预算策略(超长怎么裁剪)

报告输出等 GO。
```

#### 阶段二:实施

```
GO,按 02-tech-architecture.md 第 4 节实现。

新增:
- lib/workspace-context.ts(后端):拼装 context 字符串
- 在所有 AI 调用入口注入

修改:
- 项目创建时增加"针对哪个产品"的字段(workflow_mode 'material' 时)

完成后输出文件改动 + e2e 清单
```

#### 验收

- 在产品矩阵中创建产品 A
- 在新项目中"针对产品 A"提问 → AI 输出明显贴合产品 A 的画像
- 不选产品 → AI 输出泛化

---

## Phase 3:模板库 + 爆款复制对话流(2-3 周)

### Phase 3.1:模板库基础页面

#### 阶段一:勘探

```
任务:实现模板库主 sidebar 入口和模板列表页。

先勘探:

1. 现有 templates 表字段(Phase 1.1 已留空)
2. 02-tech-architecture.md 第 1.2 节 templates 设计是否对得上现有表
3. Sidebar.tsx 当前结构(模板库入口要加在哪)

报告输出等 GO。
```

#### 阶段二:实施

按 template-library.html 实现:
- /templates 路由
- 卡片网格 + 缩略图色块
- 筛选(范围/类型/产品)+ 搜索
- 详情侧滑面板
- 三点菜单(使用/编辑/复制/可见性切换/删除)

API 参照 02-tech-architecture.md 第 2.8 节。

---

### Phase 3.2:爆款复制对话流

#### 阶段一:勘探

```
任务:实现爆款复制 agent 对话流。

先勘探:

1. 现有 ChatPanel.tsx 完整结构
2. 现有 Widget 渲染机制(AssetPickerWidget 怎么实现的)
3. 02-tech-architecture.md 第 3.4 节 widget 渲染机制评估

报告输出等 GO。
```

#### 阶段二:实施

按 agent-template-flow.html 实现:

新增 Widgets:
- TemplateAnalysisProgressWidget(拆解过程)
- TemplateStructureWidget(模板结构,可编辑)
- SaveTemplateConfirmWidget(保存确认)
- ProductPickerWidget(创作时选产品)

新增 AI 流程:
- POST /api/ai/template-decompose(爆款拆解)
- POST /api/ai/script-generate(基于模板生成内容)

后端 prompt 设计:让 AI 在合适时机返回 widget 指令。

完成后输出文件改动 + e2e 清单。

---

## Phase 4:三大流程对话化 + 流程衔接(2-3 周)

### Phase 4.1:灵感探索 agent 流

按 agent-inspiration-flow.html 实现。

新增 Widgets:
- InspirationEntryChoicesWidget(双入口选择)
- InspirationCardsWidget(灵感卡列表)
- SeriesOutlineWidget(系列大纲 + 角度 chip)

### Phase 4.2:素材驱动 agent 流

按 agent-asset-driven-flow.html 实现。

新增 Widgets:
- AssetSourceChoicesWidget(三种素材入口)
- AssetLibraryPickerWidget(素材库多选)
- AssetAnalysisWidget(素材内容分析,体现"AI 看到了")
- PlanComparisonWidget(多方案对比)
- ScriptShotListWidget(完整分镜表)

新增 AI:
- POST /api/ai/material-analyze(素材内容分析,异步)

注意:Asset AI 分析需要后端调用视觉 AI 服务,这块需要单独评估技术方案(用什么模型、成本预算)。

---

## Phase 5+:输出与扩展(持续迭代)

非阻塞性功能,按需启动:

- 导出 PDF / 剪映工程文件
- 联网素材搜索
- AI 配音
- AI 生图
- 实时协作

每个独立功能 3-5 天,不在本期总规划内详细写。需要时单独立项 + 写指令。

---

## 通用排错与回退

### 数据迁移失败

每个 schema 变更都要先备份 dev 数据库。失败时:
- 回滚 schema 改动
- 从备份恢复数据
- 分析失败原因,修改迁移脚本,重试

### Phase 之间依赖断裂

如果某个 Phase 验证不通过但后续 Phase 已经开始:
- 优先修上游 Phase
- 上游修好之前不合并下游 PR

### 大改动出错

把所有改动放在独立 feature 分支,失败时直接 abandon 分支即可。

---

## 验证策略汇总

每个 Phase 完成后,按下面 4 步验证:

1. **后端 API**:用 curl/Postman 测每个新增/修改端点
2. **数据库**:写 SQL query 验证数据状态
3. **前端 UI**:启动 dev server,按 e2e 清单点交互
4. **跨流程**:验证现有功能没破坏(回归测试,手动)

任何一步不通过就**不合并 PR**。

---

**文档完。**
