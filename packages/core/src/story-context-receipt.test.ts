import { createHash } from "node:crypto";
import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { projectId, revisionId, sceneId } from "./domain.js";
import { accountId } from "./identity.js";
import { BELLWETHER_FIXTURE } from "./fixtures.js";
import { sceneContentHash, type SceneDocumentHead } from "./scene-documents.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import { assembleStorySceneResource, assembleStoryStructureResource, STORY_RECEIPT_MAX_PROSE_CHARS } from "./story-context-receipt.js";

const hashPort = { async digestSha256Hex(text: string) { return createHash("sha256").update(text).digest("hex"); } };
function head(text = "Mara burned the letter."): SceneDocumentHead {
  return {
    projectId: projectId("receipt-project"), sceneId: sceneId("receipt-scene"), workingVersion: 3,
    document: validateSceneDocumentV1({ schemaVersion: 1, document: { type: "doc", content: [
      { type: "paragraph", attrs: { id: "block-letter" }, content: [{ type: "text", text }] }
    ] } }),
    contentHash: sceneContentHash("a".repeat(64)), checkpointRevisionId: revisionId("receipt-revision"),
    updatedByAccountId: accountId("receipt-owner"), createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:00Z"
  };
}

function sceneInput(source = head()) {
  return { head: source, projectId: source.projectId, sceneId: source.sceneId, inclusionReason: "Writer selected this scene", hashPort };
}

describe("revision-addressed story receipt resources", () => {
  it("returns actual prose and hashes exactly the text sent", async () => {
    const result = await assembleStorySceneResource(sceneInput());
    expect(result.providerText).toBe("Mara burned the letter.");
    expect(result.resource).toMatchObject({ resourceClass: "scene-document", workingVersion: 3, truncated: false,
      providerTextHash: await hashPort.digestSha256Hex(result.providerText), providerTextCharCount: result.providerText.length });
    expect(result.resource.contentHash).toBe(head().contentHash);
  });
  it("states unread coverage when prose is bounded", async () => {
    const text = "x".repeat(STORY_RECEIPT_MAX_PROSE_CHARS + 250);
    const result = await assembleStorySceneResource(sceneInput(head(text)));
    expect(result.providerText).toHaveLength(STORY_RECEIPT_MAX_PROSE_CHARS);
    expect(result.resource).toMatchObject({ truncated: true, fullTextCharCount: text.length });
  });
  it("refuses cross-project, wrong-scene and unacknowledged heads", async () => {
    await expect(assembleStorySceneResource({ ...sceneInput(), projectId: projectId("other") })).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
    await expect(assembleStorySceneResource({ ...sceneInput(), sceneId: sceneId("other") })).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
    await expect(assembleStorySceneResource(sceneInput({ ...head(), workingVersion: 0 }))).rejects.toMatchObject({ code: "INVALID_VERSION" });
  });
  it("labels structure as metadata, preserves scope and hashes its exact canonical text", async () => {
    const context = storyContextFromProjectRecords(BELLWETHER_FIXTURE);
    const result = await assembleStoryStructureResource({ projectId: context.projectId, context, inclusionReason: "Story spine", hashPort });
    expect(result.resource.includesProse).toBe(false);
    expect(result.resource.sceneIds).toEqual(context.scenes.map((scene) => scene.id));
    expect(result.resource.contentHash).toBe(await hashPort.digestSha256Hex(result.providerText));
    expect(JSON.parse(result.providerText).scope).toEqual(context.scope);
  });
  it("refuses oversized structure rather than sending incomplete JSON as complete coverage", async () => {
    const context = storyContextFromProjectRecords(BELLWETHER_FIXTURE);
    const oversized = { ...context, scenes: context.scenes.map((scene) => ({ ...scene, title: "x".repeat(120_001) })) };
    await expect(assembleStoryStructureResource({ projectId: context.projectId, context: oversized, inclusionReason: "Spine", hashPort })).rejects.toMatchObject({ code: "VALUE_TOO_LONG" });
    await expect(assembleStoryStructureResource({ projectId: projectId("other"), context, inclusionReason: "Spine", hashPort })).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
  });
});
