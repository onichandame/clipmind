export function ChatPanel() {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
        <span className="text-lg">💬</span>
        <h1 className="text-base font-semibold text-gray-800">ClipMind Chat</h1>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500 text-sm text-center px-8">
          AI assistant will be available here in Stage 3
        </p>
      </div>

      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Type a message..."
            disabled
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-100 text-gray-400 cursor-not-allowed"
          />
          <button
            type="button"
            disabled
            className="px-4 py-2 text-sm bg-blue-400 text-white rounded-md cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
