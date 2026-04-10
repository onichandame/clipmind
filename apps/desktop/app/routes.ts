import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("assets", "routes/assets.tsx"),
  route("projects/:projectId", "routes/projects.$projectId.tsx"),
] satisfies RouteConfig;
