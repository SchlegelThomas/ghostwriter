#!/usr/bin/env node
/**
 * Read Wrangler OAuth session (never prints the token) and helpers for setup scripts.
 *
 * Usage:
 *   node scripts/lib/cloudflare-wrangler-oauth.mjs whoami
 *   node scripts/lib/cloudflare-wrangler-oauth.mjs zone-id ghost-writer.studio
 *   node scripts/lib/cloudflare-wrangler-oauth.mjs api GET /zones?name=ghost-writer.studio
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.cloudflare.com/client/v4";

/** Production Ghostwriter Cloudflare defaults (public, non-secret). */
export const GHOSTWRITER_CF = Object.freeze({
  accountId: "dd0edd263f71cb4108826464f45e0045",
  zoneName: "ghost-writer.studio",
  /** Verified via Wrangler OAuth zone lookup 2026-08-02 */
  zoneId: "ad447e9568d660a1772887ae06a961bd",
  publicMediaDomain: "media.ghost-writer.studio",
  publicMediaOrigin: "https://media.ghost-writer.studio",
  publicBucket: "ghostwriter-public-media",
  privateBucket: "ghostwriter-capture"
});

function wranglerConfigPath() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library/Preferences/.wrangler/config/default.toml");
  }
  if (process.platform === "win32") {
    return join(homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml");
  }
  return join(homedir(), ".config/.wrangler/config/default.toml");
}

function readOauthToken() {
  const path = wranglerConfigPath();
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Wrangler OAuth config not found at ${path}. Run: wrangler login`
    );
  }
  const match = text.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m);
  if (!match?.[1]) {
    throw new Error(`No oauth_token in ${path}. Run: wrangler login`);
  }
  return match[1];
}

async function cfApi(method, path, body) {
  const token = readOauthToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function resolveZoneId(zoneName) {
  if (zoneName === GHOSTWRITER_CF.zoneName) {
    // Prefer live lookup; fall back to known production zone id.
    try {
      const { json } = await cfApi(
        "GET",
        `/zones?name=${encodeURIComponent(zoneName)}&status=active`
      );
      if (json.success && json.result?.length === 1 && json.result[0].id) {
        return json.result[0].id;
      }
    } catch {
      // fall through
    }
    return GHOSTWRITER_CF.zoneId;
  }
  const { json } = await cfApi(
    "GET",
    `/zones?name=${encodeURIComponent(zoneName)}&status=active`
  );
  if (!json.success || json.result?.length !== 1 || !json.result[0].id) {
    throw new Error(
      `Could not resolve zone id for ${zoneName}: ${JSON.stringify(json.errors || json)}`
    );
  }
  return json.result[0].id;
}

async function whoami() {
  const token = readOauthToken();
  // Fingerprint only — never print the token.
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const { json } = await cfApi("GET", "/accounts?per_page=50");
  const accounts = json.success ? json.result || [] : [];
  const preferred =
    accounts.find((a) => a.id === GHOSTWRITER_CF.accountId) ?? accounts[0];
  return {
    configPath: wranglerConfigPath(),
    tokenFingerprint: fingerprint,
    accountId: preferred?.id ?? GHOSTWRITER_CF.accountId,
    accountName: preferred?.name ?? "unknown",
    accounts: accounts.map((a) => ({ id: a.id, name: a.name }))
  };
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "whoami") {
    console.log(JSON.stringify(await whoami(), null, 2));
    process.exit(0);
  }
  if (cmd === "account-id") {
    const info = await whoami();
    process.stdout.write(info.accountId);
    process.exit(0);
  }
  if (cmd === "zone-id") {
    const zoneName = args[0] || GHOSTWRITER_CF.zoneName;
    process.stdout.write(await resolveZoneId(zoneName));
    process.exit(0);
  }
  if (cmd === "defaults") {
    console.log(JSON.stringify(GHOSTWRITER_CF, null, 2));
    process.exit(0);
  }
  if (cmd === "api") {
    const method = args[0] || "GET";
    const path = args[1];
    if (!path) {
      throw new Error("api requires METHOD PATH");
    }
    const { status, json } = await cfApi(method, path);
    console.log(JSON.stringify({ status, ...json }, null, 2));
    process.exit(json.success ? 0 : 1);
  }
  console.error(
    "Usage: cloudflare-wrangler-oauth.mjs <whoami|account-id|zone-id|defaults|api>"
  );
  process.exit(2);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
