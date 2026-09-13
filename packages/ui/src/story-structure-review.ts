import {
  assertStoryStructureReviewEditPreservesAuthority,
  canonicalJsonStringify,
  computeStoryStructureRequiredClosure,
  STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS,
  STORY_STRUCTURE_MAX_OBJECTIVE_CHARS,
  STORY_STRUCTURE_MAX_TITLE_CHARS,
  validateStoryStructureOperationSelection,
  validateStoryStructureProposalV1,
  type SceneId,
  type SceneIntentPatch,
  type StoryStructureNarrativeAnchorImpact,
  type StoryStructureOperation,
  type StoryStructureOperationId,
  type StoryStructurePreview,
  type StoryStructureProposalV1,
  type StoryStructureCheckStalenessImpact,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";

export type StoryStructureReviewArtifact = Readonly<{
  pointer: StoryWorkArtifactPointer;
  payload: StoryStructureProposalV1;
}>;

export type StoryStructureReviewPreviewBinding = Readonly<{
  fingerprint: string;
  preview: StoryStructurePreview;
}>;

const GROUP_ORDER = Object.freeze([
  "part",
  "chapters",
  "plannedScenes",
  "existingStructure"
]);

function compareOperationIds(
  left: StoryStructureOperationId,
  right: StoryStructureOperationId
): number {
  return String(left).localeCompare(String(right));
}

function sortedOperationIds(
  ids: readonly StoryStructureOperationId[]
): readonly StoryStructureOperationId[] {
  return Object.freeze([...ids].sort(compareOperationIds));
}

function plannedSceneIdSet(proposal: StoryStructureProposalV1): ReadonlySet<SceneId> {
  return new Set(
    proposal.operations
      .filter(
        (operation): operation is Extract<StoryStructureOperation, { type: "scene.createPlanned" }> =>
          operation.type === "scene.createPlanned"
      )
      .map((operation) => operation.sceneId)
  );
}

export function storyStructureOperationGroupKey(
  operation: StoryStructureOperation,
  proposal: StoryStructureProposalV1
): string {
  const plannedScenes = plannedSceneIdSet(proposal);
  switch (operation.type) {
    case "part.create":
      return "part";
    case "chapter.create":
    case "chapter.reorder":
      return "chapters";
    case "chapter.update":
      return "existingStructure";
    case "scene.createPlanned":
      return "plannedScenes";
    case "scene.updateIntent":
      return plannedScenes.has(operation.sceneId) ? "plannedScenes" : "existingStructure";
    case "scene.move":
    case "scene.setArchived":
      return "existingStructure";
    default:
      return "existingStructure";
  }
}

export function storyStructureOperationGroupTitle(groupKey: string): string {
  switch (groupKey) {
    case "part":
      return "Part";
    case "chapters":
      return "Chapters";
    case "plannedScenes":
      return "Planned scenes";
    case "existingStructure":
      return "Existing structure";
    default:
      return "Structure";
  }
}

export function storyStructureOperationHumanLabel(operation: StoryStructureOperation): string {
  switch (operation.type) {
    case "part.create":
      return `Create part · ${operation.title}`;
    case "chapter.create":
      return operation.objective === undefined
        ? `Create chapter · ${operation.title}`
        : `Create chapter · ${operation.title}`;
    case "chapter.update":
      return "Update chapter objective";
    case "chapter.reorder":
      return `Reorder chapters (${operation.chapterIds.length})`;
    case "scene.createPlanned":
      return `Create planned scene · ${operation.title}`;
    case "scene.updateIntent":
      return "Update scene intent";
    case "scene.move":
      return "Move scene in reading order";
    case "scene.setArchived":
      return operation.archived ? "Archive scene" : "Restore scene";
    default:
      return "Structure operation";
  }
}

export type StoryStructureOperationViewRow = Readonly<{
  operationId: StoryStructureOperationId;
  groupKey: string;
  groupTitle: string;
  label: string;
  requires: readonly StoryStructureOperationViewRow[];
}>;

export function buildStoryStructureOperationViewRows(
  proposal: StoryStructureProposalV1
): readonly StoryStructureOperationViewRow[] {
  const byId = new Map(
    proposal.operations.map((operation) => [operation.operationId, operation])
  );
  const labelFor = (operationId: StoryStructureOperationId): string => {
    const operation = byId.get(operationId);
    return operation === undefined
      ? String(operationId)
      : storyStructureOperationHumanLabel(operation);
  };
  const dependencyMap = new Map(
    proposal.dependencies.map((edge) => [edge.operationId, edge.requires])
  );
  const rows = proposal.operations.map((operation) => {
    const groupKey = storyStructureOperationGroupKey(operation, proposal);
    const requires = (dependencyMap.get(operation.operationId) ?? []).map((requiredId) =>
      Object.freeze({
        operationId: requiredId,
        groupKey: "",
        groupTitle: "",
        label: labelFor(requiredId),
        requires: Object.freeze([])
      })
    );
    return Object.freeze({
      operationId: operation.operationId,
      groupKey,
      groupTitle: storyStructureOperationGroupTitle(groupKey),
      label: storyStructureOperationHumanLabel(operation),
      requires: Object.freeze(requires)
    });
  });
  return Object.freeze(rows);
}

export type StoryStructureOperationGroup = Readonly<{
  groupKey: string;
  title: string;
  rows: readonly StoryStructureOperationViewRow[];
}>;

export function groupStoryStructureOperationViewRows(
  rows: readonly StoryStructureOperationViewRow[]
): readonly StoryStructureOperationGroup[] {
  const groups = new Map<string, StoryStructureOperationViewRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.groupKey) ?? [];
    bucket.push(row);
    groups.set(row.groupKey, bucket);
  }
  return Object.freeze(
    GROUP_ORDER.filter((groupKey) => groups.has(groupKey)).map((groupKey) => {
      const groupRows = groups.get(groupKey) ?? [];
      return Object.freeze({
        groupKey,
        title: groupRows[0]?.groupTitle ?? storyStructureOperationGroupTitle(groupKey),
        rows: Object.freeze(groupRows)
      });
    })
  );
}

export function sameStoryStructureReviewArtifact(
  left: StoryWorkArtifactPointer,
  right: StoryWorkArtifactPointer
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

export function defaultStoryStructureSelectedOperationIds(
  proposal: StoryStructureProposalV1
): readonly StoryStructureOperationId[] {
  return sortedOperationIds(proposal.operations.map((operation) => operation.operationId));
}

export function toggleStoryStructureOperationSelection(
  selectedOperationIds: readonly StoryStructureOperationId[],
  operationId: StoryStructureOperationId
): readonly StoryStructureOperationId[] {
  const selected = new Set(selectedOperationIds);
  if (selected.has(operationId)) {
    selected.delete(operationId);
  } else {
    selected.add(operationId);
  }
  return sortedOperationIds([...selected]);
}

export function storyStructureSelectionMissingRequired(input: Readonly<{
  proposal: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): readonly StoryStructureOperationId[] {
  const validation = validateStoryStructureOperationSelection({
    operations: input.proposal.operations,
    dependencies: input.proposal.dependencies,
    selectedOperationIds: input.selectedOperationIds
  });
  if (validation.ok || validation.code !== "MISSING_REQUIREMENTS") {
    return Object.freeze([]);
  }
  return sortedOperationIds(validation.missingRequired);
}

export function addRequiredStoryStructureOperations(input: Readonly<{
  proposal: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): readonly StoryStructureOperationId[] {
  return sortedOperationIds(
    computeStoryStructureRequiredClosure(
      input.selectedOperationIds,
      input.proposal.dependencies
    )
  );
}

export function storyStructureSelectionIsValid(input: Readonly<{
  proposal: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): boolean {
  const validation = validateStoryStructureOperationSelection({
    operations: input.proposal.operations,
    dependencies: input.proposal.dependencies,
    selectedOperationIds: input.selectedOperationIds
  });
  return validation.ok;
}

export type StoryStructureBoundedTextResult =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; message: string }>;

export function sanitizeStoryStructureBoundedText(
  raw: string,
  maxLength: number,
  label: string
): StoryStructureBoundedTextResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return Object.freeze({ ok: false, message: `${label} must not be blank.` });
  }
  if (trimmed.length > maxLength) {
    return Object.freeze({
      ok: false,
      message: `${label} must be at most ${maxLength} characters.`
    });
  }
  return Object.freeze({ ok: true, value: trimmed });
}

export type StoryStructureEditableOperationFields = Readonly<{
  title?: string;
  objective?: string;
  intent?: SceneIntentPatch;
}>;

export type StoryStructurePayloadPatchResult =
  | Readonly<{ ok: true; payload: StoryStructureProposalV1 }>
  | Readonly<{ ok: false; message: string }>;

type SanitizedIntentPatchResult =
  | StoryStructurePayloadPatchResult
  | Readonly<{ ok: true; patch: SceneIntentPatch }>;

function sanitizeIntentPatch(patch: SceneIntentPatch): SanitizedIntentPatchResult {
  const next: Record<string, string> = {};
  for (const [field, maxLength] of [
    ["purpose", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS],
    ["conflict", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS],
    ["turn", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS],
    ["openQuestions", STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS]
  ] as const) {
    const value = patch[field];
    if (value === undefined || value === null) continue;
    const sanitized = sanitizeStoryStructureBoundedText(value, maxLength, field);
    if (!sanitized.ok) return sanitized;
    next[field] = sanitized.value;
  }
  if (Object.keys(next).length === 0) {
    return Object.freeze({ ok: false, message: "Scene intent must include at least one field." });
  }
  return Object.freeze({ ok: true, patch: Object.freeze(next) as SceneIntentPatch });
}

export function patchStoryStructureReviewPayload(input: Readonly<{
  stored: StoryStructureProposalV1;
  edits: Readonly<Partial<Record<StoryStructureOperationId, StoryStructureEditableOperationFields>>>;
}>): StoryStructurePayloadPatchResult {
  const operations: StoryStructureOperation[] = [];
  for (const operation of input.stored.operations) {
    const edit = input.edits[operation.operationId];
    if (edit === undefined) {
      operations.push(operation);
      continue;
    }
    switch (operation.type) {
      case "part.create": {
        if (edit.title === undefined) {
          operations.push(operation);
          break;
        }
        const title = sanitizeStoryStructureBoundedText(
          edit.title,
          STORY_STRUCTURE_MAX_TITLE_CHARS,
          "Part title"
        );
        if (!title.ok) return title;
        operations.push(Object.freeze({ ...operation, title: title.value }));
        break;
      }
      case "chapter.create": {
        let title = operation.title;
        let objective = operation.objective;
        if (edit.title !== undefined) {
          const sanitized = sanitizeStoryStructureBoundedText(
            edit.title,
            STORY_STRUCTURE_MAX_TITLE_CHARS,
            "Chapter title"
          );
          if (!sanitized.ok) return sanitized;
          title = sanitized.value;
        }
        if (edit.objective !== undefined) {
          const trimmed = edit.objective.trim();
          if (trimmed.length === 0) {
            objective = undefined;
          } else {
            const sanitized = sanitizeStoryStructureBoundedText(
              edit.objective,
              STORY_STRUCTURE_MAX_OBJECTIVE_CHARS,
              "Chapter objective"
            );
            if (!sanitized.ok) return sanitized;
            objective = sanitized.value;
          }
        }
        operations.push(
          Object.freeze({
            ...operation,
            title,
            ...(objective === undefined ? {} : { objective })
          })
        );
        break;
      }
      case "chapter.update": {
        if (edit.objective === undefined) {
          operations.push(operation);
          break;
        }
        const objective = sanitizeStoryStructureBoundedText(
          edit.objective,
          STORY_STRUCTURE_MAX_OBJECTIVE_CHARS,
          "Chapter objective"
        );
        if (!objective.ok) return objective;
        operations.push(Object.freeze({ ...operation, objective: objective.value }));
        break;
      }
      case "scene.createPlanned": {
        if (edit.title === undefined) {
          operations.push(operation);
          break;
        }
        const title = sanitizeStoryStructureBoundedText(
          edit.title,
          STORY_STRUCTURE_MAX_TITLE_CHARS,
          "Scene title"
        );
        if (!title.ok) return title;
        operations.push(Object.freeze({ ...operation, title: title.value }));
        break;
      }
      case "scene.updateIntent": {
        if (edit.intent === undefined) {
          operations.push(operation);
          break;
        }
        const intent = sanitizeIntentPatch(edit.intent);
        if (!intent.ok) return intent;
        if (!("patch" in intent)) return intent;
        operations.push(
          Object.freeze({
            ...operation,
            patch: intent.patch
          })
        );
        break;
      }
      default:
        operations.push(operation);
        break;
    }
  }

  const candidate = Object.freeze({
    ...input.stored,
    operations: Object.freeze(operations)
  });
  try {
    assertStoryStructureReviewEditPreservesAuthority(input.stored, candidate);
    return Object.freeze({ ok: true, payload: validateStoryStructureProposalV1(candidate) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      message: error instanceof Error ? error.message : "Structure edit is invalid."
    });
  }
}

export function storyStructureReviewHasUnsavedEdits(
  edits: Readonly<Partial<Record<StoryStructureOperationId, StoryStructureEditableOperationFields>>>
): boolean {
  return Object.keys(edits).length > 0;
}

export function selectedStoryStructureCreatedSceneIds(input: Readonly<{
  proposal: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
  preview?: StoryStructurePreview;
}>): readonly SceneId[] {
  const selected = new Set(input.selectedOperationIds);
  const fromProposal = input.proposal.operations
    .filter(
      (operation): operation is Extract<StoryStructureOperation, { type: "scene.createPlanned" }> =>
        operation.type === "scene.createPlanned" && selected.has(operation.operationId)
    )
    .map((operation) => operation.sceneId);
  if (input.preview === undefined) {
    return Object.freeze(fromProposal);
  }
  const previewSet = new Set(input.preview.createdSceneIds);
  return Object.freeze(fromProposal.filter((id) => previewSet.has(id)));
}

export function storyStructurePreviewCacheFingerprint(input: Readonly<{
  artifact: StoryWorkArtifactPointer;
  payload: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): string {
  return canonicalJsonStringify({
    artifact: input.artifact,
    payload: input.payload,
    selectedOperationIds: sortedOperationIds(input.selectedOperationIds)
  });
}

export function storyStructurePreviewCacheMatches(
  cachedFingerprint: string | undefined,
  input: Readonly<{
    artifact: StoryWorkArtifactPointer;
    payload: StoryStructureProposalV1;
    selectedOperationIds: readonly StoryStructureOperationId[];
  }>
): boolean {
  if (cachedFingerprint === undefined) return false;
  return cachedFingerprint === storyStructurePreviewCacheFingerprint(input);
}

export function storyStructureReviewCanPreview(input: Readonly<{
  dirty: boolean;
  artifactStale: boolean;
  proposal: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): boolean {
  if (input.dirty || input.artifactStale) return false;
  return storyStructureSelectionIsValid({
    proposal: input.proposal,
    selectedOperationIds: input.selectedOperationIds
  });
}

export function storyStructureReviewCanApply(input: Readonly<{
  dirty: boolean;
  artifactStale: boolean;
  proposal: StoryStructureProposalV1;
  artifact: StoryWorkArtifactPointer;
  payload: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
  preview?: StoryStructureReviewPreviewBinding;
}>): boolean {
  if (input.dirty || input.artifactStale) return false;
  if (
    !storyStructureSelectionIsValid({
      proposal: input.proposal,
      selectedOperationIds: input.selectedOperationIds
    })
  ) {
    return false;
  }
  return storyStructurePreviewCacheMatches(input.preview?.fingerprint, {
    artifact: input.artifact,
    payload: input.payload,
    selectedOperationIds: input.selectedOperationIds
  });
}

export type StoryStructurePreviewPresentation = Readonly<{
  sceneCountBefore: number;
  sceneCountAfter: number;
  createdParts: number;
  createdChapters: number;
  createdScenes: number;
  updatedScenes: number;
  movedScenes: number;
  archivedScenes: number;
  restoredScenes: number;
  emptyGenesisCount: number;
  narrativeImpactLines: readonly string[];
  staleCheckLines: readonly string[];
  canvasInvariantLine: string;
  projectVersionLine: string;
}>;

export function storyStructureCanvasPlacementCopy(): string {
  return "Optional Canvas card placement changes board geometry only. Manuscript reading order and in-world chronology stay separate.";
}

export function storyStructureCanvasInvariantCopy(): string {
  return "Canvas layout never reorders the manuscript tree. Geometry-only placement does not change reading order or chronology.";
}

export function storyStructureNarrativeImpactLine(
  impact: StoryStructureNarrativeAnchorImpact
): string {
  const beforeIndex = impact.before.canonicalIndex;
  const afterIndex = impact.after.canonicalIndex;
  const anchorBefore = impact.before.anchorState;
  const anchorAfter = impact.after.anchorState;
  const readingOrder =
    beforeIndex === afterIndex
      ? `Reading order index stays at ${afterIndex + 1}`
      : `Reading order index ${beforeIndex + 1} → ${afterIndex + 1}`;
  const anchor =
    anchorBefore === anchorAfter
      ? `anchor ${anchorAfter}`
      : `anchor ${anchorBefore} → ${anchorAfter}`;
  return `Beat ${String(impact.beatId)} · scene ${String(impact.sceneId)} · ${readingOrder} · ${anchor}`;
}

export function storyStructureCheckStalenessLine(
  impact: StoryStructureCheckStalenessImpact
): string {
  const reasonCount = impact.reasons.length;
  return `Check ${String(impact.assignmentId)} will need recheck (${reasonCount} manuscript-slice ${reasonCount === 1 ? "reason" : "reasons"}).`;
}

export function storyStructurePreviewImpactPresentation(
  preview: StoryStructurePreview
): StoryStructurePreviewPresentation {
  return Object.freeze({
    sceneCountBefore: preview.manuscriptSceneOrderBefore.length,
    sceneCountAfter: preview.manuscriptSceneOrderAfter.length,
    createdParts: preview.createdPartIds.length,
    createdChapters: preview.createdChapterIds.length,
    createdScenes: preview.createdSceneIds.length,
    updatedScenes: preview.updatedSceneIds.length,
    movedScenes: preview.movedSceneIds.length,
    archivedScenes: preview.archivedSceneIds.length,
    restoredScenes: preview.restoredSceneIds.length,
    emptyGenesisCount: preview.emptyGenesisDescriptors.length,
    narrativeImpactLines: Object.freeze(
      preview.narrativeAnchorImpacts.map((impact) => storyStructureNarrativeImpactLine(impact))
    ),
    staleCheckLines: Object.freeze(
      preview.newlyStaleChecks.map((entry) => storyStructureCheckStalenessLine(entry))
    ),
    canvasInvariantLine: storyStructureCanvasInvariantCopy(),
    projectVersionLine: `Project version ${preview.projectVersionBefore} → ${preview.projectVersionAfter} after one acknowledged batch.`
  });
}

export function storyStructureOperationIsReadOnlyInReview(
  operation: StoryStructureOperation
): boolean {
  switch (operation.type) {
    case "chapter.reorder":
    case "scene.move":
    case "scene.setArchived":
      return true;
    default:
      return false;
  }
}

export function storyStructureEditableFieldsForOperation(
  operation: StoryStructureOperation
): readonly (keyof StoryStructureEditableOperationFields)[] {
  switch (operation.type) {
    case "part.create":
      return Object.freeze(["title"]);
    case "chapter.create":
      return Object.freeze(["title", "objective"]);
    case "chapter.update":
      return Object.freeze(["objective"]);
    case "scene.createPlanned":
      return Object.freeze(["title"]);
    case "scene.updateIntent":
      return Object.freeze(["intent"]);
    default:
      return Object.freeze([]);
  }
}
