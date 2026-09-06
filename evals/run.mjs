// Adversarial Review — lens evals.
//
// Layer 1 (offline, deterministic): validate a lens's JSON envelope against the
// contract in lenses/shared-instructions.md. No model, no network, no key.
// Layer 2 (sampled): run a lens against a fixture via the pi CLI N times and
// assert on whether it BLOCKS, not on its prose. Skips cleanly with no key.
//
// Usage:
//   node evals/run.mjs --layer 1
//   node evals/run.mjs --layer 2 [--fixture NAME] [--samples 5] [--threshold 0.8]
//   MODEL=google/gemini-2.5-pro node evals/run.mjs

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "evals", "fixtures");
const OUT = path.join(ROOT, ".eval-runs");

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const LAYER = String(arg("--layer", "all"));
const ONLY = arg("--fixture", null);
const SAMPLES = Number(arg("--samples", 5));
const THRESHOLD = Number(arg("--threshold", 0.8));
const MODEL = process.env.MODEL || "google/gemini-2.5-pro";
const PI_BIN = process.env.PI_BIN || "pi";

const SEVERITIES = new Set(["MUST FIX", "SHOULD FIX", "NITPICK"]);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

// ── Layer 1: the envelope contract ──────────────────────────────────────────
export function validateEnvelope(raw, { lensName, diffPaths }) {
  const errors = [];
  let parsed = null;
  const trimmed = String(raw ?? "").trim();
  if (/^```/.test(trimmed)) errors.push("output is wrapped in a markdown fence");
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    errors.push("no parseable JSON object as the final message");
    return { ok: false, errors, parsed };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("top level is not a JSON object");
    return { ok: false, errors, parsed };
  }
  const emitted = String(parsed.lens || "").trim();
  const nameOk = emitted && (norm(emitted) === norm(lensName) ||
    norm(emitted).includes(norm(lensName)) || norm(lensName).includes(norm(emitted)));
  if (!nameOk) errors.push(`lens="${emitted}" does not match job "${lensName}"`);
  if (!Array.isArray(parsed.findings)) {
    errors.push("findings missing or not an array (use [] for none)");
  } else {
    parsed.findings.forEach((f, i) => {
      if (!SEVERITIES.has(f?.severity)) errors.push(`findings[${i}].severity="${f?.severity}" not in the enum`);
      const loc = String(f?.location || "");
      if (!/^[^\s:]+:\d+/.test(loc)) errors.push(`findings[${i}].location="${loc}" is not file:line`);
      else if (diffPaths?.length && !diffPaths.some((p) => loc.startsWith(p))) {
        errors.push(`findings[${i}].location="${loc}" references a path not in the diff`);
      }
      if (!String(f?.detail || "").trim()) errors.push(`findings[${i}].detail is empty`);
    });
  }
  return { ok: errors.length === 0, errors, parsed };
}

const blocks = (parsed) => Array.isArray(parsed?.findings) &&
  parsed.findings.some((f) => f?.severity === "MUST FIX");

// Layer 2 asks "did it block?", not "was the envelope clean?" — fence compliance
// is layer 1's job, measured against real recorded lens output. Our harness feeds
// the persona through stdin rather than the action's tool-driven setup, so a
// wrapping fence here is a framing artifact, not the production failure mode.
const unfence = (raw) => String(raw || "").trim()
  .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

const pathsIn = (patch) => [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);

// ── Layer 1 self-checks: recorded production failures ───────────────────────
function layer1() {
  const cases = [
    { name: "contract/lens-name-mismatch", lensName: "Sentinel",
      raw: JSON.stringify({ lens: "Security Auditor", summary: "s", findings: [] }),
      expectOk: false, expect: /does not match job/,
      why: "Sentinel emitted lens='Security Auditor' and hard-failed the job in production" },
    { name: "contract/unparseable-output", lensName: "Edge Case Hunter",
      raw: "Here are my findings:\n- something looks off",
      expectOk: false, expect: /no parseable JSON/,
      why: "Edge Case Hunter emitted prose; the action reported 'no parseable JSON object'" },
    { name: "contract/fenced-json", lensName: "Viper",
      raw: "```json\n{\"lens\":\"Viper\",\"summary\":\"s\",\"findings\":[]}\n```",
      expectOk: false, expect: /markdown fence/, why: "fences break the parser" },
    { name: "contract/null-findings", lensName: "Blind Hunter",
      raw: JSON.stringify({ lens: "Blind Hunter", summary: "s", findings: null }),
      expectOk: false, expect: /findings missing or not an array/, why: "null instead of []" },
    { name: "contract/bad-severity", lensName: "Acceptance Auditor",
      raw: JSON.stringify({ lens: "Acceptance Auditor", summary: "s",
        findings: [{ severity: "FAIL", location: "a.ts:1", detail: "d" }] }),
      expectOk: false, expect: /not in the enum/,
      why: "verdict words belong in detail, not severity" },
    { name: "contract/valid", lensName: "Acceptance Auditor",
      raw: JSON.stringify({ lens: "Acceptance Auditor", summary: "s",
        findings: [{ severity: "NITPICK", location: "a.ts:1", detail: "d" }] }),
      expectOk: true, why: "a well-formed envelope must pass" },
  ];
  let failed = 0;
  for (const c of cases) {
    const r = validateEnvelope(c.raw, { lensName: c.lensName, diffPaths: ["a.ts"] });
    const ok = r.ok === c.expectOk && (c.expectOk || c.expect.test(r.errors.join("; ")));
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!ok) { failed++; console.log(`        expected ${c.expectOk ? "ok" : c.expect} — got: ${r.errors.join("; ") || "ok"}`); }
  }
  return failed;
}

// ── Layer 2: run a lens against a fixture ───────────────────────────────────
function runLens(lens, fx) {
  const shared = fs.readFileSync(path.join(ROOT, "lenses", "shared-instructions.md"), "utf8");
  const persona = fs.readFileSync(path.join(ROOT, "lenses", `${lens}.md`), "utf8");
  const prompt = [
    persona.replace(/__PR_NUMBER__/g, "1"), "\n---\n", shared,
    "\n---\n",
    "The tools are unavailable in this run. Treat the following as the exact and",
    "COMPLETE output of get_issue_or_pr_thread and get_pr_diff — the diff below is",
    "the whole diff, not an excerpt.\n",
    "### PR thread\n```json\n" + JSON.stringify(fx.pr, null, 2) + "\n```\n",
    "### Diff\n```diff\n" + fx.diff + "\n```\n",
    "Emit your JSON object now as your entire final message.",
  ].join("\n");
  const res = spawnSync(PI_BIN, ["--provider", "openrouter", "--model", MODEL, "--thinking", "medium"],
    { input: prompt, encoding: "utf8", timeout: 300000 });
  return String(res.stdout || "").trim();
}

function layer2() {
  // pi may hold the provider credential in its own store, so probe the CLI
  // rather than requiring the env var.
  const probe = spawnSync(PI_BIN, ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) { console.log(`  SKIP  layer 2 — ${PI_BIN} not runnable (this is not a failure)`); return 0; }
  fs.mkdirSync(OUT, { recursive: true });
  const names = fs.readdirSync(FIXTURES).filter((n) => !ONLY || n === ONLY);
  let failed = 0;
  for (const name of names) {
    const dir = path.join(FIXTURES, name);
    const fx = {
      pr: JSON.parse(fs.readFileSync(path.join(dir, "pr.json"), "utf8")),
      diff: fs.readFileSync(path.join(dir, "diff.patch"), "utf8"),
      expect: JSON.parse(fs.readFileSync(path.join(dir, "expect.json"), "utf8")),
    };
    const diffPaths = pathsIn(fx.diff);
    let agree = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const raw = runLens(fx.expect.lens, fx);
      fs.writeFileSync(path.join(OUT, `${name}.${i}.txt`), raw);
      if (!raw.trim()) { console.log(`        run ${i}: EMPTY output from ${PI_BIN} — counted as disagreement`); continue; }
      const v = validateEnvelope(unfence(raw), { lensName: "Acceptance Auditor", diffPaths });
      if (!v.ok) { console.log(`        run ${i}: unparseable — ${v.errors.join("; ")}`); continue; }
      if (blocks(v.parsed) === fx.expect.must_block) agree++;
    }
    const rate = agree / SAMPLES;
    const ok = rate >= THRESHOLD;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  ${agree}/${SAMPLES} agreed (must_block=${fx.expect.must_block})`);
    if (!ok) console.log(`        ${fx.expect.why}`);
  }
  return failed;
}

let failed = 0;
if (LAYER === "1" || LAYER === "all") { console.log("Layer 1 — envelope contract (offline)"); failed += layer1(); }
if (LAYER === "2" || LAYER === "all") { console.log("Layer 2 — lens judgment (sampled)"); failed += layer2(); }
console.log(failed === 0 ? "\nall evals passed" : `\n${failed} eval(s) failed`);
process.exit(failed === 0 ? 0 : 1);
