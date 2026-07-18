import { describe, expect, it } from "vitest";
import { loadConfig, pagesPreviewCookieDomain } from "./config.js";

const baseEnv = {
  DATABASE_URL: "postgres://localhost/ghostwriter",
  BETTER_AUTH_URL: "https://ghostwriter.example",
  BETTER_AUTH_SECRET: "secret-that-is-long-enough-for-auth-tests",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret"
} satisfies NodeJS.ProcessEnv;

describe("backend auth configuration", () => {
  it("loads exact trusted origins and secure-cookie posture", () => {
    const config = loadConfig({
      ...baseEnv,
      AUTH_TRUSTED_ORIGINS:
        "https://ghostwriter.example,http://localhost:8081"
    });

    expect(config.auth).toEqual({
      baseUrl: "https://ghostwriter.example",
      secret: baseEnv.BETTER_AUTH_SECRET,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      trustedOrigins: [
        "https://ghostwriter.example",
        "http://localhost:8081"
      ],
      secureCookies: true
    });
  });

  it("rejects an auth URL with a path", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        BETTER_AUTH_URL: "https://ghostwriter.example/untrusted"
      })
    ).toThrow("BETTER_AUTH_URL must be an origin");
  });

  it("accepts Cloudflare Pages wildcard trusted origins", () => {
    const config = loadConfig({
      ...baseEnv,
      BETTER_AUTH_URL: "https://ghostwriter-di2.pages.dev",
      AUTH_TRUSTED_ORIGINS:
        "https://ghostwriter-di2.pages.dev,https://*.ghostwriter-di2.pages.dev"
    });

    expect(config.auth.trustedOrigins).toEqual([
      "https://ghostwriter-di2.pages.dev",
      "https://*.ghostwriter-di2.pages.dev"
    ]);
    expect(pagesPreviewCookieDomain(config.auth.baseUrl)).toBe(
      ".ghostwriter-di2.pages.dev"
    );
    expect(pagesPreviewCookieDomain("http://localhost:8787")).toBeUndefined();
  });

  it("requires every server-side Google secret", () => {
    const { GOOGLE_CLIENT_SECRET: _removed, ...withoutGoogleSecret } = baseEnv;
    expect(() => loadConfig(withoutGoogleSecret)).toThrow(
      "GOOGLE_CLIENT_SECRET is required."
    );
  });
});
