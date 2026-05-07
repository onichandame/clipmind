import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  // Tooltip shown via native `title` attribute. Useful for disabled items.
  tooltip?: string;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  // Render-prop trigger so callers fully control the trigger button's look,
  // hover/focus visibility, ref, and click behavior. We just hand them
  // `onClick` (positions + toggles) and `open` (lets them keep the trigger
  // visible while menu is open).
  trigger: (props: {
    onClick: (e: React.MouseEvent) => void;
    ref: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
  }) => React.ReactNode;
  // Right-anchored by default — menu's right edge aligns with trigger's right edge.
  align?: 'left' | 'right';
  width?: number;
}

export function DropdownMenu({ items, trigger, align = 'right', width = 160 }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    // The sidebar's history list is its own scroll container; close on any
    // scroll so the fixed-position menu doesn't drift away from the trigger.
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = align === 'right' ? rect.right - width : rect.left;
      setPos({ top: rect.bottom + 4, left });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      {trigger({ onClick: handleTriggerClick, ref: triggerRef, open })}
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-50 overflow-hidden py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => {
            const baseColor = item.disabled
              ? 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
              : item.danger
              ? 'text-rose-600 dark:text-rose-400 cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-500/10'
              : 'text-zinc-700 dark:text-zinc-200 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/60';
            return (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                title={item.tooltip}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick?.();
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${baseColor}`}
              >
                {item.icon && <span className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">{item.icon}</span>}
                <span className="flex-1 text-left truncate">{item.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
