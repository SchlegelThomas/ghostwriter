import { canonicalJsonStringify } from "./agent-canonical-json.js";
import { instructionContentHash, type AsyncHashPort, type InstructionContentHash } from "./agent-domain.js";
import { sceneDocumentPlainText } from "./book-reader.js";
import { DomainValidationError, type ProjectId, type SceneId } from "./domain.js";
import type { SceneContentHash, SceneDocumentHead } from "./scene-documents.js";
import type { StoryContextProjection, StoryContextScope } from "./story-context.js";

export const STORY_RECEIPT_MAX_PROSE_CHARS = 24_000;
export const STORY_RECEIPT_MAX_CONTEXT_CHARS = 120_000;

type TextReceipt = Readonly<{
  inclusionReason: string;
  providerTextCharCount: number;
  providerTextHash: InstructionContentHash;
}>;

export type StoryContextReceiptResource =
  | (TextReceipt & Readonly<{
      resourceClass: "scene-document";
      projectId: ProjectId;
      sceneId: SceneId;
      workingVersion: number;
      contentHash: SceneContentHash;
      fullTextCharCount: number;
      truncated: boolean;
    }>)
  | (TextReceipt & Readonly<{
      resourceClass: "story-context";
      projectId: ProjectId;
      scope: StoryContextScope;
      contentHash: InstructionContentHash;
      sceneIds: readonly SceneId[];
      includesProse: false;
    }>);

function reason(value: string): string {
  if (!value.trim() || value.length > 1_000) {
    throw new DomainValidationError("INVALID_AGENT_POLICY", "Context inclusion reason must contain 1–1000 characters.");
  }
  return value;
}

/** Returns the exact bounded text to send; receipt metadata alone is never provider context. */
export async function assembleStorySceneResource(input: Readonly<{
  projectId: ProjectId;
  sceneId: SceneId;
  head: SceneDocumentHead;
  inclusionReason: string;
  hashPort: AsyncHashPort;
}>): Promise<Readonly<{
  providerText: string;
  resource: Extract<StoryContextReceiptResource, { resourceClass: "scene-document" }>;
}>> {
  if (input.projectId !== input.head.projectId || input.sceneId !== input.head.sceneId) {
    throw new DomainValidationError("UNKNOWN_REFERENCE", "Scene context does not match the requested project and scene.");
  }
  if (!Number.isSafeInteger(input.head.workingVersion) || input.head.workingVersion < 1) {
    throw new DomainValidationError("INVALID_VERSION", "Scene context requires an acknowledged working version.");
  }
  const inclusionReason = reason(input.inclusionReason);
  const fullText = sceneDocumentPlainText(input.head.document);
  const providerText = fullText.slice(0, STORY_RECEIPT_MAX_PROSE_CHARS);
  return Object.freeze({
    providerText,
    resource: Object.freeze({
      resourceClass: "scene-document",
      projectId: input.projectId,
      sceneId: input.sceneId,
      workingVersion: input.head.workingVersion,
      contentHash: input.head.contentHash,
      inclusionReason,
      fullTextCharCount: fullText.length,
      truncated: providerText.length < fullText.length,
      providerTextCharCount: providerText.length,
      providerTextHash: instructionContentHash(await input.hashPort.digestSha256Hex(providerText))
    })
  });
}

/** Structured story metadata contains no manuscript prose. Oversized context asks for a narrower scope. */
export async function assembleStoryStructureResource(input: Readonly<{
  projectId: ProjectId;
  context: StoryContextProjection;
  inclusionReason: string;
  hashPort: AsyncHashPort;
}>): Promise<Readonly<{
  providerText: string;
  resource: Extract<StoryContextReceiptResource, { resourceClass: "story-context" }>;
}>> {
  if (input.projectId !== input.context.projectId) {
    throw new DomainValidationError("UNKNOWN_REFERENCE", "Story context belongs to a different project.");
  }
  const inclusionReason = reason(input.inclusionReason);
  const providerText = canonicalJsonStringify(input.context);
  if (providerText.length > STORY_RECEIPT_MAX_CONTEXT_CHARS) {
    throw new DomainValidationError("VALUE_TOO_LONG", "Story context exceeds the provider budget; select a narrower chapter or scene scope.");
  }
  const contentHash = instructionContentHash(await input.hashPort.digestSha256Hex(providerText));
  return Object.freeze({
    providerText,
    resource: Object.freeze({
      resourceClass: "story-context",
      projectId: input.projectId,
      scope: Object.freeze({ ...input.context.scope }),
      sceneIds: Object.freeze(input.context.scenes.map((scene) => scene.id)),
      contentHash,
      includesProse: false,
      inclusionReason,
      providerTextCharCount: providerText.length,
      providerTextHash: contentHash
    })
  });
}
