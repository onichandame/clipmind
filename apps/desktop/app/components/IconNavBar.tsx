import { Link, useLocation, useNavigate } from "react-router";
import { Home, Library, Moon, Sun, LogOut, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { useEffect, useState } from "react";
import { logout } from "../lib/auth";

interface IconNavBarProps {
  projectListCollapsed: boolean;
  onToggleProjectList: () => void;
}

export function IconNavBar({ projectListCollapsed, onToggleProjectList }: IconNavBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
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

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const isHome = location.pathname === '/';
  const isLibrary = location.pathname.startsWith('/library');

  return (
    <aside className="w-14 h-full flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col items-center py-4 gap-2 z-50 transition-colors duration-200">
      {/* Brand glyph */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-[0_0_12px_rgba(109,93,251,0.3)] flex-shrink-0 mb-1"
        style={{ backgroundColor: '#6D5DFB' }}
        title="ClipMind"
      >
        C
      </div>

      {/* Project-list collapse toggle */}
      <button
        type="button"
        onClick={onToggleProjectList}
        className="p-2 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        title={projectListCollapsed ? "展开项目列表" : "折叠项目列表"}
      >
        {projectListCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
      </button>

      <div className="w-8 h-px bg-zinc-200 dark:bg-zinc-800/70 my-1" />

      {/* Home */}
      <NavIcon to="/" active={isHome} title="主页" icon={<Home className="w-4 h-4" />} />

      {/* Library */}
      <NavIcon to="/library" active={isLibrary} title="素材库" icon={<Library className="w-4 h-4" />} />

      <div className="flex-1" />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-lg cursor-pointer text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        title={isDark ? "切换至浅色模式" : "切换至深色模式"}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* Logout */}
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

function NavIcon({ to, active, title, icon }: { to: string; active: boolean; title: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      title={title}
      className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
        active
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100'
      }`}
    >
      {icon}
    </Link>
  );
}
