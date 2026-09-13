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
import { StoryWorkAssignmentNotFoundError } from "./character-story-work-services.js";
import { defineProjectRecords, type ProjectRecords, type SceneId } from "./domain.js";
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
  structureStoryWorkExactReplay,
  validateStructureStoryWorkApply
} from "./story-structure-apply-policy.js";
import { validateStoryStructureProposalV1 } from "./story-structure-proposal-v1.js";
import {
  structureStoryWorkApplyRequestFingerprint,
  type ApplyStructureStoryWorkInput,
  type StructureStoryWorkApplyResult,
  type StructureStoryWorkApplyUnitOfWork
} from "./story-structure-uow.js";
import type { StoryWorkAssignmentRepository } from "./story-work-assignment-repository.js";
import { StoryWorkAssignmentTransitionError } from "./story-work-assignment.js";
import type { StoryWorkAttemptRepository } from "./story-work-attempt-repository.js";
import { StoryWorkAttemptTransitionError } from "./story-work-attempt.js";

export type MemoryStructureStoryWorkFailurePoint =
  | "after-project"
  | "after-canvas"
  | "after-proposal"
  | "before-assignment";

export type MemoryStructureStoryWorkFailInject = Readonly<{
  after?: MemoryStructureStoryWorkFailurePoint;
  afterSceneInitIndex?: number;
}>;

type Dependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  assignments: StoryWorkAssignmentRepository;
  attempts: StoryWorkAttemptRepository;
  proposals: AgentProposalRepository;
  runs: AgentRunRepository;
  receipts: ContextReceiptRepository;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
  canvases?: CanvasRepository;
  failInject?: MemoryStructureStoryWorkFailInject;
}>;

async function loadProjectRecords(
  projects: ProjectRepository,
  projectId: ApplyStructureStoryWorkInput["projectId"]
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
    throw new Error(`Memory structure apply requires the ${label} memory repository.`);
  }
  return candidate;
}

function failAt(
  inject: MemoryStructureStoryWorkFailInject | undefined,
  point: MemoryStructureStoryWorkFailurePoint
): void {
  if (inject?.after === point) {
    throw new Error(`Injected structure apply failure ${point}.`);
  }
}

function failSceneInit(
  inject: MemoryStructureStoryWorkFailInject | undefined,
  index: number
): void {
  if (inject?.afterSceneInitIndex === index) {
    throw new Error(`Injected structure apply failure after-scene-init-${index}.`);
  }
}

function reservedProposalSceneIds(proposal: { payload: unknown }): readonly SceneId[] {
  try {
    const validated = validateStoryStructureProposalV1(proposal.payload);
    const ids = new Set<SceneId>();
    for (const operation of validated.operations) {
      if ("sceneId" in operation && operation.sceneId !== undefined) {
        ids.add(operation.sceneId);
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

export function createMemoryStructureStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): StructureStoryWorkApplyUnitOfWork {
  let transactionTail: Promise<void> = Promise.resolve();

  return Object.freeze({
    async applyStructure(
      input: ApplyStructureStoryWorkInput & Readonly<{ appliedAt: string }>
    ): Promise<StructureStoryWorkApplyResult> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      const wantsCanvas = input.canvasPlacement !== undefined;
      if (wantsCanvas && dependencies.canvases === undefined) {
        throw new Error("Structure Canvas placement requires a Canvas repository.");
      }

      const participants: MemoryTransactionParticipant[] = [
        participant(dependencies.projects, "project"),
        participant(dependencies.sceneDocuments, "scene-document")
      ];
      if (wantsCanvas) {
        participants.push(participant(dependencies.canvases, "Canvas"));
      }
      participants.push(
        participant(dependencies.assignments, "assignment"),
        participant(dependencies.proposals, "proposal")
      );

      const snapshots = participants.map((entry) => entry.snapshot());
      try {
        const applyRequestFingerprint = await structureStoryWorkApplyRequestFingerprint(
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
        const replay = structureStoryWorkExactReplay(canonical);
        if (replay !== undefined) return replay;

        const currentRecords = await loadProjectRecords(
          dependencies.projects,
          input.projectId
        );
        if (currentRecords === undefined) throw new StoryWorkAssignmentNotFoundError();
        const consumedSceneIds = receipt.resources.flatMap((resource) =>
          resource.resourceClass === "scene-document" ? [resource.sceneId] : []
        );
        const headSceneIds = [
          ...new Set([...consumedSceneIds, ...reservedProposalSceneIds(proposal)])
        ];
        const sceneDocumentHeads = await dependencies.sceneDocuments.getHeads(headSceneIds);

        const canvasBoard = wantsCanvas
          ? await dependencies.canvases!.getBoard(input.projectId)
          : undefined;
        const canvasParentRevisionId =
          canvasBoard === undefined
            ? undefined
            : (await dependencies.canvases!.listRevisions(input.projectId, { limit: 1 }))[0]?.id;

        const validated = await validateStructureStoryWorkApply({
          ...canonical,
          appliedAt: input.appliedAt,
          currentRecords,
          sceneDocumentHeads,
          ...(canvasBoard === undefined ? {} : { canvasBoard }),
          ...(canvasParentRevisionId === undefined ? {} : { canvasParentRevisionId }),
          ids: dependencies.ids,
          hashPort: dependencies.hashPort
        });

        await dependencies.projects.transaction((writer) => {
          writer.replaceProjectRecords(
            validated.updatedRecords,
            input.expectedProjectVersion
          );
        });
        failAt(dependencies.failInject, "after-project");

        for (let index = 0; index < validated.sceneDocuments.length; index += 1) {
          await dependencies.sceneDocuments.initialize(validated.sceneDocuments[index]!);
          failSceneInit(dependencies.failInject, index);
        }

        if (
          validated.canvasMutation !== undefined &&
          validated.expectedCanvasVersion !== undefined
        ) {
          await dependencies.canvases!.replace({
            mutation: validated.canvasMutation,
            expectedCanvasVersion: validated.expectedCanvasVersion
          });
          failAt(dependencies.failInject, "after-canvas");
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
        failAt(dependencies.failInject, "after-proposal");
        failAt(dependencies.failInject, "before-assignment");
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
          result: validated.result,
          preview: validated.preview
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
