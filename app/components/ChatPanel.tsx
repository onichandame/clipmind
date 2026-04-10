import { useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolOrDynamicToolUIPart } from "ai";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useRevalidator } from "react-router";
import { useCanvasStore } from "../store/useCanvasStore";

interface ChatPanelProps {
  projectId: string;
  initialMessages?: any[];
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, code: [...(defaultSchema.attributes?.code || []), "className"] },
};

const GREETING = "你好！我是你的创作助理 ClipMind。今天打算怎么开启工作？是想先聊聊灵感、策划一个新短视频大纲，还是脑子里已经有确切的画面，直接去库里精准找素材片段？";

export function ChatPanel({ projectId, initialMessages = [] }: ChatPanelProps) {
  const setActiveMode = useCanvasStore((s) => s.setActiveMode);
  const revalidator = useRevalidator();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    body: { projectId },
  });

  // 1. 标准化组装初始消息
  const startingMessages = [
    { id: "greeting", role: "assistant" as const, content: GREETING, parts: [{ type: "text", text: GREETING }] },
    ...initialMessages.map(msg => ({
      id: msg.id, 
      role: msg.role as "user" | "assistant", 
      content: msg.content || " ",
      parts: [{ type: "text", text: msg.content || " " }]
    }))
  ] as any[];

        // 2. 规范调用
  const { messages, setMessages, sendMessage, status, error, stop } = useChat({
    id: projectId,
    transport,
    initialMessages: startingMessages,
    onResponse: (response) => {
      console.log("📥 [网络层探针] 收到 Headers! HTTP 状态码:", response.status);
    },
    onError: (err) => {
      console.error("❌ [网络层探针] SDK 底层流解析抛错:", err);
    },
    onFinish: ({ message }) => {
      console.log("🛑 [网络层探针] 触发 onFinish，流被正常解析并结束！");
                // 彻底修复：同时兼容 Vercel AI SDK 原生结构和当前 Transport 的扁平化结构 (tool-updateOutline)
        const hasOutline = message.parts.some(p => p.type === 'tool-updateOutline' || (p.type === 'tool-invocation' && p.toolInvocation?.toolName === 'updateOutline'));
        const hasFootage = message.parts.some(p => p.type === 'tool-searchFootage' || (p.type === 'tool-invocation' && p.toolInvocation?.toolName === 'searchFootage'));
        
        if (hasOutline) {
          setActiveMode("outline");
          revalidator.revalidate(); // 强制 Loader 重新抓取数据库最新大纲
        } else if (hasFootage) {
          setActiveMode("footage");
          revalidator.revalidate();
        }
      },
        onError: (err) => console.error("Chat error:", err),
  });

  // [DEBUG INJECTION] 实时监控大模型的流式分发状态 (放在 useChat 后面)
  useEffect(() => {
    if (status === "streaming" && messages.length > 0) {
      const last = messages[messages.length - 1];
      console.log("🚀 [Stream Debug] 流状态:", status, "| 最新消息的 Parts 类型:", last.parts.map(p => p.type).join(", "));
    }
  }, [messages, status]);

  // 3. 状态强制同步 (SPA 刚需)
  // Vercel AI SDK 会在内存中按 id 缓存对话。在路由切换或热更新中，
  // initialMessages 会被旧的空缓存覆盖。
  // 因此，使用 setMessages 强制同步外部服务端状态，是正确的同步模式。
  useEffect(() => {
    setMessages(startingMessages);
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
      sendMessage({ text: content });
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
          const isUser = (message.role as string) === "user";
          return (
            <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              {!isUser && (
                <div className="w-7 h-7 mt-1 rounded-full bg-zinc-800 flex items-center justify-center mr-3 flex-shrink-0 border border-zinc-700/50">
                  <span className="text-[10px] text-zinc-400">AI</span>
                </div>
              )}
              <div className={`max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed ${isUser ? "bg-zinc-800 text-zinc-100 rounded-2xl rounded-tr-sm border border-zinc-700/50 shadow-sm" : "bg-transparent text-zinc-300"}`}>
                {message.parts.map((part, index) => {
                                    if (part.type === "text") {
                    // [防御性渲染] 拦截模型漏水的 JSON，防止污染前端对话气泡
                    if (part.text.includes('{"toolCalls":') || part.text.includes('"toolCallId":')) {
                      return null;
                    }
                    return (
                      <div key={index} className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}>{part.text}</ReactMarkdown>
                      </div>
                    );
                  }
                                    if (part.type === "tool-invocation" || part.type === "tool-updateOutline") {
                    // 兼容第三方 Transport 扁平化结构
                    const isCalling = part.toolInvocation ? (part.toolInvocation.state === "partial-call" || part.toolInvocation.state === "call") : !part.result;
                    return (
                      <div key={index} className="flex items-center gap-2 text-indigo-400 bg-indigo-500/10 px-3 py-2 rounded-lg border border-indigo-500/20 my-2">
                        {isCalling ? (
                          <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                        ) : (
                          <div className="text-lg leading-none">✨</div>
                        )}
                        <span className="text-sm font-medium">
                          {isCalling ? "正在为您撰写大纲..." : "大纲已更新"}
                        </span>
                      </div>
                    );
                  }
                  return null;
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