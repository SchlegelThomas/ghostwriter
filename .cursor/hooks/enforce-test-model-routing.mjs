import process from "node:process";

let source = "";
for await (const chunk of process.stdin) source += chunk;

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

let input;
try {
  input = JSON.parse(source);
} catch {
  respond({
    permission: "deny",
    user_message:
      "Ghostwriter could not validate subagent model routing because the hook input was invalid."
  });
  process.exit(0);
}

const task = typeof input.task === "string" ? input.task : "";
const type = typeof input.subagent_type === "string" ? input.subagent_type : "";
const model = typeof input.subagent_model === "string" ? input.subagent_model : "";

const routineMarker = /\bGHOSTWRITER_TEST_ROUTING=routine\b/u.test(task);
const hardMarker = /\bGHOSTWRITER_TEST_ROUTING=hard\b/u.test(task);
const routineType = type === "routine-tests";
const hardType = type === "hard-tests";
const composerModel = /composer[- ]?2\.5/iu.test(model);
const grokModel = /grok[- ]?4\.5/iu.test(model);

const mutationVerb =
  "(?:author|write|add|create|implement|rewrite|update|repair|fix|stabili[sz]e|modify)";
const testNoun = "(?:tests?|specs?|vitest|playwright|e2e|integration|contracts?)";
const looksLikeTestMutation = new RegExp(
  `(?:\\b${mutationVerb}\\b[\\s\\S]{0,120}\\b${testNoun}\\b|\\b${testNoun}\\b[\\s\\S]{0,120}\\b${mutationVerb}\\b)`,
  "iu"
).test(task);
const looksLikePlaywrightMutation =
  looksLikeTestMutation &&
  /\b(?:playwright|e2e|end-to-end|browser journey)\b/iu.test(task);
const playwrightGate =
  /\bGHOSTWRITER_PLAYWRIGHT_GATE=user-verified\b/u.test(task);

if (routineMarker && hardMarker) {
  respond({
    permission: "deny",
    user_message:
      "Ghostwriter test routing must select exactly one route: routine or hard."
  });
  process.exit(0);
}

if (routineType && !routineMarker) {
  respond({
    permission: "deny",
    user_message:
      "Retry the routine-tests subagent with GHOSTWRITER_TEST_ROUTING=routine in its task."
  });
  process.exit(0);
}

if (hardType && !hardMarker) {
  respond({
    permission: "deny",
    user_message:
      "Retry the hard-tests subagent with GHOSTWRITER_TEST_ROUTING=hard and ESCALATION_REASON=<reason> in its task."
  });
  process.exit(0);
}

if (looksLikePlaywrightMutation && !playwrightGate) {
  respond({
    permission: "deny",
    user_message:
      "Defer Playwright authoring and repair until the user verifies the complete product outcome. Verify checkpoints directly in the browser; after explicit verification retry with GHOSTWRITER_PLAYWRIGHT_GATE=user-verified."
  });
  process.exit(0);
}

if (routineMarker || routineType) {
  if (!composerModel) {
    respond({
      permission: "deny",
      user_message:
        "Routine Ghostwriter test work must use Composer 2.5. Retry with the routine-tests subagent or an explicit Composer 2.5 model."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (hardMarker || hardType) {
  if (!/\bESCALATION_REASON=\S/iu.test(task)) {
    respond({
      permission: "deny",
      user_message:
        "Hard-test routing requires ESCALATION_REASON=<reason> so the Grok 4.5 cost escalation is auditable."
    });
    process.exit(0);
  }
  if (!grokModel) {
    respond({
      permission: "deny",
      user_message:
        "Hard Ghostwriter test work must use Grok 4.5. Retry with the hard-tests subagent or an explicit Grok 4.5 model."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (looksLikeTestMutation) {
  respond({
    permission: "deny",
    user_message:
      "Classify this test-writing/repair task first. Use GHOSTWRITER_TEST_ROUTING=routine with Composer 2.5; escalate to hard/Grok 4.5 only under the recorded criteria."
  });
  process.exit(0);
}

respond({ permission: "allow" });
