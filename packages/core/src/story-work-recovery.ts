import type { AgentRunRepository } from "./agent-foundation-repository.js";
import {
  assertAgentRunIdentityPreserved,
  assertAgentRunTransition,
  createAgentRun,
  type AgentRun,
  type AgentRunTerminalDiagnosticCode
} from "./agent-runs-proposals.js";
import type { ProjectId } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { ProjectRepository } from "./project-repository.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  finishStoryWorkAttemptWithoutArtifact,
  STORY_WORK_TASK_KINDS,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import type { StoryWorkAttempt } from "./story-work-attempt.js";
import type { AgentRunId } from "./domain.js";

export type StoryWorkRecoveryAction = "cancel" | "mark-interrupted";

/**
 * Idempotence is keyed by the exact active `runId`, recovery `action`, and
 * `expectedAssignmentVersion` captured before the transition — not by a separate
 * provider or HTTP idempotency key. Replay matches stored terminal assignment/run
 * shape and attempt bindings only; a fresh `completedAt` from the server clock on
 * retry does not participate in replay detection.
 */
export type RecoverActiveStoryWorkAttemptInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  expectedAssignmentVersion: number;
  runId: AgentRunId;
  action: StoryWorkRecoveryAction;
  /** Applied on the first successful transition; lost-response retries may supply a new clock value. */
  completedAt: string;
}>;

export type RecoverActiveStoryWorkAttemptResult = Readonly<{
  replayed: boolean;
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  run: AgentRun;
}>;

export class StoryWorkRecoveryTransitionConflictError extends Error {
  readonly code = "STORY_WORK_RECOVERY_TRANSITION_CONFLICT" as const;

  constructor(
    message = "The story work assignment changed before this recovery action completed."
  ) {
    super(message);
    this.name = "StoryWorkRecoveryTransitionConflictError";
  }
}

export class StoryWorkRecoveryActionConflictError extends Error {
  readonly code = "STORY_WORK_RECOVERY_ACTION_CONFLICT" as const;

  constructor(
    message = "This generation run was already recovered with a different action."
  ) {
    super(message);
    this.name = "StoryWorkRecoveryActionConflictError";
  }
}

export type StoryWorkRecoveryRepositoryFailurePoint = "after-run";

export type StoryWorkRecoveryRepositoryDependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  runs: AgentRunRepository;
  failAfter?: StoryWorkRecoveryRepositoryFailurePoint;
}>;

export interface StoryWorkRecoveryRepositoryExecutor {
  recoverActiveStoryWorkAttempt(
    input: RecoverActiveStoryWorkAttemptInput
  ): Promise<RecoverActiveStoryWorkAttemptResult>;
}

export interface StoryWorkRecoveryUnitOfWork {
  recoverActiveStoryWorkAttempt(
    input: RecoverActiveStoryWorkAttemptInput
  ): Promise<RecoverActiveStoryWorkAttemptResult>;
}

function transitionConflict(message?: string): never {
  throw new StoryWorkRecoveryTransitionConflictError(message);
}

function actionConflict(message?: string): never {
  throw new StoryWorkRecoveryActionConflictError(message);
}

export function storyWorkRecoveryTerminalDiagnostic(
  action: StoryWorkRecoveryAction
): AgentRunTerminalDiagnosticCode {
  return action === "cancel" ? "run-canceled" : "client-interrupted";
}

export function storyWorkRecoveryAssignmentOutcome(
  action: StoryWorkRecoveryAction
): "canceled" | "failed" {
  return action === "cancel" ? "canceled" : "failed";
}

export function buildStoryWorkRecoveryTerminalRun(
  run: AgentRun,
  action: StoryWorkRecoveryAction,
  completedAt: string
): AgentRun {
  const terminal = createAgentRun({
    ...run,
    status: "failed",
    terminalDiagnosticCode: storyWorkRecoveryTerminalDiagnostic(action),
    completedAt,
    updatedAt: completedAt
  });
  assertAgentRunTransition(run.status, terminal.status);
  assertAgentRunIdentityPreserved(run, terminal);
  return terminal;
}

export function buildStoryWorkRecoveryTerminalAssignment(
  assignment: StoryWorkAssignment,
  input: Readonly<{
    expectedAssignmentVersion: number;
    runId: AgentRunId;
    action: StoryWorkRecoveryAction;
    completedAt: string;
  }>
): StoryWorkAssignment {
  return finishStoryWorkAttemptWithoutArtifact({
    assignment,
    expectedVersion: input.expectedAssignmentVersion,
    runId: input.runId,
    outcome: storyWorkRecoveryAssignmentOutcome(input.action),
    updatedAt: input.completedAt
  });
}

function attemptBoundAndIncomplete(
  attempt: StoryWorkAttempt,
  assignment: StoryWorkAssignment,
  run: AgentRun,
  runId: AgentRunId
): boolean {
  return (
    attempt.assignmentId === assignment.id &&
    attempt.projectId === assignment.projectId &&
    attempt.initiatorAccountId === assignment.initiatorAccountId &&
    attempt.runId === runId &&
    run.id === runId &&
    attempt.completedAt === undefined &&
    attempt.resultArtifact === undefined
  );
}

function terminalRunMatchesAction(run: AgentRun, action: StoryWorkRecoveryAction): boolean {
  return (
    run.status === "failed" &&
    run.terminalDiagnosticCode === storyWorkRecoveryTerminalDiagnostic(action)
  );
}

export function matchesStoryWorkRecoveryReplay(
  input: RecoverActiveStoryWorkAttemptInput,
  assignment: StoryWorkAssignment,
  attempt: StoryWorkAttempt,
  run: AgentRun
): boolean {
  const expectedStatus = storyWorkRecoveryAssignmentOutcome(input.action);
  if (assignment.version !== input.expectedAssignmentVersion + 1) return false;
  if (assignment.status !== expectedStatus) return false;
  if (assignment.activeAttemptId !== undefined) return false;
  if (assignment.latestAttemptId !== input.runId) return false;
  if (!terminalRunMatchesAction(run, input.action)) return false;
  if (run.completedAt === undefined) return false;
  return attemptBoundAndIncomplete(attempt, assignment, run, input.runId);
}

function recoveryTerminalForOtherAction(
  run: AgentRun,
  action: StoryWorkRecoveryAction
): boolean {
  if (run.status !== "failed" || run.terminalDiagnosticCode === undefined) return false;
  const mine = storyWorkRecoveryTerminalDiagnostic(action);
  return (
    run.terminalDiagnosticCode === "run-canceled" ||
    run.terminalDiagnosticCode === "client-interrupted"
  ) && run.terminalDiagnosticCode !== mine;
}

async function requireOwnedAssignment(
  dependencies: StoryWorkRecoveryRepositoryDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    assignmentId: StoryWorkAssignmentId;
  }>
): Promise<StoryWorkAssignment> {
  try {
    requireProjectOwner(
      input.projectId,
      await dependencies.projects.getProjectMembership(input.projectId, input.accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new StoryWorkAssignmentNotFoundError();
    }
    throw error;
  }
  const assignment = await dependencies.assignments.get(input);
  if (assignment === undefined || assignment.projectId !== input.projectId) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  if (!STORY_WORK_TASK_KINDS.includes(assignment.taskKind)) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  return assignment;
}

function validateActiveRecovery(
  input: RecoverActiveStoryWorkAttemptInput,
  assignment: StoryWorkAssignment,
  attempt: StoryWorkAttempt,
  run: AgentRun
): void {
  if (assignment.status !== "running") {
    transitionConflict("Only a running story work assignment can be recovered.");
  }
  if (assignment.version !== input.expectedAssignmentVersion) {
    transitionConflict();
  }
  if (assignment.activeAttemptId !== input.runId || assignment.latestAttemptId !== input.runId) {
    transitionConflict("The active generation run no longer matches this assignment.");
  }
  if (!attemptBoundAndIncomplete(attempt, assignment, run, input.runId)) {
    transitionConflict("The active attempt is no longer eligible for recovery.");
  }
  if (run.projectId !== input.projectId || run.initiatorAccountId !== input.accountId) {
    throw new StoryWorkAssignmentNotFoundError();
  }
  if (run.status !== "running" && run.status !== "queued") {
    transitionConflict("The generation run is no longer active.");
  }
}

function failAt(
  expected: StoryWorkRecoveryRepositoryDependencies["failAfter"],
  actual: StoryWorkRecoveryRepositoryFailurePoint
): void {
  if (expected === actual) {
    throw new Error(`Injected story work recovery failure ${actual}.`);
  }
}

export function createRepositoryStoryWorkRecoveryExecutor(
  dependencies: StoryWorkRecoveryRepositoryDependencies
): StoryWorkRecoveryRepositoryExecutor {
  return Object.freeze({
    async recoverActiveStoryWorkAttempt(input: RecoverActiveStoryWorkAttemptInput) {
      const assignment = await requireOwnedAssignment(dependencies, input);
      if (
        assignment.status === "running" &&
        (assignment.activeAttemptId !== input.runId ||
          assignment.latestAttemptId !== input.runId)
      ) {
        transitionConflict("The active generation run no longer matches this assignment.");
      }
      const [attempt, run] = await Promise.all([
        dependencies.attempts.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId,
          runId: input.runId
        }),
        dependencies.runs.get(input.runId)
      ]);
      if (run === undefined) {
        throw new StoryWorkAssignmentNotFoundError();
      }
      if (attempt === undefined) {
        transitionConflict("The active attempt could not be loaded.");
      }

      if (matchesStoryWorkRecoveryReplay(input, assignment, attempt, run)) {
        return Object.freeze({
          replayed: true,
          assignment,
          attempt,
          run
        });
      }

      if (recoveryTerminalForOtherAction(run, input.action)) {
        actionConflict();
      }

      if (run.status === "failed" || assignment.status !== "running") {
        transitionConflict();
      }

      validateActiveRecovery(input, assignment, attempt, run);

      const terminalRun = buildStoryWorkRecoveryTerminalRun(
        run,
        input.action,
        input.completedAt
      );
      const terminalAssignment = buildStoryWorkRecoveryTerminalAssignment(assignment, input);

      const nextRun = await dependencies.runs.transition({
        runId: run.id,
        expectedStatus: run.status,
        next: terminalRun
      });
      if (!nextRun.ok) transitionConflict();
      failAt(dependencies.failAfter, "after-run");
      const nextAssignment = await dependencies.assignments.compareAndSet({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: assignment.id,
        expectedVersion: input.expectedAssignmentVersion,
        next: terminalAssignment
      });
      if (!nextAssignment.ok) transitionConflict();

      return Object.freeze({
        replayed: false,
        assignment: nextAssignment.assignment,
        attempt,
        run: nextRun.run
      });
    }
  });
}
