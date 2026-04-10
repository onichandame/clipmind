# AI 架构师盲操接手指南 (Blind Execution Playbook)

## 🎯 背景与目标

你好，下一任 AI 架构师。你即将接手一个正在开发中的项目。
**核心约束**：你无法直接读取用户的本地文件系统，也没有终端执行权限。用户（人类）将作为你的“手”和“眼”。你需要通过精确的 Bash 命令和完整的代码块，指导用户探查现状、修改代码并执行验证。

本指南总结了前序阶段验证过的最高效工作流。请严格遵循以下五个阶段进行工作。

---

## 🛠️ 第一阶段：现状摸底 (The Bash Probes)

接手新模块时，**永远不要盲目相信文档中的“已完成”状态**。必须先通过 Bash 命令让用户返回真实状态。

**常用探针命令集（请直接让用户复制执行）：**

1. **查依赖与环境**：

   ```bash
   cat package.json | grep -E '"(react-router|ai|drizzle-orm)"'
   ls -la .env* vite.config.ts 2>/dev/null
   ```

2. **查核心文件是否存在及大致结构**：

   ```bash
   find app src -name "*schema*.ts" -o -name "*db*.ts" 2>/dev/null
   head -n 50 app/db/schema.ts 2>/dev/null
   ```

3. **查特定代码逻辑（精准过滤）**：

   ```bash
   cat app/components/ChatPanel.tsx | grep -E "(useChat|useRevalidator)"
   ```

4. **查全局样式与主题基调（UI 改造前置动作）**：

   ```bash
   cat app/globals.css 2>/dev/null || cat app/tailwind.css 2>/dev/null
   ```

_注：提醒用户在返回包含敏感信息（如 `.env`）的日志时，主动打码 API Key 和数据库密码。_

---

## 📝 第二阶段：代码生成与交付规范

当你确认了现状并决定修改代码时，请遵循**“全量覆盖”**原则。

1. **拒绝局部 Diff**：不要说“在第 15 行插入这段代码”。人类手动找行数极易出错。
2. **全文件输出**：直接输出修改后的**完整文件代码**，并明确告诉用户：“请用以下代码完全覆盖 `app/xxx/xxx.ts`”。
3. **高亮修改点**：在输出的代码中，用注释（如 `// FIX: ...` 或 `// NEW: ...`）标出你改动了哪里，让用户心里有底。

---

## 🐛 第三阶段：调试与避坑经验 (Lessons Learned)

### 1. Vercel AI SDK & React Router v7 状态联调防坑指南 (Critical)

在实现持久化历史对话时，极易掉进“数据丢失”和“流挂起”的深渊，请务必牢记以下核心经验：

**【关于 Tool Calling 工具调用与流式解析的血泪史】**
1. **多步回调死锁 (Multi-Step Deadlock)**：在使用非官方或第三方大模型代理时，如果设置 `maxSteps > 1`，模型极有可能无法正确处理 `tool_result` 角色，导致服务端虽然执行完毕，但由于等不到模型的最终回复，HTTP 流被永远挂起。前端会一直卡在 `streaming` 状态。**对策：强制设置 `maxSteps: 1`，拿到工具结果后立刻结束流，将控制权交还前端状态机。**
2. **Transport 层类型扁平化陷阱**：使用自定义的 Chat Transport 时，标准 AI SDK 的 `part.type === 'tool-invocation'` 可能会被底层拦截重写为 `tool-{toolName}`（例如 `tool-updateOutline`）。前端在拦截工具状态、渲染动画或触发页面 `revalidate()` 刷新时，**必须同时兼容两种类型的判断**，否则会导致 UI 彻底“装聋作哑”。
3. **LLM 强制猜 ID (Schema Hallucination)**：绝对不要把内部系统 ID（如 `projectId`）写进大模型的 `inputSchema` 中让它去猜。它必定会捏造假 ID 导致数据库外键约束报错。正确的做法是从外部请求上下文 (`request.json()`) 中直接获取真实 ID 传入后端 Tool 执行闭包。
4. **脏数据泄漏 (JSON Leakage)**：部分模型会将 Tool Call 的 JSON 结构错误地塞进普通 `text` 增量块中。前端渲染 `text` part 时，必须加入防御性拦截（如屏蔽 `{"toolCalls":`），防止原始代码暴露在用户对话气泡中。

**【关于基础状态同步】**

1. **破除 useChat SPA 缓存锁**：`useChat` 默认使用 `"chat"` 作为全局缓存 ID。在 SPA（如 RRv7）中切换项目时，如果不传入 `id: projectId` 强绑定作用域，它会固执地复用上一个空缓存，直接无视你传入的 `initialMessages`。
2. **强制状态同步 (setMessages)**：`initialMessages` 仅在缓存首次创建时生效。为了抵御 Vite 热更新 (HMR) 或是路由软跳转带来的缓存污染，**必须通过 `useEffect` 监听服务端数据变化，并调用 `setMessages` 强行把数据库数据灌进 UI 中**，这绝不是 Hack，而是官方生态下的最佳实践。
3. **警惕静默丢弃与 Payload 碎片化**：
   - 传给 `initialMessages` 的对象，**`content` 字段是必填项 (Required)**，哪怕你用了 `parts` 渲染，如果没有 `content` 字符串，AI SDK 会直接静默丢弃这条记录！
   - 后端在拦截对话存库时，千万不要相信 `lastMessage.content` 总是存在，它可能被 SDK 碎片化为 `text` 字段或嵌在 `parts[0].text` 中，必须做防御性抓取。
5. **时间戳碰撞与数据库排序 (Timestamp Collision)**：
   - **现象**：刷新页面后对话顺序错乱（如提问出现在回答下方）。
   - **成因**：MySQL `timestamp` 精度通常为秒。如果在 `onFinish` 回调中同时插入用户提问和 AI 回答，两条记录的时间戳完全一致，导致 `ORDER BY createdAt` 失效。
   - **对策**：采用“前置入库”策略。用户请求到达后端后立即执行提问入库，再启动流式响应。这样提问与回答之间会有明显的物理时间差，且能防止因 AI 报错导致的用户提问丢失。
4. **RRv7 Loader 截断问题**：在 Route 组件接收数据时，绝对**禁止使用旧版的 Props 解构 `export default function Component({ loaderData })`**，这会导致新加入的深层字段（如历史记录数组）在序列化时被丢弃。永远使用标准的 `const loaderData = useLoaderData<typeof loader>();`。

### 2. UI 重构与视觉升级经验 (Pure UI Refactoring)

1. **逻辑与视图绝对隔离 (Separation of Concerns)**：在美化组件时，绝对不要触碰已验证的核心业务逻辑。你的改动应该仅限于 Tailwind CSS 类名的调整和 HTML DOM 结构的优化。
2. **敏捷视觉交付 (Incremental Visuals)**：不要一次性抛出多个组件的重构代码。按视觉区块拆解，每交付一个文件，强制要求人类“刷新页面验收”，确认视觉无误后再推进下一步。
3. **深色模式优先 (Dark Mode First)**：优先采用 `bg-zinc-950` 等深灰/纯黑阶作为基调，摒弃生硬的边框线，多用毛玻璃 (`backdrop-blur`) 和克制的品牌高亮色。

### 3. 客户端直传与 OSS 联调血泪史 (Client-side Uploads & OSS)

1. **CORS 预检 (Preflight) 陷阱**：前端使用 `PUT` 直传时，阿里云 OSS 的 CORS 配置中，**允许 Headers (Allowed Headers) 必须明确设为 `*`**。
2. **HTTPS 强制降级拦截**：`ali-oss` SDK 默认签发 `http://` 链接，必须在后端初始化时硬编码 `secure: true`。
3. **签名防伪不匹配 (SignatureDoesNotMatch)**：前后端的 Content-Type 必须纳入签名加密公式，绝对统一。
4. **ORM 字段对齐检查**：存盘前务必核对真实的 Schema 字段名，否则必抛 `ER_NO_DEFAULT_FOR_FIELD`。

---

### 4. 复杂卡片与列表的“整块点击”最佳实践 (Full-card/Row Clickability)

在实现复杂的列表项或卡片（如包含多个操作按钮的 `ProjectCard` 或 `TableRow`）时，极易陷入层叠上下文 (Stacking Context) 和事件冒泡的坑：

1. **绝对禁止 `<a>` 标签嵌套陷阱**：不要使用 `<Link>` 或 `<a>` 铺满底层，然后用 `z-index: 10` 的文字覆盖其上。这会导致文字层阻断鼠标事件 (`Pointer Events`)，造成“只有点边缘空隙才能跳转”的恶劣体验。如果强行对文字层使用 `pointer-events-none`，又会导致内部独立按钮无法点击。
2. **编程式导航 (Programmatic Navigation) 为王**：彻底放弃用 `<a>` 包裹整个卡片。正确的做法是：
   - 给最外层的 `<div>` 或 `<tr>` 加上 `cursor-pointer`，并绑定 `onClick={() => navigate('/path')}`。
   - 这不仅让 HTML 结构极其干净，也彻底消灭了多层 `z-index` 带来的历史包袱。
3. **精准的事件阻断 (Stop Propagation)**：对于卡片内部的独立操作按钮（如“删除”图标），必须在其 `onClick` 事件中调用 `e.stopPropagation()`。这是防止点击内部按钮时意外触发外层卡片跳转的唯一且最优雅的手段。
4. **显式手型反馈**：对于所有用图标模拟的按钮 (IconButton)，务必显式加上 `cursor-pointer`，因为很多 CSS 框架在特定层叠下会丢失原生的按钮手型。


## 📦 第四阶段：版本控制与收尾 (Git Discipline)

每一个功能闭环（Stage 验收通过）后，必须指导用户进行干净的 Git 提交。

1. **排雷**：先让用户执行 `git status`，甄别文件。
2. **精准暂存**：**坚决杜绝让用户执行 `git add .`**，给出具体路径。
3. **写好 Commit Message**：提供规范的提交信息让用户复制。
4. **教导撤销**：提供补救方案 (`git reset HEAD~1` 等)。

---

## 🏛️ 架构决策记录 (ADR) - UI & App Shell (Updated)

1. **全局布局 (App Shell)**：已在 `root.tsx` 建立全局极窄侧边栏 (`GlobalSidebar`，宽 `w-16`/64px)。内部所有路由视图必须继承父级的滚动管理，使用 `h-full overflow-y-auto`。
2. **图标库约束**：已废弃原生 SVG，全局统一使用 `lucide-react`。
3. **品牌色彩基调**：深色模式 (`bg-zinc-950`) 为主，高亮主按钮与交互激活态严格使用 Zap-Purple (`#6D5DFB`)。禁止滥用其他高饱和度色彩。