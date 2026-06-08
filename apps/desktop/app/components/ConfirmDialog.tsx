import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export function ConfirmDialog({
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'danger',
  isPending = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  isPending?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-zinc-950/80 backdrop-blur-sm p-4"
      onClick={isPending ? undefined : onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">{title}</h3>
        {description && (
          <div className="text-zinc-600 dark:text-zinc-400 mb-8 whitespace-pre-wrap">
            {description}
          </div>
        )}
        <div className="flex gap-4">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button variant={variant} fullWidth onClick={onConfirm} disabled={isPending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
