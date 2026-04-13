import { useState, useEffect } from "react";
import { useRevalidator, useLoaderData } from "react-router";
import { Film, CheckCircle2, Clock, AlertCircle, Activity, UploadCloud } from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 资产数据的 TypeScript 定义，需与后端 Drizzle Schema 对应
interface Asset {
  id: string;
  filename: string;
  objectKey: string;
  fileSize: number;
  status: 'ready' | 'processing' | 'error';
  createdAt: string;
}

// React Router v7 客户端加载器：负责从 Hono 后端获取真实资产列表
export async function clientLoader() {
  const res = await fetch('http://localhost:8787/api/assets');
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

  // 全局挂载来自 Rust 的进度流监听器
  useEffect(() => {
    let unlisten: () => void;
    listen<{ id: string, progress: number }>('upload-progress', (event) => {
      updateJob(event.payload.id, { progress: event.payload.progress });
    }).then(f => { unlisten = f; });
    return () => { if (unlisten) unlisten(); };
  }, []);

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

  const processJob = async (job: UploadJob) => {
    try {
      updateJob(job.id, { status: 'compressing', progress: 0 });
      // 生成本地临时输出路径
      const videoOut = `${job.sourcePath}.min.mp4`;
      const audioOut = `${job.sourcePath}.audio.aac`;

      // 阶段 1：交由 Rust 层挂载的 FFmpeg Sidecar 极速处理
      await invoke('process_asset', { input: job.sourcePath, outputVideo: videoOut, outputAudio: audioOut });

      updateJob(job.id, { status: 'uploading', progress: 0 });
      // 阶段 2：获取云端并发签发 URL (指定当前运行的 Hono 后端端口)
      const tokenRes = await fetch('http://localhost:8787/api/upload-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: job.filename }) // 架构升级：资产作为顶级实体，彻底移除 projectId
      });
      const { videoUploadUrl, audioUploadUrl, videoObjectKey } = await tokenRes.json();

      // 阶段 3：移交 Rust 底层引擎直传，彻底绕开 WebKit CORS 限制与内存序列化损耗
      const uploadTrack = async (localPath: string, url: string, type: string) => {
        await invoke('upload_asset', { jobId: job.id, path: localPath, url: url, contentType: type });
      };

      // 音视频双轨并发直传
      await Promise.all([
        uploadTrack(videoOut, videoUploadUrl, 'video/mp4'),
        uploadTrack(audioOut, audioUploadUrl, 'audio/aac')
      ]);

      // 阶段 4：核心闭环 - 跨域通知 Hono 后端将资产写入 Drizzle/Neon 数据库
      console.log(`[Stage 4: 闭环落盘] 通知 Node Server 记录资产数据...`);
      const callbackRes = await fetch('http://localhost:8787/api/oss-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: job.filename,
          objectKey: videoObjectKey // 💡 核心修复：将钥匙交还给后端以通过 400 校验
        })
      });

      if (!callbackRes.ok) {
        console.warn("落盘警告: 文件已上传 OSS，但后端数据库记录失败！");
      }

      updateJob(job.id, { status: 'ready', progress: 100 });
      revalidator.revalidate(); // 触发 React Router loader 重新拉取数据库最新列表
    } catch (error: any) {
      updateJob(job.id, { status: 'error' });
      console.error("处理管道异常中断:", error);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-sans">
      <div className="flex items-center justify-between mb-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">全部素材 (Assets)</h1>
        <button
          onClick={handleSelectFiles}
          className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md transition-colors shadow-lg shadow-indigo-500/20"
        >
          <UploadCloud className="w-4 h-4 mr-2" /> 批量导入并极速压缩
        </button>
      </div>

      <div className="max-w-7xl mx-auto">

        {/* 极速上传并发管道 Pipeline UI */}
        {jobs.length > 0 && (
          <div className="mb-8 p-4 bg-zinc-900/50 border border-zinc-800/80 rounded-xl space-y-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" /> 并发处理管道
            </h2>
            {jobs.map(job => (
              <div key={job.id} className="flex items-center gap-4 bg-zinc-950 p-3 rounded-lg border border-zinc-800/50">
                <div className="flex-1 truncate text-sm text-zinc-300">{job.filename}</div>
                <div className="flex-[2] flex items-center gap-3 text-xs">
                  <span className={`w-20 font-medium ${job.status === 'compressing' ? 'text-amber-400 animate-pulse' : job.status === 'uploading' ? 'text-blue-400' : job.status === 'ready' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {job.status === 'queued' && '等待中...'}
                    {job.status === 'compressing' && '⚙️ 极速处理中'}
                    {job.status === 'uploading' && `☁️ 直传云端 ${job.progress}%`}
                    {job.status === 'ready' && '✅ 资产已就绪'}
                    {job.status === 'error' && '❌ 处理失败'}
                  </span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
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
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-800 rounded-xl text-zinc-500">
            <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>
            <p>还没有上传任何素材。点击右上角开始沉淀你的视频底座。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {assets.map((asset) => (
              <div key={asset.id} className="group bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-all duration-200">
                <div className="aspect-video bg-zinc-800 relative flex items-center justify-center overflow-hidden">
                  <Film className="w-8 h-8 text-zinc-600 group-hover:scale-110 transition-transform duration-300" />
                  <div className="absolute top-2 right-2">
                    {asset.status === 'ready' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 backdrop-blur-sm">
                        <CheckCircle2 className="w-3 h-3" /> 已就绪
                      </span>
                    ) : asset.status === 'error' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 backdrop-blur-sm">
                        <AlertCircle className="w-3 h-3" /> 解析失败
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 backdrop-blur-sm">
                        <Clock className="w-3 h-3 animate-pulse" /> 解析中
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-zinc-200 truncate" title={asset.filename}>{asset.filename}</h3>
                  <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                    {/* 确保字段名与 Drizzle 返回的一致 */}
                    <span>{((asset.fileSize || 0) / (1024 * 1024)).toFixed(2)} MB</span>
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
