import { db } from "../db/client";
import { projects, basketItems } from "../db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { redirect, useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/home";
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

export async function loader() {
  const data = await db
    .select({
      id: projects.id,
      title: projects.title,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      basketCount: sql<number>`count(${basketItems.id})`.mapWith(Number),
    })
    .from(projects)
    .leftJoin(basketItems, eq(projects.id, basketItems.projectId))
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt));

  return { projects: data };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const id = crypto.randomUUID();
    await db.insert(projects).values({
      id,
      title: "未命名创作项目",
    });
    return redirect(`/projects/${id}`);
  }

  if (intent === "delete") {
    const id = formData.get("projectId") as string;
    await db.delete(projects).where(eq(projects.id, id));
    return { success: true };
  }

  return null;
}

export default function Home() {
  const { projects: allProjects } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const recentProjects = allProjects.slice(0, 3);
  const isCreating = fetcher.formData?.get("intent") === "create";

  const confirmDelete = (id: string) => {
    fetcher.submit({ intent: "delete", projectId: id }, { method: "post" });
    setDeleteId(null);
  };

  if (allProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-950">
        <div className="w-24 h-24 mb-6 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800">
          <Sparkles className="w-10 h-10 text-zinc-500" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-100 mb-2">你的第一个视频大纲，从这里开始</h2>
        <p className="text-zinc-500 max-w-md mb-8">
          告诉 AI 你的创作灵感，我们将为你自动生成大纲并匹配库中的高光素材。
        </p>
        <button
          onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}
          disabled={isCreating}
          className="px-8 py-3 bg-zinc-100 text-zinc-950 rounded-lg font-bold hover:bg-white transition-all disabled:opacity-50 cursor-pointer"
        >
          {isCreating ? "正在创建..." : "+ 开始首次创作"}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950">
      <header className="flex items-center justify-between px-8 py-10 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">工作台</h1>
          <p className="text-zinc-500 mt-1">早安，创作者。</p>
        </div>
        <button
          onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}
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
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase">
                  <th className="px-6 py-4 font-semibold">项目名称</th>
                  <th className="px-6 py-4 font-semibold text-center">素材篮</th>
                  <th className="px-6 py-4 font-semibold">更新时间</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {allProjects.map((p) => (
                  <tr 
                    key={p.id} 
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="group hover:bg-zinc-900/40 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 font-bold text-zinc-200 group-hover:text-white transition-colors">
                      {p.title}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-1.5 text-zinc-500">
                        <ShoppingBasket size={14} className={p.basketCount > 0 ? "text-zinc-300" : ""} />
                        <span className="text-sm">{p.basketCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-500">
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
