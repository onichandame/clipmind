import { Button } from './Button';
import { Clock, Play, Video } from 'lucide-react';

export interface EditingClip {
  startTime: string;
  endTime: string;
  text: string;
  description: string;
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

export function EditingPlanCard({ plan, onPushToEditor }: EditingPlanCardProps) {
  return (
    <div className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden flex flex-col">
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
        {plan.clips.map((clip, index) => (
          <div key={index} className="flex gap-4 group">
            {/* 左侧：时间码区块 */}
            <div className="flex-shrink-0 w-24 pt-1">
              <span className="inline-block text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded">
                {clip.startTime} - {clip.endTime}
              </span>
            </div>
            
            {/* 右侧：文本与动作描述 */}
            <div className="flex-1 flex flex-col gap-1.5 pb-4 border-l-2 border-zinc-100 dark:border-zinc-800 pl-4 relative">
              <div className="absolute w-2.5 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 -left-[6px] top-1.5 group-hover:bg-indigo-500 transition-colors" />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-words">
                {clip.text}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 break-words leading-relaxed">
                {clip.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* 操作区 (Action) */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
        <Button variant="primary" fullWidth onClick={onPushToEditor} className="gap-2">
          <Play className="w-4 h-4" />
          一键推送剪辑台
        </Button>
      </div>
    </div>
  );
}
