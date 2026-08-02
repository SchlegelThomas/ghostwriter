import { accountId } from "@ghostwriter/core";
import { describe, expect, it, vi } from "vitest";
import {
  DEMO_PROVIDER_KEY_SEED_SPECS,
  seedProviderKeysFromEnv
} from "./demo-provider-key-seed.js";

describe("seedProviderKeysFromEnv", () => {
  const demoAccount = accountId("account-demo-seed");

  it("calls setCredential for each non-empty env var", async () => {
    const setCredential = vi.fn().mockResolvedValue({});
    const logs: string[] = [];

    const seeded = await seedProviderKeysFromEnv({
      accountId: demoAccount,
      specs: DEMO_PROVIDER_KEY_SEED_SPECS,
      setCredential,
      env: {
        GHOSTWRITER_DEMO_SEED_OPENAI_KEY: " sk-openai ",
        GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY: "",
        GHOSTWRITER_DEMO_SEED_GOOGLE_KEY: "sk-google"
      },
      log: (message) => logs.push(message),
      logPrefix: "Demo seed"
    });

    expect(seeded).toEqual(["openai", "google"]);
    expect(setCredential).toHaveBeenCalledTimes(2);
    expect(setCredential).toHaveBeenCalledWith({
      accountId: demoAccount,
      providerId: "openai",
      plaintext: "sk-openai"
    });
    expect(setCredential).toHaveBeenCalledWith({
      accountId: demoAccount,
      providerId: "google",
      plaintext: "sk-google"
    });
    expect(logs.some((line) => line.includes("openai"))).toBe(true);
    expect(logs.some((line) => line.includes("sk-openai"))).toBe(false);
  });

  it("skips seeding when all env vars are empty", async () => {
    const setCredential = vi.fn();

    const seeded = await seedProviderKeysFromEnv({
      accountId: demoAccount,
      specs: DEMO_PROVIDER_KEY_SEED_SPECS,
      setCredential,
      env: {}
    });

    expect(seeded).toEqual([]);
    expect(setCredential).not.toHaveBeenCalled();
  });

  it("logs and continues when setCredential throws", async () => {
    const setCredential = vi
      .fn()
      .mockRejectedValueOnce(new Error("encryption unavailable"))
      .mockResolvedValueOnce({});
    const logs: string[] = [];

    const seeded = await seedProviderKeysFromEnv({
      accountId: demoAccount,
      specs: DEMO_PROVIDER_KEY_SEED_SPECS,
      setCredential,
      env: {
        GHOSTWRITER_DEMO_SEED_OPENAI_KEY: "sk-openai",
        GHOSTWRITER_DEMO_SEED_GOOGLE_KEY: "sk-google"
      },
      log: (message) => logs.push(message)
    });

    expect(seeded).toEqual(["google"]);
    expect(logs.some((line) => line.includes("failed to store openai"))).toBe(true);
    expect(logs.some((line) => line.includes("sk-openai"))).toBe(false);
  });

  it("skips all providers when seedingEnabled is false", async () => {
    const setCredential = vi.fn();
    const logs: string[] = [];

    const seeded = await seedProviderKeysFromEnv({
      accountId: demoAccount,
      specs: DEMO_PROVIDER_KEY_SEED_SPECS,
      setCredential,
      env: { GHOSTWRITER_DEMO_SEED_OPENAI_KEY: "sk-openai" },
      seedingEnabled: false,
      seedingDisabledReason: "Demo seed: skipping BYOK key seed (encryption unavailable).",
      log: (message) => logs.push(message)
    });

    expect(seeded).toEqual([]);
    expect(setCredential).not.toHaveBeenCalled();
    expect(logs).toContain("Demo seed: skipping BYOK key seed (encryption unavailable).");
  });
});
