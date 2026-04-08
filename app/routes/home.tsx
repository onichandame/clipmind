import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "ClipMind Stage 1" },
    { name: "description", content: "ClipMind Stage 1 — Data Pipeline Active" },
  ];
}

export default function Home() {
  return <div>ClipMind Stage 1 — Data Pipeline Active</div>;
}
