#!/usr/bin/env node
// Blind Peer Review — local mode (Node, no shell).
//
// Runs the review personas against your working branch BEFORE you push, using
// the pi CLI. Each lens reads the branch diff and writes its findings to
// .blind-peer-review/out/<lens>.json. A repo can override any persona by committing
// .blind-peer-review/lenses/<lens>.md (trusted local tuning). Language-agnostic.
//
// Usage:
//   node scripts/run-local.mjs                     # adversarial lenses vs origin/main
//   node scripts/run-local.mjs --base main
//   node scripts/run-local.mjs --lens security,red-team
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
const CONTRACT = join(ROOT, "contracts", "shared-review-contract.md");
const OUT = ".blind-peer-review/out";              // ephemeral: diff + per-lens findings
const OVERRIDE_DIR = ".blind-peer-review/lenses";  // committed: per-repo persona overrides

// The lens registry is the shared, harness-neutral manifest — one source of truth.
// (Local mode reviews code; Compliance is a PR-time policy check, so it is not in
// the default local set — add it explicitly with --lens if wanted.)
const manifest = JSON.parse(readFileSync(join(LENS_DIR, "manifest.json"), "utf8"));
const NAMES = Object.fromEntries(manifest.lenses.map((l) => [l.key, l.name]));

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n")
    .filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

let base = "origin/main";
let lenses = ["cold-read", "edge-case", "acceptance", "security", "red-team"];
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

const verdicts = [];

for (const key of lenses) {
  const name = NAMES[key];
  if (!name) { console.log(`skip: unknown lens '${key}'`); continue; }
  // A committed local override wins over the base persona (trusted, static tuning).
  const overridePath = join(OVERRIDE_DIR, `${key}.md`);
  const personaPath = existsSync(overridePath) ? overridePath : join(LENS_DIR, `${key}.md`);
  if (!existsSync(personaPath)) { console.log(`skip: missing ${personaPath}`); continue; }
  if (personaPath === overridePath) console.log(`  (local override: ${overridePath})`);

  const persona = readFileSync(personaPath, "utf8").split("__PR_NUMBER__").join("N/A (local review)");
  // The shared contract carries the trust boundary, the severity terms and the
  // output envelope. Local runs used to inline their own envelope and skip the
  // rest, which left a local review with no injection defence at all.
  const prompt = [
    "LOCAL MODE: There is no pull request. The full diff to review is in the file",
    `\`${patch}\` (a \`git diff\`). Read that file instead of calling any GitHub tool.`,
    "Read surrounding source files on disk to confirm findings. Do NOT modify files.",
    "",
    persona,
    "",
    readFileSync(CONTRACT, "utf8"),
    "",
    "There is no submission tool here: print the contract's JSON object to stdout as",
    "your entire output — no prose, no markdown fences.",
  ].join("\n");

  console.log(`── ${name} ──`);
  const res = spawnSync(PI_BIN, ["--provider", PROVIDER, "--model", MODEL, "--thinking", THINKING], {
    input: prompt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    console.log(`  ! could not run ${PI_BIN}: ${res.error.message}`);
    verdicts.push({ key, name, state: "FAILED", must: 0, note: `could not run ${PI_BIN}` });
    continue;
  }
  const out = res.stdout || "";
  writeFileSync(join(OUT, `${key}.json`), out);
  if (res.status !== 0) {
    writeFileSync(join(OUT, `${key}.err`), res.stderr || "");
    console.log(`  ! exit ${res.status} (see ${join(OUT, `${key}.err`)})`);
    verdicts.push({ key, name, state: "FAILED", must: 0, note: `exit ${res.status}` });
    continue;
  }
  // Adjudicate on the parsed severity, never on the text. A lens that writes
  // "no MUST FIX findings" is a pass, and substring matching would block it.
  let parsed = null;
  try { parsed = JSON.parse(out.trim()); } catch { /* handled below */ }
  if (!parsed || !Array.isArray(parsed.findings)) {
    console.log(`  ! ${join(OUT, `${key}.json`)} is not the contract object — lens FAILED`);
    verdicts.push({ key, name, state: "FAILED", must: 0, note: "output is not the contract object" });
    continue;
  }
  const must = parsed.findings.filter((f) => f && f.severity === "MUST FIX").length;
  verdicts.push({ key, name, state: must ? "BLOCK" : "PASS", must, findings: parsed.findings });
  console.log(`  → ${join(OUT, `${key}.json`)} (${must} MUST FIX)`);
}

console.log(`\nDone. Findings in ${OUT}/. Review MUST FIX items before pushing.`);

// Fail closed: a MUST FIX blocks, and so does a lens whose review could not be
// read. A review nobody could parse has not passed.
console.log("\n── verdict ──");
for (const v of verdicts) {
  const detail = v.state === "FAILED" ? ` (${v.note})` : ` (${v.must} MUST FIX)`;
  console.log(`  ${v.state.padEnd(6)} ${v.name}${detail}`);
}
const blocked = verdicts.filter((v) => v.state !== "PASS");
if (blocked.length) {
  for (const v of verdicts) {
    for (const f of (v.findings || []).filter((f) => f.severity === "MUST FIX")) {
      console.log(`\n  [${v.name}] ${f.location}\n    ${f.detail}`);
    }
  }
  console.log(`\nBLOCK — ${blocked.length} lens(es) blocked or failed.`);
  process.exit(1);
}
console.log("\nPASS — no MUST FIX findings.");
