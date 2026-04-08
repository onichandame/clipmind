import type { Route } from "./+types/projects.$projectId";
import { db } from "../db/client";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { WorkspaceLayout } from "../components/WorkspaceLayout";

export async function loader({ params }: Route.LoaderArgs) {
  const projectId = params.projectId;

  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (existing) {
    return Response.json({ project: { id: existing.id, title: existing.title, createdAt: existing.createdAt } });
  }

  await db.insert(projects).values({
    id: projectId,
    title: "Untitled Project",
  });

  const [created] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  return Response.json({ project: { id: created.id, title: created.title, createdAt: created.createdAt } });
}

interface LoaderData {
  project: {
    id: string;
    title: string;
    createdAt: Date | string;
  };
}

export default function ProjectWorkspace({ loaderData }: { loaderData: LoaderData }) {
  return <WorkspaceLayout project={loaderData.project} />;
}
