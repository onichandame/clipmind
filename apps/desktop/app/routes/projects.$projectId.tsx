import { WorkspaceLayout } from "../components/WorkspaceLayout";

export default function ProjectWorkspace() {
  const loaderData = {
    project: { id: "mock-id", title: "Mock Project", createdAt: new Date().toISOString() },
    outline: null,
    initialMessages: []
  }; // Mocked state

  return (
    <WorkspaceLayout
      project={loaderData.project}
      outline={loaderData.outline}
      initialMessages={loaderData.initialMessages} // 核心：在这里把管子接上！
    />
  );
}
