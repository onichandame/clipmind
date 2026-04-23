import { useEffect } from "react";
import { Film, X } from "lucide-react";
import type { Asset } from "../routes/assets";

export function AssetDetailModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-zinc-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Thumbnail */}
        <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 relative flex items-center justify-center overflow-hidden rounded-t-xl">
          {asset.thumbnailUrl ? (
            <>
              <img
                src={asset.thumbnailUrl}
                alt={asset.filename}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextElementSibling?.classList.remove("hidden");
                }}
              />
              <Film className="hidden w-12 h-12 text-zinc-400 dark:text-zinc-600" />
            </>
          ) : (
            <Film className="w-12 h-12 text-zinc-400 dark:text-zinc-600" />
          )}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-all backdrop-blur-sm z-10"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info */}
        <div className="p-6 space-y-4">
          <h2
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 break-all"
            title={asset.filename}
          >
            {asset.filename}
          </h2>

          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">上传时间</span>
            {"　"}
            {new Date(asset.createdAt).toLocaleString()}
          </p>

          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">AI 总结</p>
            {asset.summary ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {asset.summary}
              </p>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">AI 总结尚未生成</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
