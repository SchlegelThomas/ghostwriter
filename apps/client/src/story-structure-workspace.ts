import {
  assertStoryStructureReviewEditPreservesAuthority,
  canonicalJsonStringify,
  computeStoryStructureRequiredClosure,
  STORY_STRUCTURE_MAX_INTENT_FIELD_CHARS,
  STORY_STRUCTURE_MAX_OBJECTIVE_CHARS,
  STORY_STRUCTURE_MAX_TITLE_CHARS,
  validateStoryStructureOperationSelection,
  validateStoryStructureProposalV1,
  type BookId,
  type CanvasObjectId,
  type ProjectNavigator,
  type SceneId,
  type SceneIntentPatch,
  type StoryStructureOperation,
  type StoryStructureOperationId,
  type StoryStructurePreview,
  type StoryStructureProposalV1,
  type StoryWorkArtifactPointer,
  type StoryWorkAssignment,
  type StoryWorkResultReference,
  type StructureStoryWorkApplyResult
} from "@ghostwriter/core";

export type StructureStoryWorkAppliedResult = Extract<
  StoryWorkResultReference,
  { kind: "story-structure" }
>;
import type { SubmitStoryWorkBrief } from "@ghostwriter/ui";
import type { createOutlineStoryWorkAssignment } from "./api.js";

export type OutlineStoryWorkSubmitBrief = SubmitStoryWorkBrief &
  Readonly<{ taskKind: "outline"; targetBookId: BookId }>;

type CreateOutlineInput = Parameters<typeof createOutlineStoryWorkAssignment>[0];

export function deriveOutlineStoryWorkActiveBooks(
  navigator: ProjectNavigator
): readonly ProjectNavigator["books"][number][] {
  return Object.freeze(navigator.books.filter((book) => book.archivedAt === undefined));
}

function bookContainingScene(
  navigator: ProjectNavigator,
  targetSceneId: SceneId
): BookId | undefined {
  for (const book of navigator.books) {
    if (book.archivedAt !== undefined) continue;
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        if (chapter.scenes.some((scene) => scene.id === targetSceneId)) {
          return book.id;
        }
      }
    }
    if (book.unassignedScenes.some((scene) => scene.id === targetSceneId)) {
      return book.id;
    }
  }
  return undefined;
}

export function deriveOutlineStoryWorkDefaultTargetBookId(input: Readonly<{
  navigator: ProjectNavigator;
  selectedSceneId?: SceneId;
}>): BookId | undefined {
  if (input.selectedSceneId !== undefined) {
    const fromScene = bookContainingScene(input.navigator, input.selectedSceneId);
    if (fromScene !== undefined) return fromScene;
  }
  return deriveOutlineStoryWorkActiveBooks(input.navigator)[0]?.id;
}

export function buildOutlineStoryWorkCreateInput(
  navigator: ProjectNavigator,
  brief: OutlineStoryWorkSubmitBrief,
  idempotencyKey: string
): CreateOutlineInput {
  return Object.freeze({
    projectId: navigator.id,
    expectedProjectVersion: navigator.version,
    idempotencyKey,
    brief: brief.brief,
    constraints: brief.constraints,
    doneWhen: brief.doneWhen,
    sceneIds: brief.sceneIds,
    model: brief.model,
    targetBookId: brief.targetBookId
  });
}

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

export function storyStructureOperationGroupKey(operation: StoryStructureOperation): string {
  switch (operation.type) {
    case "part.create":
      return "parts";
    case "chapter.create":
    case "chapter.update":
    case "chapter.reorder":
      return "chapters";
    case "scene.createPlanned":
    case "scene.updateIntent":
      return "scenes";
    case "scene.move":
    case "scene.setArchived":
      return "manuscript";
    default:
      return "structure";
  }
}

export function storyStructureOperationGroupTitle(groupKey: string): string {
  switch (groupKey) {
    case "parts":
      return "Parts";
    case "chapters":
      return "Chapters";
    case "scenes":
      return "Scenes";
    case "manuscript":
      return "Manuscript changes";
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
      return `Update chapter objective`;
    case "chapter.reorder":
      return `Reorder chapters (${operation.chapterIds.length})`;
    case "scene.createPlanned":
      return `Create planned scene · ${operation.title}`;
    case "scene.updateIntent":
      return "Update scene intent";
    case "scene.move":
      return "Move scene";
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
}>;

export function buildStoryStructureOperationViewRows(
  proposal: StoryStructureProposalV1
): readonly StoryStructureOperationViewRow[] {
  const rows = proposal.operations.map((operation) => {
    const groupKey = storyStructureOperationGroupKey(operation);
    return Object.freeze({
      operationId: operation.operationId,
      groupKey,
      groupTitle: storyStructureOperationGroupTitle(groupKey),
      label: storyStructureOperationHumanLabel(operation)
    });
  });
  return Object.freeze(
    [...rows].sort((left, right) => compareOperationIds(left.operationId, right.operationId))
  );
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
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, groupRows]) =>
        Object.freeze({
          groupKey,
          title: groupRows[0]?.groupTitle ?? storyStructureOperationGroupTitle(groupKey),
          rows: Object.freeze(
            [...groupRows].sort((left, right) =>
              compareOperationIds(left.operationId, right.operationId)
            )
          )
        })
      )
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
  return Object.freeze(fromProposal.filter((sceneId) => previewSet.has(sceneId)));
}

export function deriveStructureCanvasPlacementCandidate(input: Readonly<{
  createdSceneIds: readonly SceneId[];
  preferredSceneId?: SceneId;
}>): SceneId | undefined {
  if (input.createdSceneIds.length === 0) return undefined;
  if (
    input.preferredSceneId !== undefined &&
    input.createdSceneIds.includes(input.preferredSceneId)
  ) {
    return input.preferredSceneId;
  }
  return input.createdSceneIds[0];
}

export type StructureApplyNavigationTarget =
  | Readonly<{ kind: "scene"; sceneId: SceneId }>
  | Readonly<{ kind: "book"; bookId: BookId }>;

export function structureApplySuccessNavigationTargetFromResult(
  result: StructureStoryWorkAppliedResult
): StructureApplyNavigationTarget {
  if (result.canvasPlacedSceneId !== undefined) {
    return Object.freeze({ kind: "scene", sceneId: result.canvasPlacedSceneId });
  }
  const created = result.createdSceneIds[0];
  if (created !== undefined) {
    return Object.freeze({ kind: "scene", sceneId: created });
  }
  return Object.freeze({ kind: "book", bookId: result.bookId });
}

export function structureApplySuccessNavigationTarget(
  applyResult: StructureStoryWorkApplyResult
): StructureApplyNavigationTarget {
  return structureApplySuccessNavigationTargetFromResult(applyResult.result);
}

export type StructureCanvasPlacementAcknowledgment = Readonly<{
  sceneId: SceneId;
  canvasObjectId?: CanvasObjectId;
  label: string;
}>;

export function structureCanvasPlacementAcknowledgment(input: Readonly<{
  result: StructureStoryWorkAppliedResult;
  sceneTitle?: (sceneId: SceneId) => string | undefined;
}>): StructureCanvasPlacementAcknowledgment | undefined {
  if (input.result.canvasPlacedSceneId === undefined) return undefined;
  return Object.freeze({
    sceneId: input.result.canvasPlacedSceneId,
    ...(input.result.canvasObjectId === undefined
      ? {}
      : { canvasObjectId: input.result.canvasObjectId }),
    label:
      input.sceneTitle?.(input.result.canvasPlacedSceneId) ??
      "Canvas card"
  });
}

export type StructureStoryWorkAppliedPresentation = Readonly<{
  appliedProjectVersion: number;
  bookId: BookId;
  firstCreatedSceneId?: SceneId;
  canvasPlacedSceneId?: SceneId;
  canvasObjectId?: CanvasObjectId;
  canvasPlacedSceneLabel?: string;
}>;

export function structureStoryWorkAppliedPresentationFromResult(input: Readonly<{
  result: StructureStoryWorkAppliedResult;
  sceneTitle?: (sceneId: SceneId) => string | undefined;
}>): StructureStoryWorkAppliedPresentation {
  const placement = structureCanvasPlacementAcknowledgment(input);
  return Object.freeze({
    appliedProjectVersion: input.result.projectVersion,
    bookId: input.result.bookId,
    ...(input.result.createdSceneIds[0] === undefined
      ? {}
      : { firstCreatedSceneId: input.result.createdSceneIds[0] }),
    ...(placement === undefined
      ? {}
      : {
          canvasPlacedSceneId: placement.sceneId,
          ...(placement.canvasObjectId === undefined
            ? {}
            : { canvasObjectId: placement.canvasObjectId }),
          canvasPlacedSceneLabel: placement.label
        })
  });
}

export function outlineStoryWorkStructureResult(
  assignment: StoryWorkAssignment
): StructureStoryWorkAppliedResult | undefined {
  if (assignment.taskKind !== "outline") return undefined;
  const result = assignment.results.find((entry) => entry.kind === "story-structure");
  return result?.kind === "story-structure" ? result : undefined;
}

export function structureStoryWorkAppliedPresentationFromAssignment(input: Readonly<{
  assignment: StoryWorkAssignment;
  sceneTitle?: (sceneId: SceneId) => string | undefined;
}>): StructureStoryWorkAppliedPresentation | undefined {
  const result = outlineStoryWorkStructureResult(input.assignment);
  if (result === undefined) return undefined;
  return structureStoryWorkAppliedPresentationFromResult({
    result,
    sceneTitle: input.sceneTitle
  });
}

export function structureStoryWorkAppliedPresentationFromApply(input: Readonly<{
  applyResult: StructureStoryWorkApplyResult;
  sceneTitle?: (sceneId: SceneId) => string | undefined;
}>): StructureStoryWorkAppliedPresentation {
  return structureStoryWorkAppliedPresentationFromResult({
    result: input.applyResult.result,
    sceneTitle: input.sceneTitle
  });
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
