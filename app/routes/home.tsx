import { db } from "../db/client";
import { projects, basketItems } from "../db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { redirect, useLoaderData, useFetcher, Link } from "react-router";
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

export async function loader() {
  // 聚合查询：获取项目信息及对应的素材篮数量
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
    // 触发 DB 级联删除 (Cascade Delete)
    await db.delete(projects).where(eq(projects.id, id));
    return { success: true };
  }

  return null;
}

export default function Home() {
  const { projects: allProjects } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
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
          className="px-8 py-3 bg-zinc-100 text-zinc-950 rounded-lg font-bold hover:bg-white transition-all disabled:opacity-50"
        >
          {isCreating ? "正在创建..." : "+ 开始首次创作"}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950">
      {/* Header Section */}
      <header className="flex items-center justify-between px-8 py-10 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">工作台</h1>
          <p className="text-zinc-500 mt-1">早安，创作者。</p>
        </div>
        <button
          onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}
          disabled={isCreating}
          className="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 text-zinc-950 rounded-lg font-bold hover:bg-white transition-all shadow-lg shadow-zinc-950/20"
        >
          <Plus size={20} />
          <span>{isCreating ? "正在创建..." : "新建项目"}</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-8 pb-12 space-y-12">
        {/* Recent Section */}
        {recentProjects.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock size={14} />
              最近打开
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {recentProjects.map((p) => (
                <div
                  key={p.id}
                  className="group relative bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-600 transition-all hover:bg-zinc-900"
                >
                   <Link to={`/projects/${p.id}`} className="absolute inset-0 z-0" />
                   <div className="flex justify-between items-start mb-4 relative z-10">
                     <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                       编辑中
                     </span>
                     <button 
                       onClick={(e) => {
                         e.preventDefault();
                         e.stopPropagation();
                         setDeleteId(p.id);
                       }}
                       className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-red-400 transition-all"
                     >
                       <Trash2 size={16} />
                     </button>
                   </div>
                   <h4 className="text-lg font-bold text-zinc-200 group-hover:text-white truncate mb-2 relative z-10">
                     {p.title || "未命名项目"}
                   </h4>
                   <div className="flex items-center gap-3 text-sm text-zinc-500 relative z-10">
                     <span className="flex items-center gap-1">
                       <ShoppingBasket size={14} />
                       {p.basketCount} 段素材
                     </span>
                     <span>•</span>
                     <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                   </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All Projects Section */}
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
                  <tr key={p.id} className="group hover:bg-zinc-900/40 transition-colors">
                    <td className="px-6 py-4">
                      <Link to={`/projects/${p.id}`} className="font-bold text-zinc-200 hover:text-white transition-colors">
                        {p.title}
                      </Link>
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
                       <button 
                        onClick={() => setDeleteId(p.id)}
                        className="p-1.5 text-zinc-600 hover:text-red-400 transition-all"
                       >
                         <Trash2 size={16} />
                       </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-zinc-100 mb-2">确认删除项目？</h3>
            <p className="text-zinc-400 mb-8">
              此操作将永久删除该项目对应的策划大纲并清空素材篮子。底层的全局素材库不会受到影响。
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2 text-zinc-400 font-bold hover:text-zinc-100 transition-all"
              >
                取消
              </button>
              <button 
                onClick={() => confirmDelete(deleteId)}
                className="flex-1 py-2 bg-red-900/50 text-red-400 border border-red-800/50 rounded-lg font-bold hover:bg-red-900 transition-all"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
