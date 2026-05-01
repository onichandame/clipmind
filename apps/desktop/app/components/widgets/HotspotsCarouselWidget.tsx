import { useMemo } from 'react';
import { Flame, Check, TrendingUp } from 'lucide-react';
import type { WidgetProps } from './registry';

interface Hotspot {
  id: string;
  category: string;
  title: string;
  description: string;
  source: 'xiaohongshu' | 'wechat' | 'douyin' | 'bilibili' | 'mixed';
  heatMetric: string;
}

const SOURCE_META: Record<string, { label: string; dot: string }> = {
  xiaohongshu: { label: '小红书', dot: 'bg-red-500' },
  wechat:      { label: '微信',   dot: 'bg-green-500' },
  douyin:      { label: '抖音',   dot: 'bg-zinc-800 dark:bg-zinc-200' },
  bilibili:    { label: 'B站',    dot: 'bg-pink-500' },
  mixed:       { label: '多平台', dot: 'bg-indigo-500' },
};

function buildSeed(h: Hotspot): string {
  const sourceLabel = SOURCE_META[h.source]?.label ?? h.source;
  return `我想围绕这个留学热点创作：
「${h.title}」
（${h.category} · ${sourceLabel} · ${h.heatMetric}）

${h.description}`;
}

// Match a previously-submitted seed back to its source hotspot.
// We anchor on the bracketed title (「…」) which is unique and unambiguous.
function pickedTitle(answer: string | undefined): string | null {
  if (!answer) return null;
  const m = answer.match(/「([^」]+)」/);
  return m ? m[1].trim() : null;
}

export function HotspotsCarouselWidget({ part, onSubmit, answer }: WidgetProps) {
  const items: Hotspot[] = part?.output?.hotspots ?? [];
  const isAnswered = !!answer;
  const pickedTitleStr = useMemo(() => pickedTitle(answer), [answer]);

  const handlePick = (h: Hotspot) => {
    if (isAnswered || !onSubmit) return;
    onSubmit(buildSeed(h));
  };

  return (
    <div className="mt-4 mb-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/70">
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-orange-500" />
          留学热点 {items.length > 0 && <span className="text-zinc-400 dark:text-zinc-500 font-normal">（{items.length} 条 · 点卡片继续）</span>}
        </div>
        {isAnswered && (
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
            <Check className="w-3 h-3" />
            已选定
          </div>
        )}
      </div>

      <div className="p-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <TrendingUp className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">热点采集中</div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs">
              留学行业热点每天 5 点更新；如果是首次启动服务，几分钟后再来看看。
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1 -mr-1">
            {items.map((h) => {
              const meta = SOURCE_META[h.source] ?? SOURCE_META.mixed;
              const isPicked = isAnswered && pickedTitleStr === h.title;
              const isDimmed = isAnswered && !isPicked;
              return (
                <div
                  key={h.id}
                  role="button"
                  tabIndex={isAnswered ? -1 : 0}
                  aria-disabled={isAnswered}
                  onClick={() => handlePick(h)}
                  onKeyDown={(e) => {
                    if (isAnswered) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handlePick(h);
                    }
                  }}
                  className={`group relative w-full rounded-xl border-2 transition-all p-3 flex flex-col gap-2 ${
                    isAnswered ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    isPicked
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-md shadow-indigo-500/20'
                      : isDimmed
                        ? 'border-zinc-200/60 dark:border-zinc-800/60 opacity-50 bg-white/40 dark:bg-zinc-900/40'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-500/40 bg-white dark:bg-zinc-900 hover:shadow-sm'
                  }`}
                  title={h.title}
                >
                  {/* Tag row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {h.category}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-500">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug line-clamp-2 text-left">
                    {h.title}
                  </h3>

                  {/* Description */}
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-3 text-left flex-1">
                    {h.description}
                  </p>

                  {/* Heat metric */}
                  <div className="flex items-center justify-between pt-1 mt-auto border-t border-zinc-100 dark:border-zinc-800/70">
                    <div className="flex items-center gap-1 text-[10px] text-orange-500 dark:text-orange-400 font-medium">
                      <Flame className="w-3 h-3" />
                      <span className="truncate">{h.heatMetric}</span>
                    </div>
                    {isPicked && (
                      <div className="w-4 h-4 rounded-full bg-indigo-500 text-white flex items-center justify-center flex-shrink-0">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
