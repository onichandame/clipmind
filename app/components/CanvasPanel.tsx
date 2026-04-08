import { useCanvasStore } from "../store/useCanvasStore";

type CanvasMode = "outline" | "footage" | "split";

const modeLabels: Record<CanvasMode, string> = {
  outline: "Outline",
  footage: "Footage",
  split: "Split View",
};

const modePlaceholders: Record<CanvasMode, string> = {
  outline: "Markdown outline editor will appear here (Stage 3)",
  footage: "Footage search results will appear here (Stage 6)",
  split: "Split comparison view will appear here (Stage 7)",
};

export function CanvasPanel() {
  const { activeMode, setActiveMode } = useCanvasStore();

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex items-center gap-1 px-4 py-3 border-b border-gray-200 bg-white">
        {(["outline", "footage", "split"] as CanvasMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setActiveMode(mode)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeMode === mode
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500 text-sm text-center px-8">
          {modePlaceholders[activeMode]}
        </p>
      </div>
    </div>
  );
}
