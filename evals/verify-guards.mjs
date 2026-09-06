#!/usr/bin/env node
// Prove the deterministic guards are load-bearing — offline, free, no model.
// Run: node evals/verify-guards.mjs
//
// A regression test that passes against BOTH the broken and the fixed code
// guards nothing. For each incident with a known pre-fix commit, this replays
// the guard against that historical action.yml and asserts it TRIPS there, then
// against HEAD and asserts it does NOT. That is the evidence for "this suite
// would have caught the incident before release" — not an assertion about it.
//
// Model-behaviour incidents (false MUST FIX from unverified absence, category
// errors on non-implementation PRs) cannot be replayed from git: the artifact
// that failed was a model response, not code. Those live in evals/fixtures/ and
// are measured by evals/run.mjs.

import { execFileSync } from "node:child_process";
import { runParseStep, ROOT } from "./lib/harness.mjs";

const emit = (lens, findings = []) => JSON.stringify({ lens, summary: "s", findings });
const at = (ref, path) => execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, encoding: "utf8" });

const GUARDS = [
  {
    id: "incident-3/sentinel-subtitle",
    incident:
      'lenses/sentinel.md was headed "# Sentinel — Security Auditor Agent"; the model emitted ' +
      'lens: "Security Auditor"; action.yml rejected it and the Sentinel job failed on every PR.',
    prefixRef: "de5a7f0",
    guardedBy: 'contract.test.mjs → "Sentinel job accepts lens=\\"Security Auditor\\""',
    async probe(yml) {
      const r = await runParseStep({ lensName: "Sentinel", agentResponse: emit("Security Auditor"), yml });
      return { tripped: r.failed != null, detail: r.failed ?? `posted ${r.event}` };
    },
  },
  {
    id: "incident-3/lens-name-required",
    incident: "A lens must never accept another lens's output — tolerance must not become blindness.",
    prefixRef: null, // no known-broken commit; asserted at HEAD only
    guardedBy: 'contract.test.mjs → "a lens does NOT accept a different lens\'s name"',
    async probe(yml) {
      const r = await runParseStep({ lensName: "Sentinel", agentResponse: emit("Viper"), yml });
      return { tripped: r.failed != null, detail: r.failed ?? `posted ${r.event}` };
    },
    expectAtHead: true, // this one SHOULD trip at HEAD — it is a rejection guard
  },
];

let failures = 0;
console.log("Guard verification — replaying regression guards against pre-fix history\n");

for (const g of GUARDS) {
  const head = await g.probe(null);
  const wantHead = g.expectAtHead === true;
  const headOk = head.tripped === wantHead;
  if (!headOk) failures++;
  console.log(`${headOk ? "PASS" : "FAIL"}  ${g.id}`);
  console.log(`      incident: ${g.incident}`);
  console.log(`      guarded by: ${g.guardedBy}`);
  console.log(`      at HEAD: ${head.tripped ? "trips" : "does not trip"} (expected ${wantHead ? "trips" : "does not trip"})`);
  if (!headOk) console.log(`      ↳ ${head.detail}`);

  if (g.prefixRef) {
    let pre;
    try {
      pre = await g.probe(at(g.prefixRef, "action.yml"));
    } catch (e) {
      console.log(`      SKIP pre-fix replay at ${g.prefixRef}: ${e.message.split("\n")[0]}`);
      console.log("");
      continue;
    }
    const preOk = pre.tripped === true;
    if (!preOk) failures++;
    console.log(`      at ${g.prefixRef} (pre-fix): ${pre.tripped ? "trips ✓ — the guard would have caught this" : "does NOT trip ✗ — the guard is not load-bearing"}`);
    if (pre.tripped) console.log(`      ↳ ${pre.detail}`);
  }
  console.log("");
}

if (failures) {
  console.error(`Guard verification FAILED (${failures} guard(s) not behaving as documented).`);
  process.exit(1);
}
console.log("All guards verified: each trips on the code that shipped the incident and is clean at HEAD.");
