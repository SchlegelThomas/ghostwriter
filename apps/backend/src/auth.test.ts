import { afterEach, describe, expect, it } from "vitest";
import {
  createPgliteDatabase,
  migratePgliteRepositoryDatabase
} from "@ghostwriter/storage/pglite";
import {
  toRepositoryDatabase,
  verification
} from "@ghostwriter/storage";
import { createBetterAuthGateway } from "./auth.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

describe("Better Auth gateway", () => {
  it("starts a Google OAuth flow with database-backed state", async () => {
    const { db, close } = createPgliteDatabase();
    closers.push(close);
    await migratePgliteRepositoryDatabase(db);
    const gateway = createBetterAuthGateway(toRepositoryDatabase(db), {
      baseUrl: "http://localhost:8787",
      secret: "test-secret-that-is-at-least-thirty-two-characters",
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      trustedOrigins: ["http://localhost:8787", "http://localhost:8081"],
      secureCookies: false
    });
    const response = await gateway.handler(
      new Request("http://localhost:8787/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8081"
        },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "http://localhost:8081"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      redirect: true
    });
    expect(response.headers.get("set-cookie")).toContain("ghostwriter");
    const storedState = await db.select().from(verification);
    expect(storedState).toHaveLength(1);
    expect(storedState[0]?.identifier).toEqual(expect.any(String));
    expect(storedState[0]?.value).not.toBe("");
  });
});
