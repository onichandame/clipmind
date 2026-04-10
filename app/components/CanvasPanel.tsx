// FIX: 右侧画布重构，沉浸式深色体验与高级空状态
import { useEffect } from "react";
import { EditorRoot, EditorContent, type EditorInstance } from "novel";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useCanvasStore } from "../store/useCanvasStore";

type CanvasMode = "outline" | "footage" | "split";

interface OutlineData {
  contentMd: string;
  version: number;
}

interface CanvasPanelProps {
  outline: OutlineData | null;
}

// NEW: 优化文案，增加 Emoji 提升辨识度
const modeLabels: Record<CanvasMode, string> = {
  outline: "📝 策划大纲",
  footage: "🎬 素材检索",
  split: "✨ 交付视图",
};


export function CanvasPanel({ outline }: CanvasPanelProps) {
  const { activeMode, setActiveMode, setOutlineContent } = useCanvasStore();

  // 核心逻辑：服务端数据更新时，静默同步到全局 store
  useEffect(() => {
    if (outline?.contentMd) {
      setOutlineContent(outline.contentMd, "system");
    }
  }, [outline?.contentMd, setOutlineContent]);

  return (
    // FIX: 移除灰白色背景，改为深色底 bg-zinc-950
    <div className="flex flex-col h-full bg-zinc-950 relative overflow-hidden">

      {/* FIX: 顶部导航重构为悬浮式分段控制器 (Segmented Control) */}
      <div className="flex justify-center pt-6 pb-2 z-10 relative">
        <div className="flex items-center p-1 bg-zinc-900/80 border border-zinc-800/80 rounded-xl backdrop-blur-md shadow-2xl">
          {(Object.keys(modeLabels) as CanvasMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setActiveMode(mode)}
              className={`px-6 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${activeMode === mode
                  ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/50"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent"
                }`}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto w-full flex justify-center">
        {activeMode === "outline" ? (
          outline ? (
            // FIX: 大纲渲染区适配暗黑模式，限制最大宽度提升阅读体验
            <div className="w-full max-w-4xl p-8 pb-32">
              <div className="prose prose-zinc prose-invert max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-p:leading-relaxed prose-li:text-zinc-300 prose-strong:text-indigo-400 prose-a:text-indigo-400 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
                <EditorRoot>
                  <EditorContent
                    key={outline.version} // 核心：版本变化时强制重刷内容，解决人机协同状态覆盖
                    extensions={[StarterKit, Markdown]}
                    immediatelyRender={false} // 核心：注入基础文档 Schema，防止 doc 节点缺失报错
                    initialContent={outline.contentMd as any} // 绕过 JSONContent 强校验，利用底层 Markdown 兼容
                    onUpdate={({ editor }) => {
                      if (editor) {
                        // 获取最新的 Markdown 内容并标记为 user 修改
                        const markdown = editor.storage.markdown.getMarkdown();
                        setOutlineContent(markdown, "user");
                      }
                    }}
                    className="relative min-h-[500px] w-full"
                    // @ts-ignore - 兼容旧版属性残留
                    disableLocalStorage={true}
                  />
                </EditorRoot>
              </div>
            </div>
          ) : (
            // FIX: 重构空状态 (Empty State)
            <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center px-8 -mt-20">
              {/* 发光 Icon */}
              <div className="w-20 h-20 mb-6 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-[0_0_40px_rgba(99,102,241,0.15)]">
                <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
              </div>

              <h2 className="text-xl font-semibold text-zinc-200 mb-3 tracking-wide">开启你的视频灵感</h2>
              <p className="text-zinc-500 text-sm leading-relaxed mb-10">
                在左侧告诉我想做什么，我将为你生成结构化的视频大纲，并自动从你的素材库中检索匹配的片段。
              </p>

              {/* 视觉引导 Prompt 建议 */}
              <div className="w-full space-y-3">
                <div className="text-left text-xs font-semibold text-zinc-600 uppercase tracking-wider pl-1 mb-4">✨ 快捷方向</div>
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-4 text-left hover:border-indigo-500/40 hover:bg-zinc-800/60 transition-colors cursor-default group">
                  <div className="text-sm text-zinc-400 font-medium group-hover:text-indigo-300 transition-colors">"帮我策划一期关于 AI 发展史的短视频..."</div>
                </div>
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-4 text-left hover:border-indigo-500/40 hover:bg-zinc-800/60 transition-colors cursor-default group">
                  <div className="text-sm text-zinc-400 font-medium group-hover:text-indigo-300 transition-colors">"找一段带有热烈欢呼声的现场镜头..."</div>
                </div>
              </div>
            </div>
          )
        ) : activeMode === "footage" ? (
          // 预留的素材区空状态
          <div className="flex flex-col items-center justify-center h-full opacity-40 -mt-20">
            <span className="text-5xl mb-6">🎬</span>
            <p className="text-zinc-400 text-sm tracking-wide">检索到的素材片段将在这里展示</p>
          </div>
        ) : (
          // 预留的交付区空状态
          <div className="flex flex-col items-center justify-center h-full opacity-40 -mt-20">
            <span className="text-5xl mb-6">✨</span>
            <p className="text-zinc-400 text-sm tracking-wide">剪辑方案的终态视图将在这里生成</p>
          </div>
        )}
      </div>
    </div>
  );
}
