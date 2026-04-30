import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, ListChecks, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { env } from "../env";
import { authFetch } from "../lib/auth";
import { useCanvasStore } from "../store/useCanvasStore";
import { EditingPlanCard } from "./EditingPlanCard";

interface OutlineData { contentMd: string; version: number; }

interface RightPanelProps {
  projectId: string;
  outline: OutlineData | null;
}

type TabId = 'outline' | 'plan';

const TABS: Array<{ id: TabId; label: string; icon: any }> = [
  { id: 'outline', label: '策划大纲', icon: Layers },
  { id: 'plan', label: '剪辑方案', icon: ListChecks },
];

export function RightPanel({ projectId, outline }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('outline');
  const setOutlineContent = useCanvasStore((s) => s.setOutlineContent);
  const outlineContent = useCanvasStore((s) => s.projects[projectId]?.outlineContent || "");
  // Chat tool calls flip the canvas activeMode (outline/plan); mirror that into the tab.
  // 'footage' is no longer a tab — it falls through to the current tab.
  const activeMode = useCanvasStore((s) => s.activeMode);
  useEffect(() => {
    if (activeMode === 'outline') setActiveTab('outline');
    else if (activeMode === 'plan') setActiveTab('plan');
  }, [activeMode]);

  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60,
  });

  const editingPlans = (projectData?.project?.editingPlans as any[]) || [];

  // Auto-route to plan tab whenever a new plan lands.
  const lastPlansLen = useCanvasStore((s) => s.projects[projectId]?.editingPlans?.length || 0);
  useEffect(() => {
    if (lastPlansLen > 0) setActiveTab('plan');
  }, [lastPlansLen]);

  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false })],
    content: outline?.contentMd || "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm prose-zinc dark:prose-invert max-w-none focus:outline-none transition-colors duration-200",
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      setOutlineContent(projectId, md, "user");
    },
  });

  useEffect(() => {
    if (!editor) return;
    const target = outlineContent || outline?.contentMd || "";
    const current = editor.storage.markdown.getMarkdown();
    if (current !== target && !editor.isFocused) {
      editor.commands.setContent(target);
      if (!outlineContent) setOutlineContent(projectId, target, "system");
    }
  }, [outline?.contentMd, outlineContent, editor, setOutlineContent, projectId]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
      {/* Tabs */}
      <div className="flex items-center border-b border-zinc-200 dark:border-zinc-800 px-3">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'outline' && (
          <div>
            {(outline || outlineContent) ? (
              <EditorContent editor={editor} />
            ) : (
              <EmptyState
                title="等待大纲生成"
                hint="在左侧聊天中告诉 AI 你的视频目标，大纲会自动写入这里。"
              />
            )}
          </div>
        )}
        {activeTab === 'plan' && (
          <PlanTab projectId={projectId} plans={editingPlans} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{title}</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">{hint}</p>
    </div>
  );
}

function PlanTab({ projectId, plans }: { projectId: string; plans: any[] }) {
  const queryClient = useQueryClient();

  const deletePlan = useMutation({
    mutationFn: async (planId: string) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}/plans/${planId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete plan');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const reorderPlans = useMutation({
    mutationFn: async (planIds: string[]) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}/plans/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planIds }),
      });
      if (!res.ok) throw new Error('Failed to reorder plans');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  if (!plans || plans.length === 0) {
    return <EmptyState title="尚无剪辑方案" hint="让 AI 为你生成剪辑方案后，多套方案的卡片会陈列在这里。" />;
  }

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= plans.length) return;
    const ids = plans.map((p) => p.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorderPlans.mutate(ids);
  };

  return (
    <div className="flex flex-col gap-8">
      {plans.map((plan: any, idx: number) => (
        <div key={plan.id || idx} className="flex flex-col gap-2">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              disabled={idx === 0 || reorderPlans.isPending}
              onClick={() => move(idx, -1)}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="上移"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={idx === plans.length - 1 || reorderPlans.isPending}
              onClick={() => move(idx, 1)}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="下移"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={deletePlan.isPending}
              onClick={() => {
                if (confirm(`确认删除剪辑方案【${plan.title || '未命名方案'}】？此操作不可撤销。`)) {
                  deletePlan.mutate(plan.id);
                }
              }}
              className="p-1.5 rounded-md text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-30 transition-colors cursor-pointer"
              title="删除剪辑方案"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <EditingPlanCard plan={plan} />
        </div>
      ))}
    </div>
  );
}
