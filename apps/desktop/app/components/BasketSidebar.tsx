// FIX: 素材篮子悬浮化与暗黑抽屉重构
import { useBasketStore } from "../store/useBasketStore";

interface BasketSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function BasketSidebar({ isOpen, onToggle }: BasketSidebarProps) {
  const items = useBasketStore((state) => state.items);
  const removeItem = useBasketStore((state) => state.removeItem);
  const clearBasket = useBasketStore((state) => state.clearBasket);

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
      {/* FIX: 重构唤起按钮为右侧悬浮 FAB (Floating Action Button) */}
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          className="fixed top-6 right-6 z-30 bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)] rounded-2xl px-4 py-3 flex items-center gap-2.5 transition-all transform hover:scale-105 hover:-translate-y-1 group"
          aria-label="Open basket"
        >
          <span className="text-xl group-hover:animate-bounce">🛒</span>
          <span className="font-medium text-sm tracking-wide">素材篮子</span>
          {items.length > 0 && (
            <span className="bg-white text-indigo-600 text-xs font-bold px-2 py-0.5 rounded-full ml-1 shadow-inner">
              {items.length}
            </span>
          )}
        </button>
      )}

      {/* FIX: 抽屉面板暗黑玻璃态重构 */}
      <div
        className={`
          fixed top-0 right-0 h-full z-40 bg-zinc-900/95 backdrop-blur-xl border-l border-zinc-800/80 shadow-2xl
          flex flex-col
          transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
          w-[340px]
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-zinc-800/60">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🛒</span>
            <h2 className="text-base font-semibold text-zinc-100 tracking-wide">
              选中的素材
            </h2>
            {items.length > 0 && (
              <span className="text-xs font-medium text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-md">
                {items.length} 项
              </span>
            )}
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
              {items.map((item) => (
                // FIX: 卡片化列表项，增加 hover 反馈
                <li
                  key={item.id}
                  className="px-4 py-3.5 bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-700/30 rounded-xl flex items-start justify-between gap-3 transition-all group"
                >
                  {/* 预留缩略图位置 */}
                  <div className="w-12 h-12 rounded-lg bg-zinc-900 border border-zinc-700/50 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </div>

                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-mono text-zinc-300 truncate">
                      {item.assetChunkId.slice(0, 8)}...
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 bg-zinc-900/80 px-1.5 py-0.5 rounded">
                        #{item.sortRank}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {formatTime(item.addedAt)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                    aria-label={`Remove ${item.assetChunkId.slice(0, 8)}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-zinc-800/60 bg-zinc-950/50 flex flex-col gap-3">
          {/* NEW: 提前预置 PRD 要求的核心流转按钮 */}
          <button
            type="button"
            disabled={items.length === 0}
            className={`
              w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-lg
              ${items.length === 0
                ? "bg-zinc-800 text-zinc-600 cursor-not-allowed shadow-none"
                : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40"
              }
            `}
          >
            🚀 生成剪辑方案
          </button>

          <button
            type="button"
            onClick={clearBasket}
            disabled={items.length === 0}
            className={`
              w-full py-2 rounded-lg text-xs font-medium transition-colors
              ${items.length === 0
                ? "text-zinc-700 cursor-not-allowed"
                : "text-red-400 hover:bg-red-500/10"
              }
            `}
          >
            清空所有素材
          </button>
        </div>
      </div>
    </>
  );
}
