export type GhostwriterCapability = Readonly<{
  id: string;
  title: string;
  access: "read" | "propose" | "apply";
  scope: "account" | "project" | "book" | "scene";
  coreUseCase: string;
  bindings: Readonly<{
    ui?: string;
    web?: string;
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
    ui: "ManuscriptTree",
    web: "GET /api/projects/{projectId}/navigator + POST /api/workspace/chat",
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
      ui: "ManuscriptTree + SelectionInspector",
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
      "chapter.update",
      "Update manuscript chapter metadata",
      "book",
      "chapter.update"
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
      "storyKnowledge.linkKnowledge",
      "Link story knowledge to another knowledge record",
      "project",
      "storyKnowledge.setKnowledgeLink"
    ),
    canonicalCommand(
      "storyKnowledge.archive",
      "Archive or restore story knowledge",
      "project",
      "storyKnowledge.setArchived"
    )
  ]);

export const SCENE_WORKSPACE_CAPABILITY = Object.freeze({
  id: "scene.workspace.read",
  title: "Read an owned scene writing workspace",
  access: "read",
  scope: "scene",
  coreUseCase: "getSceneWorkspace",
  bindings: Object.freeze({
    web: "GET /api/projects/{projectId}/scenes/{sceneId}/workspace",
    mcpException:
      "Scene-body reads require authenticated project authority that the current MCP binding does not have."
  })
}) satisfies GhostwriterCapability;

export const SCENE_HISTORY_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    Object.freeze({
      id: "scene.history.read",
      title: "List a scene's immutable revisions and named variants",
      access: "read",
      scope: "scene",
      coreUseCase: "listSceneRevisions + listNamedSceneVariants",
      bindings: Object.freeze({
        web: "GET /api/projects/{projectId}/scenes/{sceneId}/history",
        mcpException:
          "Scene history reads require authenticated project authority that the current MCP binding does not have."
      })
    }),
    Object.freeze({
      id: "scene.revisions.compare",
      title: "Compare two immutable scene revisions",
      access: "read",
      scope: "scene",
      coreUseCase: "compareSceneRevisions",
      bindings: Object.freeze({
        web: "POST /api/projects/{projectId}/scenes/{sceneId}/compare",
        mcpException:
          "Scene comparison reveals requested prose and requires authenticated project authority that the current MCP binding does not have."
      })
    })
  ]);

function sceneWritingMutation(
  id: string,
  title: string,
  coreUseCase: string,
  web: string
): GhostwriterCapability {
  return Object.freeze({
    id,
    title,
    access: "apply",
    scope: "scene",
    coreUseCase,
    bindings: Object.freeze({
      web,
      mcpException: MCP_CANONICAL_MUTATION_EXCEPTION
    })
  });
}

export const SCENE_WRITING_MUTATION_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    sceneWritingMutation(
      "scene.lease.acquire",
      "Acquire or renew a scene editing lease",
      "acquireOrRenewSceneLease",
      "POST /api/projects/{projectId}/scenes/{sceneId}/lease"
    ),
    sceneWritingMutation(
      "scene.lease.release",
      "Release a scene editing lease",
      "releaseSceneLease",
      "DELETE /api/projects/{projectId}/scenes/{sceneId}/lease"
    ),
    sceneWritingMutation(
      "scene.document.save",
      "Save an acknowledged scene document",
      "saveWorkingSceneDocument",
      "PATCH /api/projects/{projectId}/scenes/{sceneId}/body"
    ),
    sceneWritingMutation(
      "scene.checkpoint.create",
      "Create an immutable scene checkpoint",
      "createManualCheckpoint",
      "POST /api/projects/{projectId}/scenes/{sceneId}/checkpoints"
    ),
    sceneWritingMutation(
      "scene.variant.create",
      "Name the current scene revision as a variant",
      "createNamedSceneVariant",
      "POST /api/projects/{projectId}/scenes/{sceneId}/variants"
    ),
    sceneWritingMutation(
      "scene.revision.restore",
      "Restore a scene revision as new history",
      "restoreSceneRevision",
      "POST /api/projects/{projectId}/scenes/{sceneId}/restore"
    )
  ]);

export const CANVAS_READ_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    Object.freeze({
      id: "canvas.board.read",
      title: "Read a project's canonical Story Canvas and manuscript spine",
      access: "read",
      scope: "project",
      coreUseCase: "getCanvasWorkspace",
      bindings: Object.freeze({
        web: "GET /api/projects/{projectId}/canvas",
        mcpException:
          "Canvas reads require authenticated project authority that the current MCP binding does not have."
      })
    }),
    Object.freeze({
      id: "canvas.history.read",
      title: "List immutable Story Canvas snapshot history",
      access: "read",
      scope: "project",
      coreUseCase: "listCanvasHistory",
      bindings: Object.freeze({
        web: "GET /api/projects/{projectId}/canvas/history",
        mcpException:
          "Canvas history reads require authenticated project authority that the current MCP binding does not have."
      })
    }),
    Object.freeze({
      id: "canvas.preference.read",
      title: "Read a writer's Story Canvas viewport preference",
      access: "read",
      scope: "project",
      coreUseCase: "getCanvasViewportPreference",
      bindings: Object.freeze({
        web: "GET /api/projects/{projectId}/canvas/preference",
        mcpException:
          "Personal viewport state is account-scoped and unavailable to the current MCP binding."
      })
    })
  ]);

export const CANVAS_MUTATION_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    Object.freeze({
      id: "canvas.command.apply",
      title: "Apply one guarded Story Canvas command",
      access: "apply",
      scope: "project",
      coreUseCase: "executeCanvasCommand",
      bindings: Object.freeze({
        web: "POST /api/projects/{projectId}/canvas/commands",
        mcpException: MCP_CANONICAL_MUTATION_EXCEPTION
      })
    }),
    Object.freeze({
      id: "canvas.history.restore",
      title: "Restore or undo to a Story Canvas snapshot",
      access: "apply",
      scope: "project",
      coreUseCase: "restoreCanvasRevision + undoCanvas",
      bindings: Object.freeze({
        web: "POST /api/projects/{projectId}/canvas/history/restore",
        mcpException: MCP_CANONICAL_MUTATION_EXCEPTION
      })
    }),
    Object.freeze({
      id: "canvas.preference.save",
      title: "Save a writer's Story Canvas viewport preference",
      access: "apply",
      scope: "project",
      coreUseCase: "saveCanvasViewportPreference",
      bindings: Object.freeze({
        web: "PUT /api/projects/{projectId}/canvas/preference",
        mcpException:
          "Personal viewport preferences are account-scoped and unavailable to the current MCP binding."
      })
    }),
    Object.freeze({
      id: "canvas.scene.create",
      title: "Create a canonical scene and place its Story Canvas card atomically",
      access: "apply",
      scope: "project",
      coreUseCase: "createSceneFromCanvas",
      bindings: Object.freeze({
        web: "POST /api/projects/{projectId}/canvas/scenes",
        mcpException: MCP_CANONICAL_MUTATION_EXCEPTION
      })
    })
  ]);

export const BOOK_READER_CAPABILITY = Object.freeze({
  id: "book.reader.read",
  title: "Read a book manuscript in the bound reader",
  access: "read",
  scope: "book",
  coreUseCase: "getBookReader",
  bindings: Object.freeze({
    ui: "BookReaderPanel",
    web: "GET /api/projects/{projectId}/books/{bookId}/reader",
    mcpException:
      "Book reader prose reads require authenticated project authority that the current MCP binding does not have."
  })
}) satisfies GhostwriterCapability;

export const GHOSTWRITER_CAPABILITIES: readonly GhostwriterCapability[] = Object.freeze([
  PROJECT_NAVIGATOR_CAPABILITY,
  ...PROJECT_COMMAND_CAPABILITIES,
  SCENE_WORKSPACE_CAPABILITY,
  ...SCENE_HISTORY_CAPABILITIES,
  ...SCENE_WRITING_MUTATION_CAPABILITIES,
  ...CANVAS_READ_CAPABILITIES,
  ...CANVAS_MUTATION_CAPABILITIES,
  BOOK_READER_CAPABILITY
]);
