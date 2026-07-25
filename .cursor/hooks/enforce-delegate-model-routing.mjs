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

const composerMarker = /\bGHOSTWRITER_ROUTE=composer\b/u.test(task);
const grokMarker = /\bGHOSTWRITER_ROUTE=grok\b/u.test(task);
const opusMarker = /\bGHOSTWRITER_ROUTE=escalate-opus\b/u.test(task);
const gptMarker = /\bGHOSTWRITER_ROUTE=escalate-gpt\b/u.test(task);
const routeMarkerCount = [composerMarker, grokMarker, opusMarker, gptMarker].filter(
  Boolean
).length;

const composerType = type === "delegate-composer";
const grokType = type === "delegate-grok";
const opusType = type === "escalate-opus";
const gptType = type === "escalate-gpt";

const composerModel = /composer[- ]?2\.5/iu.test(model);
const grokModel = /grok[- ]?4\.5/iu.test(model);
const opusModel = /opus/iu.test(model);
const gptModel = /gpt[- ]?5\.6/iu.test(model);

const mutationVerb =
  "(?:author|write|add|create|implement|rewrite|update|repair|fix|stabili[sz]e|modify|refactor)";
const workNoun =
  "(?:tests?|specs?|vitest|playwright|e2e|integration|contracts?|code|implementation|component|module|route|migration|adapter|repository|handler|command|ui|schema)";
const looksLikeDelegatedMutation = new RegExp(
  `(?:\\b${mutationVerb}\\b[\\s\\S]{0,120}\\b${workNoun}\\b|\\b${workNoun}\\b[\\s\\S]{0,120}\\b${mutationVerb}\\b)`,
  "iu"
).test(task);
const looksLikePlaywrightMutation =
  looksLikeDelegatedMutation &&
  /\b(?:playwright|e2e|end-to-end|browser journey)\b/iu.test(task);
const playwrightGate =
  /\bGHOSTWRITER_PLAYWRIGHT_GATE=user-verified\b/u.test(task);
const hasEscalationReason = /\bESCALATION_REASON=\S/iu.test(task);

if (routeMarkerCount > 1) {
  respond({
    permission: "deny",
    user_message:
      "Ghostwriter routing must select exactly one route: composer, grok, escalate-opus, or escalate-gpt."
  });
  process.exit(0);
}

if (composerType && !composerMarker) {
  respond({
    permission: "deny",
    user_message:
      "Retry delegate-composer with GHOSTWRITER_ROUTE=composer in its task."
  });
  process.exit(0);
}

if (grokType && !grokMarker) {
  respond({
    permission: "deny",
    user_message:
      "Retry delegate-grok with GHOSTWRITER_ROUTE=grok in its task."
  });
  process.exit(0);
}

if (opusType && !opusMarker) {
  respond({
    permission: "deny",
    user_message:
      "Retry escalate-opus with GHOSTWRITER_ROUTE=escalate-opus and ESCALATION_REASON=<reason> in its task."
  });
  process.exit(0);
}

if (gptType && !gptMarker) {
  respond({
    permission: "deny",
    user_message:
      "Retry escalate-gpt with GHOSTWRITER_ROUTE=escalate-gpt and ESCALATION_REASON=<reason> in its task."
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

if (composerMarker || composerType) {
  if (!composerModel) {
    respond({
      permission: "deny",
      user_message:
        "Composer-route Ghostwriter work must use Composer 2.5. Retry with delegate-composer or an explicit Composer 2.5 model."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (grokMarker || grokType) {
  if (!grokModel) {
    respond({
      permission: "deny",
      user_message:
        "Grok-route Ghostwriter work must use Grok 4.5. Retry with delegate-grok or an explicit Grok 4.5 model."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (opusMarker || opusType) {
  if (!hasEscalationReason) {
    respond({
      permission: "deny",
      user_message:
        "escalate-opus requires ESCALATION_REASON=<reason> so the Opus cost escalation is auditable."
    });
    process.exit(0);
  }
  if (!opusModel) {
    respond({
      permission: "deny",
      user_message:
        "Creative escalation must use an Opus-class model. Retry with escalate-opus."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (gptMarker || gptType) {
  if (!hasEscalationReason) {
    respond({
      permission: "deny",
      user_message:
        "escalate-gpt requires ESCALATION_REASON=<reason> so the GPT 5.6 cost escalation is auditable."
    });
    process.exit(0);
  }
  if (!gptModel) {
    respond({
      permission: "deny",
      user_message:
        "Concrete escalation must use GPT 5.6. Retry with escalate-gpt or an explicit GPT 5.6 model."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (looksLikeDelegatedMutation) {
  respond({
    permission: "deny",
    user_message:
      "Classify this delegated development/validation task first. Prefer GHOSTWRITER_ROUTE=composer (Composer 2.5) or GHOSTWRITER_ROUTE=grok (Grok 4.5). Escalate to escalate-opus (creative) or escalate-gpt (concrete) only with ESCALATION_REASON."
  });
  process.exit(0);
}

respond({ permission: "allow" });
