import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { ContextReceipt } from "./agent-context-receipt.js";
import type {
  AgentOutputSchemaId,
  AgentWorkflowId,
  InstructionContentHash
} from "./agent-domain.js";
import type {
  AgentProposalRepository,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import {
  assertReceiptMatchesRun,
  createAgentRun,
  createReadyAgentProposal,
  type AgentProposal,
  type AgentProposalPrimaryTarget,
  type AgentRun
} from "./agent-runs-proposals.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import type { ProjectId } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { ProjectRepository } from "./project-repository.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  attachGeneratedStoryWorkArtifact,
  finishStoryWorkAttemptWithoutArtifact,
  startStoryWorkAttempt,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId
} from "./story-work-assignment.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import {
  completeStoryWorkAttempt,
  type StoryWorkAttempt
} from "./story-work-attempt.js";

export type StoryWorkGenerationRepositoryFailurePoint =
  | "begin-run"
  | "complete-proposal"
  | "finish-run";

export type StoryWorkGenerationRepositoryDependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  receipts: ContextReceiptRepository;
  runs: AgentRunRepository;
  proposals: AgentProposalRepository;
  failAfter?: StoryWorkGenerationRepositoryFailurePoint;
}>;

export type StoryWorkGenerationRepositoryPolicy = Readonly<{
  workflowId: AgentWorkflowId;
  outputSchemaId: AgentOutputSchemaId;
  /** Capitalized and lower-case labels preserve workflow-specific diagnostics. */
  label: string;
  lowerLabel: string;
  assignmentTarget(
    assignment: StoryWorkAssignment
  ): AgentProposalPrimaryTarget | undefined;
  receiptTargetId(receipt: ContextReceipt): string | undefined;
  conflictError(message?: string): Error;
  notFoundError(): Error;
}>;

export type FindStoryWorkGenerationReplayInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  assignmentId: StoryWorkAssignmentId;
  idempotencyKey: string;
  requestFingerprint: InstructionContentHash;
}>;

export type BeginStoryWorkGenerationInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  expectedAssignmentVersion: number;
  receipt: ContextReceipt;
  queuedRun: AgentRun;
  runningRun: AgentRun;
  attempt: StoryWorkAttempt;
  runningAssignment: StoryWorkAssignment;
}>;

export type BeginStoryWorkGenerationResult = Readonly<{
  replayed: boolean;
  receipt: ContextReceipt;
  run: AgentRun;
  attempt: StoryWorkAttempt;
  assignment: StoryWorkAssignment;
  proposal?: AgentProposal;
}>;

type ScopedStoryWorkGenerationInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  expectedAssignmentVersion: number;
  expectedAttemptVersion: number;
  expectedRunStatus: "running";
}>;

export type CompleteStoryWorkGenerationInput =
  ScopedStoryWorkGenerationInput &
    Readonly<{
      proposal: AgentProposal;
      readyRun: AgentRun;
      completedAttempt: StoryWorkAttempt;
      artifactReadyAssignment: StoryWorkAssignment;
    }>;

export type CompleteStoryWorkGenerationResult = Readonly<{
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  run: AgentRun;
  proposal: AgentProposal;
}>;

export type FinishStoryWorkGenerationInput =
  ScopedStoryWorkGenerationInput &
    Readonly<{
      terminalRun: AgentRun;
      terminalAssignment: StoryWorkAssignment;
    }>;

export type FinishStoryWorkGenerationResult = Readonly<{
  assignment: StoryWorkAssignment;
  attempt: StoryWorkAttempt;
  run: AgentRun;
}>;

export interface StoryWorkGenerationRepositoryExecutor {
  findReplay(
    input: FindStoryWorkGenerationReplayInput
  ): Promise<BeginStoryWorkGenerationResult | undefined>;
  begin(input: BeginStoryWorkGenerationInput): Promise<BeginStoryWorkGenerationResult>;
  complete(
    input: CompleteStoryWorkGenerationInput
  ): Promise<CompleteStoryWorkGenerationResult>;
  finishWithoutArtifact(
    input: FinishStoryWorkGenerationInput
  ): Promise<FinishStoryWorkGenerationResult>;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function conflict(
  policy: StoryWorkGenerationRepositoryPolicy,
  message?: string
): never {
  throw policy.conflictError(message);
}

function targetsMatch(
  left: AgentProposalPrimaryTarget | undefined,
  right: AgentProposalPrimaryTarget
): boolean {
  return left?.kind === right.kind && left.id === right.id;
}

function failAt(
  expected: StoryWorkGenerationRepositoryDependencies["failAfter"],
  actual: StoryWorkGenerationRepositoryFailurePoint,
  policy: StoryWorkGenerationRepositoryPolicy
): void {
  if (expected === actual) {
    throw new Error(`Injected ${policy.lowerLabel} generation failure ${actual}.`);
  }
}

async function requireOwnedAssignment(
  dependencies: StoryWorkGenerationRepositoryDependencies,
  policy: StoryWorkGenerationRepositoryPolicy,
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
      throw policy.notFoundError();
    }
    throw error;
  }
  const assignment = await dependencies.assignments.get(input);
  if (assignment === undefined) throw policy.notFoundError();
  return assignment;
}

function validateRunPair(
  input: BeginStoryWorkGenerationInput,
  policy: StoryWorkGenerationRepositoryPolicy
): void {
  const queued = input.queuedRun;
  const running = input.runningRun;
  if (
    queued.status !== "queued" ||
    running.status !== "running" ||
    queued.id !== running.id ||
    queued.projectId !== input.projectId ||
    queued.initiatorAccountId !== input.accountId ||
    queued.workflowId !== policy.workflowId ||
    running.workflowId !== policy.workflowId ||
    input.receipt.workflowVersion !== queued.workflowVersion ||
    input.receipt.provider !== queued.provider ||
    input.receipt.model !== queued.model ||
    !exact(
      { ...queued, status: "running", updatedAt: running.updatedAt },
      running
    )
  ) {
    conflict(
      policy,
      `${policy.label} generation run records do not describe one start transition.`
    );
  }
  assertReceiptMatchesRun(input.receipt, queued);
}

function validateAttemptBinding(
  attempt: StoryWorkAttempt,
  assignment: StoryWorkAssignment,
  run: AgentRun,
  policy: StoryWorkGenerationRepositoryPolicy
): void {
  if (
    attempt.assignmentId !== assignment.id ||
    attempt.projectId !== assignment.projectId ||
    attempt.initiatorAccountId !== assignment.initiatorAccountId ||
    attempt.runId !== run.id
  ) {
    conflict(
      policy,
      `${policy.label} generation attempt does not match its assignment and run.`
    );
  }
}

function validateReceiptBinding(
  input: BeginStoryWorkGenerationInput,
  assignment: StoryWorkAssignment,
  policy: StoryWorkGenerationRepositoryPolicy
): void {
  const target = policy.assignmentTarget(assignment);
  if (
    input.receipt.projectId !== input.projectId ||
    input.receipt.workflowId !== policy.workflowId ||
    input.receipt.outputSchemaId !== policy.outputSchemaId ||
    target === undefined ||
    !targetsMatch(input.receipt.primaryTarget, target) ||
    policy.receiptTargetId(input.receipt) !== target.id
  ) {
    conflict(
      policy,
      `${policy.label} generation receipt does not match its reserved destination.`
    );
  }
}

function artifactPointer(
  proposal: AgentProposal,
  attempt: StoryWorkAttempt
): StoryWorkArtifactPointer {
  return Object.freeze({
    proposalId: proposal.id,
    artifactVersion: (attempt.priorArtifact?.artifactVersion ?? 0) + 1,
    contentHash: proposal.contentHash
  });
}

function validateProposalBinding(
  proposal: AgentProposal,
  assignment: StoryWorkAssignment,
  attempt: StoryWorkAttempt,
  run: AgentRun,
  policy: StoryWorkGenerationRepositoryPolicy
): void {
  const target = policy.assignmentTarget(assignment);
  if (
    proposal.projectId !== assignment.projectId ||
    proposal.runId !== run.id ||
    proposal.receiptId !== run.receiptId ||
    proposal.outputSchemaId !== policy.outputSchemaId ||
    target === undefined ||
    !targetsMatch(proposal.primaryTarget, target) ||
    attempt.runId !== run.id
  ) {
    conflict(
      policy,
      `${policy.label} generation proposal does not match its assignment receipt.`
    );
  }
}

function validateTerminalPair(
  run: AgentRun,
  assignment: StoryWorkAssignment,
  policy: StoryWorkGenerationRepositoryPolicy
): void {
  const expectedAssignmentStatus =
    run.status === "canceled"
      ? "canceled"
      : run.status === "stale"
        ? "stale"
        : run.status === "failed"
          ? run.terminalDiagnosticCode === "run-canceled"
            ? "canceled"
            : "failed"
          : undefined;
  if (
    expectedAssignmentStatus === undefined ||
    assignment.status !== expectedAssignmentStatus
  ) {
    conflict(
      policy,
      `${policy.label} generation terminal run and assignment outcomes disagree.`
    );
  }
}

export function createRepositoryStoryWorkGenerationExecutor(
  dependencies: StoryWorkGenerationRepositoryDependencies,
  policy: StoryWorkGenerationRepositoryPolicy
): StoryWorkGenerationRepositoryExecutor {
  async function replay(
    input: Pick<
      FindStoryWorkGenerationReplayInput,
      "accountId" | "projectId" | "requestFingerprint"
    >,
    existing: StoryWorkAttempt,
    assignment: StoryWorkAssignment
  ): Promise<BeginStoryWorkGenerationResult> {
    if (existing.requestFingerprint !== input.requestFingerprint) {
      conflict(
        policy,
        `That ${policy.lowerLabel} generation idempotency key was used for different instructions.`
      );
    }
    const run = await dependencies.runs.get(existing.runId);
    if (run === undefined) {
      conflict(policy, `The prior ${policy.lowerLabel} generation replay is incomplete.`);
    }
    const [receipt, proposal] = await Promise.all([
      dependencies.receipts.get(run.receiptId),
      existing.resultArtifact === undefined
        ? Promise.resolve(undefined)
        : dependencies.proposals.get(existing.resultArtifact.proposalId)
    ]);
    if (
      receipt === undefined ||
      run.projectId !== input.projectId ||
      run.initiatorAccountId !== input.accountId ||
      receipt.projectId !== input.projectId ||
      (existing.resultArtifact !== undefined && proposal === undefined)
    ) {
      conflict(policy, `The prior ${policy.lowerLabel} generation replay is incomplete.`);
    }
    return Object.freeze({
      replayed: true,
      receipt,
      run,
      attempt: existing,
      assignment,
      ...(proposal === undefined ? {} : { proposal })
    });
  }

  return Object.freeze({
    async findReplay(input: FindStoryWorkGenerationReplayInput) {
      const assignment = await requireOwnedAssignment(dependencies, policy, input);
      const existing = await dependencies.attempts.getByIdempotencyKey(input);
      if (existing === undefined) return undefined;
      const run = await dependencies.runs.get(existing.runId);
      if (run === undefined) {
        conflict(policy, `The prior ${policy.lowerLabel} generation replay is incomplete.`);
      }
      return replay(input, existing, assignment);
    },

    async begin(input: BeginStoryWorkGenerationInput) {
      const current = await requireOwnedAssignment(dependencies, policy, {
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.runningAssignment.id
      });
      const existing = await dependencies.attempts.getByIdempotencyKey({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: current.id,
        idempotencyKey: input.attempt.idempotencyKey
      });
      if (existing !== undefined) {
        return replay(
          {
            accountId: input.accountId,
            projectId: input.projectId,
            requestFingerprint: input.attempt.requestFingerprint
          },
          existing,
          current
        );
      }

      const project = await dependencies.projects.getProject(input.projectId);
      if (project?.archivedAt !== undefined) throw new ProjectArchivedMutationError();
      if (current.version !== input.expectedAssignmentVersion) conflict(policy);
      validateRunPair(input, policy);
      validateAttemptBinding(input.attempt, current, input.runningRun, policy);
      validateReceiptBinding(input, current, policy);
      const expectedRunning = startStoryWorkAttempt({
        assignment: current,
        expectedVersion: input.expectedAssignmentVersion,
        runId: input.runningRun.id,
        updatedAt: input.runningAssignment.updatedAt
      });
      if (!exact(expectedRunning, input.runningAssignment)) conflict(policy);

      const receipt = await dependencies.receipts.insertImmutable(input.receipt);
      if (!receipt.ok || !receipt.created) {
        conflict(policy, `${policy.label} receipt identifier collided.`);
      }
      const queued = await dependencies.runs.create(input.queuedRun);
      if (!queued.ok) conflict(policy, `${policy.label} run identifier collided.`);
      const running = await dependencies.runs.transition({
        runId: input.queuedRun.id,
        expectedStatus: "queued",
        next: input.runningRun
      });
      if (!running.ok) conflict(policy);
      failAt(dependencies.failAfter, "begin-run", policy);
      const attempt = await dependencies.attempts.create({ attempt: input.attempt });
      if (!attempt.ok || !attempt.created) conflict(policy);
      const assignment = await dependencies.assignments.compareAndSet({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: current.id,
        expectedVersion: input.expectedAssignmentVersion,
        next: input.runningAssignment
      });
      if (!assignment.ok) conflict(policy);
      return Object.freeze({
        replayed: false,
        receipt: receipt.receipt,
        run: running.run,
        attempt: attempt.attempt,
        assignment: assignment.assignment
      });
    },

    async complete(input: CompleteStoryWorkGenerationInput) {
      const assignment = await requireOwnedAssignment(dependencies, policy, {
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.artifactReadyAssignment.id
      });
      const [attempt, run] = await Promise.all([
        dependencies.attempts.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: assignment.id,
          runId: input.readyRun.id
        }),
        dependencies.runs.get(input.readyRun.id)
      ]);
      if (
        attempt === undefined ||
        run === undefined ||
        assignment.version !== input.expectedAssignmentVersion ||
        attempt.version !== input.expectedAttemptVersion ||
        run.status !== input.expectedRunStatus
      ) {
        conflict(policy);
      }
      validateAttemptBinding(attempt, assignment, run, policy);
      validateProposalBinding(input.proposal, assignment, attempt, run, policy);

      if (input.completedAttempt.completedAt === undefined) {
        conflict(
          policy,
          `Completed ${policy.lowerLabel} generation requires an attempt completion time.`
        );
      }

      const pointer = artifactPointer(input.proposal, attempt);
      const expectedAttempt = completeStoryWorkAttempt({
        attempt,
        expectedVersion: input.expectedAttemptVersion,
        resultArtifact: pointer,
        completedAt: input.completedAttempt.completedAt
      });
      const expectedAssignment = attachGeneratedStoryWorkArtifact({
        assignment,
        expectedVersion: input.expectedAssignmentVersion,
        runId: run.id,
        artifact: pointer,
        ...(attempt.priorArtifact === undefined
          ? {}
          : { expectedCurrentArtifact: attempt.priorArtifact }),
        updatedAt: input.artifactReadyAssignment.updatedAt
      });
      const readyRun = createAgentRun(input.readyRun);
      if (
        readyRun.status !== "ready" ||
        !exact(expectedAttempt, input.completedAttempt) ||
        !exact(expectedAssignment, input.artifactReadyAssignment)
      ) {
        conflict(policy);
      }

      const proposal = await dependencies.proposals.create(
        createReadyAgentProposal(input.proposal)
      );
      if (!proposal.ok) {
        conflict(policy, `${policy.label} proposal identifier collided.`);
      }
      failAt(dependencies.failAfter, "complete-proposal", policy);
      const nextAttempt = await dependencies.attempts.compareAndSet({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: assignment.id,
        runId: run.id,
        expectedVersion: input.expectedAttemptVersion,
        next: input.completedAttempt
      });
      if (!nextAttempt.ok) conflict(policy);
      const nextRun = await dependencies.runs.transition({
        runId: run.id,
        expectedStatus: input.expectedRunStatus,
        next: readyRun
      });
      if (!nextRun.ok) conflict(policy);
      failAt(dependencies.failAfter, "finish-run", policy);
      const nextAssignment = await dependencies.assignments.compareAndSet({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: assignment.id,
        expectedVersion: input.expectedAssignmentVersion,
        next: input.artifactReadyAssignment
      });
      if (!nextAssignment.ok) conflict(policy);
      return Object.freeze({
        assignment: nextAssignment.assignment,
        attempt: nextAttempt.attempt,
        run: nextRun.run,
        proposal: proposal.proposal
      });
    },

    async finishWithoutArtifact(input: FinishStoryWorkGenerationInput) {
      const assignment = await requireOwnedAssignment(dependencies, policy, {
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: input.terminalAssignment.id
      });
      const [attempt, run] = await Promise.all([
        dependencies.attempts.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: assignment.id,
          runId: input.terminalRun.id
        }),
        dependencies.runs.get(input.terminalRun.id)
      ]);
      if (
        attempt === undefined ||
        run === undefined ||
        assignment.version !== input.expectedAssignmentVersion ||
        attempt.version !== input.expectedAttemptVersion ||
        run.status !== input.expectedRunStatus
      ) {
        conflict(policy);
      }
      validateAttemptBinding(attempt, assignment, run, policy);
      const terminalRun = createAgentRun(input.terminalRun);
      validateTerminalPair(terminalRun, input.terminalAssignment, policy);
      const assignmentOutcome =
        terminalRun.status === "failed" &&
        terminalRun.terminalDiagnosticCode === "run-canceled"
          ? "canceled"
          : terminalRun.status;
      if (
        assignmentOutcome !== "failed" &&
        assignmentOutcome !== "canceled" &&
        assignmentOutcome !== "stale"
      ) {
        conflict(policy);
      }
      const expectedAssignment = finishStoryWorkAttemptWithoutArtifact({
        assignment,
        expectedVersion: input.expectedAssignmentVersion,
        runId: run.id,
        outcome: assignmentOutcome,
        updatedAt: input.terminalAssignment.updatedAt
      });
      if (!exact(expectedAssignment, input.terminalAssignment)) conflict(policy);

      const nextRun = await dependencies.runs.transition({
        runId: run.id,
        expectedStatus: input.expectedRunStatus,
        next: terminalRun
      });
      if (!nextRun.ok) conflict(policy);
      const nextAssignment = await dependencies.assignments.compareAndSet({
        accountId: input.accountId,
        projectId: input.projectId,
        assignmentId: assignment.id,
        expectedVersion: input.expectedAssignmentVersion,
        next: input.terminalAssignment
      });
      if (!nextAssignment.ok) conflict(policy);
      return Object.freeze({
        assignment: nextAssignment.assignment,
        attempt,
        run: nextRun.run
      });
    }
  });
}
