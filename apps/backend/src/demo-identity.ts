import { createHmac } from "node:crypto";

/** Fixed Better Auth / membership id for the founder demo seed account. */
export const DEMO_SEED_ACCOUNT = Object.freeze({
  id: "account-demo-seed",
  email: "demo@ghostwriter.app",
  name: "Demo Writer"
});

/**
 * Derives the demo credential password from `BETTER_AUTH_SECRET` so Fly needs no
 * extra secret. Never log or return this to clients.
 */
export function deriveDemoSeedPassword(authSecret: string): string {
  return createHmac("sha256", authSecret)
    .update("ghostwriter-demo-seed-v1")
    .digest("base64url");
}
