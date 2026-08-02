import { describe, expect, it } from "vitest";
import { loadConfig, pagesPreviewCookieDomain, parsePublicMediaConfig, parseR2CaptureObjectStorageConfig } from "./config.js";
import { R2_OBJECT_STORAGE_CONFIG_ERROR } from "./r2-config-validation.js";

const VALID_R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

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
    expect(config.demoSeed).toEqual({ enabled: true });
    expect(config.r2).toBeUndefined();
    expect(config.publicMedia).toBeUndefined();
  });

  it("disables demo seed when GHOSTWRITER_DEMO_SEED=0", () => {
    const config = loadConfig({
      ...baseEnv,
      GHOSTWRITER_DEMO_SEED: "0"
    });
    expect(config.demoSeed).toEqual({ enabled: false });
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

describe("backend R2 object storage configuration", () => {
  it("omits R2 when no variables are set", () => {
    expect(parseR2CaptureObjectStorageConfig({})).toBeUndefined();
    expect(loadConfig(baseEnv).r2).toBeUndefined();
  });

  it("loads all-or-none R2 settings with a derived endpoint", () => {
    const config = loadConfig({
      ...baseEnv,
      R2_ACCOUNT_ID: VALID_R2_ACCOUNT_ID.toUpperCase(),
      R2_ACCESS_KEY_ID: "  access-key-id  ",
      R2_SECRET_ACCESS_KEY: "  secret-access-key  ",
      R2_BUCKET_NAME: "private-capture"
    });

    expect(config.r2).toEqual({
      accountId: VALID_R2_ACCOUNT_ID,
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
      bucketName: "private-capture",
      endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    });
  });

  it("rejects invalid R2 values with content-free errors", () => {
    const invalidEnv = {
      R2_ACCOUNT_ID: "not-a-valid-account",
      R2_ACCESS_KEY_ID: "access-key-id",
      R2_SECRET_ACCESS_KEY: "secret-access-key",
      R2_BUCKET_NAME: "private-capture"
    };

    expect(() => parseR2CaptureObjectStorageConfig(invalidEnv)).toThrow(
      R2_OBJECT_STORAGE_CONFIG_ERROR
    );

    try {
      parseR2CaptureObjectStorageConfig({
        ...invalidEnv,
        R2_SECRET_ACCESS_KEY: "  "
      });
      expect.unreachable("blank secret should throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe(R2_OBJECT_STORAGE_CONFIG_ERROR);
    }

    expect(() =>
      parseR2CaptureObjectStorageConfig({
        ...invalidEnv,
        R2_ACCOUNT_ID: VALID_R2_ACCOUNT_ID,
        R2_BUCKET_NAME: "../evil-bucket"
      })
    ).toThrow(R2_OBJECT_STORAGE_CONFIG_ERROR);
  });

  it("rejects partial R2 configuration with a content-free error", () => {
    expect(() =>
      parseR2CaptureObjectStorageConfig({
        R2_ACCOUNT_ID: VALID_R2_ACCOUNT_ID,
        R2_BUCKET_NAME: "private-capture"
      })
    ).toThrow(
      "R2 object storage environment variables must all be set or all be omitted."
    );

    try {
      parseR2CaptureObjectStorageConfig({
        R2_ACCOUNT_ID: VALID_R2_ACCOUNT_ID,
        R2_SECRET_ACCESS_KEY: "leaked-secret-value"
      });
      expect.unreachable("partial R2 config should throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("leaked-secret-value");
    }
  });
});

describe("backend public character media configuration", () => {
  it("omits public media when the origin is unset", () => {
    expect(parsePublicMediaConfig({}, undefined)).toBeUndefined();
    expect(loadConfig(baseEnv).publicMedia).toBeUndefined();
  });

  it("loads public media when origin and bucket are set with private R2 creds", () => {
    const privateR2 = {
      accountId: VALID_R2_ACCOUNT_ID,
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
      bucketName: "private-capture",
      endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    };
    const config = loadConfig({
      ...baseEnv,
      R2_ACCOUNT_ID: VALID_R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: "access-key-id",
      R2_SECRET_ACCESS_KEY: "secret-access-key",
      R2_BUCKET_NAME: "private-capture",
      GHOSTWRITER_PUBLIC_MEDIA_ORIGIN: "https://media.ghost-writer.studio",
      GHOSTWRITER_PUBLIC_R2_BUCKET_NAME: "ghostwriter-public-media"
    });

    expect(config.publicMedia).toEqual({
      origin: "https://media.ghost-writer.studio",
      r2: {
        accountId: VALID_R2_ACCOUNT_ID,
        accessKeyId: "access-key-id",
        secretAccessKey: "secret-access-key",
        bucketName: "ghostwriter-public-media",
        endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      }
    });
    expect(config.r2).toEqual(privateR2);
  });

  it("requires a public bucket name when the origin is set", () => {
    expect(() =>
      parsePublicMediaConfig(
        { GHOSTWRITER_PUBLIC_MEDIA_ORIGIN: "https://media.ghost-writer.studio" },
        {
          accountId: VALID_R2_ACCOUNT_ID,
          accessKeyId: "access-key-id",
          secretAccessKey: "secret-access-key",
          bucketName: "private-capture",
          endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        }
      )
    ).toThrow("GHOSTWRITER_PUBLIC_R2_BUCKET_NAME is required");
  });

  it("requires private R2 credentials when public media is configured", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        GHOSTWRITER_PUBLIC_MEDIA_ORIGIN: "https://media.ghost-writer.studio",
        GHOSTWRITER_PUBLIC_R2_BUCKET_NAME: "ghostwriter-public-media"
      })
    ).toThrow("R2 object storage credentials are required");
  });
});
