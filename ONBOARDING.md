# 🚀 ClipMind 开发者入职与架构指南

欢迎加入 ClipMind 桌面端研发团队。本项目采用 **端云解耦 + 容器化** 的现代架构，致力于打造极致流畅的 AI 驱动视频创作体验。

## 🏗️ 核心架构基座

### 🛠️ Sidecar 二进制管理 (FFmpeg & Whisper)

- **存放路径**: `apps/desktop/src-tauri/bin/`。
- **Sidecar 组成**:
  - **FFmpeg**: 负责音视频极速分离、转码与压缩。
  - **Whisper.cpp**: 采用 `large-v3-turbo` 模型，负责离线语音转文字（STT）。
- **自动化**: 由 `apps/desktop/package.json` 的 `predev`/`prebuild` 钩子驱动。脚本会自动探测系统三元组并从 GitHub Releases 获取免解压的单体二进制文件。
- **禁令**: 严禁将 `bin/ffmpeg-*`、`bin/whisper-*` 及模型文件 (`.bin`) 提交至 Git。

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

## 🌊 核心链路：大文件处理与离线 STT 管道

处理大体积音视频素材时，我们采用了端侧计算前置的极限性能架构。当前阶段暂不进行向量化，必须严格遵循以下 3 个流转阶段，**严禁私自更改链路职责**：

1. **底层一鱼两吃与本地推理 (Rust - Semaphore 隔离)**：
   - 前端下发指令，Rust 层获取 `Semaphore(1)` 锁，唤起 FFmpeg 同步输出视频正片和纯净音频 (强制降维至 16kHz/单声道/16-bit PCM)。
   - 紧接着唤起 `whisper.cpp` 消费临时音频，输出 `transcript.srt` 文件。
   - **节流防崩**：解析处理进度时，强制注入 **500ms 节流阀**，按死前端 IPC 通信风暴。
2. **流式上云与数据上报 (Rust - 无限制并发)**：
   - **零拷贝直传**: 释放排队锁后，进入独立的异步任务。采用 `tokio::fs::File` 结合 `tokio_util::codec::FramedRead` 转化为流，强行打入 `Content-Length` 头完成 OSS 预签名 PUT 直传。
   - **落盘通知**: 推流成功后，将暂存的 SRT 字符串和元数据 POST 给 Hono 后端。
3. **即时物理清理 (RAII 兜底)**：
   - 无论推流和上报成功或 Panic，任务终点**必须强制抹除**本地的所有临时音频与 SRT 文件，彻底杜绝“幽灵垃圾”。

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

### 🛑 8. 侧边车并发控制与 500ms 节流阀 (防假死/防风暴)
- **预处理必须排队**: 绝不允许在 Rust 侧无限制唤起重型 Sidecar（如 FFmpeg/Whisper），必须使用 `tokio::sync::Semaphore(1)` 隔离保护，保证全局唯一执行。
- **进度必须节流**: 解析 Sidecar stdout/stderr 进度时，必须引入 `std::time::Instant`。强制计算当前时间与上次发送时间的差值，**大于 500ms** 才允许向前端 `emit`，死防 IPC 风暴。

### 🛑 9. OSS 流式上传规范 (零拷贝防 OOM)
- **DON'T DO**: 严禁在 Rust 中使用 `fs::read` 将大文件一次性读入 `Vec<u8>` 后再发送，极易引发端侧和 V8 引擎 OOM 崩溃。
- **规范**: 必须采用 `tokio::fs::File::open` 配合 `tokio_util::codec::FramedRead` 转化为流。由于 OSS 预签名校验严格，发送前**必须获取精确大小**，并在请求头中强行打入 `CONTENT_LENGTH`，以阻止 Reqwest 默认的 Chunked 传输破坏签名。

---

## 📝 架构演进与历史工单 (Tech Debt Resolved)

**[Ticket-07] 离线 STT 与 RAG 数据准备链路重构 (Offline-First)**

- **背景**：为规避云端 ASR 成本与网络 IO 瓶颈，并用最快速度跑通 MVP，决定将语音转文本（STT）压力全面前置到用户端本地计算机。
- **修复与决策**：
  - 引入 `whisper.cpp (large-v3-turbo)` 侧边车，完美兼顾中英双语精度与本地推理速度。
  - 彻底砍掉先前的“分离音轨并上传 OSS”链路，现在云端仅接收转录文本，实现 0 额外音频存储与带宽损耗。
  - 采用 Qdrant 命名空间隔离方案（前缀 `clipmind_`）解决单实例多项目共用问题。
- **⚠️ 避坑红线 (Rust 线程假死)**：调用 FFmpeg 和 Whisper 的 `Command` 执行体，必须被完整包裹在 `tokio::task::spawn_blocking` 中！绝对禁止在主异步上下文中直接阻塞，否则将导致 Tauri 前端 UI 彻底假死，用户无法看到任何进度更新。

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

## 📝 [阶段更新] 自适应硬件加速与全局状态架构重构
**1. 架构与状态流转 (Architecture State):**
- 废弃了 `process_asset` 中硬编码 `libx264` 的 MVP 阶段实现。
- 引入了基于 `ffmpeg -encoders` 的跨平台自适应硬件编码器探测机制 (Mac: `videotoolbox`, Win/Linux: `nvenc`/`amf`/`qsv` 等)。
- **[重大架构升级] 启动即探测：** 将最优编码器的探测逻辑提前至 Tauri App 的 `setup` 生命周期。探测结果通过 `tauri::State` 挂载为全局单例，业务管线按需从内存零延迟提取，彻底阻断了每次处理都重复派生进程探测的性能开销与并发血崩风险。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO**: 严禁仅靠 `cfg!(target_os)` 宏在编译期硬编码硬件加速器。用户的本地硬件生态高度碎片化，必须依赖真实的 Sidecar 运行时探针作为唯一真理源。
- **安全防线**: 在 Rust 宏 `tauri::async_runtime::block_on` 中挂载全局状态时，必须 `clone` `app.handle()` 并显式使用 `move` 关键字转移所有权，否则会触发生命周期逃逸编译错误。

**3. 新共识与规范 (New Conventions):**
- 后续如需引入需要高频调用的外部进程依赖配置（如 AI 模型的本地路径、特定算子的支持度），必须采用相同的“App Setup 探测 -> `tauri::State` 挂载 -> 内存提取”三步走模式，严禁在业务请求的 Handle 闭包内执行耗时探测。

### 🛑 9. 幽灵特异性与 Markdown 渲染 (Typography 陷阱)

- **血泪教训**: 在实现双态主题时，如果使用 `@tailwindcss/typography` (`prose`) 渲染 Markdown，它会强制接管内部所有 HTML 标签（如 `<p>`, `<h1>`）的颜色特异性。如果外层容器强行设置了 `text-white`，在 Light 模式下，`prose` 默认会把内部文字还原为深灰色，导致在深色背景气泡上出现“隐形墨水”的灾难。
- **规范**: 严禁通过外层普通 class 试图覆盖 `prose` 的颜色。对于恒定深色背景的区块（如用户发送的消息气泡），必须**绕过系统主题**，硬编码传入 `prose-invert`；对于需要跟随系统变色的区块（如 AI 回复），传入 `dark:prose-invert`。

## 📝 [阶段更新] 顶部响应式导航重构与悬浮按钮剔除

**1. 架构与状态流转 (Architecture State):**
- 彻底移除了 `BasketSidebar` 内部硬编码的悬浮唤起按钮，将其纯粹化为一个受控的抽屉组件。
- 篮子的开闭状态 (`isBasketOpen`) 现已提升并收敛于 `WorkspaceLayout`，通过 `onToggleBasket` 属性下发至 `CanvasPanel`。
- 将“素材篮子”入口安全注入到了 `CanvasPanel` 顶部状态栏的 Flex 布局流中，实现了与视图切换器的响应式共存。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO**: 绝对禁止在复杂的布局容器中随意使用 `fixed` 或 `absolute` 硬编码悬浮操作按钮（FAB）。这种无视文档流的做法，在屏幕尺寸缩小至临界点时，必然会导致不可预见的物理遮挡（如遮挡顶部 Tab 栏）。

**3. 新共识与规范 (New Conventions):**
- **响应式折叠 (Hamburger Menu)**: 面对顶部栏拥挤问题，严禁任由系统强行挤压文字导致排版崩溃。必须采用标准的断点策略：宽屏态 (`lg:flex`) 展开所有操作并复用通用 `Button` 组件；窄屏态 (`lg:hidden`) 必须将功能收纳至汉堡菜单中。

## 🔴 核心架构红线 (更新于端侧双轨预处理重构)

### 1. 极致 I/O 与零拷贝 (Zero-Copy)
绝对禁止无意义的视频容器重封装（如 `-c:v copy` 转 MP4）。端侧仅负责剥离轻量级音轨（如 128k AAC 供云端 ASR 使用），原视频物理文件必须直接作为数据源，通过 `FramedRead` 流直推 OSS，实现 0 损耗与 0 磁盘冗余。

### 2. Tauri v2 Sidecar 最佳实践
**严禁**在 Rust 中使用原生的 `std::process::Command` 搭配硬编码的相对路径，也**严禁**使用 `spawn_blocking` 包裹防假死。
必须使用 Tauri v2 原生的 `app.shell().sidecar("binary_name")` API。它天生自带异步流输出（彻底告别 `Copy` 借用权报错与线程阻塞），且能完美应对跨平台/打包后的绝对路径解析（彻底消灭 `os error 2`）。

### 3. IPC 并发防火墙
所有调用底层高耗能、高频日志输出的外部进程任务，必须在 Rust 侧实施双重防御：
- **并发锁**：入口处必须获取 `Semaphore(1)` 许可，防 OOM 与并发文件踩踏。
- **节流阀**：事件 `emit` 必须经过无状态的 `Instant` 节流（如 500ms），将高频的 IPC 通信风暴扼杀在 V8 沙盒之外。

### 4. 绝对的物理隔离
所有临时文件的生成，**禁止使用毫秒级时间戳**（在极速并发下必产生碰撞脑裂）。必须且只能使用前端透传的唯一业务 `jobId` 进行命名隔离。

## 📝 [阶段更新] 全局强类型环境变量治理与端云解耦重构 (Type-Safe & Fail-Fast)
**1. 架构与状态流转 (Architecture State):**
- **全链路去硬编码**: 彻底拔除了遍布前端组件、Rust 侧边车回调以及 Node Server 启动入口的 `http://localhost:8787` 幽灵硬编码。
- **单点入口校验 (Fail-Fast)**: 在前端 (Vite) 和 后端 (Node Server) 均引入了 `zod` 并在启动/挂载的第一帧执行 `.env` 强类型反序列化。任何配置缺失或格式畸形（如 URL 不合法、CORS 数组为空），将直接阻断应用启动，拒绝“带病运行”。
- **IPC 贯穿透传**: 确立了底层的配置注入规范。Rust 端不再擅自读取外部配置文件，而是由前端将合法的 `serverUrl` 经过 IPC 指令传递给 `lib.rs` 的异步任务，实现纯粹的端云解耦。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (死码与 IPC 炸弹)**: 严禁保留遗留的 `#[tauri::command]` 且内部带有硬编码的死代码。由于 Tauri 自动转换 `snake_case` 到 `camelCase`，前端搜索工具（如 grep）极易漏报，形成隐患。
- **DON'T DO (CORS 数组反序列化)**: 在 Node 层处理 `process.env.CORS_ORIGIN` 时，绝对不能直接将其丢给 `cors()` 中间件。必须经过 Zod 的 `.transform(val => val.split(','))` 强制转换为 `string[]`，否则极易引发跨域拦截黑洞。

**3. 新共识与规范 (New Conventions):**
- 任何需要新增的环境变量，**必须**先在对应的 `env.ts` (前端或后端) 的 Zod Schema 中注册并附带严格的类型/范围校验（如 `z.coerce.number().min(1024)`）。严禁在业务代码中直接读取 `process.env` 或 `import.meta.env`。
