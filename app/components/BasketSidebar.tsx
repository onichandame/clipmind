import { useBasketStore } from "../store/useBasketStore";

interface BasketSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function BasketSidebar({ isOpen, onToggle }: BasketSidebarProps) {
  const items = useBasketStore((state) => state.items);
  const removeItem = useBasketStore((state) => state.removeItem);
  const clearBasket = useBasketStore((state) => state.clearBasket);

  const formatTime = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-30 bg-white shadow-lg rounded-l-lg px-2 py-3 text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          aria-label="Open basket"
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg">🗑</span>
            {items.length > 0 && (
              <span className="text-xs font-medium bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                {items.length}
              </span>
            )}
          </div>
        </button>
      )}

      <div
        className={`
          fixed top-0 right-0 h-full z-40 bg-white shadow-xl
          flex flex-col
          transition-transform duration-300 ease-in-out
          w-80
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">🗑</span>
            <h2 className="text-base font-semibold text-gray-800">
              素材篮子 (Basket)
            </h2>
            {items.length > 0 && (
              <span className="text-sm text-gray-500">({items.length})</span>
            )}
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            aria-label="Close basket"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <span className="text-4xl mb-3">📭</span>
              <p className="text-sm">No items in basket yet</p>
              <p className="text-xs mt-1">Search footage to add clips</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="px-4 py-3 flex items-start justify-between gap-2 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-gray-800 truncate">
                      {item.assetChunkId.slice(0, 8)}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-500">
                        #{item.sortRank}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatTime(item.addedAt)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                    aria-label={`Remove ${item.assetChunkId.slice(0, 8)}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200">
            <button
              type="button"
              onClick={clearBasket}
              disabled={items.length === 0}
              className={`
                w-full py-2 px-4 rounded-md text-sm font-medium transition-colors
                ${
                  items.length === 0
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-red-50 text-red-600 hover:bg-red-100"
                }
              `}
            >
              Clear All
            </button>
          </div>
        )}
      </div>
    </>
  );
}
