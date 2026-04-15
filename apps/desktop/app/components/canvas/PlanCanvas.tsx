import { useCanvasStore } from "../../store/useCanvasStore";
import { EditingPlanCard } from "../EditingPlanCard";

interface PlanCanvasProps {
  projectId: string;
}

export function PlanCanvas({ projectId }: PlanCanvasProps) {
  const editingPlan = useCanvasStore((state) => state.projects[projectId]?.editingPlan);

  if (!editingPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4">
        <div className="text-4xl">📋</div>
        <p className="text-sm">暂无剪辑方案，请在左侧向 ClipMind 提出需求</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-8 bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        <EditingPlanCard plan={editingPlan} />
      </div>
    </div>
  );
}
