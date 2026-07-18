export const SCENE_DOCUMENT_SCHEMA_VERSION = 1 as const;

export const SCENE_BLOCK_NODE_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "horizontalRule",
] as const;

export const SCENE_MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
] as const;

type BrandedString<Name extends string> = string & {
  readonly __brand: Name;
};

export type BlockId = BrandedString<"BlockId">;
export type SceneDocumentSchemaVersion = typeof SCENE_DOCUMENT_SCHEMA_VERSION;
export type SceneBlockNodeType = (typeof SCENE_BLOCK_NODE_TYPES)[number];
export type SceneMarkType = (typeof SCENE_MARK_TYPES)[number];
export type SceneHeadingLevel = 1 | 2 | 3;

export interface SceneMarkV1 {
  readonly type: SceneMarkType;
}

export interface SceneTextNodeV1 {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly SceneMarkV1[];
}

export interface SceneHardBreakNodeV1 {
  readonly type: "hardBreak";
  readonly marks?: readonly SceneMarkV1[];
}

export type SceneInlineNodeV1 = SceneTextNodeV1 | SceneHardBreakNodeV1;

export interface SceneBlockAttributesV1 {
  readonly id: BlockId;
}

export interface SceneParagraphNodeV1 {
  readonly type: "paragraph";
  readonly attrs: SceneBlockAttributesV1;
  readonly content?: readonly SceneInlineNodeV1[];
}

export interface SceneHeadingNodeV1 {
  readonly type: "heading";
  readonly attrs: SceneBlockAttributesV1 & {
    readonly level: SceneHeadingLevel;
  };
  readonly content?: readonly SceneInlineNodeV1[];
}

export interface SceneBlockquoteNodeV1 {
  readonly type: "blockquote";
  readonly attrs: SceneBlockAttributesV1;
  readonly content: readonly SceneBlockV1[];
}

export interface SceneHorizontalRuleNodeV1 {
  readonly type: "horizontalRule";
  readonly attrs: SceneBlockAttributesV1;
}

export type SceneBlockV1 =
  | SceneParagraphNodeV1
  | SceneHeadingNodeV1
  | SceneBlockquoteNodeV1
  | SceneHorizontalRuleNodeV1;

export interface ProseMirrorDocumentV1 {
  readonly type: "doc";
  readonly content: readonly SceneBlockV1[];
}

export interface SceneDocumentV1 {
  readonly schemaVersion: SceneDocumentSchemaVersion;
  readonly document: ProseMirrorDocumentV1;
}

export type SceneDocument = SceneDocumentV1;

export type SceneDocumentValidationCode =
  | "INVALID_VALUE"
  | "UNEXPECTED_FIELD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_NODE"
  | "INVALID_MARK"
  | "INVALID_HEADING_LEVEL"
  | "MISSING_BLOCK_ID"
  | "INVALID_BLOCK_ID"
  | "DUPLICATE_BLOCK_ID";

export class SceneDocumentValidationError extends Error {
  readonly code: SceneDocumentValidationCode;
  readonly path: string;

  constructor(
    code: SceneDocumentValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "SceneDocumentValidationError";
    this.code = code;
    this.path = path;
  }
}

export type BlockIdGenerator = () => string;

export interface SceneDocumentNormalizationOptions {
  readonly generateBlockId?: BlockIdGenerator;
}

export type SceneBlockChangeKind =
  | "added"
  | "removed"
  | "changed"
  | "moved";

export interface SceneBlockComparison {
  readonly blockId: BlockId;
  readonly beforeIndex: number | null;
  readonly afterIndex: number | null;
  readonly changes: readonly SceneBlockChangeKind[];
  readonly before: SceneBlockV1 | null;
  readonly after: SceneBlockV1 | null;
}

export interface SceneDocumentComparison {
  readonly equal: boolean;
  readonly blocks: readonly SceneBlockComparison[];
}
