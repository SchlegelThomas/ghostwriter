import {
  CAPTURE_REFLECTION_EXCLUDED_CONTEXT_CLASSES,
  type AgentModelId,
  type ContextReceipt
} from "./agent-context-receipt.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  instructionContentHash,
  NEXT_ACTION_COACH_WORKFLOW_ID,
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
import { sceneDocumentPlainText } from "./book-reader.js";
import {
  agentProposalId,
  agentRunId,
  contextReceiptId,
  DomainValidationError,
  type ProjectId,
  type SceneId,
  type StoryKnowledge
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import {
  assertAgentModelId,
  agentEgressClassForProvider,
  NEXT_ACTION_COACH_DEFAULT_MODEL,
  providerForAgentModel
} from "./model-catalog.js";
import {
  NEXT_ACTION_V1_JSON_SCHEMA,
  validateNextActionV1,
  type NextActionTrigger,
  type NextActionV1
} from "./next-action-v1.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import type { SceneDocumentRepository } from "./scene-document-repository.js";
import type { CatalogMemoStructuredCompletionProvider } from "./catalog-agent-services.js";

export const NEXT_ACTION_COACH_MAX_PROSE_CHARS = 7_000;

export type NextActionCoachRosterEntry = Readonly<{
  id: string;
  label: string;
  kind: StoryKnowledge["kind"];
  aliases: readonly string[];
}>;

export type NextActionCoachStructuredCompletionProvider =
  CatalogMemoStructuredCompletionProvider;

export type NextActionCoachRunResult = Readonly<{
  proposal: AgentProposal;
  payload: NextActionV1;
}>;

export type NextActionCoachServices = Readonly<{
  runNextActionCoach(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    trigger: NextActionTrigger;
    model?: AgentModelId;
    provider?: NextActionCoachStructuredCompletionProvider;
  }>): Promise<NextActionCoachRunResult>;
}>;

export type NextActionCoachServiceDependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  receipts: ContextReceiptRepository;
  runs: AgentRunRepository;
  completion: AgentRunReflectionCompletionUnitOfWork;
  foundation: Pick<AgentFoundationServices, "persistPreview">;
  hashPort: AsyncHashPort;
  ids: IdGenerator;
  clock: Clock;
}>;

const EFFORT_LIMITS = Object.freeze({
  maxOutputTokens: 1_200,
  maxDurationMs: 30_000
});

const NEXT_ACTION_COACH_SYSTEM_INSTRUCTION = Object.freeze(
  [
    "You are Ghostwriter's ambient next-action coach.",
    "Read the scene prose and cast roster, then suggest 2–4 concrete next steps.",
    "Ground every suggestion in the supplied prose or known cast — never invent plot facts.",
    "Prefer create-story-knowledge when a name appears in prose but not the roster.",
    "Prefer run-catalog-agent with catalogAgentId dialogue-coach when dialogue beats need polish.",
    "Include continue-writing when the scene has momentum worth extending.",
    "Set schemaId to next-action-v1 and copy the trigger from the assignment.",
    "Keep titles short and rationales specific to this scene."
  ].join("\n")
);

function sliceSceneProse(prose: string): Readonly<{ text: string; truncated: boolean }> {
  if (prose.length <= NEXT_ACTION_COACH_MAX_PROSE_CHARS) {
    return Object.freeze({ text: prose, truncated: false });
  }
  return Object.freeze({
    text: prose.slice(0, NEXT_ACTION_COACH_MAX_PROSE_CHARS),
    truncated: true
  });
}

function rosterFromKnowledge(
  knowledge: readonly StoryKnowledge[]
): readonly NextActionCoachRosterEntry[] {
  return Object.freeze(
    knowledge
      .filter((entry) => entry.archivedAt === undefined)
      .map((entry) =>
        Object.freeze({
          id: entry.id,
          label: entry.label,
          kind: entry.kind,
          aliases: entry.aliases ?? Object.freeze([])
        })
      )
  );
}

function rosterNames(roster: readonly NextActionCoachRosterEntry[]): readonly string[] {
  return Object.freeze(
    roster.flatMap((entry) => [entry.label, ...entry.aliases]).filter((name) => name.length > 0)
  );
}

function proseMentionsUnknownName(
  prose: string,
  roster: readonly NextActionCoachRosterEntry[]
): string | undefined {
  const known = new Set(
    rosterNames(roster).map((name) => name.toLowerCase())
  );
  const capitalized = prose.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) ?? [];
  for (const candidate of capitalized) {
    if (candidate.length < 3) continue;
    if (known.has(candidate.toLowerCase())) continue;
    if (/^(The|She|He|They|It|When|Then|But|And|For|With|From|Into|Over|After|Before)$/u.test(candidate)) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

export function buildNextActionCoachInputText(input: Readonly<{
  projectTitle: string;
  sceneId: SceneId;
  sceneTitle: string;
  trigger: NextActionTrigger;
  prose: string;
  proseTruncated: boolean;
  roster: readonly NextActionCoachRosterEntry[];
}>): string {
  const rosterLines =
    input.roster.length === 0
      ? "Cast roster: (empty)"
      : [
          "Cast roster:",
          ...input.roster.map(
            (entry) =>
              `- ${entry.label} (${entry.kind})${
                entry.aliases.length === 0 ? "" : `; aliases: ${entry.aliases.join(", ")}`
              }`
          )
        ].join("\n");
  const proseSection =
    input.prose.trim().length === 0
      ? "Scene prose: (none yet — suggest title-aware setup steps only.)"
      : [
          `Scene prose${input.proseTruncated ? " (truncated to recent text)" : ""}:`,
          input.prose.trim()
        ].join("\n");
  return [
    `Project: ${input.projectTitle}`,
    `Scene id: ${input.sceneId}`,
    `Scene title: ${input.sceneTitle}`,
    `Trigger: ${input.trigger}`,
    rosterLines,
    proseSection
  ].join("\n\n");
}

export function buildDeterministicNextActionV1(input: Readonly<{
  sceneId: SceneId;
  sceneTitle: string;
  trigger: NextActionTrigger;
  prose: string;
  roster: readonly NextActionCoachRosterEntry[];
}>): NextActionV1 {
  const hasProse = input.prose.trim().length > 0;
  const where =
    input.sceneTitle.trim().length > 0 ? input.sceneTitle.trim() : "this scene";
  const unknownName = hasProse
    ? proseMentionsUnknownName(input.prose, input.roster)
    : undefined;
  const suggestions = [];
  suggestions.push(
    Object.freeze({
      kind: "continue-writing" as const,
      title: hasProse ? "Keep drafting from here" : "Start drafting the scene",
      rationale: hasProse
        ? `${where} has fresh prose on the page — extend the turn you just landed.`
        : `${where} is still open — put the first beat on the page before polishing.`
    })
  );
  if (hasProse && input.prose.trim().length >= 80) {
    suggestions.push(
      Object.freeze({
        kind: "run-catalog-agent" as const,
        title: "Run Dialogue Coach",
        rationale: "The latest beats have spoken lines worth pressure-testing.",
        catalogAgentId: "dialogue-coach",
        sceneId: input.sceneId
      })
    );
  }
  if (unknownName !== undefined) {
    suggestions.push(
      Object.freeze({
        kind: "create-story-knowledge" as const,
        title: `Add ${unknownName} to Cast`,
        rationale: `${unknownName} appears in the prose but is not on the roster yet.`,
        proposedName: unknownName,
        storyKnowledgeKind: "character" as const,
        sceneId: input.sceneId
      })
    );
  } else if (input.roster.length === 0) {
    suggestions.push(
      Object.freeze({
        kind: "create-story-knowledge" as const,
        title: "Capture your first cast member",
        rationale: `${where} will read sharper once someone is on the roster.`,
        storyKnowledgeKind: "character" as const,
        sceneId: input.sceneId
      })
    );
  } else if (!hasProse) {
    suggestions.push(
      Object.freeze({
        kind: "open-surface" as const,
        title: "Review Cast before drafting",
        rationale: "Pick who belongs in this scene while the page is still light.",
        openSurface: "cast" as const
      })
    );
  }
  const summary = hasProse
    ? unknownName === undefined
      ? `Looked at ${where} and the current roster — here are grounded next moves.`
      : `${unknownName} shows up in ${where} but is not on the roster yet.`
    : `${where} has no prose yet — start with light setup moves tied to your cast.`;
  return validateNextActionV1({
    schemaId: "next-action-v1",
    trigger: input.trigger,
    summary,
    suggestions: suggestions.slice(0, 4),
    escalate: Object.freeze({
      recommended: false,
      reason: "Cheap coach coverage is sufficient for this pass."
    })
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
  const outputSchemaId: AgentOutputSchemaId = "next-action-v1";
  const workflowContract = "next-action-coach-v1";
  const layerContentHash = instructionContentHash(
    await input.hashPort.digestSha256Hex(workflowContract)
  );
  const body = {
    id: contextReceiptId(input.ids.create("contextReceipt")),
    projectId: input.projectId,
    workflowId: NEXT_ACTION_COACH_WORKFLOW_ID,
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
    maxOutputTokens: EFFORT_LIMITS.maxOutputTokens,
    wallClockSeconds: 30,
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

export function createNextActionCoachServices(
  dependencies: NextActionCoachServiceDependencies
): NextActionCoachServices {
  return Object.freeze({
    async runNextActionCoach(input) {
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
          "Archived projects cannot run the next-action coach."
        );
      }
      const scenes = await dependencies.projects.listScenes(input.projectId);
      const scene = scenes.find(
        (entry) => entry.id === input.sceneId && entry.archivedAt === undefined
      );
      if (scene === undefined) {
        throw new DomainValidationError("UNKNOWN_REFERENCE", "Scene not found.");
      }
      const knowledge = await dependencies.projects.listStoryKnowledge(input.projectId);
      const roster = rosterFromKnowledge(knowledge);
      const head = await dependencies.sceneDocuments.getHead(input.sceneId);
      const fullProse =
        head === undefined ? "" : sceneDocumentPlainText(head.document);
      const proseSlice = sliceSceneProse(fullProse);
      const target = Object.freeze({
        kind: "scene" as const,
        id: input.sceneId
      });
      const model = input.model ?? NEXT_ACTION_COACH_DEFAULT_MODEL;
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
        workflowId: NEXT_ACTION_COACH_WORKFLOW_ID,
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

      const deterministic = buildDeterministicNextActionV1({
        sceneId: input.sceneId,
        sceneTitle: scene.title,
        trigger: input.trigger,
        prose: proseSlice.text,
        roster
      });
      let payload: NextActionV1 = deterministic;
      let providerResponseId: string | undefined;
      let tokenUsage:
        | Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>
        | undefined;
      if (input.provider !== undefined) {
        const inputText = buildNextActionCoachInputText({
          projectTitle: project.title,
          sceneId: input.sceneId,
          sceneTitle: scene.title,
          trigger: input.trigger,
          prose: proseSlice.text,
          proseTruncated: proseSlice.truncated,
          roster
        });
        try {
          const result = await input.provider.completeStructured({
            workflow: NEXT_ACTION_COACH_WORKFLOW_ID,
            model,
            instructions: NEXT_ACTION_COACH_SYSTEM_INSTRUCTION,
            inputText,
            outputSchema: {
              name: "next-action-v1",
              schema: NEXT_ACTION_V1_JSON_SCHEMA as Record<string, unknown>
            },
            maxOutputTokens: EFFORT_LIMITS.maxOutputTokens,
            maxDurationMs: EFFORT_LIMITS.maxDurationMs,
            validateOutput: (value) => {
              try {
                const validated = validateNextActionV1(value);
                return validated.trigger === input.trigger;
              } catch {
                return false;
              }
            }
          });
          if (result.ok) {
            payload = validateNextActionV1(result.output);
            if (payload.trigger !== input.trigger) {
              payload = validateNextActionV1({
                ...payload,
                trigger: input.trigger
              });
            }
            providerResponseId = result.providerResponseId;
            tokenUsage = result.usage;
          }
        } catch {
          payload = deterministic;
        }
      }
      const contentHash = await computeAgentProposalContentHash(
        {
          outputSchemaId: "next-action-v1",
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
        outputSchemaId: "next-action-v1",
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
      return Object.freeze({ proposal, payload });
    }
  });
}
