import { describe, expect, it } from "vitest";
import {
  createTestProviderKekRuntimeConfig,
  parseProviderCallsDisabled,
  parseProviderKekConfig,
  PROVIDER_KEK_CONFIG_ERROR,
  providerKekEnvFromConfig
} from "./provider-kek-config.js";

describe("provider KEK configuration", () => {
  it("omits KEK config when no variables are set", () => {
    expect(parseProviderKekConfig({})).toBeUndefined();
    expect(parseProviderCallsDisabled({})).toBe(false);
  });

  it("loads valid KEK versions and active key", () => {
    const runtime = createTestProviderKekRuntimeConfig();
    const config = parseProviderKekConfig(providerKekEnvFromConfig(runtime));
    expect(config?.activeVersion).toBe("V1");
    expect(config?.keys.get("V1")).toEqual(runtime.keys.get("V1"));
  });

  it("rejects partial, invalid, and duplicate configuration with content-free errors", () => {
    const validKey = Buffer.alloc(32, 1).toString("base64");
    expect(() =>
      parseProviderKekConfig({
        GHOSTWRITER_PROVIDER_KEK_ACTIVE: "V1"
      })
    ).toThrow(PROVIDER_KEK_CONFIG_ERROR);

    expect(() =>
      parseProviderKekConfig({
        GHOSTWRITER_PROVIDER_KEK_V1: validKey
      })
    ).toThrow(PROVIDER_KEK_CONFIG_ERROR);

    expect(() =>
      parseProviderKekConfig({
        GHOSTWRITER_PROVIDER_KEK_V1: "not-valid-base64-key-material",
        GHOSTWRITER_PROVIDER_KEK_ACTIVE: "V1"
      })
    ).toThrow(PROVIDER_KEK_CONFIG_ERROR);

    try {
      parseProviderKekConfig({
        GHOSTWRITER_PROVIDER_KEK_V1: validKey,
        GHOSTWRITER_PROVIDER_KEK_ACTIVE: "V2"
      });
      expect.unreachable("missing active version key should throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe(PROVIDER_KEK_CONFIG_ERROR);
      expect(message).not.toContain(validKey);
    }
  });

  it("parses the provider calls kill switch", () => {
    expect(parseProviderCallsDisabled({ GHOSTWRITER_PROVIDER_CALLS_DISABLED: "true" })).toBe(
      true
    );
    expect(parseProviderCallsDisabled({ GHOSTWRITER_PROVIDER_CALLS_DISABLED: "0" })).toBe(
      false
    );
    expect(() =>
      parseProviderCallsDisabled({ GHOSTWRITER_PROVIDER_CALLS_DISABLED: "maybe" })
    ).toThrow(PROVIDER_KEK_CONFIG_ERROR);
  });
});
