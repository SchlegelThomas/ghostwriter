import {
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError,
  ProjectAccessDeniedError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkAssignmentTransitionError,
  StoryWorkAttemptTransitionError,
  defineProjectRecords,
  requireProjectOwner,
  structureStoryWorkApplyRequestFingerprint,
  structureStoryWorkExactReplay,
  validateStructureStoryWorkApply,
  validateStoryStructureProposalV1,
  type ApplyStructureStoryWorkInput,
  type AsyncHashPort,
  type ContextReceipt,
  type IdGenerator,
  type ProjectRecords,
  type SceneId,
  type StructureStoryWorkApplyResult,
  type StructureStoryWorkApplyUnitOfWork
} from "@ghostwriter/core";
import { and, eq, inArray } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import {
  agentProposals,
  agentRuns,
  canvasBoards,
  contextReceipts,
  projects,
  sceneDocuments,
  storyWorkAssignments,
  storyWorkAttempts
} from "./schema.js";

type Dependencies = Readonly<{
  db: RepositoryDatabase;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
}>;

async function loadProjectRecords(
  projectsRepository: ReturnType<typeof createPostgresProjectRepository>,
  projectId: ApplyStructureStoryWorkInput["projectId"]
): Promise<ProjectRecords | undefined> {
  const [project, books, scenes, storyKnowledge, editions] = await Promise.all([
    projectsRepository.getProject(projectId),
    projectsRepository.listBooks(projectId),
    projectsRepository.listScenes(projectId),
    projectsRepository.listStoryKnowledge(projectId),
    projectsRepository.listEditions(projectId)
  ]);
  return project === undefined
    ? undefined
    : defineProjectRecords({ project, books, scenes, storyKnowledge, editions });
}

async function lockAssignment(
  db: RepositoryDatabase,
  input: ApplyStructureStoryWorkInput
): Promise<void> {
  const rows = await db
    .select({ id: storyWorkAssignments.id })
    .from(storyWorkAssignments)
    .where(
      and(
        eq(storyWorkAssignments.id, input.assignmentId),
        eq(storyWorkAssignments.projectId, input.projectId),
        eq(storyWorkAssignments.initiatorAccountId, input.accountId)
      )
    )
    .for("update");
  if (rows.length === 0) throw new StoryWorkAssignmentNotFoundError();
}

async function lockProposal(
  db: RepositoryDatabase,
  input: ApplyStructureStoryWorkInput
): Promise<void> {
  const rows = await db
    .select({ id: agentProposals.id })
    .from(agentProposals)
    .where(
      and(
        eq(agentProposals.id, input.proposalId),
        eq(agentProposals.projectId, input.projectId)
      )
    )
    .for("update");
  if (rows.length === 0) throw new AgentProposalNotFoundError();
}

async function lockRunReceiptAndAttempt(
  db: RepositoryDatabase,
  input: ApplyStructureStoryWorkInput,
  runId: string,
  receiptId: string
): Promise<void> {
  const runRows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.projectId, input.projectId)))
    .for("update");
  if (runRows.length === 0) throw new AgentRunNotFoundError();
  const receiptRows = await db
    .select({ id: contextReceipts.id })
    .from(contextReceipts)
    .where(
      and(
        eq(contextReceipts.id, receiptId),
        eq(contextReceipts.projectId, input.projectId)
      )
    )
    .for("update");
  if (receiptRows.length === 0) throw new AgentReceiptNotFoundError();
  const attemptRows = await db
    .select({ id: storyWorkAttempts.runId })
    .from(storyWorkAttempts)
    .where(
      and(
        eq(storyWorkAttempts.runId, runId),
        eq(storyWorkAttempts.assignmentId, input.assignmentId),
        eq(storyWorkAttempts.projectId, input.projectId),
        eq(storyWorkAttempts.initiatorAccountId, input.accountId)
      )
    )
    .for("update");
  if (attemptRows.length === 0) throw new StoryWorkAttemptTransitionError();
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

function sceneIdsFromReceipt(receipt: ContextReceipt): SceneId[] {
  return receipt.resources.flatMap((resource) =>
    resource.resourceClass === "scene-document" ? [resource.sceneId] : []
  );
}

async function lockSceneDocumentHeads(
  db: RepositoryDatabase,
  projectId: ApplyStructureStoryWorkInput["projectId"],
  sceneIds: readonly SceneId[]
): Promise<void> {
  const ordered = [...new Set(sceneIds)].sort();
  if (ordered.length === 0) return;
  await db
    .select({ id: sceneDocuments.sceneId })
    .from(sceneDocuments)
    .where(
      and(eq(sceneDocuments.projectId, projectId), inArray(sceneDocuments.sceneId, ordered))
    )
    .orderBy(sceneDocuments.sceneId)
    .for("update");
}

async function lockProjectRow(
  db: RepositoryDatabase,
  projectId: ApplyStructureStoryWorkInput["projectId"]
): Promise<void> {
  await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
}

async function lockCanvasBoard(
  db: RepositoryDatabase,
  projectId: ApplyStructureStoryWorkInput["projectId"]
): Promise<void> {
  await db
    .select({ projectId: canvasBoards.projectId })
    .from(canvasBoards)
    .where(eq(canvasBoards.projectId, projectId))
    .for("update");
}

export function createPostgresStructureStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): StructureStoryWorkApplyUnitOfWork {
  return Object.freeze({
    async applyStructure(
      input: ApplyStructureStoryWorkInput & Readonly<{ appliedAt: string }>
    ): Promise<StructureStoryWorkApplyResult> {
      const wantsCanvas = input.canvasPlacement !== undefined;

      return dependencies.db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const projectsRepository = createPostgresProjectRepository(exec);
        const sceneDocumentRepository = createPostgresSceneDocumentRepository(exec);
        const canvasRepository = createPostgresCanvasRepository(exec);
        const assignments = createPostgresStoryWorkAssignmentRepository(exec);
        const attempts = createPostgresStoryWorkAttemptRepository(exec);
        const proposals = createPostgresAgentProposalRepository(exec);
        const runs = createPostgresAgentRunRepository(exec);
        const receipts = createPostgresContextReceiptRepository(exec);

        await lockAssignment(exec, input);
        const assignment = await assignments.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId
        });
        if (assignment === undefined) throw new StoryWorkAssignmentNotFoundError();
        try {
          requireProjectOwner(
            input.projectId,
            await projectsRepository.getProjectMembership(input.projectId, input.accountId)
          );
        } catch (error) {
          if (error instanceof ProjectAccessDeniedError) {
            throw new StoryWorkAssignmentNotFoundError();
          }
          throw error;
        }

        await lockProposal(exec, input);
        const proposal = await proposals.get(input.proposalId);
        if (proposal === undefined) throw new AgentProposalNotFoundError();
        await lockRunReceiptAndAttempt(exec, input, proposal.runId, proposal.receiptId);
        const run = await runs.get(proposal.runId);
        if (run === undefined) throw new AgentRunNotFoundError();
        const receipt = await receipts.get(proposal.receiptId);
        if (receipt === undefined) throw new AgentReceiptNotFoundError();
        const attempt = await attempts.get({
          accountId: input.accountId,
          projectId: input.projectId,
          assignmentId: input.assignmentId,
          runId: run.id
        });
        if (attempt === undefined) throw new StoryWorkAttemptTransitionError();

        const applyRequestFingerprint = await structureStoryWorkApplyRequestFingerprint(
          input,
          dependencies.hashPort
        );
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

        const consumedSceneIds = sceneIdsFromReceipt(receipt);
        const lockedSceneIds = [
          ...new Set([...consumedSceneIds, ...reservedProposalSceneIds(proposal)])
        ].sort();
        await lockSceneDocumentHeads(exec, input.projectId, lockedSceneIds);
        await lockProjectRow(exec, input.projectId);
        if (wantsCanvas) {
          await lockCanvasBoard(exec, input.projectId);
        }

        const currentRecords = await loadProjectRecords(projectsRepository, input.projectId);
        if (currentRecords === undefined) throw new StoryWorkAssignmentNotFoundError();
        const sceneDocumentHeads = await sceneDocumentRepository.getHeads(consumedSceneIds);

        const canvasBoard = wantsCanvas
          ? await canvasRepository.getBoard(input.projectId)
          : undefined;
        const canvasParentRevisionId =
          canvasBoard === undefined
            ? undefined
            : (await canvasRepository.listRevisions(input.projectId, { limit: 1 }))[0]?.id;

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

        await projectsRepository.transaction((writer) => {
          writer.replaceProjectRecords(
            validated.updatedRecords,
            input.expectedProjectVersion
          );
        });

        for (const sceneDocument of validated.sceneDocuments) {
          await sceneDocumentRepository.initialize(sceneDocument);
        }

        if (
          validated.canvasMutation !== undefined &&
          validated.expectedCanvasVersion !== undefined
        ) {
          await canvasRepository.replace({
            mutation: validated.canvasMutation,
            expectedCanvasVersion: validated.expectedCanvasVersion
          });
        }

        const proposalOutcome = await proposals.markApplied({
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

        const assignmentOutcome = await assignments.compareAndSet({
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
      });
    }
  });
}
