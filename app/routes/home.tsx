import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { db } from "../db/client";
import { projects } from "../db/schema";

export async function loader() {
  const projectId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, title: "Untitled Project" });
  return redirect(`/projects/${projectId}`);
}

export function meta() {
  return [
    { title: "Redirecting..." },
    { name: "description", content: "Creating new project..." },
  ];
}
