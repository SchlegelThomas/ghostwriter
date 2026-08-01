import { afterEach, describe, expect, it, vi } from "vitest";
import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { bookId, canvasObjectId, canvasRevisionId, chapterId } from "@ghostwriter/core";
import {
  acquireSceneLease,
  compareSceneRevisions,
  createCapture,
  createSceneFromCanvas,
  createSceneCheckpoint,
  createSceneVariant,
  executeCanvasCommand,
  getCanvasBoard,
  getCanvasHistory,
  getCanvasPreference,
  getCapture,
  getSceneHistory,
  getSceneWorkspace,
  deleteCaptureAttachment,
  finalizeCaptureAttachmentUpload,
  getCaptureAttachmentDownloadUrl,
  GhostwriterApiError,
  initCaptureAttachmentUpload,
  listCaptureAttachments,
  listCaptures,
  promoteCaptureToScene,
  releaseSceneLease,
  renewSceneLease,
  restoreCanvasRevision,
  restoreSceneRevision,
  saveCaptureDocument,
  saveCanvasPreference,
  saveSceneDocument,
  setCaptureArchived,
  signOut,
  undoCanvas,
  getOpenAiProviderStatus,
  previewCaptureReflectionContext,
  startCaptureReflectionRun,
  rejectAgentProposal,
  applyAgentProposal
} from "./api.js";

const sceneScope = {
  projectId: "project / draft",
  sceneId: "scene / opening"
} as const;
const captureScope = {
  projectId: "project / draft",
  captureId: "capture / inbox"
} as const;
const document: SceneDocumentV1 = {
  schemaVersion: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: blockId("block-api-client") },
        content: [{ type: "text", text: "Harbor prose." }]
      }
    ]
  }
};
const captureHead = {
  captureId: captureScope.captureId,
  projectId: captureScope.projectId,
  status: "draft",
  sourceModality: "text",
  workingVersion: 1,
  document,
  contentHash: "c".repeat(64),
  genesisRevisionId: "capture-revision-genesis",
  authorAccountId: "account-writer",
  updatedByAccountId: "account-writer",
  createdAt: "2026-07-12T18:00:00.000Z",
  updatedAt: "2026-07-12T18:00:00.000Z"
} as const;
const captureSummary = {
  captureId: captureHead.captureId,
  projectId: captureHead.projectId,
  status: captureHead.status,
  sourceModality: captureHead.sourceModality,
  workingVersion: captureHead.workingVersion,
  authorAccountId: captureHead.authorAccountId,
  createdAt: captureHead.createdAt,
  updatedAt: captureHead.updatedAt
} as const;
const head = {
  sceneId: sceneScope.sceneId,
  projectId: sceneScope.projectId,
  workingVersion: 3,
  document,
  contentHash: "a".repeat(64),
  checkpointRevisionId: "revision-genesis",
  updatedByAccountId: "account-writer",
  createdAt: "2026-07-12T18:00:00.000Z",
  updatedAt: "2026-07-12T18:01:00.000Z"
} as const;
const lease = {
  heldByCurrentSession: true,
  renewedAt: "2026-07-12T18:01:00.000Z",
  expiresAt: "2026-07-12T18:02:00.000Z"
} as const;
const revision = {
  id: "revision-checkpoint",
  sceneId: sceneScope.sceneId,
  projectId: sceneScope.projectId,
  parentRevisionId: "revision-genesis",
  schemaVersion: 1,
  contentHash: "b".repeat(64),
  actorAccountId: "account-writer",
  origin: "human",
  reason: "checkpoint",
  createdAt: "2026-07-12T18:03:00.000Z"
} as const;
const headMetadata = {
  sceneId: head.sceneId,
  projectId: head.projectId,
  workingVersion: 4,
  contentHash: revision.contentHash,
  checkpointRevisionId: revision.id,
  updatedByAccountId: head.updatedByAccountId,
  createdAt: head.createdAt,
  updatedAt: revision.createdAt
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ghostwriter API client", () => {
  it("sends a valid empty JSON document when signing out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        }
      })
    );
  });

  it("loads the typed scene workspace from encoded project and scene paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        head,
        lease: null
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSceneWorkspace(sceneScope)).resolves.toEqual({
      head,
      lease: null
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/workspace",
      expect.objectContaining({
        credentials: "include",
        headers: { accept: "application/json" }
      })
    );
  });

  it("acquires and renews a scene lease without sending a JSON body", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json({ lease }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(acquireSceneLease(sceneScope)).resolves.toEqual(lease);
    await expect(renewSceneLease(sceneScope)).resolves.toEqual(lease);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/lease",
      {
        credentials: "include",
        headers: { accept: "application/json" },
        method: "POST"
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/lease",
      {
        credentials: "include",
        headers: { accept: "application/json" },
        method: "POST"
      }
    );
  });

  it("releases a scene lease from a 204 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(releaseSceneLease(sceneScope)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/lease",
      {
        credentials: "include",
        headers: { accept: "application/json" },
        keepalive: true,
        method: "DELETE"
      }
    );
  });

  it("sends the acknowledged working version and schema JSON when saving", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        head: { ...head, workingVersion: 4 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveSceneDocument({
        ...sceneScope,
        expectedWorkingVersion: 3,
        document
      })
    ).resolves.toMatchObject({ workingVersion: 4, document });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/body",
      {
        body: JSON.stringify({
          expectedWorkingVersion: 3,
          document
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "PATCH"
      }
    );
  });

  it("loads metadata-only scene history from the encoded scene path", async () => {
    const variant = {
      id: "variant-alternate",
      sceneId: sceneScope.sceneId,
      projectId: sceneScope.projectId,
      revisionId: revision.id,
      creatorAccountId: "account-writer",
      name: "Alternate ending",
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ revisions: [revision], variants: [variant] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSceneHistory(sceneScope)).resolves.toEqual({
      revisions: [revision],
      variants: [variant]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/history",
      {
        credentials: "include",
        headers: { accept: "application/json" }
      }
    );
  });

  it("sends only the working version when creating a checkpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ head: headMetadata, revision, created: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createSceneCheckpoint({ ...sceneScope, expectedWorkingVersion: 3 })
    ).resolves.toMatchObject({ revision, created: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/checkpoints",
      {
        body: JSON.stringify({ expectedWorkingVersion: 3 }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("sends the working version and name when creating a variant", async () => {
    const variant = {
      id: "variant-alternate",
      sceneId: sceneScope.sceneId,
      projectId: sceneScope.projectId,
      revisionId: revision.id,
      creatorAccountId: "account-writer",
      name: "Alternate ending",
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt
    } as const;
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        head: headMetadata,
        revision,
        variant,
        checkpointCreated: true
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createSceneVariant({
        ...sceneScope,
        expectedWorkingVersion: 3,
        name: "Alternate ending"
      })
    ).resolves.toMatchObject({ variant, checkpointCreated: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/variants",
      {
        body: JSON.stringify({
          expectedWorkingVersion: 3,
          name: "Alternate ending"
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("sends both immutable revision IDs when comparing checkpoints", async () => {
    const comparison = {
      equal: false,
      blocks: [
        {
          blockId: document.document.content[0]?.attrs.id,
          beforeIndex: 0,
          afterIndex: 0,
          changes: ["changed"],
          before: document.document.content[0],
          after: document.document.content[0]
        }
      ]
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        beforeRevision: { ...revision, id: "revision-before" },
        afterRevision: revision,
        comparison
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      compareSceneRevisions({
        ...sceneScope,
        beforeRevisionId: "revision-before",
        afterRevisionId: revision.id
      })
    ).resolves.toMatchObject({ comparison: { equal: false } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/compare",
      {
        body: JSON.stringify({
          beforeRevisionId: "revision-before",
          afterRevisionId: revision.id
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("sends the selected revision and current working version when restoring", async () => {
    const restoredHead = {
      ...head,
      workingVersion: 5,
      checkpointRevisionId: "revision-restored"
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        head: restoredHead,
        revision: { ...revision, id: "revision-restored", reason: "restore" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      restoreSceneRevision({
        ...sceneScope,
        expectedWorkingVersion: 4,
        revisionId: revision.id
      })
    ).resolves.toMatchObject({ head: restoredHead });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/scenes/scene%20%2F%20opening/restore",
      {
        body: JSON.stringify({
          expectedWorkingVersion: 4,
          revisionId: revision.id
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("loads a strict Canvas workspace from an encoded project path", async () => {
    const canvasWorkspace = {
      board: {
        projectId: sceneScope.projectId,
        version: 1,
        objects: [],
        links: [],
        createdAt: "2026-07-12T19:00:00.000Z",
        updatedAt: "2026-07-12T19:00:00.000Z"
      },
      spine: {
        projectId: sceneScope.projectId,
        projectVersion: 3,
        canvasVersion: 1,
        entries: []
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(canvasWorkspace));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCanvasBoard(sceneScope.projectId)).resolves.toEqual(
      canvasWorkspace
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/canvas",
      {
        credentials: "include",
        headers: { accept: "application/json" }
      }
    );
  });

  it("sends exactly one guarded Canvas command with its expected version", async () => {
    const objectId = canvasObjectId("canvas-object-client");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        board: {
          projectId: sceneScope.projectId,
          version: 5,
          objects: [],
          links: [],
          createdAt: "2026-07-12T19:00:00.000Z",
          updatedAt: "2026-07-12T19:05:00.000Z"
        },
        spine: {
          projectId: sceneScope.projectId,
          projectVersion: 3,
          canvasVersion: 5,
          entries: []
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeCanvasCommand({
      projectId: sceneScope.projectId,
      expectedCanvasVersion: 4,
      command: {
        type: "canvas.object.move",
        objectId,
        x: 480,
        y: 260
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/canvas/commands",
      {
        body: JSON.stringify({
          expectedCanvasVersion: 4,
          command: {
            type: "canvas.object.move",
            objectId,
            x: 480,
            y: 260
          }
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("loads Canvas history and distinguishes undo from revision restore", async () => {
    const revisionId = canvasRevisionId("canvas-revision-client");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ revisions: [] }))
      .mockResolvedValueOnce(Response.json({ board: {}, spine: {} }))
      .mockResolvedValueOnce(Response.json({ board: {}, spine: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await getCanvasHistory(sceneScope.projectId);
    await undoCanvas({
      projectId: sceneScope.projectId,
      expectedCanvasVersion: 8
    });
    await restoreCanvasRevision({
      projectId: sceneScope.projectId,
      expectedCanvasVersion: 9,
      revisionId
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project%20%2F%20draft/canvas/history",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/canvas/history/restore",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedCanvasVersion: 8 })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/projects/project%20%2F%20draft/canvas/history/restore",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedCanvasVersion: 9,
          revisionId
        })
      })
    );
  });

  it("gets and saves personal Canvas viewport without a board version", async () => {
    const objectId = canvasObjectId("canvas-object-preference");
    const preference = {
      projectId: sceneScope.projectId,
      accountId: "account-writer",
      x: 120,
      y: -40,
      zoom: 1.25,
      selectedObjectId: objectId,
      updatedAt: "2026-07-12T19:10:00.000Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ preference: null }))
      .mockResolvedValueOnce(Response.json({ preference }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCanvasPreference(sceneScope.projectId)).resolves.toBeNull();
    await expect(
      saveCanvasPreference({
        projectId: sceneScope.projectId,
        x: 120,
        y: -40,
        zoom: 1.25,
        selectedObjectId: objectId
      })
    ).resolves.toEqual(preference);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/canvas/preference",
      {
        body: JSON.stringify({
          x: 120,
          y: -40,
          zoom: 1.25,
          selectedObjectId: objectId
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "PUT"
      }
    );
  });

  it("sends atomic scene handoff placement and initial Canvas geometry", async () => {
    const firstBookId = bookId("book-canvas-client");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        scene: { id: "scene-created", title: "Signal fire" },
        sceneDocumentHead: head,
        navigator: { id: sceneScope.projectId, version: 7 },
        canvas: { board: { version: 4 }, spine: { canvasVersion: 4 } }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createSceneFromCanvas({
      projectId: sceneScope.projectId,
      expectedProjectVersion: 6,
      expectedCanvasVersion: 3,
      title: "Signal fire",
      manuscriptPlacement: {
        kind: "unassigned",
        bookId: firstBookId
      },
      canvas: {
        x: 640,
        y: 280,
        width: 260,
        height: 160,
        z: 3,
        storyOrderHint: 1
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/canvas/scenes",
      {
        body: JSON.stringify({
          expectedProjectVersion: 6,
          expectedCanvasVersion: 3,
          title: "Signal fire",
          manuscriptPlacement: {
            kind: "unassigned",
            bookId: firstBookId
          },
          canvas: {
            x: 640,
            y: 280,
            width: 260,
            height: 160,
            z: 3,
            storyOrderHint: 1
          }
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("preserves Canvas conflict codes for the client reload state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: "The Canvas changed since it was loaded.",
          code: "CANVAS_VERSION_CONFLICT"
        },
        { status: 409 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      undoCanvas({
        projectId: sceneScope.projectId,
        expectedCanvasVersion: 2
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GhostwriterApiError>>({
        status: 409,
        code: "CANVAS_VERSION_CONFLICT"
      })
    );
  });

  it("preserves typed JSON errors for failed lease requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: "The scene is being edited elsewhere.",
          code: "LEASE_CONFLICT"
        },
        { status: 409 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(releaseSceneLease(sceneScope)).rejects.toEqual(
      expect.objectContaining<Partial<GhostwriterApiError>>({
        status: 409,
        code: "LEASE_CONFLICT",
        message: "The scene is being edited elsewhere."
      })
    );
  });

  it("creates a capture with the default text modality without a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ head: captureHead }, { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createCapture({ projectId: captureScope.projectId })).resolves.toEqual(
      captureHead
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/captures",
      {
        credentials: "include",
        headers: { accept: "application/json" },
        method: "POST"
      }
    );
  });

  it("loads a capture from encoded project and capture paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ head: captureHead }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCapture(captureScope)).resolves.toEqual(captureHead);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox",
      {
        credentials: "include",
        headers: { accept: "application/json" }
      }
    );
  });

  it("requests archived captures only when includeArchived is true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ captures: [captureSummary] }))
      .mockResolvedValueOnce(Response.json({ captures: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listCaptures(captureScope.projectId)).resolves.toEqual([
      captureSummary
    ]);
    await expect(listCaptures(captureScope.projectId, true)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project%20%2F%20draft/captures",
      expect.objectContaining({
        credentials: "include",
        headers: { accept: "application/json" }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/captures?includeArchived=true",
      expect.objectContaining({
        credentials: "include",
        headers: { accept: "application/json" }
      })
    );
  });

  it("sends the acknowledged working version when saving a capture document", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        head: { ...captureHead, workingVersion: 2 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveCaptureDocument({
        ...captureScope,
        expectedWorkingVersion: 1,
        document
      })
    ).resolves.toMatchObject({ workingVersion: 2, document });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/body",
      {
        body: JSON.stringify({
          expectedWorkingVersion: 1,
          document
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "PATCH"
      }
    );
  });

  it("archives and restores captures through the archive route", async () => {
    const archivedHead = {
      ...captureHead,
      status: "archived",
      archivedAt: "2026-07-12T18:05:00.000Z"
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ head: archivedHead }))
      .mockResolvedValueOnce(Response.json({ head: captureHead }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      setCaptureArchived({ ...captureScope, archived: true })
    ).resolves.toEqual(archivedHead);
    await expect(
      setCaptureArchived({ ...captureScope, archived: false })
    ).resolves.toEqual(captureHead);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/archive",
      {
        body: JSON.stringify({ archived: true }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/archive",
      {
        body: JSON.stringify({ archived: false }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("preserves capture version conflict codes for client recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: "The capture changed since it was loaded.",
          code: "CAPTURE_VERSION_CONFLICT"
        },
        { status: 409 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveCaptureDocument({
        ...captureScope,
        expectedWorkingVersion: 1,
        document
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GhostwriterApiError>>({
        status: 409,
        code: "CAPTURE_VERSION_CONFLICT",
        message: "The capture changed since it was loaded."
      })
    );
  });

  it("promotes captures without Canvas geometry when placement is unassigned", async () => {
    const integratedCaptureHead = {
      ...captureHead,
      status: "integrated",
      workingVersion: 2,
      integrationRevisionId: "capture-revision-integrated",
      integratedSceneId: "scene-from-inbox",
      integratedAt: "2026-07-12T19:00:00.000Z",
      integratedByAccountId: "account-writer"
    };
    const promoteResponse = {
      captureHead: integratedCaptureHead,
      scene: {
        id: "scene-from-inbox",
        title: "From the inbox",
        bookId: bookId("book-inbox")
      },
      sceneDocumentHead: head,
      navigator: { id: captureScope.projectId, version: 2 }
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(promoteResponse, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      promoteCaptureToScene({
        ...captureScope,
        expectedCaptureWorkingVersion: 1,
        expectedCaptureContentHash: captureHead.contentHash,
        expectedProjectVersion: 1,
        title: "From the inbox",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: bookId("book-inbox")
        }
      })
    ).resolves.toEqual(promoteResponse);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/promote",
      {
        body: JSON.stringify({
          expectedCaptureWorkingVersion: 1,
          expectedCaptureContentHash: captureHead.contentHash,
          expectedProjectVersion: 1,
          title: "From the inbox",
          manuscriptPlacement: {
            kind: "unassigned",
            bookId: bookId("book-inbox")
          }
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });

  it("promotes captures with chapter placement and optional Canvas board response", async () => {
    const signalBookId = bookId("book-signal");
    const lowTideChapterId = chapterId("chapter-low-tide");
    const integratedSceneId = "scene-chapter-promo";
    const promoteResponse = {
      captureHead: {
        ...captureHead,
        status: "integrated",
        integratedSceneId,
        integrationRevisionId: "capture-revision-chapter",
        integratedAt: "2026-07-12T19:05:00.000Z",
        integratedByAccountId: "account-writer"
      },
      scene: {
        id: integratedSceneId,
        title: "Chapter promotion",
        bookId: signalBookId
      },
      sceneDocumentHead: head,
      navigator: { id: captureScope.projectId, version: 3 },
      canvas: {
        board: { version: 2, objects: [], links: [], regions: [] },
        spine: { canvasVersion: 2, orderedSceneIds: [integratedSceneId] }
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(promoteResponse, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      promoteCaptureToScene({
        ...captureScope,
        expectedCaptureWorkingVersion: 1,
        expectedCaptureContentHash: captureHead.contentHash,
        expectedProjectVersion: 2,
        title: "Chapter promotion",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: signalBookId,
          chapterId: lowTideChapterId
        },
        canvas: {
          expectedCanvasVersion: 1,
          x: 120,
          y: 80,
          width: 240,
          height: 160,
          z: 3,
          storyOrderHint: 5
        }
      })
    ).resolves.toEqual(promoteResponse);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/promote",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedCaptureWorkingVersion: 1,
          expectedCaptureContentHash: captureHead.contentHash,
          expectedProjectVersion: 2,
          title: "Chapter promotion",
          manuscriptPlacement: {
            kind: "chapter",
            bookId: signalBookId,
            chapterId: lowTideChapterId
          },
          canvas: {
            expectedCanvasVersion: 1,
            x: 120,
            y: 80,
            width: 240,
            height: 160,
            z: 3,
            storyOrderHint: 5
          }
        })
      })
    );
  });

  it("preserves capture promotion conflict codes for client recovery", async () => {
    const conflicts: ReadonlyArray<
      Readonly<{ code: string; error: string; status: number }>
    > = [
      {
        code: "CAPTURE_VERSION_CONFLICT",
        error: "The capture changed since it was loaded.",
        status: 409
      },
      {
        code: "CAPTURE_CONTENT_CHANGED",
        error: "The capture changed since it was loaded.",
        status: 409
      },
      {
        code: "CAPTURE_NOT_PROMOTABLE",
        error: "This capture cannot be promoted.",
        status: 409
      }
    ];
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      const conflict = conflicts[callIndex]!;
      callIndex += 1;
      return Response.json(
        { error: conflict.error, code: conflict.code },
        { status: conflict.status }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const promoteInput = {
      ...captureScope,
      expectedCaptureWorkingVersion: 1,
      expectedCaptureContentHash: captureHead.contentHash,
      expectedProjectVersion: 1,
      title: "Should fail",
      manuscriptPlacement: {
        kind: "unassigned" as const,
        bookId: bookId("book-inbox")
      }
    };

    for (const conflict of conflicts) {
      await expect(promoteCaptureToScene(promoteInput)).rejects.toEqual(
        expect.objectContaining<Partial<GhostwriterApiError>>({
          status: conflict.status,
          code: conflict.code,
          message: conflict.error
        })
      );
    }
  });

  const attachmentScope = {
    ...captureScope,
    attachmentId: "attachment / scan"
  } as const;
  const attachmentSummary = {
    attachmentId: attachmentScope.attachmentId,
    captureId: captureScope.captureId,
    projectId: captureScope.projectId,
    state: "pending",
    displayFilename: "note.txt",
    declaredContentType: "text/plain",
    declaredByteSize: 12,
    pendingExpiresAt: "2026-07-24T13:00:00.000Z",
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z"
  } as const;

  it("initializes capture attachment uploads on encoded nested paths without extra fields", async () => {
    const initBody = {
      attachment: attachmentSummary,
      upload: {
        url: "https://objects.example.test/put/object",
        expiresAt: "2026-07-24T12:15:00.000Z"
      },
      uploadHeaders: { "Content-Type": "text/plain" }
    };
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(initBody, { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      initCaptureAttachmentUpload({
        ...captureScope,
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 12,
        clientSha256: "a".repeat(64)
      })
    ).resolves.toEqual(initBody);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/attachments/init",
      {
        body: JSON.stringify({
          displayFilename: "note.txt",
          declaredContentType: "text/plain",
          declaredByteSize: 12,
          clientSha256: "a".repeat(64)
        }),
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
    expect(JSON.stringify(initBody.attachment)).not.toMatch(/objectKey|clientSha256/);
  });

  it("finalizes, lists, downloads, and deletes attachments through encoded paths", async () => {
    const readyAttachment = {
      ...attachmentSummary,
      state: "ready",
      readyContentType: "text/plain",
      actualByteSize: 12,
      readyAt: "2026-07-24T12:05:00.000Z",
      pendingExpiresAt: undefined
    };
    const download = {
      download: {
        url: "https://objects.example.test/get/object",
        expiresAt: "2026-07-24T12:10:00.000Z"
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ attachment: readyAttachment })
      )
      .mockResolvedValueOnce(Response.json({ attachments: [readyAttachment] }))
      .mockResolvedValueOnce(Response.json(download))
      .mockResolvedValueOnce(
        Response.json({
          attachment: { ...readyAttachment, state: "deleted", deletedAt: "2026-07-24T12:06:00.000Z" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(finalizeCaptureAttachmentUpload(attachmentScope)).resolves.toEqual({
      attachment: readyAttachment
    });
    await expect(listCaptureAttachments(captureScope)).resolves.toEqual([readyAttachment]);
    await expect(getCaptureAttachmentDownloadUrl(attachmentScope)).resolves.toEqual(download);
    await expect(deleteCaptureAttachment(attachmentScope)).resolves.toMatchObject({
      attachment: { state: "deleted" }
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/attachments/attachment%20%2F%20scan/finalize",
      expect.objectContaining({
        method: "POST",
        body: "{}"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/attachments",
      expect.objectContaining({
        credentials: "include",
        headers: { accept: "application/json" }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/attachments/attachment%20%2F%20scan/download",
      expect.objectContaining({
        credentials: "include",
        headers: { accept: "application/json" }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/projects/project%20%2F%20draft/captures/capture%20%2F%20inbox/attachments/attachment%20%2F%20scan",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("preserves stable attachment API error codes from the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: "This attachment type is not supported.",
          code: "ATTACHMENT_TYPE_REFUSED"
        },
        { status: 415 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      initCaptureAttachmentUpload({
        ...captureScope,
        displayFilename: "archive.zip",
        declaredContentType: "application/zip",
        declaredByteSize: 100,
        clientSha256: "b".repeat(64)
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GhostwriterApiError>>({
        status: 415,
        code: "ATTACHMENT_TYPE_REFUSED",
        message: "This attachment type is not supported."
      })
    );
  });

  it("calls provider status and capture reflection agent routes", async () => {
    const receipt = {
      id: "receipt-1",
      projectId: captureScope.projectId,
      workflowId: "scene-partner.capture-reflection",
      workflowVersion: "1",
      model: "gpt-4.1",
      receiptHash: "a".repeat(64),
      createdAt: "2026-07-24T22:00:00.000Z",
      resources: [
        {
          resourceClass: "capture",
          captureId: captureScope.captureId,
          workingVersion: 1,
          contentHash: "b".repeat(64),
          inclusionReason: "selected-capture",
          providerTextCharCount: 12,
          providerTextHash: "c".repeat(64)
        }
      ],
      maxOutputTokens: 1500,
      wallClockSeconds: 60,
      outputSchemaId: "capture-reflection-v1"
    };
    const proposal = {
      id: "proposal-1",
      projectId: captureScope.projectId,
      runId: "run-1",
      receiptId: receipt.id,
      status: "ready",
      outputSchemaId: "capture-reflection-v1",
      payload: {
        schemaId: "capture-reflection-v1",
        summary: "Harbor mood.",
        questions: ["Where?"],
        possibleStoryJobs: [{ label: "Open", rationale: "Tone." }]
      },
      contentHash: "d".repeat(64),
      baseCaptureId: captureScope.captureId,
      baseCaptureWorkingVersion: 1,
      baseCaptureContentHash: "b".repeat(64),
      createdAt: "2026-07-24T22:01:00.000Z",
      updatedAt: "2026-07-24T22:01:00.000Z"
    };
    const run = {
      id: "run-1",
      projectId: captureScope.projectId,
      status: "ready",
      workflowId: receipt.workflowId,
      receiptId: receipt.id,
      receiptHash: receipt.receiptHash,
      model: receipt.model,
      createdAt: "2026-07-24T22:01:00.000Z",
      updatedAt: "2026-07-24T22:01:00.000Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ configured: false, callsDisabled: false })
      )
      .mockResolvedValueOnce(Response.json({ receipt }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ kind: "ready", run, proposal }, { status: 201 })
      )
      .mockResolvedValueOnce(
        Response.json({ proposal: { ...proposal, status: "rejected" } })
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            mode: "new-scene",
            proposal: { ...proposal, status: "applied" },
            scene: {
              id: "scene-1",
              title: "Open",
              projectId: captureScope.projectId
            },
            sceneDocumentHead: {
              sceneId: "scene-1",
              projectId: captureScope.projectId,
              workingVersion: 1,
              contentHash: "e".repeat(64)
            },
            captureHead: {
              ...captureHead,
              status: "integrated",
              integratedSceneId: "scene-1"
            },
            navigator: {}
          },
          { status: 201 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOpenAiProviderStatus()).resolves.toEqual({
      configured: false,
      callsDisabled: false
    });
    await expect(
      previewCaptureReflectionContext({
        projectId: captureScope.projectId,
        captureId: captureScope.captureId
      })
    ).resolves.toEqual(receipt);
    await expect(
      startCaptureReflectionRun({
        projectId: captureScope.projectId,
        receiptId: receipt.id,
        expectedReceiptHash: receipt.receiptHash
      })
    ).resolves.toEqual({ kind: "ready", run, proposal });
    await expect(
      rejectAgentProposal({
        projectId: captureScope.projectId,
        proposalId: proposal.id
      })
    ).resolves.toMatchObject({ status: "rejected" });
    await expect(
      applyAgentProposal({
        projectId: captureScope.projectId,
        proposalId: proposal.id,
        mode: "new-scene",
        title: "Open",
        bookId: "book-1",
        expectedProjectVersion: 1,
        expectedProposalContentHash: proposal.contentHash
      })
    ).resolves.toMatchObject({ mode: "new-scene", proposal: { status: "applied" } });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/me/provider/openai",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project%20%2F%20draft/agent/context-preview",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/projects/project%20%2F%20draft/agent/runs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/projects/project%20%2F%20draft/agent/proposals/proposal-1/reject",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/projects/project%20%2F%20draft/agent/proposals/proposal-1/apply",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("calls craft partner preview and craft-fields apply routes", async () => {
    const receipt = {
      id: "receipt-craft-1",
      projectId: captureScope.projectId,
      workflowId: "sketch-partner.craft-fields",
      workflowVersion: "1",
      model: "gpt-4.1" as const,
      receiptHash: "a".repeat(64),
      createdAt: "2026-07-24T22:00:00.000Z",
      resources: [
        {
          resourceClass: "capture",
          captureId: captureScope.captureId,
          workingVersion: 1,
          contentHash: "b".repeat(64),
          inclusionReason: "selected-capture",
          providerTextCharCount: 12,
          providerTextHash: "c".repeat(64)
        }
      ],
      maxOutputTokens: 1500,
      wallClockSeconds: 60,
      outputSchemaId: "sketch-fields-v1",
      targetSceneId: "scene-1"
    };
    const proposal = {
      id: "proposal-craft-1",
      projectId: captureScope.projectId,
      runId: "run-craft-1",
      receiptId: receipt.id,
      status: "ready" as const,
      outputSchemaId: "sketch-fields-v1" as const,
      payload: {
        schemaId: "sketch-fields-v1" as const,
        purpose: "Force a choice.",
        conflict: "Pressure rises."
      },
      contentHash: "d".repeat(64),
      baseCaptureId: captureScope.captureId,
      baseCaptureWorkingVersion: 1,
      baseCaptureContentHash: "b".repeat(64),
      createdAt: "2026-07-24T22:01:00.000Z",
      updatedAt: "2026-07-24T22:01:00.000Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ receipt }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            mode: "craft-fields",
            proposal: { ...proposal, status: "applied" },
            navigator: {}
          },
          { status: 201 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      previewCaptureReflectionContext({
        projectId: captureScope.projectId,
        captureId: captureScope.captureId,
        workflowId: "sketch-partner.craft-fields",
        sceneId: "scene-1"
      })
    ).resolves.toEqual(receipt);
    await expect(
      applyAgentProposal({
        projectId: captureScope.projectId,
        proposalId: proposal.id,
        mode: "craft-fields",
        expectedProjectVersion: 3,
        expectedProposalContentHash: proposal.contentHash
      })
    ).resolves.toMatchObject({ mode: "craft-fields", proposal: { status: "applied" } });

    const previewCall = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(previewCall.body))).toMatchObject({
      captureId: captureScope.captureId,
      workflowId: "sketch-partner.craft-fields",
      sceneId: "scene-1"
    });
    const applyCall = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(applyCall.body))).toMatchObject({
      mode: "craft-fields",
      expectedProjectVersion: 3
    });
  });
});
