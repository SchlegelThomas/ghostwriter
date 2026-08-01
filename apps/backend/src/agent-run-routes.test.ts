import { afterEach, describe, expect, it } from "vitest";
import { createFakeStructuredCompletionProvider } from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_PROJECT_ID } from "@ghostwriter/core";
import type { OpenAiCompletionProviderFactory } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const OPENAI_KEY = "sk-valid-openai-key-1234567890";
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;

const reflectionPayload = Object.freeze({
  schemaId: "capture-reflection-v1" as const,
  summary: "A harbor signal seeking its scene.",
  questions: Object.freeze(["Where does this land in the opening?"]),
  possibleStoryJobs: Object.freeze([
    Object.freeze({
      label: "Cold open",
      rationale: "Establishes weather before the first arrival."
    })
  ])
});

function originHeaders(method: string): Record<string, string> {
  return method === "GET"
    ? {}
    : {
        origin: TEST_ORIGIN,
        "content-type": "application/json"
      };
}

const sketchPayload = Object.freeze({
  schemaId: "sketch-fields-v1" as const,
  purpose: "Force a present-tense choice on the pier.",
  conflict: "The log and the forecast disagree.",
  turn: "Mara cannot leave without answering."
});

function fakeCompletionFactory(): OpenAiCompletionProviderFactory {
  return () =>
    createFakeStructuredCompletionProvider({
      output: reflectionPayload
    });
}

function fakeCraftCompletionFactory(): OpenAiCompletionProviderFactory {
  return () =>
    createFakeStructuredCompletionProvider((input) => ({
      output:
        input.workflow === "sketch-partner.craft-fields"
          ? sketchPayload
          : reflectionPayload
    }));
}

async function openSeededApp(
  options?: Readonly<{
    callsDisabled?: boolean;
    kekConfig?: ReturnType<typeof createTestProviderKekRuntimeConfig> | undefined;
    openAiCompletionProviderFactory?: OpenAiCompletionProviderFactory;
  }>
) {
  return createSeededBackendApp(undefined, {
    kekConfig: options?.kekConfig,
    callsDisabled: options?.callsDisabled,
    openAiCompletionProviderFactory: options?.openAiCompletionProviderFactory
  });
}

async function createReadyCapture(app: Awaited<ReturnType<typeof openSeededApp>>["app"]) {
  const created = await app.request(`/api/projects/${PROJECT}/captures`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: JSON.stringify({ sourceModality: "text" })
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json();
  const captureId = createdBody.head.captureId as string;
  const saved = await app.request(
    `/api/projects/${PROJECT}/captures/${captureId}/body`,
    {
      method: "PATCH",
      headers: originHeaders("PATCH"),
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: {
          schemaVersion: 1,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { id: "block-1" },
                content: [{ type: "text", text: "Fog presses the harbor glass." }]
              }
            ]
          }
        }
      })
    }
  );
  expect(saved.status).toBe(200);
  return captureId;
}

async function configureOpenAi(app: Awaited<ReturnType<typeof openSeededApp>>["app"]) {
  const saved = await app.request("/api/me/provider/openai", {
    method: "PUT",
    headers: originHeaders("PUT"),
    body: JSON.stringify({ apiKey: OPENAI_KEY })
  });
  expect(saved.status).toBe(200);
}

afterEach(async () => {
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

describe("agent run routes", () => {
  it("previews context, runs with fake provider, and rejects the proposal", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeCompletionFactory()
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);

    const preview = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ captureId })
      }
    );
    expect(preview.status).toBe(201);
    const previewBody = await preview.json();
    expect(previewBody.receipt.workflowId).toBe("scene-partner.capture-reflection");
    expect(previewBody.receipt.resources[0]?.captureId).toBe(captureId);
    expect(JSON.stringify(previewBody)).not.toContain(OPENAI_KEY);

    const started = await app.request(`/api/projects/${PROJECT}/agent/runs`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        receiptId: previewBody.receipt.id,
        expectedReceiptHash: previewBody.receipt.receiptHash
      })
    });
    expect(started.status).toBe(201);
    const startedBody = await started.json();
    expect(startedBody.kind).toBe("ready");
    expect(startedBody.run.status).toBe("ready");
    expect(startedBody.proposal.payload.summary).toContain("harbor signal");
    expect(startedBody.proposal.primaryTarget).toEqual({
      kind: "capture",
      id: captureId
    });
    expect(JSON.stringify(startedBody)).not.toContain(OPENAI_KEY);

    const listed = await app.request(`/api/projects/${PROJECT}/agent/proposals`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.proposals).toHaveLength(1);
    const targeted = await app.request(
      `/api/projects/${PROJECT}/agent/proposals?targetKind=capture&targetId=${encodeURIComponent(captureId)}`
    );
    expect(targeted.status).toBe(200);
    expect((await targeted.json()).proposals).toHaveLength(1);
    const otherTarget = await app.request(
      `/api/projects/${PROJECT}/agent/proposals?targetKind=scene&targetId=scene-missing`
    );
    expect((await otherTarget.json()).proposals).toEqual([]);

    const rejected = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${startedBody.proposal.id}/reject`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: "{}"
      }
    );
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).proposal.status).toBe("rejected");
    const readyAfterReject = await app.request(
      `/api/projects/${PROJECT}/agent/proposals`
    );
    expect((await readyAfterReject.json()).proposals).toEqual([]);
    const rejectedList = await app.request(
      `/api/projects/${PROJECT}/agent/proposals?status=rejected`
    );
    expect((await rejectedList.json()).proposals).toHaveLength(1);
  });

  it("applies a ready proposal as a new scene", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeCompletionFactory()
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);
    const preview = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ captureId })
      }
    );
    expect(preview.status).toBe(201);
    const previewBody = await preview.json();
    const started = await app.request(`/api/projects/${PROJECT}/agent/runs`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        receiptId: previewBody.receipt.id,
        expectedReceiptHash: previewBody.receipt.receiptHash
      })
    });
    expect(started.status).toBe(201);
    const startedBody = await started.json();
    expect(startedBody.kind).toBe("ready");

    const navigator = await app.request(`/api/projects/${PROJECT}/navigator`);
    expect(navigator.status).toBe(200);
    const navigatorBody = await navigator.json();

    const applied = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${startedBody.proposal.id}/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          mode: "new-scene",
          title: startedBody.proposal.payload.possibleStoryJobs[0].label,
          bookId: "book-signal-at-bellwether",
          expectedProjectVersion: navigatorBody.version,
          expectedProposalContentHash: startedBody.proposal.contentHash
        })
      }
    );
    expect(applied.status).toBe(201);
    const appliedBody = await applied.json();
    expect(appliedBody.mode).toBe("new-scene");
    expect(appliedBody.proposal.status).toBe("applied");
    expect(appliedBody.scene.title).toBe("Cold open");
    expect(appliedBody.captureHead.status).toBe("integrated");
    expect(appliedBody.captureHead.integratedSceneId).toBe(appliedBody.scene.id);

    const reapply = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${startedBody.proposal.id}/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          mode: "new-scene",
          title: "Again",
          bookId: "book-signal-at-bellwether",
          expectedProjectVersion: navigatorBody.version + 1,
          expectedProposalContentHash: startedBody.proposal.contentHash
        })
      }
    );
    expect(reapply.status).toBe(409);
  });

  it("applies a ready proposal as a named variant without changing the draft", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeCompletionFactory()
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);
    const preview = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ captureId })
      }
    );
    const previewBody = await preview.json();
    const started = await app.request(`/api/projects/${PROJECT}/agent/runs`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        receiptId: previewBody.receipt.id,
        expectedReceiptHash: previewBody.receipt.receiptHash
      })
    });
    const startedBody = await started.json();
    const sceneId = "scene-arrival-at-bellwether";
    const workspace = await app.request(
      `/api/projects/${PROJECT}/scenes/${sceneId}/workspace`
    );
    expect(workspace.status).toBe(200);
    const workspaceBody = await workspace.json();
    const workingVersion = workspaceBody.head.workingVersion as number;
    const workingHash = workspaceBody.head.contentHash as string;

    const applied = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${startedBody.proposal.id}/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          mode: "named-variant",
          sceneId,
          variantName: "Capture fog take",
          expectedWorkingVersion: workingVersion,
          sessionId: "session-test",
          expectedProposalContentHash: startedBody.proposal.contentHash
        })
      }
    );
    expect(applied.status).toBe(201);
    const appliedBody = await applied.json();
    expect(appliedBody.mode).toBe("named-variant");
    expect(appliedBody.proposal.status).toBe("applied");
    expect(appliedBody.head.workingVersion).toBe(workingVersion);
    expect(appliedBody.head.contentHash).toBe(workingHash);
    expect(appliedBody.revision.origin).toBe("agent");
    expect(appliedBody.revision.reason).toBe("named-variant");
    expect(appliedBody.variant.name).toBe("Capture fog take");

    const after = await app.request(
      `/api/projects/${PROJECT}/scenes/${sceneId}/workspace`
    );
    expect(after.status).toBe(200);
    const afterBody = await after.json();
    expect(afterBody.head.workingVersion).toBe(workingVersion);
    expect(afterBody.head.contentHash).toBe(workingHash);
  });

  it("returns content-free 503 when provider calls are disabled", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      callsDisabled: true,
      openAiCompletionProviderFactory: fakeCompletionFactory()
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);
    const preview = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ captureId })
      }
    );
    expect(preview.status).toBe(201);
    const previewBody = await preview.json();

    const started = await app.request(`/api/projects/${PROJECT}/agent/runs`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        receiptId: previewBody.receipt.id,
        expectedReceiptHash: previewBody.receipt.receiptHash
      })
    });
    expect(started.status).toBe(503);
    const body = await started.json();
    expect(body.code).toBe("PROVIDER_DISABLED");
    expect(JSON.stringify(body)).not.toContain(OPENAI_KEY);
  });

  it("runs Sketch Partner and applies typed craft fields", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeCraftCompletionFactory()
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);
    const sceneId = "scene-arrival-at-bellwether";

    const missingTarget = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          captureId,
          workflowId: "sketch-partner.craft-fields"
        })
      }
    );
    expect(missingTarget.status).toBe(400);
    expect((await missingTarget.json()).code).toBe("CRAFT_TARGET_REQUIRED");

    const preview = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          captureId,
          workflowId: "sketch-partner.craft-fields",
          sceneId
        })
      }
    );
    expect(preview.status).toBe(201);
    const previewBody = await preview.json();
    expect(previewBody.receipt.workflowId).toBe("sketch-partner.craft-fields");
    expect(previewBody.receipt.outputSchemaId).toBe("sketch-fields-v1");
    expect(previewBody.receipt.targetSceneId).toBe(sceneId);

    const started = await app.request(`/api/projects/${PROJECT}/agent/runs`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        receiptId: previewBody.receipt.id,
        expectedReceiptHash: previewBody.receipt.receiptHash
      })
    });
    expect(started.status).toBe(201);
    const startedBody = await started.json();
    expect(startedBody.kind).toBe("ready");
    expect(startedBody.proposal.outputSchemaId).toBe("sketch-fields-v1");

    const navigator = await app.request(`/api/projects/${PROJECT}/navigator`);
    expect(navigator.status).toBe(200);
    const navigatorBody = await navigator.json();

    const applied = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${startedBody.proposal.id}/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          mode: "craft-fields",
          expectedProjectVersion: navigatorBody.version,
          expectedProposalContentHash: startedBody.proposal.contentHash
        })
      }
    );
    expect(applied.status).toBe(201);
    const appliedBody = await applied.json();
    expect(appliedBody.mode).toBe("craft-fields");
    expect(appliedBody.proposal.status).toBe("applied");
  });

  it("persists plan outlines without a provider call", async () => {
    const { app } = await openSeededApp();
    const saved = await app.request(`/api/projects/${PROJECT}/agent/plan-outlines`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        outlineText: "## Act II\n- Mara chooses the harbor.",
        title: "Harbor plan"
      })
    });
    expect(saved.status).toBe(201);
    const savedBody = await saved.json();
    expect(savedBody.captureId).toMatch(/^capture-/u);
    expect(savedBody.proposalId).toMatch(/^agentProposal-/u);
    expect(savedBody.proposal.outputSchemaId).toBe("plan-outline-v1");
    expect(savedBody.proposal.payload.schemaId).toBe("plan-outline-v1");

    const fetched = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${savedBody.proposalId}`
    );
    expect(fetched.status).toBe(200);
    const fetchedBody = await fetched.json();
    expect(fetchedBody.proposal.outputSchemaId).toBe("plan-outline-v1");
  });

  it("creates a ready project catalog memo without a configured key", async () => {
    const { app } = await openSeededApp();
    const response = await app.request(
      `/api/projects/${PROJECT}/agent/catalog-runs`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          agentId: "story-architect",
          lens: "three-act"
        })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.proposal).toMatchObject({
      status: "ready",
      outputSchemaId: "catalog-memo-v1",
      primaryTarget: { kind: "project", id: PROJECT },
      payload: {
        schemaId: "catalog-memo-v1",
        agentId: "story-architect",
        lens: "three-act"
      }
    });

    const acknowledged = await app.request(
      `/api/projects/${PROJECT}/agent/proposals/${body.proposal.id}/acknowledge`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({})
      }
    );
    expect(acknowledged.status).toBe(200);
    expect((await acknowledged.json()).proposal.status).toBe("applied");
  });

  it("returns content-free 503 when encryption is unavailable", async () => {
    const { app } = await openSeededApp({
      kekConfig: undefined,
      openAiCompletionProviderFactory: fakeCompletionFactory()
    });
    const captureId = await createReadyCapture(app);
    const preview = await app.request(
      `/api/projects/${PROJECT}/agent/context-preview`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ captureId })
      }
    );
    expect(preview.status).toBe(201);
    const previewBody = await preview.json();

    const started = await app.request(`/api/projects/${PROJECT}/agent/runs`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        receiptId: previewBody.receipt.id,
        expectedReceiptHash: previewBody.receipt.receiptHash
      })
    });
    expect(started.status).toBe(503);
    expect((await started.json()).code).toBe("PROVIDER_ENCRYPTION_UNAVAILABLE");
  });
});
