import type { AsyncHashPort } from "./agent-domain.js";
import type {
  AgentProposalRepository,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import {
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError
} from "./agent-runs-proposals.js";
import {
  characterStoryWorkExactReplay,
  validateCharacterStoryWorkApply
} from "./character-story-work-apply-policy.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import type {
  ApplyCharacterStoryWorkInput,
  CharacterStoryWorkApplyResult,
  CharacterStoryWorkApplyUnitOfWork
} from "./character-story-work-uow.js";
import { defineProjectRecords, type ProjectRecords } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner
} from "./identity.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionParticipant,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";
import type { ProjectRepository } from "./project-repository.js";
import type { SceneDocumentRepository } from "./scene-document-repository.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import { StoryWorkAssignmentTransitionError } from "./story-work-assignment.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import { StoryWorkAttemptTransitionError } from "./story-work-attempt.js";

export type MemoryCharacterStoryWorkFailurePoint = "after-project" | "after-proposal";

type Dependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  hashPort: AsyncHashPort;
  failAfter?: MemoryCharacterStoryWorkFailurePoint;
}>;

async function loadProjectRecords(
  projects: ProjectRepository,
  projectId: ApplyCharacterStoryWorkInput["projectId"]
): Promise<ProjectRecords | undefined> {
  const [project, books, scenes, storyKnowledge, editions] = await Promise.all([
    projects.getProject(projectId),
    projects.listBooks(projectId),
    projects.listScenes(projectId),
    projects.listStoryKnowledge(projectId),
    projects.listEditions(projectId)
  ]);
  return project === undefined
    ? undefined
    : defineProjectRecords({ project, books, scenes, storyKnowledge, editions });
}

function participant(repository: unknown, label: string): MemoryTransactionParticipant {
  const candidate = (repository as MemoryTransactionalRepository)[MEMORY_TRANSACTION_STATE];
  if (candidate === undefined) {
    throw new Error(`Memory character apply requires the ${label} memory repository.`);
  }
  return candidate;
}

function failAt(
  expected: MemoryCharacterStoryWorkFailurePoint | undefined,
  actual: MemoryCharacterStoryWorkFailurePoint
): void {
  if (expected === actual) throw new Error(`Injected character apply failure ${actual}.`);
}

export function createMemoryCharacterStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): CharacterStoryWorkApplyUnitOfWork {
  const participants = [
    participant(dependencies.projects, "project"),
    participant(dependencies.sceneDocuments, "scene-document"),
    participant(dependencies.assignments, "assignment"),
    participant(dependencies.proposals, "proposal")
  ];
  let transactionTail: Promise<void> = Promise.resolve();

  return Object.freeze({
    async applyCharacter(
      input: ApplyCharacterStoryWorkInput & Readonly<{ appliedAt: string }>
    ): Promise<CharacterStoryWorkApplyResult> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = participants.map((entry) => entry.snapshot());
      try {
        const assignment = await dependencies.assignments.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId
        });
        if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
        try {
          requireProjectOwner(
            input.projectId,
            await dependencies.projects.getProjectMembership(
              input.projectId,
              input.accountId
            )
          );
        } catch (error) {
          if (error instanceof ProjectAccessDeniedError) {
            throw new StoryWorkAssignmentNotFoundError();
          }
          throw error;
        }
        const proposal = await dependencies.proposals.get(input.proposalId);
        if (proposal === undefined) throw new AgentProposalNotFoundError();
        const run = await dependencies.runs.get(proposal.runId);
        if (run === undefined) throw new AgentRunNotFoundError();
        const receipt = await dependencies.receipts.get(proposal.receiptId);
        if (receipt === undefined) throw new AgentReceiptNotFoundError();
        const attempt = await dependencies.attempts.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId,
          runId: run.id
        });
        if (attempt === undefined) throw new StoryWorkAttemptTransitionError();
        const canonical = { assignment, attempt, proposal, run, receipt };
        const replay = characterStoryWorkExactReplay({
          accountId: input.accountId,
          exactInput: input,
          ...canonical
        });
        if (replay !== undefined) return replay;

        const currentRecords = await loadProjectRecords(
          dependencies.projects,
          input.projectId
        );
        if (currentRecords === undefined) throw new StoryWorkAssignmentNotFoundError();
        const consumedSceneIds = receipt.resources.flatMap((resource) =>
          resource.resourceClass === "scene-document" ? [resource.sceneId] : []
        );
        const sceneDocumentHeads = await dependencies.sceneDocuments.getHeads(
          consumedSceneIds
        );
        const validated = await validateCharacterStoryWorkApply({
          accountId: input.accountId,
          exactInput: input,
          appliedAt: input.appliedAt,
          currentRecords,
          sceneDocumentHeads,
          hashPort: dependencies.hashPort,
          ...canonical
        });

        await dependencies.projects.transaction((writer) => {
          writer.replaceProjectRecords(
            validated.updatedRecords,
            input.expectedProjectVersion
          );
        });
        failAt(dependencies.failAfter, "after-project");
        const proposalOutcome = await dependencies.proposals.markApplied({
          proposalId: proposal.id,
          projectId: input.projectId,
          expectedStatus: "ready",
          actorAccountId: input.accountId,
          appliedAt: input.appliedAt,
          updatedAt: input.appliedAt
        });
        if (!proposalOutcome.ok) throw new AgentProposalStateConflictError();
        failAt(dependencies.failAfter, "after-proposal");
        const assignmentOutcome = await dependencies.assignments.compareAndSet({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: assignment.id,
          expectedVersion: input.expectedAssignmentVersion,
          next: validated.updatedAssignment
        });
        if (!assignmentOutcome.ok) throw new StoryWorkAssignmentTransitionError();
        return Object.freeze({
          replayed: false,
          assignment: assignmentOutcome.assignment,
          proposal: proposalOutcome.proposal,
          result: validated.result
        });
      } catch (error) {
        participants.forEach((entry, index) => entry.restore(snapshots[index]));
        throw error;
      } finally {
        release();
      }
    }
  });
}
