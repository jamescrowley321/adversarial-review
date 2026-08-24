#!/usr/bin/env node
// Adversarial Review — local mode (Node, no shell).
//
// Runs the review personas against your branch BEFORE you push, using the pi
// CLI (headless, read-only). Each lens reads the diff and writes findings to
// .adversarial-review/<lens>.md. Language-agnostic. Exits non-zero if any lens
// raises a MUST FIX finding (or fails to run) — so it drops into a pre-push
// hook or `make review` as a gate.
//
// Usage:
//   node scripts/run-local.mjs                     # lenses vs origin/main, gate on
//   node scripts/run-local.mjs --base main         # diff against a different base
//   node scripts/run-local.mjs --working           # review uncommitted changes (git diff HEAD)
//   node scripts/run-local.mjs --lens sentinel,viper
//   node scripts/run-local.mjs --no-gate           # report only, always exit 0
//   PI_BIN=pi MODEL=z-ai/glm-5.2 node scripts/run-local.mjs
//
// Requires: git, the `pi` CLI on PATH, and a provider key in OPENROUTER_API_KEY.
// Routing (ZDR + host guardrails) comes from ~/.pi/agent/models.json — see the
// venture's agent-model-config.md. pi runs read-only (--tools read,grep,find,ls),
// so a lens cannot modify your files even if a persona prompt is ignored.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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

// Detect a MUST FIX *finding* — a severity label in header/bold/bracket position —
// not a prose mention ("no MUST FIX findings") or the severity-scale enumeration.
// (CI uses the lenses' strict JSON shape; local markdown output is heuristic.)
function hasMustFix(md) {
  return /^#{1,6}\s*\[?\s*MUST FIX\b/m.test(md)   // ### MUST FIX header (severity is the heading)
    || /\*\*\s*\[?\s*MUST FIX\b/.test(md)         // **MUST FIX… / **[MUST FIX…  (label at bold start)
    || /\[\s*MUST FIX\s*\]/.test(md);             // [MUST FIX] tag
}

let base = "origin/main";
let working = false;
let gate = true;
let lenses = ["blind", "edge-case", "acceptance", "sentinel", "viper"];
let PI_BIN = process.env.PI_BIN || "pi";
let PROVIDER = process.env.PROVIDER || "openrouter";
let MODEL = process.env.MODEL || "z-ai/glm-5.2";
let THINKING = process.env.THINKING || "medium";

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base") base = argv[++i];
  else if (a === "--working") working = true;
  else if (a === "--no-gate") gate = false;
  else if (a === "--lens") lenses = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--model") MODEL = argv[++i];
  else if (a === "--provider") PROVIDER = argv[++i];
  else if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
  else { console.error(`Unknown arg: ${a}`); process.exit(2); }
}

mkdirSync(OUT, { recursive: true });

// Non-destructive routing check: warn (never rewrite) if the OpenRouter model
// isn't pinned to a ZDR route in the user's pi config. The dev owns models.json
// (agent-model-config.md); we don't clobber it.
if (PROVIDER === "openrouter") {
  let cfg = null;
  try {
    cfg = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "models.json"), "utf8"));
  } catch (e) {
    console.log(e.code === "ENOENT"
      ? `  ! warning: no ~/.pi/agent/models.json found — ZDR/host guardrails unenforced (see agent-model-config.md)`
      : `  ! warning: could not read ~/.pi/agent/models.json (${e.message}) — ZDR check skipped`);
  }
  if (cfg) {
    const zdr = cfg?.providers?.[PROVIDER]?.modelOverrides?.[MODEL]?.compat?.openRouterRouting?.zdr;
    if (zdr !== true) {
      console.log(`  ! warning: ZDR route not pinned for ${MODEL} in ~/.pi/agent/models.json — see agent-model-config.md`);
    }
  }
}

let diff;
const gitArgs = working ? ["diff", "HEAD"] : ["diff", `${base}...HEAD`];
const label = working ? "working tree (uncommitted)" : base;
try {
  diff = execFileSync("git", gitArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch {
  console.error(working
    ? "error: could not run `git diff HEAD`"
    : `error: could not diff against '${base}' — is it fetched? (git fetch origin)`);
  process.exit(1);
}
const patch = join(OUT, "review-diff.patch");
writeFileSync(patch, diff);
if (!diff.trim()) { console.log(`No changes vs ${label} — nothing to review.`); process.exit(0); }
console.log(`Diff: ${diff.split("\n").length} lines vs ${label}`);

const mustFix = []; // lenses that raised a MUST FIX
const failed = [];  // lenses that could not run (incomplete review)

for (const key of lenses) {
  const name = NAMES[key];
  // A requested lens that can't run makes the review incomplete → it must fail the
  // gate, not be silently skipped.
  if (!name) { console.log(`skip: unknown lens '${key}'`); failed.push(key); continue; }
  const personaPath = join(LENS_DIR, `${key}.md`);
  if (!existsSync(personaPath)) { console.log(`skip: missing ${personaPath}`); failed.push(key); continue; }

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
  // -p: headless (process prompt from stdin and exit). --no-session: fresh
  // context per lens. --tools read,grep,find,ls: read-only, cannot edit/run.
  const res = spawnSync(
    PI_BIN,
    ["-p", "--no-session", "--tools", "read,grep,find,ls", "--provider", PROVIDER, "--model", MODEL, "--thinking", THINKING],
    { input: prompt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) { console.log(`  ! could not run ${PI_BIN}: ${res.error.message}`); failed.push(key); continue; }
  const out = res.stdout || "";
  writeFileSync(join(OUT, `${key}.md`), out);
  if (res.status === 0) {
    const hit = hasMustFix(out);
    if (hit) mustFix.push(key);
    console.log(`  → ${join(OUT, `${key}.md`)}${hit ? "  [MUST FIX]" : ""}`);
  } else {
    writeFileSync(join(OUT, `${key}.err`), res.stderr || "");
    console.log(`  ! exit ${res.status} (see ${join(OUT, `${key}.err`)})`);
    failed.push(key);
  }
}

console.log(`\nFindings in ${OUT}/.`);

// Gate: fail on any MUST FIX, or if a lens could not run (a gate can't pass on
// an incomplete review). --no-gate reports only.
if (gate && (mustFix.length || failed.length)) {
  if (mustFix.length) console.log(`GATE: FAIL — MUST FIX in: ${mustFix.join(", ")} (resolve before pushing)`);
  if (failed.length) console.log(`GATE: FAIL — lens did not run: ${failed.join(", ")} (re-run; review is incomplete)`);
  process.exit(1);
}
console.log(gate ? "GATE: PASS — no MUST FIX findings." : "Gate disabled (--no-gate); review the findings manually.");
