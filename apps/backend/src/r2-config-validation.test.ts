import { describe, expect, it } from "vitest";
import { buildR2ObjectUrl } from "./r2-capture-object-storage.js";
import {
  R2_OBJECT_STORAGE_CONFIG_ERROR,
  assertValidatedR2BucketName,
  parseValidatedR2AccountId,
  parseValidatedR2BucketName,
  parseValidatedR2Credential
} from "./r2-config-validation.js";

const VALID_R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

describe("R2 configuration validation", () => {
  it("accepts a documented 32-hex Cloudflare account id and normalizes case", () => {
    expect(parseValidatedR2AccountId(`  ${VALID_R2_ACCOUNT_ID.toUpperCase()}  `)).toBe(
      VALID_R2_ACCOUNT_ID
    );
  });

  it("accepts conservative lowercase bucket names within S3 length bounds", () => {
    expect(parseValidatedR2BucketName("  capture-attachments  ")).toBe("capture-attachments");
    expect(parseValidatedR2BucketName("ab1")).toBe("ab1");
  });

  it("requires trimmed nonblank credentials", () => {
    expect(parseValidatedR2Credential("  access-key  ")).toBe("access-key");
    expect(() => parseValidatedR2Credential("   ")).toThrow(R2_OBJECT_STORAGE_CONFIG_ERROR);
  });

  it("rejects malformed account ids without echoing input", () => {
    const maliciousAccount = "../../../evil?secret=1#frag";
    expect(() => parseValidatedR2AccountId(maliciousAccount)).toThrow(
      R2_OBJECT_STORAGE_CONFIG_ERROR
    );
    try {
      parseValidatedR2AccountId(maliciousAccount);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("../");
      expect(message).not.toContain("secret=1");
    }
  });

  it("rejects unsafe bucket names without echoing input", () => {
    const maliciousBucket = "../private?x=1#y";
    expect(() => parseValidatedR2BucketName(maliciousBucket)).toThrow(
      R2_OBJECT_STORAGE_CONFIG_ERROR
    );
    try {
      parseValidatedR2BucketName(maliciousBucket);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("../");
      expect(message).not.toContain("x=1");
    }
  });
});

describe("buildR2ObjectUrl bucket safety", () => {
  it("refuses malicious bucket components before URL construction", () => {
    expect(() =>
      buildR2ObjectUrl(
        {
          accountId: VALID_R2_ACCOUNT_ID,
          accessKeyId: "access",
          secretAccessKey: "super-secret-should-not-appear",
          bucketName: "../attachments",
          endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        },
        "projects/p/captures/c/attachments/a"
      )
    ).toThrow(R2_OBJECT_STORAGE_CONFIG_ERROR);

    try {
      buildR2ObjectUrl(
        {
          accountId: VALID_R2_ACCOUNT_ID,
          accessKeyId: "access",
          secretAccessKey: "super-secret-should-not-appear",
          bucketName: "../attachments",
          endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        },
        "projects/p/captures/c/attachments/a"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("super-secret-should-not-appear");
    }
  });

  it("uses validated bucket names as safe path segments", () => {
    const url = buildR2ObjectUrl(
      {
        accountId: VALID_R2_ACCOUNT_ID,
        accessKeyId: "access",
        secretAccessKey: "secret",
        bucketName: "capture-attachments",
        endpoint: `https://${VALID_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      },
      "projects/p/captures/c/attachments/a"
    );

    expect(url.pathname).toBe("/capture-attachments/projects/p/captures/c/attachments/a");
    expect(() => assertValidatedR2BucketName("capture-attachments")).not.toThrow();
  });
});
