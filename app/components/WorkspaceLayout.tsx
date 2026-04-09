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
    <div className="flex h-full w-full overflow-hidden">
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