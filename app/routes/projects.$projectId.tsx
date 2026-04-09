import type { Route } from "./+types/projects.$projectId";
import { db } from "../db/client";
import { projects, projectOutlines } from "../db/schema";
import { eq } from "drizzle-orm";
import { WorkspaceLayout } from "../components/WorkspaceLayout";

export async function loader({ params }: Route.LoaderArgs) {
  const projectId = params.projectId;

  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (existing) {
    const [outline] = await db
      .select()
      .from(projectOutlines)
      .where(eq(projectOutlines.projectId, projectId));

    return Response.json({
      project: { id: existing.id, title: existing.title, createdAt: existing.createdAt },
      outline: outline ? { contentMd: outline.contentMd, version: outline.version } : null,
    });
  }

  await db.insert(projects).values({
    id: projectId,
    title: "Untitled Project",
  });

  const [created] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  const [outline] = await db
    .select()
    .from(projectOutlines)
    .where(eq(projectOutlines.projectId, projectId));

  return Response.json({
    project: { id: created.id, title: created.title, createdAt: created.createdAt },
    outline: outline ? { contentMd: outline.contentMd, version: outline.version } : null,
  });
}

interface LoaderData {
  project: {
    id: string;
    title: string;
    createdAt: Date | string;
  };
  outline: {
    contentMd: string;
    version: number;
  } | null;
}

export default function ProjectWorkspace({ loaderData }: { loaderData: LoaderData }) {
  return <WorkspaceLayout project={loaderData.project} outline={loaderData.outline} />;
}
