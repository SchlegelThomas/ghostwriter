import { afterEach, describe, expect, it, vi } from "vitest";
import { agentProposalId, instructionContentHash } from "@ghostwriter/core";
import {
  applyCharacterStoryWork,
  applySceneStoryWork,
  applyStructureStoryWork,
  completeStoryCheckReview,
  createCharacterStoryWorkAssignment,
  createCheckStoryWorkAssignment,
  createOutlineStoryWorkAssignment,
  createSceneStoryWorkAssignment,
  getStoryWorkAssignment,
  GhostwriterApiError,
  openStoryCheckReview,
  previewStoryStructureStoryWork,
  resolveStoryCheckFinding,
  reviewCharacterStoryWork,
  reviewStoryStructureStoryWork,
  startCharacterStoryWorkAttempt,
  startStoryCheckAttempt,
  startStoryStructureAttempt
} from "./api.js";

afterEach(() => vi.unstubAllGlobals());
const pointer = { proposalId: agentProposalId("proposal-original"), artifactVersion: 2, contentHash: instructionContentHash("a".repeat(64)) };

describe("story work transport", () => {
  it("retains exact briefs and permits a new character without scene prose", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: true, assignment: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createCharacterStoryWorkAssignment({ projectId: "new/project", expectedProjectVersion: 1, idempotencyKey: "request-one", brief: "  Keep this exact\nbrief.  ", constraints: "No invented history", doneWhen: "A full dossier", sceneIds: [], model: "gpt-4.1" });
    expect(fetch.mock.calls[0]?.[0]).toContain("new%2Fproject/story-work/assignments");
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ taskKind: "character", brief: "  Keep this exact\nbrief.  ", sceneIds: [], expectedProjectVersion: 1, idempotencyKey: "request-one" });
  });
  it("keeps revision destination separate from explicitly selected source prose", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: true, assignment: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createSceneStoryWorkAssignment({ projectId: "project", taskKind: "revise", targetSceneId: "destination", captureId: "capture-source", expectedProjectVersion: 3, idempotencyKey: "scene-request", brief: " Preserve the final line. ", constraints: "Only change pacing", doneWhen: "The scene has room to breathe", sceneIds: ["source-scene"], model: "gpt-4.1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ taskKind: "revise", targetSceneId: "destination", captureId: "capture-source", sceneIds: ["source-scene"], brief: " Preserve the final line. " });
  });
  it("sends exact revision lineage and request key without retrying a timeout", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network request failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(startCharacterStoryWorkAttempt({ projectId: "project", assignmentId: "assignment", expectedAssignmentVersion: 7,
      kind: "revision", sourceMode: "latest-authorized", instruction: " Keep her voice, change her motive. ", priorArtifact: pointer, idempotencyKey: "revision-one" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ expectedAssignmentVersion: 7, priorArtifact: pointer, instruction: " Keep her voice, change her motive. ", idempotencyKey: "revision-one" });
  });
  it("sends strict create-scene apply bodies without server-only fields", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ replayed: false, assignment: {}, proposal: {}, result: { kind: "scene" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const artifact = { expectedAssignmentVersion: 3, proposalId: pointer.proposalId, expectedArtifactVersion: pointer.artifactVersion, expectedProposalContentHash: pointer.contentHash, idempotencyKey: "scene-apply-create" };
    await applySceneStoryWork({ projectId: "project", assignmentId: "assignment", ...artifact, mode: "create-scene", expectedProjectVersion: 5, title: "Harbor Choice", manuscriptPlacement: { kind: "chapter", bookId: "book-1", chapterId: "chapter-1", position: 2 },
      canvas: { expectedCanvasVersion: 4, scope: { scopeKind: "chapter", scopeId: "chapter-1" }, x: 10, y: 20, width: 240, height: 120, z: 1, storyOrderHint: 3 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({ ...artifact, mode: "create-scene", expectedProjectVersion: 5, title: "Harbor Choice", manuscriptPlacement: { kind: "chapter", bookId: "book-1", chapterId: "chapter-1", position: 2 },
      canvas: { expectedCanvasVersion: 4, scope: { scopeKind: "chapter", scopeId: "chapter-1" }, x: 10, y: 20, width: 240, height: 120, z: 1, storyOrderHint: 3 } });
    expect(body).not.toHaveProperty("leaseHolderId");
    expect(body).not.toHaveProperty("accountId");
    expect(body).not.toHaveProperty("appliedAt");
  });
  it("sends strict named-variant apply bodies with idempotency key retained", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ replayed: false, assignment: {}, proposal: {}, result: { kind: "scene" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const artifact = { expectedAssignmentVersion: 4, proposalId: pointer.proposalId, expectedArtifactVersion: pointer.artifactVersion, expectedProposalContentHash: pointer.contentHash, idempotencyKey: "scene-apply-variant" };
    await applySceneStoryWork({ projectId: "project", assignmentId: "assignment", ...artifact, mode: "named-variant", expectedSceneWorkingVersion: 2, expectedSceneContentHash: "b".repeat(64), variantName: "Tighter ending" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ ...artifact, mode: "named-variant", expectedSceneWorkingVersion: 2, expectedSceneContentHash: "b".repeat(64), variantName: "Tighter ending" });
  });
  it("sends strict apply-revision bodies without lease authority from the client", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ replayed: true, assignment: {}, proposal: {}, result: { kind: "scene" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const artifact = { expectedAssignmentVersion: 5, proposalId: pointer.proposalId, expectedArtifactVersion: pointer.artifactVersion, expectedProposalContentHash: pointer.contentHash, idempotencyKey: "scene-apply-revision" };
    await applySceneStoryWork({ projectId: "project", assignmentId: "assignment", ...artifact, mode: "apply-revision", expectedSceneWorkingVersion: 3, expectedSceneContentHash: "c".repeat(64) });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({ ...artifact, mode: "apply-revision", expectedSceneWorkingVersion: 3, expectedSceneContentHash: "c".repeat(64) });
    expect(body).not.toHaveProperty("leaseHolderId");
  });
  it("preserves apply preconditions and exposes stale conflict without silently retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "CHARACTER_STORY_WORK_CONTEXT_STALE", error: "The consumed scene changed." }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(applyCharacterStoryWork({ projectId: "project", assignmentId: "assignment", expectedAssignmentVersion: 7, expectedProjectVersion: 12,
      proposalId: pointer.proposalId, expectedArtifactVersion: pointer.artifactVersion, expectedProposalContentHash: pointer.contentHash })).rejects.toBeInstanceOf(GhostwriterApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ expectedAssignmentVersion: 7, expectedProjectVersion: 12, proposalId: pointer.proposalId, expectedArtifactVersion: 2, expectedProposalContentHash: pointer.contentHash });
  });
  it("opens review against the exact acknowledged artifact", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await reviewCharacterStoryWork({ projectId: "project", assignmentId: "assignment", expectedAssignmentVersion: 4, artifact: pointer, action: "open" });
    expect(fetch.mock.calls[0]?.[0]).toContain("/assignments/assignment/review/open");
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ expectedAssignmentVersion: 4, artifact: pointer });
  });

  it("submits applied-scene check assignments with exact writer text", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: true, assignment: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createCheckStoryWorkAssignment({
      projectId: "project",
      checkMode: "applied-scene",
      targetSceneId: "scene-assess",
      expectedProjectVersion: 1,
      idempotencyKey: "check-applied",
      brief: "  Check continuity for the harbor arrival scene.  ",
      constraints: "Use only supplied context.",
      doneWhen: "Findings are ready for review.",
      sceneIds: ["scene-context"],
      model: "gpt-4.1"
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("/story-work/assignments");
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({
      taskKind: "check",
      specialist: "continuity",
      checkMode: "applied-scene",
      targetSceneId: "scene-assess",
      expectedProjectVersion: 1,
      idempotencyKey: "check-applied",
      brief: "  Check continuity for the harbor arrival scene.  ",
      constraints: "Use only supplied context.",
      doneWhen: "Findings are ready for review.",
      sceneIds: ["scene-context"],
      model: "gpt-4.1"
    });
    expect(body).not.toHaveProperty("sourceAssignmentId");
    expect(body).not.toHaveProperty("accountId");
  });

  it("submits proposal-draft check assignments with source artifact pointers only", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: true, assignment: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createCheckStoryWorkAssignment({
      projectId: "project",
      checkMode: "proposal-draft",
      targetSceneId: "scene-assess",
      sourceAssignmentId: "assignment-revise",
      sourceArtifact: pointer,
      expectedProjectVersion: 3,
      idempotencyKey: "check-proposal",
      brief: "  Check the draft proposal continuity.  ",
      constraints: "Stay grounded in supplied prose.",
      doneWhen: "Findings cite the proposal.",
      sceneIds: [],
      model: "gpt-4.1"
    });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      taskKind: "check",
      specialist: "continuity",
      checkMode: "proposal-draft",
      targetSceneId: "scene-assess",
      sourceAssignmentId: "assignment-revise",
      sourceArtifact: pointer,
      expectedProjectVersion: 3,
      idempotencyKey: "check-proposal",
      brief: "  Check the draft proposal continuity.  ",
      constraints: "Stay grounded in supplied prose.",
      doneWhen: "Findings cite the proposal.",
      sceneIds: [],
      model: "gpt-4.1"
    });
  });

  it("starts check attempts with submitted-snapshot lineage and no retry on conflict", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: "STORY_CHECK_GENERATION_CONFLICT", error: "Busy." }), { status: 409 })
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      startStoryCheckAttempt({
        projectId: "project",
        assignmentId: "assignment-check",
        expectedAssignmentVersion: 1,
        kind: "initial",
        sourceMode: "submitted-snapshot",
        instruction: "  Check continuity for the harbor arrival scene.  ",
        idempotencyKey: "check-attempt"
      })
    ).rejects.toBeInstanceOf(GhostwriterApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("/assignments/assignment-check/attempts");
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: "  Check continuity for the harbor arrival scene.  ",
      idempotencyKey: "check-attempt"
    });
    expect(body).not.toHaveProperty("priorArtifact");
    expect(body).not.toHaveProperty("accountId");
  });

  it("opens, resolves, and completes check review on exact routes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await openStoryCheckReview({
      projectId: "project",
      assignmentId: "assignment-check",
      expectedAssignmentVersion: 2,
      artifact: pointer
    });
    await resolveStoryCheckFinding({
      projectId: "project",
      assignmentId: "assignment-check",
      findingId: "finding-1",
      expectedAssignmentVersion: 3,
      artifact: pointer,
      resolution: { status: "deferred", reason: "Need to reread the harbor beat." }
    });
    await resolveStoryCheckFinding({
      projectId: "project",
      assignmentId: "assignment-check",
      findingId: "finding-1",
      expectedAssignmentVersion: 4,
      artifact: pointer,
      resolution: { status: "open" }
    });
    await resolveStoryCheckFinding({
      projectId: "project",
      assignmentId: "assignment-check",
      findingId: "finding-1",
      expectedAssignmentVersion: 5,
      artifact: pointer,
      resolution: { status: "dismissed" }
    });
    await completeStoryCheckReview({
      projectId: "project",
      assignmentId: "assignment-check",
      expectedAssignmentVersion: 6,
      artifact: pointer
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("/assignments/assignment-check/review/open");
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      expectedAssignmentVersion: 2,
      artifact: pointer
    });
    expect(fetch.mock.calls[1]?.[0]).toContain("/review/findings/finding-1");
    expect(fetch.mock.calls[1]?.[1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
      expectedAssignmentVersion: 3,
      artifact: pointer,
      resolution: { status: "deferred", reason: "Need to reread the harbor beat." }
    });
    expect(JSON.parse(fetch.mock.calls[2]?.[1].body)).toMatchObject({
      resolution: { status: "open" }
    });
    expect(JSON.parse(fetch.mock.calls[3]?.[1].body)).toMatchObject({
      resolution: { status: "dismissed" }
    });
    expect(fetch.mock.calls[4]?.[0]).toContain("/review/complete");
    expect(fetch.mock.calls[4]?.[1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[4]?.[1].body)).toEqual({
      expectedAssignmentVersion: 6,
      artifact: pointer
    });
    for (const call of fetch.mock.calls) {
      const parsed = JSON.parse(call[1].body);
      expect(parsed).not.toHaveProperty("accountId");
      expect(parsed).not.toHaveProperty("result");
    }
  });

  it("submits outline assignments with target book and exact writer text", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: true, assignment: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createOutlineStoryWorkAssignment({
      projectId: "project",
      targetBookId: "book-signal",
      expectedProjectVersion: 2,
      idempotencyKey: "outline-request",
      brief: "  Propose a tighter act structure.  ",
      constraints: "Keep existing canon scenes.",
      doneWhen: "Structure is ready for review.",
      sceneIds: ["scene-arrival"],
      model: "gpt-4.1"
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("/story-work/assignments");
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({
      taskKind: "outline",
      targetBookId: "book-signal",
      expectedProjectVersion: 2,
      idempotencyKey: "outline-request",
      brief: "  Propose a tighter act structure.  ",
      constraints: "Keep existing canon scenes.",
      doneWhen: "Structure is ready for review.",
      sceneIds: ["scene-arrival"],
      model: "gpt-4.1"
    });
    expect(body).not.toHaveProperty("captureId");
    expect(body).not.toHaveProperty("accountId");
  });

  it("starts structure attempts with submitted-snapshot lineage only", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: "ready", state: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await startStoryStructureAttempt({
      projectId: "project",
      assignmentId: "assignment-outline",
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: "  Propose structure for the harbor book.  ",
      idempotencyKey: "structure-attempt"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("/assignments/assignment-outline/attempts");
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({
      expectedAssignmentVersion: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: "  Propose structure for the harbor book.  ",
      idempotencyKey: "structure-attempt"
    });
    expect(body).not.toHaveProperty("priorArtifact");
  });

  it("opens, edits, rejects, and previews structure review on exact routes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ assignment: {}, proposal: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const payload = { schemaId: "story-structure-proposal-v1", operations: [], dependencies: [] };
    await reviewStoryStructureStoryWork({
      projectId: "project",
      assignmentId: "assignment-outline",
      expectedAssignmentVersion: 2,
      artifact: pointer,
      action: "open"
    });
    await reviewStoryStructureStoryWork({
      projectId: "project",
      assignmentId: "assignment-outline",
      expectedAssignmentVersion: 3,
      artifact: pointer,
      action: "edit",
      payload: payload as never
    });
    await reviewStoryStructureStoryWork({
      projectId: "project",
      assignmentId: "assignment-outline",
      expectedAssignmentVersion: 4,
      artifact: pointer,
      action: "reject"
    });
    await previewStoryStructureStoryWork({
      projectId: "project",
      assignmentId: "assignment-outline",
      expectedAssignmentVersion: 5,
      expectedProjectVersion: 6,
      artifact: pointer,
      selectedOperationIds: ["op-part", "op-ch-1"]
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("/review/open");
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      expectedAssignmentVersion: 2,
      artifact: pointer
    });
    expect(fetch.mock.calls[1]?.[0]).toContain("/review");
    expect(fetch.mock.calls[1]?.[0]).not.toContain("/review/open");
    expect(fetch.mock.calls[1]?.[1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
      expectedAssignmentVersion: 3,
      artifact: pointer,
      payload
    });
    expect(fetch.mock.calls[2]?.[0]).toContain("/review/reject");
    expect(JSON.parse(fetch.mock.calls[3]?.[1].body)).toEqual({
      expectedAssignmentVersion: 5,
      expectedProjectVersion: 6,
      artifact: pointer,
      selectedOperationIds: ["op-part", "op-ch-1"]
    });
  });

  it("sends strict structure apply bodies with and without optional Canvas placement", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ replayed: false, assignment: {}, proposal: {}, result: { kind: "book" } }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetch);
    const artifact = {
      expectedAssignmentVersion: 3,
      proposalId: pointer.proposalId,
      expectedArtifactVersion: pointer.artifactVersion,
      expectedProposalContentHash: pointer.contentHash,
      expectedProjectVersion: 5,
      selectedOperationIds: ["op-part", "op-sc-1"],
      idempotencyKey: "structure-apply"
    };
    await applyStructureStoryWork({ projectId: "project", assignmentId: "assignment-outline", ...artifact });
    await applyStructureStoryWork({
      projectId: "project",
      assignmentId: "assignment-outline",
      ...artifact,
      idempotencyKey: "structure-apply-canvas",
      canvas: {
        expectedCanvasVersion: 2,
        sceneId: "scene-new",
        scope: { scopeKind: "chapter", scopeId: "chapter-1" },
        x: 12,
        y: 24,
        width: 240,
        height: 120,
        z: 3
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual(artifact);
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
      ...artifact,
      idempotencyKey: "structure-apply-canvas",
      canvas: {
        expectedCanvasVersion: 2,
        sceneId: "scene-new",
        scope: { scopeKind: "chapter", scopeId: "chapter-1" },
        x: 12,
        y: 24,
        width: 240,
        height: 120,
        z: 3
      }
    });
    for (const call of fetch.mock.calls) {
      const parsed = JSON.parse(call[1].body);
      expect(parsed).not.toHaveProperty("accountId");
      expect(parsed).not.toHaveProperty("appliedAt");
    }
  });

  it("surfaces optional check freshness on story work detail", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assignment: { id: "assignment-check" },
          checkFreshness: {
            status: "needs-recheck",
            reasons: [{ dependencyKey: "scene:scene-assess", reason: "scene-content-changed" }]
          }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetch);
    const detail = await getStoryWorkAssignment("project", "assignment-check");
    expect(fetch.mock.calls[0]?.[0]).toContain("/assignments/assignment-check");
    expect(detail.checkFreshness).toEqual({
      status: "needs-recheck",
      reasons: [{ dependencyKey: "scene:scene-assess", reason: "scene-content-changed" }]
    });
  });
});
