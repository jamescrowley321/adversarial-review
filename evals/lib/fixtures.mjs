// Fixture loading + prompt assembly.
//
// The prompt is built by running action.yml's OWN "Compose lens prompt" step,
// so an edit to lenses/*.md or to the composition logic is genuinely exercised
// by an eval run. Only the diff-acquisition preamble is swapped: production
// tells the agent to fetch the diff with `get_pr_diff`, and offline there is no
// PR to fetch. Everything downstream of that — persona, trust boundary,
// severity definitions, Grounding, the JSON output contract — is the shipped
// text, verbatim.

import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "./harness.mjs";
import { extractStepScript, runNodeScript } from "./action-script.mjs";
import { lensName } from "./lenses.mjs";

export const FIXTURES_DIR = join(ROOT, "evals", "fixtures");
const EVAL_PR = "42";
const EVAL_REPO = "acme/widget";

export function listFixtureIds() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(FIXTURES_DIR, d.name, "expected.json")))
    .map((d) => d.name)
    .sort();
}

export function loadFixture(id) {
  const dir = join(FIXTURES_DIR, id);
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  return {
    id,
    dir,
    diff: readFileSync(join(dir, "diff.patch"), "utf8"),
    prBody: readFileSync(join(dir, "pr-body.md"), "utf8"),
    ...expected,
  };
}

/**
 * The exact preamble action.yml prepends before the persona. Reproduced here so
 * we can slice it off; if the action changes it, composePrompt fails loudly
 * rather than silently evaluating a prompt CI never sends.
 */
function productionPreamble() {
  const [owner, name] = EVAL_REPO.split("/");
  return (
    `You are reviewing GitHub pull request #${EVAL_PR} in repository ` +
    `\`${EVAL_REPO}\`. When you call \`get_pr_diff\` or \`get_issue_or_pr_thread\`, pass ` +
    `exactly owner=\`${owner}\`, repo=\`${name}\`, pull_number=${EVAL_PR}. ` +
    `Do not guess or try other owner/repo values.\n\n`
  );
}

/** Run the action's compose step and return `persona + shared-instructions`. */
export function composeFromAction(lensKey) {
  const src = extractStepScript(readFileSync(join(ROOT, "action.yml"), "utf8"), "Compose lens prompt", "run");
  const dir = mkdtempSync(join(tmpdir(), "adv-eval-"));
  const envFile = join(dir, "github_env");
  try {
    // The step is synchronous; runNodeScript resolves once it returns.
    const done = runNodeScript(src, {
      env: { ACTION_PATH: ROOT, LENS_KEY: lensKey, PR: EVAL_PR, REPO: EVAL_REPO, GITHUB_ENV: envFile },
    });
    return done.then(() => {
      const raw = readFileSync(envFile, "utf8");
      const m = raw.match(/^COMPOSED_PROMPT<<(\S+)\n([\s\S]*)\n\1\n?$/);
      if (!m) throw new Error("could not read COMPOSED_PROMPT back from the compose step");
      const full = m[2];
      const pre = productionPreamble();
      if (!full.startsWith(pre)) {
        throw new Error(
          "action.yml's compose step no longer emits the expected PR-context preamble. " +
            "Update productionPreamble() in evals/lib/fixtures.mjs so evals keep exercising the real prompt.",
        );
      }
      return full.slice(pre.length);
    }).finally(() => rmSync(dir, { recursive: true, force: true }));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Eval-mode preamble. Replaces ONLY the two read tools with their results,
 * already fetched. It deliberately says nothing about severity, grounding or
 * output format — all of that must come from the shipped shared-instructions.md,
 * or the eval stops measuring the thing it is supposed to measure.
 */
function evalPreamble(fx) {
  return (
    `You are reviewing GitHub pull request #${EVAL_PR} in repository \`${EVAL_REPO}\`.\n\n` +
    `You have no tools in this environment. Both read tools have ALREADY been called ` +
    `for you and their complete results are reproduced verbatim below: ` +
    `\`get_issue_or_pr_thread\` returned the PR title and description under ` +
    `PULL REQUEST CONTEXT, and \`get_pr_diff\` returned the COMPLETE diff for this ` +
    `pull request under DIFF UNDER REVIEW. There is nothing further to fetch and ` +
    `nothing was truncated. Do not attempt tool calls. Review from what is below ` +
    `and reply with your JSON object as instructed.\n\n`
  );
}

function fixtureContext(fx) {
  return (
    `----- BEGIN PULL REQUEST CONTEXT (get_issue_or_pr_thread) -----\n` +
    `Title: ${fx.pr_title}\n\n` +
    `${fx.prBody.trim()}\n` +
    `----- END PULL REQUEST CONTEXT -----\n\n` +
    `----- BEGIN DIFF UNDER REVIEW (get_pr_diff) -----\n` +
    `${fx.diff.replace(/\n$/, "")}\n` +
    `----- END DIFF UNDER REVIEW -----\n`
  );
}

/** Full eval prompt for (lens, fixture). */
export async function composePrompt(lensKey, fx) {
  const shipped = await composeFromAction(lensKey);
  return evalPreamble(fx) + shipped + "\n\n" + fixtureContext(fx);
}

/** Every (fixture, lens) pair selected by the current filters. */
export function selectRuns({ ids = listFixtureIds(), lenses = null, smokeOnly = false } = {}) {
  const runs = [];
  for (const id of ids) {
    const fx = loadFixture(id);
    if (smokeOnly && !fx.smoke) continue;
    for (const [lensKey, expect] of Object.entries(fx.lenses || {})) {
      if (lenses && !lenses.includes(lensKey)) continue;
      runs.push({ id, lensKey, lensName: lensName(lensKey), fx, expect });
    }
  }
  return runs;
}
