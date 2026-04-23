import { env } from '../env';
import { useRef, useEffect } from "react";
import { useRevalidator } from "react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useCanvasStore } from "../store/useCanvasStore";
import { EditingPlanCard } from "./EditingPlanCard";
import { EditableProjectTitle } from "./EditableProjectTitle";

interface ChatPanelProps {
  projectId: string;
  initialMessages?: any[];
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, code: [...(defaultSchema.attributes?.code || []), "className"] },
};

export function ChatPanel({ projectId, initialMessages = [] }: ChatPanelProps) {
  const setActiveMode = useCanvasStore((s) => s.setActiveMode);
  const activeMode = useCanvasStore((s) => s.activeMode);

  // [Arch] SSOT 防线：标题直接依赖 React Query 缓存，彻底抛弃不同步的 Zustand 快照
  const { data: projectData } = useQuery({ queryKey: ['project', projectId] });
  const projectTitle = projectData?.project?.title;

  const currentProject = useCanvasStore((s) => s.projects[projectId]);
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);


  // 1. Raw UIMessage passthrough — no transformation needed
  const startingMessages = initialMessages;

  // 2. 规范调用
  const outlineContent = useCanvasStore((s) => s.projects[projectId]?.outlineContent || "");
  const isDirty = useCanvasStore((s) => s.projects[projectId]?.isDirty || false);
  const clearDirtyState = useCanvasStore((s) => s.clearDirtyState);
  const setEditingPlan = useCanvasStore((s) => s.setEditingPlan);
  const revalidator = useRevalidator();

  const { messages, setMessages, sendMessage, status, } = useChat({
    id: projectId,



    messages: startingMessages,
    transport: new DefaultChatTransport({
      api: `${env.VITE_API_BASE_URL}/api/chat`,
      body: { projectId, currentOutline: outlineContent, isDirty }
    }),
    onData: (data) => {
      console.log("📥 [网络层探针] 收到 data! :", data.type, JSON.stringify(data.data));
    },
    onError: (err) => {
      console.error("❌ [网络层探针] SDK 底层流解析抛错:", err);
    },
    onFinish: (event) => {
      console.log("🛑 [网络层探针] 触发 onFinish，流被正常解析并结束！", JSON.stringify(event));
      // [Arch] 强制触发 Router Loader 重新拉取后端数据，实现方案与素材的水合 (Hydration)
      revalidator.revalidate();

      // [Arch] 动态优先级：提取本次流中最后一个被调用的工具，以决定最终的视图归属
      const allTools = event.messages.flatMap(m => m.parts?.filter(p => isToolUIPart(p)).map(p => p.type) || []);
      const lastTool = allTools[allTools.length - 1];

      if (lastTool === 'tool-generateEditingPlan') {
        setActiveMode("plan");
      } else if (lastTool === 'tool-search_assets' || lastTool === 'tool-search_clips') {
        setActiveMode("footage");
      } else if (lastTool === 'tool-updateOutline') {
        setActiveMode("outline");
      }

      if (lastTool) {
        queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      }

      // [Arch] 架构重构：前端落盘已彻底废弃！
      // 持久化职责已全量收敛至 Hono 后端 chat.ts 的 streamText onFinish 钩子中。
      // 此处仅做视图层状态流转，阻断 "幽灵覆写"。
    },
  });

  // [DEBUG INJECTION] 实时监控大模型的流式分发状态 (放在 useChat 后面)
  const setOutlineContent = useCanvasStore((s) => s.setOutlineContent);
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[messages.length - 1];

      // 架构师干预：基于深层探针截获的真实结构，精准提取流式大纲
      const outlinePart = last?.parts?.filter(p => isToolUIPart(p)).find((p) => p.type === 'tool-updateOutline');
      const input = outlinePart?.input as { contentMd: string } | undefined
      if (input?.contentMd) {
        setOutlineContent(projectId, input.contentMd, "agent");
        if (useCanvasStore.getState().activeMode !== "outline") setActiveMode("outline");
      }
    }
  }, [messages, status, setOutlineContent, setActiveMode, projectId]);

  // [Arch] 已移除旧版的 "监听剪辑方案生成结果并推送至独立视图" 的 useEffect
  // 原因：该操作在流式输出中会导致极端的高频状态同步（Render Thrashing），引发死循环。
  // 当前架构已将持久化收敛至后端，前端仅需等待重新拉取即可。
  // (旧版拦截 ToolCall 处理 RAG 数据的反模式代码已彻底移除)

  // 3. 状态强制同步 (SPA 刚需)
  // Vercel AI SDK 会在内存中按 id 缓存对话。在路由切换或热更新中，
  // initialMessages 会被旧的空缓存覆盖。
  // 因此，使用 setMessages 强制同步外部服务端状态，是正确的同步模式。
  useEffect(() => {
    setMessages(startingMessages);
    // 架构师干预：斩草除根。切换项目时强行清空该项目大纲内存，防止幽灵状态。
    useCanvasStore.getState().setOutlineContent(projectId, "", "system");
    useCanvasStore.getState().clearDirtyState(projectId);
  }, [projectId, initialMessages.length]);

  // 4. 自动滚动到底部 (防抖动与白屏崩溃防线)
  useEffect(() => {
    // [架构师干预] 严禁在流式高频渲染（如 AI 逐字输出）时使用 behavior: "smooth"。
    // "smooth" 会触发浏览器的异步插值动画，在极短时间内的连续调用会导致动画帧排队碰撞，
    // 进而引发致命的渲染风暴 (Render-Thrashing) 并导致 markdown 畸形解析或白屏。
    // 必须使用 "auto" 或直接阻断平滑过渡。
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages]);

  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const content = formData.get("content") as string;
    if (content.trim()) {
      sendMessage(
        { text: content },
        { body: { projectId, currentOutline: outlineContent, isDirty } }
      );
      if (isDirty) clearDirtyState(projectId);
      e.currentTarget.reset();
    }
  };

  const isLoading = status === "streaming" || status === "submitted";

              // --- Pills 状态机 (SSOT) ---
              const hasOutline = !!outlineContent;
              // [Arch] 废弃脆弱的 Zustand 快照，强制使用 React Query 缓存作为读链路真理源
              // [Arch] 素材阶段完成的绝对真理：用户或 AI 是否已执行了"精挑" (selectedAssetIds)
              const hasFootage = (projectData?.project?.selectedAssetIds?.length || 0) > 0;
              const hasPlan = (projectData?.project?.editingPlans?.length || 0) > 0;

              // [Arch] 根据 workflowMode 动态排列步骤顺序，与 CanvasPanel.tsx 保持一致
              const workflowMode = projectData?.project?.workflowMode;
              const stepOrder = workflowMode === 'material'
                ? ['footage', 'outline', 'plan']   // 素材驱动：素材→策划→剪辑
                : ['outline', 'footage', 'plan'];  // 策划驱动：策划→素材→剪辑

              // 按依赖链判断活动项：按 stepOrder 顺序，第一个未完成的步骤为 active
              let dynamicActiveId: string | null = null;
              for (const step of stepOrder) {
                if (step === 'outline' && !hasOutline) { dynamicActiveId = 'outline'; break; }
                if (step === 'footage' && !hasFootage) { dynamicActiveId = 'footage'; break; }
                if (step === 'plan'    && !hasPlan)    { dynamicActiveId = 'plan';    break; }
              }

              const STEP_NUMS = ['①', '②', '③'];
              const stepTextLabels: Record<string, Record<string, string>> = {
                material: { outline: '策划大纲', footage: '挑选素材', plan: '剪辑方案' },
                idea:     { outline: '策划大纲', footage: '挑选素材', plan: '剪辑方案' },
              };
              const modeKey = workflowMode === 'material' ? 'material' : 'idea';
              const pillsData = stepOrder.map((id, index) => ({
                id,
                num: STEP_NUMS[index],
                text: stepTextLabels[modeKey][id],
                isActive: dynamicActiveId === id,
                isDone: id === 'outline' ? hasOutline : id === 'footage' ? hasFootage : hasPlan,
              }));

          return (
            <div className="flex flex-col h-full bg-transparent">
              {/* Header (已隐藏左侧分割线) */}
              <div className="flex flex-col px-5 pt-4 pb-3 backdrop-blur-sm z-10 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div className="flex flex-col">
                <a href="/" className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 hover:text-indigo-500 transition-colors font-bold mb-0.5">← 工作台</a>
                <div className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100 transition-colors tracking-tight">
                  <EditableProjectTitle projectId={projectId} initialTitle={projectTitle || "未命名项目"} />
                </div>
              </div>
            </div>

              {/* Step Pills */}
              <div className="flex gap-1.5 mt-2">
                {pillsData.map(step => (
                  <div
                    key={step.id}
                    className={`px-2.5 py-1 flex items-center gap-1 rounded-full text-[10px] font-bold transition-all ${step.isActive
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                      : step.isDone
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-transparent"
                    }`}
                  >
                    <span>{step.isDone && !step.isActive ? '✓' : step.num}</span>
                    <span>{step.text}</span>
                  </div>
                ))}
              </div>
          </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        {messages.filter(Boolean).map((message) => {
          const isUser = message?.role === "user";
          return (
            <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              {!isUser && (
                <div className="w-7 h-7 mt-1 rounded-lg bg-indigo-600 flex items-center justify-center mr-3 flex-shrink-0 shadow-sm transition-colors">
                  <span className="text-[12px] text-white font-semibold transition-colors">C</span>
                </div>
              )}
              <div className={`max-w-[85%] px-4 py-2.5 text-[13px] leading-relaxed transition-all ${isUser
                  ? "bg-indigo-600 text-white rounded-2xl rounded-tr-sm shadow-md shadow-indigo-500/10 font-medium"
                  : "bg-zinc-100/50 dark:bg-zinc-800/40 text-zinc-800 dark:text-zinc-200 rounded-2xl rounded-tl-sm border border-zinc-200/60 dark:border-zinc-700/40 shadow-sm"
                }`}>
                {/* 1. 纯文本渲染 & 工具状态回显 (拦截空炮消息) */}
                {(() => {
                  const msg = message;
                  let textToRender = msg?.parts?.filter(p => p.type === 'text').map(p => p.text).join('') || ``

                  if (!textToRender || textToRender.includes('{"toolCalls":') || textToRender.includes('"toolCallId":')) return null;

                  return (
                    <div className={`prose prose-sm ${isUser ? 'prose-invert' : 'dark:prose-invert'} max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-200 dark:prose-pre:border-zinc-800 transition-colors`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}>{textToRender}</ReactMarkdown>
                    </div>
                  );
                })()}

                {/* 2. Tool Invocations 状态渲染 (v6 Parts 适配) */}
                {message?.parts?.filter((p: any) => p.type === 'tool-invocation' || p.toolCallId || (p.type && p.type.startsWith('tool-'))).map((toolPart: any, index: number) => {
                  const invocation = toolPart.type === 'tool-invocation' ? toolPart.toolInvocation : toolPart;
                  const state = invocation.state || toolPart.state;
                  const toolName = invocation.toolName || toolPart.toolName || toolPart.type;

                  // [架构师规范] 精准拦截目标工具，并确保在 prose 外层渲染，防止 Markdown 样式污染
                  if (toolName?.includes('generateEditingPlan')) {
                    if (state === 'result') {
                      // 检查后端是否明确返回了错误
                      if (invocation.result && invocation.result.success === false) {
                        return (
                          <div key={index} className="mt-4 mb-2 p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg">
                            ⚠️ 方案解析失败: {invocation.result.error || '未知错误'}
                          </div>
                        );
                      }
                      return (
                        <div key={index} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20 my-2 mt-3">
                          <div className="text-lg leading-none">✨</div>
                          <span className="text-sm font-medium">剪辑方案已生成并保存！🎬</span>
                        </div>
                      );
                    } else if (state === 'call' || state === 'partial-call') {
                      // 流式传输过程中的优雅占位
                      return (
                        <div key={index} className="flex items-center gap-2 text-indigo-400 bg-indigo-500/10 px-3 py-2 rounded-lg border border-indigo-500/20 my-2 mt-3 animate-pulse">
                          <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                          <span className="text-sm font-medium">正在生成智能剪辑方案...</span>
                        </div>
                      );
                    }
                  }

                  // 兼容旧版以及其它工具 (大纲更新、素材检索等)
                  const isCalling = state === 'streaming' || state === 'input-streaming' || state === 'input-available' || state === 'partial-call';
                  const isOutline = toolName?.includes('updateOutline');
                  const isPlan = toolName?.includes('generateEditingPlan');

                  return (
                    <div key={index} className="flex items-center gap-2 text-indigo-400 bg-indigo-500/10 px-3 py-2 rounded-lg border border-indigo-500/20 my-2 mt-3">
                      {isCalling ? (
                        <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                      ) : (
                        <div className="text-lg leading-none">✨</div>
                      )}
                      <span className="text-sm font-medium">
                        {isCalling
                          ? (isOutline ? "正在构思大纲..." : isPlan ? "正在生成剪辑方案..." : "正在检索素材...")
                          : (isOutline ? "大纲已同步" : isPlan ? "剪辑方案生成完毕" : "素材检索完成")}
                      </span>
                    </div>
                  );
                })}
              </div>
              {isUser && (
                <div className="w-7 h-7 mt-1 rounded-full bg-zinc-800 dark:bg-zinc-200 flex items-center justify-center ml-3 flex-shrink-0 shadow-sm transition-colors">
                  <span className="text-[11px] text-white dark:text-zinc-800 font-semibold transition-colors">我</span>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-5 py-4 pb-6 bg-transparent">
        <form onSubmit={handleSubmit} className="relative flex items-end">
          <div className="relative w-full flex items-center bg-white dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700/60 hover:border-zinc-400 dark:hover:border-zinc-600 focus-within:border-indigo-500/50 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800 transition-all rounded-2xl shadow-sm overflow-hidden">
            <input type="text" name="content" disabled={isLoading || !projectData?.project?.workflowMode} autoComplete="off" placeholder={
                projectData?.project?.workflowMode === 'material'
                  ? "素材选好后，告诉我你的视频目标…"
                  : projectData?.project?.workflowMode === 'idea'
                    ? "告诉我你想做什么视频，或从热点出发…"
                    : "请先在右侧选择创作起点"
              } className="flex-1 w-full bg-transparent text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm px-4 py-3.5 focus:outline-none disabled:opacity-50 transition-colors" />
            <div className="pr-2 flex-shrink-0">
              <button type="submit" disabled={isLoading || !projectData?.project?.workflowMode} className="p-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:bg-zinc-200 dark:disabled:bg-zinc-700 disabled:text-zinc-400 dark:disabled:text-zinc-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
