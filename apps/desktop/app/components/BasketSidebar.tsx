// FIX: 素材篮子悬浮化与暗黑抽屉重构
import { useCanvasStore } from "../store/useCanvasStore";
import { Button } from "./Button";
import { useParams } from "react-router";

interface BasketSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function BasketSidebar({ isOpen, onToggle }: BasketSidebarProps) {
  const { projectId } = useParams();
  const project = useCanvasStore((state) => state.projects[projectId || ""]);
  const setSelectedBasket = useCanvasStore((state) => (state as any).setSelectedBasket);

  const selectedBasket = project?.selectedBasket || [];
  const retrievedClips = project?.retrievedClips || [];

  console.log("=========================================");
  console.log("🛑 [Probe] BasketSidebar Render Triggered");
  console.log(" - projectId from useParams:", projectId);
  console.log(" - project found in store:", !!project);
  console.log(" - selectedBasket length:", selectedBasket.length);
  console.log(" - retrievedClips length:", retrievedClips.length);
  console.log("=========================================");

  // [Fix] 响应式 JIT 映射：组件渲染时动态组装，保证 React 状态追踪
  const items = selectedBasket.map((item: any) => {
    const source = retrievedClips.find((c: any) => c.assetId === item.assetId);
    return { ...item, videoUrl: source?.videoUrl, thumbnailUrl: source?.thumbnailUrl };
  });

  const handleClear = () => {
    if (projectId && window.confirm("确定要清空所有素材吗？")) {
      setSelectedBasket(projectId, []);
    }
  };

  const handleRemove = (assetId: string) => {
    if (projectId) {
      setSelectedBasket(projectId, selectedBasket.filter((i: any) => i.assetId !== assetId));
    }
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    return `${days} 天前`;
  };

  return (
    <>
      {/* FIX: 抽屉面板暗黑玻璃态重构 */}
      <div
        className={`
            fixed top-0 right-0 h-full z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-200 dark:border-zinc-800/80 shadow-2xl
            flex flex-col
            transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
            w-[340px]
            ${isOpen ? "translate-x-0" : "translate-x-full"}
          `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-zinc-100 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">精选素材</h2>
            <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold">
              {items.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
            aria-label="Close basket"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* List Area */}
        <div className="flex-1 overflow-y-auto py-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 px-6 text-center">
              <div className="w-16 h-16 mb-4 rounded-full bg-zinc-800/50 flex items-center justify-center">
                <span className="text-2xl opacity-50">📭</span>
              </div>
              <p className="text-sm font-medium text-zinc-400">篮子空空如也</p>
              <p className="text-xs mt-2 text-zinc-600 leading-relaxed">去画布挑选相关的视频片段，<br />它们会出现在这里</p>
            </div>
          ) : (
            <ul className="space-y-2 px-3">
              {items.map((item: any, idx: number) => (
                <li
                  key={`${item.assetId}-${idx}`}
                  className="px-3 py-3 bg-zinc-50 dark:bg-zinc-900/40 hover:bg-white dark:hover:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/30 rounded-xl flex flex-col gap-2 transition-all group shadow-sm hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* 视频缩略图展示 */}
                    <div className="w-16 h-10 rounded-md bg-zinc-200 dark:bg-zinc-800 overflow-hidden border border-zinc-200 dark:border-zinc-700/50 flex-shrink-0">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate" title={item.reason}>
                        片段 ID: {item.assetId.slice(0, 8)}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-mono text-zinc-500">
                          {(item.startTime / 1000).toFixed(1)}s - {(item.endTime / 1000).toFixed(1)}s
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemove(item.assetId)}
                      className="p-1.5 text-zinc-400 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label="移除该片段"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-950/50 flex flex-col gap-3">
          <Button
            disabled={items.length === 0}
            className="w-full py-3 text-sm flex items-center justify-center gap-2"
          >
            🚀 生成剪辑方案
          </Button>

          <Button
            onClick={handleClear}
            disabled={items.length === 0}
            className="w-full py-2 text-xs bg-transparent text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 border-none shadow-none"
          >
            清空所有素材
          </Button>
        </div>
      </div>
    </>
  );
}
