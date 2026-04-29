import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Film, UploadCloud, Check, Loader2 } from 'lucide-react';
import { env } from '../../env';
import { authFetch } from '../../lib/auth';
import { selectAndImportAssets } from '../../lib/asset-import';
import { useCanvasStore } from '../../store/useCanvasStore';
import type { WidgetProps } from './registry';

interface Asset {
  id: string;
  filename: string;
  thumbnailUrl?: string | null;
  duration?: number;
  status: 'ready' | 'processing' | 'error';
}

interface ProjectDetail {
  project?: { selectedAssetIds?: string[] | null };
}

const MAX_VISIBLE = 12;

export function AssetPickerWidget({ projectId }: WidgetProps) {
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets-library'],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/assets`);
      if (!res.ok) return [] as Asset[];
      return (await res.json()) as Asset[];
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

  // Inline import progress: any job not yet `ready` keeps a spinner pill in the widget header.
  const importingCount = useCanvasStore((s) =>
    s.uploadJobs.filter((j) => j.status === 'queued' || j.status === 'compressing' || j.status === 'uploading').length,
  );

  const readyAssets = assets.filter((a) => a.status === 'ready').slice(0, MAX_VISIBLE);
  const total = assets.length;

  return (
    <div className="mt-4 mb-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/70">
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Film className="w-3.5 h-3.5" />
          素材库 {total > 0 && <span className="text-zinc-400 dark:text-zinc-500 font-normal">({selectedIds.length}/{total} 已选)</span>}
        </div>
        {importingCount > 0 && (
          <div className="text-[11px] text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在导入 {importingCount} 个…
          </div>
        )}
      </div>

      <div className="p-3">
        {isLoading ? (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 px-2 py-6 text-center">加载素材库…</div>
        ) : readyAssets.length === 0 ? (
          <EmptyLibrary onImport={selectAndImportAssets} />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
            {readyAssets.map((asset) => {
              const isSelected = selectedSet.has(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => toggleSelect.mutate(asset.id)}
                  className={`group relative flex-shrink-0 w-32 rounded-xl overflow-hidden border-2 cursor-pointer transition-all snap-start ${
                    isSelected
                      ? 'border-indigo-500 shadow-md shadow-indigo-500/20'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-500/40'
                  }`}
                  title={asset.filename}
                >
                  <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative">
                    {asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt={asset.filename} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-400">
                        <Film className="w-5 h-5" />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5 bg-white dark:bg-zinc-900">
                    <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate text-left">
                      {asset.filename}
                    </div>
                  </div>
                </button>
              );
            })}

            <button
              type="button"
              onClick={selectAndImportAssets}
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
