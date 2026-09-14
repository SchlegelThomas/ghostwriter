import { createHash } from "node:crypto";
import { createEmptySceneDocument } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import type { ContextReceipt } from "./agent-context-receipt.js";
import { instructionContentHash, type AsyncHashPort } from "./agent-domain.js";
import {
  captureContentHash,
  createCaptureDocumentHead
} from "./capture-documents.js";
import {
  captureId,
  captureRevisionId,
  contextReceiptId,
  revisionId,
  sceneId
} from "./domain.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { accountId } from "./identity.js";
import {
  createSceneDocumentHead,
  sceneContentHash
} from "./scene-documents.js";
import {
  assembleStoryStructureResource
} from "./story-context-receipt.js";
import {
  validateStoryWorkReceiptFreshness
} from "./story-work-apply-validation.js";
import { storyContextFromProjectRecords } from "./story-context.js";
import {
  createStoryWorkAssignment,
  storyWorkAssignmentId
} from "./story-work-assignment.js";

const hashPort: AsyncHashPort = {
  async digestSha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
  }
};
const OWNER = accountId("account-apply-freshness");
const SOURCE = BELLWETHER_FIXTURE.scenes[0]!.id;
const TARGET = sceneId("scene-apply-reserved");
const CAPTURE = captureId("capture-apply-source");
const SCENE_HASH = sceneContentHash("a".repeat(64));
const CAPTURE_HASH = captureContentHash("b".repeat(64));
const NOW = "2026-09-13T02:00:00.000Z";
const document = createEmptySceneDocument({ generateBlockId: () => "block-empty" });

async function fixture() {
  const context = storyContextFromProjectRecords(BELLWETHER_FIXTURE, {
    scope: { kind: "project" }
  });
  const structure = await assembleStoryStructureResource({
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    context,
    inclusionReason: "Scene assignment structure",
    hashPort
  });
  const sceneText = "The prior scene ends at the harbor gate.";
  const sceneTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(sceneText)
  );
  const captureText = "Keep the foghorn as the scene clock.";
  const captureTextHash = instructionContentHash(
    await hashPort.digestSha256Hex(captureText)
  );
  const receipt: ContextReceipt = Object.freeze({
    id: contextReceiptId("receipt-scene-apply-freshness"),
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workflowId: "story-work.scene",
    workflowVersion: "1",
    layers: [],
    resources: Object.freeze([
      structure.resource,
      Object.freeze({
        resourceClass: "scene-document" as const,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        sceneId: SOURCE,
        workingVersion: 3,
        contentHash: SCENE_HASH,
        fullTextCharCount: sceneText.length,
        truncated: false,
        inclusionReason: "Selected source scene",
        providerTextCharCount: sceneText.length,
        providerTextHash: sceneTextHash
      }),
      Object.freeze({
        resourceClass: "capture" as const,
        captureId: CAPTURE,
        workingVersion: 2,
        contentHash: CAPTURE_HASH,
        inclusionReason: "Selected Capture",
        providerTextCharCount: captureText.length,
        providerTextHash: captureTextHash
      })
    ]),
    excludedContextClasses: [],
    provider: "openai",
    model: "gpt-4.1",
    maxOutputTokens: 6_000,
    wallClockSeconds: 60,
    toolCount: 0,
    egressClass: "openai-responses",
    outputSchemaId: "scene-draft-v1",
    primaryTarget: { kind: "scene" as const, id: TARGET },
    targetSceneId: TARGET,
    receiptHash: instructionContentHash("c".repeat(64)),
    createdAt: NOW
  });
  const assignment = createStoryWorkAssignment({
    id: storyWorkAssignmentId("assignment-scene-apply-freshness"),
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "scene",
    brief: "Draft the next scene.",
    constraints: "Use only the selected sources.",
    doneWhen: "A scene proposal is ready.",
    sources: [
      {
        kind: "scene",
        sceneId: SOURCE,
        projectVersion: BELLWETHER_FIXTURE.project.version,
        workingVersion: 3,
        contentHash: SCENE_HASH
      },
      {
        kind: "capture",
        captureId: CAPTURE,
        workingVersion: 2,
        contentHash: CAPTURE_HASH
      }
    ],
    destination: { kind: "scene", sceneId: TARGET, operation: "create" },
    provider: "openai",
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft", dependencies: [] }],
    results: [],
    idempotencyKey: "submit-scene-apply-freshness",
    createdAt: NOW,
    updatedAt: NOW
  });
  const sceneHead = createSceneDocumentHead({
    sceneId: SOURCE,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    workingVersion: 3,
    document,
    contentHash: SCENE_HASH,
    checkpointRevisionId: revisionId("revision-scene-source"),
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
  const captureHead = createCaptureDocumentHead({
    captureId: CAPTURE,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    status: "ready",
    sourceModality: "text",
    workingVersion: 2,
    document,
    contentHash: CAPTURE_HASH,
    genesisRevisionId: captureRevisionId("capture-revision-source"),
    authorAccountId: OWNER,
    updatedByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW
  });
  return { assignment, receipt, sceneHead, captureHead };
}

describe("shared story work receipt freshness", () => {
  it("accepts the exact active scene and Capture source set", async () => {
    const current = await fixture();
    await expect(validateStoryWorkReceiptFreshness({
      assignment: current.assignment,
      receipt: current.receipt,
      currentRecords: BELLWETHER_FIXTURE,
      sceneDocumentHeads: new Map([[SOURCE, current.sceneHead]]),
      captureDocumentHeads: new Map([[CAPTURE, current.captureHead]]),
      hashPort
    }, {
      label: "Scene",
      allowCapture: true,
      maximumCaptures: 1,
      requireExactAssignmentSources: true,
      requireActiveSceneSources: true,
      stale: (message) => new Error(message)
    })).resolves.toBeUndefined();
  });

  it("refuses changed, archived, missing, or extra Capture dependencies", async () => {
    const current = await fixture();
    const validate = (captureHead = current.captureHead, receipt = current.receipt) =>
      validateStoryWorkReceiptFreshness({
        assignment: current.assignment,
        receipt,
        currentRecords: BELLWETHER_FIXTURE,
        sceneDocumentHeads: new Map([[SOURCE, current.sceneHead]]),
        captureDocumentHeads: new Map([[CAPTURE, captureHead]]),
        hashPort
      }, {
        label: "Scene",
        allowCapture: true,
        maximumCaptures: 1,
        requireExactAssignmentSources: true,
        requireActiveSceneSources: true,
        stale: (message) => new Error(message)
      });
    await expect(validate(createCaptureDocumentHead({
      ...current.captureHead,
      workingVersion: 3
    }))).rejects.toThrow(/Capture changed/i);
    await expect(validate(createCaptureDocumentHead({
      ...current.captureHead,
      status: "archived",
      archivedAt: NOW
    }))).rejects.toThrow(/Capture changed/i);
    await expect(validate(current.captureHead, {
      ...current.receipt,
      resources: current.receipt.resources.filter(
        (resource) => resource.resourceClass !== "capture"
      )
    })).rejects.toThrow(/exact source set/i);
  });

  it("preserves the character policy refusal for Capture resources", async () => {
    const current = await fixture();
    await expect(validateStoryWorkReceiptFreshness({
      assignment: current.assignment,
      receipt: current.receipt,
      currentRecords: BELLWETHER_FIXTURE,
      sceneDocumentHeads: new Map([[SOURCE, current.sceneHead]]),
      captureDocumentHeads: new Map([[CAPTURE, current.captureHead]]),
      hashPort
    }, {
      label: "Character",
      allowCapture: false,
      stale: (message) => new Error(message)
    })).rejects.toThrow(/unsupported context resource/i);
  });
});
