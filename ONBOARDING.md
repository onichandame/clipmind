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
当出现幽灵 Bug 时，绝对禁止凭借经验修改代码盲试。必须在链路底层下放探针（Probe），拿到确凿的堆栈或 URL 证据，才能下刀修改。

### 2. Vercel AI SDK V6 迁移与 Agent 协议 (Blood Trial 补充)
- **多模态与异步清洗陷阱 (Critical)**：V6 中由于引入了对多模态附件的支持，`convertToModelMessages` 已变更为**异步函数**。调用时**必须**加 `await`，否则会导致下游 `streamText` 触发难以排查的 Zod 崩溃 (`expected array, received Promise`)。且必须确保前端传入的格式最终能够映射到严格的 `parts` 数组。
- **ReAct 多步循环断裂**：在后端调用 `streamText` 时，**必须显式声明 `maxSteps` 参数**（如 `maxSteps: 5`）。如果遗漏，大模型在调用工具后会直接结束生命周期，无法将工具结果作为上下文进行第二轮推导，导致前端出现“空炮消息”。
- **UI 状态机与 Parts 协议**：前端 `UIMessage` 已彻底废弃旧版的 `toolInvocations` 数组和 `call` 状态。所有工具调用状态已打平合并至 `message.parts` 数组中。新的流式状态机变更为 `input-streaming` -> `input-available` -> `output-available`，渲染层必须基于 `parts` 进行重构。
- **同步流对象**：`streamText` 本身同步返回流对象，严禁加 `await`。
- **状态注水 (Rehydration)**：在持久化消息历史时，绝对不能将 Tool Call 降维压缩为纯文本。必须在 `onFinish` 中拦截对应状态并存入 JSON 字段，读取时反序列化，才能保证前端 UI 组件复活。

### 3. Monorepo 环境下的模块提升与迁移陷阱 (Critical)
- **环境变量防线**：在 Node Server 入口处，`import 'dotenv/config'` 必须是物理位置的绝对第一行！否则在 TypeScript/ESM 的模块提升机制下，数据库初始化模块会抢先执行，导致 `DATABASE_URL` 丢失崩溃。
- **自动迁移脑裂**：严禁在未配置 `drizzle.config.ts` 的情况下执行 `generate`，这会导致 Drizzle 在默认目录下创建平行的迁移历史，最终引发线上表结构冲突。

### 4. Bash 脚本的安全防线
在编写自动化重构脚本时，永远使用 Here-Doc 语法 (`cat << 'EOF' | node`) 隔离环境，严禁使用带双引号的 `node -e "..."` 防止 Bash 历史替换符崩溃。

---

## 📝 遗留技术债工单 (Tech Debt)

**[Ticket-01] [RESOLVED] 恢复 AI SDK 的 ReAct 多步循环能力**

**[Ticket-04] [RESOLVED] Tool Call 状态流转与持久化不对齐**
- **修复记录**：已在 `projectMessages` 表中扩增 `toolInvocations` JSON 字段。重写了 `chat.ts` 的流式回调和 `projects.ts` 的拉取接口，彻底打通了 Agent 工具状态的持久化与前端 UI 注水恢复链路。同时为 Hono 服务注入了“启动即迁移”的安全生命周期。

**[Ticket-02] Canvas 视图状态流转黑盒 (Medium Priority)**
- **病状**: `CanvasPanel.tsx` 存在绕过 React 生命周期的强制 DOM 状态读取 Hack，极易引发渲染竞态条件，后期需重构数据同步机制。

**[Ticket-03] 类型系统大面积降级 (Tech Task)**
- **病状**: 存在大量的 `as any`，需重新对齐 Zod Schema 与 TypeScript 接口定义。
