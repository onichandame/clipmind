import { env } from '../env';
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Clock,
  LayoutGrid,
  ShoppingBasket,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import { ProjectCard } from "../components/ProjectCard";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { IconButton } from "../components/IconButton";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // [端云水合]: 通过 React Query 直连 Hono 后端
  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects`);
      if (!res.ok) throw new Error('Network response was not ok');
      return res.json();
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects`, { method: 'POST' });
      if (!res.ok) throw new Error('Network error');
      return res.json();
    },
    onSuccess: (newData) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${newData.id}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${env.VITE_API_BASE_URL}/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Network error');
      return res.json();
    },
    onSuccess: () => {
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  });

  const allProjects: any[] = data?.projects || [];
  const recentProjects = allProjects.slice(0, 3);
  const isCreating = createMutation.isPending;

  const confirmDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  if (allProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200">
        <div className="w-24 h-24 mb-6 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center border border-zinc-200 dark:border-zinc-800 shadow-sm dark:shadow-none">
          <Sparkles className="w-10 h-10 text-zinc-400 dark:text-zinc-500" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">你的第一个视频大纲，从这里开始</h2>
        <p className="text-zinc-500 max-w-md mb-8">
          告诉 AI 你的创作灵感，我们将为你自动生成大纲并匹配库中的高光素材。
        </p>
        <button
          onClick={() => createMutation.mutate()}
          disabled={isCreating}
          className="px-8 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 rounded-lg font-bold hover:bg-zinc-800 dark:hover:bg-white transition-all disabled:opacity-50 cursor-pointer"
        >
          {isCreating ? "正在创建..." : "+ 开始首次创作"}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200">
      <header className="flex items-center justify-between px-8 py-10 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">工作台</h1>
          <p className="text-zinc-500 mt-1">早安，创作者。</p>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={isCreating}
          className="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 text-zinc-950 rounded-lg font-bold hover:bg-white transition-all shadow-lg shadow-zinc-950/20 cursor-pointer"
        >
          <Plus size={20} />
          <span>{isCreating ? "正在创建..." : "新建项目"}</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-8 pb-12 space-y-12">
        {/* Recent Section - 使用重构后的 ProjectCard 组件 */}
        {recentProjects.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock size={14} />
              最近打开
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {recentProjects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onDelete={() => setDeleteId(p.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* All Projects Section - 优化表格整行点击 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              <LayoutGrid size={14} />
              全部项目
            </h3>
          </div>
          <div className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none transition-colors">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 uppercase transition-colors">
                  <th className="px-6 py-4 font-semibold">项目名称</th>
                  <th className="px-6 py-4 font-semibold text-center">素材篮</th>
                  <th className="px-6 py-4 font-semibold">更新时间</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50 transition-colors">
                {allProjects.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="group hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 font-bold text-zinc-900 dark:text-zinc-200 dark:group-hover:text-white transition-colors">
                      {p.title}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-1.5 text-zinc-500 transition-colors">
                        <ShoppingBasket size={14} className={p.basketCount > 0 ? "text-zinc-800 dark:text-zinc-300" : ""} />
                        <span className="text-sm">{p.basketCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-500 transition-colors">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <IconButton
                        icon={Trash2}
                        onClick={(e) => {
                          e.stopPropagation(); // 阻止冒泡，防止触发 tr 的跳转
                          setDeleteId(p.id);
                        }}
                        className="text-zinc-600 hover:text-red-400"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <DeleteConfirmModal
          onCancel={() => setDeleteId(null)}
          onConfirm={() => confirmDelete(deleteId)}
        />
      )}
    </div>
  );
}
