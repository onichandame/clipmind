import type { Route } from "./+types/projects.$projectId";
import { db } from "../db/client";
import { projects, projectOutlines, projectMessages } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { useLoaderData } from "react-router";

export async function loader({ params }: Route.LoaderArgs) {
  const projectId = params.projectId;

  const [existing] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!existing) throw new Response("Project Not Found", { status: 404 });

  const [outline] = await db.select().from(projectOutlines).where(eq(projectOutlines.projectId, projectId));

  const history = await db.select().from(projectMessages)
    .where(eq(projectMessages.projectId, projectId))
    .orderBy(asc(projectMessages.createdAt));

  // 严格映射数据
  const initialMessages = history.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content || " ",
    createdAt: msg.createdAt.toISOString(),
  }));

  // 直接返回原生对象
  return {
    project: { id: existing.id, title: existing.title, createdAt: existing.createdAt.toISOString() },
    outline: outline ? { contentMd: outline.contentMd, version: outline.version } : null,
    initialMessages, // 核心：把历史记录装车
  };
}

export default function ProjectWorkspace() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <WorkspaceLayout
      project={loaderData.project}
      outline={loaderData.outline}
      initialMessages={loaderData.initialMessages} // 核心：在这里把管子接上！
    />
  );
}
