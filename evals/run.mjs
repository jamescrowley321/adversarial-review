#!/usr/bin/env node
// Live lens evals — fixture in, gate verdict out.
//
//   node evals/run.mjs                    # smoke set, 3 reps  (needs OPENROUTER_API_KEY)
//   node evals/run.mjs --full             # every fixture
//   node evals/run.mjs --lens acceptance  # one lens
//   node evals/run.mjs --fixture acceptance-docs-only
//   node evals/run.mjs --reps 5           # more reps = tighter stability estimate
//   node evals/run.mjs --model google/gemini-2.5-pro
//   node evals/run.mjs --dry-run          # compose prompts, print the plan, no paid calls
//   node evals/run.mjs --write-baseline   # record the scorecard and ALWAYS exit 0
//   node evals/run.mjs --out report.md
//
// Each fixture is fed through action.yml's real prompt assembly and its real
// findings parser. The only assertion that must be exact is the gate verdict —
// block or not — because that is what actually stops a merge. Finding prose is
// printed on failure for diagnosis and never asserted on.
//
// Zero npm dependencies. Node >= 20.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, runParseStep, filesFromDiff, parseReviewBody } from "./lib/harness.mjs";
import { listFixtureIds, loadFixture, selectRuns, composePrompt } from "./lib/fixtures.mjs";
import { chat, mapLimit, ModelError } from "./lib/openrouter.mjs";
import { foldReps, score, violations, renderScorecard, buildBaseline, THRESHOLDS } from "./lib/scorecard.mjs";

const DEFAULT_MODEL = defaultModelFromAction();

function defaultModelFromAction() {
  // Pin to whatever the action itself ships as its default, so the scorecard
  // describes the configuration consumers actually run.
  const yml = readFileSync(join(ROOT, "action.yml"), "utf8");
  const m = yml.match(/\n {2}model:\n(?:[^\n]*\n)*? {4}default: '([^']+)'/);
  return m ? m[1] : "google/gemini-2.5-pro";
}

function parseArgs(argv) {
  const a = {
    full: false, reps: 3, lens: null, fixture: null, model: process.env.EVAL_MODEL || DEFAULT_MODEL,
    dryRun: false, writeBaseline: false, out: null, concurrency: Number(process.env.EVAL_CONCURRENCY || 4),
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--full") a.full = true;
    else if (k === "--reps") a.reps = Number(argv[++i]);
    else if (k === "--lens") a.lens = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--fixture") a.fixture = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--write-baseline") a.writeBaseline = true;
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--concurrency") a.concurrency = Number(argv[++i]);
    else if (k === "-h" || k === "--help") { help(); process.exit(0); }
    else { console.error(`Unknown arg: ${k}`); process.exit(2); }
  }
  return a;
}

const help = () =>
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));

const args = parseArgs(process.argv.slice(2));

const runs = selectRuns({
  ids: args.fixture || listFixtureIds(),
  lenses: args.lens,
  smokeOnly: !args.full && !args.fixture,
});
if (!runs.length) { console.error("No fixtures selected."); process.exit(2); }

let ref = "working tree";
try { ref = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch {}

console.log(`Model:   ${args.model}`);
console.log(`Runs:    ${runs.length} (fixture × lens) × ${args.reps} rep(s) = ${runs.length * args.reps} model call(s)`);
console.log(`Set:     ${args.full || args.fixture ? "full" : "smoke"}\n`);

if (args.dryRun) {
  for (const r of runs) {
    const prompt = await composePrompt(r.lensKey, r.fx);
    console.log(`── ${r.id} × ${r.lensKey} — ${prompt.length} chars, expect ${r.expect.block ? "BLOCK" : "no block"}`);
    if (process.env.EVAL_PRINT_PROMPT) console.log(prompt, "\n");
  }
  console.log("\nDry run: prompts composed from the action's own steps. No model calls made.");
  process.exit(0);
}

let resolvedModel = null;

const results = await mapLimit(runs, args.concurrency, async (run) => {
  const prompt = await composePrompt(run.lensKey, run.fx);
  const files = filesFromDiff(run.fx.diff);
  const reps = [];
  for (let rep = 0; rep < args.reps; rep++) {
    try {
      // rep 0 at temperature 0 is the reproducible draw; later reps sample so
      // an unstable verdict shows up as instability rather than hiding behind
      // a single deterministic answer.
      const res = await chat({ model: args.model, prompt, temperature: rep === 0 ? 0 : 0.4 });
      resolvedModel ||= res.resolvedModel;
      // The action's REAL parser decides whether this output is acceptable and
      // whether it blocks. Never re-implement that judgement here.
      const posted = await runParseStep({ lensName: run.lensName, agentResponse: res.text, files });
      reps.push({
        parsed: posted.failed == null,
        parseError: posted.failed,
        blocked: posted.blocked,
        findings: parseReviewBody(posted.body),
        ms: res.ms,
        raw: res.text.slice(0, 4000),
      });
    } catch (err) {
      if (err instanceof ModelError && err.retryable === false) {
        console.error(`\nFATAL: ${err.message}`);
        process.exit(3);
      }
      reps.push({ parsed: false, error: String(err.message || err), blocked: null, findings: [] });
    }
  }
  const folded = foldReps(run, reps);
  console.log(`${folded.pass ? "PASS" : "FAIL"}  ${run.id} × ${run.lensKey} — ${folded.reason}`);
  return folded;
});

const byLens = score(results);
const vs = args.writeBaseline ? [] : violations(byLens, THRESHOLDS);
const meta = {
  model: args.model, resolvedModel, reps: args.reps, ref,
  fixtureCount: new Set(runs.map((r) => r.id)).size,
  set: args.full || args.fixture ? "full" : "smoke",
  thresholds: THRESHOLDS,
};

const md = renderScorecard({ byLens, results, meta, violations: violations(byLens, THRESHOLDS) });
const outDir = join(ROOT, "evals", "baseline");
mkdirSync(outDir, { recursive: true });
const mdPath = args.out || join(outDir, "scorecard.md");
writeFileSync(mdPath, md + "\n");
writeFileSync(join(outDir, "baseline.json"), JSON.stringify(buildBaseline({ byLens, results, meta }), null, 2) + "\n");
console.log(`\nScorecard: ${mdPath}`);
console.log(`Baseline:  ${join(outDir, "baseline.json")}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n", { flag: "a" });
}

const finalViolations = violations(byLens, THRESHOLDS);
if (finalViolations.length) {
  console.error(`\n${finalViolations.length} violation(s):`);
  for (const v of finalViolations) console.error(`  - ${v}`);
  if (args.writeBaseline) {
    console.error("\n--write-baseline: recorded as the honest baseline; exiting 0.");
    process.exit(0);
  }
  process.exit(1);
}
console.log("\nAll fixtures within thresholds.");
