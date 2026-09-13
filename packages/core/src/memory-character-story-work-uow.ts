import {
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  instructionContentHash
} from "./agent-domain.js";
import type {
  AgentProposalRepository,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import {
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError,
  AgentRunReceiptMismatchError,
  type AgentProposal
} from "./agent-runs-proposals.js";
import {
  CharacterStoryWorkArtifactMismatchError,
  StoryWorkAssignmentNotFoundError
} from "./character-story-work-services.js";
import type {
  ApplyCharacterStoryWorkInput,
  CharacterStoryWorkApplyResult,
  CharacterStoryWorkApplyUnitOfWork
} from "./character-story-work-uow.js";
import { validateCharacterCreateV2 } from "./character-create-v2.js";
import {
  createStoryKnowledge,
  defineProjectRecords,
  DomainValidationError,
  storyKnowledgeId,
  type ProjectRecords,
  type StoryKnowledgeId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner
} from "./identity.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionParticipant,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";
import { applyProjectCommandToRecords } from "./project-commands.js";
import {
  ProjectVersionConflictError,
  type DomainIdKind,
  type IdGenerator,
  type ProjectRepository
} from "./project-repository.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import {
  recordAppliedStoryWorkAssignmentFromUnitOfWork,
  StoryWorkAssignmentTransitionError,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkResultReference
} from "./story-work-assignment.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import { StoryWorkAttemptTransitionError } from "./story-work-attempt.js";

export type MemoryCharacterStoryWorkFailurePoint = "after-project" | "after-proposal";

type Dependencies = Readonly<{
  projects: ProjectRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  failAfter?: MemoryCharacterStoryWorkFailurePoint;
}>;

function sameArtifact(
  left: StoryWorkArtifactPointer | undefined,
  input: Pick<
    ApplyCharacterStoryWorkInput,
    "proposalId" | "expectedArtifactVersion" | "expectedProposalContentHash"
  >
): boolean {
  return (
    left?.proposalId === input.proposalId &&
    left.artifactVersion === input.expectedArtifactVersion &&
    left.contentHash === instructionContentHash(String(input.expectedProposalContentHash))
  );
}

function reservedDestination(assignment: StoryWorkAssignment): StoryKnowledgeId {
  if (
    assignment.taskKind !== "character" ||
    assignment.destination.kind !== "story-knowledge" ||
    assignment.destination.operation !== "create"
  ) {
    throw new CharacterStoryWorkArtifactMismatchError(
      "Character apply requires the assignment's exact reserved Cast destination."
    );
  }
  return assignment.destination.storyKnowledgeId;
}

function exactResult(
  assignment: StoryWorkAssignment,
  destinationId: StoryKnowledgeId,
  projectVersion: number
): Extract<StoryWorkResultReference, { kind: "story-knowledge" }> | undefined {
  if (assignment.results.length !== 1) return undefined;
  const [result] = assignment.results;
  return result?.kind === "story-knowledge" &&
    result.storyKnowledgeId === destinationId &&
    result.projectVersion === projectVersion
    ? result
    : undefined;
}

function fixedKnowledgeIdGenerator(id: StoryKnowledgeId): IdGenerator {
  return Object.freeze({
    create(kind: DomainIdKind): string {
      if (kind !== "storyKnowledge") {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Character apply may generate only its reserved story-knowledge ID."
        );
      }
      return id;
    }
  });
}

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

function characterProjectRecords(input: Readonly<{
  current: ProjectRecords;
  assignment: StoryWorkAssignment;
  proposal: AgentProposal;
  destinationId: StoryKnowledgeId;
  appliedAt: string;
}>): ProjectRecords {
  const payload = validateCharacterCreateV2(input.proposal.payload);
  if (input.current.storyKnowledge.some((entry) => entry.id === input.destinationId)) {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "The reserved Cast destination is already in use."
    );
  }
  const permittedSceneIds = new Set(
    input.assignment.sources.flatMap((source) =>
      source.kind === "scene" ? [source.sceneId] : []
    )
  );
  const sourceSceneIds = payload.sourceSceneIds ?? [];
  for (const sourceSceneId of sourceSceneIds) {
    if (!permittedSceneIds.has(sourceSceneId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Character scene links must stay within the assignment's explicit scene sources."
      );
    }
    const scene = input.current.scenes.find((candidate) => candidate.id === sourceSceneId);
    if (scene === undefined || scene.archivedAt !== undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Character scene links require active scenes in the current project."
      );
    }
  }
  const created = applyProjectCommandToRecords(
    input.current,
    {
      type: "storyKnowledge.create",
      label: payload.name,
      kind: "character",
      authority: "planned"
    },
    fixedKnowledgeIdGenerator(input.destinationId),
    input.appliedAt
  );
  const base = created.storyKnowledge.find((entry) => entry.id === input.destinationId);
  if (base === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Character apply did not create its reserved Cast destination."
    );
  }
  const dossier = createStoryKnowledge({
    ...base,
    notes: payload.summary,
    aliases: payload.aliases,
    characterSheet: payload.characterSheet,
    linkedSceneIds: sourceSceneIds
  });
  return defineProjectRecords({
    ...created,
    storyKnowledge: created.storyKnowledge.map((entry) =>
      entry.id === dossier.id ? dossier : entry
    )
  });
}

function participant(repository: unknown, label: string): MemoryTransactionParticipant {
  const candidate = (repository as MemoryTransactionalRepository)[MEMORY_TRANSACTION_STATE];
  if (candidate === undefined) {
    throw new Error(`Memory character apply requires the ${label} memory repository.`);
  }
  return candidate;
}

function failAt(expected: MemoryCharacterStoryWorkFailurePoint | undefined, actual: MemoryCharacterStoryWorkFailurePoint): void {
  if (expected === actual) throw new Error(`Injected character apply failure ${actual}.`);
}

export function createMemoryCharacterStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): CharacterStoryWorkApplyUnitOfWork {
  const participants = [
    participant(dependencies.projects, "project"),
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
        let assignment = await dependencies.assignments.get({
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
        const destinationId = reservedDestination(assignment);
        const proposal = await dependencies.proposals.get(input.proposalId);
        if (proposal === undefined || proposal.projectId !== input.projectId) {
          throw new AgentProposalNotFoundError();
        }
        if (!sameArtifact(assignment.currentArtifact, input)) {
          throw new CharacterStoryWorkArtifactMismatchError();
        }
        const run = await dependencies.runs.get(proposal.runId);
        if (
          run === undefined ||
          run.projectId !== input.projectId ||
          run.initiatorAccountId !== input.accountId
        ) throw new AgentRunNotFoundError();
        const receipt = await dependencies.receipts.get(proposal.receiptId);
        if (receipt === undefined || receipt.projectId !== input.projectId) {
          throw new AgentReceiptNotFoundError();
        }
        if (
          run.receiptId !== receipt.id ||
          run.receiptHash !== receipt.receiptHash ||
          proposal.receiptId !== receipt.id
        ) throw new AgentRunReceiptMismatchError();
        if (
          proposal.runId !== run.id ||
          run.workflowId !== CHARACTER_STORY_WORK_WORKFLOW_ID ||
          receipt.workflowId !== CHARACTER_STORY_WORK_WORKFLOW_ID ||
          run.workflowVersion !== receipt.workflowVersion ||
          assignment.provider !== run.provider ||
          assignment.model !== run.model ||
          receipt.provider !== run.provider ||
          receipt.model !== run.model ||
          proposal.outputSchemaId !== "character-create-v2" ||
          proposal.primaryTarget.kind !== "story-knowledge" ||
          proposal.primaryTarget.id !== destinationId ||
          receipt.outputSchemaId !== "character-create-v2" ||
          receipt.targetStoryKnowledgeId !== destinationId ||
          receipt.primaryTarget?.kind !== "story-knowledge" ||
          receipt.primaryTarget.id !== destinationId
        ) throw new CharacterStoryWorkArtifactMismatchError();
        const attempt = await dependencies.attempts.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId,
          runId: run.id
        });
        if (
          attempt === undefined ||
          !sameArtifact(attempt.resultArtifact, input)
        ) throw new StoryWorkAttemptTransitionError();

        if (assignment.status === "applied") {
          const result = exactResult(
            assignment,
            destinationId,
            input.expectedProjectVersion + 1
          );
          if (
            assignment.version !== input.expectedAssignmentVersion + 1 ||
            proposal.status !== "applied" ||
            proposal.applied?.actorAccountId !== input.accountId ||
            result === undefined
          ) throw new StoryWorkAssignmentTransitionError();
          return Object.freeze({ replayed: true, assignment, proposal, result });
        }
        if (
          assignment.version !== input.expectedAssignmentVersion ||
          assignment.status !== "awaiting-review"
        ) throw new StoryWorkAssignmentTransitionError();
        if (proposal.status !== "ready") throw new AgentProposalStateConflictError();
        if (
          proposal.contentHash !==
          instructionContentHash(String(input.expectedProposalContentHash))
        ) throw new CharacterStoryWorkArtifactMismatchError();
        if (run.status !== "ready") throw new AgentProposalStateConflictError();

        const current = await loadProjectRecords(dependencies.projects, input.projectId);
        if (current === undefined || current.project.version !== input.expectedProjectVersion) {
          throw new ProjectVersionConflictError(
            input.projectId,
            input.expectedProjectVersion
          );
        }
        if (current.project.archivedAt !== undefined) {
          throw new ProjectArchivedMutationError();
        }
        const updatedRecords = characterProjectRecords({
          current,
          assignment,
          proposal,
          destinationId,
          appliedAt: input.appliedAt
        });
        const result = Object.freeze({
          kind: "story-knowledge" as const,
          storyKnowledgeId: storyKnowledgeId(destinationId),
          projectVersion: updatedRecords.project.version
        });
        const updatedAssignment = recordAppliedStoryWorkAssignmentFromUnitOfWork({
          assignment,
          expectedVersion: input.expectedAssignmentVersion,
          artifact: assignment.currentArtifact!,
          results: [result],
          updatedAt: input.appliedAt
        });

        await dependencies.projects.transaction((writer) => {
          writer.replaceProjectRecords(updatedRecords, input.expectedProjectVersion);
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
          next: updatedAssignment
        });
        if (!assignmentOutcome.ok) throw new StoryWorkAssignmentTransitionError();
        assignment = assignmentOutcome.assignment;
        return Object.freeze({
          replayed: false,
          assignment,
          proposal: proposalOutcome.proposal,
          result
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
