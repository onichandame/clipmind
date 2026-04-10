# AI 架构师盲操接手指南 (v2.0 协同进化版)

## 🎯 背景与目标

你好，接班人。你面对的是一个基于 **React Router v7 + Tailwind v4 + AI SDK v3** 的现代化视频创作工作台。
**核心约束**：你没有终端权限，用户是你的“眼”和“手”。你必须通过精确的 Bash 和 Patch 指令驱动开发。

---

## 🛠️ 第一阶段：现状探测 (The Probes)

接手新模块时，**永远不要盲目相信文档中的“已完成”状态**。

1. **查环境与入口**：

   ```bash
   cat package.json | grep -E '"(react-router|ai|novel|@tiptap/react)"'
   # 核心 ADR：CSS 入口是 app/app.css，不是 tailwind.css
   cat app/app.css | head -n 10
   ```

2. **查状态机定义**：

   ```bash
   cat app/store/useCanvasStore.ts
   ```

---

## 📝 第二阶段：手术刀修改规范 (Surgical Edit)

1. **禁止全量重写**：超过 30 行的文件必须使用 `.architect/apply_patch.sh`。
2. **SEARCH/REPLACE 协议**：SEARCH 块必须在原文件中唯一，缩进必须与 `cat -n` 结果字节级对齐。
3. **Any 逃生舱**：在处理 AI SDK 等泛型极深的库时，若遇到 TS 类型塌方（Generic Collapse），应果断使用 `(useChat as any)` 强转，优先保证业务交付，而非在类型泥潭中消耗 Token。

---

## 🐛 第三阶段：核心避坑与经验教训 (Lessons Learned)

### 1. 人机协同：脏状态与补丁协议 (Critical)

- **防冲撞机制**：用户手动编辑编辑器时，`useCanvasStore` 会将 `isDirty` 设为 `true`。Agent 在修改大纲前 **必须** 调用 `read_outline` 重新感知最新上下文。
- **Block Index Mapping**：禁止让 Agent 猜 Tiptap 的绝对坐标。系统应将文档序列化为带 `[Block n]` 前缀的 Markdown，Agent 通过 `patch_outline(index: n)` 进行定向爆破式修改，以保护用户光标。

### 2. Novel/Tiptap 无头架构与 SSR 适配

- **无头约束**：Novel v0.2+ 不再内置 Schema。必须配套 `@tiptap/starter-kit` 和 `tiptap-markdown`。
- **水合防护**：在全栈 SSR 框架（如 RRv7）中，`useEditor` 必须声明 `immediatelyRender: false`，否则必报 React 水合错误。
- **Vite 依赖链**：若 Novel 插件（如 Tweet）抛出样式加载错误，须在 `vite.config.ts` 的 `ssr.noExternal` 中同时包含父组件及其所有涉及样式的子依赖。

---

## 🏛️ 架构决策记录 (ADR)

### 1. UI & Layout

- **App Shell**: 全局极窄侧边栏 (`w-16`)，深色基调 (`bg-zinc-950`)。
- **图标库**: 全局统一使用 `lucide-react`。

### 2. 交互引擎 (AI SDK)

- **状态同步**: 必须通过 `useEffect` 监听 `projectId` 并调用 `setMessages` 强制灌入服务端数据，以破解 SPA 缓存锁。
- **流解析**: 拦截模型漏水的 JSON（如 `{"toolCalls":`），防止原始代码暴露在聊天气泡中。

### 3. 编辑器 (Canvas)

- **选型**: 放弃 BlockNote（React 19 严格模式不兼容），采用 **Novel (Tiptap Headless)**。
- **样式**: 深度绑定 Tailwind v4 的 `@plugin "@tailwindcss/typography"`，通过 `prose-invert` 适配深色模式。

---

## 📦 第四阶段：版本控制规范

1. **显式暂存**: 坚决杜绝 `git add .`。必须指定文件。
2. **语义化 Commit**: 遵循 Conventional Commits，Body 部分必须解释 **Why** (架构动机) 而非仅重复 **What** (代码改动)。
