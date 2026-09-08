#!/usr/bin/env node
// blind-peer-review — vendor the lens library into a consuming repo.
//
// Codex reads AGENTS.md in the repo it is working in; it cannot reach into an
// action. So a repo driving the lenses through Codex (or any harness without a
// plugin) needs the personas on disk. This copies them, stamps the version, and
// prints the AGENTS.md block to paste.
//
// Usage:
//   node scripts/vendor.mjs --into ../some-repo
//   node scripts/vendor.mjs --into ../some-repo --print-agents-block
//
// Vendored copies land in <target>/.blind-peer-review/vendor/. That is
// deliberately NOT .blind-peer-review/lenses/, which is the override directory:
// a file there REPLACES the base persona of the same key. Keeping the base copy
// somewhere else means "what upstream ships" and "what this repo changed" stay
// two separate, diffable things.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = readFileSync(join(ROOT, "version.txt"), "utf8").trim();

let target = null;
let printBlock = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--into") {
    target = argv[++i];
    if (!target) { console.error("error: --into requires a path"); process.exit(1); }
  } else if (a === "--print-agents-block") printBlock = true;
  else if (a === "-h" || a === "--help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n")
      .filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  } else { console.error(`Unknown arg: ${a}`); process.exit(2); }
}
if (!target) { console.error("error: --into <repo> is required"); process.exit(1); }

const dest = resolve(target, ".blind-peer-review", "vendor");
const lensDir = join(dest, "lenses");
mkdirSync(lensDir, { recursive: true });

const manifest = JSON.parse(readFileSync(join(ROOT, "lenses", "manifest.json"), "utf8"));
const copied = [];
for (const f of readdirSync(join(ROOT, "lenses"))) {
  // shared_instructions.md is the CI-side contract — it names get_pr_diff and
  // submit_findings, neither of which exists locally. Shipping it to a local
  // harness is how "ignore that CI wording" gets back into the prompts.
  if (!f.endsWith(".md") || f === "README.md" || f === "shared_instructions.md") continue;
  writeFileSync(join(lensDir, f), readFileSync(join(ROOT, "lenses", f)));
  copied.push(f);
}
writeFileSync(join(lensDir, "manifest.json"), readFileSync(join(ROOT, "lenses", "manifest.json")));
writeFileSync(join(dest, "shared_review_contract.md"), readFileSync(join(ROOT, "contracts", "shared_review_contract.md")));

writeFileSync(join(dest, "SOURCE.md"), `# Vendored lens library

Copied verbatim from **jamescrowley321/blind-peer-review** at **v${VERSION}**
(Apache-2.0, © James Crowley) by \`scripts/vendor.mjs\`.

Do not hand-edit these files — re-run the vendor command to re-sync. To change a
lens for THIS repo, commit \`.blind-peer-review/lenses/<key>.md\`: that file
replaces the base persona of the same key, and lives outside this directory so
upstream's copy and your change stay separately diffable.

Lenses: ${manifest.lenses.map((l) => l.key).join(", ")}
`);

console.log(`Vendored ${copied.length} personas + the review contract into ${dest} (v${VERSION})`);
if (printBlock) {
  const block = readFileSync(join(ROOT, "adapters", "codex", "AGENTS.md"), "utf8")
    .replace(/^<!--[\s\S]*?-->\n\n/, "");
  console.log("\n──── paste into the repo's AGENTS.md ────\n");
  console.log(block);
}
