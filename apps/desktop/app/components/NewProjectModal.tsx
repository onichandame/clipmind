import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X, Film, Lightbulb, MessageCircle } from "lucide-react";
import { env } from "../env";
import { authFetch } from "../lib/auth";

type Mode = 'material' | 'idea' | 'freechat';

const MODES: Array<{ id: Mode; title: string; subtitle: string; icon: any; tone: string }> = [
  { id: 'material', title: '素材驱动', subtitle: '我有素材，让 AI 帮我分析怎么剪',           icon: Film,          tone: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'idea',     title: '想法驱动', subtitle: '我有想法，让 AI 帮我规划拍摄大纲',          icon: Lightbulb,     tone: 'text-indigo-600 dark:text-indigo-400' },
  { id: 'freechat', title: '自由对话', subtitle: '不预设流程，先和 AI 探讨思路',              icon: MessageCircle, tone: 'text-amber-600 dark:text-amber-400' },
];

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<Mode | null>(null);

  const createWithMode = async (mode: Mode) => {
    if (creating) return;
    setCreating(mode);
    try {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowMode: mode }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      const { id } = await res.json();
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${id}`);
      onClose();
    } catch (e) {
      console.error('[NewProject] failed:', e);
      setCreating(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-zinc-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">选择创作起点</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 pb-6 grid gap-3">
          {MODES.map(({ id, title, subtitle, icon: Icon, tone }) => (
            <button
              key={id}
              onClick={() => createWithMode(id)}
              disabled={!!creating}
              className="flex items-start gap-4 text-left rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-indigo-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-all disabled:opacity-60"
            >
              <Icon className={`w-6 h-6 mt-0.5 ${tone} flex-shrink-0`} />
              <div className="flex-1">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</div>
              </div>
              {creating === id && <span className="text-xs text-zinc-500">创建中…</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
