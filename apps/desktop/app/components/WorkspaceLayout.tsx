// react-resizable-panels v4 exports Group and Separator (not PanelGroup/PanelResizeHandle).
// v4 dropped autoSaveId; use useDefaultLayout({ id, storage }) for equivalent persistence.
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from "react-resizable-panels";
import { ChatPanel } from "./ChatPanel";
import { RightPanel } from "./RightPanel";
import { useCanvasStore } from "../store/useCanvasStore";

// useDefaultLayout has `storage = localStorage` as an ES default param — passing `undefined`
// triggers eager evaluation and crashes during SSR pre-render. Use a no-op stub on the server.
const noopStorage = { getItem: () => null, setItem: () => {} };
const layoutStorage = typeof window !== 'undefined' ? window.localStorage : noopStorage;

interface Project {
  id: string;
  title: string;
  createdAt: string | Date;
  retrievedClips?: any[];
  editingPlans?: any[];
}

interface OutlineData {
  contentMd: string;
  version: number;
}

interface WorkspaceLayoutProps {
  project: Project;
  outline: OutlineData | null;
  initialMessages?: any[];
}

export function WorkspaceLayout({ project, outline, initialMessages = [] }: WorkspaceLayoutProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'clipmind-workspace',
    storage: layoutStorage,
  });

  const outlineContent = useCanvasStore((s) => s.projects[project.id]?.outlineContent || "");
  const hasClips = (project.retrievedClips?.length ?? 0) > 0;
  const hasPlans = (project.editingPlans?.length ?? 0) > 0;
  const hasOutline = !!outline || outlineContent.trim().length > 0;
  const showRightPanel = hasClips || hasPlans || hasOutline;

  return (
    <div className="h-full w-full overflow-hidden">
      {showRightPanel ? (
        <PanelGroup
          direction="horizontal"
          id="clipmind-workspace"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel defaultSize="50%" minSize="30%">
            <ChatPanel key={project.id} projectId={project.id} initialMessages={initialMessages} />
          </Panel>
          <PanelResizeHandle className="w-px bg-zinc-200 dark:bg-zinc-800/60 hover:bg-indigo-400 dark:hover:bg-indigo-500 transition-colors" />
          <Panel defaultSize="50%" minSize="30%">
            <RightPanel projectId={project.id} outline={outline} />
          </Panel>
        </PanelGroup>
      ) : (
        <ChatPanel key={project.id} projectId={project.id} initialMessages={initialMessages} />
      )}
    </div>
  );
}
