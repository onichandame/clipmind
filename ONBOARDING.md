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
