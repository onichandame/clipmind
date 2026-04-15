import { env } from '../env';
import { Button } from "../components/Button";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { useState, useEffect } from "react";
import { useRevalidator, useLoaderData } from "react-router";
import { Film, CheckCircle2, Clock, AlertCircle, Activity, UploadCloud, Trash2 } from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 资产数据的 TypeScript 定义，需与后端 Drizzle Schema 对应
interface Asset {
  id: string;
  filename: string;
  objectKey: string;
  thumbnailUrl?: string;
  fileSize: number;
  duration: number;
  status: 'ready' | 'processing' | 'error';
  createdAt: string;
}

// 辅助函数：格式化时长 (秒 -> MM:SS)
function formatDuration(seconds?: number) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// React Router v7 客户端加载器：负责从 Hono 后端获取真实资产列表
export async function clientLoader() {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/assets`);
  if (!res.ok) return [];
  return res.json() as Promise<Asset[]>;
}

type JobStatus = 'queued' | 'compressing' | 'uploading' | 'ready' | 'error';
interface UploadJob { id: string; filename: string; sourcePath: string; status: JobStatus; progress: number; }

export default function AssetsLibrary() {
  // 核心变更：从 Loader 中实时获取数据库数据
  const assets = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();

  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const updateJob = (id: string, updates: Partial<UploadJob>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));
  };

  const handleSelectFiles = async () => {
    // 兼容大写后缀名 (如相机直接导出的 .MOV / .MP4)
    const selected = await open({ multiple: true, filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'MP4', 'MOV'] }] });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];

    const newJobs = paths.map(p => ({
      id: crypto.randomUUID(),
      filename: p.split(/[\\/]/).pop() || 'video.mp4',
      sourcePath: p,
      status: 'queued' as JobStatus,
      progress: 0
    }));

    setJobs(prev => [...prev, ...newJobs]);
    newJobs.forEach(processJob); // 发射！独立进入状态机，互不阻塞
  };

  // 注入进度监听，拦截 Rust 底层的节流事件
  useEffect(() => {
    let unlistenUpload: () => void;
    let unlistenFFmpeg: () => void;

    import('@tauri-apps/api/event').then(({ listen }) => {
      // 监听上传进度
      listen<{ id: string, progress: number }>('upload-progress', (event) => {
        const isComplete = event.payload.progress >= 100;
        if (isComplete) {
          revalidator.revalidate(); // 触发页面数据重新拉取
        }
        setJobs(current => current.map(j =>
          j.id === event.payload.id
            ? { ...j, progress: event.payload.progress, status: isComplete ? 'ready' : j.status }
            : j
        ));
      }).then(fn => unlistenUpload = fn);

      // 监听压缩进度并在控制台打印
      listen<{ log: string }>('ffmpeg-progress', (event) => {
        console.log("[前端 FFmpeg 进度捕获]:", event.payload.log);
        // 视觉补偿：由于 FFmpeg 日志难以精准转化为百分比且未绑定 ID，我们为处于 compressing 的任务统一增加伪进度
        setJobs(current => current.map(j =>
          (j.status === 'compressing' && j.progress < 90) ? { ...j, progress: j.progress + 2 } : j
        ));
      }).then(fn => unlistenFFmpeg = fn);
    });

    return () => {
      if (unlistenUpload) unlistenUpload();
      if (unlistenFFmpeg) unlistenFFmpeg();
    };
  }, []);

  const [deletingAsset, setDeletingAsset] = useState<{ id: string, filename: string } | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, id: string, filename: string) => {
    e.stopPropagation();
    setDeletingAsset({ id, filename });
  };

  const confirmDelete = async () => {
    if (!deletingAsset) return;
    try {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/assets/${deletingAsset.id}`, { method: 'DELETE' });
      if (res.ok) {
        revalidator.revalidate(); // 乐观重新拉取数据
      } else {
        console.error('删除失败:', await res.text());
      }
    } catch (error) {
      console.error('删除请求出错:', error);
    } finally {
      setDeletingAsset(null);
    }
  };

  const processJob = async (job: UploadJob) => {
    try {
      updateJob(job.id, { status: 'compressing', progress: 0 });

      // 架构大统一：交由 Rust 层全权接管预处理、节流阀、并发隔离与零拷贝上传
      // 预处理完成后 invoke 会立即返回，随后 Rust 在后台 tokio::spawn 并发推流。
      await invoke('process_video_asset', {
        jobId: job.id,
        filename: job.filename,
        localPath: job.sourcePath,
        serverUrl: env.VITE_API_BASE_URL
      });

      // 预处理完成（锁已释放），Rust 进入脱壳后台上传
      updateJob(job.id, { status: 'uploading', progress: 0 });
      console.log(`[Pipeline] 预处理完成，已移交 Rust 后台并发推流: ${job.filename}`);

      // 注意：UI 最终状态的完成 (ready) 和重新拉取 (revalidate) 
      // 会由组件外部监听 'upload-progress' 达 100% 时的事件统一处理。
    } catch (error: any) {
      updateJob(job.id, { status: 'error' });
      console.error("处理管道异常中断:", error);
    }
  };

  // 架构师注入：任务全完成后的延时清理逻辑 (自动关闭上传区)
  useEffect(() => {
    if (jobs.length === 0) return;

    // 检查是否所有任务都已到达终态 ('ready' 或 'error')
    const allFinished = jobs.every(j => j.status === 'ready' || j.status === 'error');

    if (allFinished) {
      const timer = setTimeout(() => {
        // 利用 setState 的回调形式，执行终态双重校验 (防 Race Condition)
        setJobs(currentJobs => {
          const stillAllFinished = currentJobs.every(j => j.status === 'ready' || j.status === 'error');
          if (stillAllFinished) {
            return []; // 清空任务，从而触发 jobs.length === 0 隐去上传区
          }
          return currentJobs; // 期间有新任务加入，放弃清理
        });
      }, 3000); // 留出 3 秒展示成功状态的视觉缓冲期

      // 清理函数：如果在 3 秒内 jobs 数组发生变化（如加入新任务），立即撤销销毁计划
      return () => clearTimeout(timer);
    }
  }, [jobs]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-8 font-sans transition-colors duration-200">
      <div className="flex items-center justify-between mb-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight transition-colors">全部素材 (Assets)</h1>
        <Button onClick={handleSelectFiles} variant="primary">
          <UploadCloud className="w-4 h-4 mr-2" /> 批量导入
        </Button>
      </div>

      <div className="max-w-7xl mx-auto">

        {/* 极速上传并发管道 Pipeline UI */}
        {jobs.length > 0 && (
          <div className="mb-8 p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/80 rounded-xl space-y-3 transition-colors">
            <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2 transition-colors">
              <Activity className="w-4 h-4 text-indigo-500 dark:text-indigo-400" /> 上传区
            </h2>
            {jobs.map(job => (
              <div key={job.id} className="flex items-center gap-4 bg-white dark:bg-zinc-950 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800/50 shadow-sm dark:shadow-none transition-colors">
                <div className="flex-1 truncate text-sm text-zinc-800 dark:text-zinc-300 transition-colors">{job.filename}</div>
                <div className="flex-[2] flex items-center gap-3 text-xs">
                  <span className={`w-28 shrink-0 whitespace-nowrap font-medium ${job.status === 'compressing' ? 'text-amber-400 animate-pulse' : job.status === 'uploading' ? 'text-blue-400' : job.status === 'ready' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {job.status === 'queued' && '等待中...'}
                    {job.status === 'compressing' && '⚙️ 极速处理中'}
                    {job.status === 'uploading' && `☁️ 上传中 ${job.progress}%`}
                    {job.status === 'ready' && '✅ 上传完毕，AI 接管'}
                    {job.status === 'error' && '❌ 处理失败'}
                  </span>
                  <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden transition-colors">
                    <div
                      className={`h-full transition-all duration-300 ${job.status === 'compressing' ? 'w-full bg-amber-500/50 animate-pulse' : job.status === 'ready' ? 'w-full bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: job.status === 'uploading' ? `${job.progress}%` : undefined }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {deletingAsset && (
          <DeleteConfirmModal
            title="确认删除素材？"
            description={`确定要永久删除素材 "${deletingAsset.filename}" 吗？\n注意：此操作不可逆。`}
            onCancel={() => setDeletingAsset(null)}
            onConfirm={confirmDelete}
          />
        )}
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-xl text-zinc-500 bg-zinc-50/50 dark:bg-transparent transition-colors">
            <svg className="w-12 h-12 mb-4 opacity-50 text-zinc-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>
            <p className="text-zinc-600 dark:text-zinc-500 transition-colors">还没有上传任何素材。点击右上角开始沉淀你的视频底座。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {assets.map((asset) => (
              <div key={asset.id} className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200 shadow-sm dark:shadow-none">
                <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center overflow-hidden transition-colors">
                  {asset.thumbnailUrl ? (
                    <>
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.filename}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                      <Film className="hidden w-8 h-8 text-zinc-400 dark:text-zinc-600 group-hover:scale-110 transition-transform duration-300" />
                    </>
                  ) : (
                    <Film className="w-8 h-8 text-zinc-400 dark:text-zinc-600 group-hover:scale-110 transition-transform duration-300" />
                  )}
                  <button
                    onClick={(e) => handleDeleteClick(e, asset.id, asset.filename)}
                    className="absolute top-2 left-2 p-1.5 bg-black/50 hover:bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm z-10"
                    title="删除素材"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="absolute top-2 right-2 shadow-sm drop-shadow-md">
                    {asset.status === 'ready' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shadow-md border-0">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 已就绪
                      </span>
                    ) : asset.status === 'error' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-600 text-white shadow-md border-0">
                        <AlertCircle className="w-3.5 h-3.5" /> 处理失败
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-600 text-white shadow-md border-0">
                        <Activity className="w-3.5 h-3.5 animate-pulse" /> 处理中
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4 bg-white dark:bg-transparent transition-colors">
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-200 truncate transition-colors" title={asset.filename}>{asset.filename}</h3>
                  <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 transition-colors">
                    {/* 确保字段名与 Drizzle 返回的一致 */}
                    <div className="flex gap-2">
                      <span className="font-medium text-zinc-600 dark:text-zinc-400 transition-colors">{formatDuration(asset.duration)}</span>
                      <span>•</span>
                      <span>{((asset.fileSize || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                    <span>{asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '刚刚'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
