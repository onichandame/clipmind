import { useEffect, useState } from "react";
import { env } from '../env';
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Menu, ShoppingBasket, ChevronDown, ChevronRight } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "./Button";
import { PlanCanvas } from "./canvas/PlanCanvas";
import { AccordionSection } from "./AccordionSection";

type CanvasMode = "outline" | "footage" | "plan";

interface OutlineData {
  contentMd: string;
  version: number;
}

interface CanvasPanelProps {
  projectId: string;
  projectTitle: string;
  outline: OutlineData | null;
  onToggleBasket: () => void;
}

const modeLabels: Record<CanvasMode, string> = {
  outline: "📝 策划大纲",
  footage: "🎬 素材检索",
  plan: "📋 剪辑方案",
};


export function CanvasPanel({ projectId, projectTitle, outline, onToggleBasket }: CanvasPanelProps) {
  const { activeMode, setActiveMode, setOutlineContent, activePanelId, setActivePanelId } = useCanvasStore();
  const outlineContent = useCanvasStore((s) => s.projects[projectId]?.outlineContent || "");

  const queryClient = useQueryClient();
  const { data: projectData } = useQuery({ queryKey: ['project', projectId] });
  const workflowMode = projectData?.project?.workflowMode;

  const updateModeMutation = useMutation({
    mutationFn: async (mode: string) => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowMode: mode })
      });
      if (!res.ok) throw new Error('Failed to update mode');
      return res.json();
    },
    onSuccess: (_, variables) => {
      // [Arch] 悲观更新：网络请求成功后手动写入缓存，避免触发无 queryFn 的 invalidate 崩溃
      queryClient.setQueryData(['project', projectId], (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          project: { ...oldData.project, workflowMode: variables }
        };
      });
    }
  });
  const retrievedClips = useCanvasStore((s) => s.projects[projectId]?.retrievedClips || []);
  const selectedBasket = useCanvasStore((s) => s.projects[projectId]?.selectedBasket || []);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 辅助函数：判断某个检索结果是否已被选入篮子
  const isClipSelected = (clip: any) => {
    return selectedBasket.some((item: any) =>
      item.assetId === clip.assetId &&
      item.startTime === clip.startTime &&
      item.endTime === clip.endTime
    );
  };

  // 交互函数：手动 Toggle 素材入篮 (乐观更新 + 异步落盘)
  const toggleClipSelection = async (clip: any) => {
    const { setSelectedBasket } = useCanvasStore.getState();
    const currentBasket = [...selectedBasket];
    let newBasket;

    if (isClipSelected(clip)) {
      newBasket = currentBasket.filter((item: any) =>
        !(item.assetId === clip.assetId && item.startTime === clip.startTime && item.endTime === clip.endTime)
      );
    } else {
      newBasket = [...currentBasket, {
        assetId: clip.assetId,
        startTime: clip.startTime,
        endTime: clip.endTime,
        reason: "手动精选"
      }];
    }

    // 1. 乐观更新 (Optimistic UI) 瞬间点亮卡片
    setSelectedBasket(projectId, newBasket);

    // 2. 异步回写落盘 (Persist to DB)
    try {
      const payload = { selectedBasket: newBasket };
      const response = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await response.clone().json().catch(() => ({}));

      if (!response.ok) throw new Error('Failed to persist basket');
    } catch (error) {
      console.error("Failed to sync basket, rolling back...", error);
      // 发生网络错误时，静默回滚到修改前的状态，防止状态水合断层
      setSelectedBasket(projectId, currentBasket);
    }
  };

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
      setOutlineContent(projectId, md, "user");
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
      if (!outlineContent) setOutlineContent(projectId, targetContent, "system");
    }
  }, [outline?.contentMd, outlineContent, editor, setOutlineContent, projectId]);

  if (!workflowMode) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F7F6F1] dark:bg-zinc-950 p-8 transition-colors duration-200">
        <div className="w-full max-w-2xl bg-[#F4F3ED] dark:bg-zinc-900 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-6">选择起点</h2>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => updateModeMutation.mutate('material')} disabled={updateModeMutation.isPending} className="cursor-pointer bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200/60 dark:border-zinc-700 text-left hover:shadow-md hover:border-indigo-500 hover:-translate-y-1 transition-all group flex flex-col h-36 justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              <div className="w-10 h-10 bg-[#E8F3EE] dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mb-4"><svg className="w-5 h-5 text-[#2B7A61]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>
              <div className="font-bold text-zinc-900 dark:text-zinc-100 text-[15px] mb-1.5">我有素材</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">上传素材，AI 帮你分析怎么剪</div>
            </button>
            <button onClick={() => updateModeMutation.mutate('idea')} disabled={updateModeMutation.isPending} className="cursor-pointer bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200/60 dark:border-zinc-700 text-left hover:shadow-md hover:border-indigo-500 hover:-translate-y-1 transition-all group flex flex-col h-36 justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              <div className="w-10 h-10 bg-[#EEF3FB] dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4"><svg className="w-5 h-5 text-[#3769B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg></div>
              <div className="font-bold text-zinc-900 dark:text-zinc-100 text-[15px] mb-1.5">我有想法</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">从热点出发，AI 帮你规划怎么拍</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200">
      {/* 顶部状态栏 */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between px-6 bg-white/80 dark:bg-zinc-900/20 backdrop-blur-md transition-colors duration-200">

        {/* 左侧：空占位 (保持 flex-1 对称张力，确保中间组件视图切换器绝对居中) */}
        <div className="flex-1 flex items-center min-w-0 pr-4">
        </div>

        {/* 中间：工作流指示器 (取代旧版 Tab，保持布局张力) */}
        <div className="flex items-center gap-3 justify-center">
           <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-3 py-1 rounded-full">
             {workflowMode === 'material' ? '🎬 素材驱动工作流' : workflowMode === 'idea' ? '💡 想法驱动工作流' : ''}
           </span>
        </div>

        {/* 右侧：操作区 (与左侧 flex-1 对称以保证中部绝对居中) */}
        <div className="flex-1 flex items-center justify-end gap-2">
          {/* 宽屏态：素材篮子 (复用 Button 组件) */}
          <div className="hidden lg:flex">
            <Button variant="secondary" size="sm" onClick={onToggleBasket} className="gap-2">
              <ShoppingBasket size={16} />
              <span>素材篮子</span>
              {selectedBasket.length > 0 && (
                <span className="bg-indigo-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-md shadow-inner">
                  {selectedBasket.length}
                </span>
              )}
            </Button>
          </div>

          {/* 窄屏态：汉堡菜单唤起按钮 */}
          <div className="lg:hidden relative">
            <Button variant="secondary" size="sm" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="px-2">
              <Menu size={18} />
              {selectedBasket.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 w-2.5 h-2.5 rounded-full border border-zinc-100 dark:border-zinc-900" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 窄屏态：汉堡下拉菜单 */}
      {isMobileMenuOpen && (
        <div className="absolute top-14 left-0 w-full bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800/50 z-40 flex flex-col p-4 shadow-xl lg:hidden gap-5 animate-in slide-in-from-top-2">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">切换视图</span>
            <div className="grid grid-cols-1 gap-2">
              {(["outline", "footage", "plan"] as CanvasMode[]).map((mode) => (
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
            {selectedBasket.length > 0 && (
              <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shadow-inner">
                {selectedBasket.length} 项
              </span>
            )}
          </Button>
        </div>
      )}

      {/* 主画布区：手风琴任务流 */}
      <div className="flex-1 overflow-y-auto w-full p-6 lg:p-10 bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-4xl mx-auto flex flex-col">
          {/* 根据 workflowMode 动态排列节点顺序 */}
          {(workflowMode === 'idea' ? ['outline', 'footage', 'plan'] : ['footage', 'outline', 'plan']).map((nodeType) => {
            if (nodeType === 'outline') {
              return (
                <AccordionSection key="outline" id="outline" title="📝 策划大纲" activeId={activePanelId} setActiveId={setActivePanelId}>
                  {(outline || outlineContent) ? (
                    <div className="w-full pb-10">
                      <EditorContent editor={editor} />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 mb-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/20 shadow-sm">
                        <svg className="w-8 h-8 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">等待灵感降临...</h3>
                      <p className="text-zinc-500 dark:text-zinc-400 text-sm">在左侧告诉我想做什么，我会为你生成结构化的视频大纲</p>
                    </div>
                  )}
                </AccordionSection>
              );
            }
            if (nodeType === 'footage') {
              return (
                <AccordionSection key="footage" id="footage" title="🎬 挑选素材" activeId={activePanelId} setActiveId={setActivePanelId}>
                  {retrievedClips.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400 space-y-4">
                      <div className="text-4xl">🎬</div>
                      <p className="text-sm">暂无检索结果，请在左侧向 ClipMind 描述所需素材</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2">
                      {retrievedClips.map((clip: any, i: number) => {
                        const selected = isClipSelected(clip);
                        return (
                          <div
                            key={i}
                            onClick={() => toggleClipSelection(clip)}
                            className={`bg-white dark:bg-zinc-900 border cursor-pointer hover:ring-1 hover:ring-indigo-300 dark:hover:ring-indigo-700 ${selected ? 'border-indigo-500 ring-1 ring-indigo-500 shadow-md' : 'border-zinc-200 dark:border-zinc-800 shadow-sm'} rounded-xl overflow-hidden flex flex-col transition-all group relative`}
                          >
                            {selected && (
                              <div className="absolute top-2 right-2 z-10 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                已精选
                              </div>
                            )}
                            <div className={`w-full h-28 relative ${selected ? 'opacity-90' : ''}`}>
                              {clip.thumbnailUrl ? (
                                <img src={clip.thumbnailUrl} alt="thumbnail" className="w-full h-full object-cover bg-zinc-100 dark:bg-zinc-800" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 text-2xl">🎬</div>
                              )}
                              <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded font-mono shadow-sm">
                                {(clip.startTime / 1000).toFixed(1)}s - {(clip.endTime / 1000).toFixed(1)}s
                              </div>
                            </div>
                            <div className="p-3 flex flex-col gap-2 flex-1">
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded shrink-0">
                                  Score: {clip.score?.toFixed(2) || 'N/A'}
                                </span>
                                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 truncate" title={clip.filename}>
                                  {clip.filename || '未知素材'}
                                </span>
                              </div>
                              <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">{clip.text}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </AccordionSection>
              );
            }
            if (nodeType === 'plan') {
              return (
                <AccordionSection key="plan" id="plan" title="📋 剪辑方案" activeId={activePanelId} setActiveId={setActivePanelId}>
                  <PlanCanvas projectId={projectId} />
                </AccordionSection>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
