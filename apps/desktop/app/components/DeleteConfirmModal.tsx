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
  return (
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
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-bold transition-all"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 bg-red-600 text-white hover:bg-red-700 dark:bg-red-900/50 dark:text-red-400 dark:border dark:border-red-800/50 rounded-lg font-bold dark:hover:bg-red-900 transition-all"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
