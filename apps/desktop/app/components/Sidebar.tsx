import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PanelLeftOpen,
  PanelLeftClose,
  Plus,
  Library,
  History,
  Pin,
  PinOff,
  MoreHorizontal,
  Trash2,
  Pencil,
  Download,
  Film,
  Lightbulb,
  MessageCircle,
  Settings,
  Moon,
  Sun,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { authFetch, logout } from '../lib/auth';
import { env } from '../env';
import { useLayoutStore } from '../store/useLayoutStore';
import { DropdownMenu, type DropdownMenuItem } from './DropdownMenu';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { toast } from './Toast';

type Mode = 'material' | 'idea' | 'freechat';
const MODE_ICON: Record<Mode, any> = { material: Film, idea: Lightbulb, freechat: MessageCircle };
const PAGE_SIZE = 20;

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

interface SidebarProps {
  hasUpdate: boolean;
  onCheckUpdate: () => void;
}

export function Sidebar({ hasUpdate, onCheckUpdate }: SidebarProps) {
  const expanded = useLayoutStore((s) => s.sidebarExpanded);
  const setExpanded = useLayoutStore((s) => s.setSidebarExpanded);
  const location = useLocation();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(false);

  const activeId = location.pathname.startsWith('/projects/') ? location.pathname.split('/')[2] : null;
  const isLibrary = location.pathname.startsWith('/library');
  const isHome = location.pathname === '/';
  const widthClass = expanded ? 'w-[260px]' : 'w-14';

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    const willBeDark = !root.classList.contains('dark');
    root.classList.toggle('dark', willBeDark);
    localStorage.setItem('theme', willBeDark ? 'dark' : 'light');
    setIsDark(willBeDark);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside
      className={`${widthClass} h-full flex-shrink-0 flex flex-col py-3 px-2 gap-1 z-50 transition-[width] duration-200`}
      style={{ backgroundColor: 'var(--color-sidebar-bg)' }}
    >
      <Header expanded={expanded} onToggle={() => setExpanded(!expanded)} />

      <div className="h-1" />

      <NavRow
        expanded={expanded}
        active={isHome}
        icon={<Plus className="w-4 h-4" />}
        label="新建项目"
        onClick={() => navigate('/')}
      />
      <NavRow
        expanded={expanded}
        active={isLibrary}
        icon={<Library className="w-4 h-4" />}
        label="素材库"
        onClick={() => navigate('/library')}
      />

      {expanded && (
        <div className="flex-1 min-h-0 mt-3 flex flex-col gap-3 overflow-hidden">
          <PinnedList activeId={activeId} onSelect={(id) => navigate(`/projects/${id}`)} />
          <HistoryList activeId={activeId} onSelect={(id) => navigate(`/projects/${id}`)} />
        </div>
      )}

      {!expanded && <div className="flex-1" />}

      <NavRow
        expanded={expanded}
        active={false}
        icon={<Settings className="w-4 h-4" />}
        label="设置"
        disabled
        title="即将推出"
      />
      <NavRow
        expanded={expanded}
        active={false}
        icon={isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        label="主题"
        onClick={toggleTheme}
        title={isDark ? '切换至浅色模式' : '切换至深色模式'}
      />
      <NavRow
        expanded={expanded}
        active={false}
        icon={<RefreshCw className="w-4 h-4" />}
        label="检查更新"
        onClick={onCheckUpdate}
        disabled={!hasUpdate}
        title={hasUpdate ? '有新版本可安装' : '暂无更新'}
        badge={hasUpdate}
      />
      <NavRow
        expanded={expanded}
        active={false}
        icon={<LogOut className="w-4 h-4" />}
        label="退出登录"
        onClick={handleLogout}
        hoverDanger
      />
    </aside>
  );
}

function Header({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-9 h-9 mx-auto rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors flex items-center justify-center"
        title="展开侧栏"
      >
        <PanelLeftOpen className="w-4 h-4" />
      </button>
    );
  }
  return (
    <div className="w-full flex items-center justify-between h-9 px-1">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-[0_0_12px_rgba(109,93,251,0.3)] flex-shrink-0"
          style={{ backgroundColor: '#6D5DFB' }}
          title="ClipMind"
        >
          C
        </div>
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">ClipMind</span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="w-9 h-9 flex-shrink-0 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors flex items-center justify-center"
        title="收起侧栏"
      >
        <PanelLeftClose className="w-4 h-4" />
      </button>
    </div>
  );
}

interface NavRowProps {
  expanded: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  badge?: boolean;
  hoverDanger?: boolean;
}

function NavRow({ expanded, active, icon, label, onClick, disabled, title, badge, hoverDanger }: NavRowProps) {
  const stateClass = active
    ? 'bg-black/[0.06] dark:bg-white/[0.05] text-zinc-900 dark:text-zinc-100 font-medium'
    : disabled
    ? 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
    : `text-zinc-600 dark:text-zinc-400 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 ${
        hoverDanger ? 'hover:text-rose-500' : 'hover:text-zinc-900 dark:hover:text-zinc-100'
      }`;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title || label}
        className={`relative w-9 h-9 mx-auto rounded-lg flex items-center justify-center transition-colors ${stateClass}`}
      >
        {icon}
        {badge && (
          <span
            className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2"
            style={{ ['--tw-ring-color' as any]: 'var(--color-sidebar-bg)' }}
          />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative w-full h-9 rounded-lg flex items-center gap-3 px-2.5 text-[14px] transition-colors ${stateClass}`}
    >
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {badge && <span className="ml-auto w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />}
    </button>
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
      <SectionHeader icon={<Pin className="w-3 h-3" />} label="置顶项目" />
      <div className="flex flex-col gap-0.5">
        {items.map((p) => (
          <ProjectRow key={p.id} project={p} isActive={p.id === activeId} onClick={() => onSelect(p.id)} />
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
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '120px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = data?.pages.flatMap((p) => p.projects) ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SectionHeader icon={<History className="w-3 h-3" />} label="历史项目" />
      <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
        {isLoading && <div className="text-xs text-zinc-400 dark:text-zinc-500 px-3 py-2">加载中…</div>}
        {!isLoading && items.length === 0 && (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 px-3 py-2">暂无项目</div>
        )}
        {items.map((p) => (
          <ProjectRow key={p.id} project={p} isActive={p.id === activeId} onClick={() => onSelect(p.id)} />
        ))}
        <div ref={sentinelRef} className="h-4 flex-shrink-0" />
        {isFetchingNextPage && (
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500 px-3 py-1">加载更多…</div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="px-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
      {icon}
      {label}
    </div>
  );
}

function ProjectRow({
  project,
  isActive,
  onClick,
}: {
  project: ProjectListItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = (project.workflowMode && MODE_ICON[project.workflowMode]) || MessageCircle;
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const renameMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) throw new Error('Failed to rename');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) throw new Error('Failed to update pin');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${project.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('删除失败，请稍后重试。');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast(`已删除「${project.title || '未命名'}」`);
      if (isActive) navigate('/', { replace: true });
    },
  });

  const items: DropdownMenuItem[] = [
    {
      key: 'rename',
      label: '重命名',
      icon: <Pencil className="w-3.5 h-3.5" />,
      onClick: () => setEditing(true),
    },
    {
      key: 'pin',
      label: project.pinnedAt ? '取消置顶' : '置顶',
      icon: project.pinnedAt ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />,
      onClick: () => pinMutation.mutate(!project.pinnedAt),
    },
    {
      key: 'export',
      label: '导出',
      icon: <Download className="w-3.5 h-3.5" />,
      disabled: true,
      tooltip: '即将推出',
      // TODO: wire to backend export endpoint when available.
    },
    {
      key: 'delete',
      label: '删除',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      // TODO: backend has no soft-delete; once `projects.deletedAt` lands,
      // change this to delete + undo toast instead of hard-DELETE.
      onClick: () => setConfirmingDelete(true),
    },
  ];

  const stateClass = isActive
    ? 'bg-black/[0.06] dark:bg-white/[0.05] text-zinc-900 dark:text-zinc-100 font-medium'
    : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5';

  if (editing) {
    return (
      <div className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${stateClass}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
        <RenameInput
          initial={project.title || ''}
          onSubmit={(value) => {
            setEditing(false);
            const trimmed = value.trim();
            if (trimmed && trimmed !== project.title) renameMutation.mutate(trimmed);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <>
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
        className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left cursor-pointer transition-colors ${stateClass}`}
        title={project.title}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
        <span className="text-[13px] truncate min-w-0 flex-1">{project.title || '未命名'}</span>
        <DropdownMenu
          items={items}
          align="right"
          width={144}
          trigger={({ onClick: triggerClick, ref, open }) => (
            <button
              ref={ref}
              type="button"
              onClick={triggerClick}
              className={`flex-shrink-0 p-1 rounded-md cursor-pointer text-zinc-400 dark:text-zinc-500 hover:bg-black/10 dark:hover:bg-white/10 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors ${
                open || isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
              title="更多"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
        />
      </div>
      {confirmingDelete && (
        <DeleteConfirmModal
          isPending={deleteMutation.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            deleteMutation.mutate();
          }}
        />
      )}
    </>
  );
}

function RenameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cancel-vs-submit on blur is ambiguous. Mirror EditableProjectTitle: blur =
  // submit (matches user expectation that clicking elsewhere "saves"). Esc
  // explicitly cancels.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSubmit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit(value);
        else if (e.key === 'Escape') onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 bg-transparent border border-indigo-500/50 rounded outline-none px-1.5 py-0.5 text-[13px] focus:ring-2 focus:ring-indigo-500/20 text-zinc-900 dark:text-zinc-100"
    />
  );
}
