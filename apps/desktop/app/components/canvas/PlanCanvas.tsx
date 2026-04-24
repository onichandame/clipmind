import { useCanvasStore } from "../../store/useCanvasStore";
import { EditingPlanCard } from "../EditingPlanCard";

interface PlanCanvasProps {
  projectId: string;
}

export function PlanCanvas({ projectId }: PlanCanvasProps) {
  const editingPlans = useCanvasStore((state) => state.projects[projectId]?.editingPlans || []);

  if (editingPlans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4">
        <div className="text-4xl">📋</div>
        <p className="text-sm">暂无剪辑方案，请在左侧向 ClipMind 提出需求</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {editingPlans.map((plan, idx) => (
        <EditingPlanCard key={idx} plan={plan} />
      ))}
    </div>
  );
}
