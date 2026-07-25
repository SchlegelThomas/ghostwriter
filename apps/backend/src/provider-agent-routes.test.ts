import { describe, expect, it, afterEach } from "vitest";
import { aiDiagnostic } from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_PROJECT_ID } from "@ghostwriter/core";
import type { OpenAiValidationProviderFactory } from "./agent-provider-runtime.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN
} from "./test-backend-app.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const OPENAI_KEY = "sk-valid-openai-key-1234567890";

function originHeaders(method: string): Record<string, string> {
  return method === "GET"
    ? {}
    : {
        origin: TEST_ORIGIN,
        "content-type": "application/json"
      };
}

function validationFactory(valid: boolean): OpenAiValidationProviderFactory {
  return () =>
    Object.freeze({
      async validateCredential() {
        return valid
          ? { ok: true as const }
          : { ok: false as const, diagnostic: aiDiagnostic("auth_failed") };
      },
      async completeStructured() {
        return { ok: false as const, diagnostic: aiDiagnostic("upstream_error") };
      }
    });
}

type SeededApp = Awaited<ReturnType<typeof createSeededBackendApp>>;

async function openSeededApp(
  options?: Readonly<{
    callsDisabled?: boolean;
    kekConfig?: ReturnType<typeof createTestProviderKekRuntimeConfig> | undefined;
    openAiValidationProviderFactory?: OpenAiValidationProviderFactory;
    auth?: import("./auth.js").AuthGateway;
  }>
): Promise<SeededApp> {
  return createSeededBackendApp(options?.auth, {
    kekConfig: options?.kekConfig,
    callsDisabled: options?.callsDisabled,
    openAiValidationProviderFactory: options?.openAiValidationProviderFactory
  });
}

afterEach(async () => {
  const { testBackendClosers } = await import("./test-backend-app.js");
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

describe("provider and agent guidance routes", () => {
  it("requires authentication and trusted origin for mutations", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      auth: {
        handler: () => Response.json({ auth: "handled" }),
        getSession: async () => null
      }
    });
    expect((await app.request("/api/me/provider/openai")).status).toBe(401);

    const authed = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const missingOrigin = await authed.app.request("/api/me/provider/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: OPENAI_KEY })
    });
    expect(missingOrigin.status).toBe(403);
  });

  it("returns provider status without envelope material or secrets", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const initialBody = await (await app.request("/api/me/provider/openai")).json();
    expect(initialBody).toEqual({ configured: false, callsDisabled: false });

    const saved = await app.request("/api/me/provider/openai", {
      method: "PUT",
      headers: originHeaders("PUT"),
      body: JSON.stringify({ apiKey: OPENAI_KEY })
    });
    const savedBody = await saved.json();
    expect(savedBody.configured).toBe(true);
    expect(JSON.stringify(savedBody)).not.toContain(OPENAI_KEY);
    expect(savedBody).not.toHaveProperty("ciphertextB64");
  });

  it("rotates, conflicts, and deletes credentials", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const firstBody = await (
      await app.request("/api/me/provider/openai", {
        method: "PUT",
        headers: originHeaders("PUT"),
        body: JSON.stringify({ apiKey: OPENAI_KEY })
      })
    ).json();

    const rotated = await app.request("/api/me/provider/openai", {
      method: "PUT",
      headers: originHeaders("PUT"),
      body: JSON.stringify({ apiKey: OPENAI_KEY, expectedVersion: firstBody.version })
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = await rotated.json();
    expect(rotatedBody.version).toBe(firstBody.version + 1);

    const conflict = await app.request("/api/me/provider/openai", {
      method: "PUT",
      headers: originHeaders("PUT"),
      body: JSON.stringify({ apiKey: OPENAI_KEY, expectedVersion: firstBody.version })
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("PROVIDER_CREDENTIAL_CONFLICT");

    const deleted = await app.request("/api/me/provider/openai", {
      method: "DELETE",
      headers: originHeaders("DELETE"),
      body: JSON.stringify({ expectedVersion: rotatedBody.version })
    });
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).configured).toBe(false);
  });

  it("validates credentials and respects disabled or unavailable policy", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiValidationProviderFactory: validationFactory(true)
    });
    const { version } = await (
      await app.request("/api/me/provider/openai", {
        method: "PUT",
        headers: originHeaders("PUT"),
        body: JSON.stringify({ apiKey: OPENAI_KEY })
      })
    ).json();
    const validated = await app.request("/api/me/provider/openai/validate", {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({ expectedVersion: version })
    });
    expect((await validated.json()).validationState).toBe("valid");

    const invalidApp = (
      await openSeededApp({
        kekConfig: createTestProviderKekRuntimeConfig(),
        openAiValidationProviderFactory: validationFactory(false)
      })
    ).app;
    const invalidVersion = await (
      await invalidApp.request("/api/me/provider/openai", {
        method: "PUT",
        headers: originHeaders("PUT"),
        body: JSON.stringify({ apiKey: OPENAI_KEY })
      })
    ).json();
    const invalid = await invalidApp.request("/api/me/provider/openai/validate", {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({ expectedVersion: invalidVersion.version })
    });
    expect((await invalid.json()).validationState).toBe("invalid");

    const disabled = (
      await openSeededApp({
        kekConfig: createTestProviderKekRuntimeConfig(),
        callsDisabled: true
      })
    ).app;
    expect(
      (
        await disabled.request("/api/me/provider/openai/validate", {
          method: "POST",
          headers: originHeaders("POST"),
          body: JSON.stringify({ expectedVersion: 1 })
        })
      ).status
    ).toBe(503);

    const unavailable = (await openSeededApp({ kekConfig: undefined })).app;
    expect(
      (
        await unavailable.request("/api/me/provider/openai", {
          method: "PUT",
          headers: originHeaders("PUT"),
          body: JSON.stringify({ apiKey: OPENAI_KEY })
        })
      ).status
    ).toBe(503);
  });

  it("skips or saves collaboration profiles without publishing fields", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const skippedBody = await (
      await app.request("/api/me/ai-collaboration", {
        method: "PATCH",
        headers: originHeaders("PATCH"),
        body: JSON.stringify({ skipSetup: true })
      })
    ).json();
    expect(skippedBody.profile.setupSkipped).toBe(true);
    expect(JSON.stringify(skippedBody)).not.toMatch(/legalName|publishing/i);
  });

  it("handles project instructions and playbooks for owners only", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const strangerApp = (
      await openSeededApp({
        kekConfig: createTestProviderKekRuntimeConfig(),
        auth: {
          handler: () => Response.json({ auth: "handled" }),
          getSession: async () => ({
            account: {
              id: "account-stranger",
              name: "Stranger",
              email: "stranger@example.test",
              emailVerified: true
            },
            session: {
              id: "session-stranger",
              expiresAt: "2026-07-18T19:00:00.000Z"
            }
          })
        }
      })
    ).app;
    expect(
      (
        await strangerApp.request(
          `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/agent-instructions`
        )
      ).status
    ).toBe(404);

    await app.request(`/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/agent-instructions`, {
      method: "PATCH",
      headers: originHeaders("PATCH"),
      body: JSON.stringify({ body: "Keep the harbor foggy." })
    });
    const created = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/playbooks`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          name: "Capture reflection",
          enabled: true,
          trigger: "capture-reflection",
          allowedContextClasses: ["capture"],
          outputSchemaId: "capture-reflection-v1",
          guidance: "Stay curious."
        })
      }
    );
    const playbook = (await created.json()).playbook;
    const archived = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/playbooks/${playbook.id}`,
      {
        method: "DELETE",
        headers: originHeaders("DELETE"),
        body: JSON.stringify({ expectedVersion: playbook.version })
      }
    );
    expect((await archived.json()).playbook.archivedAt).toBeDefined();
  });

  it("rejects malformed provider payloads and surfaces kill switch reads", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      callsDisabled: true
    });
    expect((await (await app.request("/api/me/provider/openai")).json()).callsDisabled).toBe(
      true
    );
    expect(
      (
        await app.request("/api/me/provider/openai", {
          method: "PUT",
          headers: originHeaders("PUT"),
          body: JSON.stringify({ apiKey: "short" })
        })
      ).status
    ).toBe(400);
  });
});
