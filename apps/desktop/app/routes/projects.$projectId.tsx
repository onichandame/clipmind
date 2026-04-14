import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { Loader2 } from "lucide-react";

export default function ProjectWorkspace() {
  const { projectId } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await fetch(`http://localhost:8787/api/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to load project details');
      return res.json();
    },
    enabled: !!projectId,
  });

  if (isLoading) return <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 transition-colors"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (error || !data?.project) return <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950 text-red-500 font-bold transition-colors">项目不存在</div>;

  return <WorkspaceLayout project={data.project} outline={data.outline} initialMessages={data.initialMessages} />;
}
