import { useEffect, useState } from "react";
import { Film, X, CloudUpload, HardDrive, Cloud, AlertTriangle, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { getAnalysisStage, type Asset } from "../lib/asset-types";
import { useAssetUri, useDeviceId } from "../lib/asset-uri";

const BACKUP_LABEL: Record<string, { text: string; tone: string }> = {
  local_only: { text: '仅本地保存', tone: 'text-zinc-500 dark:text-zinc-400' },
  queued: { text: '排队备份中', tone: 'text-amber-500' },
  uploading: { text: '正在备份至云端…', tone: 'text-amber-500' },
  backed_up: { text: '已备份至云端', tone: 'text-emerald-600 dark:text-emerald-400' },
  stale: { text: '本地有改动，云端备份已过期', tone: 'text-amber-600 dark:text-amber-400' },
  failed: { text: '上次备份失败', tone: 'text-rose-500' },
};

export function AssetDetailModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const deviceId = useDeviceId();
  const playable = useAssetUri(asset);
  const [backupStatus, setBackupStatus] = useState<string>(asset.backupStatus || 'local_only');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isLocalOrigin = !!asset.originDeviceId && asset.originDeviceId === deviceId;
  const statusMeta = BACKUP_LABEL[backupStatus] || BACKUP_LABEL.local_only;

  const handleBackup = async () => {
    if (busy) return;
    setBusy(true);
    setBackupStatus('queued');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { getToken } = await import('../lib/auth');
      const { env } = await import('../env');
      await invoke('backup_video_to_cloud', {
        assetId: asset.id,
        localPath: asset.localPath,
        filename: asset.filename,
        serverUrl: env.VITE_API_BASE_URL,
        sessionToken: getToken() || '',
      });
      setBackupStatus('backed_up');
    } catch (e: any) {
      console.error('[Backup] failed:', e);
      setBackupStatus('failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRelink = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'MP4', 'MOV'] }] });
    if (!picked || Array.isArray(picked)) return;
    try {
      const { authFetch } = await import('../lib/auth');
      const { env } = await import('../env');
      await authFetch(`${env.VITE_API_BASE_URL}/api/assets/${asset.id}/relink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPath: picked, originDeviceId: deviceId }),
      });
      // Caller is expected to refresh the asset list to pick up the new path.
      onClose();
    } catch (e) {
      console.error('[Relink] failed:', e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-zinc-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Video / Thumbnail */}
        <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center overflow-hidden rounded-t-xl">
          {playable.uri ? (
            <video
              src={playable.uri}
              poster={asset.thumbnailUrl || undefined}
              controls
              preload="metadata"
              className={`w-full h-full object-contain ${playable.kind === 'unavailable' ? 'grayscale' : ''}`}
            />
          ) : asset.thumbnailUrl ? (
            <>
              <img
                src={asset.thumbnailUrl}
                alt={asset.filename}
                className="absolute inset-0 w-full h-full object-cover grayscale opacity-60"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white text-sm font-medium gap-2 px-4 text-center">
                <AlertTriangle className="w-6 h-6" />
                <div>视频不在本机可用</div>
                {asset.originDeviceId && (
                  <div className="text-xs opacity-80">来源设备：{asset.originDeviceId.slice(0, 8)}…</div>
                )}
                {isLocalOrigin && (
                  <button
                    onClick={handleRelink}
                    className="mt-2 px-3 py-1.5 bg-white text-zinc-900 rounded-md text-xs font-semibold hover:bg-zinc-100"
                  >
                    重新定位本地文件…
                  </button>
                )}
              </div>
            </>
          ) : (
            <Film className="w-12 h-12 text-zinc-400 dark:text-zinc-600" />
          )}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-all backdrop-blur-sm z-10"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info */}
        <div className="p-6 space-y-4">
          <h2
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 break-all"
            title={asset.filename}
          >
            {asset.filename}
          </h2>

          <div className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              {playable.kind === 'local' ? <HardDrive className="w-3.5 h-3.5" /> : <Cloud className="w-3.5 h-3.5" />}
              {playable.kind === 'local' ? '本地播放' : playable.kind === 'cloud' ? '云端播放' : '不可用'}
            </span>
            <span className={`text-xs font-medium ${statusMeta.tone}`}>{statusMeta.text}</span>
          </div>

          {isLocalOrigin && asset.localPath && (backupStatus === 'local_only' || backupStatus === 'failed' || backupStatus === 'stale') && (
            <button
              onClick={handleBackup}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CloudUpload className="w-4 h-4" />
              {busy ? '正在备份…' : (backupStatus === 'stale' ? '重新备份至云端' : '备份原片至云端')}
            </button>
          )}

          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">导入时间</span>
            {"　"}
            {new Date(asset.createdAt).toLocaleString()}
          </p>
          {asset.localPath && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 break-all">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">本地路径：</span>
              {asset.localPath}
            </p>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">AI 内容分析</p>
              <AnalysisStageBadge stage={getAnalysisStage(asset)} />
            </div>
            {asset.summary ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {asset.summary}
              </p>
            ) : getAnalysisStage(asset) === 'analysis_failed' ? (
              <p className="text-sm text-rose-500 dark:text-rose-400">
                ASR 转录失败，此素材无法被 AI 检索。可以删除后重新导入再试一次。
              </p>
            ) : getAnalysisStage(asset) === 'analyzing' ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                AI 正在转录与归纳此素材。完成前不会被 chat 检索到，通常需要几分钟。
              </p>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">AI 总结尚未生成</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalysisStageBadge({ stage }: { stage: ReturnType<typeof getAnalysisStage> }) {
  if (stage === 'analyzed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> 可被 AI 检索
      </span>
    );
  }
  if (stage === 'analyzing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
        <Activity className="w-3 h-3 animate-pulse" /> 分析中
      </span>
    );
  }
  if (stage === 'analysis_failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">
        <AlertCircle className="w-3 h-3" /> 分析失败
      </span>
    );
  }
  if (stage === 'upload_failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">
        <AlertCircle className="w-3 h-3" /> 处理失败
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
      <Activity className="w-3 h-3 animate-pulse" /> 处理中
    </span>
  );
}
