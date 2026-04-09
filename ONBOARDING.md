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

### 1. 核心逻辑排错

1. **索要完整报错**：让用户提供完整的终端 Stack Trace 或浏览器的 Console 报错。
2. **警惕版本幻觉 (Critical)**：
   - 前期我们在集成 **Vercel AI SDK** 时踩过大坑。请务必核实当前的库版本。
   - **切记**：AI SDK v5 已经废弃了 `convertToCoreMessages`、`stopWhen` 和 `toDataStreamResponse`。必须使用最新的 `convertToModelMessages`、`maxSteps: 5` 和 `toUIMessageStreamResponse()`。
   - 永远不要用你记忆中旧版本的 API 盲猜报错原因，遇到新库报错，去思考当前最新的用法。
3. **提供具体的验证手段**：
   - 修复后，告诉用户具体的验证动作（例如：“刷新页面，输入 X，观察 Y 处是否出现 Z”）。

### 2. UI 重构与视觉升级经验 (Pure UI Refactoring)

当你接到“纯 UI 优化”的任务时，请遵循以下血泪经验：

1. **逻辑与视图绝对隔离 (Separation of Concerns)**：在美化组件时，绝对不要触碰已验证的核心业务逻辑（如 `useChat` 状态机、工具调用回调、全局 Store）。你的改动应该仅限于 Tailwind CSS 类名的调整和 HTML DOM 结构的优化。
2. **敏捷视觉交付 (Incremental Visuals)**：不要一次性抛出多个组件的重构代码。按视觉区块拆解（如：全局 Layout -> 左侧 Chat -> 右侧 Canvas -> 悬浮组件），每交付一个文件，强制要求人类“刷新页面验收”，确认视觉无误后再推进下一步。
3. **深色模式优先 (Dark Mode First)**：在构建 SaaS 级后台或创作者工具时，系统默认契合深色主题审美。优先采用 `bg-zinc-950` 等深灰/纯黑阶作为基调，摒弃生硬的边框线，多用毛玻璃 (`backdrop-blur`) 和克制的品牌高亮色，能用极低的成本拉升产品的次世代质感。

### 3. 客户端直传与 OSS 联调血泪史 (Client-side Uploads & OSS)

**极度重要：永远不要盲目相信前端上传成功的假象，查网络日志和 OSS 探针才是真理！**

1. **CORS 预检 (Preflight) 陷阱**：前端使用 `PUT` 直传并携带 `Content-Type` 时，必定触发非简单请求的 `OPTIONS` 预检。阿里云 OSS 的 CORS 配置中，**允许 Headers (Allowed Headers) 必须明确设为 `*`**，留空必定导致预检被 403 掐死。
2. **HTTPS 强制降级拦截**：`ali-oss` SDK 默认签发 `http://` 链接。现代浏览器极其注重隐私，会拦截向 HTTP 协议直传大文件的行为（报 HTTPS-Only Mode 警告并掐断回调）。必须在后端 OSS Client 初始化时硬编码 `secure: true`。
3. **签名防伪不匹配 (SignatureDoesNotMatch)**：如果前端 `fetch` 获取临时签名时不上报准确的视频类型，而后端盲目生成通用签名，一旦前端拿这把“通用钥匙”去开带 `Content-Type: video/quicktime` 的锁，必定被 OSS 拦截并报 403。前后端的 Content-Type 必须纳入签名加密公式，绝对统一。
4. **ORM 字段对齐检查**：不要信任直觉。在将数据落盘到前任遗留的数据库表时，务必先用命令探查 Schema 定义（如确认前任叫 `ossUrl` 而不是 `objectKey`），否则必然触发 `ER_NO_DEFAULT_FOR_FIELD` 的 500 报错。

---

## 📦 第四阶段：版本控制与收尾 (Git Discipline)

每一个功能闭环（Stage 验收通过）后，必须指导用户进行干净的 Git 提交。

1. **排雷**：先让用户执行 `git status`，甄别哪些是此次任务的文件，哪些是不小心修改/未追踪的无关文档（如本地 PRD、`.docx`、设计图等）。
2. **精准暂存**：**坚决杜绝让用户执行 `git add .`**，除非你百分百确认目录是干净的。请给出具体的命令：

   ```bash
   git add app/components/XXX.tsx
   git add app/routes/XXX.ts
   ```

3. **写好 Commit Message**：提供格式规范、包含上下文的提交信息，直接让用户复制执行：

   ```bash
   git commit -m "feat(module): 🚀 finish stage X" -m "- implemented feature A\n- fixed issue B"
   ```

4. **教导撤销**：如果用户误 add 或误 commit，提供 `git reset HEAD~1` 或 `git restore --staged <file>` 的补救方案，安抚情绪。

---

## 💡 给 AI 的终极建议

- **步子迈小一点**：把一个大需求拆分成“建表”、“写后端接口”、“前端 UI 骨架”、“联调”几个小步，每一步都要通过 bash 验证后再进行下一步。
- **保持自信与专业**：用户是你的物理外设，你是大脑。指令要清晰、明确，不要模棱两可。
