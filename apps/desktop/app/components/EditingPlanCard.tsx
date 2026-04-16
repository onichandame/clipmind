import { useState } from 'react';
import { Button } from './Button';
import { Clock, Play, Video, Download } from 'lucide-react';

export interface EditingClip {
  startTime: string;
  endTime: string;
  text: string;
  description: string;
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
  retrievedClips?: any[]; // [Arch] 引入关联的素材池用于溯源映射
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

export function EditingPlanCard({ plan, retrievedClips = [], onPushToEditor }: EditingPlanCardProps) {
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
          // [Arch] 溯源映射：尝试从检索到的素材池中找到匹配的源片段（容错：大模型输出的内容可能是子集或变体）
          const sourceClip = retrievedClips.find(rc =>
            (rc.text && clip.text && rc.text.includes(clip.text)) ||
            (rc.startTime <= Number(clip.startTime) && rc.endTime >= Number(clip.endTime))
          ) || clip; // 回退使用原始 clip 数据

          const thumbUrl = sourceClip.thumbnailUrl || clip.thumbnailUrl;

          // [Arch] 修复驼峰陷阱：兼容数据库中的全小写 filename
          const rawName = sourceClip.filename || sourceClip.fileName || clip.filename || clip.fileName;
          // 兜底：如果完全没有名字但有图，说明匹配到了，给个默认名
          const fName = rawName ? String(rawName).split('/').pop() : (thumbUrl ? '未命名素材.mp4' : null);

          // 检查原片时间是否存在
          const hasSourceTime = sourceClip.startTime !== undefined && sourceClip.endTime !== undefined;

          return (
            <div key={index} className="flex gap-4 group">
              {/* 左侧：缩略图 & 素材溯源 */}
              <div className="flex-shrink-0 w-28 pt-1 flex flex-col gap-2">
                {thumbUrl && (
                  <div className="w-full aspect-video rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden relative group/thumb border border-zinc-200 dark:border-zinc-700/50 shadow-sm">
                    <img src={thumbUrl} alt="thumbnail" className="w-full h-full object-cover" />
                    {/* 透明悬浮下载按钮 */}
                    {(sourceClip.videoUrl || clip.videoUrl) && (
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const a = document.createElement('a');
                            // [Arch] 强制命中后端 JIT 签发的带 attachment 响应头的安全链接
                            a.href = sourceClip.videoUrl || clip.videoUrl || '';
                            // a.download 属性已彻底剥离，防 Warning
                            // 移除 target="_blank"，彻底避开 Tauri Shell 插件的权限拦截区！
                            // 依靠后端注入的 Content-Disposition 响应头，Webview 会原生、静默地接管下载
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

                {/* 显式展示素材来源文件名与原片时间区域 */}
                {fName && (
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
                        原片 {formatMs(sourceClip.startTime)}-{formatMs(sourceClip.endTime)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 右侧：文本与动作描述 */}
              <div className="flex-1 flex flex-col gap-1.5 pb-4 border-l-2 border-zinc-100 dark:border-zinc-800 pl-4 relative">
                <div className="absolute w-2.5 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 -left-[6px] top-1.5 group-hover:bg-indigo-500 transition-colors" />
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-words mt-1">
                  {clip.text}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 break-words leading-relaxed mt-1">
                  {clip.description}
                </p>
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
