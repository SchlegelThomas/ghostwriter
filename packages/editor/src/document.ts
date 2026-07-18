import {
  SCENE_DOCUMENT_SCHEMA_VERSION,
  SceneDocumentValidationError,
  type BlockId,
  type BlockIdGenerator,
  type ProseMirrorDocumentV1,
  type SceneBlockAttributesV1,
  type SceneBlockV1,
  type SceneDocumentNormalizationOptions,
  type SceneDocumentV1,
  type SceneHeadingLevel,
  type SceneInlineNodeV1,
  type SceneMarkType,
  type SceneMarkV1,
} from "./types.js";

const BLOCK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MARK_ORDER: Readonly<Record<SceneMarkType, number>> = {
  bold: 0,
  italic: 1,
  underline: 2,
  strike: 3,
};

interface ParseContext {
  readonly assignMissingIds: boolean;
  readonly generateBlockId: BlockIdGenerator;
  readonly blockIds: Set<string>;
}

type UnknownRecord = Record<string, unknown>;

function fail(
  code: ConstructorParameters<typeof SceneDocumentValidationError>[0],
  path: string,
  message: string,
): never {
  throw new SceneDocumentValidationError(code, path, message);
}

function readRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("INVALID_VALUE", path, "expected an object.");
  }

  return value as UnknownRecord;
}

function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return fail("INVALID_VALUE", path, "expected an array.");
  }

  return value;
}

function assertOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("UNEXPECTED_FIELD", `${path}.${key}`, "field is not in schema v1.");
    }
  }
}

function readType(value: UnknownRecord, path: string): string {
  if (typeof value.type !== "string") {
    return fail("INVALID_NODE", `${path}.type`, "expected a node type.");
  }

  return value.type;
}

export function isValidBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value);
}

export function blockId(value: string): BlockId {
  if (!isValidBlockId(value)) {
    return fail(
      "INVALID_BLOCK_ID",
      "$blockId",
      "expected 1–128 URL-safe identifier characters.",
    );
  }

  return value;
}

export function generateBlockId(): BlockId {
  const cryptoProvider = globalThis.crypto;

  if (typeof cryptoProvider?.randomUUID === "function") {
    return blockId(cryptoProvider.randomUUID());
  }

  if (typeof cryptoProvider?.getRandomValues === "function") {
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return blockId(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
  }

  throw new Error(
    "A Web Crypto implementation is required to generate editor block IDs.",
  );
}

function parseBlockId(
  value: unknown,
  path: string,
  context: ParseContext,
): BlockId {
  let candidate = value;

  if (candidate === undefined || candidate === null) {
    if (!context.assignMissingIds) {
      return fail("MISSING_BLOCK_ID", path, "block ID is required.");
    }

    candidate = context.generateBlockId();
  }

  if (!isValidBlockId(candidate)) {
    return fail(
      "INVALID_BLOCK_ID",
      path,
      "expected 1–128 URL-safe identifier characters.",
    );
  }

  if (context.blockIds.has(candidate)) {
    return fail(
      "DUPLICATE_BLOCK_ID",
      path,
      "block ID must be unique within the document.",
    );
  }

  context.blockIds.add(candidate);
  return candidate;
}

function parseBlockAttributes(
  value: unknown,
  path: string,
  context: ParseContext,
): SceneBlockAttributesV1 {
  const attributes =
    value === undefined || value === null ? {} : readRecord(value, path);
  assertOnlyKeys(attributes, ["id"], path);

  return {
    id: parseBlockId(attributes.id, `${path}.id`, context),
  };
}

function parseHeadingAttributes(
  value: unknown,
  path: string,
  context: ParseContext,
): SceneBlockAttributesV1 & { readonly level: SceneHeadingLevel } {
  const attributes =
    value === undefined || value === null ? {} : readRecord(value, path);
  assertOnlyKeys(attributes, ["id", "level"], path);

  if (
    attributes.level !== 1 &&
    attributes.level !== 2 &&
    attributes.level !== 3
  ) {
    return fail(
      "INVALID_HEADING_LEVEL",
      `${path}.level`,
      "schema v1 supports heading levels 1, 2, and 3.",
    );
  }

  return {
    id: parseBlockId(attributes.id, `${path}.id`, context),
    level: attributes.level,
  };
}

function parseMark(value: unknown, path: string): SceneMarkV1 {
  const mark = readRecord(value, path);
  assertOnlyKeys(mark, ["type"], path);

  if (
    mark.type !== "bold" &&
    mark.type !== "italic" &&
    mark.type !== "underline" &&
    mark.type !== "strike"
  ) {
    return fail("INVALID_MARK", `${path}.type`, "mark is not in schema v1.");
  }

  return { type: mark.type };
}

function parseMarks(
  value: unknown,
  path: string,
): readonly SceneMarkV1[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const marks = readArray(value, path);
  const seen = new Set<SceneMarkType>();
  const parsed = marks.map((mark, index) => {
    const result = parseMark(mark, `${path}[${index}]`);

    if (seen.has(result.type)) {
      return fail(
        "INVALID_MARK",
        `${path}[${index}]`,
        "duplicate marks are not allowed.",
      );
    }

    seen.add(result.type);
    return result;
  });

  if (parsed.length === 0) {
    return undefined;
  }

  return parsed.sort(
    (left, right) => MARK_ORDER[left.type] - MARK_ORDER[right.type],
  );
}

function parseInlineNode(value: unknown, path: string): SceneInlineNodeV1 {
  const node = readRecord(value, path);
  const type = readType(node, path);

  if (type === "text") {
    assertOnlyKeys(node, ["type", "text", "marks"], path);

    if (typeof node.text !== "string" || node.text.length === 0) {
      return fail(
        "INVALID_NODE",
        `${path}.text`,
        "text nodes require non-empty text.",
      );
    }

    const marks = parseMarks(node.marks, `${path}.marks`);
    return marks === undefined
      ? { type: "text", text: node.text }
      : { type: "text", text: node.text, marks };
  }

  if (type === "hardBreak") {
    assertOnlyKeys(node, ["type", "marks"], path);
    const marks = parseMarks(node.marks, `${path}.marks`);

    return marks === undefined
      ? { type: "hardBreak" }
      : { type: "hardBreak", marks };
  }

  return fail("INVALID_NODE", `${path}.type`, "inline node is not in schema v1.");
}

function parseInlineContent(
  value: unknown,
  path: string,
): readonly SceneInlineNodeV1[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const content = readArray(value, path).map((node, index) =>
    parseInlineNode(node, `${path}[${index}]`),
  );

  return content.length === 0 ? undefined : content;
}

function parseBlock(
  value: unknown,
  path: string,
  context: ParseContext,
): SceneBlockV1 {
  const node = readRecord(value, path);
  const type = readType(node, path);

  if (type === "paragraph") {
    assertOnlyKeys(node, ["type", "attrs", "content"], path);
    const attrs = parseBlockAttributes(node.attrs, `${path}.attrs`, context);
    const content = parseInlineContent(node.content, `${path}.content`);

    return content === undefined
      ? { type: "paragraph", attrs }
      : { type: "paragraph", attrs, content };
  }

  if (type === "heading") {
    assertOnlyKeys(node, ["type", "attrs", "content"], path);
    const attrs = parseHeadingAttributes(node.attrs, `${path}.attrs`, context);
    const content = parseInlineContent(node.content, `${path}.content`);

    return content === undefined
      ? { type: "heading", attrs }
      : { type: "heading", attrs, content };
  }

  if (type === "blockquote") {
    assertOnlyKeys(node, ["type", "attrs", "content"], path);
    const attrs = parseBlockAttributes(node.attrs, `${path}.attrs`, context);
    const content = readArray(node.content, `${path}.content`).map(
      (child, index) => parseBlock(child, `${path}.content[${index}]`, context),
    );

    if (content.length === 0) {
      return fail(
        "INVALID_NODE",
        `${path}.content`,
        "block quotes require at least one block.",
      );
    }

    return { type: "blockquote", attrs, content };
  }

  if (type === "horizontalRule") {
    assertOnlyKeys(node, ["type", "attrs"], path);
    return {
      type: "horizontalRule",
      attrs: parseBlockAttributes(node.attrs, `${path}.attrs`, context),
    };
  }

  return fail("INVALID_NODE", `${path}.type`, "block node is not in schema v1.");
}

function parseProseMirrorDocument(
  value: unknown,
  context: ParseContext,
): ProseMirrorDocumentV1 {
  const document = readRecord(value, "$.document");
  assertOnlyKeys(document, ["type", "content"], "$.document");

  if (document.type !== "doc") {
    return fail(
      "INVALID_NODE",
      "$.document.type",
      "root node must be a ProseMirror doc.",
    );
  }

  const content = readArray(document.content, "$.document.content").map(
    (block, index) =>
      parseBlock(block, `$.document.content[${index}]`, context),
  );

  if (content.length === 0) {
    return fail(
      "INVALID_NODE",
      "$.document.content",
      "documents require at least one block.",
    );
  }

  return { type: "doc", content };
}

function createParseContext(
  options: SceneDocumentNormalizationOptions,
  assignMissingIds: boolean,
): ParseContext {
  return {
    assignMissingIds,
    generateBlockId: options.generateBlockId ?? generateBlockId,
    blockIds: new Set<string>(),
  };
}

export function validateProseMirrorDocumentV1(
  value: unknown,
): ProseMirrorDocumentV1 {
  return parseProseMirrorDocument(value, createParseContext({}, false));
}

export function validateSceneDocumentV1(value: unknown): SceneDocumentV1 {
  const sceneDocument = readRecord(value, "$");
  assertOnlyKeys(sceneDocument, ["schemaVersion", "document"], "$");

  if (sceneDocument.schemaVersion !== SCENE_DOCUMENT_SCHEMA_VERSION) {
    return fail(
      "UNSUPPORTED_SCHEMA_VERSION",
      "$.schemaVersion",
      "only scene document schema version 1 is supported.",
    );
  }

  return {
    schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
    document: parseProseMirrorDocument(
      sceneDocument.document,
      createParseContext({}, false),
    ),
  };
}

export function isSceneDocumentV1(value: unknown): value is SceneDocumentV1 {
  try {
    validateSceneDocumentV1(value);
    return true;
  } catch (error) {
    if (error instanceof SceneDocumentValidationError) {
      return false;
    }

    throw error;
  }
}

/**
 * Assigns IDs to missing schema-v1 blocks while preserving every existing ID.
 * IDs are applied recursively because Tiptap's UniqueID extension tracks the
 * same node types inside block quotes as well as at the document top level.
 */
export function assignTopLevelBlockIds(
  value: unknown,
  options: SceneDocumentNormalizationOptions = {},
): ProseMirrorDocumentV1 {
  return parseProseMirrorDocument(value, createParseContext(options, true));
}

export const assignStableBlockIds = assignTopLevelBlockIds;

/**
 * Normalizes a current document or migrates an unversioned ProseMirror doc to
 * schema v1. Versioned values are always validated strictly and never repaired.
 */
export function normalizeSceneDocument(
  value: unknown,
  options: SceneDocumentNormalizationOptions = {},
): SceneDocumentV1 {
  const candidate = readRecord(value, "$");

  if ("schemaVersion" in candidate) {
    return validateSceneDocumentV1(candidate);
  }

  if (candidate.type === "doc") {
    return {
      schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
      document: assignTopLevelBlockIds(candidate, options),
    };
  }

  return fail(
    "INVALID_VALUE",
    "$",
    "expected a schema-versioned scene document or unversioned ProseMirror doc.",
  );
}

export const migrateSceneDocument = normalizeSceneDocument;

export function createEmptySceneDocument(
  options: SceneDocumentNormalizationOptions = {},
): SceneDocumentV1 {
  const generateId = options.generateBlockId ?? generateBlockId;

  return validateSceneDocumentV1({
    schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: generateId() },
        },
      ],
    },
  });
}

export const EMPTY_SCENE_DOCUMENT: SceneDocumentV1 =
  validateSceneDocumentV1({
    schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block_empty" },
        },
      ],
    },
  });
