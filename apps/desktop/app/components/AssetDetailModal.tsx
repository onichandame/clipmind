import { useEffect, useState } from "react";
import { Film, X, CloudUpload, CloudDownload, HardDrive, Cloud, AlertTriangle, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getAnalysisStage, type Asset } from "../lib/asset-types";
import { useAssetUri, useLocalAsset } from "../lib/asset-uri";
import { getCachedUser } from "../lib/auth";
import { env } from "../env";

const BACKUP_LABEL: Record<string, { text: string; tone: string }> = {
  local_only: { text: '仅本地保存', tone: 'text-zinc-500 dark:text-zinc-400' },
  uploading: { text: '正在备份至云端…', tone: 'text-amber-500' },
  backed_up: { text: '已备份至云端', tone: 'text-emerald-600 dark:text-emerald-400' },
  stale: { text: '本机版本较新', tone: 'text-amber-600 dark:text-amber-400' },
  failed: { text: '上次备份失败', tone: 'text-rose-500' },
};

export function AssetDetailModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const playable = useAssetUri(asset);
  const { data: localAsset } = useLocalAsset(asset.sha256);
  const [forceCloudPlayback, setForceCloudPlayback] = useState(false);
  const effectivePlayable = forceCloudPlayback && asset.videoOssUrl
    ? { kind: 'cloud' as const, uri: asset.videoOssUrl }
    : playable;
  const queryClient = useQueryClient();
  const backupStatus = asset.backupStatus || 'local_only';
  const [busy, setBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState<number | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [relinkError, setRelinkError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setVideoFailed(false);
    setForceCloudPlayback(false);
  }, [playable.uri]);

  // Subscribe to Rust-emitted backup progress only while a backup is in flight
  // from this modal. Filtering by mediaFileId guards against cross-talk if the
  // user has multiple backup operations queued.
  useEffect(() => {
    if (!busy) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<{ mediaFileId: string; sent: number; total: number }>(
        'backup-progress',
        (e) => {
          if (e.payload.mediaFileId !== asset.mediaFileId) return;
          if (e.payload.total <= 0) return;
          setBackupProgress(Math.floor((e.payload.sent / e.payload.total) * 100));
        },
      );
    })();
    return () => { unlisten?.(); };
  }, [busy, asset.mediaFileId]);

  // Same pattern for cloud download progress.
  useEffect(() => {
    if (!downloadBusy) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<{ mediaFileId: string; sent: number; total: number }>(
        'download-progress',
        (e) => {
          if (e.payload.mediaFileId !== asset.mediaFileId) return;
          if (e.payload.total <= 0) return;
          setDownloadProgress(Math.floor((e.payload.sent / e.payload.total) * 100));
        },
      );
    })();
    return () => { unlisten?.(); };
  }, [downloadBusy, asset.mediaFileId]);

  const hasLocalCopy = !!localAsset;
  const statusMeta = BACKUP_LABEL[backupStatus] || BACKUP_LABEL.local_only;

  const handleBackup = async () => {
    if (busy) return;
    if (!localAsset) return;
    setBusy(true);
    setBackupProgress(0);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { getToken } = await import('../lib/auth');
      const { env } = await import('../env');
      await invoke('backup_video_to_cloud', {
        mediaFileId: asset.mediaFileId,
        localPath: localAsset.localPath,
        filename: asset.filename,
        expectedSha256: asset.sha256,
        expectedSize: asset.fileSize,
        serverUrl: env.VITE_API_BASE_URL,
        sessionToken: getToken() || '',
      });
    } catch (e: any) {
      console.error('[Backup] failed:', e);
    } finally {
      setBusy(false);
      setBackupProgress(null);
      // Server is the source of truth for backupStatus (set to backed_up by the
      // HMAC oss-callback or to failed by Rust on error). Refetch instead of
      // optimistically setting local state.
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['assets-library'], exact: false });
    }
  };

  // 从云端把原片拉回本机。在用户切换设备 / 清空本地缓存后用，配合云备份完成「跨设备同一份素材」。
  const handleDownload = async () => {
    if (downloadBusy) return;
    setDownloadError(null);
    if (!asset.videoOssUrl) {
      setDownloadError('暂时无法下载，请刷新后重试。');
      return;
    }
    const user = getCachedUser();
    if (!user) {
      setDownloadError('登录态丢失，请重新登录。');
      return;
    }
    setDownloadBusy(true);
    setDownloadProgress(0);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('download_asset_to_local', {
        mediaFileId: asset.mediaFileId,
        userId: user.id,
        downloadUrl: asset.videoOssUrl,
        filename: asset.filename,
        expectedSha256: asset.sha256,
        expectedSize: asset.fileSize,
      });
      queryClient.invalidateQueries({ queryKey: ['local-assets'], exact: false });
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message ?? String(e);
      console.error('[Download] failed:', msg);
      setDownloadError(
        msg.includes('hash_mismatch')
          ? '下载的文件与原片不一致，已取消保存。'
          : '下载失败，请稍后重试。',
      );
    } finally {
      setDownloadBusy(false);
      setDownloadProgress(null);
    }
  };

  const handleRelink = async () => {
    if (relinking) return;
    setRelinkError(null);
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'MP4', 'MOV'] }] });
    if (!picked || Array.isArray(picked)) return;
    setRelinking(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('local_assets_relink', {
        expectedSha256: asset.sha256,
        newPath: picked,
      });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['local-assets'], exact: false });
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message ?? String(e);
      console.error('[Relink] failed:', msg);
      setRelinkError(
        msg.includes('hash_mismatch')
          ? '所选文件与原片不匹配，请重新选择。'
          : '重新定位失败，请稍后再试。',
      );
    } finally {
      setRelinking(false);
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
          {effectivePlayable.uri && !videoFailed ? (
            <video
              src={effectivePlayable.uri}
              poster={asset.thumbnailUrl || undefined}
              controls
              preload="metadata"
              onError={(e) => {
                const v = e.currentTarget;
                console.warn('[AssetDetailModal] video load failed', {
                  uri: effectivePlayable.uri,
                  kind: effectivePlayable.kind,
                  errorCode: v.error?.code,
                  errorMessage: v.error?.message,
                });
                if (effectivePlayable.kind === 'local' && asset.backupStatus === 'backed_up' && asset.videoOssUrl) {
                  setForceCloudPlayback(true);
                  return;
                }
                setVideoFailed(true);
              }}
              className={`w-full h-full object-contain ${effectivePlayable.kind === 'unavailable' ? 'grayscale' : ''}`}
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
                <div>{videoFailed ? '本地文件无法播放' : '视频不在本机可用'}</div>
                <button
                  onClick={handleRelink}
                  disabled={relinking}
                  className="mt-2 px-3 py-1.5 bg-white text-zinc-900 rounded-md text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50"
                >
                  {relinking ? '校验中…' : '重新定位本地文件…'}
                </button>
                {relinkError && (
                  <div className="text-[11px] text-rose-200">{relinkError}</div>
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
              {effectivePlayable.kind === 'local' ? <HardDrive className="w-3.5 h-3.5" /> : <Cloud className="w-3.5 h-3.5" />}
              {effectivePlayable.kind === 'local' ? '本地播放' : effectivePlayable.kind === 'cloud' ? '云端播放' : '不可用'}
            </span>
            <span className={`text-xs font-medium ${statusMeta.tone}`}>{statusMeta.text}</span>
          </div>

          {hasLocalCopy && (
            backupStatus === 'local_only' ||
            backupStatus === 'failed' ||
            backupStatus === 'stale' ||
            // Server still says 'uploading' but this modal is idle => previous
            // session crashed mid-upload. Let the user retry; OSS object key is
            // mediaFileId-derived so the retry idempotently overwrites.
            (backupStatus === 'uploading' && !busy)
          ) && (
            <div className="space-y-2">
              <button
                onClick={handleBackup}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <CloudUpload className="w-4 h-4" />
                {busy
                  ? '正在备份…'
                  : backupStatus === 'stale'
                    ? '重新备份至云端'
                    : backupStatus === 'uploading'
                      ? '上次备份未完成，点此重试'
                      : backupStatus === 'failed'
                        ? '上次备份失败，重试'
                        : '备份原片至云端'}
              </button>
              {busy && backupProgress != null && (
                <div className="space-y-1">
                  <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-200"
                      style={{ width: `${backupProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">{backupProgress}%</p>
                </div>
              )}
            </div>
          )}

          {backupStatus === 'backed_up' && (
            <div className="flex flex-wrap items-center gap-2">
              {!hasLocalCopy && asset.videoOssUrl && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={handleDownload}
                    disabled={downloadBusy}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <CloudDownload className="w-4 h-4" />
                    {downloadBusy ? '下载中…' : '从云端下载到本机'}
                  </button>
                  {downloadBusy && downloadProgress != null && (
                    <div className="space-y-1">
                      <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-200"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">{downloadProgress}%</p>
                    </div>
                  )}
                  {downloadError && (
                    <p className="text-xs text-rose-500">{downloadError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {localAsset && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 break-all">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">本地路径：</span>
              {localAsset.localPath}
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
                AI 暂时无法使用此素材。请删除后重新导入再试。
              </p>
            ) : getAnalysisStage(asset) === 'analyzing' ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                AI 正在准备此素材，通常需要几分钟。完成后即可使用。
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
        <CheckCircle2 className="w-3 h-3" /> 可用
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
