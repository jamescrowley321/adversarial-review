#!/usr/bin/env node
// Adversarial Review — local mode (Node, no shell).
//
// Runs the review personas against your working branch BEFORE you push, using
// the pi CLI. Each lens reads the branch diff and writes its findings to
// .adversarial-review/<lens>.md. Language-agnostic.
//
// Usage:
//   node scripts/run-local.mjs                     # adversarial lenses vs origin/main
//   node scripts/run-local.mjs --base main
//   node scripts/run-local.mjs --lens sentinel,viper
//   PI_BIN=pi MODEL=z-ai/glm-5.2 node scripts/run-local.mjs
//
// Requires: git, the `pi` CLI on PATH, and a provider key in OPENROUTER_API_KEY.
// Adjust the pi argv below for your pi version if needed.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LENS_DIR = join(ROOT, "lenses");
const OUT = ".adversarial-review";

// Local mode reviews code; the Compliance lens is a PR-time policy check, so it
// is not part of the default local set (add it explicitly with --lens if wanted).
const NAMES = {
  blind: "Blind Hunter",
  "edge-case": "Edge Case Hunter",
  acceptance: "Acceptance Auditor",
  sentinel: "Sentinel",
  viper: "Viper",
  compliance: "Compliance",
};

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n")
    .filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

let base = "origin/main";
let lenses = ["blind", "edge-case", "acceptance", "sentinel", "viper"];
let PI_BIN = process.env.PI_BIN || "pi";
let PROVIDER = process.env.PROVIDER || "openrouter";
let MODEL = process.env.MODEL || "z-ai/glm-5.2";
let THINKING = process.env.THINKING || "medium";

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base") base = argv[++i];
  else if (a === "--lens") lenses = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--model") MODEL = argv[++i];
  else if (a === "--provider") PROVIDER = argv[++i];
  else if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
  else { console.error(`Unknown arg: ${a}`); process.exit(2); }
}

mkdirSync(OUT, { recursive: true });

let diff;
try {
  diff = execFileSync("git", ["diff", `${base}...HEAD`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch {
  console.error(`error: could not diff against '${base}' — is it fetched? (git fetch origin)`);
  process.exit(1);
}
const patch = join(OUT, "review-diff.patch");
writeFileSync(patch, diff);
if (!diff.trim()) { console.log(`No changes vs ${base} — nothing to review.`); process.exit(0); }
console.log(`Diff: ${diff.split("\n").length} lines vs ${base}`);

for (const key of lenses) {
  const name = NAMES[key];
  if (!name) { console.log(`skip: unknown lens '${key}'`); continue; }
  const personaPath = join(LENS_DIR, `${key}.md`);
  if (!existsSync(personaPath)) { console.log(`skip: missing ${personaPath}`); continue; }

  const persona = readFileSync(personaPath, "utf8").split("__PR_NUMBER__").join("N/A (local review)");
  const prompt = [
    "LOCAL MODE: There is no pull request. The full diff to review is in the file",
    `\`${patch}\` (a \`git diff\`). Read that file instead of calling any GitHub tool.`,
    "Read surrounding source files on disk to confirm findings. Do NOT modify files.",
    "",
    persona,
    "",
    "## Output (local)",
    `Print your findings to stdout as a markdown section beginning with \`## ${name}\`,`,
    "using the severity terms MUST FIX / SHOULD FIX / NITPICK and `file:line` references.",
    'If no findings, write "No findings."',
  ].join("\n");

  console.log(`── ${name} ──`);
  const res = spawnSync(PI_BIN, ["--provider", PROVIDER, "--model", MODEL, "--thinking", THINKING], {
    input: prompt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) { console.log(`  ! could not run ${PI_BIN}: ${res.error.message}`); continue; }
  writeFileSync(join(OUT, `${key}.md`), res.stdout || "");
  if (res.status === 0) {
    console.log(`  → ${join(OUT, `${key}.md`)}`);
  } else {
    writeFileSync(join(OUT, `${key}.err`), res.stderr || "");
    console.log(`  ! exit ${res.status} (see ${join(OUT, `${key}.err`)})`);
  }
}

console.log(`\nDone. Findings in ${OUT}/. Review MUST FIX items before pushing.`);
