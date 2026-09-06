#!/usr/bin/env node
// Deterministic fixture validator — no network, no model. Runs on every PR.
//
// Keeps the labeled dataset honest: every fixture is complete and well formed,
// every diff is a real unified diff whose hunk headers match its body, every
// expectation names a lens the action ships, and every must-block fixture's
// `location_matches` can actually be satisfied by a file in its own diff. A
// fixture that can never pass is worse than no fixture — it trains people to
// ignore the scorecard.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listFixtureIds, loadFixture, FIXTURES_DIR } from "./lib/fixtures.mjs";
import { LENS_KEYS } from "./lib/lenses.mjs";

const errors = [];
const fail = (id, msg) => errors.push(`[${id}] ${msg}`);
const CLASSES = new Set(["must-block", "must-not-block"]);

/** Verify every `@@ -a,b +c,d @@` header matches the actual body line counts. */
function hunkCountErrors(diff) {
  const out = [];
  const lines = diff.replace(/\n$/, "").split("\n");
  let hdr = null, exp = null, oldN = 0, newN = 0, inHunk = false;
  const flush = () => {
    if (hdr && (oldN !== exp.b || newN !== exp.d)) {
      out.push(`hunk '${hdr}' body counts old=${oldN} new=${newN} but the header declares -,${exp.b} +,${exp.d}`);
    }
  };
  for (const ln of lines) {
    const m = ln.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (m) { flush(); hdr = ln.slice(0, 40); exp = { b: m[1] == null ? 1 : Number(m[1]), d: m[2] == null ? 1 : Number(m[2]) }; oldN = 0; newN = 0; inHunk = true; continue; }
    if (ln.startsWith("diff --git")) { flush(); inHunk = false; hdr = null; continue; }
    if (!inHunk) continue;
    if (ln.startsWith("+++") || ln.startsWith("---") || ln.startsWith("\\")) continue;
    if (ln.startsWith("+")) newN++;
    else if (ln.startsWith("-")) oldN++;
    else { oldN++; newN++; }
  }
  flush();
  return out;
}

/** file -> Set of new-file line numbers present in the diff (added + context). */
function newLinesByFile(diff) {
  const map = new Map();
  let file = null, line = 0;
  for (const l of diff.split("\n")) {
    const pf = l.match(/^\+\+\+ b\/(.+)$/);
    if (pf) { file = pf[1] === "dev/null" ? null : pf[1]; if (file && !map.has(file)) map.set(file, new Set()); continue; }
    const hh = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hh) { line = Number(hh[1]); continue; }
    if (!file) continue;
    if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("\\")) continue;
    if (l.startsWith("+")) { map.get(file).add(line); line++; }
    else if (l.startsWith("-")) { /* removed lines do not advance the new-file counter */ }
    else if (l.startsWith("diff --git") || l.startsWith("index ") || /^(new|deleted) file mode/.test(l) || /^(similarity|rename) /.test(l)) { /* metadata */ }
    else { map.get(file).add(line); line++; }
  }
  return map;
}

const ids = listFixtureIds();
if (!ids.length) fail("suite", "no fixtures found");

for (const id of ids) {
  for (const f of ["diff.patch", "pr-body.md", "expected.json"]) {
    if (!existsSync(join(FIXTURES_DIR, id, f))) fail(id, `missing ${f}`);
  }
  let fx;
  try { fx = loadFixture(id); } catch (e) { fail(id, `could not load: ${e.message}`); continue; }

  if (!CLASSES.has(fx.class)) fail(id, `class must be one of ${[...CLASSES].join(" | ")} (got ${JSON.stringify(fx.class)})`);
  if (typeof fx.smoke !== "boolean") fail(id, "expected.json needs a boolean `smoke`");
  if (!fx.pr_title) fail(id, "expected.json needs a `pr_title` (the harness feeds it as the PR title)");
  if (!fx.guards) fail(id, "expected.json needs `guards` — name the incident or failure shape this fixture exists to catch");
  if (!fx.prBody.trim()) fail(id, "pr-body.md is empty");
  if (!/^diff --git /m.test(fx.diff)) fail(id, "diff.patch is not a unified diff");

  // The stored file must carry NO literal "diff --git " — see decodeFixtureDiff.
  // The review agent's diff filter splits the PR diff on that substring without
  // anchoring to a line start, so a fixture containing it verbatim leaks its
  // internal paths into the reviewed diff as phantom files that no ignore
  // pattern can exclude, and the lenses block on the planted defects.
  const stored = readFileSync(join(FIXTURES_DIR, id, "diff.patch"), "utf8");
  if (stored.includes("diff --git ")) {
    fail(id, 'diff.patch contains a literal "diff --git " — store it as "DIFFGIT " instead, or the lenses will review this fixture\'s planted defects as real code (see decodeFixtureDiff in evals/lib/fixtures.mjs)');
  }
  if (!/^DIFFGIT /m.test(stored)) fail(id, 'diff.patch has no "DIFFGIT " header — it is not in the stored encoding');
  for (const e of hunkCountErrors(fx.diff)) fail(id, e);

  const lines = newLinesByFile(fx.diff);
  if (![...lines.values()].some((s) => s.size)) {
    fail(id, "diff has no anchorable new-file lines — the action's post step cannot place an inline comment and fails the lens");
  }

  const entries = Object.entries(fx.lenses || {});
  if (!entries.length) fail(id, "expected.json has no `lenses` expectations");
  for (const [lensKey, expect] of entries) {
    if (!LENS_KEYS.includes(lensKey)) fail(id, `unknown lens '${lensKey}' (action.yml ships: ${LENS_KEYS.join(", ")})`);
    if (typeof expect.block !== "boolean") fail(id, `${lensKey}: \`block\` must be a boolean`);
    if (fx.class === "must-block" && expect.block !== true) fail(id, `${lensKey}: class is must-block but block is not true`);
    if (fx.class === "must-not-block" && expect.block !== false) fail(id, `${lensKey}: class is must-not-block but block is not false`);
    if (expect.block === true && !expect.location_matches && !expect.location_not_asserted) {
      fail(id, `${lensKey}: a must-block expectation needs \`location_matches\` — blocking for the wrong reason is not a pass. If the finding cannot be anchored to a diff path (e.g. it is about the PR body), set \`location_not_asserted\` to the reason instead.`);
    }
    if (expect.max_findings != null && (!Number.isInteger(expect.max_findings) || expect.max_findings < 0)) {
      fail(id, `${lensKey}: max_findings must be a non-negative integer`);
    }
    if (expect.max_findings === 0 && expect.block !== false) {
      fail(id, `${lensKey}: max_findings 0 means the activation gate fired, which cannot also block`);
    }
    if (expect.location_matches) {
      let re;
      try { re = new RegExp(expect.location_matches); } catch (e) { fail(id, `${lensKey}: location_matches is not a valid regex: ${e.message}`); continue; }
      // The regex must be satisfiable by some real file:line in this diff.
      const satisfiable = [...lines.entries()].some(([file, set]) => [...set].some((n) => re.test(`${file}:${n}`)));
      if (!satisfiable) {
        fail(id, `${lensKey}: no file:line in this diff can match /${expect.location_matches}/ — the fixture can never pass. Files in diff: ${[...lines.keys()].join(", ")}`);
      }
    }
  }
}

// Every fixture in the smoke set must be cheap enough to justify running on
// every lens-touching PR, and the smoke set must keep both classes represented —
// a smoke set of only must-not-block fixtures rewards a lens that never blocks.
const smoke = ids.map(loadFixture).filter((f) => f.smoke);
if (!smoke.some((f) => f.class === "must-block")) fail("suite", "the smoke set has no must-block fixture — it would pass for a lens that never blocks anything");
if (!smoke.some((f) => f.class === "must-not-block")) fail("suite", "the smoke set has no must-not-block fixture");

if (errors.length) {
  console.error(`Fixture validation FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const runs = ids.map(loadFixture).reduce((n, f) => n + Object.keys(f.lenses).length, 0);
console.log(
  `Fixture validation OK: ${ids.length} fixtures (${smoke.length} smoke), ${runs} fixture×lens runs, ` +
  `all diffs well formed, all expectations satisfiable.`,
);
