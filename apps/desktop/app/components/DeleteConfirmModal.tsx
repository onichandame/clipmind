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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-sm w-full shadow-2xl">
        <h3 className="text-xl font-bold text-zinc-100 mb-2">{title}</h3>
        <p className="text-zinc-400 mb-8 whitespace-pre-wrap">{description}</p>
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-zinc-400 font-bold hover:text-zinc-100 transition-all"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 bg-red-900/50 text-red-400 border border-red-800/50 rounded-lg font-bold hover:bg-red-900 transition-all"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
