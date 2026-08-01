import {
  DomainValidationError,
  type CaptureId,
  type PlaybookId,
  type ProjectId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";

type BrandedString<Name extends string> = string & { readonly __brand: Name };

export type InstructionContentHash = BrandedString<"InstructionContentHash">;

export type AiCollaborationPosture =
  | "options"
  | "questions-first"
  | "craft-explanations"
  | "minimal";

export type AccountAiCollaborationProfile = Readonly<{
  version: number;
  setupSkipped: boolean;
  posture?: AiCollaborationPosture;
  boundaries?: string;
  updatedAt: string;
}>;

export type ProjectAgentInstructions = Readonly<{
  projectId: ProjectId;
  version: number;
  body: string;
  contentHash: InstructionContentHash;
  createdAt: string;
  updatedAt: string;
}>;

export const PLAYBOOK_TRIGGERS = Object.freeze([
  "capture-reflection",
  "manual"
] as const);

export type PlaybookTrigger = (typeof PLAYBOOK_TRIGGERS)[number];

export const AGENT_CONTEXT_CLASSES = Object.freeze(["capture"] as const);

export type AgentContextClass = (typeof AGENT_CONTEXT_CLASSES)[number];

export const AGENT_OUTPUT_SCHEMA_IDS = Object.freeze([
  "capture-reflection-v1",
  "plan-outline-v1",
  "sketch-fields-v1",
  "character-sheet-v1",
  "backdrop-fields-v1"
] as const);

export type AgentOutputSchemaId = (typeof AGENT_OUTPUT_SCHEMA_IDS)[number];

export type ProjectPlaybook = Readonly<{
  projectId: ProjectId;
  id: PlaybookId;
  version: number;
  name: string;
  enabled: boolean;
  trigger: PlaybookTrigger;
  allowedContextClasses: readonly AgentContextClass[];
  outputSchemaId: AgentOutputSchemaId;
  guidance: string;
  guidanceHash: InstructionContentHash;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}>;

export const CAPTURE_REFLECTION_WORKFLOW_ID = "scene-partner.capture-reflection" as const;
export const SKETCH_PARTNER_WORKFLOW_ID = "sketch-partner.craft-fields" as const;
export const CHARACTER_COACH_WORKFLOW_ID = "character-coach.sheet-fields" as const;
export const WORLDKEEPER_WORKFLOW_ID = "worldkeeper.backdrop-fields" as const;
export const PLAN_MODE_OUTLINE_WORKFLOW_ID = "plan-mode.outline" as const;

export type CaptureReflectionWorkflowId = typeof CAPTURE_REFLECTION_WORKFLOW_ID;
export type PlanModeOutlineWorkflowId = typeof PLAN_MODE_OUTLINE_WORKFLOW_ID;
export type SketchPartnerWorkflowId = typeof SKETCH_PARTNER_WORKFLOW_ID;
export type CharacterCoachWorkflowId = typeof CHARACTER_COACH_WORKFLOW_ID;
export type WorldkeeperWorkflowId = typeof WORLDKEEPER_WORKFLOW_ID;

export const AGENT_WORKFLOW_IDS = Object.freeze([
  CAPTURE_REFLECTION_WORKFLOW_ID,
  PLAN_MODE_OUTLINE_WORKFLOW_ID,
  SKETCH_PARTNER_WORKFLOW_ID,
  CHARACTER_COACH_WORKFLOW_ID,
  WORLDKEEPER_WORKFLOW_ID
] as const);

export type AgentWorkflowId = (typeof AGENT_WORKFLOW_IDS)[number];

export type CaptureReflectionAssignment = Readonly<{
  workflowId: CaptureReflectionWorkflowId;
  captureId: CaptureId;
  focusNote?: string;
}>;

export type CraftPartnerWorkflowId =
  | SketchPartnerWorkflowId
  | CharacterCoachWorkflowId
  | WorldkeeperWorkflowId;

export type CraftPartnerAssignment = Readonly<{
  workflowId: CraftPartnerWorkflowId;
  captureId: CaptureId;
  sceneId?: SceneId;
  storyKnowledgeId?: StoryKnowledgeId;
  focusNote?: string;
}>;

export class CraftTargetRequiredError extends Error {
  readonly code = "CRAFT_TARGET_REQUIRED" as const;
  readonly targetKind: "scene" | "character";

  constructor(targetKind: "scene" | "character", message: string) {
    super(message);
    this.name = "CraftTargetRequiredError";
    this.targetKind = targetKind;
  }
}

export type InstructionLayerKind =
  | "product-policy"
  | "workflow-contract"
  | "account-preferences"
  | "project-instructions"
  | "playbook"
  | "assignment";

export type InstructionLayerMetadata = Readonly<{
  kind: InstructionLayerKind;
  version: string;
  contentHash: InstructionContentHash;
}>;

export type AsyncHashPort = Readonly<{
  digestSha256Hex(canonicalUtf8: string): Promise<string>;
}>;

const AI_POSTURES = new Set<AiCollaborationPosture>([
  "options",
  "questions-first",
  "craft-explanations",
  "minimal"
]);

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }
  return normalized;
}

function optionalBoundedText(
  value: string | undefined,
  field: string,
  max: number
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > max) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `${field} must be at most ${max} characters.`
    );
  }
  return normalized;
}

function requireBoundedText(value: string, field: string, max: number): string {
  const normalized = requireText(value, field);
  if (normalized.length > max) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `${field} must be at most ${max} characters.`
    );
  }
  return normalized;
}

function requirePositiveVersion(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${field} must be a positive integer.`
    );
  }
  return value;
}

export function instructionContentHash(value: string): InstructionContentHash {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Instruction content hash must be a SHA-256 digest."
    );
  }
  return normalized as InstructionContentHash;
}

export function createAccountAiCollaborationProfile(
  input: AccountAiCollaborationProfile
): AccountAiCollaborationProfile {
  if (input.setupSkipped) {
    if (input.posture !== undefined || input.boundaries !== undefined) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        "Skipped collaboration setup cannot include posture or boundaries."
      );
    }
    return Object.freeze({
      version: requirePositiveVersion(input.version, "Collaboration profile version"),
      setupSkipped: true,
      updatedAt: requireText(input.updatedAt, "Collaboration profile update time")
    });
  }
  if (input.posture === undefined || !AI_POSTURES.has(input.posture)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Account collaboration posture is not recognized."
    );
  }
  const boundaries = optionalBoundedText(input.boundaries, "Collaboration boundaries", 2_000);
  return Object.freeze({
    version: requirePositiveVersion(input.version, "Collaboration profile version"),
    setupSkipped: false,
    posture: input.posture,
    updatedAt: requireText(input.updatedAt, "Collaboration profile update time"),
    ...(boundaries === undefined ? {} : { boundaries })
  });
}

export function createProjectAgentInstructions(
  input: ProjectAgentInstructions
): ProjectAgentInstructions {
  return Object.freeze({
    projectId: input.projectId,
    version: requirePositiveVersion(input.version, "Project instructions version"),
    body: requireBoundedText(input.body, "Project instructions body", 8_000),
    contentHash: instructionContentHash(String(input.contentHash)),
    createdAt: requireText(input.createdAt, "Project instructions creation time"),
    updatedAt: requireText(input.updatedAt, "Project instructions update time")
  });
}

function assertUniqueContextClasses(
  values: readonly AgentContextClass[],
  label: string
): readonly AgentContextClass[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!AGENT_CONTEXT_CLASSES.includes(value)) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        `${label} includes an unsupported context class.`
      );
    }
    if (seen.has(value)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `${label} contains duplicate context classes.`
      );
    }
    seen.add(value);
  }
  if (values.length === 0) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      `${label} must include at least one allowed context class.`
    );
  }
  return Object.freeze([...values]);
}

export function createProjectPlaybook(input: ProjectPlaybook): ProjectPlaybook {
  if (!PLAYBOOK_TRIGGERS.includes(input.trigger)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Playbook trigger is not recognized."
    );
  }
  if (!AGENT_OUTPUT_SCHEMA_IDS.includes(input.outputSchemaId)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Playbook output schema is not recognized."
    );
  }
  return Object.freeze({
    projectId: input.projectId,
    id: input.id,
    version: requirePositiveVersion(input.version, "Playbook version"),
    name: requireBoundedText(input.name, "Playbook name", 120),
    enabled: input.enabled,
    trigger: input.trigger,
    allowedContextClasses: assertUniqueContextClasses(
      input.allowedContextClasses,
      "Playbook allowed context classes"
    ),
    outputSchemaId: input.outputSchemaId,
    guidance: requireBoundedText(input.guidance, "Playbook guidance", 4_000),
    guidanceHash: instructionContentHash(String(input.guidanceHash)),
    createdAt: requireText(input.createdAt, "Playbook creation time"),
    updatedAt: requireText(input.updatedAt, "Playbook update time"),
    ...(input.archivedAt === undefined
      ? {}
      : { archivedAt: requireText(input.archivedAt, "Playbook archive time") })
  });
}

export function createCaptureReflectionAssignment(
  input: CaptureReflectionAssignment
): CaptureReflectionAssignment {
  if (input.workflowId !== CAPTURE_REFLECTION_WORKFLOW_ID) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Assignment workflow does not match capture reflection."
    );
  }
  const focusNote = optionalBoundedText(input.focusNote, "Assignment focus note", 500);
  return Object.freeze({
    workflowId: input.workflowId,
    captureId: input.captureId,
    ...(focusNote === undefined ? {} : { focusNote })
  });
}

export type PlanModeOutlineAssignment = Readonly<{
  workflowId: PlanModeOutlineWorkflowId;
  captureId: CaptureId;
}>;

export function createPlanModeOutlineAssignment(
  input: PlanModeOutlineAssignment
): PlanModeOutlineAssignment {
  if (input.workflowId !== PLAN_MODE_OUTLINE_WORKFLOW_ID) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Assignment workflow does not match plan-mode outline."
    );
  }
  return Object.freeze({
    workflowId: input.workflowId,
    captureId: input.captureId
  });
}

export function createCraftPartnerAssignment(
  input: CraftPartnerAssignment
): CraftPartnerAssignment {
  if (
    input.workflowId !== SKETCH_PARTNER_WORKFLOW_ID &&
    input.workflowId !== CHARACTER_COACH_WORKFLOW_ID &&
    input.workflowId !== WORLDKEEPER_WORKFLOW_ID
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Assignment workflow does not match a craft partner."
    );
  }
  const focusNote = optionalBoundedText(input.focusNote, "Assignment focus note", 500);
  if (
    input.workflowId === CHARACTER_COACH_WORKFLOW_ID &&
    input.storyKnowledgeId === undefined
  ) {
    throw new CraftTargetRequiredError(
      "character",
      "Choose a cast member before Character Coach can propose sheet updates."
    );
  }
  if (
    (input.workflowId === SKETCH_PARTNER_WORKFLOW_ID ||
      input.workflowId === WORLDKEEPER_WORKFLOW_ID) &&
    input.sceneId === undefined
  ) {
    throw new CraftTargetRequiredError(
      "scene",
      "Choose a scene before this craft partner can propose typed deltas."
    );
  }
  return Object.freeze({
    workflowId: input.workflowId,
    captureId: input.captureId,
    ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
    ...(input.storyKnowledgeId === undefined
      ? {}
      : { storyKnowledgeId: input.storyKnowledgeId }),
    ...(focusNote === undefined ? {} : { focusNote })
  });
}

export function craftPartnerOutputSchemaId(
  workflowId: CraftPartnerWorkflowId
): Exclude<AgentOutputSchemaId, "capture-reflection-v1" | "plan-outline-v1"> {
  switch (workflowId) {
    case SKETCH_PARTNER_WORKFLOW_ID:
      return "sketch-fields-v1";
    case CHARACTER_COACH_WORKFLOW_ID:
      return "character-sheet-v1";
    case WORLDKEEPER_WORKFLOW_ID:
      return "backdrop-fields-v1";
    default: {
      const _exhaustive: never = workflowId;
      return _exhaustive;
    }
  }
}

export function assertPlaybookMatchesCaptureReflection(
  playbook: ProjectPlaybook,
  projectId: ProjectId
): void {
  if (playbook.projectId !== projectId) {
    throw new DomainValidationError(
      "CROSS_PROJECT_REFERENCE",
      "Playbook belongs to a different project."
    );
  }
  if (!playbook.enabled) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Playbook is disabled."
    );
  }
  if (playbook.trigger !== "capture-reflection" && playbook.trigger !== "manual") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Playbook trigger cannot run capture reflection."
    );
  }
  if (playbook.outputSchemaId !== "capture-reflection-v1") {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Playbook output schema does not match capture reflection."
    );
  }
  if (!playbook.allowedContextClasses.includes("capture")) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Playbook must allow Capture context."
    );
  }
}

export function assertProjectAgentInstructionsScope(
  instructions: ProjectAgentInstructions,
  projectId: ProjectId
): void {
  if (instructions.projectId !== projectId) {
    throw new DomainValidationError(
      "CROSS_PROJECT_REFERENCE",
      "Project instructions belong to a different project."
    );
  }
}
