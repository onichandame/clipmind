import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Film, UploadCloud, Check, Loader2, Activity, AlertCircle, ArrowRight, Trash2 } from 'lucide-react';
import { env } from '../../env';
import { authFetch } from '../../lib/auth';
import { selectAndImportAssets } from '../../lib/asset-import';
import { useCanvasStore } from '../../store/useCanvasStore';
import { getAnalysisStage, type Asset } from '../../lib/asset-types';
import type { WidgetProps } from './registry';

interface ProjectDetail {
  project?: { selectedAssetIds?: string[] | null };
}

const MAX_VISIBLE = 12;

export function AssetPickerWidget({ projectId, onSubmit }: WidgetProps) {
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets-library', projectId],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/assets?projectId=${projectId}`);
      if (!res.ok) return [] as Asset[];
      return (await res.json()) as Asset[];
    },
    // 当列表里还有素材处于 analyzing/uploading 阶段时，每 5s 轮询一次，让 ASR 完成后
    // "分析中"灰罩能自动消失。所有素材到终态后停止轮询，避免无意义请求。
    refetchInterval: (query) => {
      const data = query.state.data as Asset[] | undefined;
      if (!data?.length) return false;
      const hasInflight = data.some((a) => {
        const stage = getAnalysisStage(a);
        return stage === 'analyzing' || stage === 'uploading';
      });
      return hasInflight ? 5000 : false;
    },
  });

  const { data: projectData } = useQuery<ProjectDetail>({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to load project');
      return res.json();
    },
    enabled: !!projectId,
  });

  const selectedIds: string[] = projectData?.project?.selectedAssetIds ?? [];
  const selectedSet = new Set(selectedIds);

  const toggleSelect = useMutation({
    mutationFn: async (assetId: string) => {
      const next = selectedSet.has(assetId)
        ? selectedIds.filter((id) => id !== assetId)
        : [...selectedIds, assetId];
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAssetIds: next }),
      });
      if (!res.ok) throw new Error('Failed to update selection');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const deleteAsset = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/assets/${assetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete asset');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets-library'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  // Inline import progress: any job not yet `ready` keeps a spinner pill in the widget header.
  const importingCount = useCanvasStore((s) =>
    s.uploadJobs.filter((j) => j.status === 'queued' || j.status === 'compressing' || j.status === 'uploading').length,
  );

  // 仍然只展示已上传的素材（status='ready' 即缩略图就绪），但内容分析未完成 / 失败的会被
  // 标灰并禁用选择；这样用户既能"看到"自己已上传的全部素材，又不会误以为它们已可被检索。
  const visibleAssets = assets.filter((a) => a.status === 'ready').slice(0, MAX_VISIBLE);
  const total = assets.length;
  const analyzingCount = assets.filter((a) => getAnalysisStage(a) === 'analyzing').length;

  return (
    <div className="mt-4 mb-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/70">
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Film className="w-3.5 h-3.5" />
          素材库 {total > 0 && <span className="text-zinc-400 dark:text-zinc-500 font-normal">({selectedIds.length}/{total} 已选)</span>}
        </div>
        <div className="flex items-center gap-3">
          {analyzingCount > 0 && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5" title="AI 内容分析（ASR + 摘要）尚未完成的素材，完成前不可被检索">
              <Activity className="w-3 h-3 animate-pulse" />
              AI 分析中 {analyzingCount} 个
            </div>
          )}
          {importingCount > 0 && (
            <div className="text-[11px] text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              正在导入 {importingCount} 个…
            </div>
          )}
          {onSubmit && (
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => onSubmit(`我已选好 ${selectedIds.length} 个素材，请继续`)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500 text-white cursor-pointer"
            >
              选好了
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="p-3">
        {isLoading ? (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 px-2 py-6 text-center">加载素材库…</div>
        ) : visibleAssets.length === 0 ? (
          <EmptyLibrary onImport={() => selectAndImportAssets(projectId)} />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
            {visibleAssets.map((asset) => {
              const isSelected = selectedSet.has(asset.id);
              const stage = getAnalysisStage(asset);
              const selectable = stage === 'analyzed';
              const tooltip = selectable
                ? asset.filename
                : stage === 'analyzing'
                  ? `${asset.filename}\n\nAI 内容分析中，完成前无法被选入素材篮`
                  : `${asset.filename}\n\n内容分析失败，此素材不可用于检索`;
              return (
                <div
                  key={asset.id}
                  role="button"
                  tabIndex={selectable ? 0 : -1}
                  aria-disabled={!selectable}
                  onClick={() => selectable && toggleSelect.mutate(asset.id)}
                  onKeyDown={(e) => {
                    if (!selectable) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSelect.mutate(asset.id);
                    }
                  }}
                  className={`group relative flex-shrink-0 w-32 rounded-xl overflow-hidden border-2 transition-all snap-start ${
                    selectable ? 'cursor-pointer' : 'cursor-not-allowed'
                  } ${
                    isSelected
                      ? 'border-indigo-500 shadow-md shadow-indigo-500/20'
                      : selectable
                        ? 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-500/40'
                        : 'border-zinc-200/60 dark:border-zinc-800/60'
                  }`}
                  title={tooltip}
                >
                  <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative">
                    {asset.thumbnailUrl ? (
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.filename}
                        className={`w-full h-full object-cover ${selectable ? '' : 'grayscale'}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-400">
                        <Film className="w-5 h-5" />
                      </div>
                    )}
                    {stage === 'analyzing' && (
                      <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center text-white gap-1 px-1.5 text-center">
                        <Activity className="w-3.5 h-3.5 animate-pulse" />
                        <span className="text-[10px] font-medium leading-tight">AI 分析中</span>
                      </div>
                    )}
                    {stage === 'analysis_failed' && (
                      <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center text-white gap-1 px-1.5 text-center">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-300" />
                        <span className="text-[10px] font-medium leading-tight">分析失败</span>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteAsset.mutate(asset.id); }}
                      className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/50 hover:bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      title="删除素材"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className={`px-2 py-1.5 bg-white dark:bg-zinc-900 ${selectable ? '' : 'opacity-60'}`}>
                    <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate text-left">
                      {asset.filename}
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => selectAndImportAssets(projectId)}
              className="flex-shrink-0 w-32 aspect-video rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500/60 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 cursor-pointer flex flex-col items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors snap-start"
            >
              <UploadCloud className="w-5 h-5" />
              <span className="text-[11px] font-medium">导入素材</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
        <UploadCloud className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
      </div>
      <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">素材库还是空的</div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">导入第一段视频，AI 就能开始为你检索、分析并生成剪辑方案。</div>
      <button
        type="button"
        onClick={onImport}
        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium cursor-pointer transition-colors"
      >
        <UploadCloud className="w-3.5 h-3.5" />
        导入素材
      </button>
    </div>
  );
}
