import process from "node:process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = resolve(skillDirectory, "SKILL.md");
const source = await readFile(skillPath, "utf8");
const lines = source.split(/\r?\n/u);
const failures = [];

if (lines.length > 500) failures.push(`SKILL.md has ${lines.length} lines; maximum is 500.`);

const frontmatter = source.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
const name = frontmatter.match(/^name:\s*(.+)$/mu)?.[1]?.trim();
const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1]?.trim();

if (name !== "ghostwriter-autonomous-delivery") {
  failures.push("Skill name is missing or invalid.");
}
if (description === undefined || description.length === 0 || description.length > 1024) {
  failures.push("Skill description must contain 1–1024 characters.");
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

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Skill valid: ${lines.length} lines, ${links.length} local reference${links.length === 1 ? "" : "s"}.\n`
  );
}
