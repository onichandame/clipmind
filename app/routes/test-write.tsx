import type { Route } from "./+types/test-write";
import { db } from "../db/client";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export async function loader(_args: Route.LoaderArgs) {
  return Response.json({ status: "test-write route active" });
}

export async function action({ request }: Route.ActionArgs) {
  const body = await request.json();

  if (!body.title || typeof body.title !== "string" || body.title.trim() === "") {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(projects).values({ id, title: body.title.trim() });

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id));

  return Response.json({ project });
}
