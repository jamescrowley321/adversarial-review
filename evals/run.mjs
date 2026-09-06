#!/usr/bin/env node
// Live lens evals — fixture in, gate verdict out.
//
//   node evals/run.mjs                    # smoke set, 3 reps  (needs OPENROUTER_API_KEY)
//   node evals/run.mjs --full             # every fixture
//   node evals/run.mjs --lens acceptance  # one lens
//   node evals/run.mjs --fixture acceptance-docs-only
//   node evals/run.mjs --reps 5           # more reps = tighter stability estimate
//   node evals/run.mjs --max-tokens 12000 # raise if reps report truncation
//   node evals/run.mjs --model google/gemini-2.5-pro
//   node evals/run.mjs --dry-run          # compose prompts, print the plan, spend nothing
//   node evals/run.mjs --write-baseline   # record the scorecard and always exit 0
//   node evals/run.mjs --out report.md
//
// Each fixture is fed through action.yml's real prompt assembly and its real
// findings parser. The only assertion that must be exact is the gate verdict —
// block or not — because that is what actually stops a merge. Finding prose is
// printed on failure for diagnosis and never asserted on.
//
// PHASES (--phase, default `all`)
//
//   compose  read fixtures, run action.yml's compose step, write prompts
//   call     send the prompts to the model, write raw responses
//   score    run action.yml's findings parser over the responses, write the scorecard
//
// Locally `all` runs the three back to back. CI splits them on purpose: `compose`
// and `score` EXECUTE script text taken from the pull request's own action.yml,
// and `call` is the only phase that needs OPENROUTER_API_KEY. Splitting them
// keeps the provider key out of the environment of every step that runs
// PR-controlled code, so a malicious edit to action.yml has no secret to reach.
//
// Zero npm dependencies. Node >= 20.

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, runParseStep, filesFromDiff, parseReviewBody } from "./lib/harness.mjs";
import { listFixtureIds, loadFixture, selectRuns, composePrompt } from "./lib/fixtures.mjs";
import { chat, mapLimit, ModelError } from "./lib/openrouter.mjs";
import { foldReps, score, violations, renderScorecard, buildBaseline, THRESHOLDS } from "./lib/scorecard.mjs";

const PHASES = ["all", "compose", "call", "score"];

function defaultModelFromAction() {
  // Pin to whatever the action itself ships as its default, so the scorecard
  // describes the configuration consumers actually run.
  const yml = readFileSync(join(ROOT, "action.yml"), "utf8");
  const m = yml.match(/\n {2}model:\n(?:[^\n]*\n)*? {4}default: '([^']+)'/);
  return m ? m[1] : "google/gemini-2.5-pro";
}

const die = (msg) => { console.error(`Error: ${msg}`); process.exit(2); };

/** Read a flag's value, refusing a missing one or the next flag masquerading as it. */
function value(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || v.startsWith("--")) die(`${flag} requires a value`);
  return v;
}

function positiveInt(raw, flag) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) die(`${flag} must be a positive integer (got ${JSON.stringify(raw)})`);
  return n;
}

function list(raw, flag) {
  const xs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!xs.length) die(`${flag} needs at least one value`);
  return xs;
}

function parseArgs(argv) {
  const a = {
    full: false, reps: 3, lens: null, fixture: null, model: process.env.EVAL_MODEL || defaultModelFromAction(),
    dryRun: false, writeBaseline: false, out: null,
    concurrency: positiveInt(process.env.EVAL_CONCURRENCY || "4", "EVAL_CONCURRENCY"),
    maxTokens: positiveInt(process.env.EVAL_MAX_TOKENS || "8000", "EVAL_MAX_TOKENS"),
    phase: process.env.EVAL_PHASE || "all",
    work: process.env.EVAL_WORK || join(ROOT, "evals", ".work"),
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--full") a.full = true;
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--write-baseline") a.writeBaseline = true;
    else if (k === "--reps") a.reps = positiveInt(value(argv, ++i, k), k);
    else if (k === "--concurrency") a.concurrency = positiveInt(value(argv, ++i, k), k);
    else if (k === "--max-tokens") a.maxTokens = positiveInt(value(argv, ++i, k), k);
    else if (k === "--lens") a.lens = list(value(argv, ++i, k), k);
    else if (k === "--fixture") a.fixture = list(value(argv, ++i, k), k);
    else if (k === "--model") a.model = value(argv, ++i, k);
    else if (k === "--out") a.out = value(argv, ++i, k);
    else if (k === "--work") a.work = value(argv, ++i, k);
    else if (k === "--phase") a.phase = value(argv, ++i, k);
    else if (k === "-h" || k === "--help") { help(); process.exit(0); }
    else die(`unknown argument ${k}`);
  }
  if (!PHASES.includes(a.phase)) die(`--phase must be one of ${PHASES.join(" | ")} (got ${JSON.stringify(a.phase)})`);
  if (a.model.trim() === "") die("--model cannot be empty");
  return a;
}

const help = () =>
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));

const args = parseArgs(process.argv.slice(2));
const slug = (r) => `${r.id}__${r.lensKey}`;
const planPath = join(args.work, "plan.json");

let ref = "working tree";
try { ref = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch {}

// ─────────────────────────────── compose ───────────────────────────────
// Executes action.yml's own "Compose lens prompt" step. No provider key needed.

async function compose() {
  const runs = selectRuns({
    ids: args.fixture || listFixtureIds(),
    lenses: args.lens,
    smokeOnly: !args.full && !args.fixture,
  });
  if (!runs.length) die("no fixtures selected");

  // Deliberately NOT `rm -rf args.work`: --work takes an arbitrary path, and a
  // recursive delete of whatever a developer typed (or of `/`) is not a risk
  // worth carrying to save a few unlink calls. Create the directory, then
  // remove only files this harness itself writes.
  mkdirSync(args.work, { recursive: true });
  for (const f of readdirSync(args.work)) {
    if (f === "plan.json" || /\.prompt\.txt$/.test(f) || /\.rep\d+\.json$/.test(f)) {
      rmSync(join(args.work, f), { force: true });
    }
  }

  const plan = { meta: { model: args.model, reps: args.reps, maxTokens: args.maxTokens, ref, set: args.full || args.fixture ? "full" : "smoke", fixtureCount: new Set(runs.map((r) => r.id)).size }, runs: [] };
  for (const r of runs) {
    const prompt = await composePrompt(r.lensKey, r.fx);
    writeFileSync(join(args.work, `${slug(r)}.prompt.txt`), prompt);
    plan.runs.push({ id: r.id, lensKey: r.lensKey, lensName: r.lensName, expect: r.expect, class: r.fx.class, guards: r.fx.guards, chars: prompt.length });
  }
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
  console.log(`Composed ${plan.runs.length} prompt(s) into ${args.work}`);
  for (const r of plan.runs) console.log(`  ${r.id} × ${r.lensKey} — ${r.chars} chars, expect ${r.expect.block ? "BLOCK" : "no block"}`);
  return plan;
}

function readPlan() {
  if (!existsSync(planPath)) die(`no plan at ${planPath} — run --phase compose first`);
  return JSON.parse(readFileSync(planPath, "utf8"));
}

// ───────────────────────────────── call ─────────────────────────────────
// The ONLY phase that needs OPENROUTER_API_KEY. Executes no repo script text:
// it reads prompt files and writes response files.

async function call(plan) {
  const items = [];
  for (const r of plan.runs) for (let rep = 0; rep < plan.meta.reps; rep++) items.push({ r, rep });

  await mapLimit(items, args.concurrency, async ({ r, rep }) => {
    const promptPath = join(args.work, `${r.id}__${r.lensKey}.prompt.txt`);
    const out = join(args.work, `${r.id}__${r.lensKey}.rep${rep}.json`);
    if (!existsSync(promptPath)) {
      die(`missing prompt ${promptPath} — the plan and the work directory disagree. Re-run --phase compose.`);
    }
    const prompt = readFileSync(promptPath, "utf8");
    try {
      // rep 0 at temperature 0 is the reproducible draw; later reps sample so an
      // unstable verdict shows up as instability rather than hiding behind one
      // deterministic answer.
      const res = await chat({ model: plan.meta.model, prompt, temperature: rep === 0 ? 0 : 0.4, maxTokens: plan.meta.maxTokens });
      writeFileSync(out, JSON.stringify({ text: res.text, finishReason: res.finishReason, resolvedModel: res.resolvedModel, ms: res.ms }, null, 2));
    } catch (err) {
      if (err instanceof ModelError && err.retryable === false) {
        console.error(`\nFATAL: ${err.message}`);
        process.exit(3);
      }
      // Recording the failure must not itself become a failure — a full disk
      // here would otherwise lose every other fixture's result too.
      try {
        writeFileSync(out, JSON.stringify({ error: String(err.message || err) }, null, 2));
      } catch (writeErr) {
        console.error(`could not record the error for ${r.id} × ${r.lensKey}: ${writeErr.message}`);
      }
    }
  });
  console.log(`Collected ${items.length} response(s) into ${args.work}`);
}

// ───────────────────────────────── score ─────────────────────────────────
// Executes action.yml's own findings parser. No provider key needed.

async function scorePhase(plan) {
  let resolvedModel = null;
  const results = [];
  for (const r of plan.runs) {
    const fx = loadFixture(r.id);
    const files = filesFromDiff(fx.diff);
    const reps = [];
    for (let rep = 0; rep < plan.meta.reps; rep++) {
      const p = join(args.work, `${r.id}__${r.lensKey}.rep${rep}.json`);
      if (!existsSync(p)) { reps.push({ parsed: false, error: "no response recorded", blocked: null, findings: [] }); continue; }
      let rec;
      try {
        rec = JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        // A response file truncated by a killed run must not take the whole
        // scorecard down with it — the other fixtures' results are still worth
        // reporting, and a crash here looks identical to "the evals passed".
        reps.push({ parsed: false, error: `unreadable response file ${p}: ${e.message}`, blocked: null, findings: [] });
        continue;
      }
      if (rec.error) { reps.push({ parsed: false, error: rec.error, blocked: null, findings: [] }); continue; }
      resolvedModel ||= rec.resolvedModel;
      // The action's REAL parser decides whether this output is acceptable and
      // whether it blocks. Never re-implement that judgement here.
      const posted = await runParseStep({ lensName: r.lensName, agentResponse: rec.text, files });
      reps.push({
        parsed: posted.failed == null,
        parseError: posted.failed,
        // A `length` finish means WE cut the model off — a harness limit, which
        // the scorecard must not report as the lens emitting bad JSON.
        truncated: rec.finishReason === "length",
        finishReason: rec.finishReason,
        blocked: posted.blocked,
        findings: parseReviewBody(posted.body),
        ms: rec.ms,
      });
    }
    const folded = foldReps({ id: r.id, lensKey: r.lensKey, expect: r.expect, fx }, reps);
    console.log(`${folded.pass ? "PASS" : "FAIL"}  ${r.id} × ${r.lensKey} — ${folded.reason}`);
    results.push(folded);
  }

  const byLens = score(results);
  const meta = { ...plan.meta, resolvedModel, thresholds: THRESHOLDS };
  const vs = violations(byLens, THRESHOLDS);

  const md = renderScorecard({ byLens, results, meta, violations: vs });
  const outDir = join(ROOT, "evals", "baseline");
  mkdirSync(outDir, { recursive: true });
  const mdPath = args.out || join(outDir, "scorecard.md");
  writeFileSync(mdPath, md + "\n");
  writeFileSync(join(outDir, "baseline.json"), JSON.stringify(buildBaseline({ byLens, results, meta }), null, 2) + "\n");
  console.log(`\nScorecard: ${mdPath}`);
  console.log(`Baseline:  ${join(outDir, "baseline.json")}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n", { flag: "a" });

  if (vs.length) {
    console.error(`\n${vs.length} violation(s):`);
    for (const v of vs) console.error(`  - ${v}`);
    if (args.writeBaseline) {
      console.error("\n--write-baseline: recorded as the honest baseline; exiting 0.");
      return;
    }
    process.exit(1);
  }
  console.log("\nAll fixtures within thresholds.");
}

// ───────────────────────────────── main ─────────────────────────────────

console.log(`Model:   ${args.model}`);
console.log(`Phase:   ${args.phase}\n`);

if (args.dryRun) {
  const plan = await compose();
  if (process.env.EVAL_PRINT_PROMPT) {
    for (const r of plan.runs) console.log("\n" + readFileSync(join(args.work, `${r.id}__${r.lensKey}.prompt.txt`), "utf8"));
  }
  console.log("\nDry run: prompts composed from the action's own steps. No model calls made.");
  process.exit(0);
}

if (args.phase === "compose") { await compose(); }
else if (args.phase === "call") { await call(readPlan()); }
else if (args.phase === "score") { await scorePhase(readPlan()); }
else {
  const plan = await compose();
  console.log("");
  await call(plan);
  console.log("");
  await scorePhase(plan);
}
