import type { StoryWorkAssignment, StoryWorkAttempt } from "@ghostwriter/core";

/** An explicit retry repeats the persisted request, never substitutes the original brief for a revision. */
export function storyWorkRetryInput(assignment: StoryWorkAssignment, attempt?: StoryWorkAttempt) {
  if (assignment.status === "brief-ready" && !attempt) {
    return { kind: "initial" as const, sourceMode: "submitted-snapshot" as const, instruction: assignment.brief };
  }
  if (!attempt || attempt.assignmentId !== assignment.id || attempt.projectId !== assignment.projectId || attempt.initiatorAccountId !== assignment.initiatorAccountId) {
    throw new Error("Refresh this assignment to load its exact recorded request before retrying.");
  }
  return { kind: attempt.kind, sourceMode: attempt.sourceMode, instruction: attempt.instruction, priorArtifact: attempt.priorArtifact };
}
