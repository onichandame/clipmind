// FIX: 全局布局重构，引入深色模式和 30/70 比例
import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { CanvasPanel } from "./CanvasPanel";
import { BasketSidebar } from "./BasketSidebar";

interface Project {
  id: string;
  title: string;
  createdAt: string | Date;
}

interface OutlineData {
  contentMd: string;
  version: number;
}

interface WorkspaceLayoutProps {
  project: Project;
  outline: OutlineData | null;
}

export function WorkspaceLayout({ project, outline }: WorkspaceLayoutProps) {
  const [isBasketOpen, setIsBasketOpen] = useState(false);

  return (
    // NEW: 全局深色底色 bg-zinc-950，全局文本为浅色
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-200 font-sans tracking-wide">

      {/* NEW: 极窄侧边栏 (Global Nav) */}
      <div className="w-[60px] flex-shrink-0 bg-zinc-900/40 border-r border-zinc-800/80 flex flex-col items-center py-5 gap-6 z-10">
        {/* Logo Icon */}
        <div className="w-8 h-8 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold shadow-[0_0_15px_rgba(99,102,241,0.15)] cursor-pointer">
          C
        </div>

        {/* Nav Icons */}
        <div className="flex flex-col gap-3 mt-2">
          {/* Active Workspace Icon */}
          <div className="w-10 h-10 rounded-xl bg-zinc-800/80 flex items-center justify-center text-zinc-100 cursor-pointer shadow-sm border border-zinc-700/50">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
          </div>
          {/* Asset Library Icon (Inactive) */}
          <div className="w-10 h-10 rounded-xl hover:bg-zinc-800/40 flex items-center justify-center text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
          </div>
        </div>

        {/* User Avatar */}
        <div className="mt-auto mb-2 cursor-pointer hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 border-2 border-zinc-800"></div>
        </div>
      </div>

      {/* FIX: ChatPanel 容器调整为 30%，添加最小和最大宽度保护 */}
      <div className="w-[30%] min-w-[320px] max-w-[420px] h-full flex-shrink-0 border-r border-zinc-800/60 bg-zinc-900/20">
        <ChatPanel projectId={project.id} />
      </div>

      {/* FIX: 彻底移除原有的 w-px bg-gray-300 丑陋分割线 */}

      {/* CanvasPanel 容器 (占满剩余 70%) */}
      <div className="flex-1 h-full min-w-0 bg-zinc-950 relative">
        <CanvasPanel outline={outline} />
      </div>

      <BasketSidebar isOpen={isBasketOpen} onToggle={() => setIsBasketOpen(!isBasketOpen)} />
    </div>
  );
}
