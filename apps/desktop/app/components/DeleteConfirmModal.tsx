import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export function DeleteConfirmModal({
  onCancel,
  onConfirm,
  title = "确认删除项目？",
  description = "此操作将永久删除该项目对应的策划大纲并清空素材篮子。底层的全局素材库不会受到影响。",
}: {
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-zinc-950/80 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">{title}</h3>
        <p className="text-zinc-600 dark:text-zinc-400 mb-8 whitespace-pre-wrap">{description}</p>
        <div className="flex gap-4">
          <Button variant="secondary" fullWidth onClick={onCancel}>
            取消
          </Button>
          <Button variant="danger" fullWidth onClick={onConfirm}>
            确认删除
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
