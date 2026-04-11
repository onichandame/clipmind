# 🚀 ClipMind 开发者入职与架构指南

欢迎加入 ClipMind 桌面端研发团队。本项目采用 **端云解耦 + 容器化** 的现代架构，致力于打造极致流畅的 AI 驱动视频创作体验。

## 🏗️ 核心架构基座
- **桌面容器**: Tauri v2 (Rust) - 提供跨平台原生系统级访问权限。
- **前端视图**: React Router v7 + Vite - 纯粹的 SPA 渲染层。
- **云端大脑**: Hono (Node Server) - 处理高并发网络请求与 AI 对接。
- **数据流**: @tanstack/react-query (前端缓存) + Drizzle ORM (后端 MySQL 驱动)。
- **AI 底层**: Vercel AI SDK (v6.0+) - 负责 Agentic 工作流与多步 Tool Calling。

---

## 🩸 架构师的血泪教训 (避坑指南)

在演进到当前架构的过程中，我们踩过无数深坑。请每一位新入职的开发者务必将以下原则刻在 DNA 里：

### 1. EDD (证据驱动调试) 原则：禁止盲猜
当出现幽灵 Bug 时（如路由 404、网络请求去向不明），**绝对禁止凭借经验修改代码盲试**。
必须在链路底层下放探针（Probe）：
- 监听 `window.fetch` 拦截真实发出的网络请求。
- 在组件顶层和 SDK `onChunk` 钩子里注入 `console.log`。
- 只有看到确凿的堆栈或 URL 证据，才能下刀修改。

### 2. Vercel AI SDK V6 迁移与 Agent 协议
本项目已全面升级至 AI SDK v6.0+。请务必遵守以下 V6 特有规范：
- **同步流对象**：`streamText` 现在同步返回流对象。**严禁在调用前加 `await`**，否则会导致流被阻塞降级为静态对象，引发 `toUIMessageStreamResponse is not a function` 报错。
- **响应方法更名**：流式返回请统一使用 `toUIMessageStreamResponse()`。原 `toDataStreamResponse` 已废弃。
- **上下文对齐 (Critical)**：V6 的消息结构使用 `parts` 数组存储文本。在后端处理历史记录时，必须解析 `m.parts`，否则会导致 AI 丢失上一轮对话内容（表现为“失忆”或“对话错位”）。
- **多步循环能力**：现已原生支持 `maxSteps: 5`。升级到 V6 后，已修复早期版本在多步调用时触发 `stream-start` 块导致的崩溃问题。

### 3. Vite 与 RRv7 的多重缓存幽灵
如果修改了组件代码但浏览器表现依然怪异，极有可能是 Vite 的强缓存（`.vite` 目录）或 React Router v7 的 loader 缓存作祟。
**解法**：`rm -rf node_modules/.vite` -> 重启开发服务器 -> **使用无痕窗口 (Incognito)** 测试。

### 4. Bash 脚本的安全防线
在编写自动化重构或探针脚本时，**严禁使用带双引号的 `node -e "..."`**（Bash 会将字符串内的 `!` 强行解析为历史记录替换，导致语法错误崩溃）。
**解法**：永远使用 Here-Doc 语法 (`cat << 'EOF' | node`) 隔离 Bash 环境。

---

## 📝 遗留技术债工单 (Tech Debt)

**[Ticket-01] [RESOLVED] 恢复 AI SDK 的 ReAct 多步循环能力**
- **修复记录**：已将 workspace 的 `ai` 依赖升级至 latest，彻底解决了 Vercel 官方 `run-tools-transformation.ts` 无法解析 `stream-start` chunk 的上游 Bug，并在 `chat.ts` 中恢复了 `maxSteps: 5`。AI 现已具备单回合多次调用 Tool 的 ReAct 能力。

**[Ticket-02] Canvas 视图状态流转黑盒 (Medium Priority)**
- **位置**: `apps/desktop/app/components/CanvasPanel.tsx`
- **病状**: 存在通过 `(editor.storage as any).markdown.getMarkdown()` 强行绕过 React 生命周期获取状态的 Hack 代码。
- **诊断**: 这种强制介入破坏了单向数据流。在 AI 高频并发写入大纲（Outline）时，极易引发 UI 撕裂或渲染竞态条件，后期需重构数据同步机制。

**[Ticket-03] 类型系统大面积降级 (Tech Task)**
- **位置**: 跨前后端通信层（如 `ChatPanel.tsx` 和 `chat.ts`）
- **病状**: 存在大量的 `as any` 和 `: any` 断言。
- **诊断**: 主要是由于 Vercel SDK 字段更名（如 `toolInvocations` 替代旧版字段）导致的临时妥协。后续需要重新对齐 Zod Schema 与 TypeScript 接口定义，恢复严格类型校验。
