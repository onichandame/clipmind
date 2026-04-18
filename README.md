# 🚀 ClipMind

ClipMind 是一款极致流畅的 AI 驱动视频创作桌面应用。本项目采用 **端云解耦 + 容器化** 的现代架构，致力于提供高性能的音视频预处理与云端 AI 协同工作流。

## 🏗️ 核心架构基座

- **桌面容器**: Tauri v2 (Rust) - 提供跨平台原生权限与极速文件 I/O，内置 FFmpeg Sidecar 进行自适应硬件加速处理。
- **前端视图**: React Router v7 + Vite - 纯粹的 SPA UI 渲染层，采用 Tailwind CSS v4 纯粹架构，支持双轨主题。
- **云端大脑**: Hono (Node Server) - 处理高并发网络请求、持久化存储交互 (Drizzle ORM + MySQL) 与 AI 对接 (Vercel AI SDK v6.0+)。
- **数据流**: @tanstack/react-query (前端缓存) + React Router Loader 驱动。

## 🌊 核心链路与技术特性

- **零拷贝大文件直传**: Rust 端采用 `tokio_util::codec::FramedRead` 将大文件转为流直推 OSS，实现 0 损耗与 0 磁盘冗余，彻底消灭 OOM 隐患。
- **极速音视频分离**: 底层 Rust 结合 FFmpeg 降维提取轻量级音轨 (16kHz/单声道 AAC)，配合阿里云 ASR 完成高并发、高精度的语音识别。
- **IPC 并发防火墙**: 实施严格的 `Semaphore(1)` 并发锁与 500ms 节流阀，防范跨进程通信风暴撑爆前端 V8 引擎。
- **Fail-Fast 强类型边界**: 端云双域引入 Zod 对 `.env` 实施强类型反序列化，任何配置异常直接阻断启动，拒绝“带病运行”。

## 🛑 核心开发者军规

1. **EDD (证据驱动调试)**：严禁凭借经验盲猜，必须基于确凿的探针日志和堆栈证据下刀修改。
2. **底层归底层**：严禁在前端沙盒强行解析本地大文件元数据（如耗时探测、CORS 读取），一切涉及操作系统的重活全量交由 Rust 侧边车异步处理并透传。
3. **状态机与乐观 UI**：废弃独立消息表采用 JSON 聚合；前端废弃粗暴刷新，全面采用 React Router `useRevalidator` 完成平滑的乐观 UI 渲染。

---

## 🍎 macOS 安装指南与常见问题 (Gatekeeper Bypass)

在 Apple Silicon (M1/M2/M3/M4) 芯片的 Mac 上下载并安装本应用时，如果系统提示 **“ClipMind.app 已损坏，无法打开。你应该将它移到废纸篓。”**，这是因为应用暂未经过 Apple 官方开发者证书公证，触发了 macOS 的安全隔离机制 (`com.apple.quarantine`)。

**解决方法：**
1. 将 `ClipMind.app` 拖入 **应用程序 (Applications)** 文件夹。
2. 打开系统自带的 **终端 (Terminal)**。
3. 输入并执行以下命令以移除隔离标签（可能需要输入开机密码）：
   ```bash
   sudo xattr -cr /Applications/ClipMind.app
   ```
4. 重新在启动台或应用程序中打开 ClipMind 即可。

---
*关于更详细的踩坑教训、架构演进历史、环境变量规范及血泪红线，请全体研发务必详细阅读项目根目录的 `ONBOARDING.md`。*
