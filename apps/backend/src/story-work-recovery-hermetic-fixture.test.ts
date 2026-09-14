import { afterEach, describe, expect, it } from "vitest";
import {
  HARRY_POTTER_FIXTURE,
  createBookReaderServices,
  createCanvasServices,
  createCaptureAttachmentServices,
  createCapturePromotionServices,
  createCaptureServices,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryCaptureObjectStorage,
  createMemoryWriterProfileRepository,
  createProjectMembership,
  createSceneWritingServices
} from "@ghostwriter/core";
import {
  createPostgresAgentProposalRepository,
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
  createPostgresCaptureAttachmentRepository,
  createPostgresCaptureDocumentRepository,
  createPostgresCaptureScenePromotionUnitOfWork,
  createPostgresProjectRepository,
  createPostgresSceneDocumentRepository,
  seedProject,
  toRepositoryDatabase,
  user
} from "@ghostwriter/storage";
import {
  createPgliteDatabase,
  migratePgliteRepositoryDatabase
} from "@ghostwriter/storage/pglite";
import { createApp } from "./app.js";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";
import { createTestAgentProviderRuntime } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import {
  E2E_HERMETIC_WRITER_ACCOUNT_ID,
  E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
  E2E_STORY_WORK_RECOVERY_BRIEF,
  E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID,
  E2E_STORY_WORK_RECOVERY_PROJECT_ID,
  E2E_STORY_WORK_RECOVERY_RUN_ID,
  e2eHermeticWriterAccountId,
  seedE2eHermeticStoryWorkRecoveryFixture
} from "./story-work-recovery-hermetic-fixture.js";

const E2E_ORIGIN = "http://127.0.0.1:4173";
const E2E_SESSION: AuthenticatedSession = {
  account: {
    id: E2E_HERMETIC_WRITER_ACCOUNT_ID,
    name: "E2E Writer",
    email: "writer@example.test",
    emailVerified: true
  },
  session: {
    id: "session-e2e-writer",
    expiresAt: "2099-07-18T19:00:00.000Z"
  }
};

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

function e2eAuth(): AuthGateway {
  return {
    async handler() {
      return Response.json({ error: "Not used in fixture tests." }, { status: 404 });
    },
    async getSession() {
      return E2E_SESSION;
    },
    async ensureDemoCredentialAccount() {},
    async signInDemo() {
      return Response.json({ ok: true });
    }
  };
}

async function createHermeticAppWithRecoveryFixture() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values(E2E_SESSION.account);
  const repositoryDatabase = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(repositoryDatabase);
  const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
  const captureDocuments = createPostgresCaptureDocumentRepository(repositoryDatabase);
  const captureAttachmentsRepository =
    createPostgresCaptureAttachmentRepository(repositoryDatabase);
  const objectStorage = createMemoryCaptureObjectStorage();
  const canvases = createPostgresCanvasRepository(repositoryDatabase);
  await seedProject(projects, HARRY_POTTER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
        accountId: e2eHermeticWriterAccountId(),
        role: "owner",
        createdAt: "2026-07-25T12:00:00.000Z"
      })
    );
  });
  const seeded = await seedE2eHermeticStoryWorkRecoveryFixture({
    db: repositoryDatabase,
    ownerAccountId: e2eHermeticWriterAccountId()
  });
  let nextId = 0;
  const ids = {
    create: (kind: string) => {
      nextId += 1;
      return `${kind}-e2e-fixture-${nextId}`;
    }
  };
  const clock = { now: () => "2026-09-13T19:05:00.000Z" };
  const services = createGhostwriterServices({ projects, ids, clock });
  const writing = createSceneWritingServices({
    projects,
    sceneDocuments,
    ids,
    clock
  });
  const captures = createCaptureServices({
    projects,
    captureDocuments,
    ids,
    clock
  });
  const captureAttachments = createCaptureAttachmentServices({
    projects,
    captureDocuments,
    attachments: captureAttachmentsRepository,
    objectStorage,
    ids,
    clock
  });
  const capturePromotions = createCapturePromotionServices({
    projects,
    captureDocuments,
    canvases,
    promotion: createPostgresCaptureScenePromotionUnitOfWork(repositoryDatabase),
    ids,
    clock
  });
  const canvas = createCanvasServices({
    projects,
    canvases,
    sceneDocuments,
    sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase),
    ids,
    clock
  });
  const reader = createBookReaderServices({
    projects,
    sceneDocuments,
    canvases
  });
  const identity = createIdentityServices({
    profiles: createMemoryWriterProfileRepository(),
    clock
  });
  const agentProvider = createTestAgentProviderRuntime({
    db: repositoryDatabase,
    projects,
    captureDocuments,
    ids,
    clock,
    kekConfig: createTestProviderKekRuntimeConfig(),
    capturePromotions,
    sceneDocuments
  });
  const proposals = createPostgresAgentProposalRepository(repositoryDatabase);
  const app = createApp({
    services,
    writing,
    captures,
    captureAttachments,
    capturePromotions,
    canvas,
    reader,
    identity,
    agentProvider,
    auth: e2eAuth(),
    allowedOrigins: [E2E_ORIGIN],
    objectStorage
  });
  return { app, proposals, projects, seeded };
}

describe("E2E hermetic story-work recovery fixture", () => {
  it("seeds a running assignment with active-or-interrupted recovery and no proposal/canon", async () => {
    const { app, proposals, projects, seeded } =
      await createHermeticAppWithRecoveryFixture();
    const knowledgeBefore = HARRY_POTTER_FIXTURE.storyKnowledge.some(
      (row) => row.id === E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID
    );
    expect(knowledgeBefore).toBe(false);

    const list = await app.request(seeded.listPath);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    const listed = listBody.assignments.find(
      (row: { id: string }) => row.id === E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID
    );
    expect(listed).toMatchObject({
      id: E2E_STORY_WORK_RECOVERY_ASSIGNMENT_ID,
      brief: E2E_STORY_WORK_RECOVERY_BRIEF,
      status: "running",
      version: 2,
      activeAttemptId: E2E_STORY_WORK_RECOVERY_RUN_ID,
      latestAttemptId: E2E_STORY_WORK_RECOVERY_RUN_ID
    });

    const detail = await app.request(seeded.detailPath);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.assignment).toMatchObject({
      status: "running",
      version: 2,
      brief: E2E_STORY_WORK_RECOVERY_BRIEF
    });
    expect(detailBody.recovery).toMatchObject({
      status: "active-or-interrupted",
      runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
      expectedAssignmentVersion: 2,
      actions: ["cancel", "mark-interrupted"]
    });
    expect(detailBody.run).toMatchObject({
      id: E2E_STORY_WORK_RECOVERY_RUN_ID,
      status: "running"
    });
    expect(detailBody.attempt.completedAt).toBeUndefined();

    const proposalsBefore = await proposals.listByProject(E2E_STORY_WORK_RECOVERY_PROJECT_ID);
    expect(proposalsBefore).toHaveLength(0);

    const recovered = await app.request(seeded.recoverPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: E2E_ORIGIN
      },
      body: JSON.stringify({
        expectedAssignmentVersion: 2,
        runId: E2E_STORY_WORK_RECOVERY_RUN_ID,
        action: "mark-interrupted"
      })
    });
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.json();
    expect(recoveredBody.assignment.status).toBe("failed");
    expect(recoveredBody.run).toMatchObject({
      status: "failed",
      terminalDiagnosticCode: "client-interrupted"
    });

    const proposalsAfter = await proposals.listByProject(E2E_STORY_WORK_RECOVERY_PROJECT_ID);
    expect(proposalsAfter).toHaveLength(0);
    const storyKnowledge = await projects.listStoryKnowledge(
      E2E_STORY_WORK_RECOVERY_PROJECT_ID
    );
    expect(
      storyKnowledge.some((row) => row.id === E2E_STORY_WORK_RECOVERY_KNOWLEDGE_ID)
    ).toBe(false);
  });

  it("is idempotent when the assignment already exists", async () => {
    const { db, close } = createPgliteDatabase();
    closers.push(close);
    await migratePgliteRepositoryDatabase(db);
    await db.insert(user).values(E2E_SESSION.account);
    const repositoryDatabase = toRepositoryDatabase(db);
    const projects = createPostgresProjectRepository(repositoryDatabase);
    await seedProject(projects, HARRY_POTTER_FIXTURE);
    await projects.transaction((writer) => {
      writer.insertProjectMembership(
        createProjectMembership({
          projectId: E2E_STORY_WORK_RECOVERY_PROJECT_ID,
          accountId: e2eHermeticWriterAccountId(),
          role: "owner",
          createdAt: "2026-07-25T12:00:00.000Z"
        })
      );
    });
    const owner = e2eHermeticWriterAccountId();
    const first = await seedE2eHermeticStoryWorkRecoveryFixture({
      db: repositoryDatabase,
      ownerAccountId: owner
    });
    const second = await seedE2eHermeticStoryWorkRecoveryFixture({
      db: repositoryDatabase,
      ownerAccountId: owner
    });
    expect(second).toEqual(first);
  });
});
