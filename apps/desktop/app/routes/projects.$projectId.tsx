import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { Loader2 } from "lucide-react";
import { env } from '../env';
import { useEffect } from "react";
import { useCanvasStore } from "../store/useCanvasStore";

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const setRetrievedClips = useCanvasStore((s) => s.setRetrievedClips);

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to load project details');
      return res.json();
    },
    enabled: !!projectId,
  });

  // [Arch] 军规防线：Hook 必须位于任何 conditional return (如 isLoading 拦截) 之前！
  // 读链路水合：直接从项目实体中提取独立的业务资产，彻底抛弃脆弱的历史消息回溯
  useEffect(() => {
    if (projectId && data?.project) {
      setRetrievedClips(projectId, (data.project as any).retrievedClips || []);
    }
  }, [projectId, data?.project, setRetrievedClips]);

  if (isLoading) return <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 transition-colors"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (error || !data?.project) return <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950 text-red-500 font-bold transition-colors">项目不存在</div>;

  return <WorkspaceLayout project={data.project} outline={data.outline} initialMessages={data.initialMessages} />;
}
