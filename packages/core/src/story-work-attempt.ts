import { DomainValidationError, type AgentRunId, type ProjectId } from "./domain.js";
import type { AccountId } from "./identity.js";
import {
  createStoryWorkArtifactPointer,
  storyWorkAssignmentId,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";

export const STORY_WORK_ATTEMPT_INSTRUCTION_MAX = 20_000;
export const STORY_WORK_ATTEMPT_LIST_MAX = 100;

export type StoryWorkAttemptKind = "initial" | "revision";

export type StoryWorkAttempt = Readonly<{
  assignmentId: StoryWorkAssignmentId;
  projectId: ProjectId;
  initiatorAccountId: AccountId;
  runId: AgentRunId;
  version: number;
  kind: StoryWorkAttemptKind;
  /** Exact writer-authored attempt instruction. */
  instruction: string;
  priorArtifact?: StoryWorkArtifactPointer;
  resultArtifact?: StoryWorkArtifactPointer;
  createdAt: string;
  completedAt?: string;
}>;

export class StoryWorkAttemptTransitionError extends Error {
  readonly code = "STORY_WORK_ATTEMPT_TRANSITION_CONFLICT" as const;

  constructor(message = "The story work attempt changed before this action completed.") {
    super(message);
    this.name = "StoryWorkAttemptTransitionError";
  }
}

function identifier(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} must not be empty.`);
  }
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new DomainValidationError("VALUE_TOO_LONG", `${label} is too long.`);
  }
  return normalized;
}

function timestamp(value: string, label: string): string {
  const normalized = identifier(value, label);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} must be a timestamp.`);
  }
  return normalized;
}

export function createStoryWorkAttempt(input: StoryWorkAttempt): StoryWorkAttempt {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Story work attempt version must be a positive integer."
    );
  }
  if (input.kind !== "initial" && input.kind !== "revision") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story work attempt kind is invalid."
    );
  }
  if (
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > STORY_WORK_ATTEMPT_INSTRUCTION_MAX
  ) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Story work attempt instruction must contain 1–${STORY_WORK_ATTEMPT_INSTRUCTION_MAX} characters.`
    );
  }
  if ((input.kind === "initial") === (input.priorArtifact !== undefined)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Only revision attempts require a prior reviewed artifact."
    );
  }
  const createdAt = timestamp(input.createdAt, "Attempt creation time");
  const completedAt = input.completedAt === undefined
    ? undefined
    : timestamp(input.completedAt, "Attempt completion time");
  if (completedAt !== undefined && Date.parse(completedAt) < Date.parse(createdAt)) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Attempt completion time cannot precede creation time."
    );
  }
  if ((completedAt === undefined) !== (input.resultArtifact === undefined)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "A completed generated attempt must record its result artifact."
    );
  }
  const priorArtifact = input.priorArtifact === undefined
    ? undefined
    : createStoryWorkArtifactPointer(input.priorArtifact);
  const resultArtifact = input.resultArtifact === undefined
    ? undefined
    : createStoryWorkArtifactPointer(input.resultArtifact);
  if (resultArtifact !== undefined) {
    const expectedVersion = (priorArtifact?.artifactVersion ?? 0) + 1;
    if (
      resultArtifact.artifactVersion !== expectedVersion ||
      resultArtifact.proposalId === priorArtifact?.proposalId
    ) {
      throw new StoryWorkAttemptTransitionError(
        "An attempt result requires a new proposal and the next artifact version."
      );
    }
  }
  return Object.freeze({
    assignmentId: storyWorkAssignmentId(input.assignmentId),
    projectId: input.projectId,
    initiatorAccountId: input.initiatorAccountId,
    runId: identifier(input.runId, "Agent run") as AgentRunId,
    version: input.version,
    kind: input.kind,
    instruction: input.instruction,
    ...(priorArtifact === undefined ? {} : { priorArtifact }),
    ...(resultArtifact === undefined ? {} : { resultArtifact }),
    createdAt,
    ...(completedAt === undefined ? {} : { completedAt })
  });
}

export function completeStoryWorkAttempt(input: Readonly<{
  attempt: StoryWorkAttempt;
  expectedVersion: number;
  resultArtifact: StoryWorkArtifactPointer;
  completedAt: string;
}>): StoryWorkAttempt {
  const current = createStoryWorkAttempt(input.attempt);
  if (
    current.version !== input.expectedVersion ||
    current.completedAt !== undefined ||
    current.resultArtifact !== undefined
  ) {
    throw new StoryWorkAttemptTransitionError();
  }
  return createStoryWorkAttempt({
    ...current,
    version: current.version + 1,
    resultArtifact: input.resultArtifact,
    completedAt: input.completedAt
  });
}
