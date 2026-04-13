import { useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useQueryClient } from "@tanstack/react-query";
import { useCanvasStore } from "../store/useCanvasStore";


if (typeof window !== 'undefined' && !(window).__EDD_PATCHED) {
  (window).__EDD_PATCHED = true;
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    return origFetch.apply(this, args);
  };
}

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
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);


  // 1. Raw UIMessage passthrough — no transformation needed
  const startingMessages = initialMessages;

  // 2. 规范调用
  const outlineContent = useCanvasStore((s) => s.outlineContent);
  const isDirty = useCanvasStore((s) => s.isDirty);
  const clearDirtyState = useCanvasStore((s) => s.clearDirtyState);

  const { messages, setMessages, sendMessage, status, error, stop } = useChat({
    id: projectId,



    messages: startingMessages,
    transport: new DefaultChatTransport({
      api: "http://localhost:8787/api/chat",
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

      const hasOutline = event.messages.some((msg) => msg.parts.some(p => isToolUIPart(p) && p.type === `tool-updateOutline`));
      const hasFootage = event.messages.some((msg) => msg.parts.some(p => isToolUIPart(p) && p.type === `tool-searchFootage`));

      if (hasOutline) {
        setActiveMode("outline");
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }); // 强制 Loader 重新抓取数据库最新大纲
      } else if (hasFootage) {
        setActiveMode("footage");
        queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      }
    },
  });

  // [DEBUG INJECTION] 实时监控大模型的流式分发状态 (放在 useChat 后面)
  const setOutlineContent = useCanvasStore((s) => s.setOutlineContent);
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[messages.length - 1];

      // 架构师干预：基于深层探针截获的真实结构，精准提取流式大纲
      const outlinePart = last.parts?.find((p: any) => p.type === 'tool-updateOutline');
      if (outlinePart && outlinePart.input && outlinePart.input.contentMd) {
        setOutlineContent(outlinePart.input.contentMd, "agent");
        if (useCanvasStore.getState().activeMode !== "outline") setActiveMode("outline");
      }
    }
  }, [messages, status, setOutlineContent, setActiveMode]);

  // 3. 状态强制同步 (SPA 刚需)
  // Vercel AI SDK 会在内存中按 id 缓存对话。在路由切换或热更新中，
  // initialMessages 会被旧的空缓存覆盖。
  // 因此，使用 setMessages 强制同步外部服务端状态，是正确的同步模式。
  useEffect(() => {
    setMessages(startingMessages);
    // 架构师干预：斩草除根。切换项目时强行清空全局大纲内存，防止幽灵状态。
    useCanvasStore.getState().setOutlineContent("", "system");
    useCanvasStore.getState().clearDirtyState();
  }, [projectId, initialMessages.length]);

  // 4. 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const content = formData.get("content") as string;
    if (content.trim()) {
      // 架构师干预：根据官方最新规范，动态挂载最新业务状态，拒绝陈旧闭包
      sendMessage(
        { role: "user", content },
        { body: { projectId, currentOutline: outlineContent, isDirty } }
      );
      if (isDirty) clearDirtyState();
      e.currentTarget.reset();
    }
  };

  const isLoading = status === "streaming" || status === "submitted";

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs">✨</div>
          <h1 className="text-sm font-medium text-zinc-200">AI 助理</h1>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              {!isUser && (
                <div className="w-7 h-7 mt-1 rounded-full bg-zinc-800 flex items-center justify-center mr-3 flex-shrink-0 border border-zinc-700/50">
                  <span className="text-[10px] text-zinc-400">AI</span>
                </div>
              )}
              <div className={`max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed ${isUser ? "bg-zinc-800 text-zinc-100 rounded-2xl rounded-tr-sm border border-zinc-700/50 shadow-sm" : "bg-transparent text-zinc-300"}`}>
                {/* 1. 纯文本渲染 & 工具状态回显 (拦截空炮消息) */}
                {(() => {
                  const msg = message;
                  let textToRender = msg.parts?.filter(p => p.type === 'text').map(p => p.text).join('') || ``
                  console.log(`text to render: `, textToRender)

                  if (!textToRender || textToRender.includes('{"toolCalls":') || textToRender.includes('"toolCallId":')) return null;

                  return (
                    <div className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}>{textToRender}</ReactMarkdown>
                    </div>
                  );
                })()}

                {/* 2. Tool Invocations 状态渲染 (v6 Parts 适配) */}
                {message.parts?.filter((p: any) => p.toolCallId || (p.type && p.type.startsWith('tool-'))).map((toolPart: any, index: number) => {
                  const state = toolPart.state;
                  // 适配 v6 的流式状态机
                  const isCalling = state === 'streaming' || state === 'input-streaming' || state === 'input-available';
                  const isOutline = toolPart.type?.includes('updateOutline') || toolPart.toolName === 'updateOutline';

                  return (
                    <div key={index} className="flex items-center gap-2 text-indigo-400 bg-indigo-500/10 px-3 py-2 rounded-lg border border-indigo-500/20 my-2 mt-3">
                      {isCalling ? (
                        <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                      ) : (
                        <div className="text-lg leading-none">✨</div>
                      )}
                      <span className="text-sm font-medium">
                        {isCalling ? (isOutline ? "正在构思大纲..." : "正在检索素材...") : (isOutline ? "大纲已更新" : "素材检索完成")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-5 py-4 pb-6 bg-transparent">
        <form onSubmit={handleSubmit} className="relative flex items-end">
          <div className="relative w-full flex items-center bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-600 focus-within:border-indigo-500/50 focus-within:bg-zinc-800 transition-all rounded-2xl shadow-sm overflow-hidden">
            <input type="text" name="content" disabled={isLoading} autoComplete="off" className="flex-1 w-full bg-transparent text-zinc-200 text-sm px-4 py-3.5 focus:outline-none disabled:opacity-50" />
            <div className="pr-2 flex-shrink-0">
              <button type="submit" disabled={isLoading} className="p-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
