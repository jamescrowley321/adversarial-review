// check-example.mjs — CI check: the models_config block shipped in
// examples/caller-workflow.yml must validate against the same strict allowlist
// the action enforces, so the documented example can never drift out of schema.
// Run: node scripts/check-example.mjs

import { readFileSync } from "node:fs";
import { validateModelsConfig } from "./models-config.mjs";

const example = readFileSync("examples/caller-workflow.yml", "utf8");
if (!example.trim()) {
  console.log("::error::examples/caller-workflow.yml is empty");
  process.exit(1);
}

// Extract the `models_config: |` block and dedent it to recover the JSON.
const m = example.match(/models_config:\s*\|\s*\n((?:[ \t]+.*\n)+)/);
if (!m) {
  console.log("::error::examples/caller-workflow.yml has no models_config block to validate");
  process.exit(1);
}
const lines = m[1].replace(/\n$/, "").split("\n");
const indent = lines[0].match(/^[\t ]*/)[0].length;
const json = lines.map((l) => l.slice(indent)).join("\n");

try {
  validateModelsConfig(json);
} catch (e) {
  console.log(`::error::example models_config block fails the allowlist: ${e.message}`);
  process.exit(1);
}
console.log("Example models_config block validates against the allowlist.");
