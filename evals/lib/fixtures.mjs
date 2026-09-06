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
import { truncateDiff, renderGetPrDiff } from "./pi-diff.mjs";

export const FIXTURES_DIR = join(ROOT, "evals", "fixtures");
const EVAL_PR = "42";
const EVAL_REPO = "acme/widget";

/**
 * An input's shipped `default:` read straight out of action.yml.
 *
 * The diff-grounding paragraphs are built from three inputs that all HAVE
 * defaults, so production sends them on every run whether or not a caller sets
 * anything. Composing eval prompts without them measured a prompt CI never
 * sends — the "Diff scope" and "Diff limits" paragraphs were absent from every
 * eval prompt while being present in every real one.
 */
/** The body of a quoted scalar, from after the opening quote to its close. */
function closeQuoted(raw, q, name) {
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] !== q) continue;
    if (q === "'" && raw[i + 1] === "'") { i++; continue; }   // '' is an escaped quote
    if (q === '"' && raw[i - 1] === "\\") continue;            // \" is escaped
    return raw.slice(1, i);
  }
  throw new Error(`action.yml: input \`${name}\` has an unterminated ${q} default`);
}

export function actionInputDefault(name, yml = readFileSync(join(ROOT, "action.yml"), "utf8")) {
  // Scanned line by line rather than matched with a regex built from `name`.
  // Two reasons, both raised on the PR that added this: a constructed RegExp
  // trips Semgrep's detect-non-literal-regexp, and a single pattern over YAML
  // silently mis-reads anything it did not anticipate — an escaped quote, a
  // block scalar — which here would mean composing eval prompts around a cap
  // this action does not actually ship. Every regex below is a literal, and
  // every shape this cannot read throws instead of guessing.
  //
  // A YAML library would be the obvious answer and is not available: this
  // harness runs with zero npm dependencies so the offline layer works on any
  // checkout, which is also why it can gate every PR.
  const lines = yml.split("\n");
  let i = lines.indexOf(`  ${name}:`);
  if (i === -1) throw new Error(`action.yml: no input named \`${name}\``);

  for (i += 1; i < lines.length; i++) {
    // Dedent to column 0-2 means we left this input's block without a default.
    if (/^ {0,2}\S/.test(lines[i])) break;
    const m = /^ {4}default: (.*)$/.exec(lines[i]);
    if (!m) continue;
    const raw = m[1].trim();
    if (raw === "|" || raw === ">" || raw.startsWith("|") || raw.startsWith(">")) {
      throw new Error(
        `action.yml: input \`${name}\` has a block-scalar default. Read it explicitly ` +
          `rather than through this helper, which only handles single-line scalars.`,
      );
    }
    // A quoted scalar ends at its closing quote; anything after it is a trailing
    // comment, not part of the value. Scanning to the close rather than testing
    // endsWith is what makes `default: '2000'  # the cap` read as 2000 instead
    // of "'2000'  # the cap" — a value that would then be stated as fact in
    // every eval prompt.
    if (raw.startsWith("'")) return closeQuoted(raw, "'", name).split("''").join("'");
    if (raw.startsWith('"')) return JSON.parse(`"${closeQuoted(raw, '"', name)}"`);
    // Unquoted: a `#` only starts a comment when preceded by whitespace.
    const hash = raw.search(/\s#/);
    return (hash === -1 ? raw : raw.slice(0, hash)).trim();
  }
  throw new Error(`action.yml: no default found for input \`${name}\``);
}

/** The diff-acquisition config production runs with, from action.yml's own defaults. */
export function actionDiffDefaults() {
  return {
    maxLines: actionInputDefault("diff_max_lines"),
    maxBytes: actionInputDefault("diff_max_bytes"),
    ignoredPaths: actionInputDefault("diff_ignore_patterns"),
  };
}

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

/**
 * Run the action's compose step and return `persona + shared-instructions`.
 *
 * `diff` carries the diff-acquisition config the prompt is grounded in. It
 * defaults to action.yml's own input defaults so an eval prompt matches what
 * production sends; a fetch-path fixture overrides the caps so the limit the
 * prompt NAMES is the limit the harness actually applied.
 */
export function composeFromAction(lensKey, diff = actionDiffDefaults()) {
  const src = extractStepScript(readFileSync(join(ROOT, "action.yml"), "utf8"), "Compose lens prompt", "run");
  const dir = mkdtempSync(join(tmpdir(), "adv-eval-"));
  const envFile = join(dir, "github_env");
  try {
    // The step is synchronous; runNodeScript resolves once it returns.
    const done = runNodeScript(src, {
      env: {
        ACTION_PATH: ROOT, LENS_KEY: lensKey, PR: EVAL_PR, REPO: EVAL_REPO, GITHUB_ENV: envFile,
        IGNORED_PATHS: String(diff.ignoredPaths ?? ""),
        MAX_LINES: String(diff.maxLines ?? ""),
        MAX_BYTES: String(diff.maxBytes ?? ""),
      },
    });
    return done.then(() => {
      const raw = readFileSync(envFile, "utf8");
      // Match the COMPOSED_PROMPT block wherever it sits: the compose step also
      // writes LENS_HEADING, and an anchored whole-file match broke the moment a
      // second variable appeared.
      const m = raw.match(/(?:^|\n)COMPOSED_PROMPT<<(\S+)\n([\s\S]*?)\n\1\n/);
      if (!m) throw new Error("could not read COMPOSED_PROMPT back from the compose step");
      const full = m[2];
      if (!TARGETING.test(full)) {
        throw new Error(
          "action.yml's compose step no longer opens with the expected tool-targeting sentence. " +
            "Update TARGETING in evals/lib/fixtures.mjs so evals keep exercising the real prompt.",
        );
      }
      // The two diff-grounding paragraphs went missing from every eval prompt
      // once before — not by being deleted, but by never being composed, because
      // the harness left their inputs unset. Nothing failed; the evals just
      // quietly stopped covering them. Assert their presence whenever their
      // inputs were supplied, so the same silence cannot happen twice.
      if (diff.ignoredPaths && !full.includes("Diff scope:")) {
        throw new Error("compose step produced no `Diff scope:` paragraph despite diff_ignore_patterns being set");
      }
      if ((diff.maxLines || diff.maxBytes) && !full.includes("Diff limits:")) {
        throw new Error("compose step produced no `Diff limits:` paragraph despite the diff caps being set");
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
 *
 * The completeness claim is conditional, and that is the whole point of the
 * fetch-path mode. For an ordinary fixture the diff below IS complete, so
 * saying so is true. For a truncated fixture it is false — and the preamble
 * must not replace it with "this diff was truncated" either, because in
 * production nothing announces truncation in the preamble. The agent gets one
 * signal and one only: the marker `get_pr_diff` appends to the payload. Telling
 * the lens up front would measure whether it can follow an instruction, not
 * whether it notices the boundary.
 */
export function evalPreamble(fx) {
  const complete =
    `\`get_pr_diff\` returned the COMPLETE diff for this pull request under ` +
    `DIFF UNDER REVIEW. There is nothing further to fetch and nothing was truncated. `;
  const fetched =
    `\`get_pr_diff\` returned, verbatim and in full, what is reproduced under ` +
    `DIFF UNDER REVIEW — that tool result is the entirety of your evidence and ` +
    `there is no way to fetch more. `;
  return (
    `You are reviewing GitHub pull request #${EVAL_PR} in repository \`${EVAL_REPO}\`.\n\n` +
    `You have no tools in this environment. Both read tools have ALREADY been called ` +
    `for you and their complete results are reproduced verbatim below: ` +
    `\`get_issue_or_pr_thread\` returned the PR title and description under ` +
    `PULL REQUEST CONTEXT, and ` + (fx.fetch ? fetched : complete) +
    `Do not attempt tool calls. Review from what is below ` +
    `and reply with your JSON object as instructed.\n\n`
  );
}

/**
 * The diff payload, and the caps it was produced under.
 *
 * Default mode feeds the fixture's diff inline — cheap, and right for every
 * fixture whose subject is not the fetch itself. Fetch mode runs the fixture's
 * diff through the ported `get_pr_diff` truncation at the fixture's caps and
 * reproduces the tool RESULT, marker and fence included. The same caps go to
 * the compose step, so the limit the prompt names is the limit that was
 * applied — production's invariant, and a fixture that broke it would be
 * teaching the lens to distrust a number that was never true.
 */
export function fixtureDiffPayload(fx) {
  if (!fx.fetch) return { text: fx.diff.replace(/\n$/, ""), diffConfig: actionDiffDefaults(), truncation: null };

  const defaults = actionDiffDefaults();
  const maxLines = Number(fx.fetch.max_lines ?? defaults.maxLines);
  const maxBytes = Number(fx.fetch.max_bytes ?? defaults.maxBytes);
  const cut = truncateDiff(fx.diff.replace(/\n$/, ""), maxLines, maxBytes);
  return {
    text: renderGetPrDiff(EVAL_PR, cut.text),
    diffConfig: { ...defaults, maxLines: String(maxLines), maxBytes: String(maxBytes) },
    truncation: cut,
  };
}

function fixtureContext(fx, payload) {
  return (
    `----- BEGIN PULL REQUEST CONTEXT (get_issue_or_pr_thread) -----\n` +
    `Title: ${fx.pr_title}\n\n` +
    `${fx.prBody.trim()}\n` +
    `----- END PULL REQUEST CONTEXT -----\n\n` +
    `----- BEGIN DIFF UNDER REVIEW (get_pr_diff) -----\n` +
    `${payload.text}\n` +
    `----- END DIFF UNDER REVIEW -----\n`
  );
}

/** Full eval prompt for (lens, fixture). */
export async function composePrompt(lensKey, fx) {
  const payload = fixtureDiffPayload(fx);
  const shipped = await composeFromAction(lensKey, payload.diffConfig);
  return evalPreamble(fx) + shipped + "\n\n" + fixtureContext(fx, payload);
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
