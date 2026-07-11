export type GhostwriterCapability = Readonly<{
  id: string;
  title: string;
  access: "read" | "propose" | "apply";
  scope: "project" | "book" | "scene";
  coreUseCase: string;
  bindings: Readonly<{
    ui?: string;
    mcp?: string;
  }>;
}>;

export const PROJECT_NAVIGATOR_CAPABILITY = Object.freeze({
  id: "project.navigator.read",
  title: "Read a project's book and manuscript hierarchy",
  access: "read",
  scope: "project",
  coreUseCase: "getProjectNavigator",
  bindings: Object.freeze({
    ui: "ProjectNavigatorScreen",
    mcp: "ghostwriter_project_navigator"
  })
}) satisfies GhostwriterCapability;

export const GHOSTWRITER_CAPABILITIES: readonly GhostwriterCapability[] = Object.freeze([
  PROJECT_NAVIGATOR_CAPABILITY
]);
