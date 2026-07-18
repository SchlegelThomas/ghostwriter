import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hookPath = join(dirname(fileURLToPath(import.meta.url)), "enforce-test-model-routing.mjs");

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

test("allows non-test exploration on any model", async () => {
  await expectPermission(
    {
      task: "Explore authentication patterns across apps/backend and packages/core.",
      subagent_type: "explore",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "allow",
  );
});

test("denies unclassified test mutation on an expensive model", async () => {
  const result = await expectPermission(
    {
      task: "Write Vitest coverage for canvas-model.ts.",
      subagent_type: "generalPurpose",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "deny",
  );
  assert.match(result.user_message, /Classify this test-writing\/repair task first/i);
});

test("allows routine marker with Composer 2.5", async () => {
  await expectPermission(
    {
      task: "GHOSTWRITER_TEST_ROUTING=routine Repair canvas-model.test.ts failures.",
      subagent_type: "routine-tests",
      subagent_model: "composer-2.5-fast",
    },
    "allow",
  );
});

test("denies routine marker with a non-Composer model", async () => {
  const result = await expectPermission(
    {
      task: "GHOSTWRITER_TEST_ROUTING=routine Repair canvas-model.test.ts failures.",
      subagent_type: "routine-tests",
      subagent_model: "gpt-5.6-sol-medium",
    },
    "deny",
  );
  assert.match(result.user_message, /Composer 2\.5/i);
});

test("denies routine-tests type without the routine marker", async () => {
  const result = await expectPermission(
    {
      task: "Repair canvas-model.test.ts failures.",
      subagent_type: "routine-tests",
      subagent_model: "composer-2.5-fast",
    },
    "deny",
  );
  assert.match(result.user_message, /GHOSTWRITER_TEST_ROUTING=routine/i);
});

test("allows hard marker with escalation reason on Grok 4.5", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_TEST_ROUTING=hard GHOSTWRITER_PLAYWRIGHT_GATE=user-verified ESCALATION_REASON=lease-version-race Stabilize authenticated-project-crud Playwright spec.",
      subagent_type: "hard-tests",
      subagent_model: "cursor-grok-4.5-high-fast",
    },
    "allow",
  );
});

test("denies hard marker without escalation reason", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_TEST_ROUTING=hard GHOSTWRITER_PLAYWRIGHT_GATE=user-verified Stabilize authenticated-project-crud Playwright spec.",
      subagent_type: "hard-tests",
      subagent_model: "cursor-grok-4.5-high-fast",
    },
    "deny",
  );
  assert.match(result.user_message, /ESCALATION_REASON/i);
});

test("denies hard marker with reason on a non-Grok model", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_TEST_ROUTING=hard GHOSTWRITER_PLAYWRIGHT_GATE=user-verified ESCALATION_REASON=lease-version-race Stabilize authenticated-project-crud Playwright spec.",
      subagent_type: "hard-tests",
      subagent_model: "composer-2.5-fast",
    },
    "deny",
  );
  assert.match(result.user_message, /Grok 4\.5/i);
});

test("denies routine Composer Playwright task without user-verified gate", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_TEST_ROUTING=routine Repair story-trail-quick-build Playwright spec.",
      subagent_type: "routine-tests",
      subagent_model: "composer-2.5-fast",
    },
    "deny",
  );
  assert.match(result.user_message, /Defer Playwright authoring and repair until the user verifies/i);
  assert.match(result.user_message, /GHOSTWRITER_PLAYWRIGHT_GATE=user-verified/i);
});

test("allows routine Composer Playwright task with user-verified gate", async () => {
  await expectPermission(
    {
      task:
        "GHOSTWRITER_TEST_ROUTING=routine GHOSTWRITER_PLAYWRIGHT_GATE=user-verified Repair story-trail-quick-build Playwright spec.",
      subagent_type: "routine-tests",
      subagent_model: "composer-2.5-fast",
    },
    "allow",
  );
});

test("denies hard-tests type without the hard marker", async () => {
  const result = await expectPermission(
    {
      task: "Stabilize authenticated-project-crud Playwright spec.",
      subagent_type: "hard-tests",
      subagent_model: "cursor-grok-4.5-high-fast",
    },
    "deny",
  );
  assert.match(result.user_message, /GHOSTWRITER_TEST_ROUTING=hard/i);
});

test("denies both routine and hard markers", async () => {
  const result = await expectPermission(
    {
      task:
        "GHOSTWRITER_TEST_ROUTING=routine GHOSTWRITER_TEST_ROUTING=hard ESCALATION_REASON=conflicting-route Repair canvas-model.test.ts.",
      subagent_type: "routine-tests",
      subagent_model: "composer-2.5-fast",
    },
    "deny",
  );
  assert.match(result.user_message, /exactly one route/i);
});
