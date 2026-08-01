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
      "part.update",
      "Update manuscript part metadata",
      "book",
      "part.update"
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

export const CAPTURE_READ_CAPABILITY = Object.freeze({
  id: "capture.read",
  title: "Read one owned Capture working document",
  access: "read",
  scope: "project",
  coreUseCase: "getCapture",
  bindings: Object.freeze({
    ui: "CaptureComposer",
    web: "GET /api/projects/{projectId}/captures/{captureId}",
    mcp: "ghostwriter_read_capture"
  })
}) satisfies GhostwriterCapability;

export const CAPTURE_LIST_CAPABILITY = Object.freeze({
  id: "capture.list",
  title: "List owned Capture summaries for a project",
  access: "read",
  scope: "project",
  coreUseCase: "listCaptures",
  bindings: Object.freeze({
    ui: "InboxPanel",
    web: "GET /api/projects/{projectId}/captures",
    mcpException:
      "Capture list reads require authenticated project authority that the current MCP binding does not have."
  })
}) satisfies GhostwriterCapability;

function captureMutation(
  id: string,
  title: string,
  coreUseCase: string,
  web: string,
  ui: string
): GhostwriterCapability {
  return Object.freeze({
    id,
    title,
    access: "apply",
    scope: "project",
    coreUseCase,
    bindings: Object.freeze({
      ui,
      web,
      mcpException: MCP_CANONICAL_MUTATION_EXCEPTION
    })
  });
}

export const CAPTURE_MUTATION_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    captureMutation(
      "capture.create",
      "Create a noncanonical Capture",
      "createCapture",
      "POST /api/projects/{projectId}/captures",
      "CaptureComposer"
    ),
    captureMutation(
      "capture.document.save",
      "Save an acknowledged Capture document",
      "saveCaptureDocument",
      "PATCH /api/projects/{projectId}/captures/{captureId}/body",
      "CaptureComposer"
    ),
    captureMutation(
      "capture.archive",
      "Archive or restore a Capture",
      "setCaptureArchived",
      "POST /api/projects/{projectId}/captures/{captureId}/archive",
      "InboxPanel"
    ),
    captureMutation(
      "capture.promote",
      "Promote an acknowledged Capture into a new Scene",
      "promoteCaptureToScene",
      "POST /api/projects/{projectId}/captures/{captureId}/promote",
      "InboxPanel"
    )
  ]);

function captureAttachmentMutation(
  id: string,
  title: string,
  coreUseCase: string,
  web: string,
  ui: string
): GhostwriterCapability {
  return Object.freeze({
    id,
    title,
    access: "apply",
    scope: "project",
    coreUseCase,
    bindings: Object.freeze({
      ui,
      web,
      mcpException:
        "Capture attachment mutations require authenticated project authority and private object storage that the current MCP binding does not have."
    })
  });
}

function captureAttachmentRead(
  id: string,
  title: string,
  coreUseCase: string,
  web: string,
  ui: string
): GhostwriterCapability {
  return Object.freeze({
    id,
    title,
    access: "read",
    scope: "project",
    coreUseCase,
    bindings: Object.freeze({
      ui,
      web,
      mcpException:
        "Capture attachment reads require authenticated project authority that the current MCP binding does not have."
    })
  });
}

export const CAPTURE_ATTACHMENT_CAPABILITIES: readonly GhostwriterCapability[] =
  Object.freeze([
    captureAttachmentMutation(
      "capture.attachment.init",
      "Reserve a bounded private Capture attachment upload",
      "initAttachmentUpload",
      "POST /api/projects/{projectId}/captures/{captureId}/attachments/init",
      "CaptureComposer"
    ),
    captureAttachmentMutation(
      "capture.attachment.finalize",
      "Finalize a server-inspected Capture attachment upload",
      "finalizeAttachmentUpload",
      "POST /api/projects/{projectId}/captures/{captureId}/attachments/{attachmentId}/finalize",
      "CaptureComposer"
    ),
    captureAttachmentRead(
      "capture.attachment.list",
      "List Capture attachment metadata for a project Capture",
      "listAttachments",
      "GET /api/projects/{projectId}/captures/{captureId}/attachments",
      "InboxPanel"
    ),
    captureAttachmentRead(
      "capture.attachment.download",
      "Issue a short-lived Capture attachment download URL",
      "getAttachmentDownloadUrl",
      "POST /api/projects/{projectId}/captures/{captureId}/attachments/{attachmentId}/download",
      "InboxPanel"
    ),
    captureAttachmentMutation(
      "capture.attachment.delete",
      "Delete a Capture attachment and record a tombstone",
      "deleteAttachment",
      "DELETE /api/projects/{projectId}/captures/{captureId}/attachments/{attachmentId}",
      "InboxPanel"
    )
  ]);

export const WRITING_ASSIST_CAPABILITY = Object.freeze({
  id: "writing.assist.propose",
  title: "Propose writing-assist craft or prose variants",
  access: "propose",
  scope: "scene",
  coreUseCase: "buildDeterministicWritingAssistProposals",
  bindings: Object.freeze({
    ui: "WritingAssistPanel",
    web: "POST /api/projects/{projectId}/writing-assist",
    mcpException:
      "Writing-assist proposals stay human-gated in the Write studio until scoped agent grants are accepted."
  })
}) satisfies GhostwriterCapability;

const AGENT_MCP_DEFER =
  "Agent account/guidance surfaces stay first-party; scoped MCP grants cover Capture reflection read/propose only.";

const MCP_GRANT_APPLY_EXCEPTION =
  "External MCP clients may submit typed proposals under a scoped grant but cannot apply, reject, cancel, or mutate grants; apply remains first-party UI authority (ADR 0011).";

export const MCP_GRANT_DISCOVER_CAPABILITY = Object.freeze({
  id: "mcp.grant.discover",
  title: "Discover the active project-scoped MCP grant",
  access: "read",
  scope: "project",
  coreUseCase: "getGrantUnderToken",
  bindings: Object.freeze({
    mcp: "ghostwriter_get_grant"
  })
}) satisfies GhostwriterCapability;

export const MCP_GRANT_MANAGE_CAPABILITY = Object.freeze({
  id: "mcp.grant.manage",
  title: "Create and revoke project-scoped MCP grants",
  access: "apply",
  scope: "project",
  coreUseCase: "createGrant",
  bindings: Object.freeze({
    web: "POST|DELETE /api/projects/{projectId}/mcp-grants",
    mcpException:
      "Grant minting and revocation are first-party owner operations; MCP clients cannot widen or recreate grants."
  })
}) satisfies GhostwriterCapability;

export const ACCOUNT_PROVIDER_CREDENTIAL_MANAGE_CAPABILITY = Object.freeze({
  id: "account.providerCredential.manage",
  title: "Manage encrypted OpenAI provider credentials",
  access: "apply",
  scope: "account",
  coreUseCase: "setOpenAiCredential",
  bindings: Object.freeze({
    mcpException:
      "Provider credentials are never available through MCP; decryption is confined to the backend provider adapter."
  })
}) satisfies GhostwriterCapability;

export const ACCOUNT_AI_COLLABORATION_READ_CAPABILITY = Object.freeze({
  id: "account.aiCollaboration.read",
  title: "Read account AI collaboration preferences",
  access: "read",
  scope: "account",
  coreUseCase: "getAccountAiCollaborationProfile",
  bindings: Object.freeze({
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const ACCOUNT_AI_COLLABORATION_UPDATE_CAPABILITY = Object.freeze({
  id: "account.aiCollaboration.update",
  title: "Update account AI collaboration preferences",
  access: "apply",
  scope: "account",
  coreUseCase: "saveAccountAiCollaborationProfile",
  bindings: Object.freeze({
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const PROJECT_AGENT_INSTRUCTIONS_READ_CAPABILITY = Object.freeze({
  id: "project.agentInstructions.read",
  title: "Read project agent instructions",
  access: "read",
  scope: "project",
  coreUseCase: "getProjectAgentInstructions",
  bindings: Object.freeze({
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const PROJECT_AGENT_INSTRUCTIONS_UPDATE_CAPABILITY = Object.freeze({
  id: "project.agentInstructions.update",
  title: "Update project agent instructions",
  access: "apply",
  scope: "project",
  coreUseCase: "saveProjectAgentInstructions",
  bindings: Object.freeze({
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const PROJECT_PLAYBOOK_READ_CAPABILITY = Object.freeze({
  id: "project.playbook.read",
  title: "Read declarative project playbooks",
  access: "read",
  scope: "project",
  coreUseCase: "listProjectPlaybooks",
  bindings: Object.freeze({
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const PROJECT_PLAYBOOK_UPDATE_CAPABILITY = Object.freeze({
  id: "project.playbook.update",
  title: "Create or update declarative project playbooks",
  access: "apply",
  scope: "project",
  coreUseCase: "saveProjectPlaybook",
  bindings: Object.freeze({
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const PROJECT_CATALOG_PLAYBOOK_READ_CAPABILITY = Object.freeze({
  id: "project.catalogPlaybook.read",
  title: "Read effective catalog agent playbooks",
  access: "read",
  scope: "project",
  coreUseCase: "CatalogPlaybookOverrideServices.get/list",
  bindings: Object.freeze({
    ui: "SettingsPanel · Playbooks",
    web: "GET /api/projects/{projectId}/catalog-playbooks",
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const PROJECT_CATALOG_PLAYBOOK_UPDATE_CAPABILITY = Object.freeze({
  id: "project.catalogPlaybook.update",
  title: "Customize project catalog agent playbooks",
  access: "apply",
  scope: "project",
  coreUseCase: "CatalogPlaybookOverrideServices.upsert/reset",
  bindings: Object.freeze({
    ui: "SettingsPanel · Playbooks",
    web: "PUT|DELETE /api/projects/{projectId}/catalog-playbooks/{agentId}",
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const AGENT_CONTEXT_PREVIEW_CAPABILITY = Object.freeze({
  id: "agent.context.preview",
  title: "Preview compiled agent context and egress receipt",
  access: "read",
  scope: "project",
  coreUseCase: "compileCaptureReflectionInstructions",
  bindings: Object.freeze({
    ui: "CaptureHandoffPanel",
    web: "POST /api/projects/{projectId}/agent/context-preview",
    mcp: "ghostwriter_assemble_capture_reflection_context"
  })
}) satisfies GhostwriterCapability;

export const AGENT_RUN_CREATE_CAPABILITY = Object.freeze({
  id: "agent.run.create",
  title: "Queue a receipt-backed agent run",
  access: "propose",
  scope: "project",
  coreUseCase: "queueRun",
  bindings: Object.freeze({
    ui: "CaptureHandoffPanel",
    web: "POST /api/projects/{projectId}/agent/runs",
    mcp: "ghostwriter_propose_capture_reflection"
  })
}) satisfies GhostwriterCapability;

export const CATALOG_AGENT_RUN_CREATE_CAPABILITY = Object.freeze({
  id: "agent.catalogRun.create",
  title: "Create a catalog craft memo proposal",
  access: "propose",
  scope: "project",
  coreUseCase: "runCatalogAgent",
  bindings: Object.freeze({
    ui: "WorkspaceChatPanel + EntityDraftsPanel",
    web: "POST /api/projects/{projectId}/agent/catalog-runs",
    mcpException:
      "Catalog memo runs are first-party until scoped non-Capture context grants are designed."
  })
}) satisfies GhostwriterCapability;

export const AGENT_RUN_READ_CAPABILITY = Object.freeze({
  id: "agent.run.read",
  title: "Read agent run summaries and detail for a project",
  access: "read",
  scope: "project",
  coreUseCase: "getRun",
  bindings: Object.freeze({
    ui: "InboxPanel",
    mcpException: AGENT_MCP_DEFER
  })
}) satisfies GhostwriterCapability;

export const AGENT_RUN_CANCEL_CAPABILITY = Object.freeze({
  id: "agent.run.cancel",
  title: "Cancel a queued or running agent run",
  access: "apply",
  scope: "project",
  coreUseCase: "cancelRun",
  bindings: Object.freeze({
    ui: "InboxPanel",
    mcpException: MCP_GRANT_APPLY_EXCEPTION
  })
}) satisfies GhostwriterCapability;

export const AGENT_PROPOSAL_READ_CAPABILITY = Object.freeze({
  id: "agent.proposal.read",
  title: "Read agent proposal summaries and detail for a project",
  access: "read",
  scope: "project",
  coreUseCase: "getProposal",
  bindings: Object.freeze({
    ui: "InboxPanel",
    web: "GET /api/projects/{projectId}/agent/proposals",
    mcpException:
      "Proposal listing stays first-party; MCP clients create proposals into the same Inbox without project-wide enumeration."
  })
}) satisfies GhostwriterCapability;

export const AGENT_PROPOSAL_REJECT_CAPABILITY = Object.freeze({
  id: "agent.proposal.reject",
  title: "Reject a ready agent proposal",
  access: "apply",
  scope: "project",
  coreUseCase: "rejectProposal",
  bindings: Object.freeze({
    ui: "InboxPanel",
    mcpException: MCP_GRANT_APPLY_EXCEPTION
  })
}) satisfies GhostwriterCapability;

export const AGENT_PROPOSAL_APPLY_CAPABILITY = Object.freeze({
  id: "agent.proposal.apply",
  title: "Apply an exact agent proposal hash",
  access: "apply",
  scope: "project",
  coreUseCase: "applyProposal",
  bindings: Object.freeze({
    ui: "InboxPanel",
    web: "POST /api/projects/{projectId}/agent/proposals/{proposalId}/apply",
    mcpException: MCP_GRANT_APPLY_EXCEPTION
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
  CAPTURE_READ_CAPABILITY,
  CAPTURE_LIST_CAPABILITY,
  ...CAPTURE_MUTATION_CAPABILITIES,
  ...CAPTURE_ATTACHMENT_CAPABILITIES,
  BOOK_READER_CAPABILITY,
  WRITING_ASSIST_CAPABILITY,
  ACCOUNT_PROVIDER_CREDENTIAL_MANAGE_CAPABILITY,
  ACCOUNT_AI_COLLABORATION_READ_CAPABILITY,
  ACCOUNT_AI_COLLABORATION_UPDATE_CAPABILITY,
  PROJECT_AGENT_INSTRUCTIONS_READ_CAPABILITY,
  PROJECT_AGENT_INSTRUCTIONS_UPDATE_CAPABILITY,
  PROJECT_PLAYBOOK_READ_CAPABILITY,
  PROJECT_PLAYBOOK_UPDATE_CAPABILITY,
  PROJECT_CATALOG_PLAYBOOK_READ_CAPABILITY,
  PROJECT_CATALOG_PLAYBOOK_UPDATE_CAPABILITY,
  MCP_GRANT_DISCOVER_CAPABILITY,
  MCP_GRANT_MANAGE_CAPABILITY,
  AGENT_CONTEXT_PREVIEW_CAPABILITY,
  AGENT_RUN_CREATE_CAPABILITY,
  CATALOG_AGENT_RUN_CREATE_CAPABILITY,
  AGENT_RUN_READ_CAPABILITY,
  AGENT_RUN_CANCEL_CAPABILITY,
  AGENT_PROPOSAL_READ_CAPABILITY,
  AGENT_PROPOSAL_REJECT_CAPABILITY,
  AGENT_PROPOSAL_APPLY_CAPABILITY
]);
