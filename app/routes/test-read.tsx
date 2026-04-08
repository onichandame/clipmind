import type { Route } from "./+types/test-read";
import { db } from "../db/client";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";

export async function loader({ params }: Route.LoaderArgs) {
  const headers = { "Content-Type": "application/json" };

  if (params.id) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, params.id));

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers,
      });
    }

    return new Response(
      JSON.stringify({ project: { id: project.id, title: project.title, createdAt: project.createdAt } }),
      { headers }
    );
  }

  const allProjects = await db.select().from(projects);
  return new Response(
    JSON.stringify({ projects: allProjects.map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt })) }),
    { headers }
  );
}


