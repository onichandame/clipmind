import "./app.css";

import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";


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

import { useEffect } from "react";
import { GlobalSidebar } from "./components/GlobalSidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// [架构师决断]: Tauri SPA 环境下安全的全局单例，规避 React 树卸载导致的缓存丢失
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // 桌面端无需频繁 refetch
      retry: 1,
    },
  },
});

export default function App() {
  // [架构师决断]: 初始挂载时同步应用主题至 HTML 根节点。
  // (后续在具体的如 Header 或 Settings 组件中，直接修改 localStorage 并 toggle document.documentElement.classList 即可)
  useEffect(() => {
    const isDark = localStorage.getItem("theme") === "dark"; // [架构师决断]: 默认偏好亮色
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-200 font-sans tracking-wide transition-colors duration-200">
        <GlobalSidebar />
        <div className="flex-1 min-w-0 h-full relative">
          <Outlet />
        </div>
      </div>
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
