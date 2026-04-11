# 🚀 ClipMind 开发者入职与架构指南

欢迎加入 ClipMind 桌面端研发团队。本项目采用 **端云解耦 + 容器化** 的现代架构，致力于打造极致流畅的 AI 驱动视频创作体验。

## 🏗️ 核心架构基座
- **桌面容器**: Tauri v2 (Rust) - 提供跨平台原生系统级访问权限。
- **前端视图**: React Router v7 + Vite - 纯粹的 SPA 渲染层。
- **云端大脑**: Hono (Node Server) - 处理高并发网络请求与 AI 对接。
- **数据流**: @tanstack/react-query (前端缓存) + Drizzle ORM (后端 MySQL 驱动)。
- **AI 底层**: Vercel AI SDK (v3.4+) - 负责流式解析与 Tool Calling。

---

## 🩸 架构师的血泪教训 (避坑指南)

在演进到当前架构的过程中，我们踩过无数深坑。请每一位新入职的开发者务必将以下原则刻在 DNA 里：

### 1. EDD (证据驱动调试) 原则：禁止盲猜
当出现幽灵 Bug 时（如路由 404、网络请求去向不明），**绝对禁止凭借经验修改代码盲试**。
必须在链路底层下放探针（Probe）：
- 监听 `window.fetch` 拦截真实发出的网络请求。
- 在组件顶层和 SDK `onChunk` 钩子里注入 `console.log`。
- 只有看到确凿的堆栈或 URL 证据，才能下刀修改。

### 2. Vercel AI SDK 的版本“毒区”
本项目深度依赖 Vercel AI SDK，但其在 v3.4+ 版本的更迭中包含了大量未充分文档化的 Breaking Changes：
- **异步陷阱**：`streamText` 已经变为异步函数，**必须加 `await`**，否则返回空 `Promise`，前端无法解析（表现为静默失败）。
- **字段更名**：Tool 的入参规范必须使用 `parameters`，禁止使用旧版的 `inputSchema`，否则 Zod 解析器会直接崩溃。
- **方法演进**：流式返回请严格使用 `toDataStreamResponse()`，禁止使用早期的 `toUIMessageStreamResponse`。

### 3. Vite 与 RRv7 的多重缓存幽灵
如果修改了组件代码但浏览器表现依然怪异，极有可能是 Vite 的强缓存（`.vite` 目录）或 React Router v7 的 loader 缓存作祟。
**解法**：`rm -rf node_modules/.vite` -> 重启开发服务器 -> **使用无痕窗口 (Incognito)** 测试。

### 4. Bash 脚本的安全防线
在编写自动化重构或探针脚本时，**严禁使用带双引号的 `node -e "..."`**（Bash 会将字符串内的 `!` 强行解析为历史记录替换，导致语法错误崩溃）。
**解法**：永远使用 Here-Doc 语法 (`cat << 'EOF' | node`) 隔离 Bash 环境。

---

## 📝 遗留技术债工单 (Tech Debt)

**[High Priority] 恢复 AI SDK 的 ReAct 多步循环能力**
- **现状**：目前后端的 AI 流式响应被强制锁定在单步模式（移除了 `maxSteps` 配置）。
- **病因**：在当前的 `@ai-sdk/core` (v3.4.33) 中，开启 `maxSteps: 5` 会导致底层 `run-tools-transformation.ts` 转换器无法识别内部遥测事件，引发致命报错 `Error: Unhandled chunk type: stream-start`，从而导致整个流式进程崩溃。
- **Action Item**：
  1. 持续跟踪 Vercel AI SDK 官方 Github Issues，等待修复 `stream-start` chunk 的上游补丁。
  2. 修复后，在 `apps/server/src/routes/chat.ts` 的 `streamText` 中恢复 `maxSteps: 5`，以完全释放 AI 在 Tool Calling 后的持续对话能力（多轮循环思考）。
