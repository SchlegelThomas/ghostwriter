import { describe, expect, it } from "vitest";
import type { AsyncHashPort } from "./agent-domain.js";
import {
  AgentGuidanceConflictError,
  AgentGuidanceNotFoundError,
  createAgentGuidanceServices
} from "./agent-guidance-services.js";
import {
  createMemoryAccountAiCollaborationProfileRepository,
  createMemoryProjectAgentInstructionsRepository,
  createMemoryProjectPlaybookRepository
} from "./memory-agent-guidance-repository.js";
import { createMemoryProviderCredentialRepository } from "./memory-provider-credential-repository.js";
import {
  createProviderCredentialServices,
  type ProviderCredentialServiceDependencies
} from "./provider-credential-services.js";
import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  OPENAI_PROVIDER_ID,
  PROVIDER_CREDENTIAL_ENVELOPE_FORMAT_VERSION,
  ProviderCredentialAuthorizationError,
  ProviderCredentialConflictError,
  ProviderCredentialCryptoContextError,
  ProviderCredentialKeyRejectedError,
  ProviderCredentialNotFoundError,
  ProviderCredentialUnavailableError,
  createOpenAiProviderCredentialEnvelope,
  type ProviderCredentialCryptoPort,
  type ProviderCredentialDecryptInput,
  type ProviderCredentialEncryptInput,
  type ProviderId
} from "./provider-credentials.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { accountId, createProjectMembership } from "./identity.js";
import { BELLWETHER_FIXTURE, BELLWETHER_FIXTURE_PROJECT_ID } from "./fixtures.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import type { AccountId } from "./identity.js";
import type { DomainIdKind, IdGenerator } from "./project-repository.js";

const OWNER = accountId("account-guidance-owner");

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Platform-neutral base64 helpers — avoid Node `Buffer` in core typecheck. */
function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple =
      (a << 16) |
      ((b ?? 0) << 8) |
      (c ?? 0);
    output += BASE64_ALPHABET[(triple >> 18) & 63];
    output += BASE64_ALPHABET[(triple >> 12) & 63];
    output += b === undefined ? "=" : BASE64_ALPHABET[(triple >> 6) & 63];
    output += c === undefined ? "=" : BASE64_ALPHABET[triple & 63];
  }
  return output;
}

function base64ToUtf8(value: string): string {
  const cleaned = value.replace(/=+$/u, "");
  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 4) {
    const enc1 = BASE64_ALPHABET.indexOf(cleaned[index] ?? "");
    const enc2 = BASE64_ALPHABET.indexOf(cleaned[index + 1] ?? "");
    const enc3 = BASE64_ALPHABET.indexOf(cleaned[index + 2] ?? "A");
    const enc4 = BASE64_ALPHABET.indexOf(cleaned[index + 3] ?? "A");
    const triple = (enc1 << 18) | (enc2 << 12) | (enc3 << 6) | enc4;
    bytes.push((triple >> 16) & 255);
    if (cleaned[index + 2] !== undefined && cleaned[index + 2] !== "=") {
      bytes.push((triple >> 8) & 255);
    }
    if (cleaned[index + 3] !== undefined && cleaned[index + 3] !== "=") {
      bytes.push(triple & 255);
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
const STRANGER = accountId("account-guidance-stranger");
const NOW = "2026-07-24T22:00:00.000Z";
const OPENAI_KEY = `sk-${"a".repeat(40)}`;

function createTestHashPort(): AsyncHashPort {
  return Object.freeze({
    async digestSha256Hex(value: string): Promise<string> {
      let hash = 0n;
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 131n + BigInt(value.charCodeAt(index))) & ((1n << 256n) - 1n);
      }
      return hash.toString(16).padStart(64, "0");
    }
  });
}

function createSequenceIds(values: Partial<Record<DomainIdKind, readonly string[]>>): IdGenerator {
  const positions = new Map<DomainIdKind, number>();
  return {
    create(kind) {
      const list = values[kind] ?? [`generated-${kind}`];
      const index = positions.get(kind) ?? 0;
      positions.set(kind, index + 1);
      return list[index] ?? `${kind}-${index}`;
    }
  };
}

function providerCredentialAad(input: Readonly<{
  accountId: AccountId;
  provider: ProviderId;
}>): string {
  return canonicalJsonStringify({
    accountId: String(input.accountId),
    provider: input.provider,
    envelopeFormatVersion: PROVIDER_CREDENTIAL_ENVELOPE_FORMAT_VERSION
  });
}

function createFakeCrypto(): ProviderCredentialCryptoPort & {
  encryptCalls: readonly ProviderCredentialEncryptInput[];
  decryptCalls: readonly ProviderCredentialDecryptInput[];
} {
  const encryptCalls: ProviderCredentialEncryptInput[] = [];
  const decryptCalls: ProviderCredentialDecryptInput[] = [];
  return Object.freeze({
    get encryptCalls() {
      return Object.freeze([...encryptCalls]);
    },
    get decryptCalls() {
      return Object.freeze([...decryptCalls]);
    },
    async encrypt(input) {
      encryptCalls.push(input);
      const payload = canonicalJsonStringify({
        aad: providerCredentialAad(input),
        plaintext: input.plaintext
      });
      return Object.freeze({
        kekVersion: "kek-v1",
        ciphertextB64: utf8ToBase64(payload),
        ivB64: utf8ToBase64("0123456789abcdef"),
        authTagB64: utf8ToBase64("abcdef0123456789")
      });
    },
    async decrypt(input) {
      decryptCalls.push(input);
      const payload = JSON.parse(base64ToUtf8(input.material.ciphertextB64)) as {
        aad: string;
        plaintext: string;
      };
      if (payload.aad !== providerCredentialAad(input)) {
        throw new ProviderCredentialCryptoContextError();
      }
      return payload.plaintext;
    }
  });
}

function createCredentialHarness(
  crypto: ProviderCredentialCryptoPort = createFakeCrypto()
) {
  const credentials = createMemoryProviderCredentialRepository();
  let tick = 0;
  const services = createProviderCredentialServices({
    credentials,
    crypto,
    clock: {
      now: () => {
        tick += 1;
        return `2026-07-24T22:00:${String(tick).padStart(2, "0")}.000Z`;
      }
    }
  } satisfies ProviderCredentialServiceDependencies);
  return { services, credentials, crypto };
}

function createGuidanceHarness(options?: {
  projects?: ReturnType<typeof createMemoryProjectRepository>;
}) {
  const projects =
    options?.projects ??
    createMemoryProjectRepository(
      [BELLWETHER_FIXTURE],
      [
        createProjectMembership({
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          accountId: OWNER,
          role: "owner",
          createdAt: NOW
        })
      ]
    );
  const collaborationProfiles = createMemoryAccountAiCollaborationProfileRepository();
  const projectInstructions = createMemoryProjectAgentInstructionsRepository();
  const playbooks = createMemoryProjectPlaybookRepository();
  let tick = 0;
  const services = createAgentGuidanceServices({
    projects,
    collaborationProfiles,
    projectInstructions,
    playbooks,
    hashPort: createTestHashPort(),
    ids: createSequenceIds({ playbook: ["playbook-guidance-1", "playbook-guidance-2"] }),
    clock: {
      now: () => {
        tick += 1;
        return `2026-07-24T22:01:${String(tick).padStart(2, "0")}.000Z`;
      }
    }
  });
  return { services, projects, collaborationProfiles, projectInstructions, playbooks };
}

describe("provider credential services", () => {
  it("stores encrypted envelopes without returning plaintext in status or errors", async () => {
    const crypto = createFakeCrypto();
    const { services } = createCredentialHarness(crypto);
    const status = await services.setOpenAiCredential({
      accountId: OWNER,
      plaintext: OPENAI_KEY
    });
    expect(crypto.encryptCalls[0]?.accountId).toBe(OWNER);
    expect(crypto.encryptCalls[0]?.provider).toBe(OPENAI_PROVIDER_ID);
    expect(status.provider).toBe("openai");
    expect(status.version).toBe(1);
    expect(status.maskedHint).toBe(`…${OPENAI_KEY.slice(-4)}`);
    expect(status.validationState).toBe("unvalidated");
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(OPENAI_KEY);
    expect(serialized).not.toMatch(/ciphertext|authTag|iv/i);
    await expect(
      services.setOpenAiCredential({ accountId: OWNER, plaintext: "bad key with spaces" })
    ).rejects.toBeInstanceOf(ProviderCredentialKeyRejectedError);
    expect(JSON.stringify(new ProviderCredentialKeyRejectedError())).not.toContain("bad key");
  });

  it("rotates with optimistic version, conflicts, deletes, and purges by kek version", async () => {
    const { services, credentials } = createCredentialHarness();
    const first = await services.setOpenAiCredential({
      accountId: OWNER,
      plaintext: OPENAI_KEY
    });
    await expect(
      services.setOpenAiCredential({
        accountId: OWNER,
        plaintext: OPENAI_KEY,
        expectedVersion: 99
      })
    ).rejects.toBeInstanceOf(ProviderCredentialConflictError);
    const rotated = await services.setOpenAiCredential({
      accountId: OWNER,
      plaintext: OPENAI_KEY,
      expectedVersion: first.version
    });
    expect(rotated.version).toBe(2);
    await services.markOpenAiCredentialValidation({
      accountId: OWNER,
      expectedVersion: rotated.version,
      validationState: "valid"
    });
    await services.deleteOpenAiCredential({
      accountId: OWNER,
      expectedVersion: rotated.version
    });
    await expect(
      services.getOpenAiCredentialStatus(OWNER)
    ).resolves.toBeUndefined();
    await services.setOpenAiCredential({ accountId: OWNER, plaintext: OPENAI_KEY });
    const stored = await credentials.get(OWNER, OPENAI_PROVIDER_ID);
    expect(stored?.ciphertextB64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    expect(await services.revokeOpenAiCredentialsForKekVersion("kek-v1")).toBe(1);
    expect(await credentials.get(OWNER, OPENAI_PROVIDER_ID)).toBeUndefined();
  });

  it("decrypts only through the authorized backend seam when valid", async () => {
    const crypto = createFakeCrypto();
    const { services } = createCredentialHarness(crypto);
    await services.setOpenAiCredential({ accountId: OWNER, plaintext: OPENAI_KEY });
    await expect(
      services.decryptOpenAiCredentialForAuthorizedRun({
        kind: "backend-provider-adapter",
        accountId: OWNER
      })
    ).rejects.toBeInstanceOf(ProviderCredentialUnavailableError);
    const status = await services.setOpenAiCredential({
      accountId: OWNER,
      plaintext: OPENAI_KEY,
      expectedVersion: 1
    });
    await services.markOpenAiCredentialValidation({
      accountId: OWNER,
      expectedVersion: status.version,
      validationState: "valid"
    });
    const plaintext = await services.decryptOpenAiCredentialForAuthorizedRun({
      kind: "backend-provider-adapter",
      accountId: OWNER
    });
    expect(plaintext).toBe(OPENAI_KEY);
    expect(crypto.decryptCalls.at(-1)?.accountId).toBe(OWNER);
    expect(crypto.decryptCalls.at(-1)?.provider).toBe(OPENAI_PROVIDER_ID);
    await expect(
      services.decryptOpenAiCredentialForAuthorizedRun({
        kind: "backend-provider-adapter" as const,
        accountId: STRANGER
      })
    ).rejects.toBeInstanceOf(ProviderCredentialNotFoundError);
    await expect(
      services.decryptOpenAiCredentialForAuthorizedRun({
        kind: "backend-provider-adapter",
        accountId: OWNER
      })
    ).resolves.toBe(OPENAI_KEY);
  });

  it("rejects decrypt when copied envelope material belongs to another account", async () => {
    const crypto = createFakeCrypto();
    const { services, credentials } = createCredentialHarness(crypto);
    await services.setOpenAiCredential({ accountId: OWNER, plaintext: OPENAI_KEY });
    const stolen = await credentials.get(OWNER, OPENAI_PROVIDER_ID);
    if (stolen === undefined) {
      throw new Error("Expected an owner credential envelope.");
    }
    await credentials.upsert(
      createOpenAiProviderCredentialEnvelope({
        ...stolen,
        accountId: STRANGER,
        validationState: "valid",
        validatedAt: NOW
      }),
      undefined
    );
    await expect(
      services.decryptOpenAiCredentialForAuthorizedRun({
        kind: "backend-provider-adapter",
        accountId: STRANGER
      })
    ).rejects.toBeInstanceOf(ProviderCredentialCryptoContextError);
    expect(JSON.stringify(new ProviderCredentialCryptoContextError())).not.toContain(
      OPENAI_KEY
    );
  });

  it("rejects unauthorized decrypt authorization kinds", async () => {
    const { services } = createCredentialHarness();
    await expect(
      services.decryptOpenAiCredentialForAuthorizedRun({
        kind: "backend-provider-adapter",
        accountId: OWNER
      })
    ).rejects.toBeInstanceOf(ProviderCredentialNotFoundError);
    await expect(
      services.decryptOpenAiCredentialForAuthorizedRun({
        kind: "ui-client" as "backend-provider-adapter",
        accountId: OWNER
      })
    ).rejects.toBeInstanceOf(ProviderCredentialAuthorizationError);
  });

  it("serializes memory credential writes for concurrent upserts", async () => {
    const credentials = createMemoryProviderCredentialRepository();
    const crypto = createFakeCrypto();
    const services = createProviderCredentialServices({
      credentials,
      crypto,
      clock: { now: () => NOW }
    });
    const attempts = await Promise.allSettled([
      services.setOpenAiCredential({ accountId: OWNER, plaintext: OPENAI_KEY }),
      services.setOpenAiCredential({ accountId: OWNER, plaintext: OPENAI_KEY })
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe("agent guidance services", () => {
  it("skips or saves collaboration profiles without publishing-shaped fields", async () => {
    const { services } = createGuidanceHarness();
    const skipped = await services.skipAccountAiCollaborationSetup({ accountId: OWNER });
    expect(skipped.setupSkipped).toBe(true);
    expect(skipped.posture).toBeUndefined();
    expect(JSON.stringify(skipped)).not.toMatch(/legalName|publishing|biography/i);
    const saved = await services.saveAccountAiCollaborationProfile({
      accountId: OWNER,
      expectedVersion: skipped.version,
      posture: "minimal",
      boundaries: "No spoilers."
    });
    expect(saved.setupSkipped).toBe(false);
    expect(saved.posture).toBe("minimal");
    await expect(
      services.saveAccountAiCollaborationProfile({
        accountId: OWNER,
        expectedVersion: 1,
        posture: "options"
      })
    ).rejects.toBeInstanceOf(AgentGuidanceConflictError);
  });

  it("reads and writes project instructions with hashes and owner checks", async () => {
    const { services } = createGuidanceHarness();
    await expect(
      services.getProjectAgentInstructions({
        accountId: STRANGER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID
      })
    ).rejects.toBeInstanceOf(AgentGuidanceNotFoundError);
    const saved = await services.saveProjectAgentInstructions({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      body: "Keep the harbor foggy."
    });
    expect(saved.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    const loaded = await services.getProjectAgentInstructions({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    expect(loaded?.body).toBe("Keep the harbor foggy.");
    await expect(
      services.saveProjectAgentInstructions({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        expectedVersion: 99,
        body: "Changed."
      })
    ).rejects.toBeInstanceOf(AgentGuidanceConflictError);
  });

  it("refuses instruction and playbook mutations on archived projects", async () => {
    const projects = createMemoryProjectRepository(
      [
        {
          ...BELLWETHER_FIXTURE,
          project: { ...BELLWETHER_FIXTURE.project, archivedAt: NOW }
        }
      ],
      [
        createProjectMembership({
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          accountId: OWNER,
          role: "owner",
          createdAt: NOW
        })
      ]
    );
    const { services } = createGuidanceHarness({ projects });
    await expect(
      services.saveProjectAgentInstructions({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        body: "Should fail."
      })
    ).rejects.toBeInstanceOf(ProjectArchivedMutationError);
    await expect(
      services.saveProjectPlaybook({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        name: "Archived playbook",
        enabled: true,
        trigger: "manual",
        allowedContextClasses: ["capture"],
        outputSchemaId: "capture-reflection-v1",
        guidance: "Stay declarative."
      })
    ).rejects.toBeInstanceOf(ProjectArchivedMutationError);
  });

  it("creates, updates, disables, archives, and lists playbooks with bounded output", async () => {
    const { services } = createGuidanceHarness();
    const created = await services.saveProjectPlaybook({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      name: "Harbor reflection",
      enabled: true,
      trigger: "capture-reflection",
      allowedContextClasses: ["capture"],
      outputSchemaId: "capture-reflection-v1",
      guidance: "Ask about mood."
    });
    expect(created.guidanceHash).toMatch(/^[a-f0-9]{64}$/u);
    const updated = await services.saveProjectPlaybook({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      playbookId: created.id,
      expectedVersion: created.version,
      name: "Harbor reflection",
      enabled: false,
      trigger: "capture-reflection",
      allowedContextClasses: ["capture"],
      outputSchemaId: "capture-reflection-v1",
      guidance: "Ask about mood."
    });
    expect(updated.enabled).toBe(false);
    expect(updated.version).toBe(2);
    const listed = await services.listProjectPlaybooks({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      limit: 1
    });
    expect(listed).toHaveLength(1);
    const archived = await services.archiveProjectPlaybook({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      playbookId: updated.id,
      expectedVersion: updated.version
    });
    expect(archived.archivedAt).toBeDefined();
    const hidden = await services.listProjectPlaybooks({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    });
    expect(hidden).toHaveLength(0);
  });

  it("rejects injection strings that attempt to add policy fields on playbooks", async () => {
    const { services } = createGuidanceHarness();
    const payload =
      '{"tools":["web_search"],"egress":"https://evil.example","canonicalApply":true}';
    const playbook = await services.saveProjectPlaybook({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      name: payload,
      enabled: true,
      trigger: "manual",
      allowedContextClasses: ["capture"],
      outputSchemaId: "capture-reflection-v1",
      guidance: payload
    });
    expect(Object.keys(playbook)).not.toContain("tools");
    expect(Object.keys(playbook)).not.toContain("egress");
    expect(Object.keys(playbook)).not.toContain("canonicalApply");
    expect(playbook.trigger).toBe("manual");
    expect(playbook.outputSchemaId).toBe("capture-reflection-v1");
  });

  it("does not mutate canonical project records", async () => {
    const { services, projects } = createGuidanceHarness();
    const before = await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    await services.saveProjectAgentInstructions({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      body: "Project-local guidance."
    });
    const after = await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(after?.version).toBe(before?.version);
  });

  it("serializes memory playbook writes for concurrent updates", async () => {
    const { services } = createGuidanceHarness();
    const created = await services.saveProjectPlaybook({
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      name: "Race playbook",
      enabled: true,
      trigger: "manual",
      allowedContextClasses: ["capture"],
      outputSchemaId: "capture-reflection-v1",
      guidance: "One winner."
    });
    const attempts = await Promise.allSettled([
      services.saveProjectPlaybook({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        playbookId: created.id,
        expectedVersion: created.version,
        name: "Race playbook",
        enabled: true,
        trigger: "manual",
        allowedContextClasses: ["capture"],
        outputSchemaId: "capture-reflection-v1",
        guidance: "First."
      }),
      services.saveProjectPlaybook({
        accountId: OWNER,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        playbookId: created.id,
        expectedVersion: created.version,
        name: "Race playbook",
        enabled: true,
        trigger: "manual",
        allowedContextClasses: ["capture"],
        outputSchemaId: "capture-reflection-v1",
        guidance: "Second."
      })
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe("provider credential envelope factory", () => {
  it("rejects incoherent base64 material", () => {
    expect(() =>
      createOpenAiProviderCredentialEnvelope({
        accountId: OWNER,
        provider: "openai",
        version: 1,
        kekVersion: "kek-v1",
        ciphertextB64: "not base64 spaces",
        ivB64: utf8ToBase64("0123456789abcdef"),
        authTagB64: utf8ToBase64("abcdef0123456789"),
        maskedHint: "…1234",
        validationState: "unvalidated",
        createdAt: NOW,
        updatedAt: NOW
      })
    ).toThrow();
  });
});
