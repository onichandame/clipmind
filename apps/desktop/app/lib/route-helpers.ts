// AI 助理覆盖的路由：欢迎页 (LandingChat) + 具体项目对话页。
// NavRail icon active、会话栏自动开关、键盘快捷键等场景共用此判定。
export function isAssistantRoute(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/projects/');
}
