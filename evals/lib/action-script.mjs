// Extract and execute action.yml's OWN inline scripts.
//
// The action's parse/validate, review-rendering and gate logic live as inline
// `script:` / `run:` block scalars inside action.yml. Reimplementing them here
// would produce an eval that passes while the shipped action is broken — the
// exact failure mode this harness exists to prevent. So we lift the real block
// scalar out of the YAML and run it against stubs. A change to action.yml is
// therefore exercised by these evals with no refactor of the action itself.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const require_ = createRequire(import.meta.url);

/**
 * Pull the block scalar that follows `key: |` inside the step named `stepName`.
 * `key` is "script" (github-script steps) or "run" (shell: node {0} steps).
 */
export function extractStepScript(actionYml, stepName, key = "script") {
  const lines = actionYml.split("\n");
  const stepIdx = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (stepIdx === -1) {
    throw new Error(
      `action.yml has no step named "${stepName}". The eval harness targets the ` +
        `action's real code; rename the step here too, or the evals silently stop testing it.`,
    );
  }
  const stepIndent = lines[stepIdx].search(/\S/);

  // Scan forward to `key: |` while still inside this step (a line at or left of
  // the step's own `- ` indent starts the next step).
  let keyIdx = -1;
  for (let i = stepIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) <= stepIndent && /^\s*- /.test(l)) break;
    if (new RegExp(`^\\s*${key}:\\s*\\|\\s*$`).test(l)) { keyIdx = i; break; }
  }
  if (keyIdx === -1) throw new Error(`step "${stepName}" has no \`${key}: |\` block`);

  const keyIndent = lines[keyIdx].search(/\S/);
  const body = [];
  for (let i = keyIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") { body.push(""); continue; }
    if (l.search(/\S/) <= keyIndent) break;
    body.push(l);
  }
  // Trim trailing blank lines, then dedent by the block's minimum indent.
  while (body.length && body[body.length - 1] === "") body.pop();
  const indents = body.filter((l) => l.trim()).map((l) => l.search(/\S/));
  const dedent = Math.min(...indents);
  const src = body.map((l) => l.slice(dedent)).join("\n");

  // A `${{ }}` expression is interpolated by the Actions runner before Node ever
  // sees it. We do not interpolate, so executing one here would test a different
  // program than CI runs. Fail loudly rather than quietly diverge.
  if (/\$\{\{/.test(src)) {
    throw new Error(
      `step "${stepName}" ${key} block contains a \${{ }} expression — the eval ` +
        `harness cannot faithfully execute it. Move the value into \`env:\` and read it via process.env.`,
    );
  }
  return src;
}

/**
 * Run an extracted github-script body against stubs. `process` is passed as a
 * parameter so the script's `process.env.X` reads our env, not the real one.
 */
export async function runGithubScript(src, { core, github, context, env = {}, extra = {} }) {
  const proc = { ...process, env: { ...env }, exit: (code) => { throw new Error(`process.exit(${code})`); } };
  const fn = new AsyncFunction(
    "require", "core", "github", "context", "exec", "io", "glob", "fetch", "process", "__original_require__",
    src,
  );
  return fn(
    require_, core, github, context,
    extra.exec ?? {}, extra.io ?? {}, extra.glob ?? {}, extra.fetch ?? fetch,
    proc, require_,
  );
}

/** Run an extracted `shell: node {0}` body (plain Node, no github-script globals). */
export async function runNodeScript(src, { env = {} } = {}) {
  const logs = [];
  const proc = {
    ...process,
    env: { ...env },
    exit: (code) => { throw new Error(`process.exit(${code})`); },
  };
  const console_ = { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
  const fn = new AsyncFunction("require", "process", "console", "__filename", "__dirname", src);
  await fn(require_, proc, console_, "action.yml", ".");
  return { logs };
}
