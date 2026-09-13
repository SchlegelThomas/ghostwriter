import {
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError,
  ProjectAccessDeniedError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkAssignmentTransitionError,
  StoryWorkAttemptTransitionError,
  requireProjectOwner,
  sceneStoryWorkApplyRequestFingerprint,
  sceneStoryWorkExactReplay,
  defineProjectRecords,
  validateSceneStoryWorkApply,
  type ApplySceneStoryWorkInput,
  type AsyncHashPort,
  type CaptureId,
  type ContextReceipt,
  type IdGenerator,
  type ProjectRecords,
  type SceneId,
  type SceneStoryWorkApplyResult,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  type SceneStoryWorkApplyUnitOfWork
} from "@ghostwriter/core";
import { and, eq, inArray } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
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
  captures,
  contextReceipts,
  projects,
  sceneDocuments,
  sceneEditingLeases,
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
  projectId: ApplySceneStoryWorkInput["projectId"]
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
  input: ApplySceneStoryWorkInput
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
  input: ApplySceneStoryWorkInput
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
  input: ApplySceneStoryWorkInput,
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

async function lockCaptureHeads(
  db: RepositoryDatabase,
  projectId: ApplySceneStoryWorkInput["projectId"],
  captureIds: readonly CaptureId[]
): Promise<void> {
  const ordered = [...new Set(captureIds)].sort();
  if (ordered.length === 0) return;
  await db
    .select({ captureId: captures.captureId })
    .from(captures)
    .where(
      and(eq(captures.projectId, projectId), inArray(captures.captureId, ordered))
    )
    .orderBy(captures.captureId)
    .for("update");
}

async function lockSceneDocumentHeads(
  db: RepositoryDatabase,
  projectId: ApplySceneStoryWorkInput["projectId"],
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

async function lockDestinationLease(
  db: RepositoryDatabase,
  sceneId: SceneId
): Promise<void> {
  await db
    .select({ sceneId: sceneEditingLeases.sceneId })
    .from(sceneEditingLeases)
    .where(eq(sceneEditingLeases.sceneId, sceneId))
    .for("update");
}

async function lockProjectRow(
  db: RepositoryDatabase,
  projectId: ApplySceneStoryWorkInput["projectId"]
): Promise<void> {
  await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
}

async function lockCanvasBoard(
  db: RepositoryDatabase,
  projectId: ApplySceneStoryWorkInput["projectId"]
): Promise<void> {
  await db
    .select({ projectId: canvasBoards.projectId })
    .from(canvasBoards)
    .where(eq(canvasBoards.projectId, projectId))
    .for("update");
}

function captureIdsFromReceipt(receipt: ContextReceipt): CaptureId[] {
  return receipt.resources.flatMap((resource) =>
    resource.resourceClass === "capture" ? [resource.captureId] : []
  );
}

function sceneIdsFromReceipt(receipt: ContextReceipt): SceneId[] {
  return receipt.resources.flatMap((resource) =>
    resource.resourceClass === "scene-document" ? [resource.sceneId] : []
  );
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

export function createPostgresSceneStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): SceneStoryWorkApplyUnitOfWork {
  return Object.freeze({
    async applyScene(
      input: ApplySceneStoryWorkInput & Readonly<{ appliedAt: string }>
    ): Promise<SceneStoryWorkApplyResult> {
      return dependencies.db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const projectsRepository = createPostgresProjectRepository(exec);
        const sceneDocumentRepository = createPostgresSceneDocumentRepository(exec);
        const captureDocumentRepository = createPostgresCaptureDocumentRepository(exec);
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

        const applyRequestFingerprint = await sceneStoryWorkApplyRequestFingerprint(
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
        const replay = sceneStoryWorkExactReplay(canonical);
        if (replay !== undefined) return replay;

        await lockCaptureHeads(exec, input.projectId, captureIdsFromReceipt(receipt));
        const destination =
          assignment.destination.kind === "scene"
            ? assignment.destination.sceneId
            : undefined;
        const lockedSceneIds = [
          ...new Set([
            ...sceneIdsFromReceipt(receipt),
            ...(destination === undefined ? [] : [destination])
          ])
        ].sort();
        await lockSceneDocumentHeads(exec, input.projectId, lockedSceneIds);
        if (input.mode !== "create-scene" && destination !== undefined) {
          await lockDestinationLease(exec, destination);
        }
        await lockProjectRow(exec, input.projectId);
        if (input.mode === "create-scene" && input.canvas !== undefined) {
          await lockCanvasBoard(exec, input.projectId);
        }

        const currentRecords = await loadProjectRecords(projectsRepository, input.projectId);
        if (currentRecords === undefined) throw new StoryWorkAssignmentNotFoundError();
        const consumedSceneIds = sceneIdsFromReceipt(receipt);
        const sceneDocumentHeads = await sceneDocumentRepository.getHeads(consumedSceneIds);
        const captureDocumentHeads = new Map();
        for (const captureId of captureIdsFromReceipt(receipt)) {
          const head = await captureDocumentRepository.get(captureId);
          if (head !== undefined) captureDocumentHeads.set(captureId, head);
        }
        const destinationHead =
          destination === undefined
            ? undefined
            : await sceneDocumentRepository.getHead(destination);
        const destinationLease =
          input.mode === "create-scene" || destination === undefined
            ? undefined
            : await sceneDocumentRepository.getLease(destination);
        const canvasBoard =
          input.mode === "create-scene" && input.canvas !== undefined
            ? await canvasRepository.getBoard(input.projectId)
            : undefined;
        const canvasParentRevisionId =
          canvasBoard === undefined
            ? undefined
            : (await canvasRepository.listRevisions(input.projectId, { limit: 1 }))[0]?.id;

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
            await projectsRepository.transaction((writer) => {
              writer.replaceProjectRecords(
                validated.updatedRecords,
                input.expectedProjectVersion
              );
            });
            await sceneDocumentRepository.initialize(validated.sceneDocument);
            if (
              validated.canvasMutation !== undefined &&
              validated.expectedCanvasVersion !== undefined
            ) {
              await canvasRepository.replace({
                mutation: validated.canvasMutation,
                expectedCanvasVersion: validated.expectedCanvasVersion
              });
            }
            break;
          }
          case "named-variant": {
            if (validated.kind !== "named-variant") {
              throw new Error("Scene apply validation returned the wrong mode effect.");
            }
            const outcome = await sceneDocumentRepository.createNamedVariantFromDocument({
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
            break;
          }
          case "apply-revision": {
            if (validated.kind !== "apply-revision") {
              throw new Error("Scene apply validation returned the wrong mode effect.");
            }
            const outcome = await sceneDocumentRepository.applyDocumentAsRevision({
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
            break;
          }
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
          result: validated.result
        });
      });
    }
  });
}
