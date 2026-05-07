import { Download, Loader2 } from 'lucide-react';
import type { UpdateStatus } from '../lib/updater';

interface Props {
  status: UpdateStatus;
  onInstall: () => void;
}

export function UpdateBanner({ status, onInstall }: Props) {
  if (status.kind === 'available') {
    return (
      <div className="fixed bottom-20 right-6 z-50 select-none">
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/90 dark:bg-zinc-100/90 text-zinc-100 dark:text-zinc-900 text-sm font-medium shadow-lg backdrop-blur-sm">
          <Download className="w-4 h-4" />
          <span>新版本 v{status.version} 可用</span>
          <button
            type="button"
            onClick={onInstall}
            className="ml-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-500 hover:bg-indigo-400 text-white cursor-pointer transition-colors"
          >
            立即更新
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === 'downloading') {
    const pct = status.total ? Math.round((status.downloaded / status.total) * 100) : null;
    return (
      <div className="fixed bottom-20 right-6 z-50 pointer-events-none select-none">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900/90 dark:bg-zinc-100/90 text-zinc-100 dark:text-zinc-900 text-sm font-medium shadow-lg backdrop-blur-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="tabular-nums">下载中 {pct != null ? `${pct}%` : '…'}</span>
        </div>
      </div>
    );
  }

  if (status.kind === 'installing') {
    return (
      <div className="fixed bottom-20 right-6 z-50 pointer-events-none select-none">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900/90 dark:bg-zinc-100/90 text-zinc-100 dark:text-zinc-900 text-sm font-medium shadow-lg backdrop-blur-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>正在安装…</span>
        </div>
      </div>
    );
  }

  return null;
}
