import { instructionContentHash, type InstructionContentHash } from "./agent-domain.js";
import {
  createStoryAssessmentRevisionVector,
  type StoryAssessmentDependency,
  type StoryAssessmentRevisionVector
} from "./story-assessment-freshness.js";
import {
  DomainValidationError,
  agentProposalId,
  projectId,
  sceneId,
  type AgentProposalId,
  type ProjectId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import { chapterId, storyKnowledgeId } from "./domain.js";
import { sceneContentHash, type SceneContentHash } from "./scene-documents.js";
import type { StoryWorkAssignmentId } from "./story-work-assignment.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";

export const STORY_CHECK_SCHEMA_ID = "story-check-findings-v1" as const;
export const STORY_CHECK_CANDIDATES_SCHEMA_ID =
  "story-check-findings-candidates-v1" as const;

export const STORY_CHECK_SPECIALISTS = Object.freeze([
  "continuity",
  "character",
  "dialogue-completeness"
] as const);
export type StoryCheckSpecialist = (typeof STORY_CHECK_SPECIALISTS)[number];

export const STORY_CHECK_FINDING_KINDS = Object.freeze([
  "contradiction",
  "suggestion",
  "question"
] as const);
export type StoryCheckFindingKind = (typeof STORY_CHECK_FINDING_KINDS)[number];

export const STORY_CHECK_FINDING_SEVERITIES = Object.freeze([
  "blocking",
  "important",
  "advisory"
] as const);
export type StoryCheckFindingSeverity =
  (typeof STORY_CHECK_FINDING_SEVERITIES)[number];

export const STORY_CHECK_RESOLUTION_STATUSES = Object.freeze([
  "open",
  "dismissed",
  "deferred"
] as const);
export type StoryCheckResolutionStatus =
  (typeof STORY_CHECK_RESOLUTION_STATUSES)[number];

export const STORY_CHECK_MAX_FINDINGS = 40;
export const STORY_CHECK_MAX_ANCHORS_PER_FINDING = 8;
export const STORY_CHECK_MAX_CLAIM_CHARS = 2_000;
export const STORY_CHECK_MAX_NEXT_STEP_CHARS = 1_000;
export const STORY_CHECK_MAX_DEFER_REASON_CHARS = 500;
export const STORY_CHECK_MAX_FINDING_ID_CHARS = 128;
export const STORY_CHECK_MAX_LINKED_RECHECK_SCENES = 32;
export const STORY_CHECK_MAX_EXAMINED_SCENES = 32;
export const STORY_CHECK_MAX_SKIPPED_SCENES = 32;
export const STORY_CHECK_MAX_TRUNCATIONS = 48;
export const STORY_CHECK_MAX_SCOPE_SUMMARY_CHARS = 500;
export const STORY_CHECK_MAX_SKIP_REASON_CHARS = 500;
export const STORY_CHECK_MAX_QUOTE_CHARS = 2_000;
export const STORY_CHECK_MAX_RESOURCE_ID_CHARS = 200;

export type StoryCheckTargetAppliedScene = Readonly<{
  mode: "applied-scene";
  projectId: ProjectId;
  sceneId: SceneId;
  workingVersion: number;
  contentHash: SceneContentHash;
}>;

export type StoryCheckTargetProposalDraft = Readonly<{
  mode: "proposal-draft";
  projectId: ProjectId;
  sceneId: SceneId;
  assignmentId: StoryWorkAssignmentId;
  proposalId: AgentProposalId;
  artifactVersion: number;
  /** Exact AgentProposal / StoryWorkArtifactPointer contentHash for the bound artifact. */
  contentHash: InstructionContentHash;
}>;

export type StoryCheckTarget =
  | StoryCheckTargetAppliedScene
  | StoryCheckTargetProposalDraft;

export type StoryCheckEvidenceAnchor = Readonly<{
  sceneId: SceneId;
  quote?: string;
  blockId?: string;
  storyKnowledgeId?: StoryKnowledgeId;
}>;

export type StoryCheckFindingResolution = Readonly<
  | { status: "open" }
  | { status: "dismissed" }
  | { status: "deferred"; reason: string }
>;

export type StoryCheckFindingV1 = Readonly<{
  id: string;
  kind: StoryCheckFindingKind;
  severity: StoryCheckFindingSeverity;
  claim: string;
  nextStep?: string;
  anchors: readonly StoryCheckEvidenceAnchor[];
  resolution: StoryCheckFindingResolution;
}>;

export const STORY_CHECK_COVERAGE_RESOURCE_KINDS = Object.freeze([
  "scene-document",
  "story-knowledge",
  "story-context",
  "proposal-artifact"
] as const);

export type StoryCheckCoverageResourceKind =
  (typeof STORY_CHECK_COVERAGE_RESOURCE_KINDS)[number];

export type StoryCheckCoverageTruncation = Readonly<{
  resourceKind: StoryCheckCoverageResourceKind;
  resourceId: string;
  truncated: boolean;
  providerCharCount: number;
  fullCharCount: number;
}>;

export type StoryCheckExaminedScene = Readonly<{
  sceneId: SceneId;
  workingVersion: number;
  contentHash: SceneContentHash;
}>;

export type StoryCheckSkippedScene = Readonly<{
  sceneId: SceneId;
  reason: string;
}>;

export type StoryCheckCoverageV1 = Readonly<{
  requestedScopeSummary: string;
  examined: readonly StoryCheckExaminedScene[];
  skipped: readonly StoryCheckSkippedScene[];
  truncations: readonly StoryCheckCoverageTruncation[];
  completeForRequestedScope: boolean;
}>;

export type StoryCheckFindingsV1 = Readonly<{
  schemaId: typeof STORY_CHECK_SCHEMA_ID;
  specialist: StoryCheckSpecialist;
  target: StoryCheckTarget;
  findings: readonly StoryCheckFindingV1[];
  coverage: StoryCheckCoverageV1;
  revisionVector: StoryAssessmentRevisionVector;
  linkedRecheckSceneIds: readonly SceneId[];
}>;

export type StoryCheckFindingCandidateAnchor = Readonly<{
  sceneId: SceneId;
  quote?: string;
  storyKnowledgeId?: StoryKnowledgeId;
}>;

export type StoryCheckFindingCandidate = Readonly<{
  kind: StoryCheckFindingKind;
  severity: StoryCheckFindingSeverity;
  claim: string;
  nextStep?: string;
  anchors: readonly StoryCheckFindingCandidateAnchor[];
}>;

export type StoryCheckFindingsCandidatesV1 = Readonly<{
  schemaId: typeof STORY_CHECK_CANDIDATES_SCHEMA_ID;
  findings: readonly StoryCheckFindingCandidate[];
}>;

const boundedText = (maxLength: number) =>
  Object.freeze({ type: "string", minLength: 1, maxLength });

const anchorCandidateSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["sceneId"]),
  properties: Object.freeze({
    sceneId: boundedText(128),
    quote: boundedText(STORY_CHECK_MAX_QUOTE_CHARS),
    storyKnowledgeId: boundedText(128)
  })
});

const findingCandidateSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["kind", "severity", "claim", "anchors"]),
  properties: Object.freeze({
    kind: Object.freeze({ type: "string", enum: STORY_CHECK_FINDING_KINDS }),
    severity: Object.freeze({
      type: "string",
      enum: STORY_CHECK_FINDING_SEVERITIES
    }),
    claim: boundedText(STORY_CHECK_MAX_CLAIM_CHARS),
    nextStep: boundedText(STORY_CHECK_MAX_NEXT_STEP_CHARS),
    anchors: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: STORY_CHECK_MAX_ANCHORS_PER_FINDING,
      items: anchorCandidateSchema
    })
  })
});

export const STORY_CHECK_FINDINGS_CANDIDATES_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["schemaId", "findings"]),
  properties: Object.freeze({
    schemaId: Object.freeze({
      type: "string",
      const: STORY_CHECK_CANDIDATES_SCHEMA_ID
    }),
    findings: Object.freeze({
      type: "array",
      maxItems: STORY_CHECK_MAX_FINDINGS,
      items: findingCandidateSchema
    })
  })
});

const anchorStoredSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["sceneId"]),
  properties: Object.freeze({
    sceneId: boundedText(128),
    quote: boundedText(STORY_CHECK_MAX_QUOTE_CHARS),
    blockId: boundedText(128),
    storyKnowledgeId: boundedText(128)
  })
});

const resolutionSchema = Object.freeze({
  oneOf: Object.freeze([
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["status"]),
      properties: Object.freeze({
        status: Object.freeze({ type: "string", const: "open" })
      })
    }),
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["status"]),
      properties: Object.freeze({
        status: Object.freeze({ type: "string", const: "dismissed" })
      })
    }),
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["status", "reason"]),
      properties: Object.freeze({
        status: Object.freeze({ type: "string", const: "deferred" }),
        reason: boundedText(STORY_CHECK_MAX_DEFER_REASON_CHARS)
      })
    })
  ])
});

const findingStoredSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "id",
    "kind",
    "severity",
    "claim",
    "anchors",
    "resolution"
  ]),
  properties: Object.freeze({
    id: boundedText(STORY_CHECK_MAX_FINDING_ID_CHARS),
    kind: Object.freeze({ type: "string", enum: STORY_CHECK_FINDING_KINDS }),
    severity: Object.freeze({
      type: "string",
      enum: STORY_CHECK_FINDING_SEVERITIES
    }),
    claim: boundedText(STORY_CHECK_MAX_CLAIM_CHARS),
    nextStep: boundedText(STORY_CHECK_MAX_NEXT_STEP_CHARS),
    anchors: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: STORY_CHECK_MAX_ANCHORS_PER_FINDING,
      items: anchorStoredSchema
    }),
    resolution: resolutionSchema
  })
});

const targetSchema = Object.freeze({
  oneOf: Object.freeze([
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze([
        "mode",
        "projectId",
        "sceneId",
        "workingVersion",
        "contentHash"
      ]),
      properties: Object.freeze({
        mode: Object.freeze({ type: "string", const: "applied-scene" }),
        projectId: boundedText(128),
        sceneId: boundedText(128),
        workingVersion: Object.freeze({ type: "integer", minimum: 1 }),
        contentHash: boundedText(128)
      })
    }),
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze([
        "mode",
        "projectId",
        "sceneId",
        "assignmentId",
        "proposalId",
        "artifactVersion",
        "contentHash"
      ]),
      properties: Object.freeze({
        mode: Object.freeze({ type: "string", const: "proposal-draft" }),
        projectId: boundedText(128),
        sceneId: boundedText(128),
        assignmentId: boundedText(128),
        proposalId: boundedText(128),
        artifactVersion: Object.freeze({ type: "integer", minimum: 1 }),
        contentHash: boundedText(128)
      })
    })
  ])
});

export const STORY_CHECK_FINDINGS_V1_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "schemaId",
    "specialist",
    "target",
    "findings",
    "coverage",
    "revisionVector",
    "linkedRecheckSceneIds"
  ]),
  properties: Object.freeze({
    schemaId: Object.freeze({ type: "string", const: STORY_CHECK_SCHEMA_ID }),
    specialist: Object.freeze({ type: "string", enum: STORY_CHECK_SPECIALISTS }),
    target: targetSchema,
    findings: Object.freeze({
      type: "array",
      maxItems: STORY_CHECK_MAX_FINDINGS,
      items: findingStoredSchema
    }),
    coverage: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze([
        "requestedScopeSummary",
        "examined",
        "skipped",
        "truncations",
        "completeForRequestedScope"
      ]),
      properties: Object.freeze({
        requestedScopeSummary: boundedText(STORY_CHECK_MAX_SCOPE_SUMMARY_CHARS),
        examined: Object.freeze({
          type: "array",
          maxItems: STORY_CHECK_MAX_EXAMINED_SCENES,
          items: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: Object.freeze(["sceneId", "workingVersion", "contentHash"]),
            properties: Object.freeze({
              sceneId: boundedText(128),
              workingVersion: Object.freeze({ type: "integer", minimum: 1 }),
              contentHash: boundedText(128)
            })
          })
        }),
        skipped: Object.freeze({
          type: "array",
          maxItems: STORY_CHECK_MAX_SKIPPED_SCENES,
          items: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: Object.freeze(["sceneId", "reason"]),
            properties: Object.freeze({
              sceneId: boundedText(128),
              reason: boundedText(STORY_CHECK_MAX_SKIP_REASON_CHARS)
            })
          })
        }),
        truncations: Object.freeze({
          type: "array",
          maxItems: STORY_CHECK_MAX_TRUNCATIONS,
          items: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: Object.freeze([
              "resourceKind",
              "resourceId",
              "truncated",
              "providerCharCount",
              "fullCharCount"
            ]),
            properties: Object.freeze({
              resourceKind: Object.freeze({
                type: "string",
                enum: STORY_CHECK_COVERAGE_RESOURCE_KINDS
              }),
              resourceId: boundedText(STORY_CHECK_MAX_RESOURCE_ID_CHARS),
              truncated: Object.freeze({ type: "boolean" }),
              providerCharCount: Object.freeze({
                type: "integer",
                minimum: 0,
                maximum: 500_000
              }),
              fullCharCount: Object.freeze({
                type: "integer",
                minimum: 0,
                maximum: 500_000
              })
            })
          })
        }),
        completeForRequestedScope: Object.freeze({ type: "boolean" })
      })
    }),
    revisionVector: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["dependencies"]),
      properties: Object.freeze({
        dependencies: Object.freeze({
          type: "array",
          maxItems: 2_000,
          items: Object.freeze({ type: "object" })
        })
      })
    }),
    linkedRecheckSceneIds: Object.freeze({
      type: "array",
      maxItems: STORY_CHECK_MAX_LINKED_RECHECK_SCENES,
      items: boundedText(128)
    })
  })
});

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

/** Ensures truncation flags cannot disagree with char counts. */
export function assertStoryCheckTruncationConsistent(input: Readonly<{
  truncated: boolean;
  providerCharCount: number;
  fullCharCount: number;
}>): boolean {
  if (input.providerCharCount > input.fullCharCount) {
    invalid("Truncation provider char count exceeds full char count.");
  }
  const expectedTruncated = input.providerCharCount < input.fullCharCount;
  if (input.truncated !== expectedTruncated) {
    invalid("Coverage truncation flag contradicts provider and full char counts.");
  }
  return input.truncated;
}

function parseSceneContentHash(value: unknown, label: string): SceneContentHash {
  if (typeof value !== "string") {
    invalid(`${label} must be a string.`);
  }
  try {
    return sceneContentHash(value);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      invalid(`${label} must be a SHA-256 digest.`);
    }
    throw error;
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid("Story check payload includes unexpected or missing fields.");
  }
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    invalid(`${label} length is out of bounds.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label, maxLength);
}

function array(value: unknown, label: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid(`${label} are invalid.`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[]
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(`${label} is invalid.`);
  }
  return value as T;
}

function positiveInt(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid(`${label} must be a positive integer.`);
  }
  return value as number;
}

function nonNegativeInt(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function parseResolution(raw: unknown): StoryCheckFindingResolution {
  const item = object(raw, "Finding resolution");
  exactKeys(item, ["status"], ["reason"]);
  const status = enumValue(
    item.status,
    "Resolution status",
    STORY_CHECK_RESOLUTION_STATUSES
  );
  if (status === "deferred") {
    return Object.freeze({
      status: "deferred",
      reason: text(item.reason, "Deferred reason", STORY_CHECK_MAX_DEFER_REASON_CHARS)
    });
  }
  if (item.reason !== undefined) {
    invalid("Resolution reason is allowed only for deferred findings.");
  }
  return Object.freeze({ status });
}

function parseAnchor(raw: unknown, allowBlockId: boolean): StoryCheckEvidenceAnchor {
  const item = object(raw, "Evidence anchor");
  exactKeys(item, ["sceneId"], ["quote", "blockId", "storyKnowledgeId"]);
  if (item.blockId !== undefined && !allowBlockId) {
    invalid("Proposal draft findings cannot include block anchors.");
  }
  return Object.freeze({
    sceneId: sceneId(text(item.sceneId, "Anchor scene id", 128)),
    ...(item.quote === undefined
      ? {}
      : { quote: optionalText(item.quote, "Anchor quote", STORY_CHECK_MAX_QUOTE_CHARS) }),
    ...(item.blockId === undefined
      ? {}
      : { blockId: text(item.blockId, "Anchor block id", 128) }),
    ...(item.storyKnowledgeId === undefined
      ? {}
      : {
          storyKnowledgeId: storyKnowledgeId(
            text(item.storyKnowledgeId, "Anchor story knowledge id", 128)
          )
        })
  });
}

function parseTarget(raw: unknown): StoryCheckTarget {
  const item = object(raw, "Story check target");
  const mode = enumValue(item.mode, "Target mode", [
    "applied-scene",
    "proposal-draft"
  ] as const);
  const project = projectId(text(item.projectId, "Target project id", 128));
  const targetSceneId = sceneId(text(item.sceneId, "Target scene id", 128));
  if (mode === "applied-scene") {
    exactKeys(
      item,
      ["mode", "projectId", "sceneId", "workingVersion", "contentHash"]
    );
    return Object.freeze({
      mode: "applied-scene",
      projectId: project,
      sceneId: targetSceneId,
      workingVersion: positiveInt(item.workingVersion, "Working version"),
      contentHash: parseSceneContentHash(item.contentHash, "Content hash")
    });
  }
  exactKeys(
    item,
    [
      "mode",
      "projectId",
      "sceneId",
      "assignmentId",
      "proposalId",
      "artifactVersion",
      "contentHash"
    ]
  );
  return Object.freeze({
    mode: "proposal-draft",
    projectId: project,
    sceneId: targetSceneId,
    assignmentId: storyWorkAssignmentId(
      text(item.assignmentId, "Assignment id", 128)
    ),
    proposalId: agentProposalId(text(item.proposalId, "Proposal id", 128)),
    artifactVersion: positiveInt(item.artifactVersion, "Artifact version"),
    contentHash: instructionContentHash(String(item.contentHash))
  });
}

function parseRevisionDependency(raw: unknown): StoryAssessmentDependency {
  const item = object(raw, "Revision dependency");
  const kind = text(item.kind, "Dependency kind", 64);
  switch (kind) {
    case "scene-prose":
      exactKeys(item, ["kind", "sceneId", "workingVersion", "contentHash"]);
      return Object.freeze({
        kind: "scene-prose",
        sceneId: sceneId(text(item.sceneId, "Scene id", 128)),
        workingVersion: positiveInt(item.workingVersion, "Working version"),
        contentHash: text(item.contentHash, "Content hash", 128)
      });
    case "scene-intent":
      exactKeys(item, ["kind", "sceneId", "revisionToken"]);
      return Object.freeze({
        kind: "scene-intent",
        sceneId: sceneId(text(item.sceneId, "Scene id", 128)),
        revisionToken: text(item.revisionToken, "Revision token", 100_000)
      });
    case "chapter-objective":
      exactKeys(item, ["kind", "chapterId", "revisionToken"]);
      return Object.freeze({
        kind: "chapter-objective",
        chapterId: chapterId(text(item.chapterId, "Chapter id", 128)),
        revisionToken: text(item.revisionToken, "Revision token", 100_000)
      });
    case "story-knowledge":
      exactKeys(item, ["kind", "storyKnowledgeId", "revisionToken"]);
      return Object.freeze({
        kind: "story-knowledge",
        storyKnowledgeId: storyKnowledgeId(
          text(item.storyKnowledgeId, "Story knowledge id", 128)
        ),
        revisionToken: text(item.revisionToken, "Revision token", 100_000)
      });
    case "manuscript-slice": {
      exactKeys(item, ["kind", "scope", "revisionToken"]);
      const scopeRaw = object(item.scope, "Manuscript slice scope");
      const scopeKind = text(scopeRaw.kind, "Scope kind", 32);
      if (scopeKind === "project") {
        exactKeys(scopeRaw, ["kind"]);
        return Object.freeze({
          kind: "manuscript-slice",
          scope: Object.freeze({ kind: "project" }),
          revisionToken: text(item.revisionToken, "Revision token", 100_000)
        });
      }
      if (scopeKind === "chapter") {
        exactKeys(scopeRaw, ["kind", "chapterId"]);
        return Object.freeze({
          kind: "manuscript-slice",
          scope: Object.freeze({
            kind: "chapter",
            chapterId: chapterId(text(scopeRaw.chapterId, "Chapter id", 128))
          }),
          revisionToken: text(item.revisionToken, "Revision token", 100_000)
        });
      }
      if (scopeKind === "scene") {
        exactKeys(scopeRaw, ["kind", "sceneId"]);
        return Object.freeze({
          kind: "manuscript-slice",
          scope: Object.freeze({
            kind: "scene",
            sceneId: sceneId(text(scopeRaw.sceneId, "Scene id", 128))
          }),
          revisionToken: text(item.revisionToken, "Revision token", 100_000)
        });
      }
      return invalid("Manuscript slice scope kind is invalid.");
    }
    default:
      return invalid("Revision dependency kind is invalid.");
  }
}

function parseCoverage(raw: unknown): StoryCheckCoverageV1 {
  const item = object(raw, "Story check coverage");
  exactKeys(item, [
    "requestedScopeSummary",
    "examined",
    "skipped",
    "truncations",
    "completeForRequestedScope"
  ]);
  const examined = array(item.examined, "Examined scenes", STORY_CHECK_MAX_EXAMINED_SCENES).map(
    (entry) => {
      const row = object(entry, "Examined scene");
      exactKeys(row, ["sceneId", "workingVersion", "contentHash"]);
      return Object.freeze({
        sceneId: sceneId(text(row.sceneId, "Examined scene id", 128)),
        workingVersion: positiveInt(row.workingVersion, "Examined working version"),
        contentHash: parseSceneContentHash(row.contentHash, "Examined content hash")
      });
    }
  );
  const skipped = array(item.skipped, "Skipped scenes", STORY_CHECK_MAX_SKIPPED_SCENES).map(
    (entry) => {
      const row = object(entry, "Skipped scene");
      exactKeys(row, ["sceneId", "reason"]);
      return Object.freeze({
        sceneId: sceneId(text(row.sceneId, "Skipped scene id", 128)),
        reason: text(row.reason, "Skip reason", STORY_CHECK_MAX_SKIP_REASON_CHARS)
      });
    }
  );
  const truncations = array(
    item.truncations,
    "Coverage truncations",
    STORY_CHECK_MAX_TRUNCATIONS
  ).map((entry) => {
    const row = object(entry, "Coverage truncation");
    exactKeys(row, [
      "resourceKind",
      "resourceId",
      "truncated",
      "providerCharCount",
      "fullCharCount"
    ]);
    const resourceKind = enumValue(
      row.resourceKind,
      "Truncation resource kind",
      STORY_CHECK_COVERAGE_RESOURCE_KINDS
    );
    const providerCharCount = nonNegativeInt(
      row.providerCharCount,
      "Provider char count"
    );
    const fullCharCount = nonNegativeInt(row.fullCharCount, "Full char count");
    const truncated = assertStoryCheckTruncationConsistent({
      truncated: row.truncated === true,
      providerCharCount,
      fullCharCount
    });
    return Object.freeze({
      resourceKind,
      resourceId: text(row.resourceId, "Truncation resource id", STORY_CHECK_MAX_RESOURCE_ID_CHARS),
      truncated,
      providerCharCount,
      fullCharCount
    });
  });
  if (typeof item.completeForRequestedScope !== "boolean") {
    invalid("Coverage completeness flag must be a boolean.");
  }
  return Object.freeze({
    requestedScopeSummary: text(
      item.requestedScopeSummary,
      "Requested scope summary",
      STORY_CHECK_MAX_SCOPE_SUMMARY_CHARS
    ),
    examined: Object.freeze(examined),
    skipped: Object.freeze(skipped),
    truncations: Object.freeze(truncations),
    completeForRequestedScope: item.completeForRequestedScope
  });
}

export function validateStoryCheckFindingsCandidatesV1(
  value: unknown
): StoryCheckFindingsCandidatesV1 {
  const root = object(value, "Story check candidates");
  exactKeys(root, ["schemaId", "findings"]);
  if (root.schemaId !== STORY_CHECK_CANDIDATES_SCHEMA_ID) {
    invalid("Story check candidates schema identifier is invalid.");
  }
  const findings = array(root.findings, "Story check finding candidates", STORY_CHECK_MAX_FINDINGS).map(
    (raw) => {
      const item = object(raw, "Story check finding candidate");
      exactKeys(item, ["kind", "severity", "claim", "anchors"], ["nextStep"]);
      const anchors = array(
        item.anchors,
        "Finding candidate anchors",
        STORY_CHECK_MAX_ANCHORS_PER_FINDING
      );
      if (anchors.length === 0) {
        invalid("Finding candidate anchors must not be empty.");
      }
      return Object.freeze({
        kind: enumValue(item.kind, "Finding kind", STORY_CHECK_FINDING_KINDS),
        severity: enumValue(
          item.severity,
          "Finding severity",
          STORY_CHECK_FINDING_SEVERITIES
        ),
        claim: text(item.claim, "Finding claim", STORY_CHECK_MAX_CLAIM_CHARS),
        ...(item.nextStep === undefined
          ? {}
          : {
              nextStep: optionalText(
                item.nextStep,
                "Finding next step",
                STORY_CHECK_MAX_NEXT_STEP_CHARS
              )
            }),
        anchors: Object.freeze(
          anchors.map((anchorRaw) => {
            const anchor = object(anchorRaw, "Finding candidate anchor");
            exactKeys(anchor, ["sceneId"], ["quote", "storyKnowledgeId"]);
            if (Object.prototype.hasOwnProperty.call(anchor, "blockId")) {
              invalid("Finding candidate anchors cannot include block ids.");
            }
            return Object.freeze({
              sceneId: sceneId(text(anchor.sceneId, "Anchor scene id", 128)),
              ...(anchor.quote === undefined
                ? {}
                : {
                    quote: optionalText(
                      anchor.quote,
                      "Anchor quote",
                      STORY_CHECK_MAX_QUOTE_CHARS
                    )
                  }),
              ...(anchor.storyKnowledgeId === undefined
                ? {}
                : {
                    storyKnowledgeId: storyKnowledgeId(
                      text(anchor.storyKnowledgeId, "Anchor story knowledge id", 128)
                    )
                  })
            });
          })
        )
      });
    }
  );
  return Object.freeze({
    schemaId: STORY_CHECK_CANDIDATES_SCHEMA_ID,
    findings: Object.freeze(findings)
  });
}

export function validateStoryCheckFindingsV1(value: unknown): StoryCheckFindingsV1 {
  const root = object(value, "Story check findings");
  exactKeys(root, [
    "schemaId",
    "specialist",
    "target",
    "findings",
    "coverage",
    "revisionVector",
    "linkedRecheckSceneIds"
  ]);
  if (root.schemaId !== STORY_CHECK_SCHEMA_ID) {
    invalid("Story check findings schema identifier is invalid.");
  }
  const specialist = enumValue(
    root.specialist,
    "Story check specialist",
    STORY_CHECK_SPECIALISTS
  );
  const target = parseTarget(root.target);
  const allowBlockId = target.mode === "applied-scene";
  const findings = array(root.findings, "Story check findings", STORY_CHECK_MAX_FINDINGS).map(
    (raw) => {
      const item = object(raw, "Story check finding");
      exactKeys(
        item,
        ["id", "kind", "severity", "claim", "anchors", "resolution"],
        ["nextStep"]
      );
      const anchors = array(
        item.anchors,
        "Finding anchors",
        STORY_CHECK_MAX_ANCHORS_PER_FINDING
      );
      if (anchors.length === 0) {
        invalid("Finding anchors must not be empty.");
      }
      return Object.freeze({
        id: text(item.id, "Finding id", STORY_CHECK_MAX_FINDING_ID_CHARS),
        kind: enumValue(item.kind, "Finding kind", STORY_CHECK_FINDING_KINDS),
        severity: enumValue(
          item.severity,
          "Finding severity",
          STORY_CHECK_FINDING_SEVERITIES
        ),
        claim: text(item.claim, "Finding claim", STORY_CHECK_MAX_CLAIM_CHARS),
        ...(item.nextStep === undefined
          ? {}
          : {
              nextStep: optionalText(
                item.nextStep,
                "Finding next step",
                STORY_CHECK_MAX_NEXT_STEP_CHARS
              )
            }),
        anchors: Object.freeze(
          anchors.map((anchorRaw) => parseAnchor(anchorRaw, allowBlockId))
        ),
        resolution: parseResolution(item.resolution)
      });
    }
  );
  const findingIds = findings.map((finding) => finding.id);
  if (new Set(findingIds).size !== findingIds.length) {
    invalid("Story check finding ids must be unique.");
  }
  const coverage = parseCoverage(root.coverage);
  if (coverage.examined.length === 0) {
    invalid("Story check coverage must examine at least one scene.");
  }
  const examinedIds = coverage.examined.map((entry) => entry.sceneId);
  if (new Set(examinedIds).size !== examinedIds.length) {
    invalid("Examined scene ids must be unique.");
  }
  const skippedIds = coverage.skipped.map((entry) => entry.sceneId);
  if (new Set(skippedIds).size !== skippedIds.length) {
    invalid("Skipped scene ids must be unique.");
  }
  for (const skippedId of skippedIds) {
    if (examinedIds.includes(skippedId)) {
      invalid("Skipped scene ids cannot overlap examined scene ids.");
    }
  }
  if (
    coverage.completeForRequestedScope &&
    (coverage.skipped.length > 0 ||
      coverage.truncations.some((entry) => entry.truncated))
  ) {
    invalid("Coverage cannot claim completeness with skipped or truncated sources.");
  }
  const revisionRoot = object(root.revisionVector, "Revision vector");
  exactKeys(revisionRoot, ["dependencies"]);
  const dependencies = array(revisionRoot.dependencies, "Revision dependencies", 2_000).map(
    (entry) => parseRevisionDependency(entry)
  );
  const revisionVector = createStoryAssessmentRevisionVector(dependencies);

  const linkedRecheckSceneIds = Object.freeze(
    array(
      root.linkedRecheckSceneIds,
      "Linked recheck scene ids",
      STORY_CHECK_MAX_LINKED_RECHECK_SCENES
    ).map((id) => sceneId(text(id, "Linked recheck scene id", 128)))
  );
  if (
    new Set(linkedRecheckSceneIds).size !== linkedRecheckSceneIds.length
  ) {
    invalid("Linked recheck scene ids must be unique.");
  }

  return Object.freeze({
    schemaId: STORY_CHECK_SCHEMA_ID,
    specialist,
    target,
    findings: Object.freeze(findings),
    coverage,
    revisionVector,
    linkedRecheckSceneIds
  });
}
