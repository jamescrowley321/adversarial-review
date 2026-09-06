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

/**
 * Fixture patches are stored with `DIFFGIT ` where a real patch says
 * `diff --git `, and decoded here.
 *
 * This is not cosmetic. The review agent's diff-fetch filters the PR diff by
 * splitting it on the SUBSTRING "diff --git " — not line-anchored — and then
 * matching each chunk's path against the ignore list. A committed `.patch`
 * file contains that substring on its own content lines, so every inner header
 * in a fixture splits off a phantom chunk whose path is the fixture's INTERNAL
 * path (`src/routes/documents.js`), which no ignore pattern can reach.
 *
 * The effect: five lenses blocked PR #28 reporting the planted IDOR and the
 * planted credential as real defects in files this repo does not have, and
 * `diff_ignore_patterns: evals/fixtures/` could not suppress it — the fixture
 * FILE was excluded while its CONTENTS leaked through as separate pseudo-files.
 *
 * Storing the token in a form that never appears verbatim removes the split
 * point, so the ignore pattern works as intended. validate-fixtures.mjs
 * enforces the encoding so it cannot be reintroduced by hand.
 */
export const decodeFixtureDiff = (t) => t.replace(/^DIFFGIT /gm, "diff --git ");

export function loadFixture(id) {
  const dir = join(FIXTURES_DIR, id);
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  return {
    id,
    dir,
    diff: decodeFixtureDiff(readFileSync(join(dir, "diff.patch"), "utf8")),
    prBody: readFileSync(join(dir, "pr-body.md"), "utf8"),
    ...expected,
  };
}

/**
 * The action's TARGETING sentence — the one part of its preamble that only makes
 * sense with tools attached, and so the only part an offline eval must replace.
 * Matched as a pattern, not compared as a fixed string: the compose step also
 * prepends other grounding (e.g. the run date), and that grounding should be
 * exercised by the evals, not silently dropped. If the targeting sentence itself
 * changes shape, composePrompt fails loudly rather than evaluating a prompt CI
 * never sends.
 */
const TARGETING = new RegExp(
  "^You are reviewing GitHub pull request #\\d+ in repository `[^`]+`\\. " +
  "When you call `get_pr_diff` or `get_issue_or_pr_thread`, pass " +
  "exactly owner=`[^`]+`, repo=`[^`]+`, pull_number=\\d+\\. " +
  "Do not guess or try other owner/repo values\\.\\n\\n",
);

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
      if (!TARGETING.test(full)) {
        throw new Error(
          "action.yml's compose step no longer opens with the expected tool-targeting sentence. " +
            "Update TARGETING in evals/lib/fixtures.mjs so evals keep exercising the real prompt.",
        );
      }
      // Drop only the targeting sentence; keep every other line the action
      // prepends, so added grounding is under test rather than stripped.
      return full.replace(TARGETING, "");
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
