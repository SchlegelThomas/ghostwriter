import {
  CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
  type AgentModelId,
  type ContextReceipt
} from "./agent-context-receipt.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  instructionContentHash,
  STORY_KNOWLEDGE_CREATE_DRAFT_WORKFLOW_ID,
  type AgentOutputSchemaId,
  type AsyncHashPort,
  type InstructionLayerMetadata
} from "./agent-domain.js";
import type {
  AgentRunReflectionCompletionUnitOfWork,
  AgentRunRepository,
  ContextReceiptRepository
} from "./agent-foundation-repository.js";
import type { AgentFoundationServices } from "./agent-foundation-services.js";
import {
  AgentReceiptConflictError,
  AgentRunStateConflictError,
  computeAgentProposalContentHash,
  createAgentRun,
  createQueuedAgentRun,
  createReadyAgentProposal,
  type AgentProposal,
  type AgentProposalPrimaryTarget
} from "./agent-runs-proposals.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  DomainValidationError,
  sceneId,
  type ProjectId,
  type SceneId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import {
  assertAgentModelId,
  agentEgressClassForProvider,
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  providerForAgentModel
} from "./model-catalog.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import {
  validateStoryKnowledgeCreateV1,
  type StoryKnowledgeCreateKind,
  type StoryKnowledgeCreateV1
} from "./story-knowledge-create-v1.js";

export type StoryKnowledgeCreateDraftResult = Readonly<{
  proposal: AgentProposal;
}>;

export type StoryKnowledgeCreateDraftServices = Readonly<{
  createStoryKnowledgeDraft(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    name: string;
    kind: StoryKnowledgeCreateKind;
    summary: string;
    properties?: string;
    sceneId?: SceneId;
    firstAppearanceNote?: string;
    model?: AgentModelId;
  }>): Promise<StoryKnowledgeCreateDraftResult>;
}>;

export type StoryKnowledgeCreateDraftServiceDependencies = Readonly<{
  projects: ProjectRepository;
  receipts: ContextReceiptRepository;
  runs: AgentRunRepository;
  completion: AgentRunReflectionCompletionUnitOfWork;
  foundation: Pick<AgentFoundationServices, "persistPreview">;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

function resolvePrimaryTarget(input: Readonly<{
  projectId: ProjectId;
  sceneId?: SceneId;
}>): AgentProposalPrimaryTarget {
  if (input.sceneId !== undefined) {
    return Object.freeze({ kind: "scene", id: input.sceneId });
  }
  return Object.freeze({ kind: "project", id: input.projectId });
}

export function buildStoryKnowledgeCreateDraftPayload(input: Readonly<{
  name: string;
  kind: StoryKnowledgeCreateKind;
  summary: string;
  properties?: string;
  sceneId?: SceneId;
  firstAppearanceNote?: string;
}>): StoryKnowledgeCreateV1 {
  return validateStoryKnowledgeCreateV1({
    schemaId: "story-knowledge-create-v1",
    name: input.name,
    kind: input.kind,
    summary: input.summary,
    ...(input.properties === undefined ? {} : { properties: input.properties }),
    ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
    ...(input.firstAppearanceNote === undefined
      ? {}
      : { firstAppearanceNote: input.firstAppearanceNote })
  });
}

async function buildReceipt(input: Readonly<{
  projectId: ProjectId;
  target: AgentProposalPrimaryTarget;
  model: AgentModelId;
  now: string;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
}>): Promise<ContextReceipt> {
  const model = assertAgentModelId(input.model);
  const provider = providerForAgentModel(model);
  const outputSchemaId: AgentOutputSchemaId = "story-knowledge-create-v1";
  const workflowContract = "story-knowledge-create-draft-v1";
  const layerContentHash = instructionContentHash(
    await input.hashPort.digestSha256Hex(workflowContract)
  );
  const body = {
    id: contextReceiptId(input.ids.create("contextReceipt")),
    projectId: input.projectId,
    workflowId: STORY_KNOWLEDGE_CREATE_DRAFT_WORKFLOW_ID,
    workflowVersion: "1",
    layers: Object.freeze([
      Object.freeze({
        kind: "workflow-contract" as const,
        version: "1",
        contentHash: layerContentHash
      })
    ] satisfies readonly InstructionLayerMetadata[]),
    resources: Object.freeze([]),
    excludedContextClasses: CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
    provider,
    model,
    maxOutputTokens: 0,
    wallClockSeconds: 0,
    toolCount: 0 as const,
    egressClass: agentEgressClassForProvider(provider),
    outputSchemaId,
    primaryTarget: input.target,
    createdAt: input.now
  };
  return Object.freeze({
    ...body,
    receiptHash: instructionContentHash(
      await input.hashPort.digestSha256Hex(canonicalJsonStringify(body))
    )
  });
}

export function createStoryKnowledgeCreateServices(
  dependencies: StoryKnowledgeCreateDraftServiceDependencies
): StoryKnowledgeCreateDraftServices {
  return Object.freeze({
    async createStoryKnowledgeDraft(input) {
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
          throw new DomainValidationError("UNKNOWN_REFERENCE", "Project not found.");
        }
        throw error;
      }
      const project = await dependencies.projects.getProject(input.projectId);
      if (project === undefined) {
        throw new DomainValidationError("UNKNOWN_REFERENCE", "Project not found.");
      }
      if (project.archivedAt !== undefined) {
        throw new DomainValidationError(
          "INVALID_AGENT_POLICY",
          "Archived projects cannot create story-knowledge drafts."
        );
      }
      const normalizedSceneId =
        input.sceneId === undefined ? undefined : sceneId(input.sceneId);
      if (normalizedSceneId !== undefined) {
        const scenes = await dependencies.projects.listScenes(input.projectId);
        if (
          !scenes.some(
            (entry) => entry.id === normalizedSceneId && entry.archivedAt === undefined
          )
        ) {
          throw new DomainValidationError("UNKNOWN_REFERENCE", "Scene not found.");
        }
      }
      const target = resolvePrimaryTarget({
        projectId: input.projectId,
        sceneId: normalizedSceneId
      });
      const model = input.model ?? CAPTURE_REFLECTION_DEFAULT_MODEL;
      const now = dependencies.clock.now();
      const receipt = await buildReceipt({
        projectId: input.projectId,
        target,
        model,
        now,
        ids: dependencies.ids,
        hashPort: dependencies.hashPort
      });
      try {
        await dependencies.foundation.persistPreview({
          accountId: input.accountId,
          receipt
        });
      } catch (error) {
        if (error instanceof AgentReceiptConflictError) throw error;
        throw error;
      }
      const runId = agentRunId(dependencies.ids.create("agentRun"));
      const queued = createQueuedAgentRun({
        id: runId,
        projectId: input.projectId,
        initiatorAccountId: input.accountId,
        workflowId: STORY_KNOWLEDGE_CREATE_DRAFT_WORKFLOW_ID,
        workflowVersion: "1",
        provider: receipt.provider,
        model,
        receiptId: receipt.id,
        receiptHash: receipt.receiptHash,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      const created = await dependencies.runs.create(queued);
      if (!created.ok) throw new AgentRunStateConflictError();
      const running = createAgentRun({ ...queued, status: "running", updatedAt: now });
      const transitioned = await dependencies.runs.transition({
        runId,
        expectedStatus: "queued",
        next: running
      });
      if (!transitioned.ok) throw new AgentRunStateConflictError();

      const payload = buildStoryKnowledgeCreateDraftPayload({
        name: input.name,
        kind: input.kind,
        summary: input.summary,
        ...(input.properties === undefined ? {} : { properties: input.properties }),
        ...(normalizedSceneId === undefined ? {} : { sceneId: normalizedSceneId }),
        ...(input.firstAppearanceNote === undefined
          ? {}
          : { firstAppearanceNote: input.firstAppearanceNote })
      });
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId: "story-knowledge-create-v1",
          payload,
          primaryTarget: target
        },
        dependencies.hashPort
      );
      const completedAt = dependencies.clock.now();
      const proposal = createReadyAgentProposal({
        id: agentProposalId(dependencies.ids.create("agentProposal")),
        projectId: input.projectId,
        runId,
        receiptId: receipt.id,
        status: "ready",
        outputSchemaId: "story-knowledge-create-v1",
        payload,
        contentHash,
        primaryTarget: target,
        createdAt: completedAt,
        updatedAt: completedAt
      });
      const readyRun = createAgentRun({
        ...running,
        status: "ready",
        completedAt,
        updatedAt: completedAt
      });
      await dependencies.completion.completeReflection({
        run: readyRun,
        proposal
      });
      return Object.freeze({ proposal });
    }
  });
}
