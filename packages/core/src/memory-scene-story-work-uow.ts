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
import type { CanvasRepository } from "./canvas-repository.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
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
import type { ProjectRepository, IdGenerator } from "./project-repository.js";
import type { SceneDocumentRepository } from "./scene-document-repository.js";
import {
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError
} from "./scene-documents.js";
import {
  sceneStoryWorkExactReplay,
  validateSceneStoryWorkApply
} from "./scene-story-work-apply-policy.js";
import {
  sceneStoryWorkApplyRequestFingerprint,
  type ApplySceneStoryWorkInput,
  type SceneStoryWorkApplyResult,
  type SceneStoryWorkApplyUnitOfWork
} from "./scene-story-work-uow.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import { StoryWorkAssignmentTransitionError } from "./story-work-assignment.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import { StoryWorkAttemptTransitionError } from "./story-work-attempt.js";

export type MemorySceneStoryWorkFailurePoint =
  | "after-project"
  | "after-scene-document"
  | "after-canvas"
  | "after-proposal"
  | "before-assignment";

type Dependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  captures: CaptureDocumentRepository;
  canvases: CanvasRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
  failAfter?: MemorySceneStoryWorkFailurePoint;
}>;

async function loadProjectRecords(
  projects: ProjectRepository,
  projectId: ApplySceneStoryWorkInput["projectId"]
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
    throw new Error(`Memory scene apply requires the ${label} memory repository.`);
  }
  return candidate;
}

function failAt(
  expected: MemorySceneStoryWorkFailurePoint | undefined,
  actual: MemorySceneStoryWorkFailurePoint
): void {
  if (expected === actual) throw new Error(`Injected scene apply failure ${actual}.`);
}

function mapSceneMutationConflict(
  reason:
    | "working-version-conflict"
    | "lease-conflict"
    | "lease-expired"
    | "variant-name-conflict"
): never {
  if (reason === "working-version-conflict") {
    throw new SceneWorkingVersionConflictError();
  }
  if (reason === "lease-expired") throw new SceneLeaseExpiredError();
  if (reason === "variant-name-conflict") throw new SceneVariantNameConflictError();
  throw new SceneLeaseConflictError();
}

export function createMemorySceneStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): SceneStoryWorkApplyUnitOfWork {
  const participants = [
    participant(dependencies.projects, "project"),
    participant(dependencies.sceneDocuments, "scene-document"),
    participant(dependencies.canvases, "Canvas"),
    participant(dependencies.assignments, "assignment"),
    participant(dependencies.proposals, "proposal")
  ];
  let transactionTail: Promise<void> = Promise.resolve();

  return Object.freeze({
    async applyScene(
      input: ApplySceneStoryWorkInput & Readonly<{ appliedAt: string }>
    ): Promise<SceneStoryWorkApplyResult> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = participants.map((entry) => entry.snapshot());
      try {
        const applyRequestFingerprint = await sceneStoryWorkApplyRequestFingerprint(
          input,
          dependencies.hashPort
        );
        const assignment = await dependencies.assignments.get(input);
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
        const canonical = {
          exactInput: input,
          applyRequestFingerprint,
          assignment,
          attempt,
          proposal,
          run,
          receipt
        };
        const replay = sceneStoryWorkExactReplay(canonical);
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
        const captureDocumentHeads = new Map();
        for (const resource of receipt.resources) {
          if (resource.resourceClass !== "capture") continue;
          const head = await dependencies.captures.get(resource.captureId);
          if (head !== undefined) captureDocumentHeads.set(resource.captureId, head);
        }
        const destination = assignment.destination.kind === "scene"
          ? assignment.destination.sceneId
          : undefined;
        const destinationHead = destination === undefined
          ? undefined
          : await dependencies.sceneDocuments.getHead(destination);
        const destinationLease =
          input.mode === "create-scene" || destination === undefined
            ? undefined
            : await dependencies.sceneDocuments.getLease(destination);
        const canvasBoard =
          input.mode === "create-scene" && input.canvas !== undefined
            ? await dependencies.canvases.getBoard(input.projectId)
            : undefined;
        const canvasParentRevisionId =
          canvasBoard === undefined
            ? undefined
            : (await dependencies.canvases.listRevisions(input.projectId, { limit: 1 }))[0]
                ?.id;
        const validated = await validateSceneStoryWorkApply({
          ...canonical,
          appliedAt: input.appliedAt,
          currentRecords,
          sceneDocumentHeads,
          captureDocumentHeads,
          ...(destinationHead === undefined ? {} : { destinationHead }),
          ...(destinationLease === undefined ? {} : { destinationLease }),
          ...(canvasBoard === undefined ? {} : { canvasBoard }),
          ...(canvasParentRevisionId === undefined
            ? {}
            : { canvasParentRevisionId }),
          ids: dependencies.ids,
          hashPort: dependencies.hashPort
        });

        switch (input.mode) {
          case "create-scene": {
            if (validated.kind !== "create-scene") {
              throw new Error("Scene apply validation returned the wrong mode effect.");
            }
            await dependencies.projects.transaction((writer) => {
              writer.replaceProjectRecords(
                validated.updatedRecords,
                input.expectedProjectVersion
              );
            });
            failAt(dependencies.failAfter, "after-project");
            await dependencies.sceneDocuments.initialize(validated.sceneDocument);
            failAt(dependencies.failAfter, "after-scene-document");
            if (
              validated.canvasMutation !== undefined &&
              validated.expectedCanvasVersion !== undefined
            ) {
              await dependencies.canvases.replace({
                mutation: validated.canvasMutation,
                expectedCanvasVersion: validated.expectedCanvasVersion
              });
              failAt(dependencies.failAfter, "after-canvas");
            }
            break;
          }
          case "named-variant": {
            if (validated.kind !== "named-variant") {
              throw new Error("Scene apply validation returned the wrong mode effect.");
            }
            const outcome = await dependencies.sceneDocuments.createNamedVariantFromDocument({
              projectId: input.projectId,
              sceneId: validated.result.sceneId,
              holderId: input.leaseHolderId,
              expectedWorkingVersion: input.expectedSceneWorkingVersion,
              actorAccountId: input.accountId,
              now: input.appliedAt,
              revisionId: validated.revisionId,
              variantId: validated.variantId,
              name: validated.variantName,
              document: validated.document,
              contentHash: validated.contentHash,
              origin: "agent",
              reason: "named-variant"
            });
            if (!outcome.ok) mapSceneMutationConflict(outcome.reason);
            failAt(dependencies.failAfter, "after-scene-document");
            break;
          }
          case "apply-revision": {
            if (validated.kind !== "apply-revision") {
              throw new Error("Scene apply validation returned the wrong mode effect.");
            }
            const outcome = await dependencies.sceneDocuments.applyDocumentAsRevision({
              projectId: input.projectId,
              sceneId: validated.result.sceneId,
              holderId: input.leaseHolderId,
              expectedWorkingVersion: input.expectedSceneWorkingVersion,
              actorAccountId: input.accountId,
              now: input.appliedAt,
              revisionId: validated.revisionId,
              document: validated.document,
              contentHash: validated.contentHash
            });
            if (!outcome.ok) mapSceneMutationConflict(outcome.reason);
            failAt(dependencies.failAfter, "after-scene-document");
            break;
          }
        }

        const proposalOutcome = await dependencies.proposals.markApplied({
          proposalId: proposal.id,
          projectId: input.projectId,
          expectedStatus: "ready",
          actorAccountId: input.accountId,
          appliedAt: input.appliedAt,
          updatedAt: input.appliedAt
        });
        if (!proposalOutcome.ok) {
          if (
            proposalOutcome.reason === "not-found" ||
            proposalOutcome.reason === "cross-project"
          ) {
            throw new AgentProposalNotFoundError();
          }
          throw new AgentProposalStateConflictError();
        }
        failAt(dependencies.failAfter, "after-proposal");
        failAt(dependencies.failAfter, "before-assignment");
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
