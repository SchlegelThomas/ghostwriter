import process from "node:process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(skillDirectory, "../../..");
const skillPath = resolve(skillDirectory, "SKILL.md");
const source = await readFile(skillPath, "utf8");
const lines = source.split(/\r?\n/u);
const failures = [];

if (lines.length > 500) failures.push(`SKILL.md has ${lines.length} lines; maximum is 500.`);

const frontmatter = source.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
const name = frontmatter.match(/^name:\s*(.+)$/mu)?.[1]?.trim();
const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1]?.trim();

if (name !== "ghostwriter-feature-delivery") {
  failures.push("Skill name is missing or invalid.");
}
if (description === undefined || description.length === 0 || description.length > 1024) {
  failures.push("Skill description must contain 1–1024 characters.");
}
if (/\bautonomous\b/iu.test(source)) {
  failures.push("SKILL.md must not use the word “autonomous”.");
}

const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map((match) => match[1]);
for (const link of links) {
  if (link.includes("/") || link.startsWith("#") || /^[a-z]+:/iu.test(link)) {
    failures.push(`Skill references must be one-level local files: ${link}`);
    continue;
  }
  try {
    await access(resolve(skillDirectory, link));
  } catch {
    failures.push(`Referenced skill file does not exist: ${link}`);
  }
}

const requiredSkillText = [
  "Parent owns end-to-end",
  "## Delegation ladder",
  "GHOSTWRITER_ROUTE=composer",
  "GHOSTWRITER_ROUTE=grok",
  "GHOSTWRITER_ROUTE=escalate-opus ESCALATION_REASON=<reason>",
  "GHOSTWRITER_ROUTE=escalate-gpt ESCALATION_REASON=<reason>",
  "GHOSTWRITER_PLAYWRIGHT_GATE=user-verified",
  "browser walkthrough",
  "## Parallel work",
  "## Delegated-task return shape",
  "stop reason"
];
for (const text of requiredSkillText) {
  if (!source.includes(text)) {
    failures.push(`SKILL.md is missing required guidance text: ${text}`);
  }
}

const agentRequirements = [
  {
    path: resolve(repositoryRoot, ".cursor/agents/delegate-composer.md"),
    name: "delegate-composer",
    model: "composer-2.5[fast=true]"
  },
  {
    path: resolve(repositoryRoot, ".cursor/agents/delegate-grok.md"),
    name: "delegate-grok",
    model: "grok-4.5"
  },
  {
    path: resolve(repositoryRoot, ".cursor/agents/escalate-opus.md"),
    name: "escalate-opus",
    model: "claude-opus-5-thinking-high"
  },
  {
    path: resolve(repositoryRoot, ".cursor/agents/escalate-gpt.md"),
    name: "escalate-gpt",
    model: "gpt-5.6-sol-medium"
  }
];
for (const requirement of agentRequirements) {
  try {
    const agent = await readFile(requirement.path, "utf8");
    if (!agent.includes(`name: ${requirement.name}`)) {
      failures.push(`${requirement.path} does not declare name: ${requirement.name}`);
    }
    if (!agent.includes(`model: ${requirement.model}`)) {
      failures.push(`${requirement.path} does not pin model: ${requirement.model}`);
    }
  } catch {
    failures.push(`Required project subagent does not exist: ${requirement.path}`);
  }
}

const retiredAgents = ["routine-tests.md", "hard-tests.md"];
for (const retired of retiredAgents) {
  try {
    await access(resolve(repositoryRoot, ".cursor/agents", retired));
    failures.push(`Retired project subagent must be removed: ${retired}`);
  } catch {
    // expected missing
  }
}

const rulePath = resolve(repositoryRoot, ".cursor/rules/feature-delivery.mdc");
try {
  const rule = await readFile(rulePath, "utf8");
  if (!rule.includes("alwaysApply: true")) {
    failures.push("feature-delivery.mdc must set alwaysApply: true.");
  }
  if (!rule.includes("ghostwriter-feature-delivery")) {
    failures.push("feature-delivery.mdc must reference ghostwriter-feature-delivery.");
  }
  if (!rule.includes("delegate-composer")) {
    failures.push("feature-delivery.mdc must reference the delegation ladder.");
  }
} catch {
  failures.push(`Required always-applied rule does not exist: ${rulePath}`);
}

const hookScript = resolve(
  repositoryRoot,
  ".cursor/hooks/enforce-delegate-model-routing.mjs"
);
try {
  await access(hookScript);
} catch {
  failures.push(`Required model-routing hook does not exist: ${hookScript}`);
}

const hooksPath = resolve(repositoryRoot, ".cursor/hooks.json");
try {
  const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
  const starts = hooks?.hooks?.subagentStart;
  if (
    hooks?.version !== 1 ||
    !Array.isArray(starts) ||
    !starts.some(
      (entry) =>
        entry?.command ===
          "node .cursor/hooks/enforce-delegate-model-routing.mjs" &&
        entry?.failClosed === true
    )
  ) {
    failures.push(
      ".cursor/hooks.json must fail closed on the delegate model-routing subagentStart hook."
    );
  }
} catch {
  failures.push(".cursor/hooks.json is missing or invalid JSON.");
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Skill valid: ${lines.length} lines, ${links.length} local reference${links.length === 1 ? "" : "s"}.\n`
  );
}
