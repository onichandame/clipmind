// react-resizable-panels v4 exports Group and Separator (not PanelGroup/PanelResizeHandle).
// v4 dropped autoSaveId; use useDefaultLayout({ id, storage }) for equivalent persistence.
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout, type PanelImperativeHandle } from "react-resizable-panels";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

  const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const prevShowRef = useRef(showRightPanel);

  // Snap the right panel to its initial state synchronously on first paint
  // so users with an empty workspace don't see a 50/50 flash before collapsing.
  useLayoutEffect(() => {
    if (!showRightPanel) {
      rightPanelRef.current?.collapse();
    }
    // intentionally fire only on mount; subsequent toggles are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prevShowRef.current === showRightPanel) return;
    prevShowRef.current = showRightPanel;
    setTransitioning(true);
    if (showRightPanel) {
      rightPanelRef.current?.expand();
    } else {
      rightPanelRef.current?.collapse();
    }
    const t = window.setTimeout(() => setTransitioning(false), 250);
    return () => window.clearTimeout(t);
  }, [showRightPanel]);

  return (
    <div className="h-full w-full overflow-hidden">
      <PanelGroup
        direction="horizontal"
        id="clipmind-workspace"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className={transitioning ? "workspace-rightpanel-transitioning" : ""}
      >
        <Panel defaultSize="50%" minSize="30%">
          <ChatPanel key={project.id} projectId={project.id} initialMessages={initialMessages} />
        </Panel>
        <PanelResizeHandle className="w-px bg-zinc-200 dark:bg-zinc-800/60 hover:bg-indigo-400 dark:hover:bg-indigo-500 transition-colors" />
        <Panel
          panelRef={rightPanelRef}
          defaultSize="50%"
          minSize="30%"
          collapsible
          collapsedSize="0%"
        >
          {showRightPanel && <RightPanel projectId={project.id} outline={outline} />}
        </Panel>
      </PanelGroup>
    </div>
  );
}
