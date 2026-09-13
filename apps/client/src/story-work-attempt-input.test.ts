import { describe, expect, it } from "vitest";
import type { StoryWorkAssignment, StoryWorkAttempt } from "@ghostwriter/core";
import { storyWorkRetryInput } from "./story-work-attempt-input.js";

const assignment = { id: "assignment", projectId: "project", initiatorAccountId: "owner", status: "failed", brief: "Original brief" } as StoryWorkAssignment;
const attempt = { assignmentId: assignment.id, projectId: assignment.projectId, initiatorAccountId: assignment.initiatorAccountId, kind: "revision", sourceMode: "latest-authorized", instruction: "  Keep the voice.\nChange the motive. ", priorArtifact: { proposalId: "original", artifactVersion: 2, contentHash: "a".repeat(64) } } as StoryWorkAttempt;

describe("explicit story work retry", () => {
  it("preserves exact failed revision instructions, source mode and prior artifact", () => {
    expect(storyWorkRetryInput(assignment, attempt)).toEqual({ kind: "revision", sourceMode: "latest-authorized", instruction: attempt.instruction, priorArtifact: attempt.priorArtifact });
  });
  it("refuses missing or foreign attempt history instead of guessing", () => {
    expect(() => storyWorkRetryInput(assignment)).toThrow("exact recorded request");
    expect(() => storyWorkRetryInput(assignment, { ...attempt, assignmentId: "foreign" as StoryWorkAttempt["assignmentId"] })).toThrow();
  });
  it("starts an unexecuted brief with the submitted snapshot", () => {
    expect(storyWorkRetryInput({ ...assignment, status: "brief-ready" })).toEqual({ kind: "initial", sourceMode: "submitted-snapshot", instruction: assignment.brief });
  });
});
