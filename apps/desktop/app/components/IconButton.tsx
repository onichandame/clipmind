import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  iconSize?: number;
}

export function IconButton({ 
  icon: Icon, 
  iconSize = 16, 
  className = "", 
  ...props 
}: IconButtonProps) {
  return (
    <button
      type="button"
      // 核心修复：显式强制手型和指针事件
      className={`p-1.5 text-zinc-500 transition-all cursor-pointer hover:bg-zinc-800/50 rounded-md inline-flex items-center justify-center ${className}`}
      {...props}
    >
      <Icon size={iconSize} />
    </button>
  );
}
