import {
  CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
  type AgentModelId,
  type ContextReceipt
} from "./agent-context-receipt.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  CATALOG_AGENT_MEMO_WORKFLOW_ID,
  instructionContentHash,
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
  type AgentProposalPayload,
  type AgentProposalPrimaryTarget
} from "./agent-runs-proposals.js";
import type { CatalogAgentId } from "./catalog-agent-ids.js";
import {
  catalogAgentDefaultLens,
  catalogAgentPlaybook,
  type CatalogAgentPlaybook
} from "./catalog-agent-playbooks.js";
import {
  mergeCatalogPlaybook,
  type CatalogPlaybookOverrideServices
} from "./catalog-playbook-overrides.js";
import { compileCatalogAgentInstructions } from "./catalog-instruction-compiler.js";
import {
  CATALOG_MEMO_LENSES,
  CATALOG_MEMO_V1_JSON_SCHEMA,
  validateCatalogMemoV1,
  type CatalogMemoLens,
  type CatalogMemoV1
} from "./catalog-memo-v1.js";
import {
  buildDeterministicPacingFindings
} from "./pacing-findings-builder.js";
import {
  PACING_FINDINGS_V1_JSON_SCHEMA,
  validatePacingFindingsV1
} from "./pacing-findings-v1.js";
import {
  equalWeightScenePercents,
  manuscriptOrderedScenes
} from "./pacing-position.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  DomainValidationError,
  type ProjectId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import {
  assertAgentModelId,
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  agentEgressClassForProvider,
  providerForAgentModel
} from "./model-catalog.js";
import type { AgentGuidanceServices } from "./agent-guidance-services.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import { projectNavigatorFromRecords } from "./project-navigator.js";

export type CatalogAgentEffort = "fast" | "standard" | "high";
export type CatalogSceneReference = Readonly<{ id: string; title: string }>;

const SCENE_AGENT_IDS = new Set<CatalogAgentId>([
  "scene-sequel-coach",
  "dialogue-coach"
]);

export class CatalogAgentTargetRequiredError extends Error {
  readonly code = "CATALOG_TARGET_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "CatalogAgentTargetRequiredError";
  }
}

export function resolveCatalogAgentPrimaryTarget(input: Readonly<{
  agentId: CatalogAgentId;
  projectId: ProjectId;
  sceneId?: string;
  storyKnowledgeId?: string;
}>): AgentProposalPrimaryTarget {
  if (SCENE_AGENT_IDS.has(input.agentId)) {
    if (input.sceneId === undefined) {
      throw new CatalogAgentTargetRequiredError(
        "Choose a scene before running this writing coach."
      );
    }
    return Object.freeze({ kind: "scene", id: input.sceneId });
  }
  if (input.agentId === "character-coach-cast") {
    if (input.storyKnowledgeId === undefined) {
      throw new CatalogAgentTargetRequiredError(
        "Choose a cast member before running Character Coach · Cast."
      );
    }
    return Object.freeze({
      kind: "story-knowledge",
      id: input.storyKnowledgeId
    });
  }
  return Object.freeze({ kind: "project", id: input.projectId });
}

function normalizeSceneReferences(
  sceneTitles: readonly (string | CatalogSceneReference)[]
): readonly CatalogSceneReference[] {
  return Object.freeze(
    sceneTitles.slice(0, 20).map((scene, index) =>
      typeof scene === "string"
        ? Object.freeze({ id: "", title: scene.trim() || `Scene ${index + 1}` })
        : Object.freeze({ id: scene.id.trim(), title: scene.title.trim() })
    )
  );
}


export function buildDeterministicCatalogMemo(input: Readonly<{
  agentId: CatalogAgentId;
  projectTitle: string;
  lens?: CatalogMemoLens;
  sceneTitles: readonly (string | CatalogSceneReference)[];
  playbook?: CatalogAgentPlaybook;
}>): CatalogMemoV1 {
  const playbook = input.playbook ?? catalogAgentPlaybook(input.agentId);
  const label = playbook.label;
  const scenes = normalizeSceneReferences(input.sceneTitles).filter(
    (scene) => scene.title.length > 0
  );
  const lens = input.lens ?? catalogAgentDefaultLens(input.agentId);
  const evidence =
    input.agentId === "continuity-reader"
      ? scenes
          .filter((scene) => scene.id.length > 0)
          .map((scene) => ({
            label: `Review anchor: ${scene.title}`,
            sceneId: scene.id
          }))
      : scenes.map((scene) => ({
          label: `Project scene: ${scene.title}`,
          ...(scene.id.length === 0 ? {} : { sceneId: scene.id })
        }));
  const anchorLine =
    scenes.length === 0
      ? "No scene material is available yet, so this memo reads as a craft checklist rather than a read of the draft."
      : `Visible story anchors: ${scenes.map((scene) => scene.title).join("; ")}.`;
  const sections = playbook.sections.map((section, index) => ({
    heading: section.heading,
    body: index === 0 ? `${anchorLine}\n\n${section.note}` : section.note
  }));
  const grounding =
    scenes.length === 0
      ? `${label} has no story material to read yet for ${input.projectTitle}.`
      : `${label} looked at ${input.projectTitle} across ${scenes.length} current scene${scenes.length === 1 ? "" : "s"}.`;
  return validateCatalogMemoV1({
    schemaId: "catalog-memo-v1",
    agentId: input.agentId,
    title: `${label} · ${input.projectTitle}`.slice(0, 120),
    summary: `${grounding} No model result was available, so each section below carries the ${playbook.stage} craft standard this agent works from — apply it against the draft and keep what earns its place.`,
    ...(lens === undefined ? {} : { lens }),
    sections,
    evidence
  });
}

export type CatalogMemoStructuredCompletionProvider = Readonly<{
  completeStructured(input: Readonly<{
    workflow: string;
    model: string;
    instructions: string;
    inputText: string;
    outputSchema: Readonly<{ name: string; schema: Record<string, unknown> }>;
    maxOutputTokens: number;
    maxDurationMs: number;
    validateOutput(value: unknown): boolean;
  }>): Promise<
    | Readonly<{
        ok: true;
        output: unknown;
        providerResponseId?: string;
        usage?: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
      }>
    | Readonly<{ ok: false; diagnostic: Readonly<{ code: string }> }>
  >;
}>;

export type CatalogAgentServices = Readonly<{
  runCatalogAgent(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    agentId: CatalogAgentId;
    lens?: CatalogMemoLens;
    model?: AgentModelId;
    effort?: CatalogAgentEffort;
    sceneId?: string;
    storyKnowledgeId?: string;
    /** Writer-authored project guidance, compiled as an untrusted layer. */
    projectInstructionsBody?: string;
    provider?: CatalogMemoStructuredCompletionProvider;
  }>): Promise<AgentProposal>;
}>;

export type CatalogAgentServiceDependencies = Readonly<{
  projects: ProjectRepository;
  receipts: ContextReceiptRepository;
  runs: AgentRunRepository;
  completion: AgentRunReflectionCompletionUnitOfWork;
  foundation: Pick<AgentFoundationServices, "persistPreview">;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
  /** When set, project agent-instructions load into the untrusted compiler layer. */
  guidance?: Pick<AgentGuidanceServices, "getProjectAgentInstructions">;
  playbookOverrides?: Pick<CatalogPlaybookOverrideServices, "get">;
}>;

const EFFORT_LIMITS = Object.freeze({
  fast: Object.freeze({ maxOutputTokens: 1_200, maxDurationMs: 30_000 }),
  standard: Object.freeze({ maxOutputTokens: 2_400, maxDurationMs: 45_000 }),
  high: Object.freeze({ maxOutputTokens: 4_000, maxDurationMs: 60_000 })
});

async function buildReceipt(input: Readonly<{
  projectId: ProjectId;
  target: AgentProposalPrimaryTarget;
  model: AgentModelId;
  outputSchemaId: AgentOutputSchemaId;
  layers: readonly InstructionLayerMetadata[];
  now: string;
  ids: IdGenerator;
  hashPort: AsyncHashPort;
}>): Promise<ContextReceipt> {
  const model = assertAgentModelId(input.model);
  const provider = providerForAgentModel(model);
  const body = {
    id: contextReceiptId(input.ids.create("contextReceipt")),
    projectId: input.projectId,
    workflowId: CATALOG_AGENT_MEMO_WORKFLOW_ID,
    workflowVersion: "1",
    layers: input.layers,
    resources: Object.freeze([]),
    excludedContextClasses: CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
    provider,
    model,
    maxOutputTokens: 4_000,
    wallClockSeconds: 60,
    toolCount: 0 as const,
    egressClass: agentEgressClassForProvider(provider),
    outputSchemaId: input.outputSchemaId,
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

export function createCatalogAgentServices(
  dependencies: CatalogAgentServiceDependencies
): CatalogAgentServices {
  return Object.freeze({
    async runCatalogAgent(input) {
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
          "Archived projects cannot run catalog agents."
        );
      }
      const target = resolveCatalogAgentPrimaryTarget(input);
      const [books, scenes, knowledge, editions] = await Promise.all([
        dependencies.projects.listBooks(input.projectId),
        dependencies.projects.listScenes(input.projectId),
        dependencies.projects.listStoryKnowledge(input.projectId),
        dependencies.projects.listEditions(input.projectId)
      ]);
      if (
        target.kind === "scene" &&
        !scenes.some((scene) => scene.id === target.id && scene.archivedAt === undefined)
      ) {
        throw new DomainValidationError("UNKNOWN_REFERENCE", "Scene not found.");
      }
      if (
        target.kind === "story-knowledge" &&
        !knowledge.some((entry) => entry.id === target.id && entry.archivedAt === undefined)
      ) {
        throw new DomainValidationError("UNKNOWN_REFERENCE", "Cast member not found.");
      }
      if (input.lens !== undefined && !CATALOG_MEMO_LENSES.includes(input.lens)) {
        throw new DomainValidationError("INVALID_AGENT_POLICY", "Catalog lens is invalid.");
      }
      const model = input.model ?? CAPTURE_REFLECTION_DEFAULT_MODEL;
      const now = dependencies.clock.now();
      const sceneReferences = scenes
        .filter((scene) => scene.archivedAt === undefined)
        .map((scene) => ({ id: scene.id, title: scene.title }));
      const orderedPercents = equalWeightScenePercents(
        manuscriptOrderedScenes(
          projectNavigatorFromRecords({
            project,
            books,
            scenes,
            storyKnowledge: knowledge,
            editions
          })
        ).filter((scene) => scene.archivedAt === undefined)
      );
      const isPacingDoctor = input.agentId === "pacing-doctor";
      const outputSchemaId: AgentOutputSchemaId = isPacingDoctor
        ? "pacing-findings-v1"
        : "catalog-memo-v1";
      const compilerScenes = isPacingDoctor
        ? orderedPercents.map((scene) => ({
            id: scene.sceneId,
            title: scene.title,
            index: scene.index,
            startPct: scene.startPct,
            midPct: scene.midPct,
            endPct: scene.endPct
          }))
        : sceneReferences;
      let projectInstructionsBody = input.projectInstructionsBody;
      if (
        projectInstructionsBody === undefined &&
        dependencies.guidance !== undefined
      ) {
        const projectInstructions =
          await dependencies.guidance.getProjectAgentInstructions({
            accountId: input.accountId,
            projectId: input.projectId
          });
        if (
          projectInstructions !== undefined &&
          projectInstructions.body.trim().length > 0
        ) {
          projectInstructionsBody = projectInstructions.body;
        }
      }
      const playbookOverride = await dependencies.playbookOverrides?.get({
        accountId: input.accountId,
        projectId: input.projectId,
        agentId: input.agentId
      });
      const playbook = mergeCatalogPlaybook(
        catalogAgentPlaybook(input.agentId),
        playbookOverride
      );
      const compiled = await compileCatalogAgentInstructions({
        agentId: input.agentId,
        ...(input.lens === undefined ? {} : { lens: input.lens }),
        projectTitle: project.title,
        target,
        scenes: compilerScenes,
        ...(projectInstructionsBody === undefined
          ? {}
          : { projectInstructionsBody }),
        ...(playbookOverride === undefined ? {} : { playbookOverride }),
        hashPort: dependencies.hashPort
      });
      const receiptLayers = compiled.layers.flatMap((layer) =>
        layer.contentHash === undefined
          ? []
          : [
              Object.freeze({
                kind: layer.kind,
                version: layer.version,
                contentHash: layer.contentHash
              })
            ]
      );
      const receipt = await buildReceipt({
        projectId: input.projectId,
        target,
        model,
        outputSchemaId,
        layers: Object.freeze(receiptLayers),
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
        workflowId: CATALOG_AGENT_MEMO_WORKFLOW_ID,
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

      const deterministic: AgentProposalPayload = isPacingDoctor
        ? buildDeterministicPacingFindings({
            projectTitle: project.title,
            ...(input.lens === undefined ? {} : { lens: input.lens }),
            orderedPercents,
            playbook
          })
        : buildDeterministicCatalogMemo({
            agentId: input.agentId,
            projectTitle: project.title,
            ...(input.lens === undefined ? {} : { lens: input.lens }),
            sceneTitles: sceneReferences,
            playbook
          });
      let payload: AgentProposalPayload = deterministic;
      let providerResponseId: string | undefined;
      let tokenUsage:
        | Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>
        | undefined;
      if (input.provider !== undefined) {
        const limits = EFFORT_LIMITS[input.effort ?? "standard"];
        try {
          const result = await input.provider.completeStructured({
            workflow: CATALOG_AGENT_MEMO_WORKFLOW_ID,
            model,
            instructions: compiled.systemInstructionText,
            inputText: compiled.inputText,
            outputSchema: isPacingDoctor
              ? {
                  name: "pacing-findings-v1",
                  schema: PACING_FINDINGS_V1_JSON_SCHEMA as Record<
                    string,
                    unknown
                  >
                }
              : {
                  name: "catalog-memo-v1",
                  schema: CATALOG_MEMO_V1_JSON_SCHEMA as Record<string, unknown>
                },
            maxOutputTokens: limits.maxOutputTokens,
            maxDurationMs: limits.maxDurationMs,
            validateOutput: (value) => {
              try {
                if (isPacingDoctor) validatePacingFindingsV1(value);
                else validateCatalogMemoV1(value);
                return true;
              } catch {
                return false;
              }
            }
          });
          if (result.ok) {
            payload = isPacingDoctor
              ? validatePacingFindingsV1(result.output)
              : validateCatalogMemoV1(result.output);
            if (payload.agentId !== input.agentId) payload = deterministic;
            providerResponseId = result.providerResponseId;
            tokenUsage = result.usage;
          }
        } catch {
          payload = deterministic;
        }
      }
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId,
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
        outputSchemaId,
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
        updatedAt: completedAt,
        ...(providerResponseId === undefined ? {} : { providerResponseId }),
        ...(tokenUsage === undefined ? {} : { tokenUsage })
      });
      await dependencies.completion.completeReflection({
        run: readyRun,
        proposal
      });
      return proposal;
    }
  });
}
