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

const effortMatch = task.match(/\bGHOSTWRITER_EFFORT=([^\s]+)/u);
const effort = effortMatch?.[1]?.toLowerCase() ?? null;

const composerFastType = type === "delegate-composer";
const composerStandardType = type === "delegate-composer-standard";
const composerType = composerFastType || composerStandardType;
const grokType = type === "delegate-grok";
const opusType = type === "escalate-opus";
const gptSolType = type === "escalate-gpt";
const gptTerraType = type === "escalate-gpt-terra";
const gptType = gptSolType || gptTerraType;

const composerFamily = /composer[- ]?2\.5/iu.test(model);
const composerFastModel =
  composerFamily &&
  (/fast=true/iu.test(model) || /composer-2\.5-fast\b/iu.test(model));
const composerStandardModel =
  composerFamily &&
  (/fast=false/iu.test(model) ||
    /composer-2\.5\[\]/u.test(model) ||
    (!/fast/iu.test(model) && !/composer-2\.5-fast\b/iu.test(model)));
const grokModel =
  /grok[- ]?4\.5/iu.test(model) || /cursor-grok-4\.5/iu.test(model);
const opusModel = /opus/iu.test(model);
const opusHighModel =
  opusModel && (/thinking-high/iu.test(model) || /effort=high/iu.test(model));
const gptSolModel = /gpt[- ]?5\.6/iu.test(model) && /sol/iu.test(model);
const gptTerraModel = /gpt[- ]?5\.6/iu.test(model) && /terra/iu.test(model);
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
      "Retry the Composer delegate with GHOSTWRITER_ROUTE=composer (and GHOSTWRITER_EFFORT=standard for delegate-composer-standard)."
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
      "Retry the GPT escalate agent with GHOSTWRITER_ROUTE=escalate-gpt, ESCALATION_REASON=<reason>, and GHOSTWRITER_EFFORT=sol|terra."
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
  const composerEffort = effort ?? "fast";
  if (composerEffort !== "fast" && composerEffort !== "standard") {
    respond({
      permission: "deny",
      user_message:
        "Composer effort must be GHOSTWRITER_EFFORT=fast or GHOSTWRITER_EFFORT=standard."
    });
    process.exit(0);
  }
  if (composerFastType && composerEffort !== "fast") {
    respond({
      permission: "deny",
      user_message:
        "delegate-composer is fast effort. Use delegate-composer-standard with GHOSTWRITER_EFFORT=standard, or omit EFFORT for fast."
    });
    process.exit(0);
  }
  if (composerStandardType && composerEffort !== "standard") {
    respond({
      permission: "deny",
      user_message:
        "delegate-composer-standard requires GHOSTWRITER_EFFORT=standard."
    });
    process.exit(0);
  }
  if (composerEffort === "fast" && !composerFastModel) {
    respond({
      permission: "deny",
      user_message:
        "Composer fast effort must use Composer 2.5 fast (delegate-composer or composer-2.5[fast=true] / composer-2.5-fast)."
    });
    process.exit(0);
  }
  if (composerEffort === "standard" && !composerStandardModel) {
    respond({
      permission: "deny",
      user_message:
        "Composer standard effort must use Composer 2.5 non-fast (delegate-composer-standard or composer-2.5[fast=false])."
    });
    process.exit(0);
  }
  respond({ permission: "allow" });
  process.exit(0);
}

if (grokMarker || grokType) {
  const grokEffort = effort ?? "high-fast";
  if (grokEffort !== "high-fast") {
    respond({
      permission: "deny",
      user_message:
        "Grok effort must be GHOSTWRITER_EFFORT=high-fast (default when omitted)."
    });
    process.exit(0);
  }
  if (!grokModel) {
    respond({
      permission: "deny",
      user_message:
        "Grok-route Ghostwriter work must use Grok 4.5 (delegate-grok or cursor-grok-4.5-high-fast)."
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
  const opusEffort = effort ?? "high";
  if (opusEffort !== "high") {
    respond({
      permission: "deny",
      user_message:
        "Opus effort must be GHOSTWRITER_EFFORT=high (thinking-high / effort=high)."
    });
    process.exit(0);
  }
  if (!opusHighModel) {
    respond({
      permission: "deny",
      user_message:
        "Creative escalation must use Opus thinking-high / effort=high (escalate-opus)."
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
  const gptEffort = effort ?? "sol";
  if (gptEffort !== "sol" && gptEffort !== "terra") {
    respond({
      permission: "deny",
      user_message:
        "GPT effort must be GHOSTWRITER_EFFORT=sol or GHOSTWRITER_EFFORT=terra."
    });
    process.exit(0);
  }
  if (gptSolType && gptEffort !== "sol") {
    respond({
      permission: "deny",
      user_message:
        "escalate-gpt is Sol effort. Use escalate-gpt-terra with GHOSTWRITER_EFFORT=terra."
    });
    process.exit(0);
  }
  if (gptTerraType && gptEffort !== "terra") {
    respond({
      permission: "deny",
      user_message:
        "escalate-gpt-terra requires GHOSTWRITER_EFFORT=terra."
    });
    process.exit(0);
  }
  if (gptEffort === "sol" && !gptSolModel) {
    respond({
      permission: "deny",
      user_message:
        "GPT Sol effort must use gpt-5.6-sol-medium (escalate-gpt)."
    });
    process.exit(0);
  }
  if (gptEffort === "terra" && !gptTerraModel) {
    respond({
      permission: "deny",
      user_message:
        "GPT Terra effort must use gpt-5.6-terra-medium (escalate-gpt-terra)."
    });
    process.exit(0);
  }
  if (!gptModel) {
    respond({
      permission: "deny",
      user_message:
        "Concrete escalation must use GPT 5.6. Retry with escalate-gpt or escalate-gpt-terra."
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
      "Classify this delegated development/validation task first. Prefer GHOSTWRITER_ROUTE=composer with GHOSTWRITER_EFFORT=fast|standard, then grok (high-fast). Escalate to escalate-opus (creative, high) or escalate-gpt (concrete, sol|terra) only with ESCALATION_REASON."
  });
  process.exit(0);
}

respond({ permission: "allow" });
