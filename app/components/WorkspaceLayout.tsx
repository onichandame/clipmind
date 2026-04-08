import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { CanvasPanel } from "./CanvasPanel";
import { BasketSidebar } from "./BasketSidebar";

interface Project {
  id: string;
  title: string;
  createdAt: string | Date;
}

interface WorkspaceLayoutProps {
  project: Project;
}

export function WorkspaceLayout({ project }: WorkspaceLayoutProps) {
  const [isBasketOpen, setIsBasketOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="w-[40%] h-full flex-shrink-0">
        <ChatPanel />
      </div>

      <div className="w-px bg-gray-300 h-full flex-shrink-0" />

      <div className="flex-1 h-full min-w-0">
        <CanvasPanel />
      </div>

      <BasketSidebar isOpen={isBasketOpen} onToggle={() => setIsBasketOpen(!isBasketOpen)} />
    </div>
  );
}
