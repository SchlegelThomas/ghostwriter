import type { AsyncHashPort, InstructionContentHash } from "./agent-domain.js";
import {
  DomainValidationError,
  defineProjectRecords,
  type Book,
  type BookId,
  type ChapterId,
  type PartId,
  type ProjectId,
  type ProjectRecords,
  type SceneId
} from "./domain.js";
import type { AgentProposalId } from "./domain.js";
import {
  ProjectCommandError,
  applyProjectCommandToRecords,
  type ProjectCommand
} from "./project-commands.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";
import type { SceneDocumentHead } from "./scene-documents.js";
import { buildCurrentStoryAssessmentRevisionVector } from "./story-assessment-freshness.js";
import {
  validateStoryCheckFindingsV1,
  type StoryCheckFindingsV1
} from "./story-check-findings-v1.js";
import { evaluateStoredStoryCheckPayloadFreshness } from "./story-check-review.js";
import {
  storyContextFromProjectRecords,
  type StoryContextBeatProjection,
  type StoryContextProjection
} from "./story-context.js";
import {
  buildStoryStructureDependencyMap,
  validateStoryStructureOperationSelection,
  type StoryStructureSelectionValidation
} from "./story-structure-operation-graph.js";
import {
  STORY_STRUCTURE_SCHEMA_ID,
  validateStoryStructureProposalV1,
  type StoryStructureOperation,
  type StoryStructureOperationId,
  type StoryStructureProposalV1
} from "./story-structure-proposal-v1.js";
import type { StoryWorkAssignmentId } from "./story-work-assignment.js";

export type StoryStructurePreviewRefusalCode =
  | "EMPTY_SELECTION"
  | "UNKNOWN_OPERATION"
  | "MISSING_REQUIREMENTS"
  | "STALE_PROJECT_VERSION"
  | "PROPOSAL_SCOPE_MISMATCH"
  | "INACTIVE_PROJECT"
  | "INACTIVE_BOOK"
  | "INVALID_PROPOSAL"
  | "COMMAND_REFUSED";

export type StoryStructurePreviewKnownCheck = Readonly<{
  assignmentId: StoryWorkAssignmentId;
  artifactId: AgentProposalId;
  findings: StoryCheckFindingsV1;
  currentProposalDraftContentHash?: InstructionContentHash;
}>;

export type StructurePreviewOperationIdGenerator = Readonly<{
  ids: IdGenerator;
  assertReservedIdsFullyConsumed(): void;
}>;

export type StoryStructureEmptyGenesisDescriptor = Readonly<{
  projectId: ProjectId;
  sceneId: SceneId;
}>;

export type StoryStructurePartChapterOrder = Readonly<{
  partId: PartId;
  chapterIds: readonly ChapterId[];
}>;

export type StoryStructureNarrativeAnchorImpact = Readonly<{
  beatId: StoryContextBeatProjection["id"];
  threadId: StoryContextBeatProjection["threadId"];
  sceneId: SceneId;
  before: Readonly<{
    anchorState: StoryContextBeatProjection["anchorState"];
    canonicalIndex: number;
    sceneArchived: boolean;
  }>;
  after: Readonly<{
    anchorState: StoryContextBeatProjection["anchorState"];
    canonicalIndex: number;
    sceneArchived: boolean;
  }>;
}>;

export type StoryStructureCheckStalenessImpact = Readonly<{
  assignmentId: StoryWorkAssignmentId;
  artifactId: AgentProposalId;
  reasons: Readonly<
    NonNullable<
      Extract<
        ReturnType<typeof evaluateStoredStoryCheckPayloadFreshness>,
        { status: "needs-recheck" }
      >["reasons"]
    >
  >;
}>;

export type StoryStructurePreview = Readonly<{
  resolvedOperationIds: readonly StoryStructureOperationId[];
  manuscriptSceneOrderBefore: readonly SceneId[];
  manuscriptSceneOrderAfter: readonly SceneId[];
  chapterOrderBefore: readonly StoryStructurePartChapterOrder[];
  chapterOrderAfter: readonly StoryStructurePartChapterOrder[];
  createdPartIds: readonly PartId[];
  createdChapterIds: readonly ChapterId[];
  createdSceneIds: readonly SceneId[];
  updatedSceneIds: readonly SceneId[];
  movedSceneIds: readonly SceneId[];
  archivedSceneIds: readonly SceneId[];
  restoredSceneIds: readonly SceneId[];
  emptyGenesisDescriptors: readonly StoryStructureEmptyGenesisDescriptor[];
  projectVersionBefore: number;
  projectVersionAfter: number;
  narrativeAnchorImpacts: readonly StoryStructureNarrativeAnchorImpact[];
  newlyStaleChecks: readonly StoryStructureCheckStalenessImpact[];
  canvasEffect: "unchanged-unless-explicitly-placed";
}>;

export type StoryStructurePreviewRefusal = Readonly<{
  ok: false;
  code: StoryStructurePreviewRefusalCode;
  message: string;
  missingRequired?: readonly StoryStructureOperationId[];
}>;

export type StoryStructurePreviewResult = Readonly<
  | { ok: true; preview: StoryStructurePreview }
  | StoryStructurePreviewRefusal
>;

export type StoryStructurePrepareSuccess = Readonly<{
  ok: true;
  preview: StoryStructurePreview;
  nextRecords: ProjectRecords;
}>;

export type StoryStructurePrepareResult = Readonly<
  StoryStructurePrepareSuccess | StoryStructurePreviewRefusal
>;

export type StoryStructurePreviewInput = Readonly<{
  records: ProjectRecords;
  proposal: StoryStructureProposalV1;
  selectedOperationIds: readonly StoryStructureOperationId[];
  now: string;
  knownChecks?: readonly StoryStructurePreviewKnownCheck[];
  sceneDocumentHeads?: ReadonlyMap<SceneId, SceneDocumentHead>;
  hashPort?: AsyncHashPort;
}>;

function cloneProjectRecordsForPreview(records: ProjectRecords): ProjectRecords {
  return defineProjectRecords(structuredClone(records) as ProjectRecords);
}

function sealStoryStructurePreview(preview: StoryStructurePreview): StoryStructurePreview {
  return Object.freeze({
    ...preview,
    resolvedOperationIds: Object.freeze([...preview.resolvedOperationIds]),
    manuscriptSceneOrderBefore: Object.freeze([...preview.manuscriptSceneOrderBefore]),
    manuscriptSceneOrderAfter: Object.freeze([...preview.manuscriptSceneOrderAfter]),
    chapterOrderBefore: Object.freeze(
      preview.chapterOrderBefore.map((entry) =>
        Object.freeze({
          partId: entry.partId,
          chapterIds: Object.freeze([...entry.chapterIds])
        })
      )
    ),
    chapterOrderAfter: Object.freeze(
      preview.chapterOrderAfter.map((entry) =>
        Object.freeze({
          partId: entry.partId,
          chapterIds: Object.freeze([...entry.chapterIds])
        })
      )
    ),
    createdPartIds: Object.freeze([...preview.createdPartIds]),
    createdChapterIds: Object.freeze([...preview.createdChapterIds]),
    createdSceneIds: Object.freeze([...preview.createdSceneIds]),
    updatedSceneIds: Object.freeze([...preview.updatedSceneIds]),
    movedSceneIds: Object.freeze([...preview.movedSceneIds]),
    archivedSceneIds: Object.freeze([...preview.archivedSceneIds]),
    restoredSceneIds: Object.freeze([...preview.restoredSceneIds]),
    emptyGenesisDescriptors: Object.freeze(
      preview.emptyGenesisDescriptors.map((descriptor) => Object.freeze({ ...descriptor }))
    ),
    narrativeAnchorImpacts: Object.freeze(
      preview.narrativeAnchorImpacts.map((impact) => Object.freeze({ ...impact }))
    ),
    newlyStaleChecks: Object.freeze(
      preview.newlyStaleChecks.map((impact) => Object.freeze({ ...impact }))
    )
  });
}

function refusal(
  code: StoryStructurePreviewRefusalCode,
  message: string,
  missingRequired?: readonly StoryStructureOperationId[]
): StoryStructurePreviewRefusal {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(missingRequired === undefined ? {} : { missingRequired: Object.freeze(missingRequired) })
  });
}

function selectionRefusal(
  validation: Extract<StoryStructureSelectionValidation, { ok: false }>
): StoryStructurePreviewRefusal {
  return refusal(validation.code, "Structure preview selection is invalid.", validation.missingRequired);
}

function requireActiveBook(records: ProjectRecords, bookId: BookId): Book {
  const book = records.books.find((candidate) => candidate.id === bookId);
  if (book === undefined || book.projectId !== records.project.id) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      `Structure preview cannot resolve book "${bookId}".`
    );
  }
  if (book.archivedAt !== undefined) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Structure preview cannot target an archived book."
    );
  }
  return book;
}

function manuscriptSnapshot(
  records: ProjectRecords,
  bookId: BookId
): Readonly<{
  sceneOrder: readonly SceneId[];
  chapterOrder: readonly StoryStructurePartChapterOrder[];
}> {
  const book = requireActiveBook(records, bookId);
  const sceneOrder: SceneId[] = [];
  const chapterOrder = book.manuscript.parts.map((part) =>
    Object.freeze({
      partId: part.id,
      chapterIds: Object.freeze(part.chapters.map((chapter) => chapter.id))
    })
  );
  for (const part of book.manuscript.parts) {
    for (const chapter of part.chapters) {
      sceneOrder.push(...chapter.sceneIds);
    }
  }
  sceneOrder.push(...book.manuscript.unassignedSceneIds);
  return Object.freeze({
    sceneOrder: Object.freeze(sceneOrder),
    chapterOrder: Object.freeze(chapterOrder)
  });
}

export function createStructurePreviewOperationIdGenerator(
  operation: StoryStructureOperation
): StructurePreviewOperationIdGenerator {
  const reserved = new Map<DomainIdKind, readonly string[]>();
  switch (operation.type) {
    case "part.create":
      reserved.set("part", [operation.partId]);
      break;
    case "chapter.create":
      reserved.set("chapter", [operation.chapterId]);
      break;
    case "scene.createPlanned":
      reserved.set("scene", [operation.sceneId]);
      break;
    default:
      break;
  }
  const cursors = new Map<DomainIdKind, number>();
  const ids: IdGenerator = Object.freeze({
    create(kind: DomainIdKind): string {
      const list = reserved.get(kind);
      const index = cursors.get(kind) ?? 0;
      if (list === undefined || index >= list.length) {
        throw new DomainValidationError(
          "INVALID_AGENT_OUTPUT",
          `Structure preview attempted unexpected ${kind} id allocation for operation "${operation.operationId}".`
        );
      }
      cursors.set(kind, index + 1);
      return list[index]!;
    }
  });
  return Object.freeze({
    ids,
    assertReservedIdsFullyConsumed(): void {
      for (const [kind, expectedIds] of reserved) {
        const consumed = cursors.get(kind) ?? 0;
        if (consumed !== expectedIds.length) {
          throw new DomainValidationError(
            "INVALID_AGENT_OUTPUT",
            `Structure preview did not consume reserved ${kind} id for operation "${operation.operationId}".`
          );
        }
      }
    }
  });
}

type StoryStructurePreviewKnownChecksValidation =
  | readonly StoryStructurePreviewKnownCheck[]
  | Extract<StoryStructurePreviewResult, { ok: false }>;

function validateKnownChecksForPreview(
  knownChecks: readonly StoryStructurePreviewKnownCheck[],
  projectId: ProjectId
): StoryStructurePreviewKnownChecksValidation {
  const validated: StoryStructurePreviewKnownCheck[] = [];
  for (const check of knownChecks) {
    let findings: StoryCheckFindingsV1;
    try {
      findings = validateStoryCheckFindingsV1(check.findings);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Structure preview known check payload is invalid.";
      return refusal("INVALID_PROPOSAL", message) as Extract<
        StoryStructurePreviewResult,
        { ok: false }
      >;
    }
    if (findings.target.projectId !== projectId) {
      return refusal(
        "PROPOSAL_SCOPE_MISMATCH",
        "Structure preview known check project does not match the preview project."
      ) as Extract<StoryStructurePreviewResult, { ok: false }>;
    }
    validated.push(
      Object.freeze({
        assignmentId: check.assignmentId,
        artifactId: check.artifactId,
        findings,
        ...(check.currentProposalDraftContentHash === undefined
          ? {}
          : { currentProposalDraftContentHash: check.currentProposalDraftContentHash })
      })
    );
  }
  return Object.freeze(validated);
}

function lowerStructureOperationToCommands(
  operation: StoryStructureOperation
): readonly ProjectCommand[] {
  switch (operation.type) {
    case "part.create":
      return Object.freeze([
        Object.freeze({
          type: "part.create",
          bookId: operation.bookId,
          title: operation.title
        })
      ]);
    case "chapter.create": {
      const commands: ProjectCommand[] = [
        Object.freeze({
          type: "chapter.create",
          bookId: operation.bookId,
          partId: operation.partId,
          title: operation.title
        })
      ];
      if (operation.objective !== undefined) {
        commands.push(
          Object.freeze({
            type: "chapter.update",
            bookId: operation.bookId,
            partId: operation.partId,
            chapterId: operation.chapterId,
            summary: operation.objective
          })
        );
      }
      return Object.freeze(commands);
    }
    case "chapter.update":
      return Object.freeze([
        Object.freeze({
          type: "chapter.update",
          bookId: operation.bookId,
          partId: operation.partId,
          chapterId: operation.chapterId,
          summary: operation.objective
        })
      ]);
    case "chapter.reorder":
      return Object.freeze([
        Object.freeze({
          type: "chapter.reorder",
          bookId: operation.bookId,
          partId: operation.partId,
          chapterIds: operation.chapterIds
        })
      ]);
    case "scene.createPlanned":
      return Object.freeze([
        Object.freeze({
          type: "scene.create",
          bookId: operation.bookId,
          title: operation.title,
          ...(operation.chapterId === undefined ? {} : { chapterId: operation.chapterId }),
          ...(operation.position === undefined ? {} : { position: operation.position })
        })
      ]);
    case "scene.updateIntent":
      return Object.freeze([
        Object.freeze({
          type: "scene.updateIntent",
          sceneId: operation.sceneId,
          patch: operation.patch
        })
      ]);
    case "scene.move":
      return Object.freeze([
        Object.freeze({
          type: "scene.move",
          sceneId: operation.sceneId,
          bookId: operation.bookId,
          ...(operation.chapterId === undefined ? {} : { chapterId: operation.chapterId }),
          position: operation.position
        })
      ]);
    case "scene.setArchived":
      return Object.freeze([
        Object.freeze({
          type: "scene.setArchived",
          sceneId: operation.sceneId,
          archived: operation.archived
        })
      ]);
  }
}

function resolveSelectedOperationOrder(input: Readonly<{
  operations: readonly StoryStructureOperation[];
  dependencies: StoryStructureProposalV1["dependencies"];
  selectedOperationIds: readonly StoryStructureOperationId[];
}>): readonly StoryStructureOperation[] {
  const selected = new Set(input.selectedOperationIds);
  const proposalIndex = new Map(
    input.operations.map((operation, index) => [operation.operationId, index])
  );
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation])
  );
  const requiresMap = buildStoryStructureDependencyMap(input.dependencies);
  const selectedOperations = input.operations.filter((operation) =>
    selected.has(operation.operationId)
  );

  const inDegree = new Map<StoryStructureOperationId, number>();
  const dependents = new Map<StoryStructureOperationId, StoryStructureOperationId[]>();
  for (const operation of selectedOperations) {
    inDegree.set(operation.operationId, 0);
    dependents.set(operation.operationId, []);
  }
  for (const operation of selectedOperations) {
    for (const required of requiresMap.get(operation.operationId) ?? []) {
      if (!selected.has(required)) continue;
      inDegree.set(operation.operationId, (inDegree.get(operation.operationId) ?? 0) + 1);
      dependents.get(required)?.push(operation.operationId);
    }
  }

  const ready = selectedOperations
    .filter((operation) => (inDegree.get(operation.operationId) ?? 0) === 0)
    .sort(
      (left, right) =>
        (proposalIndex.get(left.operationId) ?? 0) -
        (proposalIndex.get(right.operationId) ?? 0)
    );

  const ordered: StoryStructureOperation[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    ordered.push(current);
    for (const dependentId of dependents.get(current.operationId) ?? []) {
      const nextDegree = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        const dependent = operationById.get(dependentId);
        if (dependent !== undefined) {
          ready.push(dependent);
          ready.sort(
            (left, right) =>
              (proposalIndex.get(left.operationId) ?? 0) -
              (proposalIndex.get(right.operationId) ?? 0)
          );
        }
      }
    }
  }

  if (ordered.length !== selectedOperations.length) {
    throw new DomainValidationError(
      "INVALID_AGENT_OUTPUT",
      "Structure preview could not resolve selected operation order."
    );
  }
  return Object.freeze(ordered);
}

function beatSnapshot(beat: StoryContextBeatProjection): StoryStructureNarrativeAnchorImpact["before"] {
  return Object.freeze({
    anchorState: beat.anchorState,
    canonicalIndex: beat.canonicalIndex,
    sceneArchived: beat.sceneArchived
  });
}

function collectNarrativeAnchorImpacts(
  before: StoryContextProjection,
  after: StoryContextProjection
): readonly StoryStructureNarrativeAnchorImpact[] {
  const beforeBeats = new Map(
    before.threads
      .flatMap((thread) => thread.narrativeBeats)
      .map((beat) => [beat.id, beat] as const)
  );
  const impacts: StoryStructureNarrativeAnchorImpact[] = [];
  for (const beat of after.threads.flatMap((thread) => thread.narrativeBeats)) {
    const previous = beforeBeats.get(beat.id);
    if (previous === undefined) continue;
    const beforeValues = beatSnapshot(previous);
    const afterValues = beatSnapshot(beat);
    if (
      beforeValues.anchorState !== afterValues.anchorState ||
      beforeValues.canonicalIndex !== afterValues.canonicalIndex ||
      beforeValues.sceneArchived !== afterValues.sceneArchived
    ) {
      impacts.push(
        Object.freeze({
          beatId: beat.id,
          threadId: beat.threadId,
          sceneId: beat.sceneId,
          before: beforeValues,
          after: afterValues
        })
      );
    }
  }
  return Object.freeze(impacts);
}

function normalizeAtomicBatchVersion(
  records: ProjectRecords,
  baselineVersion: number
): ProjectRecords {
  return defineProjectRecords({
    project: { ...records.project, version: baselineVersion + 1 },
    books: records.books,
    scenes: records.scenes,
    storyKnowledge: records.storyKnowledge,
    editions: records.editions
  });
}

async function collectNewlyStaleChecks(input: Readonly<{
  beforeRecords: ProjectRecords;
  afterRecords: ProjectRecords;
  knownChecks: readonly StoryStructurePreviewKnownCheck[];
  sceneDocumentHeads: ReadonlyMap<SceneId, SceneDocumentHead>;
  hashPort: AsyncHashPort;
}>): Promise<readonly StoryStructureCheckStalenessImpact[]> {
  const impacts: StoryStructureCheckStalenessImpact[] = [];
  for (const check of input.knownChecks) {
    const beforeVector = await buildCurrentStoryAssessmentRevisionVector({
      assessed: check.findings.revisionVector,
      records: input.beforeRecords,
      sceneDocumentHeads: input.sceneDocumentHeads,
      hashPort: input.hashPort
    });
    const beforeFreshness = evaluateStoredStoryCheckPayloadFreshness({
      storedPayload: check.findings,
      currentRevisionVector: beforeVector,
      ...(check.currentProposalDraftContentHash === undefined
        ? {}
        : { currentProposalDraftContentHash: check.currentProposalDraftContentHash })
    });
    const afterVector = await buildCurrentStoryAssessmentRevisionVector({
      assessed: check.findings.revisionVector,
      records: input.afterRecords,
      sceneDocumentHeads: input.sceneDocumentHeads,
      hashPort: input.hashPort
    });
    const afterFreshness = evaluateStoredStoryCheckPayloadFreshness({
      storedPayload: check.findings,
      currentRevisionVector: afterVector,
      ...(check.currentProposalDraftContentHash === undefined
        ? {}
        : { currentProposalDraftContentHash: check.currentProposalDraftContentHash })
    });
    if (
      beforeFreshness.status === "fresh" &&
      afterFreshness.status === "needs-recheck"
    ) {
      impacts.push(
        Object.freeze({
          assignmentId: check.assignmentId,
          artifactId: check.artifactId,
          reasons: afterFreshness.reasons
        })
      );
    }
  }
  return Object.freeze(impacts);
}

/**
 * Pure structure batch preparation: validates selection, lowers trusted operations
 * through project commands, and returns preview impact plus atomic next records.
 */
export async function prepareStoryStructureProposal(
  input: StoryStructurePreviewInput
): Promise<StoryStructurePrepareResult> {
  let proposal: StoryStructureProposalV1;
  try {
    proposal = validateStoryStructureProposalV1(input.proposal);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Structure proposal payload is invalid.";
    return refusal("INVALID_PROPOSAL", message);
  }

  if (proposal.schemaId !== STORY_STRUCTURE_SCHEMA_ID) {
    return refusal("INVALID_PROPOSAL", "Structure proposal schema identifier is invalid.");
  }

  const records = cloneProjectRecordsForPreview(input.records);
  if (records.project.id !== proposal.projectId) {
    return refusal(
      "PROPOSAL_SCOPE_MISMATCH",
      "Structure preview proposal project does not match current records."
    );
  }
  if (records.project.archivedAt !== undefined) {
    return refusal("INACTIVE_PROJECT", "Structure preview cannot apply to an archived project.");
  }
  try {
    requireActiveBook(records, proposal.bookId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Structure preview book is unavailable.";
    return refusal("INACTIVE_BOOK", message);
  }

  if (records.project.version !== proposal.expectedProjectVersion) {
    return refusal(
      "STALE_PROJECT_VERSION",
      `Structure preview expected project version ${proposal.expectedProjectVersion} but current version is ${records.project.version}.`
    );
  }

  const selection = validateStoryStructureOperationSelection({
    operations: proposal.operations,
    dependencies: proposal.dependencies,
    selectedOperationIds: input.selectedOperationIds
  });
  if (!selection.ok) {
    return selectionRefusal(selection);
  }

  const baselineVersion = records.project.version;
  const beforeSnapshot = manuscriptSnapshot(records, proposal.bookId);
  let beforeContext: StoryContextProjection;
  try {
    beforeContext = storyContextFromProjectRecords(records, {
      scope: { kind: "project" }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Structure preview story context is unavailable.";
    return refusal("INVALID_PROPOSAL", message);
  }

  const orderedOperations = resolveSelectedOperationOrder({
    operations: proposal.operations,
    dependencies: proposal.dependencies,
    selectedOperationIds: input.selectedOperationIds
  });

  const knownChecksInput = input.knownChecks ?? [];
  let validatedKnownChecksEarly: readonly StoryStructurePreviewKnownCheck[] = Object.freeze(
    []
  );
  if (knownChecksInput.length > 0) {
    const knownChecksValidation = validateKnownChecksForPreview(
      knownChecksInput,
      proposal.projectId
    );
    if (!Array.isArray(knownChecksValidation)) {
      return knownChecksValidation as Extract<StoryStructurePreviewResult, { ok: false }>;
    }
    validatedKnownChecksEarly = knownChecksValidation;
  }

  const createdPartIds: PartId[] = [];
  const createdChapterIds: ChapterId[] = [];
  const createdSceneIds: SceneId[] = [];
  const updatedSceneIds = new Set<SceneId>();
  const movedSceneIds: SceneId[] = [];
  const archivedSceneIds: SceneId[] = [];
  const restoredSceneIds: SceneId[] = [];

  let working = defineProjectRecords({
    project: records.project,
    books: records.books,
    scenes: records.scenes,
    storyKnowledge: records.storyKnowledge,
    editions: records.editions
  });

  try {
    for (const operation of orderedOperations) {
      const commands = lowerStructureOperationToCommands(operation);
      const { ids, assertReservedIdsFullyConsumed } =
        createStructurePreviewOperationIdGenerator(operation);
      for (const command of commands) {
        working = applyProjectCommandToRecords(working, command, ids, input.now);
      }
      assertReservedIdsFullyConsumed();
      switch (operation.type) {
        case "part.create":
          createdPartIds.push(operation.partId);
          break;
        case "chapter.create":
          createdChapterIds.push(operation.chapterId);
          break;
        case "scene.createPlanned":
          createdSceneIds.push(operation.sceneId);
          break;
        case "scene.updateIntent":
          updatedSceneIds.add(operation.sceneId);
          break;
        case "scene.move":
          movedSceneIds.push(operation.sceneId);
          break;
        case "scene.setArchived":
          if (operation.archived) archivedSceneIds.push(operation.sceneId);
          else restoredSceneIds.push(operation.sceneId);
          break;
        default:
          break;
      }
    }
  } catch (error) {
    if (error instanceof ProjectCommandError) {
      return refusal("COMMAND_REFUSED", error.message);
    }
    if (error instanceof DomainValidationError) {
      return refusal("INVALID_PROPOSAL", error.message);
    }
    throw error;
  }

  const afterRecords = normalizeAtomicBatchVersion(working, baselineVersion);
  const afterSnapshot = manuscriptSnapshot(afterRecords, proposal.bookId);
  const afterContext = storyContextFromProjectRecords(afterRecords, {
    scope: { kind: "project" }
  });

  const sceneDocumentHeads = input.sceneDocumentHeads ?? new Map();
  const newlyStaleChecks =
    validatedKnownChecksEarly.length === 0 || input.hashPort === undefined
      ? Object.freeze([])
      : await collectNewlyStaleChecks({
          beforeRecords: records,
          afterRecords,
          knownChecks: validatedKnownChecksEarly,
          sceneDocumentHeads,
          hashPort: input.hashPort
        });

  const emptyGenesisDescriptors = Object.freeze(
    createdSceneIds.map((sceneIdValue) =>
      Object.freeze({
        projectId: proposal.projectId,
        sceneId: sceneIdValue
      })
    )
  );

  const preview = sealStoryStructurePreview({
    resolvedOperationIds: orderedOperations.map((operation) => operation.operationId),
    manuscriptSceneOrderBefore: beforeSnapshot.sceneOrder,
    manuscriptSceneOrderAfter: afterSnapshot.sceneOrder,
    chapterOrderBefore: beforeSnapshot.chapterOrder,
    chapterOrderAfter: afterSnapshot.chapterOrder,
    createdPartIds,
    createdChapterIds,
    createdSceneIds,
    updatedSceneIds: [...updatedSceneIds],
    movedSceneIds,
    archivedSceneIds,
    restoredSceneIds,
    emptyGenesisDescriptors,
    projectVersionBefore: baselineVersion,
    projectVersionAfter: baselineVersion + 1,
    narrativeAnchorImpacts: collectNarrativeAnchorImpacts(beforeContext, afterContext),
    newlyStaleChecks,
    canvasEffect: "unchanged-unless-explicitly-placed"
  });

  return Object.freeze({
    ok: true,
    preview,
    nextRecords: cloneProjectRecordsForPreview(afterRecords)
  });
}

/**
 * Public preview entrypoint: same validation and impact as preparation, without
 * exposing simulated next records.
 */
export async function previewStoryStructureProposal(
  input: StoryStructurePreviewInput
): Promise<StoryStructurePreviewResult> {
  const prepared = await prepareStoryStructureProposal(input);
  if (!prepared.ok) {
    return prepared;
  }
  return Object.freeze({
    ok: true,
    preview: prepared.preview
  });
}
