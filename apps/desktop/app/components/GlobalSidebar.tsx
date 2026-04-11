import { Link, useLocation } from "react-router";
import { LayoutGrid, Library } from "lucide-react";

export function GlobalSidebar() {
  const location = useLocation();
  const isAssets = location.pathname.startsWith("/assets");

  return (
    <div className="w-16 flex-shrink-0 bg-zinc-900/40 border-r border-zinc-800/80 flex flex-col items-center py-5 gap-6 z-50">
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
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${!isAssets ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'}`}>
            <LayoutGrid className="w-5 h-5" />
          </div>
        </Link>
        <Link to="/assets" title="全局素材库">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${isAssets ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'}`}>
            <Library className="w-5 h-5" />
          </div>
        </Link>
      </div>

      {/* User Avatar */}
      <div className="mt-auto mb-2 cursor-pointer hover:ring-2 hover:ring-[#6D5DFB]/50 rounded-full transition-all">
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-zinc-700 to-zinc-600 border border-zinc-500"></div>
      </div>
    </div>
  );
}
