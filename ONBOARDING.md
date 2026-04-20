# 🚀 ClipMind 开发者入职与架构指南

欢迎加入 ClipMind 桌面端研发团队。本项目采用 **端云解耦 + 容器化** 的现代架构，致力于打造极致流畅的 AI 驱动视频创作体验。

## 🏗️ 核心架构基座

- **桌面容器**: Tauri v2 (Rust) - 提供跨平台原生系统级访问权限与极速文件 IO。
- **前端视图**: React Router v7 + Vite - 纯粹的 SPA 渲染层，仅负责 UI 与状态流转。
- **云端大脑**: Hono (Node Server) - 处理高并发网络请求、数据库交互与 AI 对接。
- **数据流**: @tanstack/react-query (前端缓存) + React Router Loader + Drizzle ORM (后端 MySQL 驱动)。
- **AI 底层**: Vercel AI SDK (v6.0+) - 负责 Agentic 工作流与多步 Tool Calling。

### 🛠️ Sidecar 二进制管理 (FFmpeg)

- **存放路径**: `apps/desktop/src-tauri/bin/`。
- **Sidecar 组成**:
  - **FFmpeg**: 负责音视频极速分离、转码与压缩。
- **自动化**: 由 `apps/desktop/package.json` 的 `predev`/`prebuild` 钩子驱动。
- **更新机制**: 脚本会自动探测系统三元组（Target Triple）并从 GitHub Releases 获取免解压的单体二进制文件。
- **禁令**: 严禁将 `bin/ffmpeg-*` 提交至 Git。

---

## 🌊 核心链路：大文件处理与云端 ASR 管道

处理大体积音视频素材时，我们采用了端云协作的极限性能架构。当前阶段暂不进行向量化，必须严格遵循以下 3 个流转阶段，**严禁私自更改链路职责**：

1. **底层一鱼两吃极速分离 (Rust - Semaphore 隔离)**：
   - 前端下发指令，Rust 层获取 `Semaphore(1)` 锁，唤起 FFmpeg 同步输出视频正片和纯净音频 (强制降维至 16kHz/单声道/16-bit PCM)。
   - **节流防崩**：解析处理进度时，强制注入 **500ms 节流阀**，按死前端 IPC 通信风暴。
2. **流式上云与数据上报 (Rust - 无限制并发)**：
   - **零拷贝直传**: 释放排队锁后，进入独立的异步任务。采用 `tokio::fs::File` 结合 `tokio_util::codec::FramedRead` 转化为流，强行打入 `Content-Length` 头完成 OSS 预签名 PUT 直传。
   - **落盘通知与触发 ASR**: 推流成功后，将元数据 POST 给 Hono 后端。后端随后将拉起与阿里云 ASR 的对接流程进行高精转录。
3. **即时物理清理 (RAII 兜底)**：
   - 无论推流和上报成功或 Panic，任务终点**必须强制抹除**本地的所有临时音视频文件，彻底杜绝“幽灵垃圾”。

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
  - **规范**: Rust 后端向前端发送进度事件时，必须强制注入 **节流阀 (Throttle)**（严格对齐 500ms 推送一次），按死性能毒瘤。
- **血泪教训 3 (幽灵资产与 Webhook 移交)**：如果让前端在上传完毕后去 `fetch` 调用后端的落盘 API，一旦用户在进度 99% 时切换路由或刷新页面，回调就会灰飞烟灭。文件上了 OSS，但数据库记录丢失，产生“幽灵资产”。
  - **DON'T DO**: 严禁在前端 `assets.tsx` 发起跨域 Webhook 通知 Node Server。
  - **规范**: 必须由执行直传的 Rust 底层 (`lib.rs`)，在推流成功后，直接使用 `reqwest::Client` (开启 `json` feature) 向后端发起落盘通知。

### 🛑 3. Tauri v2 插件的“双端一致性”原则

在前端 `pnpm add @tauri-apps/plugin-xxx` 只是买了个皮囊。任何原生插件（如 Dialog）必须成对出现：后端 `Cargo.toml` 引入 -> `lib.rs` 中 `.plugin(init())` 注册 -> `capabilities/*.json` 中显式放行权限。少一步，前端直接静默拦截。同时，配置文件选择器时，**必须包含扩展名的大小写变体**（如 `['mp4', 'MOV']`），否则原生系统会无情屏蔽。

### 🛑 4. Rust 宏的泛型推断黑洞 (E0283)

在使用 `async_stream` 结合 `reqwest::Body::wrap_stream` 等流式 IO 时，复杂的泛型推断会导致编译器迷失。必须放弃语法糖，使用原生的 `stream!` 宏，并**强制显式声明 yield 返回值类型**（如 `yield Ok::<bytes::Bytes, std::io::Error>(...)`），彻底切断编译器的推断发散。

### 🛑 5. DDD 领域模型约束（Asset 为顶级实体）

**资产（Asset）是系统的底层基建，属于全局顶级实体。** 绝对不要在预签名阶段将其强行绑定到特定的 `projectId` 目录下（如 `projects/{id}/assets/...`）。物理存储路径必须是纯粹的 `assets/{uniqueId}/...`，与 Project 的关联交由数据库关联表处理，为“跨项目复用”留出后路。

### 🛑 6. Vercel AI SDK V6 协议陷阱 (已于 CQRS 架构重构中更新)

**[核心准则] 在编写任何 AI 调用或 Agent 逻辑代码前，必须完整阅读并理解 [Vercel AI SDK LLM 规范](https://ai-sdk.dev/llms.txt) 以确保符合最新的协议标准。**

- **异步清洗**：引入多模态后，`convertToModelMessages` 变为异步函数，必须 `await`。
- **ReAct 循环**：调用 `streamText` 时**必须显式声明 `maxSteps`**，否则 Agent 调用一次工具后会直接假死。
- **【已废弃】持久化由前端发起**：绝对禁止由前端负责核心业务数据的落盘！这会产生幽灵账单与数据截断。当前系统已全面切换为 **CQRS (读写分离)** 架构。数据库仅存储纯净的 `CoreMessage`，全量持久化收敛于后端 `chat.ts` 的 `streamText.onFinish` 钩子中。
- **CoreMessage 协议屏障**：Vercel AI SDK 后端仅认识 `CoreMessage`（工具调用在 `toolInvocations` 中），前端 UI 仅认识 `UIMessage`（工具调用扁平化在 `parts` 中）。**严禁**在后端强行将带有 `type: "tool-invocation"` 的 `parts` 塞回给底层 SDK，必将引发 Zod `invalid_union` 死亡崩溃。

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

**[Ticket-07] STT 链路重构：弃用 Whisper，拥抱阿里云 ASR**

- **背景**：早期 MVP 阶段尝试了将 STT 压力前置到本地 (`whisper.cpp`)，但随之带来了沉重的模型分发体积负担，以及在低端设备上算力遭遇瓶颈导致的发热与卡顿。
- **修复与决策**：
  - **全面弃用 Whisper**：移除本地推理侧边车，释放客户端体积与性能压力。
  - **恢复云端 ASR 链路**：端侧现仅负责通过 FFmpeg 极速分离并提取纯净音频，随后直传 OSS，由 Hono 后端对接阿里云 ASR 完成高并发、高精度的语音识别。
  - 采用 Qdrant 命名空间隔离方案（前缀 `clipmind_`）解决单实例多项目共用问题。
- **⚠️ 避坑红线 (旧病历废除)**：早期提倡的 `tokio::task::spawn_blocking` 包裹 `Command` 的做法已被明确鉴定为**错误实践**，现已全量迁移至 Tauri v2 `app.shell().sidecar()` 原生异步 API。

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

### 🛑 10. Tailwind v4 双主题架构规范 (Light/Dark Mode)

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

### 🛑 11. 幽灵特异性与 Markdown 渲染 (Typography 陷阱)

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

### 🛑 12. 生产环境 JIT 运行时决断与 OOM 防线

- **架构事实**: 对于包含复杂类型推断（如 Drizzle + Zod）的 Monorepo 服务端，**严禁在容器构建阶段执行全量 `tsc` 编译**。这会导致 V8 堆内存溢出 (OOM)。
- **规范**: 生产环境统一采用 `tsx` 作为运行时 Runner。它基于 `esbuild` 进行即时转译，跳过类型检查，既能秒级启动，又能完美保留 `__dirname` 的物理路径血缘，确保 Migration SQL 脚本寻址正常。
- **pnpm 部署陷阱**: 在使用 pnpm v10+ 进行容器化抽取时，`pnpm deploy` 必须显式携带 `--legacy` 标志，否则会因为工作区注入策略改变而导致构建中断。

## 📝 [阶段更新] 服务端 Docker 化与 JIT 运行时改造

**1. 架构与状态流转 (Architecture State):**

- 引入了多阶段构建 Dockerfile，实现了生产依赖的物理隔离 (pnpm deploy)。
- 确立了以 `tsx` 为核心的生产运行时，彻底解决了 Monorepo 跨包引用导致的编译期 OOM 问题。
- 规范了非 root 用户 (`hono:1001`) 运行准则，提升了容器安全性。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO**: 严禁在没有 Bundler 的情况下强行将 TS 编译为 JS 运行，这会破坏 `@clipmind/db` 等本地包的相对路径寻址。
- **DON'T DO**: 严禁在 Docker 构建中盲目升级 pnpm 版本而不处理 `--legacy` 部署标志。

## 📝 [阶段更新] 定时任务架构与 OSS 幽灵资产自动巡检

**1. 架构与状态流转 (Architecture State):**

- 引入 `node-cron` 建立后端定时任务防线。
- 废弃了原先散落在路由中的 OSS 客户端局部实例化，将其统一抽离为 `apps/server/src/utils/oss.ts` 全局单例。
- 新增 `cleanup-dangling-oss.ts` 任务：在服务启动时进行一次异步非阻塞巡检，随后挂载至每天凌晨 03:00 的 Cron 调度。通过比对 `assets` 表中的 `ossUrl` / `audioOssUrl` 与 OSS 实际物理存储，自动抹除未落盘的幽灵文件。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (防误删红线)**: 严禁在 OSS `list` 扫描时省略 `prefix`。必须严格限定扫描域（如 `prefix: 'assets/'`），否则一旦逻辑异常，极易清空整个 Bucket 的其他业务资源。
- **DON'T DO (OOM 崩溃防线)**: 严禁不带游标（marker）无限制地请求 OSS 列表。必须采用 `do-while` 和 `max-keys` 结合的游标分页策略，防范海量文件撑爆 Node.js 内存。
- **路径提取陷阱**: 数据库存储的是完整绝对 URL，而 OSS 删除 API 需要的是纯粹的 Object Key。比对前必须使用 `URL` 对象结合 `decodeURIComponent` 精准剥离域名及前导斜杠。

**3. 新共识与规范 (New Conventions):**

- **定时任务挂载点**: 后续所有 Cron 任务必须收敛至 `apps/server/src/jobs/` 目录，并统一在 `index.ts` 数据库迁移 (`migrate`) 完成后集中调用挂载。

## 📝 [阶段更新] 资产物理删除链路与乐观 UI 更新

**1. 架构与状态流转 (Architecture State):**

- **云端大脑**: 在 Hono 侧 (`apps/server/src/routes/assets.ts`) 引入了 Drizzle 的 `eq` 算子，新增了 `DELETE /:id` 路由，打通了底层的物理删除能力。
- **视图流转**: 废弃了传统的全量刷新，在前端 (`assets.tsx`) 引入了 React Router 的 `useRevalidator`。在删除接口返回 200 OK 后，调用 `revalidator.revalidate()` 触发 Loader 重新拉取数据，实现极致流畅的“乐观 UI”更新。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (SPA 刷新毒瘤)**: 严禁在 React Router 架构中使用 `window.location.reload()` 去刷新列表。这会摧毁整个 SPA 的内存状态，导致用户体验断崖式下跌。必须强制使用 `revalidator.revalidate()` 配合后端的 JSON 数据流。
- **DON'T DO (事件冒泡黑洞)**: 严禁在资产卡片内部的 `<button>`（如悬浮删除按钮）中漏写 `e.stopPropagation()`。否则极易触发卡片层级的点击事件，导致意外的页面跳转或弹窗。

**3. 新共识与规范 (New Conventions):**

- **原生降级策略**: 在引入重型的自定义无头组件（Headless UI / Radix）之前，对于毁灭性操作（如删除资产），规范统一下放使用原生的 `window.confirm` 进行二次确认拦截，以最轻量的代码保障系统级安全。

## 📝 [阶段更新] Asset 上传链路状态机与端云透传修复

**1. 架构与状态流转 (Architecture State):**

- **UI 状态机闭环**: 修复了前端上传进度条在 100% 时的死锁问题。现已引入进度拦截机制，当达到 100 时强制流转 `status` 为 `ready`，并显式调用 `revalidator.revalidate()` 触发 React Router v7 的 Loader 重新获取并渲染最新的资产列表。
- **全链路文件名透传**: 修复了“乱码文件名”的幽灵 Bug。原有的 `jobId` 现仅作为底层物理文件的并发隔离标识，真实的 `job.filename` 已实现跨进程透传给 Rust 层，并最终组装进 `ReportPayload` 向 Hono 后端落盘。
- **死码清理 (Tech Debt Resolved)**: 彻底从 Tauri v2 IPC 路由表 (`generate_handler!`) 中移除了已废弃的遗留指令 (`process_asset`, `upload_asset`, `notify_webhook`)，消除了前端幽灵调用的隐患。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (状态更新遗漏)**: 严禁在监听后台进度事件（如 `upload-progress`）时，只无脑更新数值而不处理业务终态。必须显式拦截完成态并触发视图层（Loader）的脏数据刷新。
- **DON'T DO (标识符污染业务数据)**: 严禁为了省事用唯一标识符（如 `jobId`）去顶替本该跨端透传的业务元数据（如原始文件名），这必然会导致数据库产生无法挽回的幽灵脏数据。

**3. 新共识与规范 (New Conventions):**

- 现已确立底层 Rust 侧边车任务 (`process_video_asset`) 必须“包揽全流程”，包括向 Node 端发起 `POST /report` 落盘请求。前端已彻底退化为纯粹的状态观察者（Observer），禁止前端插手上传后的落盘网络交互。

## 📝 [阶段更新] 云端 ASR 架构决断与 Webhook 幂等防御 (Cloud-First)

**1. 架构与状态流转 (Architecture State):**

- **推翻离线优先 (Ticket-07 过时)**: 为了追求极速交付与商业级识别精度，正式废弃端侧 `whisper.cpp` 方案。系统全面转向 **阿里云录音文件识别 (FileTrans)**。
- **端侧音频降维隔离**: Rust 侧边车仅保留音轨极速分离职责，强制降维至 `16kHz / 单声道 AAC (32kbps)` 后直传 OSS。这完美契合了阿里云大模型的最佳识别区间，并将带宽损耗压缩至极限。
- **状态机贯穿**: 在 `assets` 核心表中新增 `asrTaskId` 与 `asrStatus`，彻底打通了长音频异步回调的状态流转追踪。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (无脑 Webhook 落盘)**: 严禁在 OSS 回调接口 (`oss-callback.ts`) 中直接执行 `db.insert`。公有云 Webhook 极易因网络抖动发生重试，必须使用 `eq(assets.ossUrl, objectKey)` 配合 `limit(1)` 进行前置查询，实现绝对的幂等性拦截，死防幻觉资产和主键冲突报错。

**3. 新共识与规范 (New Conventions):**

- **异步不阻塞原则**: 在 Webhook 路由中触发 ASR 任务时，必须采用异步离线触发（如 `Promise.then` 挂载），绝对不允许阻塞向 OSS 返回 `200 OK`，否则会导致 OSS 端认为回调失败而疯狂重试。

## 📝 [阶段更新] FFmpeg 视频时长提取与端云透传修复

**1. 架构与状态流转 (Architecture State):**

- **时长精准透传**: 修复了资产上传落盘后，界面时长永远显示为 0 的 Bug。在 `process_video_asset` 核心业务的异步侧边车（Sidecar）处理循环中，全量补齐了对 FFmpeg `Duration` 字段的轻量级提取逻辑。
- **状态机闭环**: 提取到的真实时长现已正确转换并组装进入 `ReportPayload`，随落盘请求发送至 Hono 后端，彻底替换了之前占位用的硬编码 `duration: 0`。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (逻辑断层与幻觉兜底)**: 绝对禁止在重构业务流水线时，将核心状态的提取逻辑遗落在废弃的分支或独立的死代码中。本次问题的根源在于，真正执行音视频分离的 `async` 循环成了“瞎子”，导致下游组装网络请求时，为了通过编译而被迫写死默认值。

**3. 新共识与规范 (New Conventions):**

- **数据血缘的不可篡改性**: 在 Rust 底层向云端大脑（Node Server）发起落盘通知时，Payload 中的所有业务元数据（如时长、文件大小）必须来源于真实的物理探测，严禁使用魔法值兜底。

## 📝 [阶段更新] CI/CD 架构演进与跨平台并发构建 (GitHub Actions)

**1. 架构与状态流转 (Architecture State):**

- **双轨制远端与三端并发流水线**: 确立了内部 Gitea (`origin`) 与外部 GitHub (`github`) 的双轨托管架构。引入了基于 GitHub Actions 的 `build.yml` 工作流，支持 macOS、Windows 和 Linux 的云端并发无头构建。
- **环境隔离**: 所有的 Tauri release 构建正式剥离本地环境，彻底杜绝本地环境碎片化导致的幽灵编译报错。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (二进制越界黑洞)**: 严禁将针对特定目标平台下载的 `ffmpeg-<target>` 二进制文件提交至 Git。这会撑爆仓库并引发毁灭性的文件冲突。
- **DON'T DO (防线穿透)**: `tauri.conf.json` 中的 `externalBin` 声明必须与根目录 `.gitignore` 保持一致。现已实施 `bin/ffmpeg-*` 与 `ffmpeg-*` 双重封锁。

**3. 新共识与规范 (New Conventions):**

- **云端构建唯一真理**: 正式包构建必须由向 GitHub 远端推送代码来驱动。严禁本地手动构建并私下分发。
- **DON'T DO (Action 版本幻觉)**: 严禁想当然地认为 `tauri-apps/tauri-action` 的版本与 Tauri 框架版本同步。即使 Tauri 升级到了 v2，官方 Action 的主干版本标签依然是 `@v0`。写错版本号会导致 CI 流水线直接在初始化阶段崩溃 (Unable to resolve action)。
- **DON'T DO (Monorepo 上下文丢失)**: 在 Monorepo 架构下使用 `tauri-action` 时，严禁省略 `projectPath`。必须显式声明（如 `projectPath: apps/desktop`），否则 Action 会在根目录寻找配置文件并触发错误的回退机制。
- **DON'T DO (默认 Identifier 黑洞)**: 严禁将 `tauri.conf.json` 中的 `identifier` 保持为默认的 `com.tauri.dev`，否则在执行 `tauri build`（尤其是跨平台时）会遭到系统的直接阻断。
- **DON'T DO (Monorepo 上下文丢失)**: 在 Monorepo 架构下使用 `tauri-action` 时，严禁省略 `projectPath`。必须显式声明（如 `projectPath: apps/desktop`），否则 Action 会在根目录寻找配置文件并触发错误的回退机制。
- **DON'T DO (默认 Identifier 黑洞)**: 严禁将 `tauri.conf.json` 中的 `identifier` 保持为默认的 `com.tauri.dev`，否则在执行 `tauri build`（尤其是跨平台时）会遭到系统的直接阻断。
- **DON'T DO (子包 CLI 别名缺失)**: 在 Monorepo 架构中，如果将 Tauri 放置在子包（如 `apps/desktop`）内，必须在其 `package.json` 的 `scripts` 中显式声明 `"tauri": "tauri"`。否则，GitHub Actions 无法通过包管理器正确的唤起局部 Tauri CLI 进行跨平台构建。
- **DON'T DO (Git 空目录陷阱与 IO 崩溃)**: 在编写自动化下载 Sidecar 等预处理脚本时，严禁假设目标父目录必定存在。由于 `.gitignore` 会导致被忽略的目录在全新 Clone 的环境中（如 CI 容器）完全不存在，直接执行下载或写入必然引发 `No such file or directory` 崩溃。必须强制引入 `fs.mkdirSync(dir, { recursive: true })` 进行防御。
- **DON'T DO (宿主机架构依赖)**: 在 CI 环境（尤其是涉及交叉编译的 GitHub Actions）中，严禁在脚本中使用 `process.arch` 或 `rustc -vV` 来决定 Sidecar 的下载版本。这会导致在 ARM 宿主机上编译 x86 产物时下载错误的二进制文件。
- **新规范**: 必须优先读取 `TARGET_TRIPLE` 环境变量，基于“目标架构”映射下载地址和文件名后缀。
- **DON'T DO (丢失产物与 403 黑洞)**: 严禁仅仅调用 `tauri-action` 就指望它自动发布。必须显式配置 `tagName: v__VERSION__` 才会触发底层的 GitHub Release 机制。同时，必须在 workflow 的 job 级别显式赋予 `permissions: contents: write`，否则会遭到 GitHub 安全策略的 403 拦截，导致产物挂载失败。

## 📝 [阶段更新] AI SDK 规范准则引入与文档阅读协议

**1. 架构与状态流转 (Architecture State):**

- **规范前置**: 确立了 AI 相关代码开发的“文档先行”原则。在 AI 逻辑进入编码阶段前，必须完成对最新协议标准的对齐。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (协议幻觉)**: 严禁在未阅读最新官方协议的情况下盲目编写 AI 逻辑。Vercel AI SDK 迭代极快，依赖旧记忆编写的代码极易在多模态转换或 Tool Calling 链路中引发不可预测的静默失败。

**3. 新共识与规范 (New Conventions):**

- **强制阅读协议**: 正式将 `https://ai-sdk.dev/llms.txt` 列为 AI 开发的必读规范。所有涉及 Vercel AI SDK 的开发任务，必须首要核对该文档以确保代码符合当前的 LLM 交互协议。

## 📝 [阶段更新] ClipMind 品牌化与硬编码清理 (Persona Unified)

**1. 架构与状态流转 (Architecture State):**

- **统一化自称**: 移除了前端 `ChatPanel.tsx` 顶部的 "AI 助理" 以及聊天气泡中的 "AI" 占位符。系统界面与后端的 System Prompt 全面统一定制为 **ClipMind** (简写 CM)。
- **去账号化**: 删除了 `GlobalSidebar.tsx` 左下角硬编码的用户头像（Avatar）占位符结构，进一步聚焦于核心的创作工作流。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (黑洞目录扫描)**: 严禁在 Monorepo / Tauri 架构下使用全局 `grep` 或 `find` 而不显式物理阻断 `target` (Rust 编译产物)、`node_modules` 和 `dist` 等重灾区。这会导致毁灭性的 I/O 阻塞和系统假死。必须建立 `--exclude-dir` 和 `-prune` 的防御性探测肌肉记忆。
- **DON'T DO (排版溢出陷阱)**: 在微小尺寸的容器（如 `w-7 h-7` 的气泡头像）中，严禁强行填入长文本（如 "ClipMind"）。必须采用缩写（"CM"）或 SVG 图标，防止撑爆 Flex 布局和破坏视觉完整性。

**3. 新共识与规范 (New Conventions):**

- **品牌一致性防线**: 后续新增的任何提示词、UI 占位符、引导页或报错文案中，**绝对禁止**退化使用泛指的 "AI" 或 "系统"。必须且只能使用产品级专属代号 "ClipMind"。

## 📝 [阶段更新] 视频截帧与端云多轨并发直传架构

**1. 架构与状态流转 (Architecture State):**

- **底层一鱼三吃**: 升级了 Rust 侧的 FFmpeg 处理管线，在剥离音频的同时，利用 `-ss 00:00:00.500 -vframes 1` 同步极速提取首帧缩略图。
- **多轨预签名与并发直传**: Hono 后端的 `upload-token` 路由现支持同时签发 `video`、`audio` 和 `thumb` 三条轨道的 OSS 直传 Token。Rust 侧开启多路 `tokio::spawn` 异步任务将缩略图与音频同步推送上云。
- **数据模型演进**: `@clipmind/db` 中的 `assets` 表正式新增 `thumbnailUrl` 字段，实现了视觉资产的云端持久化。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (端云架构的数据断层)**: 在升级全链路协议时，绝对不能只重启/编译客户端。由于 Rust 的 `serde` 强类型反序列化特性，如果 Node 后端尚未部署新版路由（未下发 `thumbUploadUrl`），客户端的 Token 解析会直接触发 `error decoding response body` 致命崩溃。必须保证“云端先行部署”的发布次序。

## 📝 [阶段更新] 流式输出防抖与渲染风暴隔离 (Render-Thrashing Prevention)

**1. 架构与状态流转 (Architecture State):**

- 针对 AI 长文本流式输出场景，确立了“瞬时 DOM 对齐”的滚动策略。废弃了由 `smooth` 动画主导的滚动视图更新，避免与 React 的高频 Re-render 产生生命周期冲突。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (动画帧碰撞与白屏黑洞)**: 严禁在 AI 流式输出（如 `useChat` 的 `messages` 依赖变化时）使用 `messagesEndRef.current.scrollIntoView({ behavior: "smooth" })`。
- **血泪教训**: `smooth` 会触发浏览器底层的异步重排动画（约 300ms）。在几十毫秒一次的 token 流式吐出时，高频的 DOM 更新会不断打断并重置动画帧，导致合成器线程排队碰撞。轻则视觉剧烈抽搐，重则触发 React `Maximum update depth` 或撑爆 V8 引擎导致白屏崩溃。

**3. 新共识与规范 (New Conventions):**

- **流式滚动规范**: 在需要跟随高频流式内容自动滚动的场景中，必须且只能使用 `behavior: "auto"` 或直接操作 `scrollTop` 实现无缝瞬时对齐。

## 📝 [阶段更新] 全局弹窗组件通用化与显式状态流转

**1. 架构与状态流转 (Architecture State):**

- 彻底抛弃了原生浏览器 `window.confirm` 的丑陋拦截，将其替换为受控的 `DeleteConfirmModal` React 组件。
- 实现了 `DeleteConfirmModal` 的通用化重构。它不再硬编码针对“项目 (Project)”的文案，而是通过开放 `title` 和 `description` Props，成功复用于 `assets.tsx` 的资产删除链路与 `home.tsx` 的项目删除链路。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (隐式参数陷阱)**: 严禁在设计跨域复用的基础组件时，依赖默认缺省参数去处理主要业务线（如用缺省值代表 Project，用显式传参代表 Asset）。所有业务链路的调用必须保持**绝对显式 (Explicit)** 的对称设计，防止后续增加业务线时产生逻辑脑裂。
- **DON'T DO (经验主义与幽灵路径)**: 严禁凭借经验盲猜文件路径。在进行全局搜索和替换时，必须基于 `find` 或 `grep` 的绝对输出证据进行寻址。本次在寻找 Project 路由时，差点因为预判 `projects.tsx` 而导致脚本崩溃。

**3. 新共识与规范 (New Conventions):**

- **原生降级废除**: 此后 ClipMind 桌面端中任何涉及“毁灭性操作（删除、覆盖等）”的拦截器，必须强制采用统一样式的受控 Modal 组件（如 `DeleteConfirmModal`），绝对禁止再出现原生 `window.confirm`。

## 📝 [阶段更新] 全局弹窗双态主题适配与交互闭环

**1. 架构与状态流转 (Architecture State):**

- 修复了 `DeleteConfirmModal` 基础组件的主题断层问题。移除了硬编码的深色类名，全面适配了 Tailwind v4 的双态主题 (Light/Dark Mode)，保证了在不同系统偏好下的视觉一致性。
- 补全了弹窗的交互闭环：在底层 Overlay 注入了点击外部遮罩层自动关闭 (`onCancel`) 的标准逻辑。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (硬编码单态主题)**: 严禁在全局通用组件（如弹窗、表单、卡片）中硬编码 `bg-zinc-900` 等深色类名。必须强制使用双态响应式类名（如 `bg-white dark:bg-zinc-900`），防止在 Light 模式下产生突兀的“黑斑”。
- **DON'T DO (事件冒泡黑洞)**: 在实现点击遮罩层关闭弹窗时，严禁忘记在弹窗内部内容层（Content）的 DOM 节点上绑定 `onClick={(e) => e.stopPropagation()}`。如果不显式阻断冒泡，用户在弹窗内部的任何正常点击都会穿透到遮罩层，错误触发关闭。

**3. 新共识与规范 (New Conventions):**

- **标准交互与视觉底线**: 后续系统中新增的任何受控 Modal/Dialog 弹窗组件，必须标配双态主题支持，且必须实现“外部遮罩关闭 + 内部冒泡阻断”的安全交互双重防线。

## 📝 [阶段更新] 端云多轨并发落盘与私有资产分发重构 (OSS Signed URLs)

**1. 架构与状态流转 (Architecture State):**

- **彻底的存储与分发分离**: 确立了“数据库只存 Key，接口动态分发”的安全架构。前端提交以及数据库落盘的音视频、缩略图路径，现已全部规范为纯粹的 OSS Object Key（如 `assets/{id}/video.mp4`）。
- **动态鉴权防线**: 彻底废弃了在前端硬编码 OSS 域名或在后端简单拼接绝对路径的做法。对于私有 Bucket 资产，统一在 `GET /api/assets` 路由层由 `ossClient.signatureUrl` 动态签发附带 `Expires` 和 `Signature` 的临时授信链接。
- **HTTPS 强制化 (Secure Context)**: `ossClient` 已全量注入 `secure: true` 选项，确保桌面端 Tauri (基于 WebKit/WebView2) 不会因为“混合内容 (Mixed Content)”安全策略而拦截未加密的媒体流。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (抽象泄漏)**: 严禁将底层物理存储基座的配置（如云端 Bucket 域名）暴露给纯展示层的前端环境配置 (`env.ts`) 中，必须严格遵守端云解耦底线。
- **DON'T DO (Reqwest 静默吞错陷阱)**: 严禁在 Rust 层调用 `reqwest` 执行 `PUT` 直传后，仅简单执行 `.await?`。只要 HTTP 握手成功，即使 OSS 返回 `403 Forbidden`，Reqwest 也会将其包装为 `Ok(Response)` 返回。**必须强制校验 `!response.status().is_success()` 并抛出真实错误**，否则会导致直传失败却依然向服务端上报落盘请求的“假死”灾难。
- **血泪教训 (Content-Type 大小写敏感血案)**: 阿里云 OSS 的防篡改签名机制严格校验 `Content-Type`。若客户端上传 `.MOV`，Rust 会智能匹配为 `video/quicktime` 请求头；但若后端未强制执行 `.toLowerCase()`，会因判定失效而签发 `video/mp4` 权限。这一字节级别的非对齐，会直接导致 `SignatureDoesNotMatch` 拒绝访问。

**3. 新共识与规范 (New Conventions):**

- **端云类型严格对齐**: 任何涉及客户端请求构建与云端预签名计算的双端协作，其核心输入变量（如文件后缀、MIME Type）在两端都必须进行严格的标准化降维处理（强制小写/去空），杜绝大小写引发的安全拦截。
- **借用检查防御**: 在 Rust 中调用 `response.text().await` 提取错误信息时，会发生所有权转移 (Move)。若后续还需要获取 `response.status()`，必须提前 `let status = response.status();` 进行克隆缓存，严禁引发 `borrow of moved value` 编译中断。

## 📝 [架构交接] 云端 ASR 管线完整实施方案 (Aliyun FileTrans)

**工单状态**: 基础设施已就绪，等待线上 E2E 联调与 Webhook 解析器落地。
**交接背景**: 本系统已正式推翻端侧 `whisper.cpp` 的离线方案，全面转向阿里云智能语音交互（录音文件识别 FileTrans）服务。前端视频上传与底层 Rust 音频分离降维（16kHz AAC）已完成，现将云端异步回调链路交接给后续开发者。

### 📊 一、 外部知识沉淀 (调研结论与 API 情报)

为了避免后续开发者重复查阅阿里云冗长的文档，现将核心对接情报固化如下：

1. **为什么选型 FileTrans**：该接口专为长音频（最长120分钟）离线转录设计，原生支持智能语义分片与断句。
2. **核心刚需契合点**：它能返回精准到**毫秒级 (BeginTime / EndTime)** 的时间戳，这对于我们后续构建基于视频时间轴的 RAG (检索增强生成) 切片回放是不可或缺的底层数据。
3. **交互模式**：全异步架构。必须先通过 `SubmitTask` 提交音频 URL，系统进入排队；完成后，阿里云会主动向我们的服务器发送 POST Webhook 包含全量转录结果。
4. **核心 Payload 结构** (接手人必读，用于编写解析器)：

   ```json
   {
     "TaskId": "阿里云生成的唯一任务ID",
     "StatusCode": 21050000, // 成功状态码
     "StatusText": "SUCCESS",
     "Result": {
       "Sentences": [
         {
           "BeginTime": 1250, // 毫秒
           "EndTime": 4500,
           "Text": "第一段切片字幕。"
         }
       ]
     }
   }
   ```

### 🏗️ 二、 已经完成的架构基建 (What is Done)

接手人无需再碰以下底层逻辑，它们已经历过架构级的防腐败加固：

1. **端侧音频强制降维**：Rust 层 FFmpeg 已锁定 `-ar 16000 -ac 1`，输出最契合阿里云大模型的 16kHz 单声道音频。
2. **状态机数据库扩容**：`assets` 表已新增 `asrTaskId` 和 `asrStatus` ('pending' | 'processing' | 'completed' | 'failed')；同时预留了 `asset_chunks` 表用于存储 RAG 字幕切片。
3. **Webhook 绝对幂等**：`apps/server/src/routes/oss-callback.ts` 中已注入基于 `ossUrl` 的 Drizzle `eq` 唯一性拦截，免疫阿里云的重试风暴。
4. **动态预签名提权**：在 `aliyun-asr.ts` 中，已修复私有 Bucket 的 403 黑洞。提交任务前会自动调用 `ossClient.signatureUrl` 签发具有 2 小时有效期的临时 URL 供阿里云拉取。

### 🎯 三、 接手人待办事项 (What needs to be done)

接下来的开发者请严格按照以下 3 步走，不要跳过任何一步：

**阶段 1：线上环境变量补全 (运维防线)**
在 `clipmind.prodream.cn` 线上服务器的 Node.js 环境变量中，必须注入以下参数（Zod 强类型已开启拦截，不填直接 Crash）：

- `ALIYUN_ACCESS_KEY_ID`: 阿里云 AK
- `ALIYUN_ACCESS_KEY_SECRET`: 阿里云 SK
- `ALIYUN_ASR_APPKEY`: 智能语音交互 AppKey（已废弃含糊的 ALIYUN_APPKEY 命名）
- `PUBLIC_WEBHOOK_DOMAIN`: 固定为 `https://clipmind.prodream.cn`

**阶段 2：编写并挂载 ASR 回调解析器 (核心开发任务)**
你需要在 `apps/server/src/routes/` 下新建 `asr-callback.ts` 路由。它的唯一职责是接收阿里云的 POST 请求：

1. **提取 TaskId**：根据 `req.body.TaskId`，在 `assets` 表中反查出对应的 `assetId`。
2. **状态扭转**：将该资产的 `asrStatus` 标记为 `completed`。
3. **切片落盘**：遍历 `Result.Sentences` 数组，将每一句映射为 `assetChunks` 表的结构（关联 `assetId`，映射 `startTime`, `endTime`, `transcriptText`）并批量 `db.insert`。

**阶段 3：执行线上 E2E 验证 (验尸官环节)**
一切就绪后，直接通过线上桌面端上传一个 1-3 分钟的视频。约 1 分钟后，登录线上数据库执行验尸 SQL：

```sql
-- 验证状态机是否流转
SELECT asr_status FROM assets ORDER BY created_at DESC LIMIT 1; 

-- 验证 RAG 切片是否落盘成功且时间轴递增
SELECT start_time, end_time, transcript_text FROM asset_chunks WHERE asset_id = '刚上传的ID' ORDER BY start_time ASC;
```

### 🛑 四、 架构红线与避坑指南 (DON'Ts)

- **DON'T DO (私有资产暴露)**：严禁在 `submitAliyunAsrTask` 中直接将 `objectKey` 拼接域名传给阿里云。Bucket 是私有的，不带签名的 URL 会被直接拦截导致 ASR 静默失败。
- **DON'T DO (阻塞 OSS 回调)**：在 `oss-callback.ts` 触发 `submitAliyunAsrTask` 时，必须是异步 `Promise.catch`。绝对禁止 `await`，不能让调用阿里云的网络开销拖住给 OSS 响应 200 OK 的时间。

## 📝 [阶段更新] OSS 流式直传真实进度与节流防风暴重构

**1. 架构与状态流转 (Architecture State):**

- 彻底移除了 `process_video_asset` 中关于视频直传进度的硬编码 (10% 突跳 90%) 假死现象。
- 引入了 `futures_util::StreamExt::map` 作为中间件拦截 `FramedRead` 产生的异步字节流，实现了基于真实 I/O 消耗的精确进度追踪。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (进度盲猜与假死)**: 严禁在长耗时的异步网络请求前后硬编码发送首尾进度状态。必须深入底层流式 I/O 提取真实的 `chunk_size` 累加。
- **DON'T DO (IPC 风暴与内存积压)**: 极速的分块读取会产生海量的循环迭代。如果在流式拦截器中毫无节制地调用 `app.emit`，会瞬间导致 V8 引擎假死。必须在闭包中引入 `std::time::Instant` 状态，强制实施 500ms 节流。
- **生命周期逃逸与推断黑洞**: 在 `StreamExt::map` 的闭包中，必须使用 `move` 关键字捕获克隆后的 `AppHandle` 和变量，并且在最后 `Ok` 返回时强制显式声明类型 `Ok::<bytes::Bytes, std::io::Error>(bytes_mut.freeze())`，以防 Rust 编译器陷入泛型推断死循环。

**3. 新共识与规范 (New Conventions):**

- **零拷贝与类型冻结**: 在处理 `reqwest` 的 `Body::wrap_stream` 边界时，统一采用 `tokio_util` 的 `BytesMut` 结合 `.freeze()` 的方式转换为安全的不可变 `Bytes`，实现全程零拷贝传递。

## 📝 [阶段更新] 云端 ASR 管线基建与环境防线 (Aliyun FileTrans)

**1. 架构与状态流转 (Architecture State):**

- **环境单点防御**: 在 `apps/server/src/env.ts` 中全面接入了阿里云 ASR 所需的 AK/SK 与 Webhook 域名校验。实现了强类型与 Fail-Fast 阻断，彻底禁用了在业务代码中直读 `process.env` 的行为。
- **回调解析器落地**: 完成了 `apps/server/src/routes/asr-callback.ts` 的编写与主路由挂载。该路由严格遵循阿里云 FileTrans 官方 Payload 结构，打通了从 TaskId 反查、资产状态流转到毫秒级 RAG 切片 (`assetChunks`) 批量落盘的完整闭环。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (Monorepo 模块寻址陷阱)**: 严禁在 Monorepo 根目录下使用 `tsx` 直接运行深层子包（如 `apps/server`）的独立脚本。这会导致 Node 模块解析器无法正确穿透并加载子包局部的 `node_modules`（如 `mysql2`），引发幽灵的 `MODULE_NOT_FOUND` 错误。必须进入子包上下文后执行。
- **DON'T DO (硬编码密钥泄漏)**: 绝对禁止在 `utils` 等底层工具类中直接 `process.env.XXX`。不仅破坏了类型安全，更极易引发线上环境缺少配置时的静默失败。

**3. 新共识与规范 (New Conventions):**

- ASR 任务提交必须强依赖 `serverConfig.PUBLIC_WEBHOOK_DOMAIN` 作为回调基地址，确保本地开发与线上部署的网络链路具有自适应性。

## 📝 [阶段更新] Tauri 生产环境 CORS 与自定义协议安全防线 (Production CORS Matrix)

**1. 架构与状态流转 (Architecture State):**

- 明确了 Tauri 桌面端在开发模式与生产模式下的底层网络环境差异。在构建为 Release 产物后，Tauri 前端将脱离本地的 Web Server 端口，转而由原生系统的 WebView 通过自定义协议（Custom Protocol）进行加载。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (CORS 盲区与静默失败)**: 严禁在 Node Server 后端的 CORS 配置中仅放行开发端口（如 `http://localhost:1420`）。在生产环境中，系统会使用 `http://tauri.localhost`（或 `tauri://localhost`）。若 CORS 白名单遗漏这些自定义协议域名，生产包的接口调用会被 WebKit/WebView2 视作跨域并被无情且静默地拦截。由于生产包默认剥离了 DevTools，这极易演变成幽灵 Bug。

**3. 新共识与规范 (New Conventions):**

- **多端 CORS 矩阵**: 后端服务（Hono）的环境变量 `CORS_ORIGIN` 必须是一个严格包含多端的配置。在上线 Tauri 生产包前，必须验证白名单内同时包含开发态 URL 与生产态的自定义协议 URL。

## 📝 [阶段更新] OSS 幽灵资产巡检 DDD 重构与白名单黑洞修复 (Data Loss Prevention)

**1. 架构与状态流转 (Architecture State):**

- **DDD 聚合根防线**: 彻底重构了 `cleanup-dangling-oss.ts` 的巡检逻辑。废弃了通过 `ossUrl`、`audioOssUrl` 等具名轨道字段拼接白名单的脆弱做法。
- **目录级物理校验**: 确立了以 `assetId` 为核心的领域聚合根判定标准。现有的巡检逻辑会直接提取 OSS 文件路径中的 `assetId`（如 `assets/{assetId}/...`），只要该 ID 在数据库中存活，该目录下的所有轨道文件（含未来新增的字幕、水印等）均受绝对保护。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (白名单黑洞与数据误删)**: **绝对禁止**在遍历校验物理资产时，依赖数据库中硬编码的字段列（如只查 video 和 audio）去生成放行白名单。我们在新增 `thumbnailUrl` 时忘记更新巡检任务，导致合法的缩略图被当成幽灵资产大面积误删。业务层级的字段扩展绝不能影响底层存储的安全底线。

**3. 新共识与规范 (New Conventions):**

- **目录即生命周期**: 后续任何新增的媒体轨道（Track），必须统一放置在 `assets/{assetId}/` 的物理边界内。底层清理任务只认 `assetId`，不再关心具体的轨道业务文件。

## 📝 [阶段更新] 进度条排版折行与 Tailwind Flex 宽度陷阱

**1. 架构与状态流转 (Architecture State):**

- 优化了资产列表 (`assets.tsx`) 的状态与进度条渲染层。修复了因文本超长导致的 Flex 子容器折行与高度撑破问题，确保了极速处理与直传状态下的视觉稳定性。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (硬编码宽度陷阱)**: 严禁在包含动态长度文本（如不断增长的进度百分比、含 Emoji 的状态文字）的 Flex 子项中，仅依靠硬编码短宽度（如 `w-20`）进行限制。当内容超限时，默认的 Flex 行为会允许文本折行，直接破坏整体行高与排版。

**3. 新共识与规范 (New Conventions):**

- **单行文本防御组合**: 后续在处理类似单行进度条、状态徽章等 Flex 布局时，必须将 `shrink-0`（防挤压）与 `whitespace-nowrap`（防折行）作为标配防御组合注入，然后再配合相对宽裕的预设宽度（如 `w-28`）保证垂直对齐。

## 📝 [阶段更新] 上传区状态闭环与竞态条件 (Race Condition) 防御

**1. 架构与状态流转 (Architecture State):**

- 实现了 `assets.tsx` 内部的上传区自动收起闭环。废弃了提升状态至父组件 (Context/Props) 的过度设计方案，改为在路由内部通过 `useEffect` 嗅探 `jobs` 队列的终态（`ready` 或 `error`）。
- 引入了 3 秒的视觉缓冲期，在任务全量完成后平滑地销毁任务流（隐藏上传区）。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**

- **DON'T DO (无脑重置与竞态截断)**: 严禁在异步延时回调（如 `setTimeout`）中直接执行绝对的状态覆盖（如 `setJobs([])`）。如果用户在倒计时期间拖入了新素材，粗暴的重置会把正在排队或上传的新任务直接“谋杀”，造成严重的数据截断。

**3. 新共识与规范 (New Conventions):**

- **原子化校验防线**: 所有基于延时的状态销毁，必须在执行瞬间使用 `set(current => ...)` 提取最新状态快照进行二次比对。一旦发现状态已不符合销毁条件（如加入了新任务），必须立即 `return current` 放弃操作。
- **内存泄漏防御**: 所有挂载了 `setTimeout` 的 `useEffect`，必须在其开头拦截空状态（如 `if (jobs.length === 0) return;`），并在结尾强制返回 `clearTimeout` 清理函数。

## 🩸 架构血泪教训 (ASR 端云全链路篇)

### 1. IPC 通信风暴与前端 V8 引擎崩溃
- **案发现场**：在 Rust 侧读取视频流直传 OSS 时，通过 `emit` 向前端发送进度。当文件读取到末尾时，高频穿透了条件判断，瞬间发射数千个事件。
- **物理表现**：Tauri 前端进程直接抛出 `NeedDebuggerBreak trap` 并白屏崩溃 (OOM)。
- **防线铁律**：所有底层的流式事件上报，**必须且只能使用时间戳节流（如 500ms）**，坚决摒弃 `uploaded == total` 这种容易在文件尾部引发微小波动重试的逻辑判断。

### 2. 阿里云 ASR 模型采样率错位 (静默秒杀)
- **案发现场**：向阿里云提交任务后返回 `SUCCESS`，但主动查询任务状态时发现报 `41050008 (UNSUPPORTED_SAMPLE_RATE)`，Webhook 永远不会触发。
- **根本原因**：阿里云的 `AppKey` 强绑定声学模型（如 16kHz 通用模型）。如果底层 FFmpeg 抽离音频时忘记加 `-ar 16000` 降维参数，将 48kHz 的原声扔给云端，会被立刻拒收且无明确报错。
- **防线铁律**：永远不要信任源视频的音频规格。在 `process_video_asset` 侧边栏任务中，抽离音频必须强制锁定为 `16kHz, 单声道, 32kbps AAC`。

### 3. OSS 私有资产的云端分发盲区
- **案发现场**：提交给阿里云的 `file_link` 直接填了数据库里的 `ObjectKey`。
- **防线铁律**：永远不要把 `ObjectKey` 直接传给第三方服务。必须在下发任务前，通过 `ossClient.signatureUrl(url, { expires: 7200 })` 动态签发带有失效时间的 HTTP 预签名链接。

### 4. 路由黑洞 (The Routing Blackhole)
- **案发现场**：阿里云处理成功，但 Node 后端没有任何日志，触发了阿里云的指数退避重试并最终死信。
- **根本原因**：写好了 `asr-callback.ts`，却忘记在 `index.ts` 中通过 `app.route` 挂载它，导致阿里云吃到了 404 闭门羹。
- **防线铁律**：每写一个对外的 Webhook 接口，第一步先去主入口挂载，并用 `curl` 或 Postman 打一个空包验证 `400 Bad Request`，证明大门是敞开的。

## 📝 [阶段更新] 端侧连环并发风暴与 IPC 崩溃治愈 (OOM & V8 Trap)

**1. 架构与状态流转 (Architecture State):**
- 移除了前端 `assets.tsx` 中的冗余的全局 `upload-progress` 事件监听器，修复了多任务并发时 React 闭包互相覆盖导致的“进度冻结”死锁。
- 修复了 Rust 层 `ffmpeg-progress` 的 JSON 序列化发射协议，使其正确匹配前端的 `{ log: string }` 结构。
- 移除了 Rust 侧边车脱壳并发上传阶段冗余的缩略图 `File::open` 读取块，阻断了 IO 句柄的翻倍抢夺。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (IPC 事件洪水与 V8 崩溃)**: 在使用 Tauri 处理诸如文件流读取或外部进程输出时，**绝对禁止**省略时间节流阀，更**禁止**在限流判断中混入无意义的短路逻辑（如 `|| uploaded == file_size`）。这会导致极小文件在读取末尾时瞬间击穿限流阀，一秒内向前端 V8 引擎发射数以万计的事件，直接导致 `NeedDebuggerBreak trap` 致命崩溃。
- **DON'T DO (物理文件重复打开并发读)**: 在脱壳后台（如 `tokio::spawn`）并发循环中，**严禁**因为“代码复制”导致对同一个物理临时文件（如缩略图）进行多次并发 `File::open` 与 Stream 转化。这会在多任务堆叠时极速消耗操作系统的 IO 句柄和内存缓冲池，引发底层内存溢出 (OOM)。

**3. 新共识与规范 (New Conventions):**
- **严守唯一监听器原则**: 前端处理高频跨进程消息（IPC events）时，只允许全局存在唯一的 `listen` 监听器，并在组件卸载时强制解绑。
- **节流阀基准线**: 后端 Rust 发送所有的非关键性进度事件（如上传进度、FFmpeg 输出），统一锚定 `500ms` 为最低安全限流间隔，防风暴拦截逻辑只认 `Instant`，不认其他条件。

## 📝 [阶段更新] RAG 切片向量化与 Qdrant 混合检索基建 (Semantic Search)

**1. 架构与状态流转 (Architecture State):**
- **底层基座复用**: 彻底贯彻了“单一真理源”原则。在 `apps/server/src/utils/ai.ts` 中暴露了全局统一的 `getAIProvider`，使得 Embeddings 工具类可以直接复用现有的 OpenRouter (`OPENAI_API_KEY`) 实例，消除了 API Key 分裂的技术债。
- **异步防线机制 (Fire-and-Forget)**: 在 `asr-callback.ts` 的 Webhook 路由中，彻底剥离了耗时的 Embedding 运算与 Qdrant 网络 I/O。向量化流水线以 `Promise.catch` 的形式被“即发即弃”，保证了向阿里云返回 200 OK 的耗时被压缩在毫秒级，彻底杜绝了重试风暴。
- **模型与基建对齐**: 废弃了原定的 `bge-m3` (1024维) 方案，为适配基础设施现存的 Qdrant 引擎规格，全量切换至 `text-embedding-3-small` (1536维，余弦相似度)。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (实例化冗余)**: 严禁在不同的工具类（如 `chat.ts`, `embeddings.ts`）中反复调用 `createOpenAI`。必须统一从 `ai.ts` 导入 Provider，防止后续增加统一拦截器或更换 BaseURL 时发生架构脑裂。
- **DON'T DO (强行阻塞 Webhook)**: 绝对禁止在 `asr-callback.ts` 中 `await processVectorization(...)`。Webhook 的唯一天职是光速响应外部服务并流转核心状态机，附带的重型数据清洗必须丢入后台异步队列。
- **DON'T DO (自动 DDL 与全表扫描黑洞)**: 严禁依赖应用层的 ORM/代码去自动管理 Qdrant 的 Collection Schema。对于 Payload Indexes，必须**手动在运维侧**建立 `assetId` (Keyword，用于精确隔离查询) 和 `text` (Text，用于 BM25 混合检索) 索引。不建索引会导致每一次带有资产过滤的 RAG 搜索都退化为灾难性的全表扫描。

**3. 新共识与规范 (New Conventions):**
- **手动基建边界**: 数据库 (PostgreSQL/MySQL) 的 Schema 变更由 Drizzle 的 Migration 管理；但向量数据库 (Qdrant) 的 Collection 与 Payload 索引建立，必须作为纯粹的 IaC/运维脚本手动执行，代码层只负责 `Upsert` 纯净的数据点。

## 📝 [阶段更新] 数据生命周期治理与 Qdrant 幽灵向量清除 (Data Lifecycle Governance)

**1. 架构与状态流转 (Architecture State):**
- **生命周期闭环**: 补齐了向量数据库的删除链路。在 `DELETE /api/assets/:id` 路由中，当 MySQL 记录物理删除后，同步触发 Qdrant 的 Filter 删除接口，按 `assetId` 抹除关联切片。
- **非阻塞降级 (Fire-and-Forget)**: Qdrant 的删除网络请求被刻意设计为不阻断主线程 (`.catch` 兜底)，确保外部向量引擎的网络抖动绝不影响核心业务资产库的物理销毁。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (误判删除失败与过度优化)**: 严禁在调用 Qdrant 删除 Point 后，因为观测到 Segment (段) 和 Shard (分片) 数量未变而判定为存在 Bug。Qdrant 底层采用类似 LSM-Tree 的不可变段结构，删除仅仅是打上 Tombstone (墓碑) 标记。真正的物理空间回收依赖于后台的异步 Compaction (压缩/合并) 机制。绝对禁止为了立刻释放磁盘而在业务代码中强行调用 Qdrant 的 Optimizer API，这会引发毁灭性的集群 IO 风暴。

**3. 新共识与规范 (New Conventions):**
- **单一数据源原则**: 任何衍生数据（如 ASR 文本、RAG 向量）的生命周期，必须严格依附于顶级实体 Asset。删除 Asset 必须触发全链路联动的“雪崩删除”。

## 📝 [阶段更新] 资产上传状态机收敛与 Qdrant 异步陷阱防线 (State Machine Convergence)

**1. 架构与状态流转 (Architecture State):**
- **领域状态收敛 (Single Source of Truth)**: 彻底修复了前端卡片 UI 状态“偷跑”的逻辑漏洞。前端组件现已退化为纯粹的无状态展示层 (Dumb Component)，仅监听单一的 `asset.status` 字段。
- **端云状态机闭环**: 确立了严格的状态流转纪律：
  1. 落盘瞬间 (`assets.ts`)：状态强制初始化为 `processing`。
  2. ASR 回调 (`asr-callback.ts`)：仅更新内部的 `asrStatus`，主状态按兵不动。
  3. 向量化终点 (`processVectorization`)：只有当 Qdrant 物理落盘彻底完成后，才下达最终指令将主状态流转为 `ready`。任何一环异常均流转为 `error`。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (前端视觉篡改)**: 严禁在前端局部的上传队列（Jobs）完成时，通过硬编码文案（如“✅ 资产已就绪”）去误导全局状态。必须将其降级为“上传完毕，AI 接管”，防止与底层耗时的 ASR/向量化任务产生语义冲突。
- **DON'T DO (Qdrant 异步静默陷阱)**: **绝对禁止**在调用 Qdrant `PUT /points` 接口时省略 `?wait=true` 参数。原生 `fetch` 遇到异步接口返回的 200 OK 会瞬间放行 `await`，导致系统在向量构建完成前就错误地提前流转了就绪状态，形成致命的“假就绪”黑洞。

**3. 新共识与规范 (New Conventions):**
- **强制同步阻塞**: 任何向外部基础设施（如向量数据库）写入并直接影响核心业务状态机流转的网络请求，必须在 URL 或 Payload 中显式开启同步等待模式，绝不能容忍不可观测的后台异步排队。
- **高对比度 UI 防线**: 对于叠加在复杂媒体（如视频缩略图）之上的状态徽章 (Badge)，严禁使用低透明度 (如 `bg-emerald-500/10`) 设计，必须强制采用高对比度的实体背景与阴影 (`shadow-md`)，确保视觉可读性。

## 📝 [阶段更新] RAG 工具化与 Agentic 多步检索链路 (Server-Side Tool Calling)

**1. 架构与状态流转 (Architecture State):**
- **工具挂载**: 成功将 `search_assets` (向量检索) 注册为 Server-Side Tool，直接注入到 `apps/server/src/routes/chat.ts` 的 `streamText` 中。
- **多步循环 (Agentic Loop)**: 启用了 `maxSteps: 5`，允许大模型在调用 Qdrant 获取视频切片后，能够继续留在上下文中阅读切片数据，并最终输出自然语言总结给前端。
- **Token 防御**: 在检索完成后，剥离了高维向量数组，仅将 `score`, `text`, `startTime` 等极简 payload 喂给 LLM，极致节省上下文 Token 消耗。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (默认生命周期截断)**: 严禁在包含 Tool Calling 的 `streamText` 中省略 `maxSteps`。若采用默认值 1，大模型在发出工具调用指令后会立刻终止流，导致用户永远看不到最终的总结文本。
- **DON'T DO (防假死与哑火)**: 在到达 `maxSteps` 最后一步时，必须通过 `prepareStep` 动态注入系统提示词，强制禁用所有工具并要求大模型必须输出纯文本结论，防止 Agent 陷入无休止的工具调用死循环。

**3. 新共识与规范 (New Conventions):**
- **安全召回阈值**: 全局检索默认限制召回数为 20（Top-K=20），严格防止海量视频切片撑爆模型的 Context Window 导致 429 报错或长文本幻觉。
- **端侧处理分离**: Qdrant 仅作为纯粹的高维空间计算引擎，文本向量化必须在 Node 层调用大模型 Embedding API 完成后，再将纯数字向量打入 Qdrant。当前为纯稠密向量（Dense Vector）语义检索，暂未开启 BM25 全文混合检索。

## 📝 [阶段跃迁] DDD 聚合根防线与状态水合断层修复 (Domain Data vs Ephemeral State)

**1. 架构与状态流转 (Architecture State):**
- **核心论断 (DDD)**：**素材检索结果（`retrievedClips`）和剪辑方案（`editingPlan`）是系统的核心业务资产（Domain Data），而聊天消息（Chat Messages）仅仅是瞬态的交互过程（Ephemeral State）。**
- **写链路 (The Write Path)**：彻底废弃了将业务数据塞入 AI SDK 历史记录的脆弱做法。现在，当大模型触发 `searchFootage` 等工具时，后端在工具的 `execute` 内部执行完运算后，直接将纯净数据**物理落盘**到 `projects` 表的专属 JSON 字段中。
- **读链路与水合 (Hydration)**：前端路由 `projects.$projectId.tsx` 的 Loader 在页面刷新时，直接从后端的 `GET /api/projects/:id` 接口获取项目实体，并直接将 `retrievedClips` 注入 `useCanvasStore`。前端彻底抛弃了在历史记录里“倒序捞针”的瞎子提取法。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (状态重载断层 & Agentic 陷阱)**：**绝对禁止**前端尝试从 `messages` 数组中提取工具调用结果来恢复页面状态！在引入 `maxSteps: 5` 的多步推理后，AI 在调用工具后会继续输出总结性文本。这会导致工具调用被深埋在历史记录中间。页面刷新时，前端如果只看最后一条消息，必然变成“瞎子”，导致画布静默白屏。
- **DON'T DO (Hook 军规越界)**：**绝对禁止**将 `useEffect` 等水合逻辑放在组件内任何带有 `return` 的条件拦截（如 `if (isLoading) return ...`）之后！这会引发 React 引擎抛出 `Rendered more hooks than during the previous render` 的死亡报错，当场崩溃。

**3. 新共识与规范 (New Conventions):**
- **UI 纯粹化 (Dumb UI)**：`ChatPanel` 现仅负责在**实时流式生成中**（`status === 'streaming'`）捕获增量结果并乐观更新 UI，**绝不再负责**历史记录的持久化提取与状态重建。

## 📝 [架构红线] OSS 动态签发与生命周期错位防御 (JIT Pre-signing)

**1. 架构与状态流转 (Architecture State):**
- **JIT 动态签发 (Just-In-Time)**：确立了“数据库只存纯粹 Object Key，接口动态分发”的安全底线。后端向前端返回任何包含私有媒体资产（如 `retrievedClips` 中的 `thumbnailUrl`）的 JSON 响应前，必须在路由出口处拦截，并使用 `ossClient.signatureUrl` 临时包裹一层带有 2 小时有效期的 HTTPS 链接。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (生命周期错位 - Time-of-Check to Time-of-Use)**：**绝对禁止**在后端工具执行落盘时，将带有 `?Expires=...&Signature=...` 的预签名 URL 直接塞进数据库的 JSON 字段保存！如果这样做，用户在 2 小时后刷新页面，数据库吐出的将是一堆过期的死链，前端会瞬间面临满屏的 `403 Forbidden` 废墟。

**3. 新共识与规范 (New Conventions):**
- **内外数据结构分叉**：在编写复杂的后端业务逻辑（如 RAG 检索组装）时，必须在内存中实施数据结构的分叉。构建两份 Payload：一份 `viewClips`（带有签名 URL）用于当前 HTTP 请求立刻返回给前端大模型消费；另一份 `dbClips`（仅保留原生的 Raw Object Key）用于异步更新数据库。

## 📝 [架构升级] 消息持久化 CQRS 重构与 CoreMessage 协议对齐 (Zero-Overhead Persistence)

**1. 架构与状态流转 (Architecture State - CQRS):**
- **单一真理源 (Single Source of Truth)**: 彻底推翻了“前端传历史记录 -> 后端解析 -> 前端发 Webhook 落盘”的脆弱链路。现已确立 MySQL 数据库为对话历史的绝对真理源，且内部**仅存储 Vercel AI SDK 原生的 `CoreMessage` 数组**。
- **写链路 (Zero-Overhead Write)**: 在 `apps/server/src/routes/chat.ts` 中，`streamText` 消费 `CoreMessage[]`，吐出 `CoreMessage[]`。在 `onFinish` 钩子中，一行翻译代码都不写，直接 100% 无损追加落盘。彻底消灭了后端复杂的状态机翻译成本。
- **读链路视图投影 (View Projection)**: 在 `apps/server/src/routes/projects.ts` 的 `GET /:id` 接口中注入了翻译器（Adapter）。仅在前端需要拉取项目渲染时，后端才动态将底层的 `CoreMessage` 降维并映射为前端 `useChat` 所需的 `UIMessage` (注入唯一 ID，将工具状态缝合至 `parts` 数组)。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (前端越权落盘)**: 绝对禁止由前端在 `onFinish` 阶段调用 API 保存对话。这会导致严重的数据截断（用户中途刷新页面）、幽灵账单以及与后端数据库的状态脑裂。
- **DON'T DO (Zod 的死亡尖叫 - 强塞 parts)**: Vercel AI SDK 底层的 `convertToModelMessages` 军规极严。前端的 `UIMessage` 会把工具调用放入 `parts`，但后端的 `CoreMessage` 只认识根级别的 `toolInvocations`。**严禁把带有 `type: "tool-invocation"` 的 `parts` 传给底层 SDK**，否则会立刻触发 `ZodError: invalid_union` 导致 Node 进程崩溃白屏。
- **DON'T DO (手动拼接 UIMessage 文本陷阱)**: **绝对禁止**在后端使用 `{ role: 'user', content: lastUserMsg.content }` 去手动拼接前端传来的消息！在 AI SDK v6 的多模态架构下，前端发来的 `lastUserMsg.content` 极可能是 `undefined`，真实的文本被深埋在 `parts: [{ type: 'text', text: '...' }]` 中。必须且只能使用官方的 `await convertToModelMessages([lastUserMsg])` 充当“净水器”进行安全提取。

**3. 新共识与规范 (New Conventions):**
- **前端哑终端化 (Dumb Terminal)**: 前端 `useChat` 现已被剥夺所有历史状态控制权和落盘权。任何需要与大模型交互的网络请求，后端必须无视前端发来的历史记录，强制从数据库 `projects` 表中提取经过强类型清洗的 `CoreMessage` 上下文。

## 📝 [阶段更新] 聊天面板双态主题适配与 UI 规范闭环 (Theme Consistency)

**1. 架构与状态流转 (Architecture State):**
- 统一了 `ChatPanel` 中所有消息气泡与头像的视觉规范，全面适配了 Tailwind v4 的 Light/Dark 双态主题。
- Agent 头像组件从硬编码的灰底圆角统一升级为品牌强关联的紫底方块 (`bg-indigo-600 rounded-lg text-white`)，并精简占位符为 `C`。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (单态黑白陷阱)**: 严禁在气泡容器中使用单纯的 `bg-zinc-900 text-white` 等单态配置，这在 Light 模式下会形成突兀的“黑斑”。必须使用响应式组合（如 `bg-zinc-100 dark:bg-zinc-800`）。
- **DON'T DO (Prose 幽灵特异性踩坑)**: 在修复主题时，再次印证了 `@tailwindcss/typography` 的霸道特性。对于跟随系统主题动态变色的气泡，必须显式传入 `dark:prose-invert`（严禁在浅色背景下直接用 `prose-invert`），否则内部文字会反转成白色，变成灾难性的“隐形墨水”。

**3. 新共识与规范 (New Conventions):**
- **边界清晰原则**: 所有带背景色的消息气泡或卡片容器，必须显式声明 `border` 及双态边框颜色（如 `border border-zinc-200 dark:border-zinc-700/50`），防止在同色系背景下发生视觉粘连。

## 📝 [阶段修复] 视图切换器空位留白与状态枚举对齐 (Enum Sync)

**1. 架构与状态流转 (Architecture State):**
- 修复了 `CanvasPanel.tsx` 顶部视图切换器右侧的多余留白问题。
- 剔除了废弃的 `"split"` 视图模式，使得渲染数组与 `modeLabels` 字典严格对齐（`"outline", "footage", "plan"`）。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (枚举未对齐导致幽灵 UI)**: 严禁在通过 `.map()` 渲染 UI 列表时，使用未在 Label/翻译字典中定义键值的枚举项。这会导致 React 渲染出没有文本内容的“幽灵空按钮”，从而破坏 Flex 布局并在视觉上形成极其隐蔽的多余留白。

**3. 新共识与规范 (New Conventions):**
- **单一真理源对齐**: 当使用强类型（如 `CanvasMode`）驱动 UI 渲染时，实际被用于 `.map()` 的数组必须与提供展示文案的 Record 字典（如 `modeLabels`）保持键值数量的绝对一致。

## 📝 [阶段更新] 全网热点情报抓取与动态注入 (Bugfix & JSON 嵌套陷阱)

**1. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (盲信数据结构与幽灵嵌套)**: 
  - **百度 Wise API 陷阱**: 在解析第三方 API 时，严禁仅凭外层字段名进行主观推断。百度热搜的 JSON 数据中，热词列表被包裹在令人匪夷所思的“双层 content”结构中 (`data.cards[0].content[0].content`)。
  - **静默失败防线**: 之前由于少写了一层 `.[0]?.content`，导致取到的全是 `undefined`，并触发了兜底逻辑，使得大模型收到了满屏的“未知热词”。

**2. 新共识与规范 (New Conventions):**
- **隔离测试原则**: 任何涉及外部复杂 JSON 结构解析的逻辑，在写入业务主体前，必须先在独立的 `.js` 脚本中进行 Mock 数据沙盒测试，确保提取路径 100% 精准无误。

## 📝 [阶段更新] Tauri 生产环境沙盒逃逸与原生极速下载 (Content-Disposition Hack)

**1. 架构与状态流转 (Architecture State):**
- **需求闭环**: 实现了基于剪辑方案 (Editing Plan) 切片的精准溯源与单文件极速下载。
- **后端 JIT 提权 (projects.ts)**: 在下发项目详情时，拦截 `retrievedClips` 数组，通过 `assetId` 关联查询底层 `assets` 表获取真实的 `ossUrl`。随后，利用阿里云 SDK 动态签发一个带有 `response: { 'content-disposition': 'attachment; filename="..."' }` 头的临时 URL，并赋值给 `videoUrl` 吐给前端。
- **前端极简交互 (EditingPlanCard.tsx)**: 在素材缩略图上挂载透明悬浮按钮，移除所有无效的批量下载逻辑。点击按钮时，动态创建 `<a>` 标签并赋予后端的 `videoUrl` 触发下载。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (前端 Fetch OOM 黑洞)**: 在 Tauri 环境下处理动辄几十上百兆的视频下载，**绝对禁止**前端使用 `fetch -> blob` 的方式强行拉取。这会撑爆 V8 引擎内存，导致沙盒直接 OOM 崩溃。
- **DON'T DO (Tauri Shell 权限拦截)**: 严禁在 `<a>` 标签上使用 `target="_blank"`。Tauri 会将其视为调用系统浏览器打开外部网页的危险行为，直接因缺少 `shell:allow-open` 权限而拦截 (`shell.open not allowed`)。
- **DON'T DO (跨域 download 属性失效)**: 严禁试图用前端的 `a.download = "xxx.mp4"` 去重命名跨域 (如 OSS 域名) 的文件。浏览器同源策略会无情忽略该属性，并报 Warning。必须且只能由后端在签发时通过 `Content-Disposition` 响应头来接管文件名。
- **DON'T DO (变量溯源断层)**: 永远不要试图从大模型生成的数据结构 (如 `clip`) 中直接读取物理资源 URL。大模型只负责生成逻辑意图，真正的物理资源地址必须从后端打通的素材池 (`retrievedClips`) 中进行溯源映射 (`sourceClip`) 获取。

**3. 新共识与规范 (New Conventions):**
- **沙盒逃逸第一准则 (Attachment Hack)**: 在 Tauri/Electron 等桌面端 Webview 架构中，实现文件静默下载的最优、最安全路径是：前端只负责触发一个普通链接，**把“强行下载”的指令全部交给服务端的 `Content-Disposition: attachment` 响应头。** Webview 一旦嗅探到该 Header，会瞬间放弃渲染并移交操作系统的原生下载管理器，彻底绕过一切内存与权限墙。

## 📝 [阶段修复] Agentic Loop 状态机竞态与 UI 映射穿透防线

**1. 架构与状态流转 (Architecture State):**
- **视图流转权绝对收敛**: 彻底剥夺了前端游离 `useEffect` 的视图切换控制权。在多步工具调用（大纲 -> 检索 -> 方案）场景中，将画布的最终路由判定绝对收敛于 `onFinish` 钩子，并强制提取 `event.messages` 中**最后一个**执行的工具作为真理源，消除并发抢夺。
- **读链路补齐**: 在后端查询 `editingPlans` 时补齐了 `orderBy(desc(createdAt))`，确保最新状态永远浮现在 UI 顶端。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (useEffect 并发抢夺焦点)**: **绝对禁止**在多个独立的 `useEffect` 中监听同一份流式 `messages` 去触发视图切换。当多个工具在同一次响应中被触发时，会产生严重的**竞态条件 (Race Condition)**，导致正确的目标视图被旧逻辑幽灵覆写。
- **DON'T DO (.some() 历史穿透陷阱)**: 严禁使用 `array.some()` 遍历整个历史消息来决定当前的状态跳转。这会导致早期触发的工具（如大纲）形成逻辑黑洞，永远拦截后续的高优跳转请求。必须精准提纯**当前流（或最后一个动作）**的意图。

**3. 新共识与规范 (New Conventions):**
- **UI 状态枚举完备性**: 任何在 Server-Side 注册的新工具（如 `generateEditingPlan`），在引入前端 SDK 渲染气泡时，**必须**同步补齐相关的中文状态文案映射。严禁使用不完备的三元运算符（如 `isOutline ? A : B`），必须覆盖所有已知工具分支，防范“文案指代不明”的展示事故。

## 📝 [阶段演进] 局部增量更新 (PATCH) 与 React Query 水合架构 (Optimistic UI)

**1. 架构与状态流转 (Architecture State):**
- **后端增量更新 (Hono PATCH)**: 在 `projects.ts` 路由中引入了 `PATCH /:id` 接口。确立了“只处理传递的增量字段，不强制要求全量覆盖”的 RESTful 最佳实践，为未来的元数据扩展留下了纯净的接口底座。
- **前端无感编辑 (React Query Invalidation)**: 实现了受控的 `<EditableProjectTitle />` 组件。在 `onBlur` 时触发修改，请求成功后通过 `queryClient.invalidateQueries` 使当前项目的缓存失效。React Query 会在后台自动重新拉取数据并刷新视图，实现了无需手动管理 Redux/Zustand 全局状态的无缝水合更新。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (幽灵 404 与 HMR 假死)**: 在修改后端路由文件（如 `projects.ts`）时，**绝对禁止**产生重复的 `export default`。这种微小的 TypeScript 语法错误不会在终端引发核爆级警告，但会导致热更新 (HMR) 进程假死。前端发起的新路由请求会持续遭遇 404，让人误以为是 CORS 或路由挂载的问题。必须养成修改后观察服务端编译状态的肌肉记忆。
- **DON'T DO (路由参数转义黑洞)**: 在 Bash 脚本中处理 React Router 动态路由文件（如 `projects.$projectId.tsx`）时，**严禁**直接将包含 `$` 的路径裸写进双引号或直接执行。Bash 会将其解析为环境变量（导致路径变成 `projects..tsx` 而报错找不到文件）。必须使用单引号包裹，或者显式使用 `\$` 转义。

**3. 新共识与规范 (New Conventions):**
- **纯净 PATCH 准则**: 任何后续新增的局部修改接口，必须遵循 PATCH 语义。后端校验逻辑必须具备可选字段容错能力（`if (body.field !== undefined)`），严禁在 PATCH 接口中写死 required 校验。

## 📝 [阶段跃迁] 素材精挑 (Footage Selection) 状态流转与响应式闭环 (LUI + GUI)

**1. 架构与状态流转 (Architecture State):**
- **LUI+GUI 双轨联动**: 正式落地了“精选素材篮子 (selectedBasket)”领域模型。AI 可通过 `manage_footage_basket` 工具在服务端直接操作数据库落盘，用户也可在 GUI 侧边栏实时查看与修改。
- **水合链路收敛 (Hydration CQRS)**: 彻底铲除了 `ChatPanel.tsx` 中基于 `messages` 历史流“倒序捞针”解析 `clips` 的脆弱逻辑。现在 `retrievedClips` 和 `selectedBasket` 的全量水合严格收敛于 React Router 的路由入口阶段 (`projects.$projectId.tsx`)，从 `GET /api/projects/:id` 接口统一拉取，实现了绝对的单一真理源。
- **JIT 动态映射 (JIT Mapping)**: `selectedBasket` 仅在 DB 和 Store 中持久化纯净的 `assetId` 等元数据。带有安全时效性的 `videoUrl` / `thumbnailUrl` 签名链接，严格通过前端 UI 组件在渲染时，实时去 `retrievedClips` 池中进行内存关联映射，彻底阻断了 URL 过期导致的 403 黑洞。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (Zustand 响应式黑洞)**: 严禁在 React 组件的渲染主体逻辑中使用 `useCanvasStore.getState()` 去读取需要动态更新的数据！这会彻底绕过 Zustand 的依赖收集与订阅机制，导致底层数据更新后 UI 变成一潭死水（空载白屏）。必须且只能使用 Hook 形式 `useCanvasStore(state => ...)`。
- **DON'T DO (清理不彻底的幽灵变量)**: 在进行 Store 替换重构（如移除 `useBasketStore`）时，绝对不能只删掉 `import` 和头部解构声明。必须全局搜索相关变量（如 `basketItems`），否则极易在深层嵌套的 UI（如窄屏汉堡菜单的数字角标）中引发 `Can't find variable` 的 V8 致命崩溃。

**3. 新共识与规范 (New Conventions):**
- **高对比度双向 UI 反馈**: 当实现类似“素材入篮”的跨面板联动操作时，源头实体（如左侧检索列表的卡片）必须提供具备高对比度的视觉反馈（如品牌色边框 + “✅ 已精选”绝对定位徽章）。且该反馈必须同时适配 Tailwind v4 的浅色/暗黑双态主题，确保视觉无死角，防范用户重复操作。

## 📝 [阶段更新] 全局布局对称性与组件双态主题修复 (Symmetric Layout & Theme Consistency)

**1. 架构与状态流转 (Architecture State):**
- **对称张力布局**: `CanvasPanel.tsx` 顶部状态栏移除了不对称的弹性盒设定，采用了严格的 `flex-1` 对称张力布局（左侧标题区与右侧操作区均为 `flex-1`，外加特定的对齐方向），成功利用两侧相等的张力将中间的视图切换器挤压至绝对居中。
- **组件纯粹化**: 彻底移除了“素材篮子”与“汉堡菜单”中零散的硬编码 DOM，全量复用了通用的 `<Button variant="secondary" />` 组件，实现了操作语义与视觉的收敛。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (单边 Flex 导致的居中偏移)**: 严禁在 Flex 容器中，仅让一侧子元素拥有 `flex-1`（或不确定的宽度）而期望中心元素能乖乖呆在正中间。Flex 的力学分配会直接使得所谓的“中心”发生物理偏移。
- **DON'T DO (基础组件单态污染)**: 严禁在基础 UI 组件（如 `Button.tsx` 的 `secondary` 变体）中硬编码 `bg-zinc-800 text-zinc-100` 等单态深色类名。这会直接破坏应用的双态主题响应，在 Light 模式下产生刺眼的“黑斑”。

**3. 新共识与规范 (New Conventions):**
- **力学对称居中法则**: 在顶部导航栏等需要三段式布局（左中右）且中心要求绝对居中的场景，必须强制两侧占位容器采用同等宽度的 `flex-1`，并辅以 `justify-start` / `justify-end` 将中心区块挤至死角。
- **强制响应式基类**: 组件变体如果包含背景色，必须强制写全双态映射（如 `bg-zinc-100 dark:bg-zinc-800`），零容忍单态硬编码。

**4. 读链路元数据补齐 (Metadata Hydration)**:
- 在 `GET /api/projects/:id` 的 JIT 签发阶段，必须通过 `assetId` 回表查询并补齐 `filename` 等关键元数据。严禁仅下发加密 URL，否则会导致前端 UI（如素材篮子）无法向用户展示人类可读的原始信息。

**6. GUI 状态修改的乐观落盘原则 (Optimistic Persist)**:
- **DON'T DO (只改瞬态)**: 严禁在修改类似 `selectedBasket` 等核心领域资产时，仅仅调用 `useCanvasStore.getState().set...` 更改前端内存。这必然导致刷新后的水合断层。
- **乐观闭环规范**: 必须采用 `乐观更新 (瞬间渲染 UI) -> 异步 fetch (PATCH 接口) -> 失败回滚 (try-catch 恢复原 Store)` 的标准三步走架构，既保证了本地的极速响应，又捍卫了端云的一致性。
- **热更新假死防线**: 在修改后端路由入口时，若遇到符合预期却请求失效的情况，需警惕热更新进程假死，必须结合日志探针强制触发重载。

## 📝 [阶段修复] macOS Apple Silicon (M系列) 产物损坏警告与 Gatekeeper 防线 (Notarization & Quarantine)

**1. 架构与状态流转 (Architecture State):**
- **CI/CD 签名预留**: 在 `.github/workflows/build.yml` 中正式为 macOS 矩阵注入了 Apple 开发者证书相关的环境变量（`APPLE_CERTIFICATE`、`APPLE_TEAM_ID` 等），为后续自动签名与公证 (Notarization) 铺平道路。
- **降级自救通道**: 在 GitHub Release Body 及 `README.md` 中注入了终端解锁指南，保障在无证书测试期间，内测用户仍可通过原生命令强行绕过拦截。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (物理损坏幻觉)**: 当在 M1~M4 设备上打开 aarch64 产物遇到“App 已损坏，无法打开”警告时，**绝对禁止**立刻怀疑是 Rust 交叉编译工具链或 GitHub Actions 产物发生了物理损坏。这 100% 是由于未经苹果公证的第三方应用，被 macOS Gatekeeper 强行打上了 `com.apple.quarantine` 隔离标签。

**3. 新共识与规范 (New Conventions):**
- **隔离剥离纪律**: 在正式引入企业级 Apple Developer 证书之前，开发团队及内测用户在安装 ClipMind 测试包时，必须养成将 App 拖入应用程序目录后，执行 `sudo xattr -cr /Applications/ClipMind.app` 强行剥离隔离标签的肌肉记忆。

## 📝 [阶段交接] 热点情报引导与端云初始状态对齐 (Onboarding SSOT)

**1. 架构与状态流转 (Architecture State):**
- **单一真理源 (SSOT) 闭环**: 明确了新项目创建时的“初始欢迎语 (Greeting)”由且仅由后端 `apps/server/src/routes/projects.ts` 在初始化数据库记录时决定。
- **功能透出与 Agent 激活**: 在后端的初始欢迎语中显式注入了“全网热点风向标”的引导文案。这不仅解决了用户的“冷启动”困境，更成功引导用户提问，无缝激活了后台定时抓取任务 (`fetch-hot-topics.ts`) 与 LLM System Prompt 之间的联动。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (存量数据幻觉)**: 严禁在修改了后端数据库的默认插入逻辑（如修改欢迎语）后，面对毫无变化的前端历史页面直接怀疑代码未生效。存量项目读取的是数据库里的历史脏数据，测试生命周期初始化逻辑时，**必须新建项目**。
- **DON'T DO (前端越权硬编码)**: 严禁在前端 `ChatPanel.tsx` 或类似组件中硬编码默认的初始消息（Fallback Messages）。这会与后端的初始化逻辑产生严重的“双重真理源”脑裂，导致极其隐蔽的 UI 幽灵状态。

**3. 新共识与规范 (New Conventions):**
- **状态流转绝对后置**: 前端对于所有的初始对话状态、欢迎语，必须完全依赖后端的下发（如 `initialMessages`）。前端组件只负责在数据为空时展示 UI 骨架屏或等待状态，绝对禁止擅自填充业务文案。

## 📝 [阶段更新] 欢迎语全功能链路闭环 (Onboarding Refinement)

**1. 架构与状态流转 (Architecture State):**
- **引导语义终态对齐**: 欢迎语 (`GREETING`) 已定调为包含“灵感发现 -> 生成大纲 -> 素材检索 -> 剪辑方案”的完整 4 步链路。
- **冷启动与 LUI-GUI 协同**: 既保留了解决用户冷启动的“热点抓取”入口，又用具象化的业务功能名词（代替了抽象的“对话生成”、“看板协作”）解释了左侧对话与右侧看板的物理映射关系。

**2. 踩坑与教训 (Lessons Learned & DON'Ts):**
- **DON'T DO (丢失冷启动抓手)**: 严禁在优化文案时，为了追求结构精简而删掉“灵感发现/看热点”等破冰引导。这会直接导致无明确意图的用户在空白界面流失。

