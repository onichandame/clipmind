import { useEffect, useState, useRef } from "react";
import { env } from '../env';
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Menu, ShoppingBasket, ChevronDown, ChevronRight, Film, CheckCircle2, AlertCircle, Activity, Clock } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "./Button";
import { PlanCanvas } from "./canvas/PlanCanvas";
import { AccordionSection } from "./AccordionSection";

type CanvasMode = "outline" | "footage" | "plan";

interface OutlineData {
  contentMd: string;
  version: number;
}

interface CanvasPanelProps {
  projectId: string;
  projectTitle: string;
  outline: OutlineData | null;
  onToggleBasket: () => void;
}

const modeLabels: Record<CanvasMode, string> = {
  outline: "📝 策划大纲",
  footage: "🎬 素材检索",
  plan: "📋 剪辑方案",
};


export function CanvasPanel({ projectId, projectTitle, outline, onToggleBasket }: CanvasPanelProps) {
  const { activeMode, setActiveMode, setOutlineContent, activePanelId, setActivePanelId } = useCanvasStore();
  const outlineContent = useCanvasStore((s) => s.projects[projectId]?.outlineContent || "");

  const queryClient = useQueryClient();
  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    // [Arch] 补齐订阅者 queryFn 以消灭 WebKit 控制台报错
    queryFn: async () => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60 // 缓存一分钟，避免高频重刷
  });
  const workflowMode = projectData?.project?.workflowMode;

  // 引入 Zustand 乐观状态，确保在 AI 流式生成期间能够立刻捕获到数据变化 (防变量重名加前缀)
  const optClips = useCanvasStore((s) => s.projects[projectId]?.retrievedClips || []);
  const optPlans = useCanvasStore((s) => s.projects[projectId]?.editingPlans || []);

  // [Arch] SSOT 瞬态 UI 路由：结合 React Query (Server) 和 Zustand (Client) 进行多维比对
  const prevProjectRef = useRef<any>(null);
  const prevOutlineRef = useRef<string | null>(null);
  const prevClipsLenRef = useRef<number>(optClips.length);
  const prevPlansLenRef = useRef<number>(optPlans.length);

  useEffect(() => {
    const currProject = projectData?.project;
    const prevProject = prevProjectRef.current;

    // 【Arch Probe】素材雷达深度探针
    console.log("【Arch Probe】素材雷达触发", {
      optClipsLen: optClips?.length,
      prevOptClipsLen: prevClipsLenRef.current,
      serverIdsStr: JSON.stringify(currProject?.retrievedAssetIds),
      prevServerIdsStr: JSON.stringify(prevProject?.retrievedAssetIds),
      isOptFootageChanged: optClips?.length !== prevClipsLenRef.current
    });

    const currentOutlineText = outline?.contentMd || outlineContent || "";
    const prevOutlineText = prevOutlineRef.current;

    let nextPanel = null;

    // 1. 优先比对大纲 (独立字段与来源)
    if (prevOutlineText !== null && currentOutlineText !== prevOutlineText) {
      nextPanel = 'outline';
    }

    // 2. 比对素材 (Footage) - 融合 Zustand 乐观状态与 React Query 缓存
    const isOptFootageChanged = optClips.length !== prevClipsLenRef.current;
    const isServerFootageChanged = currProject && prevProject && (
      JSON.stringify(currProject.retrievedAssetIds) !== JSON.stringify(prevProject.retrievedAssetIds) ||
      (currProject.retrievedClips?.length || 0) !== (prevProject.retrievedClips?.length || 0)
    );

    if (isOptFootageChanged || isServerFootageChanged) {
      nextPanel = 'footage';
    }

    // 3. 比对剪辑方案 (Plan) - 融合双端状态
    const isOptPlanChanged = optPlans.length !== prevPlansLenRef.current;
    const isServerPlanChanged = currProject && prevProject && JSON.stringify(currProject.editingPlans) !== JSON.stringify(prevProject.editingPlans);

    if (isOptPlanChanged || isServerPlanChanged) {
      nextPanel = 'plan';
    }

    // 4. 执行焦点偏移
    if (nextPanel) {
      setActivePanelId(nextPanel);
    }

    // 5. 更新所有历史快照
    prevOutlineRef.current = currentOutlineText;
    prevClipsLenRef.current = optClips.length;
    prevPlansLenRef.current = optPlans.length;

    if (currProject) {
      prevProjectRef.current = JSON.parse(JSON.stringify(currProject));
    }
  }, [
    outline, outlineContent, projectData?.project, setActivePanelId,
    optClips.length, optPlans.length
  ]);

  const updateModeMutation = useMutation({
    mutationFn: async (mode: string) => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowMode: mode })
      });
      if (!res.ok) throw new Error('Failed to update mode');
      return res.json();
    },
    onSuccess: (_, variables) => {
      // [Arch] 悲观更新：网络请求成功后手动写入缓存，避免触发无 queryFn 的 invalidate 崩溃
      queryClient.setQueryData(['project', projectId], (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          project: { ...oldData.project, workflowMode: variables }
        };
      });
    }
  });
  const retrievedClips = useCanvasStore((s) => s.projects[projectId]?.retrievedClips || []);

  // 全局上传状态机对接
  const jobs = useCanvasStore(s => s.uploadJobs);
  const setJobs = useCanvasStore(s => s.setUploadJobs);
  const updateJob = useCanvasStore(s => s.updateUploadJob);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 获取全局素材库素材
  const { data: allAssets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/assets`);
      if (!res.ok) throw new Error('Failed to fetch assets');
      return res.json();
    }
  });

  const processJob = async (job: any) => {
    try {
      updateJob(job.id, { status: 'compressing', progress: 0 });
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('process_video_asset', {
        jobId: job.id,
        filename: job.filename,
        localPath: job.sourcePath,
        serverUrl: env.VITE_API_BASE_URL
      });
    } catch (error) {
      console.error(`处理任务 ${job.id} 失败:`, error);
      updateJob(job.id, { status: 'error' });
    }
  };

  // 监听上传与压缩进度
  useEffect(() => {
    let unlistenUpload: () => void;
    let unlistenFFmpeg: () => void;

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ id: string, progress: number }>('upload-progress', (event) => {
        const isComplete = event.payload.progress >= 100;
        if (isComplete) {
          queryClient.invalidateQueries({ queryKey: ['assets'] }); // 触发全局素材库刷新
        }
        setJobs(current => current.map(j =>
          j.id === event.payload.id
            ? { ...j, progress: event.payload.progress, status: isComplete ? 'ready' : j.status }
            : j
        ));
      }).then(fn => unlistenUpload = fn);

      listen<{ log: string }>('ffmpeg-progress', (event) => {
        setJobs(current => current.map(j =>
          (j.status === 'compressing' && j.progress < 90) ? { ...j, progress: j.progress + 2 } : j
        ));
      }).then(fn => unlistenFFmpeg = fn);
    });

    return () => {
      if (unlistenUpload) unlistenUpload();
      if (unlistenFFmpeg) unlistenFFmpeg();
    };
  }, [queryClient, setJobs]);

  // 视觉闭环：3秒后自动隐藏已全部完成的上传队列
  useEffect(() => {
    if (jobs.length === 0) return;
    const allDone = jobs.every(j => j.status === 'ready' || j.status === 'error');
    if (allDone) {
      const timer = setTimeout(() => {
        setJobs(current => {
          if (current.every(j => j.status === 'ready' || j.status === 'error')) return [];
          return current;
        });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [jobs, setJobs]);

  // 交互函数：局部唤起上传
  const handleSelectFiles = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: true, filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'MP4', 'MOV'] }] });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];

    const newJobs = paths.map(p => ({
      id: crypto.randomUUID(),
      filename: p.split(/[\\/]/).pop() || 'video.mp4',
      sourcePath: p,
      status: 'queued' as const,
      progress: 0
    }));

    setJobs(prev => [...prev, ...newJobs]);
    newJobs.forEach(processJob); // 发射！独立进入状态机，互不阻塞
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
      }),
    ],
    content: outline?.contentMd || "",
    // ADR 6.3: 防止 SSR 水合报错
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // FIX: 移除强绑定的 prose-invert，改为 dark:prose-invert 让 @tailwindcss/typography 支持双态
        class: "prose prose-zinc dark:prose-invert max-w-none focus:outline-none transition-colors duration-200",
      },
    },
    onUpdate: ({ editor }) => {
      // 获取 Markdown 并标记为用户修改
      const md = editor.storage.markdown.getMarkdown();
      setOutlineContent(projectId, md, "user");
    },
  });

  // 当外部数据（如 AI 生成）更新时，同步编辑器内容
  useEffect(() => {
    if (!editor) return;
    // 架构师干预：优先渲染实时流灌入的 outlineContent，彻底消除 Loader 延迟带来的白屏
    const targetContent = outlineContent || outline?.contentMd || "";
    const currentContent = editor.storage.markdown.getMarkdown();

    // 只要有差异（包括切换到空项目时 targetContent 为空），就强制同步并清空脏状态
    if (currentContent !== targetContent) {
      // 防止高频流式更新导致的光标丢失：仅在未聚焦时执行全量覆盖
      if (!editor.isFocused) {
        editor.commands.setContent(targetContent);
      }
      if (!outlineContent) setOutlineContent(projectId, targetContent, "system");
    }
  }, [outline?.contentMd, outlineContent, editor, setOutlineContent, projectId]);

  if (!workflowMode) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F7F6F1] dark:bg-zinc-950 p-8 transition-colors duration-200">
        <div className="w-full max-w-2xl bg-[#F4F3ED] dark:bg-zinc-900 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-6">选择起点</h2>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => updateModeMutation.mutate('material')} disabled={updateModeMutation.isPending} className="cursor-pointer bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200/60 dark:border-zinc-700 text-left hover:shadow-md hover:border-indigo-500 hover:-translate-y-1 transition-all group flex flex-col h-36 justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              <div className="w-10 h-10 bg-[#E8F3EE] dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mb-4"><svg className="w-5 h-5 text-[#2B7A61]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>
              <div className="font-bold text-zinc-900 dark:text-zinc-100 text-[15px] mb-1.5">我有素材</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">上传素材，AI 帮你分析怎么剪</div>
            </button>
            <button onClick={() => updateModeMutation.mutate('idea')} disabled={updateModeMutation.isPending} className="cursor-pointer bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200/60 dark:border-zinc-700 text-left hover:shadow-md hover:border-indigo-500 hover:-translate-y-1 transition-all group flex flex-col h-36 justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              <div className="w-10 h-10 bg-[#EEF3FB] dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4"><svg className="w-5 h-5 text-[#3769B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg></div>
              <div className="font-bold text-zinc-900 dark:text-zinc-100 text-[15px] mb-1.5">我有想法</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">从热点出发，AI 帮你规划怎么拍</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200">
      {/* 顶部状态栏 */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center justify-between px-6 bg-white/80 dark:bg-zinc-900/20 backdrop-blur-md transition-colors duration-200">

        {/* 左侧：空占位 (保持 flex-1 对称张力，确保中间组件视图切换器绝对居中) */}
        <div className="flex-1 flex items-center min-w-0 pr-4">
        </div>

        {/* 中间：工作流指示器 (取代旧版 Tab，保持布局张力) */}
        <div className="flex items-center gap-3 justify-center">
          <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-3 py-1 rounded-full">
            {workflowMode === 'material' ? '🎬 素材驱动工作流' : workflowMode === 'idea' ? '💡 想法驱动工作流' : ''}
          </span>
        </div>

        {/* 右侧：操作区 (与左侧 flex-1 对称以保证中部绝对居中) */}
        <div className="flex-1 flex items-center justify-end gap-2">

          {/* 窄屏态：汉堡菜单唤起按钮 */}
          <div className="lg:hidden relative">
            <Button variant="secondary" size="sm" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="px-2">
              <Menu size={18} />
            </Button>
          </div>
        </div>
      </div>

      {/* 窄屏态：汉堡下拉菜单 */}
      {isMobileMenuOpen && (
        <div className="absolute top-14 left-0 w-full bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800/50 z-40 flex flex-col p-4 shadow-xl lg:hidden gap-5 animate-in slide-in-from-top-2">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">切换视图</span>
            <div className="grid grid-cols-1 gap-2">
              {(["outline", "footage", "plan"] as CanvasMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={activeMode === mode ? "primary" : "secondary"}
                  size="md"
                  fullWidth
                  onClick={() => {
                    setActiveMode(mode);
                    setIsMobileMenuOpen(false);
                  }}
                >
                  {modeLabels[mode]}
                </Button>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* 主画布区：手风琴任务流 */}
      <div className="flex-1 overflow-y-auto w-full p-6 lg:p-10 bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-4xl mx-auto flex flex-col">
          {/* 根据 workflowMode 动态排列节点顺序 */}
          {(workflowMode === 'idea' ? ['outline', 'footage', 'plan'] : ['footage', 'outline', 'plan']).map((nodeType) => {
            if (nodeType === 'outline') {
              return (
                <AccordionSection key="outline" id="outline" title="📝 策划大纲" activeId={activePanelId} setActiveId={setActivePanelId}>
                  {(outline || outlineContent) ? (
                    <div className="w-full pb-10">
                      <EditorContent editor={editor} />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 mb-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/20 shadow-sm">
                        <svg className="w-8 h-8 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">等待灵感降临...</h3>
                      <p className="text-zinc-500 dark:text-zinc-400 text-sm">在左侧告诉我想做什么，我会为你生成结构化的视频大纲</p>
                    </div>
                  )}
                </AccordionSection>
              );
            }
            if (nodeType === 'footage') {
              const focusedIds = projectData?.project?.retrievedAssetIds || [];
              const selectedIds = projectData?.project?.selectedAssetIds || [];
              const isFocusing = focusedIds.length > 0;

              // [Arch] 精挑素材 Toggle 逻辑 (乐观更新)
              const handleToggleSelection = async (assetId: string) => {
                const currentSelected = projectData?.project?.selectedAssetIds || [];
                const isSelected = currentSelected.includes(assetId);
                const nextSelected = isSelected
                  ? currentSelected.filter((id: string) => id !== assetId)
                  : [...currentSelected, assetId];

                // 乐观更新缓存
                queryClient.setQueryData(['project', projectId], (old: any) =>
                  old ? { ...old, project: { ...old.project, selectedAssetIds: nextSelected } } : old
                );

                try {
                  await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ selectedAssetIds: nextSelected })
                  });
                } catch (e) {
                  console.error("同步精挑状态失败:", e);
                }
              };

              return (
                <AccordionSection key="footage" id="footage" title="🎬 挑选素材" activeId={activePanelId} setActiveId={setActivePanelId}>
                  <div className="flex flex-col gap-4 max-h-[65vh] overflow-y-auto pr-2 pb-4 pt-1">

                    {/* 0. 极速上传并发管道 Pipeline UI */}
                    {jobs.length > 0 && (
                      <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/80 rounded-xl space-y-3 transition-colors">
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

                    {/* 1. 聚光灯模式提示条 (彻底提炼出网格，置于顶部) */}
                    {isFocusing && (
                      <div className="flex items-center justify-between bg-indigo-50/80 dark:bg-indigo-500/10 px-4 py-2.5 rounded-xl border border-indigo-100 dark:border-indigo-500/20 shadow-sm transition-all duration-300">
                        <span className="text-xs text-indigo-700 dark:text-indigo-300 font-medium flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          AI 已为您聚焦 {focusedIds.length} 个相关素材
                        </span>
                        <button
                          onClick={() => queryClient.setQueryData(['project', projectId], (old: any) => old ? { ...old, project: { ...old.project, retrievedAssetIds: [] } } : old)}
                          className="text-[10px] px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-indigo-200 dark:border-indigo-500/30 rounded shadow-sm hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors text-indigo-600 dark:text-indigo-300"
                        >
                          显示全量
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">

                      {/* 2. 上传入口卡片 (高度对齐策略：设置外层与普通卡片等高的边框包裹结构，内层绝对定位居中) */}
                      <div
                        onClick={handleSelectFiles}
                        className="group relative rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 cursor-pointer transition-all bg-zinc-50 dark:bg-zinc-900/50 order-first overflow-hidden"
                      >
                        {/* 强行撑开与普通卡片相同的高度 (aspect-video + 底部p-3文本区高度约36px) */}
                        <div className="aspect-video w-full" />
                        <div className="h-[36px] w-full border-t border-transparent" />

                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                          </div>
                          <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">上传素材</span>
                        </div>
                      </div>

                      {/* 3. 资产卡片渲染列表 (全量展示 + 逻辑置灰 + 精挑交互) */}
                      {allAssets.map((asset: any) => {
                        const isFocused = !isFocusing || focusedIds.includes(asset.id);
                        const isSelected = selectedIds.includes(asset.id);

                        return (
                          <div
                            key={asset.id}
                            onClick={() => handleToggleSelection(asset.id)}
                            className={`group cursor-pointer bg-white dark:bg-zinc-900 border rounded-xl overflow-hidden transition-all duration-300 shadow-sm dark:shadow-none relative
                                  ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20 z-10' : isFocused ? 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700' : 'border-zinc-100 dark:border-zinc-800/50 grayscale opacity-40 hover:opacity-100 hover:grayscale-0'}
                                `}
                          >
                            <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center overflow-hidden transition-colors">
                              {asset.thumbnailUrl ? (
                                <img
                                  src={asset.thumbnailUrl}
                                  alt={asset.filename}
                                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                              ) : (
                                <Film className="w-7 h-7 text-zinc-400 dark:text-zinc-600" />
                              )}


                              <div className="absolute top-2 right-2 shadow-sm drop-shadow-md z-10">
                                {asset.status === 'ready' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-600/95 backdrop-blur-sm text-white border-0 shadow-md">
                                    <CheckCircle2 className="w-2.5 h-2.5" /> 已就绪
                                  </span>
                                ) : asset.status === 'error' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-red-600/95 backdrop-blur-sm text-white border-0 shadow-md">
                                    <AlertCircle className="w-2.5 h-2.5" /> 失败
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-indigo-600/95 backdrop-blur-sm text-white border-0 shadow-md">
                                    <Activity className="w-2.5 h-2.5 animate-pulse" /> 处理中
                                  </span>
                                )}
                              </div>

                              <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-white text-[9px] font-medium flex items-center gap-1 z-10">
                                <Clock className="w-2.5 h-2.5" />
                                {asset.duration ? `${Math.floor(asset.duration / 60).toString().padStart(2, '0')}:${Math.floor(asset.duration % 60).toString().padStart(2, '0')}` : '00:00'}
                              </div>

                              {isSelected && (
                                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-indigo-500 text-white text-[9px] font-bold flex items-center gap-1 z-20 shadow-lg border border-indigo-400/50 animate-in zoom-in-50">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> 已精选
                                </div>
                              )}
                            </div>

                            <div className="p-2.5 bg-white dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800/50">
                              <div className="text-[10px] font-medium text-zinc-700 dark:text-zinc-300 truncate" title={asset.filename}>
                                {asset.filename}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </AccordionSection>
              );
            }
            if (nodeType === 'plan') {
              return (
                <AccordionSection key="plan" id="plan" title="📋 剪辑方案" activeId={activePanelId} setActiveId={setActivePanelId}>
                  <PlanCanvas projectId={projectId} />
                </AccordionSection>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
