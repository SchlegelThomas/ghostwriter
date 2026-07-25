import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hookPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "enforce-delegate-model-routing.mjs"
);

function runHook(input) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [hookPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

async function expectPermission(input, expectedPermission) {
  const { code, stdout, stderr } = await runHook(input);
  assert.equal(code, 0, stderr || "hook should exit 0");
  const result = JSON.parse(stdout);
  assert.equal(result.permission, expectedPermission);
  return result;
}

test("allows read-only exploration on any model", async () => {
  await expectPermission(
    {
      task: "Explore authentication patterns across apps/backend and packages/core.",
      subagent_type: "explore",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "allow"
  );
});

test("denies unclassified delegated mutation on an expensive model", async () => {
  const result = await expectPermission(
    {
      task: "Implement the chapter rename command in packages/core.",
      subagent_type: "generalPurpose",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "deny"
  );
  assert.match(result.user_message, /Classify this delegated development\/validation task first/i);
});

test("allows composer route with Composer 2.5", async () => {
  await expectPermission(
    {
      task: "GHOSTWRITER_ROUTE=composer Repair canvas-model.test.ts failures.",
      subagent_type: "delegate-composer",
      subagent_model: "composer-2.5-fast",
    },
    "allow"
  );
});

test("denies composer route with a non-Composer model", async () => {
  const result = await expectPermission(
    {
      task: "GHOSTWRITER_ROUTE=composer Repair canvas-model.test.ts failures.",
      subagent_type: "delegate-composer",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "deny"
  );
  assert.match(result.user_message, /Composer 2\.5/i);
});

test("denies delegate-composer without the composer marker", async () => {
  const result = await expectPermission(
    {
      task: "Repair canvas-model.test.ts failures.",
      subagent_type: "delegate-composer",
      subagent_model: "composer-2.5-fast",
    },
    "deny"
  );
  assert.match(result.user_message, /GHOSTWRITER_ROUTE=composer/i);
});

test("allows grok route without escalation reason", async () => {
  await expectPermission(
    {
      task: "GHOSTWRITER_ROUTE=grok Implement the bounded repository adapter patch.",
      subagent_type: "delegate-grok",
      subagent_model: "cursor-grok-4.5-high-fast",
    },
    "allow"
  );
});

test("allows escalate-gpt with reason on GPT 5.6", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=escalate-gpt GHOSTWRITER_PLAYWRIGHT_GATE=user-verified ESCALATION_REASON=lease-version-race Stabilize authenticated-project-crud Playwright spec.",
      subagent_type: "escalate-gpt",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "allow"
  );
});

test("allows escalate-opus with reason on Opus", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=escalate-opus ESCALATION_REASON=living-design-ui-polish Implement the Focus Halo entry animation polish.",
      subagent_type: "escalate-opus",
      subagent_model: "claude-opus-5-thinking-high",
    },
    "allow"
  );
});

test("denies escalate-gpt without escalation reason", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=escalate-gpt GHOSTWRITER_PLAYWRIGHT_GATE=user-verified Stabilize authenticated-project-crud Playwright spec.",
      subagent_type: "escalate-gpt",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "deny"
  );
  assert.match(result.user_message, /ESCALATION_REASON/i);
});

test("denies escalate-gpt with reason on a non-GPT model", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=escalate-gpt ESCALATION_REASON=lease-version-race Stabilize lease acknowledgement ordering.",
      subagent_type: "escalate-gpt",
      subagent_model: "composer-2.5-fast",
    },
    "deny"
  );
  assert.match(result.user_message, /gpt-5\.6-sol-medium|GPT 5\.6/i);
});

test("allows composer standard effort with matching model", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=composer GHOSTWRITER_EFFORT=standard Implement the bounded adapter patch.",
      subagent_type: "delegate-composer-standard",
      subagent_model: "composer-2.5[fast=false]",
    },
    "allow"
  );
});

test("denies composer standard effort on a fast model", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=composer GHOSTWRITER_EFFORT=standard Implement the bounded adapter patch.",
      subagent_type: "delegate-composer-standard",
      subagent_model: "composer-2.5-fast",
    },
    "deny"
  );
  assert.match(result.user_message, /standard effort/i);
});

test("allows escalate-gpt terra effort", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=escalate-gpt GHOSTWRITER_EFFORT=terra ESCALATION_REASON=parity-failure Repair memory/Postgres parity.",
      subagent_type: "escalate-gpt-terra",
      subagent_model: "gpt-5.6-terra-medium",
    },
    "allow"
  );
});

test("denies escalate-gpt-terra without terra effort", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=escalate-gpt ESCALATION_REASON=parity-failure Repair memory/Postgres parity.",
      subagent_type: "escalate-gpt-terra",
      subagent_model: "gpt-5.6-terra-medium",
    },
    "deny"
  );
  assert.match(result.user_message, /GHOSTWRITER_EFFORT=terra/i);
});

test("denies composer Playwright task without user-verified gate", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=composer Repair story-trail-quick-build Playwright spec.",
      subagent_type: "delegate-composer",
      subagent_model: "composer-2.5-fast",
    },
    "deny"
  );
  assert.match(
    result.user_message,
    /Defer Playwright authoring and repair until the user verifies/i
  );
  assert.match(result.user_message, /GHOSTWRITER_PLAYWRIGHT_GATE=user-verified/i);
});

test("allows composer Playwright task with user-verified gate", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=composer GHOSTWRITER_PLAYWRIGHT_GATE=user-verified Repair story-trail-quick-build Playwright spec.",
      subagent_type: "delegate-composer",
      subagent_model: "composer-2.5-fast",
    },
    "allow"
  );
});

test("denies both composer and grok markers", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_ROUTE=composer GHOSTWRITER_ROUTE=grok Repair canvas-model.test.ts.",
      subagent_type: "delegate-composer",
      subagent_model: "composer-2.5-fast",
    },
    "deny"
  );
  assert.match(result.user_message, /exactly one route/i);
});
