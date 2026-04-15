import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Menu, ShoppingBasket } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useBasketStore } from "../store/useBasketStore";
import { Button } from "./Button";
import { PlanCanvas } from "./canvas/PlanCanvas";

type CanvasMode = "outline" | "footage" | "plan" | "split";

interface OutlineData {
  contentMd: string;
  version: number;
}

interface CanvasPanelProps {
  outline: OutlineData | null;
  onToggleBasket: () => void;
}

const modeLabels: Record<CanvasMode, string> = {
  outline: "📝 策划大纲",
  footage: "🎬 素材检索",
  plan: "📋 剪辑方案",
  split: "✨ 交付视图",
};

export function CanvasPanel({ outline, onToggleBasket }: CanvasPanelProps) {
  const { activeMode, setActiveMode, setOutlineContent, outlineContent } = useCanvasStore();
  const basketItems = useBasketStore((state) => state.items);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
      }),
    ],
    content: outline?.contentMd || "",
    // ADR 6.3: 防止 SSR 水合报错
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // FIX: 移除强绑定的 prose-invert，改为 dark:prose-invert 让 @tailwindcss/typography 支持双态
        class: "prose prose-zinc dark:prose-invert max-w-none focus:outline-none transition-colors duration-200",
      },
    },
    onUpdate: ({ editor }) => {
      // 获取 Markdown 并标记为用户修改
      const md = editor.storage.markdown.getMarkdown();
      setOutlineContent(md, "user");
    },
  });

  // 当外部数据（如 AI 生成）更新时，同步编辑器内容
  useEffect(() => {
    if (!editor) return;
    // 架构师干预：优先渲染实时流灌入的 outlineContent，彻底消除 Loader 延迟带来的白屏
    const targetContent = outlineContent || outline?.contentMd || "";
    const currentContent = editor.storage.markdown.getMarkdown();

    // 只要有差异（包括切换到空项目时 targetContent 为空），就强制同步并清空脏状态
    if (currentContent !== targetContent) {
      // 防止高频流式更新导致的光标丢失：仅在未聚焦时执行全量覆盖
      if (!editor.isFocused) {
        editor.commands.setContent(targetContent);
      }
      if (!outlineContent) setOutlineContent(targetContent, "system");
    }
  }, [outline?.contentMd, outlineContent, editor, setOutlineContent]);

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200">
      {/* 顶部状态栏 */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between px-6 bg-white/80 dark:bg-zinc-900/20 backdrop-blur-md transition-colors duration-200">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 transition-colors">当前视图:</span>

          {/* 窄屏态：仅显示当前模式名称 */}
          <span className="lg:hidden text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {modeLabels[activeMode]}
          </span>

          {/* 宽屏态：模式选择器 */}
          <div className="hidden lg:flex bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700/30 transition-colors">
            {(["outline", "footage", "plan", "split"] as CanvasMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setActiveMode(mode)}
                className={`px-3 py-1 rounded-md text-xs transition-all ${activeMode === mode
                  ? "bg-indigo-600 text-white shadow-lg"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
              >
                {modeLabels[mode]}
              </button>
            ))}
          </div>
        </div>

        {/* 宽屏态：素材篮子 (复用 Button 组件) */}
        <div className="hidden lg:flex">
          <Button variant="secondary" size="sm" onClick={onToggleBasket} className="gap-2">
            <ShoppingBasket size={16} />
            <span>素材篮子</span>
            {basketItems.length > 0 && (
              <span className="bg-indigo-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-md shadow-inner">
                {basketItems.length}
              </span>
            )}
          </Button>
        </div>

        {/* 窄屏态：汉堡菜单唤起按钮 */}
        <div className="lg:hidden relative">
          <Button variant="secondary" size="sm" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="px-2">
            <Menu size={18} />
            {basketItems.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 w-2.5 h-2.5 rounded-full border border-zinc-100 dark:border-zinc-900" />
            )}
          </Button>
        </div>
      </div>

      {/* 窄屏态：汉堡下拉菜单 */}
      {isMobileMenuOpen && (
        <div className="absolute top-14 left-0 w-full bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800/50 z-40 flex flex-col p-4 shadow-xl lg:hidden gap-5 animate-in slide-in-from-top-2">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">切换视图</span>
            <div className="grid grid-cols-1 gap-2">
              {(["outline", "footage", "plan", "split"] as CanvasMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={activeMode === mode ? "primary" : "secondary"}
                  size="md"
                  fullWidth
                  onClick={() => {
                    setActiveMode(mode);
                    setIsMobileMenuOpen(false);
                  }}
                >
                  {modeLabels[mode]}
                </Button>
              ))}
            </div>
          </div>

          <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800/50" />

          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => {
              onToggleBasket();
              setIsMobileMenuOpen(false);
            }}
            className="justify-between"
          >
            <div className="flex items-center gap-2">
              <ShoppingBasket size={18} />
              <span>打开素材篮子</span>
            </div>
            {basketItems.length > 0 && (
              <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shadow-inner">
                {basketItems.length} 项
              </span>
            )}
          </Button>
        </div>
      )}

      {/* 主画布区 */}
      <div className="flex-1 overflow-auto w-full flex justify-center">
        {activeMode === "outline" ? (
          (outline || outlineContent) ? (
            <div className="w-full max-w-4xl p-8 pb-32">
              <EditorContent editor={editor} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center px-8 -mt-20">
              <div className="w-20 h-20 mb-6 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/20 shadow-[0_0_40px_rgba(99,102,241,0.15)] transition-colors">
                <svg className="w-10 h-10 text-indigo-500 dark:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2 transition-colors">等待灵感降临...</h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed transition-colors">
                在左侧告诉我想做什么，我会为你生成结构化的视频大纲，并自动匹配库内素材。
              </p>
            </div>
          )
        ) : activeMode === "plan" ? (
          <PlanCanvas />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 italic">
            {activeMode} 视图开发中...
          </div>
        )}
      </div>
    </div>
  );
}
