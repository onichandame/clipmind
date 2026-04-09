// FIX: 对话框视觉重构，沉浸式深色体验
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
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
  },
};

const GREETING =
  "你好！我是你的创作助理 ClipMind。今天打算怎么开启工作？是想先聊聊灵感、策划一个新短视频大纲，还是脑子里已经有确切的画面，直接去库里精准找素材片段？";

export function ChatPanel({ projectId }: ChatPanelProps) {
  const setActiveMode = useCanvasStore((s) => s.setActiveMode);
  const revalidator = useRevalidator();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    body: { projectId },
  });

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    messages: [
      {
        id: "greeting",
        role: "assistant" as const,
        createdAt: new Date(),
        parts: [{ type: "text", text: GREETING }] as UIMessage["parts"],
      },
    ],
    onFinish: ({ message }) => {
      for (const part of message.parts) {
        if (isToolOrDynamicToolUIPart(part) && part.type !== "tool-result") {
          const toolName = getToolName(part);
          if (toolName === "updateOutline") {
            setActiveMode("outline");
            revalidator.revalidate();
            break;
          }
          if (toolName === "searchFootage") {
            setActiveMode("footage");
            break;
          }
        }
      }
    },
    onError: (err) => {
      console.error("Chat error:", err);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const content = formData.get("content") as string;
    if (content.trim()) {
      sendMessage({ text: content });
      e.currentTarget.reset();
    }
  };

  const getErrorMessage = (err: Error) => {
    const message = err.message || "";
    const sensitivePatterns = [
      /api[_-]?key/i,
      /openai/i,
      /anthropic/i,
      /api[_-]?secret/i,
      /sk-[a-zA-Z0-9]/i,
    ];
    for (const pattern of sensitivePatterns) {
      if (pattern.test(message)) {
        return "AI 服务暂时不可用，请检查配置。";
      }
    }
    return message || "发生错误，请重试。";
  };

  const isLoading = status === "streaming" || status === "submitted";

  return (
    // FIX: 整体背景改为 transparent，融入外层 Layout
    <div className="flex flex-col h-full bg-transparent">
      {/* Header 重构 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs">✨</div>
          <h1 className="text-sm font-medium text-zinc-200">AI 助理</h1>
        </div>
        <span className="text-[10px] font-medium tracking-wider uppercase text-zinc-500 bg-zinc-800/50 px-2 py-1 rounded-md border border-zinc-700/50">
          ClipMind
        </span>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        {messages.map((message) => {
          const isUser = (message.role as string) === "user";
          return (
            <div
              key={message.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              {/* NEW: 为 AI 增加极简的头像占位 */}
              {!isUser && (
                <div className="w-7 h-7 mt-1 rounded-full bg-zinc-800 flex items-center justify-center mr-3 flex-shrink-0 border border-zinc-700/50">
                  <span className="text-[10px] text-zinc-400">AI</span>
                </div>
              )}

              <div
                // FIX: 气泡视觉重构。User深灰背景，AI透明背景
                className={`max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed ${isUser
                    ? "bg-zinc-800 text-zinc-100 rounded-2xl rounded-tr-sm border border-zinc-700/50 shadow-sm"
                    : "bg-transparent text-zinc-300"
                  }`}
              >
                {message.parts.map((part) => {
                  if (part.type === "text") {
                    const textKey = part.text.substring(0, 20).replace(/[^a-zA-Z0-9]/g, "");
                    return (
                      <div
                        key={`text-${textKey}`}
                        // FIX: Markdown 文本强制使用 prose-invert 适配深色
                        className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800"
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                        >
                          {part.text}
                        </ReactMarkdown>
                      </div>
                    );
                  }
                  if (isToolOrDynamicToolUIPart(part) && part.type !== "tool-result") {
                    const toolName = getToolName(part);
                    const isOutline = toolName === "updateOutline";
                    return (
                      <div key={`tool-call-${toolName}`} className="mt-3">
                        <span className="inline-flex items-center gap-1.5 text-xs bg-indigo-500/10 text-indigo-300 px-3 py-1.5 rounded-md border border-indigo-500/20">
                          <span className="animate-pulse">⚡</span>
                          {isOutline ? "正在撰写大纲..." : "正在检索素材..."}
                        </span>
                      </div>
                    );
                  }
                  if (part.type === "tool-result") {
                    const toolName = getToolName(part as Parameters<typeof getToolName>[0]);
                    return (
                      <div key={`tool-result-${toolName}`} className="mt-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 px-1">
                          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          任务完成
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

      {error && (
        <div className="px-5 py-3 bg-red-950/30 border-t border-red-900/50">
          <p className="text-xs text-red-400 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {getErrorMessage(error)}
          </p>
        </div>
      )}

      {/* Input Area 重构 */}
      <div className="px-5 py-4 pb-6 bg-transparent">
        <form onSubmit={handleSubmit} className="relative flex items-end">
          {/* FIX: 沉浸式胶囊输入框 */}
          <div className="relative w-full flex items-center bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-600 focus-within:border-indigo-500/50 focus-within:bg-zinc-800 transition-all rounded-2xl shadow-sm overflow-hidden">
            <input
              type="text"
              name="content"
              placeholder="输入指令，或描述你需要什么素材..."
              disabled={isLoading}
              autoComplete="off"
              className="flex-1 w-full bg-transparent text-zinc-200 text-sm px-4 py-3.5 focus:outline-none disabled:opacity-50 placeholder:text-zinc-500"
            />
            <div className="pr-2 flex-shrink-0">
              {isLoading ? (
                <button
                  type="button"
                  onClick={stop}
                  className="p-1.5 rounded-xl bg-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="p-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                </button>
              )}
            </div>
          </div>
        </form>
        {/* NEW: 增加底部免责小字，提升专业感 */}
        <div className="text-center mt-2.5">
          <span className="text-[10px] text-zinc-500 font-medium">AI 可能会犯错。请核对生成的素材大纲。</span>
        </div>
      </div>
    </div>
  );
}
