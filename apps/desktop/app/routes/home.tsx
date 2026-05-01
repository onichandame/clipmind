import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Film, Lightbulb, MessageCircle, Send, Sparkles } from 'lucide-react';
import { env } from '../env';
import { authFetch, getCachedUser, type AuthUser } from '../lib/auth';

type Mode = 'material' | 'idea' | 'freechat';

const MODE_CARDS: Array<{ id: Mode; title: string; subtitle: string; icon: any; tone: string; bg: string; ring: string }> = [
  {
    id: 'material',
    title: '我有素材',
    subtitle: '从素材库出发，AI 帮你分析并生成剪辑方案',
    icon: Film,
    tone: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    ring: 'hover:border-emerald-300 dark:hover:border-emerald-500/40',
  },
  {
    id: 'idea',
    title: '我有想法',
    subtitle: '从灵感或热点出发，AI 帮你规划拍摄大纲',
    icon: Lightbulb,
    tone: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-500/10',
    ring: 'hover:border-indigo-300 dark:hover:border-indigo-500/40',
  },
  {
    id: 'freechat',
    title: '自由对话',
    subtitle: '不预设流程，先和 AI 探讨思路与素材',
    icon: MessageCircle,
    tone: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    ring: 'hover:border-amber-300 dark:hover:border-amber-500/40',
  },
];

export default function LandingChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setUser(getCachedUser());
  }, []);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    autoResize();
  }, [draft]);

  const createProject = useMutation({
    mutationFn: async ({ workflowMode, seedMessage }: { workflowMode: Mode; seedMessage?: string }) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowMode, seedMessage }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      return (await res.json()) as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${data.id}`);
    },
  });

  const handleCardClick = async (mode: Mode) => {
    if (creating) return;
    setCreating(true);
    try {
      await createProject.mutateAsync({ workflowMode: mode });
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      await createProject.mutateAsync({ workflowMode: 'freechat', seedMessage: text });
    } finally {
      setCreating(false);
    }
  };

  const displayName = user?.email ? user.email.split('@')[0] : 'Creator';

  return (
    <div className="h-full overflow-y-auto bg-indigo-50/40 dark:bg-zinc-950 transition-colors duration-200">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Greeting */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20 flex-shrink-0">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100 truncate">
              Hello, {displayName}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              我是 ClipMind，帮你把素材变成成片，先聊聊今天想做什么？
            </p>
          </div>
        </div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {MODE_CARDS.map(({ id, title, subtitle, icon: Icon, tone, bg, ring }) => (
            <button
              key={id}
              onClick={() => handleCardClick(id)}
              disabled={creating}
              className={`group text-left rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 cursor-pointer ${ring} hover:shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${tone}`} />
              </div>
              <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">{title}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{subtitle}</div>
            </button>
          ))}
        </div>

        {/* Free-chat input */}
        <form onSubmit={handleSubmitDraft} className="mb-12">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus-within:border-indigo-400 dark:focus-within:border-indigo-500/60 focus-within:ring-4 focus-within:ring-indigo-500/10 rounded-2xl shadow-sm transition-all p-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
                }
              }}
              rows={1}
              placeholder="或者直接说出你的想法，AI 会帮你边聊边推进…"
              disabled={creating}
              className="w-full bg-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm px-2 py-2 focus:outline-none disabled:opacity-50 resize-none overflow-y-auto leading-6"
            />
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/70">
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500 px-2">
                Enter 发送 · Shift+Enter 换行
              </div>
              <button
                type="submit"
                disabled={!draft.trim() || creating}
                className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 disabled:from-zinc-200 disabled:to-zinc-200 dark:disabled:from-zinc-800 dark:disabled:to-zinc-800 disabled:text-zinc-400 text-white shadow-sm transition-all"
                title="开启自由对话"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
