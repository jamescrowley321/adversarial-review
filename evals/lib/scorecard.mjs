// Scorecard: per-lens metrics, markdown report, JSON baseline, exit policy.
//
// Metrics are computed from the GATE VERDICT, never from finding prose. The
// verdict is what actually stops a merge; detail text is model-nondeterministic
// and is only ever printed for diagnosis.

export const THRESHOLDS = {
  mustBlockRecall: 0.8,   // fraction of must-block fixtures that block unanimously
  jsonValidity: 0.95,     // fraction of reps whose output the action could parse
  falsePositiveRate: 0,   // must-not-block fixtures that blocked in ANY rep
};

/** Fold reps for one (fixture, lens) into a single result. */
export function foldReps(run, reps) {
  const parsed = reps.filter((r) => r.parsed);
  const truncated = reps.filter((r) => r.truncated).length;
  const providerErrors = reps.filter((r) => r.error).length;
  const verdicts = parsed.map((r) => r.blocked);
  const unanimous = verdicts.length > 0 && verdicts.every((v) => v === verdicts[0]);
  const everBlocked = verdicts.some((v) => v === true);
  const alwaysBlocked = verdicts.length > 0 && verdicts.every((v) => v === true);

  const wantBlock = run.expect.block === true;
  // `location_matches` comes from a fixture file committed to this repo and
  // reviewed on the PR that adds it — not user or network input — and this is a
  // dev-only harness that never runs inside a consumer's action. The pattern
  // has to stay a real regex: fixtures anchor on shapes like `docs/a\.md:\d+`.
  //
  // Bare `nosemgrep`, not the rule-id form. The id-qualified version was here
  // first and did NOT suppress — code-scanning alert 24 stayed open across
  // several analyses of a tree that contained it, because `semgrep scan
  // --config=auto` reports the registry id while matching the comment against
  // the local check id. Do not "tidy" this back to the qualified form without
  // watching the alert close.
  // nosemgrep
  const locRe = run.expect.location_matches ? new RegExp(run.expect.location_matches) : null;
  const locationOk = !locRe || parsed.some((r) => (r.findings || []).some((f) => locRe.test(String(f.location))));

  let pass, reason;
  if (parsed.length !== reps.length) {
    pass = false;
    reason = truncated
      ? `${truncated}/${reps.length} rep(s) hit the max-tokens ceiling — a HARNESS limit, not a lens failure. Re-run with --max-tokens higher before reading anything into this row.`
      : providerErrors
        ? `${providerErrors}/${reps.length} rep(s) failed UPSTREAM at the provider after retries — infrastructure, not a lens result. Re-run.`
        : `${reps.length - parsed.length}/${reps.length} rep(s) produced output the action could not accept`;
  } else if (!unanimous) {
    pass = false;
    reason = `unstable verdict across reps (${verdicts.map((v) => (v ? "BLOCK" : "pass")).join(", ")}) — not a pass`;
  } else if (wantBlock && !alwaysBlocked) {
    pass = false;
    reason = "expected the gate to BLOCK; it did not";
  } else if (!wantBlock && everBlocked) {
    pass = false;
    reason = "expected the gate NOT to block; a MUST FIX blocked it";
  } else if (wantBlock && !locationOk) {
    pass = false;
    reason = `blocked, but no finding location matched /${run.expect.location_matches}/`;
  } else if (run.expect.max_findings != null && parsed.some((r) => (r.findings || []).length > run.expect.max_findings)) {
    // Activation gates: a lens whose gate fires must emit [] and stop. "Did not
    // block" is not enough — a skipping lens that still files NITPICKs is not
    // skipping, and the noise is the thing the gate exists to prevent.
    const worst = Math.max(...parsed.map((r) => (r.findings || []).length));
    pass = false;
    reason = `expected at most ${run.expect.max_findings} finding(s) (activation gate should have fired); saw ${worst}`;
  } else {
    pass = true;
    reason = wantBlock ? "blocked as expected" : "did not block, as expected";
  }

  return {
    id: run.id, lens: run.lensKey, class: run.fx.class, guards: run.fx.guards,
    expectBlock: wantBlock, verdicts, unanimous, everBlocked, alwaysBlocked,
    locationOk, jsonValid: parsed.length, reps: reps.length, truncated, providerErrors, pass, reason,
    severities: tally(parsed.flatMap((r) => (r.findings || []).map((f) => f.severity))),
    reps_detail: reps,
  };
}

const tally = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});

export function score(results) {
  const byLens = {};
  for (const r of results) {
    const l = (byLens[r.lens] ||= { lens: r.lens, mustBlock: [], mustNotBlock: [], jsonValid: 0, repsTotal: 0, unstable: 0, truncated: 0, providerErrors: 0 });
    (r.class === "must-block" ? l.mustBlock : l.mustNotBlock).push(r);
    l.jsonValid += r.jsonValid;
    l.repsTotal += r.reps;
    l.truncated += r.truncated || 0;
    l.providerErrors += r.providerErrors || 0;
    if (!r.unanimous) l.unstable++;
  }
  for (const l of Object.values(byLens)) {
    l.recall = l.mustBlock.length ? l.mustBlock.filter((r) => r.pass).length / l.mustBlock.length : null;
    l.falsePositives = l.mustNotBlock.filter((r) => r.everBlocked).length;
    l.falsePositiveRate = l.mustNotBlock.length ? l.falsePositives / l.mustNotBlock.length : null;
    const delivered = l.repsTotal - l.providerErrors;
    l.jsonValidityRate = delivered > 0 ? l.jsonValid / delivered : null;
    l.stability = results.length ? 1 - l.unstable / (l.mustBlock.length + l.mustNotBlock.length) : null;
  }
  return byLens;
}

/** Exit policy. Returns the list of violations; empty means pass. */
export function violations(byLens, thresholds = THRESHOLDS) {
  const out = [];
  for (const l of Object.values(byLens)) {
    for (const r of l.mustNotBlock) {
      if (r.everBlocked) out.push(`${l.lens}/${r.id}: FALSE POSITIVE — a must-not-block fixture blocked the merge`);
    }
    if (l.recall != null && l.recall < thresholds.mustBlockRecall) {
      out.push(`${l.lens}: must-block recall ${pct(l.recall)} < ${pct(thresholds.mustBlockRecall)}`);
    }
    if (l.providerErrors) {
      out.push(`${l.lens}: ${l.providerErrors} rep(s) failed upstream at the provider after retries — infrastructure, not lens quality; re-run`);
    } else if (l.truncated) {
      out.push(`${l.lens}: ${l.truncated} rep(s) truncated at the max-tokens ceiling — harness limit; raise --max-tokens and re-run, do not read this as lens quality`);
    } else if (l.jsonValidityRate != null && l.jsonValidityRate < thresholds.jsonValidity) {
      out.push(`${l.lens}: JSON validity ${pct(l.jsonValidityRate)} < ${pct(thresholds.jsonValidity)}`);
    }
  }
  return out;
}

const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const n = (x) => (x == null ? "n/a" : String(x));

export function renderScorecard({ byLens, results, meta, violations: vs }) {
  const L = [];
  L.push("# Lens eval scorecard", "");
  L.push(`- **Model:** \`${meta.model}\`${meta.resolvedModel && meta.resolvedModel !== meta.model ? ` (resolved: \`${meta.resolvedModel}\`)` : ""}`);
  L.push(`- **Reps per fixture:** ${meta.reps} (a verdict must be unanimous to count as a pass)`);
  L.push(`- **Max tokens:** ${meta.maxTokens ?? "default"}`);
  L.push(`- **Fixtures:** ${meta.fixtureCount} · **runs:** ${results.length} · **model calls:** ${results.length * meta.reps}`);
  L.push(`- **Action ref:** \`${meta.ref || "working tree"}\``);
  L.push(`- **Result:** ${vs.length ? `❌ ${vs.length} violation(s)` : "✅ within thresholds"}`);
  L.push("");
  L.push("| Lens | must-block recall | must-not-block FP rate | JSON validity | verdict stability | provider errors |");
  L.push("|---|---|---|---|---|---|");
  for (const l of Object.values(byLens).sort((a, b) => a.lens.localeCompare(b.lens))) {
    L.push(`| \`${l.lens}\` | ${pct(l.recall)} (${l.mustBlock.filter((r) => r.pass).length}/${l.mustBlock.length}) | ${pct(l.falsePositiveRate)} (${l.falsePositives}/${l.mustNotBlock.length}) | ${pct(l.jsonValidityRate)} | ${pct(l.stability)} | ${l.providerErrors}/${l.repsTotal} |`);
  }
  L.push("");

  if (vs.length) {
    L.push("## Violations", "");
    for (const v of vs) L.push(`- ${v}`);
    L.push("");
  }

  L.push("## Per-fixture", "");
  L.push("| Fixture | Lens | Class | Expected | Verdicts | Result |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) {
    L.push(`| \`${r.id}\` | \`${r.lens}\` | ${r.class} | ${r.expectBlock ? "BLOCK" : "no block"} | ${r.verdicts.map((v) => (v ? "BLOCK" : "pass")).join(" ") || "—"} | ${r.pass ? "✅" : "❌"} |`);
  }
  L.push("");

  const failures = results.filter((r) => !r.pass);
  if (failures.length) {
    L.push("## Failure detail", "");
    L.push("_Finding text is printed for diagnosis only — it is never asserted on._", "");
    for (const r of failures) {
      L.push(`### \`${r.id}\` · \`${r.lens}\``, "");
      if (r.guards) L.push(`> Guards: ${r.guards}`, "");
      L.push(`- ${r.reason}`);
      L.push(`- Severities across reps: ${JSON.stringify(r.severities)}`);
      for (const [i, rep] of r.reps_detail.entries()) {
        if (rep.error) { L.push(`- rep ${i}: ERROR — ${rep.error}`); continue; }
        if (!rep.parsed) { L.push(`- rep ${i}: unparseable (finish_reason=${rep.finishReason ?? "?"}${rep.truncated ? ", TRUNCATED by the harness" : ""}) — ${rep.parseError}`); continue; }
        for (const f of rep.findings || []) {
          if (f.severity !== "MUST FIX" && !r.expectBlock) continue;
          L.push(`- rep ${i}: [${f.severity}] \`${f.location}\` — ${String(f.detail).replace(/\s+/g, " ").slice(0, 400)}`);
        }
      }
      L.push("");
    }
  }
  return L.join("\n");
}

export function buildBaseline({ byLens, results, meta }) {
  return {
    meta,
    lenses: Object.fromEntries(Object.entries(byLens).map(([k, l]) => [k, {
      recall: l.recall, falsePositiveRate: l.falsePositiveRate,
      jsonValidityRate: l.jsonValidityRate, stability: l.stability,
    }])),
    fixtures: results.map((r) => ({
      id: r.id, lens: r.lens, class: r.class, expectBlock: r.expectBlock,
      verdicts: r.verdicts, pass: r.pass, reason: r.reason, severities: r.severities,
    })),
  };
}
