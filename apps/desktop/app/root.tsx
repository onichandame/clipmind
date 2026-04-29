import "./app.css";

import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";

import { useEffect, useRef, useState } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from "react-resizable-panels";
import { GlobalSidebar } from "./components/GlobalSidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchMe, getToken, type AuthUser, getCachedUser } from "./lib/auth";
import { useGlobalAssetImportListeners } from "./lib/asset-import";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PUBLIC_ROUTES = new Set(['/login', '/signup']);

function AuthGate({ children }: { children: React.ReactNode }) {
  // Wire Tauri asset-import progress events at the app root so any entry
  // point (chat widget, library page, future ones) sees the same store state.
  useGlobalAssetImportListeners();
  const location = useLocation();
  const navigate = useNavigate();
  const isPublic = PUBLIC_ROUTES.has(location.pathname);
  // SSR-safe init: never read localStorage in the useState initializer or the render path.
  // `mounted` flips true on first effect tick — the static prerender and the very first
  // client paint both render the loading branch, so hydration matches.
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [resolved, setResolved] = useState<boolean>(false);
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);

  const collapseSidebar = () => {
    setSidebarTransitioning(true);
    sidebarRef.current?.collapse();
    window.setTimeout(() => setSidebarTransitioning(false), 250);
  };
  const expandSidebar = () => {
    setSidebarTransitioning(true);
    sidebarRef.current?.expand();
    window.setTimeout(() => setSidebarTransitioning(false), 250);
  };

  useEffect(() => {
    setMounted(true);
    const cached = getCachedUser();
    if (cached) {
      setUser(cached);
      setResolved(true);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const token = getToken();
    if (isPublic) {
      if (token) {
        fetchMe().then(u => {
          if (!cancelled && u) navigate('/', { replace: true });
        });
      }
      return;
    }
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    fetchMe().then(u => {
      if (cancelled) return;
      if (!u) {
        navigate('/login', { replace: true });
      } else {
        setUser(u);
        setResolved(true);
      }
    });
    return () => { cancelled = true; };
  }, [mounted, isPublic, location.pathname]);

  if (isPublic) {
    return <>{children}</>;
  }
  if (!mounted || !resolved || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-indigo-50/40 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 text-sm">
        正在加载…
      </div>
    );
  }
  return (
    <div className="h-screen w-screen overflow-hidden bg-indigo-50/40 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-200 font-sans tracking-wide transition-colors duration-200">
      <PanelGroup
        direction="horizontal"
        id="clipmind-shell"
        className={sidebarTransitioning ? "shell-sidebar-transitioning" : ""}
      >
        <Panel
          panelRef={sidebarRef}
          defaultSize="240px"
          minSize="200px"
          maxSize="380px"
          collapsible
          collapsedSize="56px"
          onResize={(size) => setSidebarCollapsed(size.inPixels < 100)}
        >
          <GlobalSidebar
            collapsed={sidebarCollapsed}
            onCollapse={collapseSidebar}
            onExpand={expandSidebar}
          />
        </Panel>
        <PanelResizeHandle className="w-px bg-zinc-200 dark:bg-zinc-800/60 hover:bg-indigo-400 dark:hover:bg-indigo-500 transition-colors" />
        <Panel minSize="50%">
          <div className="h-full w-full relative overflow-y-auto">
            {children}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    const isDark = localStorage.getItem("theme") === "dark";
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <Outlet />
      </AuthGate>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: any) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
