import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  createAccountAiCollaborationProfile,
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository,
  createMemoryProviderCredentialRepository,
  createOpenAiProviderCredentialEnvelope,
  createProjectAgentInstructions,
  createProjectMembership,
  createProjectPlaybook,
  instructionContentHash,
  OPENAI_PROVIDER_ID,
  playbookId,
  projectId,
  providerCredentialStatusFromEnvelope,
  type AccountAiCollaborationProfileRepository,
  type OpenAiProviderCredentialEnvelope,
  type ProjectAgentInstructionsRepository,
  type ProjectPlaybookRepository,
  type ProviderCredentialRepository
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import {
  createPostgresAccountAiCollaborationProfileRepository,
  createPostgresProjectAgentInstructionsRepository,
  createPostgresProjectPlaybookRepository
} from "./postgres-agent-guidance-repository.js";
import { createPostgresProviderCredentialRepository } from "./postgres-provider-credential-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import {
  aiCollaborationProfiles,
  projectAgentInstructions,
  projectPlaybooks,
  providerCredentials,
  user
} from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER = accountId("account-guidance-postgres");
const OTHER_ACCOUNT = accountId("account-guidance-postgres-other");
const NOW = "2026-07-24T23:00:00.000Z";
const LATER = "2026-07-24T23:01:00.000Z";
const HASH = instructionContentHash("a".repeat(64));
const OPENAI_KEY_B64 = Buffer.from("sk-test-credential-material", "utf8").toString("base64");

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

function sampleEnvelope(
  input: Readonly<{
    accountId?: string;
    version?: number;
    kekVersion?: string;
    validationState?: OpenAiProviderCredentialEnvelope["validationState"];
    validatedAt?: string;
  }> = {}
): OpenAiProviderCredentialEnvelope {
  return createOpenAiProviderCredentialEnvelope({
    accountId: accountId(input.accountId ?? OWNER),
    provider: OPENAI_PROVIDER_ID,
    version: input.version ?? 1,
    kekVersion: input.kekVersion ?? "kek-v1",
    ciphertextB64: OPENAI_KEY_B64,
    ivB64: Buffer.from("0123456789abcdef").toString("base64"),
    authTagB64: Buffer.from("abcdef0123456789").toString("base64"),
    maskedHint: "…test",
    validationState: input.validationState ?? "unvalidated",
    createdAt: NOW,
    updatedAt: NOW,
    ...(input.validatedAt === undefined ? {} : { validatedAt: input.validatedAt })
  });
}

async function setupPostgresGuidance() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Guidance Owner",
      email: "guidance-owner@example.test",
      emailVerified: true
    },
    {
      id: OTHER_ACCOUNT,
      name: "Other Account",
      email: "guidance-other@example.test",
      emailVerified: true
    }
  ]);
  const repositoryDatabase = toRepositoryDatabase(db);
  const projectRepository = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projectRepository, BELLWETHER_FIXTURE);
  await projectRepository.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });

  return {
    db,
    credentials: createPostgresProviderCredentialRepository(repositoryDatabase),
    collaborationProfiles:
      createPostgresAccountAiCollaborationProfileRepository(repositoryDatabase),
    projectInstructions:
      createPostgresProjectAgentInstructionsRepository(repositoryDatabase),
    playbooks: createPostgresProjectPlaybookRepository(repositoryDatabase)
  };
}

function memoryGuidanceRepos(): Readonly<{
  credentials: ProviderCredentialRepository;
  collaborationProfiles: AccountAiCollaborationProfileRepository;
  projectInstructions: ProjectAgentInstructionsRepository;
  playbooks: ProjectPlaybookRepository;
}> {
  return {
    credentials: createMemoryProviderCredentialRepository(),
    collaborationProfiles: createMemoryAccountAiCollaborationProfileRepository(),
    projectInstructions: createMemoryProjectAgentInstructionsRepository(),
    playbooks: createMemoryProjectPlaybookRepository()
  };
}

describe("postgres provider credentials and agent guidance", () => {
  it("applies guidance migrations from an empty database", async () => {
    const { db } = await setupPostgresGuidance();
    expect(await db.select().from(providerCredentials)).toEqual([]);
    expect(await db.select().from(aiCollaborationProfiles)).toEqual([]);
    expect(await db.select().from(projectAgentInstructions)).toEqual([]);
    expect(await db.select().from(projectPlaybooks)).toEqual([]);
  });

  it("stores encrypted credential envelopes without plaintext columns", async () => {
    const { db, credentials } = await setupPostgresGuidance();
    const envelope = sampleEnvelope();
    const outcome = await credentials.upsert(envelope, undefined);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const status = providerCredentialStatusFromEnvelope(outcome.envelope);
    expect(JSON.stringify(status)).not.toContain("sk-test");
    expect(Object.keys(status)).not.toContain("ciphertextB64");
    expect(Object.keys(status)).not.toContain("plaintext");

    const [row] = await db.select().from(providerCredentials);
    expect(row?.ciphertextB64).toBe(OPENAI_KEY_B64);
    expect(row).not.toHaveProperty("plaintext");
    expect(Object.keys(row ?? {})).not.toContain("plaintext");
  });

  it("creates, rotates, validates, deletes, lists, and purges credentials by KEK version", async () => {
    const { credentials } = await setupPostgresGuidance();
    const created = await credentials.upsert(sampleEnvelope(), undefined);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rotated = await credentials.upsert(
      sampleEnvelope({ version: 2, kekVersion: "kek-v2", validationState: "unvalidated" }),
      1
    );
    expect(rotated.ok).toBe(true);

    const staleRotate = await credentials.upsert(
      sampleEnvelope({ version: 3 }),
      1
    );
    expect(staleRotate).toEqual({ ok: false, reason: "conflict" });

    const marked = await credentials.markValidation({
      accountId: OWNER,
      providerId: OPENAI_PROVIDER_ID,
      expectedVersion: 2,
      validationState: "valid",
      updatedAt: LATER,
      validatedAt: LATER
    });
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      expect(marked.envelope.validationState).toBe("valid");
      expect(marked.envelope.validatedAt).toBe(LATER);
    }

    const other = await credentials.upsert(
      sampleEnvelope({ accountId: OTHER_ACCOUNT, kekVersion: "kek-v1" }),
      undefined
    );
    expect(other.ok).toBe(true);

    const listed = await credentials.listByKekVersion("kek-v1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.accountId).toBe(OTHER_ACCOUNT);

    const purged = await credentials.deleteByKekVersion("kek-v1");
    expect(purged).toBe(1);
    expect(await credentials.get(OTHER_ACCOUNT, OPENAI_PROVIDER_ID)).toBeUndefined();
    expect(await credentials.get(OWNER, OPENAI_PROVIDER_ID)).toBeDefined();

    const deleted = await credentials.delete(OWNER, OPENAI_PROVIDER_ID, 2);
    expect(deleted).toEqual({ ok: true });
    expect(await credentials.delete(OWNER, OPENAI_PROVIDER_ID, 2)).toEqual({
      ok: false,
      reason: "not-found"
    });
  });

  it("serializes concurrent credential upserts with one winner", async () => {
    const { credentials } = await setupPostgresGuidance();
    const attempts = await Promise.all([
      credentials.upsert(sampleEnvelope(), undefined),
      credentials.upsert(sampleEnvelope(), undefined)
    ]);
    const winners = attempts.filter((attempt) => attempt.ok);
    const losers = attempts.filter((attempt) => !attempt.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ ok: false, reason: "conflict" }]);
  });

  it("saves skipped and full collaboration profiles with optimistic versioning", async () => {
    const { collaborationProfiles } = await setupPostgresGuidance();
    const skipped = createAccountAiCollaborationProfile({
      version: 1,
      setupSkipped: true,
      updatedAt: NOW
    });
    const created = await collaborationProfiles.upsert(OWNER, skipped, undefined);
    expect(created).toEqual({ ok: true, profile: skipped });

    const saved = await collaborationProfiles.upsert(
      OWNER,
      createAccountAiCollaborationProfile({
        version: 2,
        setupSkipped: false,
        posture: "minimal",
        boundaries: "No spoilers.",
        updatedAt: LATER
      }),
      1
    );
    expect(saved.ok).toBe(true);

    const race = await Promise.all([
      collaborationProfiles.upsert(
        OWNER,
        createAccountAiCollaborationProfile({
          version: 3,
          setupSkipped: false,
          posture: "options",
          updatedAt: LATER
        }),
        2
      ),
      collaborationProfiles.upsert(
        OWNER,
        createAccountAiCollaborationProfile({
          version: 3,
          setupSkipped: false,
          posture: "questions-first",
          updatedAt: LATER
        }),
        2
      )
    ]);
    expect(race.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(race.filter((outcome) => !outcome.ok)).toHaveLength(1);
  });

  it("persists project instructions with content hash and project foreign keys", async () => {
    const { projectInstructions } = await setupPostgresGuidance();
    const instructions = createProjectAgentInstructions({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      version: 1,
      body: "Keep the harbor foggy.",
      contentHash: HASH,
      createdAt: NOW,
      updatedAt: NOW
    });
    const created = await projectInstructions.upsert(instructions, undefined);
    expect(created.ok).toBe(true);
    const loaded = await projectInstructions.get(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(loaded?.contentHash).toBe(HASH);

    const missingProject = projectId("project-missing-guidance");
    await expect(
      projectInstructions.upsert(
        createProjectAgentInstructions({
          projectId: missingProject,
          version: 1,
          body: "Orphan.",
          contentHash: HASH,
          createdAt: NOW,
          updatedAt: NOW
        }),
        undefined
      )
    ).rejects.toMatchObject({
      cause: { code: "23503" }
    });
  });

  it("creates, updates, archives, lists, and scopes playbooks without cross-project leakage", async () => {
    const { playbooks } = await setupPostgresGuidance();
    const playbook = createProjectPlaybook({
      id: playbookId("playbook-postgres-1"),
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      version: 1,
      name: "Harbor reflection",
      enabled: true,
      trigger: "capture-reflection",
      allowedContextClasses: ["capture"],
      outputSchemaId: "capture-reflection-v1",
      guidance: "Ask about mood.",
      guidanceHash: HASH,
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(await playbooks.create(playbook)).toEqual({ ok: true, playbook });
    expect(await playbooks.create(playbook)).toEqual({ ok: false, reason: "conflict" });

    const updated = createProjectPlaybook({
      ...playbook,
      version: 2,
      enabled: false,
      updatedAt: LATER
    });
    expect(await playbooks.update(updated, 1)).toEqual({ ok: true, playbook: updated });
    expect(await playbooks.update(updated, 1)).toEqual({ ok: false, reason: "conflict" });
    expect(await playbooks.update(updated, 99)).toEqual({ ok: false, reason: "conflict" });

    const archived = createProjectPlaybook({
      ...updated,
      version: 3,
      archivedAt: LATER,
      updatedAt: LATER
    });
    expect(await playbooks.update(archived, 2)).toEqual({ ok: true, playbook: archived });

    const activeOnly = await playbooks.listByProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(activeOnly).toHaveLength(0);
    const withArchived = await playbooks.listByProject(BELLWETHER_FIXTURE_PROJECT_ID, {
      includeArchived: true,
      limit: 5
    });
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0]?.id).toBe(playbook.id);

    const crossProjectLookup = await playbooks.get(playbook.id);
    expect(crossProjectLookup?.projectId).toBe(BELLWETHER_FIXTURE_PROJECT_ID);

    const missing = createProjectPlaybook({
      ...archived,
      id: playbookId("playbook-missing"),
      version: 1
    });
    expect(await playbooks.update(missing, 1)).toEqual({ ok: false, reason: "not-found" });
  });

  it("matches memory repository outcomes for credential and guidance ports", async () => {
    const memory = memoryGuidanceRepos();
    const postgres = await setupPostgresGuidance();

    const envelope = sampleEnvelope({ accountId: "account-memory-parity" });
    await postgres.db.insert(user).values({
      id: "account-memory-parity",
      name: "Parity Account",
      email: "parity@example.test",
      emailVerified: true
    });

    const memoryCredential = await memory.credentials.upsert(envelope, undefined);
    const postgresCredential = await postgres.credentials.upsert(envelope, undefined);
    expect(postgresCredential).toEqual(memoryCredential);

    const skipped = createAccountAiCollaborationProfile({
      version: 1,
      setupSkipped: true,
      updatedAt: NOW
    });
    const parityAccount = accountId("account-memory-parity");
    const memoryProfile = await memory.collaborationProfiles.upsert(
      parityAccount,
      skipped,
      undefined
    );
    const postgresProfile = await postgres.collaborationProfiles.upsert(
      parityAccount,
      skipped,
      undefined
    );
    expect(postgresProfile).toEqual(memoryProfile);

    const instructions = createProjectAgentInstructions({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      version: 1,
      body: "Parity body",
      contentHash: HASH,
      createdAt: NOW,
      updatedAt: NOW
    });
    const memoryInstructions = await memory.projectInstructions.upsert(instructions, undefined);
    const postgresInstructions = await postgres.projectInstructions.upsert(
      instructions,
      undefined
    );
    expect(postgresInstructions).toEqual(memoryInstructions);

    const playbook = createProjectPlaybook({
      id: playbookId("playbook-parity"),
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      version: 1,
      name: "Parity playbook",
      enabled: true,
      trigger: "manual",
      allowedContextClasses: ["capture"],
      outputSchemaId: "capture-reflection-v1",
      guidance: "Stay declarative.",
      guidanceHash: HASH,
      createdAt: NOW,
      updatedAt: NOW
    });
    const memoryPlaybook = await memory.playbooks.create(playbook);
    const postgresPlaybook = await postgres.playbooks.create(playbook);
    expect(postgresPlaybook).toEqual(memoryPlaybook);
  });
});
