import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeStructuredCompletionProvider } from "@ghostwriter/ai";
import {
  BELLWETHER_FIXTURE_PROJECT_ID,
  MCP_GRANT_CAPTURE_TOOL_NAMES,
  accountId,
  CHARACTER_STORY_WORK_WORKFLOW_ID,
  createAgentRun,
  createQueuedAgentRun,
  createStoryWorkAttempt,
  startStoryWorkAttempt,
  agentRunId,
  contextReceiptId,
  createStoryWorkAssignment,
  instructionContentHash,
  mcpGrantId,
  storyWorkAssignmentId,
  storyKnowledgeId,
  providerForAgentModel,
  projectId,
  createMemoryStoryWorkAssignmentRepository,
  createMcpGrantRecord,
  mcpGrantTokenHash,
  STORY_WORK_ASSIGNMENT_LIST_MAX,
  sceneId
} from "@ghostwriter/core";
import {
  STORY_WORK_BRIDGE_RECOVERY_MESSAGE,
  listGrantVisibleStoryWorkAssignments,
  type StoryWorkApiRuntime
} from "./story-work-api.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import { buildStoryCheckHermeticCandidatesOutput } from "./story-check-hermetic-candidates.js";
import { buildStoryStructureHermeticCandidatesOutput } from "./story-structure-hermetic-candidates.js";
import {
  LOCAL_MCP_BRIDGE_NOT_FOUND_BODY,
  LOCAL_MCP_BRIDGE_INTERNAL_ERROR_BODY,
  LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY,
  LOCAL_MCP_BRIDGE_CONFLICT_BODY,
  LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY
} from "./local-mcp-bridge-routes.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  TEST_BACKEND_SESSION,
  testBackendClosers
} from "./test-backend-app.js";

const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;
const BELLWETHER_SCENE_ID = "scene-arrival-at-bellwether";
const BELLWETHER_BOOK_ID = "book-signal-at-bellwether";
const FUTURE_EXPIRY = "2026-08-01T00:00:00.000Z";
const OWNER = accountId(TEST_BACKEND_SESSION.account.id);
const RECOVERY_STARTED_AT = "2026-09-13T18:00:00.000Z";
const RECOVERY_RECEIPT_HASH = instructionContentHash("a".repeat(64));

function expectBridgePayloadHasNoCredentialLeaks(
  payload: unknown,
  token?: string
): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/"apiKey"\s*:/);
  expect(serialized).not.toMatch(/"tokenHash"\s*:/);
  expect(serialized).not.toMatch(/"encryptedMaterial"\s*:/);
  if (token !== undefined) {
    expect(serialized).not.toContain(token);
  }
}

async function seedRunningCharacterAssignmentForBridge(
  agentProvider: Awaited<ReturnType<typeof openBridgeApp>>["agentProvider"],
  assignmentKey: string
) {
  const assignmentId = storyWorkAssignmentId(`assignment-bridge-recovery-${assignmentKey}`);
  const runId = agentRunId(`run-bridge-recovery-${assignmentKey}`);
  const receiptId = contextReceiptId(`receipt-bridge-recovery-${assignmentKey}`);
  const destination = {
    kind: "story-knowledge" as const,
    storyKnowledgeId: storyKnowledgeId(`knowledge-bridge-recovery-${assignmentKey}`),
    operation: "create" as const
  };
  const assignment = createStoryWorkAssignment({
    id: assignmentId,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: "Bridge recovery assignment.",
    constraints: "Constraints.",
    doneWhen: "Done.",
    sources: [
      {
        kind: "project",
        projectId: PROJECT,
        projectVersion: 1
      }
    ],
    destination,
    provider: providerForAgentModel("gpt-4.1"),
    model: "gpt-4.1",
    status: "brief-ready",
    steps: [{ id: "draft-character", title: "Draft character dossier", dependencies: [] }],
    results: [],
    idempotencyKey: `bridge-recovery-${assignmentKey}`,
    createdAt: RECOVERY_STARTED_AT,
    updatedAt: RECOVERY_STARTED_AT
  });
  await agentProvider.storyWork.assignments.create({
    assignment,
    requestFingerprint: instructionContentHash("c".repeat(64))
  });
  await agentProvider.storyWork.receipts.insertImmutable(
    Object.freeze({
      id: receiptId,
      projectId: PROJECT,
      workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
      workflowVersion: "2026-09-12",
      layers: [],
      resources: [],
      excludedContextClasses: ["credentials"] as const,
      provider: "openai",
      model: "gpt-4.1",
      maxOutputTokens: 2_000,
      wallClockSeconds: 60,
      toolCount: 0,
      egressClass: "openai-responses",
      outputSchemaId: "character-create-v2",
      targetStoryKnowledgeId: destination.storyKnowledgeId,
      primaryTarget: {
        kind: "story-knowledge" as const,
        id: destination.storyKnowledgeId
      },
      receiptHash: RECOVERY_RECEIPT_HASH,
      createdAt: RECOVERY_STARTED_AT
    })
  );
  const queuedRun = createQueuedAgentRun({
    id: runId,
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    workflowId: CHARACTER_STORY_WORK_WORKFLOW_ID,
    workflowVersion: "2026-09-12",
    provider: "openai",
    model: "gpt-4.1",
    receiptId,
    receiptHash: RECOVERY_RECEIPT_HASH,
    status: "queued",
    createdAt: RECOVERY_STARTED_AT,
    updatedAt: RECOVERY_STARTED_AT
  });
  await agentProvider.storyWork.runs.create(queuedRun);
  const runningRun = createAgentRun({
    ...queuedRun,
    status: "running",
    updatedAt: "2026-09-13T18:00:30.000Z"
  });
  await agentProvider.storyWork.runs.transition({
    runId,
    expectedStatus: "queued",
    next: runningRun
  });
  await agentProvider.storyWork.attempts.create({
    attempt: createStoryWorkAttempt({
      assignmentId,
      projectId: PROJECT,
      initiatorAccountId: OWNER,
      runId,
      version: 1,
      kind: "initial",
      sourceMode: "submitted-snapshot",
      instruction: assignment.brief,
      idempotencyKey: `attempt-bridge-recovery-${assignmentKey}`,
      requestFingerprint: instructionContentHash("d".repeat(64)),
      createdAt: RECOVERY_STARTED_AT
    })
  });
  const runningAssignment = startStoryWorkAttempt({
    assignment,
    expectedVersion: 1,
    runId,
    updatedAt: "2026-09-13T18:00:10.000Z"
  });
  await agentProvider.storyWork.assignments.compareAndSet({
    accountId: OWNER,
    projectId: PROJECT,
    assignmentId,
    expectedVersion: 1,
    next: runningAssignment
  });
  return Object.freeze({ assignmentId, runId, runningRun });
}

function originHeaders(method: string): Record<string, string> {
  return method === "GET"
    ? {}
    : {
        origin: TEST_BACKEND_ORIGIN,
        "content-type": "application/json"
      };
}

function bearerHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

afterEach(async () => {
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

async function openBridgeApp(
  options?: Readonly<{
    now?: () => string;
    enabled?: boolean;
    callsDisabled?: boolean;
    openAiCompletionProviderFactory?: () => ReturnType<
      typeof createFakeStructuredCompletionProvider
    >;
  }>
) {
  return createSeededBackendApp(undefined, {
    kekConfig: createTestProviderKekRuntimeConfig(),
    localMcpBridge: { enabled: options?.enabled !== false },
    ...(options?.now === undefined ? {} : { now: options.now }),
    ...(options?.callsDisabled === undefined
      ? {}
      : { callsDisabled: options.callsDisabled }),
    ...(options?.openAiCompletionProviderFactory === undefined
      ? {}
      : { openAiCompletionProviderFactory: options.openAiCompletionProviderFactory })
  });
}

async function ensureOpenAiCredential(app: Awaited<ReturnType<typeof openBridgeApp>>["app"]) {
  const saved = await app.request("/api/me/provider/openai", {
    method: "PUT",
    headers: originHeaders("PUT"),
    body: JSON.stringify({ apiKey: "sk-bridge-route-test-key-1234567890" })
  });
  expect([200, 409]).toContain(saved.status);
}

async function createCharacterAssignment(app: Awaited<ReturnType<typeof openBridgeApp>>["app"]) {
  await ensureOpenAiCredential(app);
  const created = await app.request(`/api/projects/${PROJECT}/story-work/assignments`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: JSON.stringify({
      taskKind: "character",
      idempotencyKey: `bridge-${randomUUID()}`,
      expectedProjectVersion: 1,
      brief: "Bridge assignment brief.",
      constraints: "Keep canon intact.",
      doneWhen: "A dossier is ready for review.",
      sceneIds: [],
      model: "gpt-4.1"
    })
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  return body.assignment.id as string;
}

function grantPostBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    expiresAt: FUTURE_EXPIRY,
    ...overrides
  });
}

const captureReflectionPayload = Object.freeze({
  schemaId: "capture-reflection-v1" as const,
  summary: "Bridge capture reflection proposal.",
  questions: Object.freeze(["Which scene absorbs this fog?"]),
  possibleStoryJobs: Object.freeze([
    Object.freeze({
      label: "Harbor beat",
      rationale: "Keeps the weather before confrontation."
    })
  ])
});

function createCaptureReflectionFakeProvider() {
  return createFakeStructuredCompletionProvider(() => ({
    output: captureReflectionPayload
  }));
}

async function createReadyCapture(app: Awaited<ReturnType<typeof openBridgeApp>>["app"]) {
  const created = await app.request(`/api/projects/${PROJECT}/captures`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: JSON.stringify({ sourceModality: "text" })
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json();
  const captureIdValue = createdBody.head.captureId as string;
  const saved = await app.request(
    `/api/projects/${PROJECT}/captures/${captureIdValue}/body`,
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
  return captureIdValue;
}

async function mintCaptureGrant(
  app: Awaited<ReturnType<typeof openBridgeApp>>["app"],
  input: Readonly<{
    captureIds: readonly string[];
    tools?: readonly string[];
  }>
) {
  const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: grantPostBody({
      captureIds: input.captureIds,
      tools: input.tools ?? [...MCP_GRANT_CAPTURE_TOOL_NAMES, "ghostwriter_get_grant"]
    })
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  return Object.freeze({
    grantId: body.grant.id as string,
    token: body.token as string
  });
}

function bridgeCapturePostHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
}

async function mintStoryWorkGrant(
  app: Awaited<ReturnType<typeof openBridgeApp>>["app"],
  input: Readonly<{
    assignmentIds?: readonly string[];
    tools: readonly string[];
    token?: string;
    sceneIdsOverride?: readonly string[];
    bookIdsOverride?: readonly string[];
    allowProjectStructureRead?: boolean;
    coordinationIdsOverride?: readonly string[];
  }>
) {
  const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: grantPostBody({
      sceneIds: input.sceneIdsOverride ?? [BELLWETHER_SCENE_ID],
      bookIds: input.bookIdsOverride ?? [BELLWETHER_BOOK_ID],
      allowProjectStructureRead: input.allowProjectStructureRead ?? true,
      assignmentIds: input.assignmentIds ?? [],
      coordinationIds: input.coordinationIdsOverride ?? [],
      tools: input.tools
    })
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  return Object.freeze({
    grantId: body.grant.id as string,
    token: body.token as string
  });
}

describe("local MCP bridge routes", () => {
  it("returns 404 for all bridge paths when disabled", async () => {
    const { app } = await openBridgeApp({ enabled: false });
    for (const path of [
      "/local-mcp/v1/grant",
      "/local-mcp/v1/story-work",
      "/local-mcp/v1/story-work/assignment-x",
      "/local-mcp/v1/story-work/character",
      "/local-mcp/v1/story-work/scene",
      "/local-mcp/v1/story-work/check",
      "/local-mcp/v1/story-work/structure",
      "/local-mcp/v1/story-work/structure/preview",
      "/local-mcp/v1/coordinations",
      "/local-mcp/v1/coordinations/coord-x/steps/step-x/continue",
      "/local-mcp/v1/coordinations/coord-x"
    ]) {
      const response = await app.request(path, {
        headers: bearerHeaders("bridge-token-should-not-matter")
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);
    }
  });

  it("non-discloses missing, malformed, revoked, and expired grant tokens", async () => {
    let now = "2026-07-11T19:00:00.000Z";
    const { app } = await openBridgeApp({ now: () => now });
    const { token } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"]
    });

    const missing = await app.request("/local-mcp/v1/grant");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);

    const malformed = await app.request("/local-mcp/v1/grant", {
      headers: { Authorization: "NotBearer token" }
    });
    expect(malformed.status).toBe(404);

    const revokeTarget = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_get_grant"]
    });
    const revoked = await app.request(
      `/api/projects/${PROJECT}/mcp-grants/${revokeTarget.grantId}`,
      {
        method: "DELETE",
        headers: originHeaders("DELETE")
      }
    );
    expect(revoked.status).toBe(200);

    const afterRevoke = await app.request("/local-mcp/v1/grant", {
      headers: bearerHeaders(revokeTarget.token)
    });
    expect(afterRevoke.status).toBe(404);

    const expiredMint = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_get_grant"]
    });
    now = "2026-09-01T00:00:00.000Z";
    const expired = await app.request("/local-mcp/v1/grant", {
      headers: bearerHeaders(expiredMint.token)
    });
    expect(expired.status).toBe(404);
    expect(token.length).toBeGreaterThan(0);
  });

  it("non-discloses disallowed tools and hides non-granted same-project assignments", async () => {
    const { app } = await openBridgeApp();
    const visibleId = await createCharacterAssignment(app);
    const hiddenId = await createCharacterAssignment(app);
    const { token, grantId } = await mintStoryWorkGrant(app, {
      assignmentIds: [visibleId],
      tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"]
    });

    const listDenied = await app.request("/local-mcp/v1/coordinations", {
      headers: bearerHeaders(token)
    });
    expect(listDenied.status).toBe(404);

    const listed = await app.request("/local-mcp/v1/story-work", {
      headers: bearerHeaders(token)
    });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.assignments.map((row: { id: string }) => row.id)).toEqual([
      visibleId
    ]);
    expect(JSON.stringify(listedBody)).not.toContain(hiddenId);

    const hiddenGet = await app.request(`/local-mcp/v1/story-work/${hiddenId}`, {
      headers: bearerHeaders(token)
    });
    expect(hiddenGet.status).toBe(404);

    expect(grantId.length).toBeGreaterThan(0);
  });

  it("lists and reads MCP-origin assignments without explicit allowlist ids", async () => {
    const { app, agentProvider } = await openBridgeApp();
    const { token, grantId } = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_list_story_work",
        "ghostwriter_get_story_work"
      ]
    });
    const originAssignmentId = storyWorkAssignmentId(
      `assignment-bridge-origin-${randomUUID()}`
    );
    const now = "2026-07-11T19:00:00.000Z";
    await agentProvider.storyWork.assignments.create({
      assignment: createStoryWorkAssignment({
        id: originAssignmentId,
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        version: 1,
        taskKind: "character",
        brief: "MCP origin assignment.",
        constraints: "Constraints.",
        doneWhen: "Done.",
        sources: [
          {
            kind: "project",
            projectId: PROJECT,
            projectVersion: 1
          }
        ],
        destination: {
          kind: "story-knowledge",
          storyKnowledgeId: storyKnowledgeId(`knowledge-bridge-${randomUUID()}`),
          operation: "create"
        },
        provider: providerForAgentModel("gpt-4.1"),
        model: "gpt-4.1",
        status: "brief-ready",
        steps: [
          {
            id: "draft-character",
            title: "Draft character dossier",
            dependencies: []
          }
        ],
        results: [],
        idempotencyKey: `origin-${randomUUID()}`,
        origin: { kind: "mcp", grantId: mcpGrantId(grantId) },
        createdAt: now,
        updatedAt: now
      }),
      requestFingerprint: instructionContentHash("a".repeat(64))
    });

    const listed = await app.request("/local-mcp/v1/story-work", {
      headers: bearerHeaders(token)
    });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.assignments.map((row: { id: string }) => row.id)).toContain(
      originAssignmentId
    );

    const detail = await app.request(
      `/local-mcp/v1/story-work/${originAssignmentId}`,
      { headers: bearerHeaders(token) }
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.assignment.id).toBe(originAssignmentId);
  });

  it("bridge list keeps older MCP-origin assignment visible among newer unrelated rows", async () => {
    const { app, agentProvider } = await openBridgeApp();
    const { token, grantId } = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_list_story_work",
        "ghostwriter_get_story_work"
      ]
    });
    const oldOriginId = storyWorkAssignmentId(
      `assignment-bridge-origin-old-${randomUUID()}`
    );
    const { grantId: foreignGrantId } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_get_grant"]
    });
    const foreignOriginId = storyWorkAssignmentId(
      `assignment-bridge-origin-foreign-${randomUUID()}`
    );
    const requestFingerprint = instructionContentHash("a".repeat(64));
    await agentProvider.storyWork.assignments.create({
      assignment: createStoryWorkAssignment({
        id: oldOriginId,
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        version: 1,
        taskKind: "character",
        brief: "Older MCP origin assignment.",
        constraints: "Constraints.",
        doneWhen: "Done.",
        sources: [{ kind: "project", projectId: PROJECT, projectVersion: 1 }],
        destination: {
          kind: "story-knowledge",
          storyKnowledgeId: storyKnowledgeId(`knowledge-bridge-old-${randomUUID()}`),
          operation: "create"
        },
        provider: providerForAgentModel("gpt-4.1"),
        model: "gpt-4.1",
        status: "brief-ready",
        steps: [{ id: "draft-character", title: "Draft", dependencies: [] }],
        results: [],
        idempotencyKey: `origin-old-${randomUUID()}`,
        origin: { kind: "mcp", grantId: mcpGrantId(grantId) },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
      requestFingerprint
    });
    for (let index = 0; index < 150; index += 1) {
      await agentProvider.storyWork.assignments.create({
        assignment: createStoryWorkAssignment({
          id: storyWorkAssignmentId(`assignment-bridge-noise-${randomUUID()}`),
          projectId: PROJECT,
          initiatorAccountId: OWNER,
          version: 1,
          taskKind: "character",
          brief: "Unrelated assignment.",
          constraints: "Constraints.",
          doneWhen: "Done.",
          sources: [{ kind: "project", projectId: PROJECT, projectVersion: 1 }],
          destination: {
            kind: "story-knowledge",
            storyKnowledgeId: storyKnowledgeId(`knowledge-bridge-noise-${randomUUID()}`),
            operation: "create"
          },
          provider: providerForAgentModel("gpt-4.1"),
          model: "gpt-4.1",
          status: "brief-ready",
          steps: [{ id: "draft-character", title: "Draft", dependencies: [] }],
          results: [],
          idempotencyKey: `noise-${randomUUID()}`,
          createdAt: "2026-09-12T12:00:00.000Z",
          updatedAt: new Date(Date.UTC(2026, 9, 12, 12, 0, index)).toISOString()
        }),
        requestFingerprint: instructionContentHash(
          String.fromCharCode(97 + (index % 6)).repeat(64)
        )
      });
    }
    await agentProvider.storyWork.assignments.create({
      assignment: createStoryWorkAssignment({
        id: foreignOriginId,
        projectId: PROJECT,
        initiatorAccountId: OWNER,
        version: 1,
        taskKind: "character",
        brief: "Foreign grant origin.",
        constraints: "Constraints.",
        doneWhen: "Done.",
        sources: [{ kind: "project", projectId: PROJECT, projectVersion: 1 }],
        destination: {
          kind: "story-knowledge",
          storyKnowledgeId: storyKnowledgeId(`knowledge-bridge-foreign-${randomUUID()}`),
          operation: "create"
        },
        provider: providerForAgentModel("gpt-4.1"),
        model: "gpt-4.1",
        status: "brief-ready",
        steps: [{ id: "draft-character", title: "Draft", dependencies: [] }],
        results: [],
        idempotencyKey: `origin-foreign-${randomUUID()}`,
        origin: { kind: "mcp", grantId: mcpGrantId(foreignGrantId) },
        createdAt: "2026-09-12T12:00:00.000Z",
        updatedAt: "2026-09-12T12:00:00.000Z"
      }),
      requestFingerprint: instructionContentHash("b".repeat(64))
    });

    const listed = await app.request("/local-mcp/v1/story-work", {
      headers: bearerHeaders(token)
    });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    const listedIds = listedBody.assignments.map((row: { id: string }) => row.id);
    expect(listedIds).toContain(oldOriginId);
    expect(listedIds).not.toContain(foreignOriginId);
    expect(listedIds.every((id: string) => id.startsWith("assignment-"))).toBe(true);
  });

  it("matches first-party assignment detail when no recovery is projected", async () => {
    const { app } = await openBridgeApp();
    const assignmentId = await createCharacterAssignment(app);
    const { token } = await mintStoryWorkGrant(app, {
      assignmentIds: [assignmentId],
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_list_story_work",
        "ghostwriter_get_story_work"
      ]
    });

    const firstParty = await app.request(
      `/api/projects/${PROJECT}/story-work/assignments/${assignmentId}`
    );
    expect(firstParty.status).toBe(200);
    const firstPartyBody = await firstParty.json();

    const bridge = await app.request(`/local-mcp/v1/story-work/${assignmentId}`, {
      headers: bearerHeaders(token)
    });
    expect(bridge.status).toBe(200);
    const bridgeBody = await bridge.json();
    expect(bridgeBody).toEqual(firstPartyBody);
    expect(JSON.stringify(bridgeBody)).not.toContain(token);

    const grantDiscover = await app.request("/local-mcp/v1/grant", {
      headers: bearerHeaders(token)
    });
    expect(grantDiscover.status).toBe(200);
    const grantBody = await grantDiscover.json();
    expect(grantBody.grant).not.toHaveProperty("token");
    expect(grantBody.grant).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(grantBody)).not.toContain(token);
    expectBridgePayloadHasNoCredentialLeaks(bridgeBody, token);
  });

  it("returns bridge-safe recovery projections without manage actions", async () => {
    const { app, agentProvider } = await openBridgeApp();
    const seeded = await seedRunningCharacterAssignmentForBridge(
      agentProvider,
      "active"
    );
    const { token } = await mintStoryWorkGrant(app, {
      assignmentIds: [seeded.assignmentId],
      tools: ["ghostwriter_get_grant", "ghostwriter_get_story_work"]
    });

    const firstParty = await app.request(
      `/api/projects/${PROJECT}/story-work/assignments/${seeded.assignmentId}`
    );
    expect(firstParty.status).toBe(200);
    const firstPartyBody = await firstParty.json();
    expect(firstPartyBody.recovery).toMatchObject({
      status: "active-or-interrupted",
      actions: ["cancel", "mark-interrupted"]
    });
    expect(firstPartyBody.recovery.message).toMatch(/cancel|mark/i);

    const bridge = await app.request(
      `/local-mcp/v1/story-work/${seeded.assignmentId}`,
      { headers: bearerHeaders(token) }
    );
    expect(bridge.status).toBe(200);
    const bridgeBody = await bridge.json();
    expect(bridgeBody.recovery).toMatchObject({
      status: "active-or-interrupted",
      runId: seeded.runId,
      expectedAssignmentVersion: 2,
      message: STORY_WORK_BRIDGE_RECOVERY_MESSAGE
    });
    expect(bridgeBody.recovery).not.toHaveProperty("actions");
    expect(bridgeBody.recovery.message).not.toMatch(/cancel the run|mark it interrupted/i);
    expectBridgePayloadHasNoCredentialLeaks(bridgeBody, token);
  });

  it("returns refresh-required bridge recovery without manage actions", async () => {
    const { app, agentProvider } = await openBridgeApp();
    const seeded = await seedRunningCharacterAssignmentForBridge(
      agentProvider,
      "refresh"
    );
    await agentProvider.storyWork.runs.transition({
      runId: seeded.runId,
      expectedStatus: "running",
      next: {
        ...seeded.runningRun,
        status: "failed",
        terminalDiagnosticCode: "provider-timeout",
        completedAt: "2026-09-13T18:04:00.000Z",
        updatedAt: "2026-09-13T18:04:00.000Z"
      }
    });
    const { token } = await mintStoryWorkGrant(app, {
      assignmentIds: [seeded.assignmentId],
      tools: ["ghostwriter_get_grant", "ghostwriter_get_story_work"]
    });

    const firstParty = await app.request(
      `/api/projects/${PROJECT}/story-work/assignments/${seeded.assignmentId}`
    );
    const firstPartyBody = await firstParty.json();
    expect(firstPartyBody.recovery?.status).toBe("refresh-required");
    expect(firstPartyBody.recovery?.actions).toEqual(["cancel", "mark-interrupted"]);

    const bridge = await app.request(
      `/local-mcp/v1/story-work/${seeded.assignmentId}`,
      { headers: bearerHeaders(token) }
    );
    const bridgeBody = await bridge.json();
    expect(bridgeBody.recovery?.status).toBe("refresh-required");
    expect(bridgeBody.recovery?.message).toBe(STORY_WORK_BRIDGE_RECOVERY_MESSAGE);
    expect(bridgeBody.recovery).not.toHaveProperty("actions");
  });

  it("non-discloses malformed path ids and missing bearer tokens on read routes", async () => {
    const { app } = await openBridgeApp();
    const { token } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_get_grant", "ghostwriter_get_story_work"]
    });

    const missingToken = await app.request("/local-mcp/v1/story-work/not-valid");
    expect(missingToken.status).toBe(404);
    await expect(missingToken.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);

    const malformedAssignment = await app.request(
      "/local-mcp/v1/story-work/not%20valid",
      { headers: bearerHeaders(token) }
    );
    expect(malformedAssignment.status).toBe(404);

    const malformedCoordination = await app.request(
      "/local-mcp/v1/coordinations/not%20valid",
      { headers: bearerHeaders(token) }
    );
    expect(malformedCoordination.status).toBe(404);
  });

  it("denies cross-project forged origin rows and leaves capture grant admin unchanged", async () => {
    const { app, agentProvider } = await openBridgeApp();
    const captureId = await (async () => {
      const created = await app.request(`/api/projects/${PROJECT}/captures`, {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ sourceModality: "text" })
      });
      expect(created.status).toBe(201);
      return (await created.json()).head.captureId as string;
    })();

    const { token, grantId } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_get_grant", "ghostwriter_get_story_work"]
    });

    const otherProject = await app.request("/api/projects", {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        title: "Bridge cross-project",
        firstBookTitle: "Bridge cross-project book"
      })
    });
    expect(otherProject.status).toBe(201);
    const otherProjectId = projectId((await otherProject.json()).id as string);

    const forgedId = storyWorkAssignmentId(`assignment-forged-${randomUUID()}`);
    const now = "2026-07-11T19:00:00.000Z";
    await agentProvider.storyWork.assignments.create({
      assignment: createStoryWorkAssignment({
        id: forgedId,
        projectId: otherProjectId,
        initiatorAccountId: OWNER,
        version: 1,
        taskKind: "character",
        brief: "Forged cross-project origin.",
        constraints: "Constraints.",
        doneWhen: "Done.",
        sources: [
          {
            kind: "project",
            projectId: otherProjectId,
            projectVersion: 1
          }
        ],
        destination: {
          kind: "story-knowledge",
          storyKnowledgeId: storyKnowledgeId(`knowledge-forged-${randomUUID()}`),
          operation: "create"
        },
        provider: providerForAgentModel("gpt-4.1"),
        model: "gpt-4.1",
        status: "brief-ready",
        steps: [
          {
            id: "draft-character",
            title: "Draft character dossier",
            dependencies: []
          }
        ],
        results: [],
        idempotencyKey: `forged-${randomUUID()}`,
        origin: { kind: "mcp", grantId: mcpGrantId(grantId) },
        createdAt: now,
        updatedAt: now
      }),
      requestFingerprint: instructionContentHash("b".repeat(64))
    });

    const forgedGet = await app.request(`/local-mcp/v1/story-work/${forgedId}`, {
      headers: bearerHeaders(token)
    });
    expect(forgedGet.status).toBe(404);
    await expect(forgedGet.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);

    const captureGrant = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: [captureId],
        tools: [...MCP_GRANT_CAPTURE_TOOL_NAMES, "ghostwriter_get_grant"]
      })
    });
    expect(captureGrant.status).toBe(201);
    const captureBody = await captureGrant.json();
    expect(captureBody.grant.captureIds).toEqual([captureId]);
    expect(typeof captureBody.token).toBe("string");
  });

  it("does not expose token material in bridge error bodies", async () => {
    const { app } = await openBridgeApp();
    const secret = `bridge-secret-${randomUUID()}`;
    const response = await app.request("/local-mcp/v1/grant", {
      headers: bearerHeaders(secret)
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(LOCAL_MCP_BRIDGE_INTERNAL_ERROR_BODY.error.length).toBeGreaterThan(0);
  });
});

function bridgeSubmitHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
}

function bridgeCharacterBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedProjectVersion: 1,
    assignmentIdempotencyKey: `bridge-assignment-${randomUUID()}`,
    attemptIdempotencyKey: `bridge-attempt-${randomUUID()}`,
    brief: "  Develop the harbor navigator from selected context.  ",
    constraints: "Use only supplied context.",
    doneWhen: "A dossier is ready for review.",
    sceneIds: [BELLWETHER_SCENE_ID],
    model: "gpt-4.1",
    ...overrides
  };
}

describe("local MCP bridge submit routes", () => {
  it("submits character work with MCP origin, readable detail, and attempt replay", async () => {
    let providerCalls = 0;
    const provider = createFakeStructuredCompletionProvider(() => {
      providerCalls += 1;
      return {
        output: {
          schemaId: "character-create-v2",
          name: "Bridge Inez",
          summary: "A navigator under harbor pressure.",
          aliases: ["Inez"],
          characterSheet: {
            desire: "Bring the ship through safely.",
            pressure: "The chart contradicts what she can see.",
            voiceNotes: "Measured until afraid."
          },
          sourceSceneIds: [BELLWETHER_SCENE_ID]
        }
      };
    });
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () => provider
    });
    await prepareBellwetherSceneHead(app);
    await ensureOpenAiCredential(app);
    const { token, grantId } = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_submit_character_work",
        "ghostwriter_get_story_work"
      ]
    });
    const body = bridgeCharacterBody();
    const first = await app.request("/local-mcp/v1/story-work/character", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(body)
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.assignment.origin).toEqual({ kind: "mcp", grantId });
    expect(firstBody.generation).toMatchObject({
      kind: "ready",
      state: { attempt: { instruction: body.brief } }
    });
    expect(providerCalls).toBe(1);

    const replay = await app.request("/local-mcp/v1/story-work/character", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(body)
    });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.created).toBe(false);
    expect(replayBody.generation.kind).toBe("replayed");
    expect(replayBody.assignment.id).toBe(firstBody.assignment.id);
    expect(providerCalls).toBe(1);

    const detail = await app.request(
      `/local-mcp/v1/story-work/${firstBody.assignment.id}`,
      { headers: bearerHeaders(token) }
    );
    expect(detail.status).toBe(200);
  });

  it("non-discloses resource denials, missing provider, and cross-grant reads", async () => {
    const { app } = await openBridgeApp();
    const { token } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_submit_character_work"],
      sceneIdsOverride: []
    });
    const denied = await app.request("/local-mcp/v1/story-work/character", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(
        bridgeCharacterBody({ sceneIds: [BELLWETHER_SCENE_ID] })
      )
    });
    expect(denied.status).toBe(404);
    await expect(denied.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);

    const { token: structureToken } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_submit_structure_work"],
      bookIdsOverride: [],
      allowProjectStructureRead: true
    });
    const structureDenied = await app.request("/local-mcp/v1/story-work/structure", {
      method: "POST",
      headers: bridgeSubmitHeaders(structureToken),
      body: JSON.stringify({
        ...bridgeCharacterBody(),
        sceneIds: [BELLWETHER_SCENE_ID],
        targetBookId: BELLWETHER_BOOK_ID
      })
    });
    expect(structureDenied.status).toBe(404);

    const noProvider = await app.request("/local-mcp/v1/story-work/character", {
      method: "POST",
      headers: bridgeSubmitHeaders(
        (
          await mintStoryWorkGrant(app, {
            tools: ["ghostwriter_submit_character_work"]
          })
        ).token
      ),
      body: JSON.stringify(bridgeCharacterBody({ sceneIds: [] }))
    });
    expect(noProvider.status).toBe(503);
    await expect(noProvider.json()).resolves.toEqual(
      LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY
    );
  });

  it("returns 409 when replaying the same assignment key with a different body", async () => {
    const provider = createFakeStructuredCompletionProvider(() => ({
      output: {
        schemaId: "character-create-v2",
        name: "Conflict Test",
        summary: "Summary.",
        aliases: [],
        characterSheet: { desire: "Desire." },
        sourceSceneIds: []
      }
    }));
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () => provider
    });
    await ensureOpenAiCredential(app);
    const { token } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_submit_character_work"]
    });
    const assignmentKey = `bridge-conflict-${randomUUID()}`;
    const attemptKey = `bridge-attempt-${randomUUID()}`;
    const firstBody = bridgeCharacterBody({
      assignmentIdempotencyKey: assignmentKey,
      attemptIdempotencyKey: attemptKey,
      sceneIds: []
    });
    expect(
      (
        await app.request("/local-mcp/v1/story-work/character", {
          method: "POST",
          headers: bridgeSubmitHeaders(token),
          body: JSON.stringify(firstBody)
        })
      ).status
    ).toBe(201);
    const conflict = await app.request("/local-mcp/v1/story-work/character", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify({
        ...firstBody,
        brief: "  A different brief must conflict.  "
      })
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_CONFLICT_BODY);
  });

  it("submits scene, applied-scene check, and structure work through typed bridge paths", async () => {
    let providerCalls = 0;
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () =>
        createFakeStructuredCompletionProvider((input) => {
          providerCalls += 1;
          if (providerCalls === 2) {
            return { output: buildStoryCheckHermeticCandidatesOutput(input.inputText) };
          }
          if (providerCalls === 3) {
            return { output: buildStoryStructureHermeticCandidatesOutput(input.inputText) };
          }
          return {
            output: {
              schemaId: "scene-draft-v1",
              prose: "The harbor light failed under a thin fog.",
              sourceSceneIds: [BELLWETHER_SCENE_ID]
            }
          };
        })
    });
    await prepareBellwetherSceneHead(app);
    await ensureOpenAiCredential(app);
    const { token } = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_submit_scene_work",
        "ghostwriter_submit_check_work",
        "ghostwriter_submit_structure_work"
      ]
    });
    const sceneBody = {
      expectedProjectVersion: 1,
      assignmentIdempotencyKey: `scene-${randomUUID()}`,
      attemptIdempotencyKey: `scene-attempt-${randomUUID()}`,
      brief: "  Draft the fogged harbor beat.  ",
      constraints: "Use only supplied context.",
      doneWhen: "A scene draft is ready for review.",
      sceneIds: [BELLWETHER_SCENE_ID],
      model: "gpt-4.1"
    };
    const sceneResponse = await app.request("/local-mcp/v1/story-work/scene", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(sceneBody)
    });
    expect(sceneResponse.status).toBe(201);
    expect((await sceneResponse.json()).generation.kind).toBe("ready");

    const checkBody = {
      expectedProjectVersion: 1,
      assignmentIdempotencyKey: `check-${randomUUID()}`,
      attemptIdempotencyKey: `check-attempt-${randomUUID()}`,
      brief: "  Check continuity for the harbor scene.  ",
      constraints: "Use only supplied context.",
      doneWhen: "Findings are ready for review.",
      sceneIds: [],
      model: "gpt-4.1",
      specialist: "continuity",
      checkMode: "applied-scene",
      targetSceneId: BELLWETHER_SCENE_ID
    };
    const checkResponse = await app.request("/local-mcp/v1/story-work/check", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(checkBody)
    });
    expect(checkResponse.status).toBe(201);
    expect((await checkResponse.json()).generation.kind).toBe("ready");

    const structureBody = {
      expectedProjectVersion: 1,
      assignmentIdempotencyKey: `structure-${randomUUID()}`,
      attemptIdempotencyKey: `structure-attempt-${randomUUID()}`,
      brief: "  Propose the next chapter spine.  ",
      constraints: "Use only supplied context.",
      doneWhen: "An outline is ready for review.",
      sceneIds: [BELLWETHER_SCENE_ID],
      model: "gpt-4.1",
      targetBookId: BELLWETHER_BOOK_ID
    };
    const structureResponse = await app.request("/local-mcp/v1/story-work/structure", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(structureBody)
    });
    expect(structureResponse.status).toBe(201);
    expect((await structureResponse.json()).generation.kind).toBe("ready");
  });

  it("returns 422 for strict bridge bodies", async () => {
    const { app } = await openBridgeApp();
    const { token } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_submit_character_work"]
    });
    const invalid = await app.request("/local-mcp/v1/story-work/character", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify({ expectedProjectVersion: 1 })
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_INVALID_REQUEST_BODY);
  });

  it("previews structure without provider writes and refuses stale artifacts", async () => {
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () =>
        createFakeStructuredCompletionProvider((input) => ({
          output: buildStoryStructureHermeticCandidatesOutput(input.inputText)
        }))
    });
    await prepareBellwetherSceneHead(app);
    await ensureOpenAiCredential(app);
    const { token } = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_submit_structure_work",
        "ghostwriter_preview_story_structure"
      ]
    });
    const submitBody = {
      expectedProjectVersion: 1,
      assignmentIdempotencyKey: `preview-outline-${randomUUID()}`,
      attemptIdempotencyKey: `preview-outline-attempt-${randomUUID()}`,
      brief: "  Propose the next chapter spine.  ",
      constraints: "Use only supplied context.",
      doneWhen: "An outline is ready for review.",
      sceneIds: [BELLWETHER_SCENE_ID],
      model: "gpt-4.1",
      targetBookId: BELLWETHER_BOOK_ID
    };
    const submitted = await app.request("/local-mcp/v1/story-work/structure", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(submitBody)
    });
    expect(submitted.status).toBe(201);
    const submittedBody = await submitted.json();
    const generatedAssignment = submittedBody.generation.state.assignment;
    const artifact = generatedAssignment.currentArtifact;
    const operationIds = submittedBody.generation.state.proposal.payload.operations.map(
      (operation: { operationId: string }) => operation.operationId
    );
    const preview = await app.request("/local-mcp/v1/story-work/structure/preview", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify({
        assignmentId: submittedBody.assignment.id,
        expectedAssignmentVersion: generatedAssignment.version,
        expectedProjectVersion: 1,
        artifact,
        selectedOperationIds: operationIds
      })
    });
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview).toBeDefined();

    const stale = await app.request("/local-mcp/v1/story-work/structure/preview", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify({
        assignmentId: submittedBody.assignment.id,
        expectedAssignmentVersion: generatedAssignment.version + 1,
        expectedProjectVersion: 1,
        artifact,
        selectedOperationIds: operationIds
      })
    });
    expect(stale.status).toBe(409);
  });

  it("creates coordinations with MCP origin and replays without provider spend", async () => {
    let providerCalls = 0;
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () =>
        createFakeStructuredCompletionProvider(() => {
          providerCalls += 1;
          return {
            output: {
              schemaId: "scene-draft-v1",
              prose: "Unused coordination provider call.",
              sourceSceneIds: []
            }
          };
        })
    });
    await prepareBellwetherSceneHead(app);
    const contextScenePath = `/api/projects/${PROJECT}/scenes/scene-future-call`;
    expect((await app.request(`${contextScenePath}/workspace`)).status).toBe(200);
    expect(
      (
        await app.request(`${contextScenePath}/lease`, {
          method: "POST",
          headers: originHeaders("POST")
        })
      ).status
    ).toBe(200);
    const { token, grantId } = await mintStoryWorkGrant(app, {
      tools: ["ghostwriter_create_story_work_coordination"],
      sceneIdsOverride: [BELLWETHER_SCENE_ID, "scene-future-call"]
    });
    const body = {
      expectedProjectVersion: 1,
      idempotencyKey: `bridge-coordination-${randomUUID()}`,
      title: "Bridge harbor coordination",
      scene: {
        title: "Draft harbor scene",
        brief: "Draft a coordinated harbor scene.",
        constraints: "Keep canon intact.",
        doneWhen: "A scene draft is ready for review.",
        model: "gpt-4.1",
        sceneIds: [BELLWETHER_SCENE_ID]
      },
      check: {
        title: "Continuity check",
        brief: "Check the draft against surrounding canon.",
        constraints: "Ground findings in supplied scenes.",
        doneWhen: "Findings are ready for writer review.",
        model: "gpt-4.1",
        surroundingSceneIds: ["scene-future-call"]
      }
    };
    const created = await app.request("/local-mcp/v1/coordinations", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(body)
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.coordination.origin).toEqual({ kind: "mcp", grantId });
    expect(createdBody.rootAssignment.origin).toEqual({ kind: "mcp", grantId });
    expect(providerCalls).toBe(0);

    const replay = await app.request("/local-mcp/v1/coordinations", {
      method: "POST",
      headers: bridgeSubmitHeaders(token),
      body: JSON.stringify(body)
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).coordination.id).toBe(createdBody.coordination.id);
    expect(providerCalls).toBe(0);
  });

  it("refuses continue when coordination origin does not match calling grant", async () => {
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () =>
        createFakeStructuredCompletionProvider(() => ({
          output: {
            schemaId: "scene-draft-v1",
            prose: "The coordinated harbor draft opens on the extinguished beacon.",
            sourceSceneIds: [BELLWETHER_SCENE_ID]
          }
        }))
    });
    await prepareBellwetherSceneHead(app);
    await ensureOpenAiCredential(app);
    const contextScenePath = `/api/projects/${PROJECT}/scenes/scene-future-call`;
    expect((await app.request(`${contextScenePath}/workspace`)).status).toBe(200);
    expect(
      (
        await app.request(`${contextScenePath}/lease`, {
          method: "POST",
          headers: originHeaders("POST")
        })
      ).status
    ).toBe(200);
    const owner = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_create_story_work_coordination",
        "ghostwriter_continue_story_work_coordination"
      ],
      sceneIdsOverride: [BELLWETHER_SCENE_ID, "scene-future-call"]
    });
    const coordinationBody = {
      expectedProjectVersion: 1,
      idempotencyKey: `bridge-continue-origin-${randomUUID()}`,
      title: "Bridge continue origin",
      scene: {
        title: "Draft harbor scene",
        brief: "Draft a coordinated harbor scene.",
        constraints: "Keep canon intact.",
        doneWhen: "A scene draft is ready for review.",
        model: "gpt-4.1",
        sceneIds: [BELLWETHER_SCENE_ID]
      },
      check: {
        title: "Continuity check",
        brief: "Check the draft against surrounding canon.",
        constraints: "Ground findings in supplied scenes.",
        doneWhen: "Findings are ready for writer review.",
        model: "gpt-4.1",
        surroundingSceneIds: ["scene-future-call"]
      }
    };
    const created = await app.request("/local-mcp/v1/coordinations", {
      method: "POST",
      headers: bridgeSubmitHeaders(owner.token),
      body: JSON.stringify(coordinationBody)
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const checkStep = createdBody.coordination.steps.find(
      (step: { kind: string }) => step.kind === "proposal-continuity-check"
    );
    const rootAssignmentId = createdBody.rootAssignment.id as string;
    const generated = await app.request(
      `/api/projects/${PROJECT}/story-work/assignments/${rootAssignmentId}/attempts`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          expectedAssignmentVersion: 1,
          kind: "initial",
          sourceMode: "submitted-snapshot",
          instruction: coordinationBody.scene.brief,
          idempotencyKey: `bridge-root-attempt-${randomUUID()}`
        })
      }
    );
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json();
    const artifact = generatedBody.state.assignment.currentArtifact;

    const foreign = await mintStoryWorkGrant(app, {
      tools: [
        "ghostwriter_get_story_work_coordination",
        "ghostwriter_continue_story_work_coordination"
      ],
      coordinationIdsOverride: [createdBody.coordination.id as string],
      sceneIdsOverride: [BELLWETHER_SCENE_ID, "scene-future-call"]
    });
    const readable = await app.request(
      `/local-mcp/v1/coordinations/${createdBody.coordination.id}`,
      { headers: bearerHeaders(foreign.token) }
    );
    expect(readable.status).toBe(200);

    const denied = await app.request(
      `/local-mcp/v1/coordinations/${createdBody.coordination.id}/steps/${checkStep.stepId}/continue`,
      {
        method: "POST",
        headers: bridgeSubmitHeaders(foreign.token),
        body: JSON.stringify({
          expectedCoordinationVersion: 1,
          expectedUpstreamArtifact: artifact
        })
      }
    );
    expect(denied.status).toBe(404);
    await expect(denied.json()).resolves.toEqual(LOCAL_MCP_BRIDGE_NOT_FOUND_BODY);
  });
});

describe("local MCP bridge capture grant routes", () => {
  it("reads, assembles context, and proposes capture reflection with safe DTOs", async () => {
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () => createCaptureReflectionFakeProvider()
    });
    await ensureOpenAiCredential(app);
    const captureIdValue = await createReadyCapture(app);
    const { token } = await mintCaptureGrant(app, { captureIds: [captureIdValue] });

    const read = await app.request(`/local-mcp/v1/captures/${captureIdValue}`, {
      headers: bearerHeaders(token)
    });
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(readBody).toMatchObject({
      captureId: captureIdValue,
      projectId: PROJECT,
      plainTextSummary: expect.stringContaining("Fog")
    });
    expectBridgePayloadHasNoCredentialLeaks(readBody, token);

    const context = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/context`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(context.status).toBe(200);
    const contextBody = await context.json();
    expect(contextBody).toMatchObject({
      projectId: PROJECT,
      workflowId: expect.any(String),
      receiptHash: expect.any(String),
      model: expect.any(String),
      createdAt: expect.any(String)
    });
    expectBridgePayloadHasNoCredentialLeaks(contextBody, token);

    const propose = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/proposals`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(propose.status).toBe(200);
    const proposeBody = await propose.json();
    expect(proposeBody.kind).toBe("ready");
    expect(proposeBody.proposalId).toEqual(expect.any(String));
    expect(proposeBody.runId).toEqual(expect.any(String));
    expectBridgePayloadHasNoCredentialLeaks(proposeBody, token);

    const replay = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/proposals`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.kind).toBe("ready");
    expect(replayBody.proposalId).toEqual(expect.any(String));
    expect(replayBody.runId).toEqual(expect.any(String));
    expect(proposeBody.proposalId).toEqual(expect.any(String));
  });

  it("proposes with read+propose grant only and denies assemble without assemble tool", async () => {
    let providerFactoryCalls = 0;
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () => {
        providerFactoryCalls += 1;
        return createCaptureReflectionFakeProvider();
      }
    });
    await ensureOpenAiCredential(app);
    const captureIdValue = await createReadyCapture(app);
    const { token } = await mintCaptureGrant(app, {
      captureIds: [captureIdValue],
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_read_capture",
        "ghostwriter_propose_capture_reflection"
      ]
    });

    const contextDenied = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/context`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(contextDenied.status).toBe(404);

    const propose = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/proposals`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(propose.status).toBe(200);
    expect((await propose.json()).kind).toBe("ready");
    expect(providerFactoryCalls).toBe(1);
  });

  it("denies non-granted capture before invoking the provider factory", async () => {
    let providerFactoryCalls = 0;
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () => {
        providerFactoryCalls += 1;
        return createCaptureReflectionFakeProvider();
      }
    });
    await ensureOpenAiCredential(app);
    const allowedCaptureId = await createReadyCapture(app);
    const deniedCaptureId = await createReadyCapture(app);
    const { token } = await mintCaptureGrant(app, {
      captureIds: [allowedCaptureId],
      tools: ["ghostwriter_get_grant", "ghostwriter_propose_capture_reflection"]
    });

    const denied = await app.request(
      `/local-mcp/v1/captures/${deniedCaptureId}/proposals`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(denied.status).toBe(404);
    expect(providerFactoryCalls).toBe(0);
  });

  it("non-discloses revoked, wrong-tool, and non-granted capture access", async () => {
    const { app } = await openBridgeApp({
      openAiCompletionProviderFactory: () => createCaptureReflectionFakeProvider()
    });
    await ensureOpenAiCredential(app);
    const captureIdValue = await createReadyCapture(app);
    const otherCaptureId = await createReadyCapture(app);
    const minted = await mintCaptureGrant(app, { captureIds: [captureIdValue] });
    const { token } = minted;

    const wrongCapture = await app.request(
      `/local-mcp/v1/captures/${otherCaptureId}`,
      { headers: bearerHeaders(token) }
    );
    expect(wrongCapture.status).toBe(404);

    const readOnlyGrant = await mintCaptureGrant(app, {
      captureIds: [captureIdValue],
      tools: ["ghostwriter_read_capture", "ghostwriter_get_grant"]
    });
    const proposeDenied = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/proposals`,
      { method: "POST", headers: bridgeCapturePostHeaders(readOnlyGrant.token) }
    );
    expect(proposeDenied.status).toBe(404);

    const revoked = await app.request(
      `/api/projects/${PROJECT}/mcp-grants/${minted.grantId}`,
      { method: "DELETE", headers: originHeaders("DELETE") }
    );
    expect(revoked.status).toBe(200);
    const afterRevoke = await app.request(`/local-mcp/v1/captures/${captureIdValue}`, {
      headers: bearerHeaders(token)
    });
    expect(afterRevoke.status).toBe(404);
  });

  it("returns 404 for malformed capture ids and missing bearer tokens", async () => {
    const { app } = await openBridgeApp();
    await ensureOpenAiCredential(app);
    const captureIdValue = await createReadyCapture(app);
    const { token } = await mintCaptureGrant(app, { captureIds: [captureIdValue] });

    const missingToken = await app.request("/local-mcp/v1/captures/not-valid");
    expect(missingToken.status).toBe(404);

    const malformed = await app.request("/local-mcp/v1/captures/not%20valid", {
      headers: bearerHeaders(token)
    });
    expect(malformed.status).toBe(404);
  });

  it("rejects non-empty POST bodies and provider failures safely", async () => {
    const { app } = await openBridgeApp({ callsDisabled: true });
    const captureIdValue = await createReadyCapture(app);
    const { token } = await mintCaptureGrant(app, { captureIds: [captureIdValue] });

    const invalidBody = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/context`,
      {
        method: "POST",
        headers: bridgeCapturePostHeaders(token),
        body: JSON.stringify({ unexpected: true })
      }
    );
    expect(invalidBody.status).toBe(422);

    const proposeFailed = await app.request(
      `/local-mcp/v1/captures/${captureIdValue}/proposals`,
      { method: "POST", headers: bridgeCapturePostHeaders(token) }
    );
    expect(proposeFailed.status).toBe(503);
    const proposeFailedBody = await proposeFailed.json();
    expect(proposeFailedBody).toEqual(LOCAL_MCP_BRIDGE_UNAVAILABLE_BODY);
    expect(JSON.stringify(proposeFailedBody)).not.toContain(token);
  });
});

describe("grant-visible story work listing", () => {
  const GRANT = mcpGrantId("grant-visible-list-unit");
  const SCENE = sceneId(BELLWETHER_SCENE_ID);

  function bridgeAssignment(
    id: string,
    options: Readonly<{
      updatedAt: string;
      origin?: { kind: "mcp"; grantId: ReturnType<typeof mcpGrantId> };
      idempotencyKey: string;
    }>
  ) {
    return createStoryWorkAssignment({
      id: storyWorkAssignmentId(id),
      projectId: PROJECT,
      initiatorAccountId: OWNER,
      version: 1,
      taskKind: "character",
      brief: "Grant-visible assignment.",
      constraints: "Constraints.",
      doneWhen: "Done.",
      sources: [{ kind: "project", projectId: PROJECT, projectVersion: 1 }],
      destination: {
        kind: "story-knowledge",
        storyKnowledgeId: storyKnowledgeId(`knowledge-${id}`),
        operation: "create"
      },
      provider: providerForAgentModel("gpt-4.1"),
      model: "gpt-4.1",
      status: "brief-ready",
      steps: [{ id: "draft-character", title: "Draft", dependencies: [] }],
      results: [],
      idempotencyKey: options.idempotencyKey,
      createdAt: options.updatedAt,
      updatedAt: options.updatedAt,
      ...(options.origin === undefined ? {} : { origin: options.origin })
    });
  }

  function grantRecord(assignmentIds: readonly string[]) {
    return createMcpGrantRecord({
      id: GRANT,
      accountId: OWNER,
      projectId: PROJECT,
      captureIds: [],
      sceneIds: [SCENE],
      bookIds: [],
      assignmentIds: assignmentIds.map((id) => storyWorkAssignmentId(id)),
      coordinationIds: [],
      tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"],
      allowProjectStructureRead: true,
      tokenHash: mcpGrantTokenHash("4".repeat(64)),
      tokenHint: "…unit",
      expiresAt: FUTURE_EXPIRY,
      createdAt: "2026-07-11T18:00:00.000Z",
      updatedAt: "2026-07-11T18:00:00.000Z"
    });
  }

  it("pins allowlisted ids, dedupes origin overlap, and caps at the grant max", async () => {
    const assignments = createMemoryStoryWorkAssignmentRepository();
    const pinnedId = storyWorkAssignmentId("assignment-visible-pinned");
    const sharedId = storyWorkAssignmentId("assignment-visible-shared");
    const requestFingerprint = instructionContentHash("a".repeat(64));
    await assignments.create({
      assignment: bridgeAssignment("assignment-visible-pinned", {
        idempotencyKey: "pinned",
        updatedAt: "2026-12-01T00:00:00.000Z"
      }),
      requestFingerprint
    });
    await assignments.create({
      assignment: bridgeAssignment("assignment-visible-shared", {
        idempotencyKey: "shared",
        updatedAt: "2026-02-01T00:00:00.000Z",
        origin: { kind: "mcp", grantId: GRANT }
      }),
      requestFingerprint: instructionContentHash("b".repeat(64))
    });
    for (let index = 0; index < STORY_WORK_ASSIGNMENT_LIST_MAX; index += 1) {
      await assignments.create({
        assignment: bridgeAssignment(`assignment-visible-origin-${index}`, {
          idempotencyKey: `origin-${index}`,
          updatedAt: new Date(Date.UTC(2026, 9, 12, 12, 0, index)).toISOString(),
          origin: { kind: "mcp", grantId: GRANT }
        }),
        requestFingerprint: instructionContentHash(
          String.fromCharCode(97 + (index % 6)).repeat(64)
        )
      });
    }

    const runtime = Object.freeze({
      assignments
    }) as unknown as StoryWorkApiRuntime;
    const visible = await listGrantVisibleStoryWorkAssignments(
      runtime,
      grantRecord(["assignment-visible-pinned", "assignment-visible-shared"])
    );
    expect(visible).toHaveLength(STORY_WORK_ASSIGNMENT_LIST_MAX);
    expect(visible[0]?.id).toBe(pinnedId);
    expect(visible.some((assignment) => assignment.id === sharedId)).toBe(true);
    expect(new Set(visible.map((assignment) => assignment.id)).size).toBe(
      STORY_WORK_ASSIGNMENT_LIST_MAX
    );
  });
});

async function prepareBellwetherSceneHead(app: Awaited<ReturnType<typeof openBridgeApp>>["app"]) {
  const scenePath = `/api/projects/${PROJECT}/scenes/${BELLWETHER_SCENE_ID}`;
  expect((await app.request(`${scenePath}/workspace`)).status).toBe(200);
  expect(
    (
      await app.request(`${scenePath}/lease`, {
        method: "POST",
        headers: originHeaders("POST")
      })
    ).status
  ).toBe(200);
}
