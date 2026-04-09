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
        return "AI service unavailable. Please check configuration.";
      }
    }
    return message || "An error occurred. Please try again.";
  };

  const isLoading = status === "streaming" || status === "submitted";

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
        <span className="text-lg">💬</span>
        <h1 className="text-base font-semibold text-gray-800">ClipMind Chat</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((message) => {
          const isUser = (message.role as string) === "user";
          return (
            <div
              key={message.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  isUser
                    ? "bg-blue-500 text-white rounded-br-md"
                    : "bg-gray-100 text-gray-800 rounded-bl-md"
                }`}
              >
                {message.parts.map((part) => {
                  if (part.type === "text") {
                    const textKey = part.text.substring(0, 20).replace(/[^a-zA-Z0-9]/g, "");
                    return (
                      <div
                        key={`text-${textKey}`}
                        className={
                          isUser ? "prose prose-sm prose-invert" : "prose prose-sm"
                        }
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
                    return (
                      <div key={`tool-call-${toolName}`} className="mt-2">
                        <span className="inline-flex items-center gap-1 text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                          🔧 Calling: {toolName}
                        </span>
                      </div>
                    );
                  }
                  if (part.type === "tool-result") {
                    const toolName = getToolName(part as Parameters<typeof getToolName>[0]);
                    return (
                      <div key={`tool-result-${toolName}`} className="mt-2">
                        <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                          ✅ {toolName} completed
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
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <p className="text-sm text-red-600">{getErrorMessage(error)}</p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-gray-200">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            name="content"
            placeholder="Type a message..."
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="px-4 py-2 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}