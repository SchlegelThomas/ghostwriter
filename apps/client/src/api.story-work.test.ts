import { afterEach, describe, expect, it, vi } from "vitest";
import { agentProposalId, instructionContentHash } from "@ghostwriter/core";
import { applyCharacterStoryWork, createCharacterStoryWorkAssignment, GhostwriterApiError, reviewCharacterStoryWork, startCharacterStoryWorkAttempt } from "./api.js";

afterEach(() => vi.unstubAllGlobals());
const pointer = { proposalId: agentProposalId("proposal-original"), artifactVersion: 2, contentHash: instructionContentHash("a".repeat(64)) };

describe("story work transport", () => {
  it("retains exact briefs and permits a new character without scene prose", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: true, assignment: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await createCharacterStoryWorkAssignment({ projectId: "new/project", expectedProjectVersion: 1, idempotencyKey: "request-one", brief: "  Keep this exact\nbrief.  ", constraints: "No invented history", doneWhen: "A full dossier", sceneIds: [], model: "gpt-4.1" });
    expect(fetch.mock.calls[0]?.[0]).toContain("new%2Fproject/story-work/assignments");
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ brief: "  Keep this exact\nbrief.  ", sceneIds: [], expectedProjectVersion: 1, idempotencyKey: "request-one" });
  });
  it("sends exact revision lineage and request key without retrying a timeout", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network request failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(startCharacterStoryWorkAttempt({ projectId: "project", assignmentId: "assignment", expectedAssignmentVersion: 7,
      kind: "revision", sourceMode: "latest-authorized", instruction: " Keep her voice, change her motive. ", priorArtifact: pointer, idempotencyKey: "revision-one" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ expectedAssignmentVersion: 7, priorArtifact: pointer, instruction: " Keep her voice, change her motive. ", idempotencyKey: "revision-one" });
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
});
