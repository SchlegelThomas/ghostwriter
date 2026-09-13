import {
  AgentProposalNotFoundError,
  AgentProposalStateConflictError,
  AgentReceiptNotFoundError,
  AgentRunNotFoundError,
  ProjectAccessDeniedError,
  StoryWorkAssignmentNotFoundError,
  StoryWorkAssignmentTransitionError,
  StoryWorkAttemptTransitionError,
  characterStoryWorkExactReplay,
  defineProjectRecords,
  requireProjectOwner,
  validateCharacterStoryWorkApply,
  type ApplyCharacterStoryWorkInput,
  type AsyncHashPort,
  type CharacterStoryWorkApplyResult,
  type CharacterStoryWorkApplyUnitOfWork,
  type ProjectRecords,
  type SceneId
} from "@ghostwriter/core";
import { and, eq, inArray } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  createPostgresAgentProposalRepository,
  createPostgresAgentRunRepository,
  createPostgresContextReceiptRepository
} from "./postgres-agent-foundation-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import {
  createPostgresStoryWorkAssignmentRepository,
  createPostgresStoryWorkAttemptRepository
} from "./postgres-story-work-repository.js";
import {
  agentProposals,
  agentRuns,
  contextReceipts,
  sceneDocuments,
  storyWorkAssignments,
  storyWorkAttempts
} from "./schema.js";

type Dependencies = Readonly<{
  db: RepositoryDatabase;
  hashPort: AsyncHashPort;
}>;

async function loadProjectRecords(
  projects: ReturnType<typeof createPostgresProjectRepository>,
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

async function lockAssignment(
  db: RepositoryDatabase,
  input: ApplyCharacterStoryWorkInput
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
  input: ApplyCharacterStoryWorkInput
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

async function lockRunAndReceipt(
  db: RepositoryDatabase,
  input: ApplyCharacterStoryWorkInput,
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
    .for("share");
  if (receiptRows.length === 0) throw new AgentReceiptNotFoundError();
}

async function lockAttempt(
  db: RepositoryDatabase,
  input: ApplyCharacterStoryWorkInput,
  runId: string
): Promise<void> {
  const rows = await db
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
  if (rows.length === 0) throw new StoryWorkAttemptTransitionError();
}

async function lockConsumedSceneHeads(
  db: RepositoryDatabase,
  projectId: ApplyCharacterStoryWorkInput["projectId"],
  sceneIds: readonly SceneId[]
): Promise<void> {
  const ordered = [...new Set(sceneIds)].sort();
  if (ordered.length === 0) return;
  await db
    .select({ id: sceneDocuments.sceneId })
    .from(sceneDocuments)
    .where(
      and(
        eq(sceneDocuments.projectId, projectId),
        inArray(sceneDocuments.sceneId, ordered)
      )
    )
    .orderBy(sceneDocuments.sceneId)
    .for("update");
}

export function createPostgresCharacterStoryWorkApplyUnitOfWork(
  dependencies: Dependencies
): CharacterStoryWorkApplyUnitOfWork {
  return Object.freeze({
    async applyCharacter(
      input: ApplyCharacterStoryWorkInput & Readonly<{ appliedAt: string }>
    ): Promise<CharacterStoryWorkApplyResult> {
      return dependencies.db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const projects = createPostgresProjectRepository(exec);
        const sceneDocumentRepository = createPostgresSceneDocumentRepository(exec);
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
            await projects.getProjectMembership(input.projectId, input.accountId)
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
        await lockRunAndReceipt(exec, input, proposal.runId, proposal.receiptId);
        const run = await runs.get(proposal.runId);
        if (run === undefined) throw new AgentRunNotFoundError();
        const receipt = await receipts.get(proposal.receiptId);
        if (receipt === undefined) throw new AgentReceiptNotFoundError();
        await lockAttempt(exec, input, run.id);
        const attempt = await attempts.get({
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

        const consumedSceneIds = receipt.resources.flatMap((resource) =>
          resource.resourceClass === "scene-document" ? [resource.sceneId] : []
        );
        await lockConsumedSceneHeads(exec, input.projectId, consumedSceneIds);
        const currentRecords = await loadProjectRecords(projects, input.projectId);
        if (currentRecords === undefined) throw new StoryWorkAssignmentNotFoundError();
        const sceneDocumentHeads = await sceneDocumentRepository.getHeads(
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

        await projects.transaction((writer) => {
          writer.replaceProjectRecords(
            validated.updatedRecords,
            input.expectedProjectVersion
          );
        });
        const proposalOutcome = await proposals.markApplied({
          proposalId: proposal.id,
          projectId: input.projectId,
          expectedStatus: "ready",
          actorAccountId: input.accountId,
          appliedAt: input.appliedAt,
          updatedAt: input.appliedAt
        });
        if (!proposalOutcome.ok) throw new AgentProposalStateConflictError();
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
