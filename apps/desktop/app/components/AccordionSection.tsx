import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  id: string;
  title: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  children: ReactNode;
}

export function AccordionSection({ id, title, activeId, setActiveId, children }: Props) {
  const isActive = activeId === id;
  return (
    <div className={`border transition-all duration-300 rounded-2xl overflow-hidden mb-5 ${isActive ? 'border-indigo-200 dark:border-indigo-500/30 shadow-md' : 'border-zinc-200 dark:border-zinc-800/60 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700/50'}`}>
      <button
        onClick={() => setActiveId(isActive ? null : id)}
        className="w-full flex items-center justify-between p-5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer"
      >
        <h3 className={`font-bold text-[16px] tracking-wide ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-800 dark:text-zinc-200'}`}>
          {title}
        </h3>
        <div className={`${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}>
          {isActive ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </button>
      {isActive && (
        <div className="border-t border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-950 p-6 animate-in fade-in zoom-in-95 duration-200 origin-top">
          {children}
        </div>
      )}
    </div>
  );
}
