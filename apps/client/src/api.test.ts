import { afterEach, describe, expect, it, vi } from "vitest";
import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { bookId, canvasObjectId, canvasRevisionId } from "@ghostwriter/core";
import {
  acquireSceneLease,
  compareSceneRevisions,
  createSceneFromCanvas,
  createSceneCheckpoint,
  createSceneVariant,
  executeCanvasCommand,
  getCanvasBoard,
  getCanvasHistory,
  getCanvasPreference,
  getSceneHistory,
  getSceneWorkspace,
  GhostwriterApiError,
  releaseSceneLease,
  renewSceneLease,
  restoreCanvasRevision,
  restoreSceneRevision,
  saveCanvasPreference,
  saveSceneDocument,
  signOut,
  undoCanvas
} from "./api.js";

const sceneScope = {
  projectId: "project / draft",
  sceneId: "scene / opening"
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
});
