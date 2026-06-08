import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Library, Film, Layers, Activity, CheckCircle2, AlertCircle, Cloud, UploadCloud, Trash2, Loader2 } from 'lucide-react';
import { env } from '../env';
import { authFetch } from '../lib/auth';
import { AssetDetailModal } from '../components/AssetDetailModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useLocalAssets } from '../lib/asset-uri';
import { selectAndImportLibraryAssets } from '../lib/asset-import';
import { getAnalysisStage, type Asset } from '../lib/asset-types';
import { useCanvasStore } from '../store/useCanvasStore';

interface LibraryVariant {
  projectId: string;
  projectTitle: string;
  projectAssetId: string;
}

interface LibraryItem {
  userMediaFileId: string;
  mediaFileId: string;
  filename: string;
  sha256: string;
  audioOssUrl: string | null;
  thumbnailUrl: string | null;
  videoOssUrl: string | null;
  backupStatus: NonNullable<Asset['backupStatus']>;
  fileSize: number;
  duration: number | null;
  status: Asset['status'];
  transcriptKind: Asset['transcriptKind'];
  processingStage: Asset['processingStage'];
  failureStage: Asset['failureStage'];
  failureReason: Asset['failureReason'];
  summary: string | null;
  createdAt: string;
  variants: LibraryVariant[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function libraryItemToAsset(item: LibraryItem): Asset {
  return {
    id: item.variants[0]?.projectAssetId ?? item.userMediaFileId,
    mediaFileId: item.mediaFileId,
    filename: item.filename,
    sha256: item.sha256,
    backupStatus: item.backupStatus,
    audioOssUrl: item.audioOssUrl,
    thumbnailUrl: item.thumbnailUrl,
    videoOssUrl: item.videoOssUrl,
    fileSize: item.fileSize,
    duration: item.duration ?? 0,
    status: item.status,
    transcriptKind: item.transcriptKind,
    processingStage: item.processingStage,
    failureStage: item.failureStage,
    failureReason: item.failureReason,
    createdAt: item.createdAt,
    summary: item.summary,
  };
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Track the open modal by mediaFileId rather than holding a snapshot of the
  // LibraryItem. After backup/unbackup invalidates ['library'], the refetched
  // items array is fresh; deriving `selected` from items + id ensures the
  // modal's asset prop (and thus button visibility) reflects the new state
  // immediately. Snapshot would stay stale.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['library'],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/assets/library`);
      if (!res.ok) throw new Error('Failed to load library');
      return (await res.json()) as LibraryItem[];
    },
  });

  const items = data ?? [];
  const selected = useMemo(
    () => (selectedId ? items.find((i) => i.mediaFileId === selectedId) ?? null : null),
    [items, selectedId],
  );
  const hashes = useMemo(() => items.map((i) => i.sha256), [items]);
  // Page-level batch lookup: ask Rust once which of these media_files have a
  // local copy on this device. Card-level rendering uses this map to flag
  // local availability without per-card IPC chatter.
  const { data: localMap } = useLocalAssets(hashes);
  const importingCount = useCanvasStore((s) =>
    s.uploadJobs.filter((j) => j.status === 'queued' || j.status === 'compressing' || j.status === 'uploading').length,
  );

  const deleteLibraryItem = useMutation({
    mutationFn: async (item: LibraryItem) => {
      if (item.variants.length > 0) {
        throw new Error('这个素材还在项目中使用，无法删除。请先从项目中移除。');
      }
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/assets/library/${item.userMediaFileId}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? '这个素材还在项目中使用，无法删除。请先从项目中移除。'
            : '删除失败，请稍后重试。',
        );
      }
    },
    onSuccess: (_data, item) => {
      if (selectedId === item.mediaFileId) setSelectedId(null);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : '删除失败，请稍后重试');
    },
  });

  return (
    <div
      className="h-full overflow-y-auto transition-colors duration-200"
      style={{ backgroundColor: 'var(--color-workspace-bg)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20 flex-shrink-0">
            <Library className="w-7 h-7 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              素材库
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              查看你导入过的素材，以及它们在哪些项目中使用。
            </p>
          </div>
          </div>
          <button
            type="button"
            onClick={() => selectAndImportLibraryAssets()}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 text-sm font-semibold shadow-sm shadow-indigo-500/20 transition-colors cursor-pointer flex-shrink-0"
          >
            {importingCount > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {importingCount > 0 ? `导入中 ${importingCount}` : '上传素材'}
          </button>
        </div>

        {isLoading && (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 px-1">加载中…</div>
        )}
        {isError && (
          <div className="text-sm text-rose-500">加载失败，稍后重试。</div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white/40 dark:bg-zinc-900/40 p-10 text-center">
            <Film className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
            <div className="text-sm text-zinc-600 dark:text-zinc-300 mb-1">还没有任何素材</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              上传视频后，会自动出现在这里；也可以在项目中导入并使用。
            </div>
            <button
              type="button"
              onClick={() => selectAndImportLibraryAssets()}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 text-sm font-semibold transition-colors cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              上传素材
            </button>
          </div>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <LibraryCard
                key={item.mediaFileId}
                item={item}
                hasLocal={!!localMap?.[item.sha256]}
                onOpen={() => setSelectedId(item.mediaFileId)}
                onProjectClick={(projectId) => navigate(`/projects/${projectId}`)}
                onDelete={() => setDeleteTarget(item)}
                isDeleting={deleteLibraryItem.isPending && deleteLibraryItem.variables?.userMediaFileId === item.userMediaFileId}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <AssetDetailModal
          asset={libraryItemToAsset(selected)}
          onClose={() => setSelectedId(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="确认删除素材？"
          description={`将从素材库删除「${deleteTarget.filename}」。此操作不可撤销。`}
          confirmLabel="确认删除"
          variant="danger"
          isPending={deleteLibraryItem.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteLibraryItem.mutate(deleteTarget)}
        />
      )}
    </div>
  );
}

function LibraryCard({
  item,
  hasLocal,
  onOpen,
  onProjectClick,
  onDelete,
  isDeleting,
}: {
  item: LibraryItem;
  hasLocal: boolean;
  onOpen: () => void;
  onProjectClick: (projectId: string) => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const stage = getAnalysisStage({
    status: item.status,
    transcriptKind: item.transcriptKind,
    failureStage: item.failureStage,
    summary: item.summary,
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:shadow-md transition-all flex flex-col"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center overflow-hidden">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.filename}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <Film className="w-10 h-10 text-zinc-400 dark:text-zinc-600" />
        )}
        {item.duration && item.duration > 0 && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/65 text-white text-[10px] font-medium tabular-nums backdrop-blur-sm">
            {formatDuration(item.duration)}
          </div>
        )}
        <div className="absolute top-2 left-2">
          <StageBadge stage={stage} />
        </div>
        {item.variants.length === 0 && (
          <button
            type="button"
            disabled={isDeleting}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed z-10"
            title="从素材库删除"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate"
          title={item.filename}
        >
          {item.filename}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>{formatSize(item.fileSize)}</span>
          <span
            className={
              hasLocal
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-zinc-400 dark:text-zinc-500'
            }
          >
            {hasLocal ? '本机已存' : '未在本机'}
          </span>
          {item.backupStatus === 'backed_up' && (
            <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
              <Cloud className="w-3 h-3" />
              已云端同步
            </span>
          )}
        </div>

        {/* Used-by chips (one chip per project the underlying file is used in) */}
        <div className="flex items-start gap-1.5 mt-1">
          <Layers className="w-3 h-3 text-zinc-400 dark:text-zinc-500 mt-1 flex-shrink-0" />
          <div className="flex flex-wrap gap-1 min-w-0">
            {item.variants.length === 0 && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">未被项目使用</span>
            )}
            {item.variants.map((v) => (
              <button
                key={v.projectAssetId}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onProjectClick(v.projectId);
                }}
                className="inline-flex items-center max-w-[180px] px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 transition-colors cursor-pointer"
                title={v.projectTitle}
              >
                <span className="truncate">{v.projectTitle || '未命名'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StageBadge({ stage }: { stage: ReturnType<typeof getAnalysisStage> }) {
  if (stage === 'analyzed') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/90 text-white backdrop-blur-sm">
        <CheckCircle2 className="w-2.5 h-2.5" /> 可用
      </span>
    );
  }
  if (stage === 'analyzing' || stage === 'uploading') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/90 text-white backdrop-blur-sm">
        <Activity className="w-2.5 h-2.5 animate-pulse" />
        {stage === 'uploading' ? '处理中' : '分析中'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/90 text-white backdrop-blur-sm">
      <AlertCircle className="w-2.5 h-2.5" /> 失败
    </span>
  );
}
