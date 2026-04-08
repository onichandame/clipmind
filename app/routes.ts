import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("test-read/:id?", "routes/test-read.tsx"),
  route("test-write", "routes/test-write.tsx"),
  route("projects/:projectId", "routes/projects.$projectId.tsx"),
] satisfies RouteConfig;
