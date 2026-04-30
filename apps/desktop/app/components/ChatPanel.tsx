import { env } from '../env';
import { authFetch, authHeaders } from '../lib/auth';
import { useRef, useEffect, useState, useMemo, useCallback, memo } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Menu, Pin, PinOff, Trash2 } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { EditingPlanCard } from "./EditingPlanCard";
import { EditableProjectTitle } from "./EditableProjectTitle";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { WIDGET_TOOL_NAMES, SILENT_TOOL_NAMES, widgetRegistry } from "./widgets/registry";
import { MemoryUpdateToast } from "./MemoryUpdateToast";

interface ChatPanelProps {
  projectId: string;
  initialMessages?: any[];
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, code: [...(defaultSchema.attributes?.code || []), "className"] },
};

interface MessageBubbleProps {
  message: any;
  isLast: boolean;
  showInlineThinking: boolean;
  projectId: string;
  onWidgetSubmit: (msg: string) => void;
  // Text of the user message immediately following this one, if any. Widgets
  // that lock into "answered" state (e.g. AskUserQuestionWidget) read this.
  nextUserText?: string;
}

const MessageBubble = memo(function MessageBubble({
  message,
  isLast,
  showInlineThinking,
  projectId,
  onWidgetSubmit,
  nextUserText,
}: MessageBubbleProps) {
  const isUser = message?.role === "user";
  const msgText = !isUser ? (message?.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || '') : '';
  const hasCleanText = !!msgText && !msgText.includes('{"toolCalls":') && !msgText.includes('"toolCallId":');
  // Tool pills stay visible after the React loop ends as part of the latest
  // message's record — bridges the gap between loop completion and any
  // downstream UI (e.g. right panel sliding in) settling.
  const hasVisibleTools = !isUser && isLast && !!message?.parts?.some((p: any) => isToolUIPart(p) && !SILENT_TOOL_NAMES.has(p.type));
  // HITL widgets render unconditionally (not gated by isLoading), so a message
  // carrying only a widget part (no text, no streaming pill) is still visible.
  const hasWidget = !isUser && !!message?.parts?.some((p: any) => isToolUIPart(p) && WIDGET_TOOL_NAMES.has(p.type));
  if (!isUser && !hasCleanText && !hasVisibleTools && !hasWidget && !showInlineThinking) return null;

  if (isUser) {
    const userText = message?.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || '';
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100 text-[14px] leading-relaxed whitespace-pre-wrap break-words">
          {userText}
        </div>
      </div>
    );
  }

  const textToRender = msgText;
  const showText = !!textToRender && !textToRender.includes('{"toolCalls":') && !textToRender.includes('"toolCallId":');

  return (
    <div className="flex items-start gap-3">
      <div
        className="w-7 h-7 mt-0.5 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-[0_0_12px_rgba(109,93,251,0.3)] flex-shrink-0"
        style={{ backgroundColor: '#6D5DFB' }}
      >
        C
      </div>
      <div className="flex-1 min-w-0 text-[14px] leading-7 text-zinc-800 dark:text-zinc-200">
        {showText && (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-7 prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-200 dark:prose-pre:border-zinc-800 transition-colors">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}>{textToRender}</ReactMarkdown>
          </div>
        )}

        {/* HITL Widgets — persistent in-chat UI cards (asset picker, future confirm buttons, etc.).
            Always render (independent of streaming state) once the tool part is in the message. */}
        {message?.parts?.filter((p: any) => isToolUIPart(p) && WIDGET_TOOL_NAMES.has(p.type)).map((widgetPart: any, idx: number) => {
          const Widget = widgetRegistry[widgetPart.type];
          if (!Widget) return null;
          return <Widget key={`widget-${idx}`} part={widgetPart} projectId={projectId} answer={nextUserText} onSubmit={onWidgetSubmit} />;
        })}

        {/* Tool Invocations 状态渲染 — 保留至最近一条 AI 消息上，loop 结束后仍作为历史展示。Widget / 静默工具不在此处渲染。 */}
        {isLast && message?.parts?.filter((p: any) => isToolUIPart(p) && !WIDGET_TOOL_NAMES.has(p.type) && !SILENT_TOOL_NAMES.has(p.type)).map((toolPart: any, index: number) => {
          const state = toolPart.state;
          const toolName = toolPart.toolName || toolPart.type;

          if (toolName?.includes('generateEditingPlan')) {
            if (state === 'output-available') {
              if (toolPart.output && toolPart.output.success === false) {
                return (
                  <div key={index} className="mt-3 mb-1 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg">
                    ⚠️ 方案解析失败: {toolPart.output.error || '未知错误'}
                  </div>
                );
              }
              return (
                <div key={index} className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20 mt-3 text-xs font-medium">
                  <span>✨</span>
                  <span>剪辑方案已生成并保存</span>
                </div>
              );
            } else if (state === 'input-available' || state === 'input-streaming') {
              return (
                <div key={index} className="inline-flex items-center gap-2 text-indigo-500 dark:text-indigo-400 bg-indigo-500/5 px-3 py-1.5 rounded-full border border-indigo-500/20 mt-3 text-xs font-medium animate-pulse">
                  <div className="animate-spin h-3 w-3 border-2 border-indigo-500 border-t-transparent rounded-full" />
                  <span>正在生成智能剪辑方案…</span>
                </div>
              );
            }
          }

          const isCalling = state === 'input-streaming' || state === 'input-available';
          const isOutline = toolName?.includes('updateOutline');
          const isPlan = toolName?.includes('generateEditingPlan');
          const isWebSearch = toolName?.includes('search_web');
          const isFetchPage = toolName?.includes('fetch_webpage');

          const callingLabel = isOutline ? "正在构思大纲…"
            : isPlan ? "正在生成剪辑方案…"
            : isWebSearch ? "正在网络搜索…"
            : isFetchPage ? "正在读取网页…"
            : "正在检索素材…";

          const doneLabel = isOutline ? "大纲已同步"
            : isPlan ? "剪辑方案生成完毕"
            : isWebSearch ? "网络搜索完成"
            : isFetchPage ? "网页读取完成"
            : "素材检索完成";

          return (
            <div key={index} className="inline-flex items-center gap-2 text-indigo-500 dark:text-indigo-400 bg-indigo-500/5 px-3 py-1.5 rounded-full border border-indigo-500/20 mt-3 mr-2 text-xs font-medium">
              {isCalling ? (
                <div className="animate-spin h-3 w-3 border-2 border-indigo-500 border-t-transparent rounded-full" />
              ) : (
                <span>✓</span>
              )}
              <span>{isCalling ? callingLabel : doneLabel}</span>
            </div>
          );
        })}
        {showInlineThinking && (
          <div className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500 mt-1">
            <div className="animate-spin h-3.5 w-3.5 border-2 border-zinc-400 border-t-transparent rounded-full" />
            <span className="text-sm">思考中…</span>
          </div>
        )}
      </div>
    </div>
  );
});

export function ChatPanel({ projectId, initialMessages = [] }: ChatPanelProps) {
  const setActiveMode = useCanvasStore((s) => s.setActiveMode);
  const activeMode = useCanvasStore((s) => s.activeMode);

  // [Arch] SSOT 防线：标题直接依赖 React Query 缓存，彻底抛弃不同步的 Zustand 快照
  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to load project details');
      return res.json();
    },
    enabled: !!projectId,
  });
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
  const autoTriggeredRef = useRef<Record<string, boolean>>({});

  // Refs that always hold the latest value of body deps so the transport's
  // body factory and the stable widget callback can read them without taking
  // them as deps (and thus without invalidating memoization on every change).
  const projectIdRef = useRef(projectId);
  const outlineContentRef = useRef(outlineContent);
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  useEffect(() => { outlineContentRef.current = outlineContent; }, [outlineContent]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: `${env.VITE_API_BASE_URL}/api/chat`,
      headers: () => authHeaders(),
      body: () => ({
        projectId: projectIdRef.current,
        currentOutline: outlineContentRef.current,
        isDirty: isDirtyRef.current,
      }),
    }),
    [],
  );

  const { messages, sendMessage, regenerate, status, } = useChat({
    id: projectId,



    messages: startingMessages,
    transport,
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
  // Track the last contentMd we pushed to the canvas store so we don't fire
  // redundant setOutlineContent on every streaming token. Without this, each
  // token re-pushed the same state into Zustand → triggered a ChatPanel
  // re-render → re-ran this effect → loop. Breaking the loop is what kills
  // the streaming-time feedback storm.
  const lastPushedOutlineRef = useRef<string>('');
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[messages.length - 1];

      // 架构师干预：基于深层探针截获的真实结构，精准提取流式大纲
      const outlinePart = last?.parts?.filter(p => isToolUIPart(p)).find((p) => p.type === 'tool-updateOutline');
      if (outlinePart && (outlinePart.state === 'input-streaming' || outlinePart.state === 'input-available')) {
        const input = outlinePart.input as { contentMd: string } | undefined;
        if (input?.contentMd && input.contentMd !== lastPushedOutlineRef.current) {
          lastPushedOutlineRef.current = input.contentMd;
          setOutlineContent(projectId, input.contentMd, "agent");
          if (useCanvasStore.getState().activeMode !== "outline") setActiveMode("outline");
        }
      }
    }
  }, [messages, status, setOutlineContent, setActiveMode, projectId]);

  // [Arch] 已移除旧版的 "监听剪辑方案生成结果并推送至独立视图" 的 useEffect
  // 原因：该操作在流式输出中会导致极端的高频状态同步（Render Thrashing），引发死循环。
  // 当前架构已将持久化收敛至后端，前端仅需等待重新拉取即可。
  // (旧版拦截 ToolCall 处理 RAG 数据的反模式代码已彻底移除)

  // [Long-term memory] 监听 tool-update_user_memory 静默工具的 output-available 事件，
  // 弹出无交互 toast。toolCallId 去重防止重渲染重复触发；历史消息（刷新加载）也会进
  // 这个扫描，但 seenToolCallIds 在挂载时填充全部历史的 ID（取消首屏静默通过设
  // didInitMemoryToastRef 表示），因此只有"首次出现"的写入才弹 toast。
  const [memoryToastNonce, setMemoryToastNonce] = useState(0);
  const seenMemoryCallsRef = useRef<Set<string>>(new Set());
  const didInitMemoryToastRef = useRef(false);
  useEffect(() => {
    const fresh: string[] = [];
    for (const m of messages) {
      if (m.role !== 'assistant' || !Array.isArray(m.parts)) continue;
      for (const p of m.parts) {
        if (
          (p as any)?.type === 'tool-update_user_memory' &&
          (p as any)?.state === 'output-available'
        ) {
          const id = (p as any).toolCallId || `${m.id}-mem`;
          if (!seenMemoryCallsRef.current.has(id)) {
            seenMemoryCallsRef.current.add(id);
            fresh.push(id);
          }
        }
      }
    }
    if (!didInitMemoryToastRef.current) {
      didInitMemoryToastRef.current = true;
      return; // first pass: just record existing IDs without firing toast
    }
    if (fresh.length > 0) {
      setMemoryToastNonce((n) => n + 1);
    }
  }, [messages]);

  // 切项目时由 WorkspaceLayout 的 key={project.id} 触发重挂载，useChat 会以新 startingMessages 重置。
  // 此处只负责挂载初始化：清空该项目残留的 canvas 状态。
  useEffect(() => {
    useCanvasStore.getState().setOutlineContent(projectId, "", "system");
    useCanvasStore.getState().clearDirtyState(projectId);
  }, [projectId]);

  // 热点创作自动触发：仅当会话恰好只有一条 user 消息时（热点播种场景），
  // 立即触发 AI 回复，无需用户手动发送。
  useEffect(() => {
    if (
      !autoTriggeredRef.current[projectId] &&
      messages.length === 1 &&
      messages[0]?.role === 'user' &&
      status === 'ready'
    ) {
      autoTriggeredRef.current[projectId] = true;
      regenerate({ body: { projectId, currentOutline: outlineContent, isDirty } });
    }
  }, [messages.length, status, projectId]);

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

  // Stable callback for HITL widgets to send a user message back into the chat.
  // Reads body deps from refs so the identity is stable across renders — that
  // keeps memoized message bubbles (and any widget memoization) from busting.
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  const handleWidgetSubmit = useCallback((msg: string) => {
    sendMessageRef.current(
      { text: msg },
      {
        body: {
          projectId: projectIdRef.current,
          currentOutline: outlineContentRef.current,
          isDirty: isDirtyRef.current,
        },
      },
    );
  }, []);

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

  // Filter once and reuse — both for the map below and for derived flags
  // (lastMessage etc.) so indices in the rendered list always agree.
  const visibleMessages = useMemo(() => messages.filter(Boolean), [messages]);

  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const lastIsUser = lastMessage?.role === "user";
  const lastAssistantParts = (lastMessage?.role === "assistant" ? lastMessage.parts ?? [] : []) as any[];
  // An active tool call (still receiving input) shows its own spinner — no extra bubble needed.
  const hasActiveToolCall = lastAssistantParts.some(
    (p: any) => isToolUIPart(p) && !SILENT_TOOL_NAMES.has(p.type) && (p.state === 'input-streaming' || p.state === 'input-available')
  );
  // Streaming text is self-evidencing — no extra bubble needed.
  const hasAssistantText = lastAssistantParts.some((p: any) => p.type === 'text' && p.text?.length > 0);
  // Standalone "thinking" bubble — only when there is no assistant message yet in the current turn.
  const showThinking = isLoading && lastIsUser;

              const workflowMode = projectData?.project?.workflowMode;
              const isPinned = !!projectData?.project?.pinnedAt;

          return (
            <div className="flex flex-col h-full bg-transparent">
              <MemoryUpdateToast nonce={memoryToastNonce} />
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 backdrop-blur-sm z-10 transition-colors">
                <div className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100 transition-colors tracking-tight min-w-0 flex-1">
                  <EditableProjectTitle projectId={projectId} initialTitle={projectTitle || "未命名项目"} />
                </div>
                <ProjectMenu projectId={projectId} pinned={isPinned} />
              </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
        {visibleMessages.map((message, idx) => {
          const isLast = idx === visibleMessages.length - 1;
          // Precompute the next user message text so MessageBubble doesn't have
          // to walk the messages array internally — keeps the bubble's prop
          // shape stable across renders for memoization.
          const next = visibleMessages[idx + 1];
          const nextUserText = next?.role === 'user'
            ? (next.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || undefined)
            : undefined;
          // showInlineThinking only matters for the last assistant message
          // during streaming. For older messages it's always false, so passing
          // a constant `false` keeps their props stable as isLoading flips.
          const showInlineThinking =
            isLast && isLoading && !lastIsUser && !hasActiveToolCall && !hasAssistantText && message?.role !== 'user';
          return (
            <MessageBubble
              key={message.id}
              message={message}
              isLast={isLast}
              showInlineThinking={showInlineThinking}
              projectId={projectId}
              onWidgetSubmit={handleWidgetSubmit}
              nextUserText={nextUserText}
            />
          );
        })}
        {showThinking && (
          <div className="flex items-start gap-3">
            <div
              className="w-7 h-7 mt-0.5 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-[0_0_12px_rgba(109,93,251,0.3)] flex-shrink-0"
              style={{ backgroundColor: '#6D5DFB' }}
            >
              C
            </div>
            <div className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500 mt-1">
              <div className="animate-spin h-3.5 w-3.5 border-2 border-zinc-400 border-t-transparent rounded-full" />
              <span className="text-sm">思考中…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-5 py-4 pb-6 bg-transparent">
        <form onSubmit={handleSubmit} className="relative flex items-end">
          <div className="relative w-full flex items-center bg-white dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700/60 hover:border-zinc-400 dark:hover:border-zinc-600 focus-within:border-indigo-500/50 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800 transition-all rounded-2xl shadow-sm overflow-hidden">
            <input type="text" name="content" disabled={isLoading} autoComplete="off" placeholder={
                workflowMode === 'material'
                  ? "素材选好后，告诉我你的视频目标…"
                  : workflowMode === 'idea'
                    ? "告诉我你想做什么视频，或从热点出发…"
                    : workflowMode === 'freechat'
                      ? "随便聊聊，AI 会用工具帮你搜素材或网页…"
                      : "向 AI 描述你的需求…"
              } className="flex-1 w-full bg-transparent text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm px-4 py-3.5 focus:outline-none disabled:opacity-50 transition-colors" />
            <div className="pr-2 flex-shrink-0">
              <button type="submit" disabled={isLoading} className="p-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:bg-zinc-200 dark:disabled:bg-zinc-700 disabled:text-zinc-400 dark:disabled:text-zinc-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectMenu({ projectId, pinned }: { projectId: string; pinned: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pinMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) throw new Error('Failed to update pin');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/', { replace: true });
    },
  });

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        title="更多"
      >
        <Menu className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-20 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              pinMutation.mutate(!pinned);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm cursor-pointer text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            <span>{pinned ? '取消置顶' : '置顶'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm cursor-pointer text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除</span>
          </button>
        </div>
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            deleteMutation.mutate();
          }}
        />
      )}
    </div>
  );
}
