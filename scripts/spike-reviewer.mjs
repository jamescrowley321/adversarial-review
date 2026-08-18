// Spike: single-call lens reviewer (no pi agent).
//
// Thesis: the reason we can't use cheap models is that `pi` never constrains the
// model's output — GLM-5.2 emitted prose ~6/8. If we drop the agent and make ONE
// OpenRouter chat completion with `response_format: json_schema`, the API forces
// valid findings JSON regardless of the model's instruction-following. This spike
// measures that: for each model, run the real Blind Hunter persona against a fixed
// diff N times and report how often we get schema-valid JSON, plus latency + cost.
//
// Run:  OPENROUTER_API_KEY=sk-... node scripts/spike-reviewer.mjs
// Env:  MODELS="anthropic/claude-sonnet-5,google/gemini-3.7-flash,z-ai/glm-5.2"
//       RUNS=3
//
// This is a THROWAWAY spike to inform the drop-pi decision — not shipped code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("OPENROUTER_API_KEY is required.");
  process.exit(1);
}

const MODELS = (process.env.MODELS ||
  "anthropic/claude-sonnet-5,google/gemini-3.7-flash,z-ai/glm-5.2")
  .split(",").map((s) => s.trim()).filter(Boolean);
const RUNS = Number(process.env.RUNS || "3");

// $/1M tokens (in, out) — verified from OpenRouter 2026-08-17; for cost estimates only.
const PRICE = {
  "anthropic/claude-sonnet-5": [2.0, 10.0],
  "google/gemini-3.7-flash": [0.38, 1.88],
  "z-ai/glm-5.2": [0.5, 3.15],
  "deepseek/deepseek-v4-pro": [1.32, 3.96],
};

// The exact findings contract the action already parses/validates/posts.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lens", "summary", "findings"],
  properties: {
    lens: { type: "string" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "location", "detail", "recommendation"],
        properties: {
          severity: { type: "string", enum: ["MUST FIX", "SHOULD FIX", "NITPICK"] },
          location: { type: "string" },
          detail: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
  },
};

// A fixed, self-contained diff with a couple of planted defects so the lens has
// something real to find (off-by-one + unhandled empty input).
const FIXTURE_DIFF = `diff --git a/src/median.js b/src/median.js
new file mode 100644
--- /dev/null
+++ b/src/median.js
@@ -0,0 +1,9 @@
+function median(nums) {
+  const sorted = [...nums].sort((a, b) => a - b);
+  const mid = Math.floor(sorted.length / 2);
+  // returns the wrong element for even-length inputs, and throws on []
+  if (sorted.length % 2 === 0) {
+    return (sorted[mid] + sorted[mid + 1]) / 2;
+  }
+  return sorted[mid];
+}
`;

const shared = fs.readFileSync(path.join(ROOT, "lenses", "shared-instructions.md"), "utf8");
const persona = fs
  .readFileSync(path.join(ROOT, "lenses", "blind.md"), "utf8")
  .split("__PR_NUMBER__").join("999");

const system = `${persona}\n\n${shared}`;
const user =
  `You are reviewing PR #999. The full diff is provided inline below (there are ` +
  `no tools to call in this run — review exactly what is here):\n\n${FIXTURE_DIFF}`;

function validate(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return "not JSON"; }
  if (typeof obj !== "object" || !obj) return "not an object";
  if (typeof obj.lens !== "string") return "missing lens";
  if (typeof obj.summary !== "string") return "missing summary";
  if (!Array.isArray(obj.findings)) return "findings not array";
  for (const f of obj.findings) {
    if (!["MUST FIX", "SHOULD FIX", "NITPICK"].includes(f?.severity)) return "bad severity";
    for (const k of ["location", "detail", "recommendation"]) {
      if (typeof f?.[k] !== "string" || !f[k].trim()) return `finding missing ${k}`;
    }
  }
  return null; // valid
}

async function callOnce(model) {
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "X-Title": "adversarial-review-spike",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "lens_findings", strict: true, schema: SCHEMA },
      },
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text();
    return { ms, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage ?? {};
  return { ms, content, usage, invalid: validate(content) };
}

console.log(`Single-call reviewer spike — Blind Hunter, ${RUNS} run(s)/model\n`);
for (const model of MODELS) {
  let valid = 0, totalMs = 0, cost = 0, findingsSeen = 0;
  const notes = [];
  for (let i = 0; i < RUNS; i++) {
    let r;
    try { r = await callOnce(model); } catch (e) { notes.push(`run ${i}: ${e.message}`); continue; }
    totalMs += r.ms;
    if (r.error) { notes.push(`run ${i}: ${r.error}`); continue; }
    const [pin, pout] = PRICE[model] || [0, 0];
    cost += ((r.usage.prompt_tokens || 0) / 1e6) * pin + ((r.usage.completion_tokens || 0) / 1e6) * pout;
    if (r.invalid) { notes.push(`run ${i}: INVALID (${r.invalid})`); continue; }
    valid++;
    try { findingsSeen += JSON.parse(r.content).findings.length; } catch {}
  }
  const avgMs = RUNS ? Math.round(totalMs / RUNS) : 0;
  console.log(
    `${model}\n  valid JSON: ${valid}/${RUNS}   avg latency: ${avgMs}ms   ` +
    `est cost/run: $${(cost / RUNS).toFixed(5)}   avg findings: ${(findingsSeen / (valid || 1)).toFixed(1)}`,
  );
  if (notes.length) console.log(`  notes: ${notes.join("; ")}`);
  console.log("");
}
