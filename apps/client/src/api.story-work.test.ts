import { afterEach, describe, expect, it, vi } from "vitest";
import { agentProposalId, instructionContentHash } from "@ghostwriter/core";
import {
  applyCharacterStoryWork,
  applySceneStoryWork,
  applyStructureStoryWork,
  completeStoryCheckReview,
  continueStoryWorkCoordinationStep,
  createCharacterStoryWorkAssignment,
  createCheckStoryWorkAssignment,
  createOutlineStoryWorkAssignment,
  createSceneStoryWorkAssignment,
  createStoryWorkCoordination,
  getStoryWorkAssignment,
  getStoryWorkCoordination,
  listStoryWorkCoordinations,
  GhostwriterApiError,
  recoverActiveStoryWorkAttempt,
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

  it("posts strict recover bodies for cancel and mark-interrupted without server fields", async () => {
    const recoverResponse = {
      replayed: false,
      assignment: { id: "assignment", status: "canceled", version: 3 },
      attempt: { runId: "run-recovery-one", completedAt: "2026-09-13T18:00:00.000Z" },
      run: { id: "run-recovery-one", status: "canceled" }
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(recoverResponse), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            replayed: true,
            assignment: { id: "assignment", status: "failed", version: 4 },
            attempt: { runId: "run-recovery-one", completedAt: "2026-09-13T18:01:00.000Z" },
            run: { id: "run-recovery-one", status: "failed" }
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetch);
    const cancel = await recoverActiveStoryWorkAttempt({
      projectId: "project",
      assignmentId: "assignment",
      expectedAssignmentVersion: 2,
      runId: "run-recovery-one",
      action: "cancel"
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("/assignments/assignment/recover");
    const cancelBody = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(cancelBody).toEqual({
      expectedAssignmentVersion: 2,
      runId: "run-recovery-one",
      action: "cancel"
    });
    expect(cancelBody).not.toHaveProperty("completedAt");
    expect(cancelBody).not.toHaveProperty("idempotencyKey");
    expect(cancel).toEqual(recoverResponse);

    const marked = await recoverActiveStoryWorkAttempt({
      projectId: "project",
      assignmentId: "assignment",
      expectedAssignmentVersion: 3,
      runId: "run-recovery-one",
      action: "mark-interrupted"
    });
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
      expectedAssignmentVersion: 3,
      runId: "run-recovery-one",
      action: "mark-interrupted"
    });
    expect(marked.replayed).toBe(true);
  });

  it("propagates recovery conflicts without retrying the POST", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "STORY_WORK_RECOVERY_TRANSITION_CONFLICT",
          error: "The story work assignment changed before this recovery action completed."
        }),
        { status: 409 }
      )
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      recoverActiveStoryWorkAttempt({
        projectId: "project",
        assignmentId: "assignment",
        expectedAssignmentVersion: 1,
        runId: "run-recovery-one",
        action: "cancel"
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "STORY_WORK_RECOVERY_TRANSITION_CONFLICT"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry recover transport on network failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network request failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      recoverActiveStoryWorkAttempt({
        projectId: "project",
        assignmentId: "assignment",
        expectedAssignmentVersion: 2,
        runId: "run-recovery-one",
        action: "cancel"
      })
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces optional recovery projection on story work detail", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assignment: { id: "assignment-running", status: "running", version: 5 },
          recovery: {
            status: "active-or-interrupted",
            runId: "run-recovery-active",
            expectedAssignmentVersion: 5,
            actions: ["cancel", "mark-interrupted"],
            message:
              "Generation is still active or the provider outcome is uncertain. Cancel the run or mark it interrupted after reload."
          },
          run: { id: "run-recovery-active", status: "running" },
          attempt: { runId: "run-recovery-active" }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetch);
    const detail = await getStoryWorkAssignment("project", "assignment-running");
    expect(detail.recovery).toMatchObject({
      status: "active-or-interrupted",
      runId: "run-recovery-active",
      expectedAssignmentVersion: 5,
      actions: ["cancel", "mark-interrupted"]
    });
  });

  it("surfaces refresh-required recovery without mandatory runId on story work detail", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assignment: { id: "assignment-stale", status: "running", version: 6 },
          recovery: {
            status: "refresh-required",
            expectedAssignmentVersion: 6,
            actions: ["cancel", "mark-interrupted"],
            message:
              "Story work changed while this page was open. Refresh assignment details before canceling or marking interrupted."
          }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetch);
    const detail = await getStoryWorkAssignment("project", "assignment-stale");
    expect(detail.recovery).toEqual({
      status: "refresh-required",
      expectedAssignmentVersion: 6,
      actions: ["cancel", "mark-interrupted"],
      message:
        "Story work changed while this page was open. Refresh assignment details before canceling or marking interrupted."
    });
  });

  it("posts strict coordination create bodies without server-only fields", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          replayed: false,
          coordination: { id: "coordination-1", version: 1 },
          projection: { version: 1, steps: [] },
          rootAssignment: { id: "assignment-root", taskKind: "scene", status: "brief-ready" }
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetch);
    await createStoryWorkCoordination({
      projectId: "project/coordination",
      expectedProjectVersion: 2,
      idempotencyKey: "coordination-create-1",
      title: "Harbor draft with continuity check",
      scene: {
        title: "Draft harbor scene",
        brief: " Draft a coordinated harbor scene. ",
        constraints: "Keep canon intact.",
        doneWhen: "A scene draft is ready for review.",
        model: "gpt-4.1",
        sceneIds: ["scene-context"]
      },
      check: {
        title: "Continuity check",
        brief: " Check the draft against surrounding canon. ",
        constraints: "Ground findings in supplied scenes.",
        doneWhen: "Findings are ready for writer review.",
        model: "gpt-4.1",
        surroundingSceneIds: ["scene-other"]
      }
    });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      "project%2Fcoordination/story-work/coordinations"
    );
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toEqual({
      expectedProjectVersion: 2,
      idempotencyKey: "coordination-create-1",
      title: "Harbor draft with continuity check",
      scene: {
        title: "Draft harbor scene",
        brief: " Draft a coordinated harbor scene. ",
        constraints: "Keep canon intact.",
        doneWhen: "A scene draft is ready for review.",
        model: "gpt-4.1",
        sceneIds: ["scene-context"]
      },
      check: {
        title: "Continuity check",
        brief: " Check the draft against surrounding canon. ",
        constraints: "Ground findings in supplied scenes.",
        doneWhen: "Findings are ready for writer review.",
        model: "gpt-4.1",
        surroundingSceneIds: ["scene-other"]
      }
    });
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("taskKind");
  });

  it("lists and loads coordination detail envelopes", async () => {
    const detail = {
      coordination: { id: "coordination-1", version: 1, title: "Coordination" },
      projection: { version: 1, overallStatus: "active", steps: [] },
      rootAssignment: { id: "assignment-root", taskKind: "scene", status: "brief-ready" },
      childAssignmentSummaries: [
        { stepId: "step-scene", assignmentId: "assignment-root", taskKind: "scene", status: "brief-ready" }
      ]
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ coordinations: [detail] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const listed = await listStoryWorkCoordinations("project");
    expect(listed.coordinations).toHaveLength(1);
    expect(listed.coordinations[0]?.coordination.id).toBe("coordination-1");
    const loaded = await getStoryWorkCoordination("project", "coordination-1");
    expect(loaded.childAssignmentSummaries[0]?.taskKind).toBe("scene");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toContain("/coordinations/coordination-1");
  });

  it("continues a coordination step with exact version and artifact only", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          replayed: true,
          coordination: { id: "coordination-1", version: 2 },
          projection: { version: 2, steps: [] },
          rootAssignment: { id: "assignment-root" },
          checkAssignment: { id: "assignment-check", taskKind: "check", status: "brief-ready" }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetch);
    await continueStoryWorkCoordinationStep({
      projectId: "project",
      coordinationId: "coordination-1",
      stepId: "step-check",
      expectedCoordinationVersion: 1,
      expectedUpstreamArtifact: pointer
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      expectedCoordinationVersion: 1,
      expectedUpstreamArtifact: pointer
    });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).not.toHaveProperty("idempotencyKey");
  });

  it("propagates coordination route conflicts without retrying transport", async () => {
    const cases = [
      ["STORY_WORK_COORDINATION_CREATE_IDEMPOTENCY_CONFLICT", 409],
      ["PROJECT_VERSION_CONFLICT", 409],
      ["STORY_WORK_COORDINATION_TRANSITION_CONFLICT", 409],
      ["STORY_WORK_COORDINATION_DEPENDENCY_CONFLICT", 409]
    ] as const;
    for (const [code, status] of cases) {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code, error: "Conflict." }), { status })
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        createStoryWorkCoordination({
          projectId: "project",
          expectedProjectVersion: 1,
          idempotencyKey: "coordination-create-1",
          title: "Title",
          scene: {
            title: "Scene",
            brief: "Brief",
            constraints: "Constraints",
            doneWhen: "Done",
            model: "gpt-4.1",
            sceneIds: ["scene-a"]
          },
          check: {
            title: "Check",
            brief: "Brief",
            constraints: "Constraints",
            doneWhen: "Done",
            model: "gpt-4.1",
            surroundingSceneIds: []
          }
        })
      ).rejects.toMatchObject({ status, code });
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it("surfaces coordination not-found on detail without a second fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "STORY_WORK_ASSIGNMENT_NOT_FOUND", error: "Not found." }), {
        status: 404
      })
    );
    vi.stubGlobal("fetch", fetch);
    await expect(getStoryWorkCoordination("project", "missing")).rejects.toMatchObject({
      status: 404,
      code: "STORY_WORK_ASSIGNMENT_NOT_FOUND"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses strict coordination bodies with 422 and does not retry", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_REQUEST", error: "Invalid request." }), {
        status: 422
      })
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      continueStoryWorkCoordinationStep({
        projectId: "project",
        coordinationId: "coordination-1",
        stepId: "step-check",
        expectedCoordinationVersion: 1,
        expectedUpstreamArtifact: pointer
      })
    ).rejects.toMatchObject({ status: 422 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry coordination continue transport on network failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network request failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      continueStoryWorkCoordinationStep({
        projectId: "project",
        coordinationId: "coordination-1",
        stepId: "step-check",
        expectedCoordinationVersion: 1,
        expectedUpstreamArtifact: pointer
      })
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
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
