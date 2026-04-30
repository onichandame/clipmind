import { Link, useLocation, useNavigate } from "react-router";
import { Moon, Sun, LogOut, Sparkles, Film, Lightbulb, MessageCircle, History, Pin, PinOff, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { logout, getCachedUser, authFetch, type AuthUser } from "../lib/auth";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { env } from "../env";

type Mode = 'material' | 'idea' | 'freechat';

interface ProjectListItem {
  id: string;
  title: string;
  workflowMode?: Mode | null;
  updatedAt: string;
  pinnedAt?: string | null;
}

interface ProjectsPage {
  projects: ProjectListItem[];
  nextOffset: number | null;
}

const MODE_ICON: Record<Mode, any> = {
  material: Film,
  idea: Lightbulb,
  freechat: MessageCircle,
};

const PAGE_SIZE = 20;

function ProjectRow({ p, isActive, onClick }: { p: ProjectListItem; isActive: boolean; onClick: () => void }) {
  const Icon = (p.workflowMode && MODE_ICON[p.workflowMode]) || MessageCircle;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left cursor-pointer transition-colors ${
        isActive
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
      }`}
      title={p.title}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
      <span className="text-[13px] truncate min-w-0 flex-1">{p.title || '未命名'}</span>
      <RowMenu projectId={p.id} title={p.title} isActive={isActive} pinned={!!p.pinnedAt} />
    </div>
  );
}

function RowMenu({ projectId, title, isActive, pinned }: { projectId: string; title: string; isActive: boolean; pinned: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    // Sidebar's history list is its own scroll container; close on any scroll so
    // the fixed-position menu doesn't drift away from the trigger.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (isActive) navigate('/', { replace: true });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) throw new Error('Failed to update pin state');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.right - 144 });
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        className={`flex-shrink-0 p-1 rounded-md cursor-pointer text-zinc-400 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700/60 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors ${
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
        title="更多"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="w-36 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-50 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              pinMutation.mutate(!pinned);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm cursor-pointer text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            <span>{pinned ? '取消置顶' : '置顶'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm cursor-pointer text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除</span>
          </button>
        </div>,
        document.body,
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          title="确认删除项目？"
          description={`确定要删除项目"${title || '未命名'}"吗？此操作不可恢复。`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            deleteMutation.mutate();
          }}
        />
      )}
    </>
  );
}

function PinnedList({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['projects', 'pinned'],
    queryFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects?pinned=true`);
      if (!res.ok) throw new Error('Network error');
      return (await res.json()) as { projects: ProjectListItem[] };
    },
  });

  const items = data?.projects ?? [];
  if (isLoading || items.length === 0) return null;

  return (
    <div className="flex flex-col flex-shrink-0">
      <div className="px-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
        <Pin className="w-3 h-3" />
        置顶项目
      </div>
      <div className="flex flex-col gap-0.5 mb-3">
        {items.map((p) => (
          <ProjectRow key={p.id} p={p} isActive={p.id === activeId} onClick={() => onSelect(p.id)} />
        ))}
      </div>
    </div>
  );
}

function HistoryList({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string) => void }) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['projects', 'history'],
    queryFn: async ({ pageParam }) => {
      const res = await authFetch(
        `${env.VITE_API_BASE_URL}/api/projects?pinned=false&limit=${PAGE_SIZE}&offset=${pageParam}`,
      );
      if (!res.ok) throw new Error('Network error');
      return (await res.json()) as ProjectsPage;
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '120px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = data?.pages.flatMap((p) => p.projects) ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
        <History className="w-3 h-3" />
        历史项目
      </div>
      <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
        {isLoading && (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 px-3 py-2">加载中…</div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 px-3 py-2">暂无项目</div>
        )}
        {items.map((p) => (
          <ProjectRow key={p.id} p={p} isActive={p.id === activeId} onClick={() => onSelect(p.id)} />
        ))}
        <div ref={sentinelRef} className="h-4 flex-shrink-0" />
        {isFetchingNextPage && (
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500 px-3 py-1">加载更多…</div>
        )}
      </div>
    </div>
  );
}

export function GlobalSidebar({
  onCollapse,
  onExpand,
  collapsed = false,
}: {
  onCollapse?: () => void;
  onExpand?: () => void;
  collapsed?: boolean;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    setUser(getCachedUser());
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    const willBeDark = !root.classList.contains("dark");
    if (willBeDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    setIsDark(willBeDark);
  };

  const displayName = user?.email ? user.email.split('@')[0] : 'Creator';

  const activeId = location.pathname.startsWith('/projects/')
    ? location.pathname.split('/')[2]
    : null;

  const handleSelect = (id: string) => navigate(`/projects/${id}`);

  if (collapsed) {
    return (
      <aside className="w-full h-full overflow-hidden bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col items-center py-5 gap-3 z-50 transition-colors duration-200">
        {/* Expand button */}
        {onExpand && (
          <button
            onClick={onExpand}
            className="p-2 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            title="展开侧边栏"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* Home button */}
        <Link
          to="/"
          className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
          title="回到主页"
        >
          <Sparkles className="w-5 h-5" />
        </Link>

        <div className="flex-1" />

        {/* Bottom: theme toggle + logout */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          title={isDark ? "切换至浅色模式" : "切换至深色模式"}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button
          onClick={handleLogout}
          className="p-2 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-rose-500 transition-colors"
          title="退出登录"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full overflow-hidden bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col py-5 px-4 gap-5 z-50 transition-colors duration-200">
      {/* Brand wordmark */}
      <div className="flex items-center gap-2 px-1 min-w-0">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-[0_0_12px_rgba(109,93,251,0.3)] flex-shrink-0"
          style={{ backgroundColor: '#6D5DFB' }}
        >
          C
        </div>
        <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate flex-1">ClipMind</span>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="flex-shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="折叠侧边栏"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Feature card */}
      <Link to="/" className="block">
        <div className="rounded-2xl p-3 bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight truncate">{displayName}</div>
              <div className="text-[11px] text-white/80 leading-tight mt-0.5">Clipmind Studio</div>
            </div>
          </div>
        </div>
      </Link>

      {/* Pinned + History */}
      <div className="flex-1 min-h-0 flex flex-col">
        <PinnedList activeId={activeId} onSelect={handleSelect} />
        <HistoryList activeId={activeId} onSelect={handleSelect} />
      </div>

      {/* Bottom Actions */}
      <div className="flex items-center gap-1 px-1 pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          title={isDark ? "切换至浅色模式" : "切换至深色模式"}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{isDark ? '浅色' : '深色'}</span>
        </button>
        <button
          onClick={handleLogout}
          className="ml-auto rounded-lg p-1.5 cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-rose-500 transition-colors"
          title="退出登录"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
