import type { SceneBlockV1, SceneDocumentV1 } from "@ghostwriter/editor";
import type { StoryCheckRevisionVectorBuildResult } from "./story-check-revision-vector.js";
import { buildStoryCheckRevisionVector } from "./story-check-revision-vector.js";
import {
  STORY_CHECK_SCHEMA_ID,
  assertStoryCheckTruncationConsistent,
  validateStoryCheckFindingsCandidatesV1,
  validateStoryCheckFindingsV1,
  type StoryCheckCoverageTruncation,
  type StoryCheckCoverageV1,
  type StoryCheckEvidenceAnchor,
  type StoryCheckFindingCandidate,
  type StoryCheckFindingsCandidatesV1,
  type StoryCheckFindingsV1,
  type StoryCheckSpecialist,
  type StoryCheckTarget
} from "./story-check-findings-v1.js";
import {
  DomainValidationError,
  sceneId,
  type ProjectId,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import type { StoryCheckRevisionVectorInput } from "./story-check-revision-vector.js";
import { sceneContentHash } from "./scene-documents.js";

export type StoryCheckAnchorTrustedResource = Readonly<
  | {
      kind: "scene";
      sceneId: SceneId;
      providerText: string;
    }
  | {
      kind: "story-knowledge";
      storyKnowledgeId: StoryKnowledgeId;
      providerText: string;
    }
>;

export type StoryCheckCoverageBuildInput = Readonly<{
  requestedScopeSummary: string;
  examined: readonly Readonly<{
    sceneId: SceneId;
    workingVersion: number;
    contentHash: string;
  }>[];
  skipped: readonly Readonly<{
    sceneId: SceneId;
    reason: string;
  }>[];
  truncations: readonly StoryCheckCoverageTruncation[];
}>;

export type StoryCheckTrustedEnvelopeInput = Readonly<{
  specialist: StoryCheckSpecialist;
  target: StoryCheckTarget;
  candidates: unknown;
  coverage: StoryCheckCoverageBuildInput;
  revisionVectorInput: StoryCheckRevisionVectorInput;
  linkedRecheckSceneIds: readonly SceneId[];
  trustedSceneIds: readonly SceneId[];
  canonicalContextSceneIds: readonly SceneId[];
  anchorResources: readonly StoryCheckAnchorTrustedResource[];
  allowBlockAnchors: boolean;
  /** Required for applied-scene block anchor attachment and validation. */
  targetBoundDocument?: SceneDocumentV1;
  allocateFindingId: (index: number, candidate: StoryCheckFindingCandidate) => string;
}>;

function invalid(message: string): never {
  throw new DomainValidationError("INVALID_AGENT_OUTPUT", message);
}

function rejectCandidateAuthorityFields(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("Story check candidates must be an object.");
  }
  const record = value as Record<string, unknown>;
  for (const forbidden of [
    "target",
    "coverage",
    "revisionVector",
    "linkedRecheckSceneIds",
    "specialist"
  ]) {
    if (Object.prototype.hasOwnProperty.call(record, forbidden)) {
      invalid("Story check candidates cannot include trusted authority fields.");
    }
  }
  if (!Array.isArray(record.findings)) return;
  for (const finding of record.findings) {
    if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
      continue;
    }
    const findingRecord = finding as Record<string, unknown>;
    for (const forbidden of ["id", "resolution"]) {
      if (Object.prototype.hasOwnProperty.call(findingRecord, forbidden)) {
        invalid("Story check candidates cannot include finding ids or resolutions.");
      }
    }
  }
}

function blockPlainText(block: SceneBlockV1): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return (block.content ?? [])
        .map((node) => (node.type === "text" ? node.text : ""))
        .join("");
    case "horizontalRule":
      return "—";
    case "blockquote":
      return block.content
        .map((child) => blockPlainText(child))
        .filter((text) => text.length > 0)
        .join("\n");
    default:
      return "";
  }
}

function resolveAppliedSceneBlockId(
  quote: string,
  document: SceneDocumentV1
): string | undefined {
  const matches: string[] = [];
  for (const block of document.document.content) {
    const id = (block as { attrs?: { id?: string } }).attrs?.id;
    if (typeof id !== "string" || id.trim().length === 0) continue;
    if (blockPlainText(block).includes(quote)) {
      matches.push(id.trim());
    }
  }
  if (matches.length !== 1) return undefined;
  return matches[0];
}

export function sceneDocumentTopLevelBlockIds(
  document: SceneDocumentV1
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const block of document.document.content) {
    const candidate = (block as { attrs?: { id?: string } }).attrs?.id;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      ids.add(candidate.trim());
    }
  }
  return ids;
}

function buildCoverage(input: StoryCheckCoverageBuildInput): StoryCheckCoverageV1 {
  if (input.examined.length === 0) {
    invalid("Story check coverage must examine at least one scene.");
  }
  const examinedIds = input.examined.map((entry) => entry.sceneId);
  if (new Set(examinedIds).size !== examinedIds.length) {
    invalid("Examined scene ids must be unique.");
  }
  const skippedIds = input.skipped.map((entry) => entry.sceneId);
  if (new Set(skippedIds).size !== skippedIds.length) {
    invalid("Skipped scene ids must be unique.");
  }
  for (const skipped of skippedIds) {
    if (examinedIds.includes(skipped)) {
      invalid("Skipped scene ids cannot overlap examined scene ids.");
    }
  }
  const truncations = Object.freeze(
    input.truncations.map((entry) =>
      Object.freeze({
        ...entry,
        truncated: assertStoryCheckTruncationConsistent({
          truncated: entry.truncated,
          providerCharCount: entry.providerCharCount,
          fullCharCount: entry.fullCharCount
        })
      })
    )
  );
  const truncated = truncations.some((entry) => entry.truncated);
  const completeForRequestedScope =
    input.skipped.length === 0 && !truncated;
  return Object.freeze({
    requestedScopeSummary: input.requestedScopeSummary.trim(),
    examined: Object.freeze(
      input.examined.map((entry) =>
        Object.freeze({
          sceneId: entry.sceneId,
          workingVersion: entry.workingVersion,
          contentHash: sceneContentHash(String(entry.contentHash))
        })
      )
    ),
    skipped: Object.freeze(
      input.skipped.map((entry) =>
        Object.freeze({
          sceneId: entry.sceneId,
          reason: entry.reason.trim()
        })
      )
    ),
    truncations,
    completeForRequestedScope
  });
}

function sceneResource(
  resources: readonly StoryCheckAnchorTrustedResource[],
  sceneIdValue: SceneId
): Extract<StoryCheckAnchorTrustedResource, { kind: "scene" }> | undefined {
  return resources.find(
    (resource): resource is Extract<StoryCheckAnchorTrustedResource, { kind: "scene" }> =>
      resource.kind === "scene" && resource.sceneId === sceneIdValue
  );
}

function knowledgeResource(
  resources: readonly StoryCheckAnchorTrustedResource[],
  storyKnowledgeId: StoryKnowledgeId
): Extract<StoryCheckAnchorTrustedResource, { kind: "story-knowledge" }> | undefined {
  return resources.find(
    (
      resource
    ): resource is Extract<StoryCheckAnchorTrustedResource, { kind: "story-knowledge" }> =>
      resource.kind === "story-knowledge" &&
      resource.storyKnowledgeId === storyKnowledgeId
  );
}

function validateAnchorAgainstTrustedResources(
  anchor: StoryCheckFindingCandidate["anchors"][number],
  resources: readonly StoryCheckAnchorTrustedResource[],
  examinedSceneIds: ReadonlySet<SceneId>,
  allowBlockAnchors: boolean,
  targetBoundDocument: SceneDocumentV1 | undefined,
  targetSceneId: SceneId
): StoryCheckEvidenceAnchor {
  if (!examinedSceneIds.has(anchor.sceneId)) {
    invalid("Finding anchor scene id must reference examined coverage, not skipped context.");
  }
  const scene = sceneResource(resources, anchor.sceneId);
  if (scene === undefined) {
    invalid("Finding anchor scene id is outside trusted receipt coverage.");
  }
  let linkedKnowledge: StoryKnowledgeId | undefined;
  if (anchor.storyKnowledgeId !== undefined) {
    const knowledge = knowledgeResource(resources, anchor.storyKnowledgeId);
    if (knowledge === undefined) {
      invalid("Finding anchor story knowledge id is outside trusted receipt coverage.");
    }
    linkedKnowledge = anchor.storyKnowledgeId;
  }
  if (anchor.quote !== undefined && !scene.providerText.includes(anchor.quote)) {
    invalid("Finding anchor quote is not an exact substring of trusted scene text.");
  }
  let blockId: string | undefined;
  if (
    allowBlockAnchors &&
    anchor.quote !== undefined &&
    anchor.sceneId === targetSceneId &&
    targetBoundDocument !== undefined
  ) {
    blockId = resolveAppliedSceneBlockId(anchor.quote, targetBoundDocument);
    const blockIds = sceneDocumentTopLevelBlockIds(targetBoundDocument);
    if (blockId !== undefined && !blockIds.has(blockId)) {
      invalid("Finding anchor block id is outside the bound acknowledged document.");
    }
  }
  return Object.freeze({
    sceneId: anchor.sceneId,
    ...(anchor.quote === undefined ? {} : { quote: anchor.quote }),
    ...(blockId === undefined ? {} : { blockId }),
    ...(linkedKnowledge === undefined ? {} : { storyKnowledgeId: linkedKnowledge })
  });
}

function normalizeLinkedRecheckSceneIds(
  linkedRecheckSceneIds: readonly SceneId[],
  trustedSceneIds: readonly SceneId[],
  canonicalContextSceneIds: readonly SceneId[],
  target: StoryCheckTarget
): readonly SceneId[] {
  const trusted = new Set(trustedSceneIds);
  const canonical = new Set(canonicalContextSceneIds);
  if (target.mode === "applied-scene") {
    if (!canonical.has(target.sceneId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Story check applied target scene is not represented by canonical story context."
      );
    }
  } else if (!trusted.has(target.sceneId)) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Story check proposal target scene is outside the trusted binding allowlist."
    );
  }
  const normalized = linkedRecheckSceneIds.map((id) => sceneId(String(id)));
  if (normalized.length > 32) {
    invalid("Linked recheck scene ids exceed the allowed bound.");
  }
  if (new Set(normalized).size !== normalized.length) {
    invalid("Linked recheck scene ids must be unique.");
  }
  for (const id of normalized) {
    if (!canonical.has(id)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Linked recheck scene "${id}" is outside canonical story context.`
      );
    }
  }
  return Object.freeze(normalized);
}

export async function buildTrustedStoryCheckFindingsV1(
  input: StoryCheckTrustedEnvelopeInput
): Promise<StoryCheckFindingsV1> {
  rejectCandidateAuthorityFields(input.candidates);
  const candidates: StoryCheckFindingsCandidatesV1 =
    validateStoryCheckFindingsCandidatesV1(input.candidates);

  if (input.target.projectId !== input.revisionVectorInput.target.projectId) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Story check target project does not match revision vector input."
    );
  }

  if (
    input.target.mode === "applied-scene" &&
    input.allowBlockAnchors &&
    input.targetBoundDocument === undefined
  ) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Applied-scene story checks require the bound target document for block anchors."
    );
  }

  const coverage = buildCoverage(input.coverage);
  const examinedSceneIds = new Set(coverage.examined.map((entry) => entry.sceneId));

  const findings = Object.freeze(
    candidates.findings.map((candidate, index) => {
      const anchors = Object.freeze(
        candidate.anchors.map((anchor) =>
          validateAnchorAgainstTrustedResources(
            anchor,
            input.anchorResources,
            examinedSceneIds,
            input.allowBlockAnchors,
            input.targetBoundDocument,
            input.target.sceneId
          )
        )
      );
      return Object.freeze({
        id: input.allocateFindingId(index, candidate),
        kind: candidate.kind,
        severity: candidate.severity,
        claim: candidate.claim,
        ...(candidate.nextStep === undefined ? {} : { nextStep: candidate.nextStep }),
        anchors,
        resolution: Object.freeze({ status: "open" as const })
      });
    })
  );
  const revision: StoryCheckRevisionVectorBuildResult =
    await buildStoryCheckRevisionVector(input.revisionVectorInput);
  const linkedRecheckSceneIds = normalizeLinkedRecheckSceneIds(
    input.linkedRecheckSceneIds,
    input.trustedSceneIds,
    input.canonicalContextSceneIds,
    input.target
  );

  const payload = Object.freeze({
    schemaId: STORY_CHECK_SCHEMA_ID,
    specialist: input.specialist,
    target: input.target,
    findings,
    coverage,
    revisionVector: revision.revisionVector,
    linkedRecheckSceneIds
  });

  return validateStoryCheckFindingsV1(payload);
}

export function assertStoryCheckTargetProject(
  target: StoryCheckTarget,
  projectIdValue: ProjectId
): void {
  if (target.projectId !== projectIdValue) {
    throw new DomainValidationError(
      "CROSS_PROJECT_REFERENCE",
      "Story check target belongs to a different project."
    );
  }
}
