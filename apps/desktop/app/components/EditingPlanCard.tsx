import { useState } from 'react';
import { Button } from './Button';
import { Clock, Play, Video, Download } from 'lucide-react';

export interface EditingClip {
  startTime: string;
  endTime: string;
  text: string;
  description: string;
  assetId?: string;
  clipType?: 'footage' | 'broll';
  thumbnailUrl?: string;
  videoUrl?: string;
  fileName?: string;
}

export interface EditingPlan {
  title: string;
  platform: string;
  targetDuration: string;
  clips: EditingClip[];
}

export interface EditingPlanCardProps {
  plan: EditingPlan;
  onPushToEditor?: () => void;
}

// 毫秒转 MM:SS 工具函数
const formatMs = (ms: number | string) => {
  const totalSeconds = Math.floor(Number(ms) / 1000);
  if (isNaN(totalSeconds)) return "00:00";
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export function EditingPlanCard({ plan, onPushToEditor }: EditingPlanCardProps) {
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  return (
    <div className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden flex flex-col relative">
      {/* 头部概览 (Header) */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col gap-2">
        <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 line-clamp-2 break-words">
          {plan.title}
        </h3>
        <div className="flex items-center gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            <Video className="w-3 h-3" />
            {plan.platform}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            预估时长: {plan.targetDuration}
          </span>
        </div>
      </div>

      {/* 时间轴列表 (Timeline / Clips) */}
      <div className="p-4 flex flex-col gap-4 max-h-[400px] overflow-y-auto">
        {plan.clips.map((clip, index) => {
          // Determine clip type: explicit broll, footage (has assetId), or legacy
          const isBroll = clip.clipType === 'broll';
          const isFootage = clip.clipType === 'footage' || (!clip.clipType && !!clip.assetId);
          const isLegacy = !isBroll && !isFootage;

          const thumbUrl = clip.thumbnailUrl;
          const fName = clip.fileName ? String(clip.fileName).split('/').pop() : null;
          const hasSourceTime = clip.startTime !== undefined && clip.endTime !== undefined;

          return (
            <div key={index} className="flex gap-4 group">
              {/* 左侧：缩略图 / 空镜徽章 */}
              <div className="flex-shrink-0 w-20 pt-1 flex flex-col gap-2">
                {/* Footage: thumbnail */}
                {isFootage && thumbUrl && (
                  <div className="w-20 h-[45px] rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden relative group/thumb border border-zinc-200 dark:border-zinc-700/50 shadow-sm">
                    <img src={thumbUrl} alt="thumbnail" className="w-full h-full object-cover" />
                    {/* 透明悬浮下载按钮 */}
                    {clip.videoUrl && (
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const a = document.createElement('a');
                            a.href = clip.videoUrl || '';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setToastMsg(`开始下载：${fName || '视频素材'}\n请前往系统「下载」目录查看`);
                            setTimeout(() => setToastMsg(null), 4000);
                          }}
                          className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
                          title="下载该素材原片"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* B-roll: 空镜 badge */}
                {isBroll && (
                  <div className="w-20 h-[45px] rounded bg-slate-200 dark:bg-slate-800 flex items-center justify-center border border-slate-300 dark:border-slate-700/50 shadow-sm">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 select-none">空镜</span>
                  </div>
                )}

                {/* Footage: filename + source time */}
                {isFootage && fName && (
                  <div className="flex flex-col gap-1 w-full mt-0.5">
                    <div
                      className="w-full truncate text-[10px] font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-800 px-1.5 py-1 rounded border border-zinc-300/50 dark:border-zinc-700/80"
                      title={fName}
                    >
                      🎬 {fName}
                    </div>
                    {hasSourceTime && (
                      <div
                        className="w-full text-center text-[9px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50 px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-800"
                        title="对应原素材视频中的时间切片"
                      >
                        {formatMs(clip.startTime)}-{formatMs(clip.endTime)}
                      </div>
                    )}
                  </div>
                )}

                {/* B-roll: time range only */}
                {isBroll && hasSourceTime && (
                  <div
                    className="w-full text-center text-[9px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50 px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-800"
                    title="空镜时间范围"
                  >
                    {formatMs(clip.startTime)}-{formatMs(clip.endTime)}
                  </div>
                )}
              </div>

              {/* 右侧：文本与动作描述 */}
              <div className="flex-1 flex flex-col gap-1.5 pb-4 border-l-2 border-zinc-100 dark:border-zinc-800 pl-4 relative">
                <div className="absolute w-2.5 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 -left-[6px] top-1.5 group-hover:bg-indigo-500 transition-colors" />
                {/* Legacy: show text + description (original behavior) */}
                {isLegacy && (
                  <>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-words mt-1">
                      {clip.text}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 break-words leading-relaxed mt-1">
                      {clip.description}
                    </p>
                  </>
                )}
                {/* Footage: time range + filename + text + description */}
                {isFootage && (
                  <>
                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 dark:text-zinc-500 mt-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatMs(clip.startTime)} - {formatMs(clip.endTime)}</span>
                      {fName && <span className="text-zinc-500 dark:text-zinc-400 truncate">· {fName}</span>}
                    </div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-words">
                      {clip.text}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 break-words leading-relaxed">
                      {clip.description}
                    </p>
                  </>
                )}
                {/* B-roll: time range + description */}
                {isBroll && (
                  <>
                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 dark:text-zinc-500 mt-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatMs(clip.startTime)} - {formatMs(clip.endTime)}</span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 break-words leading-relaxed">
                      {clip.description}
                    </p>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

    
      {/* 轻量级下载提示 Toast */}
      {toastMsg && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 rounded-full shadow-2xl text-xs font-medium z-50 text-center animate-in fade-in slide-in-from-bottom-2 duration-300 whitespace-pre-line pointer-events-none">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
