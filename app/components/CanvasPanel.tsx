import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useCanvasStore } from "../store/useCanvasStore";

type CanvasMode = "outline" | "footage" | "split";

interface OutlineData {
  contentMd: string;
  version: number;
}

interface CanvasPanelProps {
  outline: OutlineData | null;
}

const modeLabels: Record<CanvasMode, string> = {
  outline: "Outline",
  footage: "Footage",
  split: "Split View",
};

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
  },
};

const OUTLINE_PLACEHOLDER = "在左侧告诉我想做什么，画布将自动展开";
const FOOTAGE_PLACEHOLDER = "Footage search results will appear here (Stage 6)";
const SPLIT_PLACEHOLDER = "Split comparison view will appear here (Stage 7)";

export function CanvasPanel({ outline }: CanvasPanelProps) {
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

      <div className="flex-1 overflow-auto">
        {activeMode === "outline" ? (
          outline ? (
            <div className="p-6">
              <div className="prose prose-sm prose-slate max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                >
                  {outline.contentMd}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-sm text-center px-8">
                {OUTLINE_PLACEHOLDER}
              </p>
            </div>
          )
        ) : activeMode === "footage" ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm text-center px-8">
              {FOOTAGE_PLACEHOLDER}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm text-center px-8">
              {SPLIT_PLACEHOLDER}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}