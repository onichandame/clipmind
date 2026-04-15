import { Link, useLocation } from "react-router";
import { LayoutGrid, Library, Moon, Sun } from "lucide-react";
import { useState, useEffect } from "react";

export function GlobalSidebar() {
  const location = useLocation();
  const isAssets = location.pathname.startsWith("/assets");
  const [isDark, setIsDark] = useState(false);

  // [架构师决断]: 初始化时读取系统 DOM 的实际状态，确保与 root.tsx 的注入一致
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

  return (
    <div className="w-16 flex-shrink-0 bg-zinc-50 dark:bg-zinc-900/40 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col items-center py-5 gap-6 z-50 transition-colors duration-200">
      {/* Logo Icon */}
      <Link to="/" title="ClipMind Home">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold shadow-[0_0_15px_rgba(109,93,251,0.25)] cursor-pointer hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#6D5DFB' }}
        >
          C
        </div>
      </Link>

      {/* Nav Icons */}
      <div className="flex flex-col gap-3 mt-2">
        <Link to="/" title="工作台">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${!isAssets ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
            <LayoutGrid className="w-5 h-5" />
          </div>
        </Link>
        <Link to="/assets" title="全局素材库">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${isAssets ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
            <Library className="w-5 h-5" />
          </div>
        </Link>
      </div>

      {/* Bottom Actions */}
      <div className="mt-auto flex flex-col gap-4 items-center mb-2">
        {/* Theme Toggle */}
        <div
          onClick={toggleTheme}
          className="w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 text-zinc-500 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40 hover:text-zinc-900 dark:hover:text-zinc-100"
          title={isDark ? "切换至浅色模式" : "切换至深色模式"}
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </div>
      </div>
    </div>
  );
}
