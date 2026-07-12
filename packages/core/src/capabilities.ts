export type GhostwriterCapability = Readonly<{
  id: string;
  title: string;
  access: "read" | "propose" | "apply";
  scope: "account" | "project" | "book" | "scene";
  coreUseCase: string;
  bindings: Readonly<{
    ui?: string;
    mcp?: string;
    mcpException?: string;
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

const MCP_CANONICAL_MUTATION_EXCEPTION =
  "Direct canonical MCP mutation is deferred until scoped agent grants and remote/local authorization are accepted.";

function canonicalCommand(
  id: string,
  title: string,
  scope: GhostwriterCapability["scope"],
  command: string
): GhostwriterCapability {
  return Object.freeze({
    id,
    title,
    access: "apply",
    scope,
    coreUseCase: `executeProjectCommand:${command}`,
    bindings: Object.freeze({
      ui: "AuthenticatedProjectWorkspace",
      mcpException: MCP_CANONICAL_MUTATION_EXCEPTION
    })
  });
}

export const PROJECT_COMMAND_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    canonicalCommand("project.rename", "Rename a project", "project", "project.rename"),
    canonicalCommand(
      "project.archive",
      "Archive or restore a project",
      "project",
      "project.setArchived"
    ),
    canonicalCommand("book.create", "Create a book", "project", "book.create"),
    canonicalCommand("book.update", "Update a book", "book", "book.update"),
    canonicalCommand("book.reorder", "Reorder books", "project", "book.reorder"),
    canonicalCommand(
      "book.archive",
      "Archive or restore a book",
      "book",
      "book.setArchived"
    ),
    canonicalCommand("part.create", "Create a manuscript part", "book", "part.create"),
    canonicalCommand("part.rename", "Rename a manuscript part", "book", "part.rename"),
    canonicalCommand("part.reorder", "Reorder manuscript parts", "book", "part.reorder"),
    canonicalCommand(
      "part.removeEmpty",
      "Remove an empty manuscript part",
      "book",
      "part.removeEmpty"
    ),
    canonicalCommand(
      "chapter.create",
      "Create a manuscript chapter",
      "book",
      "chapter.create"
    ),
    canonicalCommand(
      "chapter.rename",
      "Rename a manuscript chapter",
      "book",
      "chapter.rename"
    ),
    canonicalCommand(
      "chapter.reorder",
      "Reorder manuscript chapters",
      "book",
      "chapter.reorder"
    ),
    canonicalCommand(
      "chapter.removeEmpty",
      "Remove an empty manuscript chapter",
      "book",
      "chapter.removeEmpty"
    ),
    canonicalCommand("scene.create", "Create a scene", "book", "scene.create"),
    canonicalCommand("scene.update", "Update scene metadata", "scene", "scene.update"),
    canonicalCommand("scene.move", "Move a scene", "scene", "scene.move"),
    canonicalCommand(
      "scene.archive",
      "Archive or restore a scene",
      "scene",
      "scene.setArchived"
    ),
    canonicalCommand(
      "storyKnowledge.create",
      "Create story knowledge",
      "project",
      "storyKnowledge.create"
    ),
    canonicalCommand(
      "storyKnowledge.update",
      "Update story knowledge",
      "project",
      "storyKnowledge.update"
    ),
    canonicalCommand(
      "storyKnowledge.linkScene",
      "Link story knowledge to a scene",
      "project",
      "storyKnowledge.setSceneLink"
    ),
    canonicalCommand(
      "storyKnowledge.archive",
      "Archive or restore story knowledge",
      "project",
      "storyKnowledge.setArchived"
    )
  ]);

export const GHOSTWRITER_CAPABILITIES: readonly GhostwriterCapability[] = Object.freeze([
  PROJECT_NAVIGATOR_CAPABILITY,
  ...PROJECT_COMMAND_CAPABILITIES
]);
