import { normalizeSceneDocument, type BlockIdGenerator, type SceneDocumentV1 } from "@ghostwriter/editor";
import { validateSceneDraftV1 } from "./scene-draft-v1.js";

/** Literal reviewed prose; only the trusted caller supplies canonical block IDs. */
export function sceneDraftDocument(payload: unknown, generateBlockId: BlockIdGenerator): SceneDocumentV1 {
  const draft = validateSceneDraftV1(payload);
  const paragraphs = draft.prose.replace(/\r\n?/gu, "\n").split("\n\n");
  return normalizeSceneDocument({
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, index) => [
        ...(index === 0 ? [] : [{ type: "hardBreak" }]),
        ...(line.length === 0 ? [] : [{ type: "text", text: line }])
      ])
    }))
  }, { generateBlockId });
}
