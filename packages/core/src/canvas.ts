import type { AccountId } from "./identity.js";
import {
  canvasLinkId,
  canvasObjectId,
  canvasRevisionId,
  DomainValidationError,
  validateProjectRecords,
  type BookId,
  type CanvasLinkId,
  type CanvasObjectId,
  type CanvasRevisionId,
  type ChapterId,
  type ProjectId,
  type ProjectRecords,
  type SceneId,
  type StoryKnowledgeId
} from "./domain.js";
import type { IdGenerator } from "./project-repository.js";

type BrandedString<Name extends string> = string & {
  readonly __brand: Name;
};

export type CanvasContentHash = BrandedString<"CanvasContentHash">;
export type CanvasAuthority = "confirmed" | "provisional";
export type CanvasObjectKind =
  | "scene-card"
  | "story-knowledge-card"
  | "note"
  | "region"
  | "image-reference";
export type CanvasLinkKind =
  | "pin"
  | "thread"
  | "beat"
  | "dependency"
  | "reference";
export type CanvasRevisionReason = "genesis" | "command" | "restore" | "undo";

export const CANVAS_MAX_COORDINATE = 1_000_000;
export const CANVAS_MAX_DIMENSION = 100_000;
export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_MAX_ZOOM = 8;
export const CANVAS_LABEL_MAX_LENGTH = 200;
export const CANVAS_SOURCE_KEY_MAX_LENGTH = 500;
export const CANVAS_PROVENANCE_MAX_LENGTH = 1_000;
export const CANVAS_NOTE_BODY_MAX_LENGTH = 20_000;

const OBJECT_KINDS = new Set<CanvasObjectKind>([
  "scene-card",
  "story-knowledge-card",
  "note",
  "region",
  "image-reference"
]);
const LINK_KINDS = new Set<CanvasLinkKind>([
  "pin",
  "thread",
  "beat",
  "dependency",
  "reference"
]);
const AUTHORITIES = new Set<CanvasAuthority>(["confirmed", "provisional"]);
const REVISION_REASONS = new Set<CanvasRevisionReason>([
  "genesis",
  "command",
  "restore",
  "undo"
]);
const COMMAND_TYPES = new Set<CanvasCommand["type"]>([
  "canvas.object.create",
  "canvas.object.place",
  "canvas.object.update",
  "canvas.object.move",
  "canvas.object.resize",
  "canvas.object.archive",
  "canvas.object.restore",
  "canvas.object.confirm",
  "canvas.object.dismiss",
  "canvas.link.create",
  "canvas.link.update",
  "canvas.link.archive",
  "canvas.link.restore",
  "canvas.link.confirm",
  "canvas.link.dismiss"
]);

export type CanvasNoteMetadata = Readonly<{
  body?: string;
  color?: string;
}>;

export type CanvasImageMetadata = Readonly<{
  assetId?: string;
  altText?: string;
  caption?: string;
  mimeType?: string;
}>;

export type CanvasObject = Readonly<{
  id: CanvasObjectId;
  projectId: ProjectId;
  kind: CanvasObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  parentRegionId?: CanvasObjectId;
  authority: CanvasAuthority;
  label: string;
  note?: CanvasNoteMetadata;
  image?: CanvasImageMetadata;
  sceneId?: SceneId;
  storyKnowledgeId?: StoryKnowledgeId;
  storyOrderHint?: number;
  sourceKey?: string;
  provenance?: string;
  archivedAt?: string;
  dismissedAt?: string;
}>;

export type CanvasLink = Readonly<{
  id: CanvasLinkId;
  projectId: ProjectId;
  kind: CanvasLinkKind;
  fromObjectId: CanvasObjectId;
  toObjectId: CanvasObjectId;
  authority: CanvasAuthority;
  label?: string;
  sourceKey?: string;
  provenance?: string;
  archivedAt?: string;
  dismissedAt?: string;
}>;

export type CanvasBoard = Readonly<{
  projectId: ProjectId;
  version: number;
  objects: readonly CanvasObject[];
  links: readonly CanvasLink[];
  createdAt: string;
  updatedAt: string;
}>;

export type CanvasRevision = Readonly<{
  id: CanvasRevisionId;
  projectId: ProjectId;
  boardVersion: number;
  contentHash: CanvasContentHash;
  snapshot: CanvasBoard;
  actorAccountId: AccountId;
  reason: CanvasRevisionReason;
  commandType?: CanvasCommand["type"];
  parentRevisionId?: CanvasRevisionId;
  createdAt: string;
}>;

export type CanvasRevisionMetadata = Omit<CanvasRevision, "snapshot">;

export type CanvasViewportPreference = Readonly<{
  projectId: ProjectId;
  accountId: AccountId;
  x: number;
  y: number;
  zoom: number;
  selectedObjectId?: CanvasObjectId;
  updatedAt: string;
}>;

export type CanvasObjectDraft = Omit<
  CanvasObject,
  "id" | "projectId" | "archivedAt" | "dismissedAt"
>;
export type CanvasLinkDraft = Omit<
  CanvasLink,
  "id" | "projectId" | "archivedAt" | "dismissedAt"
>;

export type CanvasObjectUpdate = Readonly<{
  label?: string;
  z?: number;
  parentRegionId?: CanvasObjectId | null;
  note?: CanvasNoteMetadata | null;
  image?: CanvasImageMetadata | null;
  storyOrderHint?: number | null;
  sourceKey?: string | null;
  provenance?: string | null;
}>;

export type CanvasLinkUpdate = Readonly<{
  label?: string | null;
  sourceKey?: string | null;
  provenance?: string | null;
}>;

export type CanvasCommand =
  | Readonly<{
      type: "canvas.object.create" | "canvas.object.place";
      object: CanvasObjectDraft;
    }>
  | Readonly<{
      type: "canvas.object.update";
      objectId: CanvasObjectId;
      changes: CanvasObjectUpdate;
    }>
  | Readonly<{
      type: "canvas.object.move";
      objectId: CanvasObjectId;
      x: number;
      y: number;
      parentRegionId?: CanvasObjectId | null;
    }>
  | Readonly<{
      type: "canvas.object.resize";
      objectId: CanvasObjectId;
      width: number;
      height: number;
    }>
  | Readonly<{
      type:
        | "canvas.object.archive"
        | "canvas.object.restore"
        | "canvas.object.confirm"
        | "canvas.object.dismiss";
      objectId: CanvasObjectId;
    }>
  | Readonly<{
      type: "canvas.link.create";
      link: CanvasLinkDraft;
    }>
  | Readonly<{
      type: "canvas.link.update";
      linkId: CanvasLinkId;
      changes: CanvasLinkUpdate;
    }>
  | Readonly<{
      type:
        | "canvas.link.archive"
        | "canvas.link.restore"
        | "canvas.link.confirm"
        | "canvas.link.dismiss";
      linkId: CanvasLinkId;
    }>;

export type CanvasMutationResult = Readonly<{
  board: CanvasBoard;
  revision: CanvasRevision;
}>;

export type CanvasSpineDrift =
  | "not-placed"
  | "no-hint"
  | "aligned"
  | "earlier-on-canvas"
  | "later-on-canvas";

export type CanvasSpineEntry = Readonly<{
  sceneId: SceneId;
  bookId: BookId;
  chapterId?: ChapterId;
  placement: "chapter" | "unassigned";
  canonicalIndex: number;
  canvasObjectId?: CanvasObjectId;
  storyOrderHint?: number;
  drift: CanvasSpineDrift;
  archived: boolean;
}>;

export type CanvasReadingOrderSpine = Readonly<{
  projectId: ProjectId;
  projectVersion: number;
  canvasVersion: number;
  entries: readonly CanvasSpineEntry[];
}>;

export type CanvasCommandCode =
  | "RECORD_NOT_FOUND"
  | "INVALID_AUTHORITY"
  | "ARCHIVED_RECORD"
  | "UNSAFE_ARCHIVE";

export class CanvasCommandError extends Error {
  readonly code: CanvasCommandCode;

  constructor(code: CanvasCommandCode, message: string) {
    super(message);
    this.name = "CanvasCommandError";
    this.code = code;
  }
}

export class CanvasVersionConflictError extends Error {
  readonly projectId: ProjectId;
  readonly expectedVersion: number;

  constructor(projectId: ProjectId, expectedVersion: number) {
    super("The Canvas changed since it was loaded.");
    this.name = "CanvasVersionConflictError";
    this.projectId = projectId;
    this.expectedVersion = expectedVersion;
  }
}

export class CanvasNotFoundError extends Error {
  constructor() {
    super("Canvas not found.");
    this.name = "CanvasNotFoundError";
  }
}

export class CanvasRevisionNotFoundError extends Error {
  constructor() {
    super("Canvas revision not found.");
    this.name = "CanvasRevisionNotFoundError";
  }
}

function requireText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }
  if (normalized.length > maximum) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      `${field} must contain at most ${maximum} characters.`
    );
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  field: string,
  maximum: number
): string | undefined {
  return value === undefined ? undefined : requireText(value, field, maximum);
}

function finiteBounded(
  value: number,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      `${field} must be finite and between ${minimum} and ${maximum}.`
    );
  }
  return value;
}

function positiveVersion(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${field} must be a positive integer.`
    );
  }
  return value;
}

function storyOrderHint(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > CANVAS_MAX_COORDINATE) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      `Canvas story-order hint must be an integer between 0 and ${CANVAS_MAX_COORDINATE}.`
    );
  }
  return value;
}

function requireAuthority(value: CanvasAuthority): CanvasAuthority {
  if (!AUTHORITIES.has(value)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Canvas authority must be confirmed or provisional."
    );
  }
  return value;
}

function noteMetadata(value: CanvasNoteMetadata): CanvasNoteMetadata {
  const body = optionalText(value.body, "Canvas note body", CANVAS_NOTE_BODY_MAX_LENGTH);
  const color = optionalText(value.color, "Canvas note color", 100);
  if (body === undefined && color === undefined) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Canvas note metadata must contain a body or color."
    );
  }
  return Object.freeze({
    ...(body === undefined ? {} : { body }),
    ...(color === undefined ? {} : { color })
  });
}

function imageMetadata(value: CanvasImageMetadata): CanvasImageMetadata {
  const assetId = optionalText(value.assetId, "Canvas image asset ID", 500);
  const altText = optionalText(value.altText, "Canvas image alternative text", 1_000);
  const caption = optionalText(value.caption, "Canvas image caption", 2_000);
  const mimeType = optionalText(value.mimeType, "Canvas image MIME type", 200);
  if (
    assetId === undefined &&
    altText === undefined &&
    caption === undefined &&
    mimeType === undefined
  ) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Canvas image metadata must contain at least one local metadata field."
    );
  }
  return Object.freeze({
    ...(assetId === undefined ? {} : { assetId }),
    ...(altText === undefined ? {} : { altText }),
    ...(caption === undefined ? {} : { caption }),
    ...(mimeType === undefined ? {} : { mimeType })
  });
}

function archiveFields(input: {
  archivedAt?: string;
  dismissedAt?: string;
}): Readonly<{ archivedAt?: string; dismissedAt?: string }> {
  const archivedAt = optionalText(input.archivedAt, "Canvas archive time", 100);
  const dismissedAt = optionalText(input.dismissedAt, "Canvas dismissal time", 100);
  if (dismissedAt !== undefined && archivedAt === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A dismissed Canvas record must remain archived."
    );
  }
  return {
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(dismissedAt === undefined ? {} : { dismissedAt })
  };
}

export function createCanvasObject(input: CanvasObject): CanvasObject {
  if (!OBJECT_KINDS.has(input.kind)) {
    throw new DomainValidationError("EMPTY_VALUE", "Canvas object kind is invalid.");
  }
  const sceneReferenceCount = input.sceneId === undefined ? 0 : 1;
  const knowledgeReferenceCount = input.storyKnowledgeId === undefined ? 0 : 1;
  if (
    (input.kind === "scene-card" &&
      (sceneReferenceCount !== 1 || knowledgeReferenceCount !== 0)) ||
    (input.kind === "story-knowledge-card" &&
      (knowledgeReferenceCount !== 1 || sceneReferenceCount !== 0)) ||
    (!["scene-card", "story-knowledge-card"].includes(input.kind) &&
      sceneReferenceCount + knowledgeReferenceCount !== 0)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A Canvas object must carry exactly the canonical reference required by its kind."
    );
  }
  if (input.storyOrderHint !== undefined && input.kind !== "scene-card") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Only a scene card may carry a Canvas story-order hint."
    );
  }
  if (input.note !== undefined && input.kind !== "note") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Only a note object may carry note metadata."
    );
  }
  if (input.image !== undefined && input.kind !== "image-reference") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Only an image-reference object may carry image metadata."
    );
  }

  const sourceKey = optionalText(
    input.sourceKey,
    "Canvas object source key",
    CANVAS_SOURCE_KEY_MAX_LENGTH
  );
  const provenance = optionalText(
    input.provenance,
    "Canvas object provenance",
    CANVAS_PROVENANCE_MAX_LENGTH
  );
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    x: finiteBounded(
      input.x,
      "Canvas object x",
      -CANVAS_MAX_COORDINATE,
      CANVAS_MAX_COORDINATE
    ),
    y: finiteBounded(
      input.y,
      "Canvas object y",
      -CANVAS_MAX_COORDINATE,
      CANVAS_MAX_COORDINATE
    ),
    width: finiteBounded(
      input.width,
      "Canvas object width",
      1,
      CANVAS_MAX_DIMENSION
    ),
    height: finiteBounded(
      input.height,
      "Canvas object height",
      1,
      CANVAS_MAX_DIMENSION
    ),
    z: finiteBounded(
      input.z,
      "Canvas object z-order",
      -CANVAS_MAX_COORDINATE,
      CANVAS_MAX_COORDINATE
    ),
    ...(input.parentRegionId === undefined
      ? {}
      : { parentRegionId: input.parentRegionId }),
    authority: requireAuthority(input.authority),
    label: requireText(input.label, "Canvas object label", CANVAS_LABEL_MAX_LENGTH),
    ...(input.note === undefined ? {} : { note: noteMetadata(input.note) }),
    ...(input.image === undefined ? {} : { image: imageMetadata(input.image) }),
    ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
    ...(input.storyKnowledgeId === undefined
      ? {}
      : { storyKnowledgeId: input.storyKnowledgeId }),
    ...(input.storyOrderHint === undefined
      ? {}
      : { storyOrderHint: storyOrderHint(input.storyOrderHint) }),
    ...(sourceKey === undefined ? {} : { sourceKey }),
    ...(provenance === undefined ? {} : { provenance }),
    ...archiveFields(input)
  });
}

export function createCanvasLink(input: CanvasLink): CanvasLink {
  if (!LINK_KINDS.has(input.kind)) {
    throw new DomainValidationError("EMPTY_VALUE", "Canvas link kind is invalid.");
  }
  if (input.fromObjectId === input.toObjectId) {
    throw new DomainValidationError(
      "DUPLICATE_REFERENCE",
      "A Canvas object cannot link to itself."
    );
  }
  const label = optionalText(input.label, "Canvas link label", CANVAS_LABEL_MAX_LENGTH);
  const sourceKey = optionalText(
    input.sourceKey,
    "Canvas link source key",
    CANVAS_SOURCE_KEY_MAX_LENGTH
  );
  const provenance = optionalText(
    input.provenance,
    "Canvas link provenance",
    CANVAS_PROVENANCE_MAX_LENGTH
  );
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    fromObjectId: input.fromObjectId,
    toObjectId: input.toObjectId,
    authority: requireAuthority(input.authority),
    ...(label === undefined ? {} : { label }),
    ...(sourceKey === undefined ? {} : { sourceKey }),
    ...(provenance === undefined ? {} : { provenance }),
    ...archiveFields(input)
  });
}

function active(value: { archivedAt?: string }): boolean {
  return value.archivedAt === undefined;
}

function validateBoardInternals(board: CanvasBoard): void {
  const objectById = new Map<CanvasObjectId, CanvasObject>();
  const allIds = new Set<string>();
  const canonicalCards = new Set<string>();
  const objectSources = new Set<string>();

  for (const object of board.objects) {
    if (object.projectId !== board.projectId) {
      throw new DomainValidationError(
        "CROSS_PROJECT_REFERENCE",
        `Canvas object "${object.id}" belongs to another project.`
      );
    }
    if (allIds.has(object.id)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `Canvas contains duplicate ID "${object.id}".`
      );
    }
    allIds.add(object.id);
    objectById.set(object.id, object);

    if (active(object)) {
      const canonicalKey =
        object.kind === "scene-card"
          ? `scene:${object.sceneId}`
          : object.kind === "story-knowledge-card"
            ? `knowledge:${object.storyKnowledgeId}`
            : undefined;
      if (canonicalKey !== undefined) {
        if (canonicalCards.has(canonicalKey)) {
          throw new DomainValidationError(
            "DUPLICATE_REFERENCE",
            "Canvas cannot contain duplicate active cards for one canonical record."
          );
        }
        canonicalCards.add(canonicalKey);
      }
    }
    if (object.sourceKey !== undefined) {
      const sourceKey = `${object.kind}:${object.sourceKey}`;
      if (objectSources.has(sourceKey)) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          "Canvas object source keys must remain unique, including dismissed suggestions."
        );
      }
      objectSources.add(sourceKey);
    }
  }

  for (const object of board.objects) {
    if (object.parentRegionId === undefined) continue;
    if (object.parentRegionId === object.id) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        "A Canvas object cannot be its own parent region."
      );
    }
    const region = objectById.get(object.parentRegionId);
    if (region === undefined || region.kind !== "region") {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Canvas object "${object.id}" references an unknown region.`
      );
    }
    if (active(object) && !active(region)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Active Canvas object "${object.id}" cannot belong to an archived region.`
      );
    }
  }

  const equivalentLinks = new Set<string>();
  const linkSources = new Set<string>();
  for (const link of board.links) {
    if (link.projectId !== board.projectId) {
      throw new DomainValidationError(
        "CROSS_PROJECT_REFERENCE",
        `Canvas link "${link.id}" belongs to another project.`
      );
    }
    if (allIds.has(link.id)) {
      throw new DomainValidationError(
        "DUPLICATE_ID",
        `Canvas contains duplicate ID "${link.id}".`
      );
    }
    allIds.add(link.id);
    if (
      !objectById.has(link.fromObjectId) ||
      !objectById.has(link.toObjectId)
    ) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Canvas link "${link.id}" has a dangling object reference.`
      );
    }
    if (active(link)) {
      const equivalent = `${link.kind}:${link.fromObjectId}:${link.toObjectId}`;
      if (equivalentLinks.has(equivalent)) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          "Canvas cannot contain duplicate active equivalent links."
        );
      }
      equivalentLinks.add(equivalent);
    }
    if (link.sourceKey !== undefined) {
      const sourceKey = `${link.kind}:${link.sourceKey}`;
      if (linkSources.has(sourceKey)) {
        throw new DomainValidationError(
          "DUPLICATE_REFERENCE",
          "Canvas link source keys must remain unique, including dismissed suggestions."
        );
      }
      linkSources.add(sourceKey);
    }
  }
}

export function createCanvasBoard(input: CanvasBoard): CanvasBoard {
  const board = Object.freeze({
    projectId: input.projectId,
    version: positiveVersion(input.version, "Canvas version"),
    objects: Object.freeze(
      input.objects.map(createCanvasObject).sort((left, right) =>
        left.id.localeCompare(right.id)
      )
    ),
    links: Object.freeze(
      input.links.map(createCanvasLink).sort((left, right) =>
        left.id.localeCompare(right.id)
      )
    ),
    createdAt: requireText(input.createdAt, "Canvas creation time", 100),
    updatedAt: requireText(input.updatedAt, "Canvas update time", 100)
  });
  validateBoardInternals(board);
  return board;
}

export function validateCanvasBoardReferences(
  board: CanvasBoard,
  records: ProjectRecords
): void {
  validateProjectRecords(records);
  if (board.projectId !== records.project.id) {
    throw new DomainValidationError(
      "CROSS_PROJECT_REFERENCE",
      "Canvas and project records belong to different projects."
    );
  }
  const sceneById = new Map(records.scenes.map((scene) => [scene.id, scene]));
  const knowledgeById = new Map(
    records.storyKnowledge.map((knowledge) => [knowledge.id, knowledge])
  );
  for (const object of board.objects) {
    if (object.sceneId !== undefined) {
      const scene = sceneById.get(object.sceneId);
      if (scene === undefined || scene.projectId !== board.projectId) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Canvas object "${object.id}" references an unknown scene.`
        );
      }
    }
    if (object.storyKnowledgeId !== undefined) {
      const knowledge = knowledgeById.get(object.storyKnowledgeId);
      if (knowledge === undefined || knowledge.projectId !== board.projectId) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Canvas object "${object.id}" references unknown story knowledge.`
        );
      }
    }
  }
}

export function canvasContentHash(value: string): CanvasContentHash {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Canvas content hash must be a SHA-256 digest."
    );
  }
  return normalized as CanvasContentHash;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical Canvas JSON cannot contain non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical Canvas JSON received a non-JSON value.");
}

export async function hashCanvasBoard(board: CanvasBoard): Promise<CanvasContentHash> {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.subtle === undefined) {
    throw new Error("A Web Crypto implementation is required to hash Canvas snapshots.");
  }
  const canonical = canonicalJson(createCanvasBoard(board));
  const digest = await cryptoProvider.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  return canvasContentHash(
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  );
}

export function createCanvasRevision(input: CanvasRevision): CanvasRevision {
  const snapshot = createCanvasBoard(input.snapshot);
  if (
    snapshot.projectId !== input.projectId ||
    snapshot.version !== input.boardVersion
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Canvas revision metadata must match its snapshot."
    );
  }
  const contentHash = canvasContentHash(input.contentHash);
  if (input.id !== canvasRevisionId(`canvas_revision_${contentHash}`)) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Canvas revision ID must be derived from its snapshot content hash."
    );
  }
  if (!REVISION_REASONS.has(input.reason)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Canvas revision reason is invalid."
    );
  }
  if (
    (input.reason === "command" &&
      (input.commandType === undefined ||
        !COMMAND_TYPES.has(input.commandType))) ||
    (input.reason !== "command" && input.commandType !== undefined)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Only a Canvas command revision may name a valid command type."
    );
  }
  return Object.freeze({
    id: input.id,
    projectId: input.projectId,
    boardVersion: positiveVersion(input.boardVersion, "Canvas revision version"),
    contentHash,
    snapshot,
    actorAccountId: input.actorAccountId,
    reason: input.reason,
    ...(input.commandType === undefined ? {} : { commandType: input.commandType }),
    ...(input.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: input.parentRevisionId }),
    createdAt: requireText(input.createdAt, "Canvas revision creation time", 100)
  });
}

export function canvasRevisionMetadata(
  revision: CanvasRevision
): CanvasRevisionMetadata {
  const { snapshot: _snapshot, ...metadata } = createCanvasRevision(revision);
  return Object.freeze(metadata);
}

async function snapshotRevision(input: {
  board: CanvasBoard;
  actorAccountId: AccountId;
  reason: CanvasRevisionReason;
  commandType?: CanvasCommand["type"];
  parentRevisionId?: CanvasRevisionId;
  createdAt: string;
}): Promise<CanvasRevision> {
  const contentHash = await hashCanvasBoard(input.board);
  return createCanvasRevision({
    id: canvasRevisionId(`canvas_revision_${contentHash}`),
    projectId: input.board.projectId,
    boardVersion: input.board.version,
    contentHash,
    snapshot: input.board,
    actorAccountId: input.actorAccountId,
    reason: input.reason,
    ...(input.commandType === undefined ? {} : { commandType: input.commandType }),
    ...(input.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: input.parentRevisionId }),
    createdAt: input.createdAt
  });
}

export async function createInitialCanvas(input: {
  projectId: ProjectId;
  actorAccountId: AccountId;
  now: string;
}): Promise<CanvasMutationResult> {
  const board = createCanvasBoard({
    projectId: input.projectId,
    version: 1,
    objects: [],
    links: [],
    createdAt: input.now,
    updatedAt: input.now
  });
  return Object.freeze({
    board,
    revision: await snapshotRevision({
      board,
      actorAccountId: input.actorAccountId,
      reason: "genesis",
      createdAt: input.now
    })
  });
}

function requiredObject(
  objects: readonly CanvasObject[],
  id: CanvasObjectId
): CanvasObject {
  const object = objects.find((candidate) => candidate.id === id);
  if (object === undefined) {
    throw new CanvasCommandError("RECORD_NOT_FOUND", "Canvas object not found.");
  }
  return object;
}

function requiredLink(links: readonly CanvasLink[], id: CanvasLinkId): CanvasLink {
  const link = links.find((candidate) => candidate.id === id);
  if (link === undefined) {
    throw new CanvasCommandError("RECORD_NOT_FOUND", "Canvas link not found.");
  }
  return link;
}

function requireActiveRecord(value: { archivedAt?: string }, label: string): void {
  if (!active(value)) {
    throw new CanvasCommandError(
      "ARCHIVED_RECORD",
      `${label} must be restored before it can be changed.`
    );
  }
}

function withoutArchive<T extends { archivedAt?: string; dismissedAt?: string }>(
  value: T
): Omit<T, "archivedAt" | "dismissedAt"> {
  const {
    archivedAt: _archivedAt,
    dismissedAt: _dismissedAt,
    ...rest
  } = value;
  return rest;
}

function setOptionalObjectField(
  current: CanvasObject,
  field: keyof Pick<
    CanvasObject,
    | "parentRegionId"
    | "note"
    | "image"
    | "storyOrderHint"
    | "sourceKey"
    | "provenance"
  >,
  value: unknown
): CanvasObject {
  const next = { ...current } as Record<string, unknown>;
  if (value === null) {
    delete next[field];
  } else if (value !== undefined) {
    next[field] = value;
  }
  return next as CanvasObject;
}

function updateObject(
  current: CanvasObject,
  changes: CanvasObjectUpdate
): CanvasObject {
  let next: CanvasObject = {
    ...current,
    label: changes.label ?? current.label,
    z: changes.z ?? current.z
  };
  next = setOptionalObjectField(next, "parentRegionId", changes.parentRegionId);
  next = setOptionalObjectField(next, "note", changes.note);
  next = setOptionalObjectField(next, "image", changes.image);
  next = setOptionalObjectField(next, "storyOrderHint", changes.storyOrderHint);
  next = setOptionalObjectField(next, "sourceKey", changes.sourceKey);
  next = setOptionalObjectField(next, "provenance", changes.provenance);
  return createCanvasObject(next);
}

function setOptionalLinkField(
  current: CanvasLink,
  field: keyof Pick<CanvasLink, "label" | "sourceKey" | "provenance">,
  value: string | null | undefined
): CanvasLink {
  const next = { ...current } as Record<string, unknown>;
  if (value === null) {
    delete next[field];
  } else if (value !== undefined) {
    next[field] = value;
  }
  return next as CanvasLink;
}

function updateLink(current: CanvasLink, changes: CanvasLinkUpdate): CanvasLink {
  let next = current;
  next = setOptionalLinkField(next, "label", changes.label);
  next = setOptionalLinkField(next, "sourceKey", changes.sourceKey);
  next = setOptionalLinkField(next, "provenance", changes.provenance);
  return createCanvasLink(next);
}

function replaceObject(
  objects: readonly CanvasObject[],
  replacement: CanvasObject
): CanvasObject[] {
  return objects.map((object) =>
    object.id === replacement.id ? replacement : object
  );
}

function replaceLink(
  links: readonly CanvasLink[],
  replacement: CanvasLink
): CanvasLink[] {
  return links.map((link) => (link.id === replacement.id ? replacement : link));
}

export async function applyCanvasCommand(input: {
  board: CanvasBoard;
  projectRecords: ProjectRecords;
  expectedCanvasVersion: number;
  command: CanvasCommand;
  actorAccountId: AccountId;
  ids: IdGenerator;
  now: string;
  parentRevisionId?: CanvasRevisionId;
}): Promise<CanvasMutationResult> {
  const board = createCanvasBoard(input.board);
  positiveVersion(input.expectedCanvasVersion, "Expected Canvas version");
  if (board.version !== input.expectedCanvasVersion) {
    throw new CanvasVersionConflictError(
      board.projectId,
      input.expectedCanvasVersion
    );
  }
  let objects = [...board.objects];
  let links = [...board.links];
  const command = input.command;

  switch (command.type) {
    case "canvas.object.create":
    case "canvas.object.place":
      objects.push(
        createCanvasObject({
          ...command.object,
          id: canvasObjectId(input.ids.create("canvasObject")),
          projectId: board.projectId
        })
      );
      break;
    case "canvas.object.update": {
      const current = requiredObject(objects, command.objectId);
      requireActiveRecord(current, "Canvas object");
      objects = replaceObject(objects, updateObject(current, command.changes));
      break;
    }
    case "canvas.object.move": {
      const current = requiredObject(objects, command.objectId);
      requireActiveRecord(current, "Canvas object");
      let moved: CanvasObject = { ...current, x: command.x, y: command.y };
      moved = setOptionalObjectField(
        moved,
        "parentRegionId",
        command.parentRegionId
      );
      objects = replaceObject(objects, createCanvasObject(moved));
      break;
    }
    case "canvas.object.resize": {
      const current = requiredObject(objects, command.objectId);
      requireActiveRecord(current, "Canvas object");
      objects = replaceObject(
        objects,
        createCanvasObject({
          ...current,
          width: command.width,
          height: command.height
        })
      );
      break;
    }
    case "canvas.object.archive": {
      const current = requiredObject(objects, command.objectId);
      if (
        current.kind === "region" &&
        objects.some(
          (object) =>
            active(object) && object.parentRegionId === command.objectId
        )
      ) {
        throw new CanvasCommandError(
          "UNSAFE_ARCHIVE",
          "Move or archive active objects before archiving their region."
        );
      }
      objects = replaceObject(
        objects,
        createCanvasObject({
          ...current,
          archivedAt: current.archivedAt ?? input.now
        })
      );
      break;
    }
    case "canvas.object.restore": {
      const current = requiredObject(objects, command.objectId);
      objects = replaceObject(
        objects,
        createCanvasObject(withoutArchive(current) as CanvasObject)
      );
      break;
    }
    case "canvas.object.confirm": {
      const current = requiredObject(objects, command.objectId);
      requireActiveRecord(current, "Canvas object");
      if (current.authority !== "provisional") {
        throw new CanvasCommandError(
          "INVALID_AUTHORITY",
          "Only a provisional Canvas object can be confirmed."
        );
      }
      objects = replaceObject(
        objects,
        createCanvasObject({ ...current, authority: "confirmed" })
      );
      break;
    }
    case "canvas.object.dismiss": {
      const current = requiredObject(objects, command.objectId);
      requireActiveRecord(current, "Canvas object");
      if (current.authority !== "provisional") {
        throw new CanvasCommandError(
          "INVALID_AUTHORITY",
          "Only a provisional Canvas object can be dismissed."
        );
      }
      objects = replaceObject(
        objects,
        createCanvasObject({
          ...current,
          archivedAt: input.now,
          dismissedAt: input.now
        })
      );
      break;
    }
    case "canvas.link.create":
      links.push(
        createCanvasLink({
          ...command.link,
          id: canvasLinkId(input.ids.create("canvasLink")),
          projectId: board.projectId
        })
      );
      break;
    case "canvas.link.update": {
      const current = requiredLink(links, command.linkId);
      requireActiveRecord(current, "Canvas link");
      links = replaceLink(links, updateLink(current, command.changes));
      break;
    }
    case "canvas.link.archive": {
      const current = requiredLink(links, command.linkId);
      links = replaceLink(
        links,
        createCanvasLink({
          ...current,
          archivedAt: current.archivedAt ?? input.now
        })
      );
      break;
    }
    case "canvas.link.restore": {
      const current = requiredLink(links, command.linkId);
      links = replaceLink(
        links,
        createCanvasLink(withoutArchive(current) as CanvasLink)
      );
      break;
    }
    case "canvas.link.confirm": {
      const current = requiredLink(links, command.linkId);
      requireActiveRecord(current, "Canvas link");
      if (current.authority !== "provisional") {
        throw new CanvasCommandError(
          "INVALID_AUTHORITY",
          "Only a provisional Canvas link can be confirmed."
        );
      }
      links = replaceLink(
        links,
        createCanvasLink({ ...current, authority: "confirmed" })
      );
      break;
    }
    case "canvas.link.dismiss": {
      const current = requiredLink(links, command.linkId);
      requireActiveRecord(current, "Canvas link");
      if (current.authority !== "provisional") {
        throw new CanvasCommandError(
          "INVALID_AUTHORITY",
          "Only a provisional Canvas link can be dismissed."
        );
      }
      links = replaceLink(
        links,
        createCanvasLink({
          ...current,
          archivedAt: input.now,
          dismissedAt: input.now
        })
      );
      break;
    }
  }

  const updated = createCanvasBoard({
    ...board,
    version: board.version + 1,
    objects,
    links,
    updatedAt: input.now
  });
  validateCanvasBoardReferences(updated, input.projectRecords);
  return Object.freeze({
    board: updated,
    revision: await snapshotRevision({
      board: updated,
      actorAccountId: input.actorAccountId,
      reason: "command",
      commandType: command.type,
      ...(input.parentRevisionId === undefined
        ? {}
        : { parentRevisionId: input.parentRevisionId }),
      createdAt: input.now
    })
  });
}

export async function restoreCanvasSnapshot(input: {
  currentBoard: CanvasBoard;
  targetRevision: CanvasRevision;
  projectRecords: ProjectRecords;
  expectedCanvasVersion: number;
  actorAccountId: AccountId;
  now: string;
  reason?: "restore" | "undo";
  parentRevisionId?: CanvasRevisionId;
}): Promise<CanvasMutationResult> {
  const current = createCanvasBoard(input.currentBoard);
  if (current.version !== input.expectedCanvasVersion) {
    throw new CanvasVersionConflictError(
      current.projectId,
      input.expectedCanvasVersion
    );
  }
  const target = createCanvasRevision(input.targetRevision);
  if (target.projectId !== current.projectId) {
    throw new CanvasRevisionNotFoundError();
  }
  const board = createCanvasBoard({
    ...target.snapshot,
    projectId: current.projectId,
    version: current.version + 1,
    createdAt: current.createdAt,
    updatedAt: input.now
  });
  validateCanvasBoardReferences(board, input.projectRecords);
  return Object.freeze({
    board,
    revision: await snapshotRevision({
      board,
      actorAccountId: input.actorAccountId,
      reason: input.reason ?? "restore",
      ...(input.parentRevisionId === undefined
        ? {}
        : { parentRevisionId: input.parentRevisionId }),
      createdAt: input.now
    })
  });
}

export function createCanvasViewportPreference(
  input: CanvasViewportPreference
): CanvasViewportPreference {
  return Object.freeze({
    projectId: input.projectId,
    accountId: input.accountId,
    x: finiteBounded(
      input.x,
      "Canvas viewport x",
      -CANVAS_MAX_COORDINATE,
      CANVAS_MAX_COORDINATE
    ),
    y: finiteBounded(
      input.y,
      "Canvas viewport y",
      -CANVAS_MAX_COORDINATE,
      CANVAS_MAX_COORDINATE
    ),
    zoom: finiteBounded(
      input.zoom,
      "Canvas viewport zoom",
      CANVAS_MIN_ZOOM,
      CANVAS_MAX_ZOOM
    ),
    ...(input.selectedObjectId === undefined
      ? {}
      : { selectedObjectId: input.selectedObjectId }),
    updatedAt: requireText(input.updatedAt, "Canvas viewport update time", 100)
  });
}

export function deriveCanvasReadingOrderSpine(
  records: ProjectRecords,
  board: CanvasBoard
): CanvasReadingOrderSpine {
  validateCanvasBoardReferences(board, records);
  const sceneById = new Map(records.scenes.map((scene) => [scene.id, scene]));
  const activeCardByScene = new Map(
    board.objects
      .filter(
        (
          object
        ): object is CanvasObject & Readonly<{ sceneId: SceneId }> =>
          object.kind === "scene-card" &&
          object.sceneId !== undefined &&
          active(object)
      )
      .map((object) => [object.sceneId, object])
  );
  const entries: CanvasSpineEntry[] = [];

  for (const orderedBookId of records.project.bookIds) {
    const book = records.books.find((candidate) => candidate.id === orderedBookId);
    if (book === undefined) continue;
    for (const part of book.manuscript.parts) {
      for (const chapter of part.chapters) {
        for (const orderedSceneId of chapter.sceneIds) {
          const scene = sceneById.get(orderedSceneId);
          if (scene === undefined) continue;
          const card = activeCardByScene.get(scene.id);
          const canonicalIndex = entries.length;
          entries.push(
            spineEntry({
              sceneId: scene.id,
              bookId: book.id,
              chapterId: chapter.id,
              placement: "chapter",
              canonicalIndex,
              card,
              archived: scene.archivedAt !== undefined
            })
          );
        }
      }
    }
    for (const orderedSceneId of book.manuscript.unassignedSceneIds) {
      const scene = sceneById.get(orderedSceneId);
      if (scene === undefined) continue;
      const card = activeCardByScene.get(scene.id);
      const canonicalIndex = entries.length;
      entries.push(
        spineEntry({
          sceneId: scene.id,
          bookId: book.id,
          placement: "unassigned",
          canonicalIndex,
          card,
          archived: scene.archivedAt !== undefined
        })
      );
    }
  }

  return Object.freeze({
    projectId: records.project.id,
    projectVersion: records.project.version,
    canvasVersion: board.version,
    entries: Object.freeze(entries)
  });
}

function spineEntry(input: {
  sceneId: SceneId;
  bookId: BookId;
  chapterId?: ChapterId;
  placement: "chapter" | "unassigned";
  canonicalIndex: number;
  card?: CanvasObject;
  archived: boolean;
}): CanvasSpineEntry {
  const hint = input.card?.storyOrderHint;
  const drift: CanvasSpineDrift =
    input.card === undefined
      ? "not-placed"
      : hint === undefined
        ? "no-hint"
        : hint === input.canonicalIndex
          ? "aligned"
          : hint < input.canonicalIndex
            ? "earlier-on-canvas"
            : "later-on-canvas";
  return Object.freeze({
    sceneId: input.sceneId,
    bookId: input.bookId,
    ...(input.chapterId === undefined ? {} : { chapterId: input.chapterId }),
    placement: input.placement,
    canonicalIndex: input.canonicalIndex,
    ...(input.card === undefined ? {} : { canvasObjectId: input.card.id }),
    ...(hint === undefined ? {} : { storyOrderHint: hint }),
    drift,
    archived: input.archived
  });
}
