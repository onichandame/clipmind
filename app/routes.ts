import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("assets", "routes/assets.tsx"),
  route("test-read/:id?", "routes/test-read.tsx"),
  route("test-write", "routes/test-write.tsx"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/upload-token", "routes/api.upload-token.ts"),
  route("projects/:projectId", "routes/projects.$projectId.tsx"),
  route("api/oss-callback", "routes/api.oss-callback.ts"),
] satisfies RouteConfig;
