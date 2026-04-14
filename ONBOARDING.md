# 🚀 ClipMind 开发者入职与架构指南

欢迎加入 ClipMind 桌面端研发团队。本项目采用 **端云解耦 + 容器化** 的现代架构，致力于打造极致流畅的 AI 驱动视频创作体验。

## 🏗️ 核心架构基座

### 🛠️ Sidecar 二进制管理 (FFmpeg)
- **存放路径**: `apps/desktop/src-tauri/bin/`
- **自动化**: 通过 `apps/desktop/package.json` 中的 `predev` 脚本自动探测三元组后缀并提示下载。
- **规范**: 严禁将 `ffmpeg-*` 二进制提交至 Git。新增平台支持时，必须确保 `tauri.conf.json` 中的 `externalBin` 路径与物理文件名严格匹配。

## 🏗️ 核心架构基座

- **桌面容器**: Tauri v2 (Rust) - 提供跨平台原生系统级访问权限与极速文件 IO。
- **前端视图**: React Router v7 + Vite - 纯粹的 SPA 渲染层，仅负责 UI 与状态流转。
- **云端大脑**: Hono (Node Server) - 处理高并发网络请求、数据库交互与 AI 对接。
- **数据流**: @tanstack/react-query (前端缓存) + React Router Loader + Drizzle ORM (后端 MySQL 驱动)。
- **AI 底层**: Vercel AI SDK (v6.0+) - 负责 Agentic 工作流与多步 Tool Calling。

### 🛠️ Sidecar 二进制管理 (FFmpeg)
- **存放路径**: `apps/desktop/src-tauri/bin/`。
- **自动化**: 由 `apps/desktop/package.json` 的 `predev`/`prebuild` 钩子驱动。
- **更新机制**: 脚本会自动探测系统三元组（Target Triple）并从 GitHub Releases 获取免解压的单体二进制文件。
- **禁令**: 严禁将 `bin/ffmpeg-*` 提交至 Git。

---

## 🌊 核心链路：端云解耦大文件处理管道

处理大体积音视频素材时，我们采用了极限性能的架构设计。必须严格遵循以下 4 个流转阶段，**严禁私自更改链路职责**：

1. **底层极速分离 (Rust)**：
   - 前端下发指令，Rust 层唤起 FFmpeg Sidecar。
   - **视频要求**：优先调用系统级硬件加速 (如 Mac `-c:v hevc_videotoolbox`) 结合 VBR 动态码率压缩。
   - **音频要求**：为节省后端 AI (Whisper) 带宽，强制降维至 `-c:a aac -ac 1 -ar 16000 -b:a 32k` (单声道、16kHz、32kbps)。
2. **凭证签发 (Node/Hono)**：前端向云端请求双轨道的 OSS 预签名直传 URL。
3. **底层直传 (Rust)**：前端将 URL 交还给 Rust，由 Rust 底层网络栈 (`reqwest`) 绕过 WebKit 限制直接推送到阿里云 OSS。
4. **闭环落盘 (Node/Hono)**：前端通过 Webhook 通知云端写入数据库，并触发 React Router `clientLoader` 驱动 UI 重新渲染回显。

---

## 🩸 架构师的血泪教训 (绝对红线)

在演进到当前架构的过程中，我们踩过无数深坑。请每一位新入职的开发者务必将以下原则刻在 DNA 里：

### 🛑 1. EDD (证据驱动调试) 原则：禁止盲猜

当出现幽灵 Bug 时，绝对禁止凭借经验修改代码盲试。必须在链路底层下放探针（Probe），拿到确凿的堆栈、日志或 URL 证据，才能下刀修改。

### 🛑 2. WebKit 封锁、IPC 风暴与“幽灵资产” (让底层的归底层)

- **血泪教训 1 (CORS 封锁 & Metadata 提取)**：WebKitGTK 等前端沙盒不仅禁止原生 `fetch` 跨域读取本地协议，同时，试图用隐式 `<video src="asset://...">` 在前端沙盒去读取本地大文件时长是非常脆弱的做法，极易引发 "The URL can’t be shown" 拦截。
  - **DON'T DO**: 严禁在前端强行解析本地大文件元数据。
  - **规范**: 必须在 Rust 层直接解析 FFmpeg stderr 输出流，提取真实的 `Duration` 传递给前端。
- **血泪教训 2 (IPC 通信风暴)**：直接将底层高频事件（如 FFmpeg stderr 字节流）无脑跨进程转发给前端，瞬间会撑爆 V8 引擎导致 `NeedDebuggerBreak trap` 崩溃。
  - **规范**: Rust 后端向前端发送进度事件时，必须强制注入 **节流阀 (Throttle)**（如 150ms 推送一次），按死性能毒瘤。
- **血泪教训 3 (幽灵资产与 Webhook 移交)**：如果让前端在上传完毕后去 `fetch` 调用后端的落盘 API，一旦用户在进度 99% 时切换路由或刷新页面，回调就会灰飞烟灭。文件上了 OSS，但数据库记录丢失，产生“幽灵资产”。
  - **DON'T DO**: 严禁在前端 `assets.tsx` 发起跨域 Webhook 通知 Node Server。
  - **规范**: 必须由执行直传的 Rust 底层 (`lib.rs`)，在推流成功后，直接使用 `reqwest::Client` (开启 `json` feature) 向后端发起落盘通知。

### 🛑 3. Tauri v2 插件的“双端一致性”原则

在前端 `pnpm add @tauri-apps/plugin-xxx` 只是买了个皮囊。任何原生插件（如 Dialog）必须成对出现：后端 `Cargo.toml` 引入 -> `lib.rs` 中 `.plugin(init())` 注册 -> `capabilities/*.json` 中显式放行权限。少一步，前端直接静默拦截。同时，配置文件选择器时，**必须包含扩展名的大小写变体**（如 `['mp4', 'MOV']`），否则原生系统会无情屏蔽。

### 🛑 4. Rust 宏的泛型推断黑洞 (E0283)

在使用 `async_stream` 结合 `reqwest::Body::wrap_stream` 等流式 IO 时，复杂的泛型推断会导致编译器迷失。必须放弃语法糖，使用原生的 `stream!` 宏，并**强制显式声明 yield 返回值类型**（如 `yield Ok::<bytes::Bytes, std::io::Error>(...)`），彻底切断编译器的推断发散。

### 🛑 5. DDD 领域模型约束（Asset 为顶级实体）

**资产（Asset）是系统的底层基建，属于全局顶级实体。** 绝对不要在预签名阶段将其强行绑定到特定的 `projectId` 目录下（如 `projects/{id}/assets/...`）。物理存储路径必须是纯粹的 `assets/{uniqueId}/...`，与 Project 的关联交由数据库关联表处理，为“跨项目复用”留出后路。

### 🛑 6. Vercel AI SDK V6 协议陷阱

- **异步清洗**：引入多模态后，`convertToModelMessages` 变为异步函数，必须 `await`。
- **ReAct 循环**：调用 `streamText` 时**必须显式声明 `maxSteps`**，否则 Agent 调用一次工具后会直接假死。
- **状态流转**：废弃旧版 `toolInvocations`，所有状态打平至 `message.parts` 数组，前端必须基于 `parts` 重构渲染层。
- **持久化由前端发起**：`streamText` 回调无法拿到标准 UI 格式，**所有消息持久化必须由前端 `useChat` 的 `onFinish` 发起**，并在流式输出彻底结束后全量覆盖。

### 🛑 7. Monorepo 环境变量与迁移防线

- 在 Node Server 入口处，`import 'dotenv/config'` 必须是绝对的第一行代码，防止模块提升导致 DB 初始化崩溃。
- 严禁在未配置 `drizzle.config.ts` 时执行 `generate` 引发迁移历史脑裂。
- 编写重构脚本时，永远使用 Here-Doc 语法 (`cat << 'EOF' | node`)，严禁 `node -e "..."`。

---

## 📝 架构演进与历史工单 (Tech Debt Resolved)

**[Ticket-05/06] 彻底废弃独立消息表，拥抱 Project JSON 聚合**

- **病状**：独立 `project_messages` 表导致无休止的读写开销与多表 Join 性能损耗，流式高频写入极易引发幻觉覆盖。
- **修复**：删除该表，将历史对话数组直接聚合到 `projects.uiMessages` JSON 列中。由前端在流式结束后发起 `PUT` 全量覆盖。
- **⚠️ 避坑**：获取项目列表时**严禁 `select *`**，必须显式排除 `uiMessages` 字段，否则极易导致严重内存泄漏 (OOM)。

**[Ticket-02] Canvas 视图状态流转黑盒**

- **修复**：已在 `useEffect` 中注入 `!editor.isFocused` 焦点防御机制，阻断流式高频更新抢夺用户光标。长期需废弃全量 `setContent`，改用 ProseMirror Transaction 增量写入。

**[Ticket-03] 类型系统重构**

- **进度**：逐步清理 `as any`，对齐 Zod Schema 与 TypeScript 接口定义。

## 📝 [阶段更新] 大文件处理管道优化、按钮重构与临时文件自动清理
**1. 架构与状态流转 (Architecture State):**
- 移除了前端 `assets.tsx` 中的硬编码按钮，抽取了通用的 `Button.tsx` 组件，规范了系统的交互样式。
- 细化了双向事件监听：前端现已分离监听 `upload-progress` (OSS 直传) 与 `ffmpeg-progress` (侧边车处理)。
- **遗留架构债 (Tech Debt)**: FFmpeg 的进度提取目前基于轻量级字符串探测，某些特定视频容器格式下无法精准触发伪进度递增，导致 UI 仍可能处于静止的“急速处理中”状态。后续迭代需在 Rust 侧引入更稳定的进度报告回调拦截。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO**: 严禁在 Rust 的 `async_stream::stream!` 宏内直接消费外部的 `String` 路径变量。流闭包会强制拿走变量的所有权，导致在流结束后试图清理文件时引发 `E0382 borrow of moved value` 崩溃。必须在流定义外部提前执行 `let stream_path = path.clone();`，将流的生命周期与后续文件操作的生命周期彻底剥离。
- **DON'T DO**: 严禁在 `process_asset` (阶段 1 极速分离) 结束后立即清理临时文件。由于端云解耦架构，临时 `.mp4` 和 `.aac` 必须存活到 `upload_asset` (阶段 3 直传 OSS) 完全返回 200 OK 之后，由直传层安全抹除，否则会导致断流。

**3. 新共识与规范 (New Conventions):**
- 前端项目新增了标准的 `Button.tsx` 组件。后续所有涉及表单或悬浮交互的按钮，必须优先复用该组件，严禁在业务线路由中反复拼凑 Tailwind 基础类。

### 🛑 8. Tailwind v4 双主题架构规范 (Light/Dark Mode)
- **架构事实**: 本项目采用纯 Tailwind CSS v4 架构，已废弃 `tailwind.config.js`。
- **暗黑触发机制**: 严禁依赖系统级媒体查询盲猜。必须在 `app/app.css` 顶部注入 `@custom-variant dark (&:where(.dark, .dark *));` 以实现基于 DOM 类名的精准劫持。
- **状态流转与防闪烁 (FOUC)**: 必须将 `.dark` 类名挂载到顶级 `<html>` (`document.documentElement`) 节点上。初始态在 `root.tsx` 中同步读取 `localStorage` 阻断首屏闪烁。
- **UI 规范 (Light by Default)**: 默认主题已决断为 Light 模式（白底深字）。所有组件级开发必须强制提供双态类名（如 `bg-white dark:bg-zinc-950`），**严禁硬编码单态深色类名**。
