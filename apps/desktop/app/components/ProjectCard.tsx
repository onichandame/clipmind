import { useNavigate } from "react-router";
import { Trash2, ShoppingBasket } from "lucide-react";
import { IconButton } from "./IconButton";

type Project = {
  id: string;
  title: string;
  updatedAt: Date | string;
  basketCount: number;
};

export function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void; }) {
  const navigate = useNavigate();
  return (
    <div 
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group relative bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition-all hover:bg-zinc-900 overflow-hidden cursor-pointer"
    >
      <div className="flex justify-between items-start mb-4">
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
          编辑中
        </span>
        <IconButton
          icon={Trash2}
          onClick={(e) => {
            e.preventDefault(); 
            e.stopPropagation(); 
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 hover:text-red-400"
        />
      </div>

      <h4 className="text-lg font-bold text-zinc-200 group-hover:text-white truncate mb-2">
        {project.title || "未命名项目"}
      </h4>
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <span className="flex items-center gap-1">
          <ShoppingBasket size={14} />
          {project.basketCount} 段素材
        </span>
        <span>•</span>
        <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}