// Stubs for the Actions runtime, plus two thin drivers that run action.yml's
// real "Parse findings + post review" and "Aggregate lens results" steps.
//
// Everything here is deterministic and offline: no network, no model, no clock
// dependence. These drivers are what let a fixture assert on the ONE thing that
// actually stops a merge — the review `event` a lens posts, and the gate verdict
// that event produces.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractStepScript, runGithubScript } from "./action-script.mjs";

export const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
export const actionYml = () => readFileSync(join(ROOT, "action.yml"), "utf8");

export const HEAD_SHA = "0".repeat(39) + "1"; // fixed: no clock, no randomness
export const OWNER = "acme";
export const REPO = "widget";
export const PR_NUMBER = 42;

export function makeCore() {
  const c = {
    failed: null, infos: [], warnings: [], notices: [],
    info: (m) => c.infos.push(String(m)),
    debug: () => {},
    notice: (m) => c.notices.push(String(m)),
    warning: (m) => c.warnings.push(String(m)),
    error: (m) => c.warnings.push(String(m)),
    setFailed: (m) => { if (c.failed == null) c.failed = String(m); },
    setOutput: () => {},
    summary: { addRaw: () => c.summary, write: async () => {} },
  };
  return c;
}

export function makeContext({ headSha = HEAD_SHA } = {}) {
  return {
    repo: { owner: OWNER, repo: REPO },
    payload: { pull_request: { head: { sha: headSha }, number: PR_NUMBER } },
  };
}

/**
 * Octokit stub. `files` are PR files with `patch` (drives inline-comment
 * anchoring); `reviews` are pre-existing reviews (drives gate + reconcile).
 * Reviews created during the run are appended, so the post step's own
 * "did it land on head?" verification sees them — exactly as in production.
 */
export function makeGithub({ files = [], reviews = [], reviewComments = [], issueComments = [], failIssueList = false } = {}) {
  const created = [];
  const dismissed = [];
  const minimized = [];
  const deletedComments = [];
  const state = { reviews: [...reviews] };
  let nextId = 9000;

  const gh = {
    created, dismissed, minimized, deletedComments, state,
    paginate: async (fn, params) => fn(params).then((r) => r.data),
    graphql: async (_q, vars) => { minimized.push(vars.id); return { minimizeComment: { minimizedComment: { isMinimized: true } } }; },
    rest: {
      pulls: {
        listFiles: async () => ({ data: files }),
        listReviews: async () => ({ data: state.reviews }),
        listReviewComments: async () => ({ data: reviewComments }),
        createReview: async (p) => {
          const rec = {
            id: nextId++, body: p.body, state: p.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED",
            commit_id: p.commit_id, user: { login: "github-actions[bot]" },
            submitted_at: `2026-01-01T00:00:${String(created.length).padStart(2, "0")}Z`,
            event: p.event, comments: p.comments,
          };
          created.push(rec);
          state.reviews.push(rec);
          return { data: rec };
        },
        dismissReview: async (p) => {
          dismissed.push(p.review_id);
          const r = state.reviews.find((x) => x.id === p.review_id);
          if (r) r.state = "DISMISSED";
          return { data: {} };
        },
      },
      issues: {
        listComments: async () => {
          if (failIssueList) throw new Error("simulated listComments failure");
          return { data: issueComments };
        },
        deleteComment: async (p) => { deletedComments.push(p.comment_id); return { data: {} }; },
      },
      checks: { listForRef: async () => ({ data: [] }) },
    },
  };
  return gh;
}

/**
 * Drive action.yml's "Parse findings + post review" step over a raw agent
 * message. Returns what CI would observe: the failure string (if the lens job
 * fails), and the review body/event actually posted.
 */
export async function runParseStep({
  lensName, agentResponse, files = defaultFiles(), reviews = [], reviewComments = [],
  issueComments = [], failIssueList = false,
  dismissSuperseded = "false", cleanupAgentComments = "true", agentSuccess = "true", yml = null,
  lensHeading = undefined,
}) {
  const src = extractStepScript(yml ?? actionYml(), "Parse findings + post review", "script");
  const core = makeCore();
  const github = makeGithub({ files, reviews, reviewComments, issueComments, failIssueList });
  await runGithubScript(src, {
    core, github, context: makeContext(),
    env: {
      LENS_NAME: lensName,
      PR_NUMBER: String(PR_NUMBER),
      AGENT_RESPONSE: agentResponse,
      AGENT_SUCCESS: agentSuccess,
      DISMISS_SUPERSEDED: dismissSuperseded,
      CLEANUP_AGENT_COMMENTS: cleanupAgentComments,
      // CI publishes this from the compose step; default to the same value so
      // the evals exercise what production actually passes.
      LENS_HEADING: lensHeading === undefined ? headingForDisplayName(lensName) : lensHeading,
    },
  });
  const review = github.created[0] || null;
  return {
    failed: core.failed,
    posted: !!review,
    event: review?.event ?? null,
    body: review?.body ?? null,
    comments: review?.comments ?? [],
    deletedComments: github.deletedComments,
    blocked: review?.event === "REQUEST_CHANGES",
    core, github,
  };
}

/** Drive action.yml's "Aggregate lens results" (merge gate) step. */
export async function runGateStep({ expected, reviews, headSha = HEAD_SHA, yml = null }) {
  const src = extractStepScript(yml ?? actionYml(), "Aggregate lens results", "script");
  const core = makeCore();
  const github = makeGithub({ reviews });
  await runGithubScript(src, {
    core, github, context: makeContext({ headSha }),
    env: { EXPECTED: expected.join("|"), PR_NUMBER: String(PR_NUMBER) },
  });
  return { failed: core.failed, passed: core.failed == null, core };
}

/** A minimal two-line PR file so inline-comment anchoring always has a target. */
export function defaultFiles() {
  return [{
    filename: "src/app.js",
    patch: "@@ -1,2 +1,4 @@\n const a = 1;\n+const b = 2;\n+const c = 3;\n const d = 4;",
  }];
}

/** Build PR-files (with `patch`) from a fixture's unified diff. */
export function filesFromDiff(diff) {
  const out = [];
  let cur = null;
  for (const line of diff.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) { cur = { filename: m[1], patch: "" }; out.push(cur); continue; }
    if (/^(diff --git|index |--- |new file|deleted file|similarity|rename )/.test(line)) continue;
    if (!cur) continue;
    cur.patch += (cur.patch ? "\n" : "") + line;
  }
  return out.filter((f) => f.patch.includes("@@"));
}

/** Shape a bot review the way the gate expects to see one. */
export function botReview({ lens, state = "COMMENTED", commit_id = HEAD_SHA, id = 1, submitted_at = "2026-01-01T00:00:00Z", body = null }) {
  return {
    id, commit_id, state, submitted_at,
    user: { login: "github-actions[bot]" },
    body: body ?? `## ${lens}\n\n> summary\n\nNo findings.`,
  };
}

/**
 * Read findings back out of the review body the action RENDERED. Used only for
 * reporting and for `location_matches`; the block/no-block verdict always comes
 * from the review `event` the action chose, never from this.
 */
export function parseReviewBody(body) {
  const out = [];
  for (const line of String(body || "").split("\n")) {
    const m = line.match(/^- \[(MUST FIX|SHOULD FIX|NITPICK)\] `([^`]+)` — (.*)$/);
    if (m) out.push({ severity: m[1], location: m[2], detail: m[3] });
  }
  return out;
}

/** A top-level PR comment as the pi agent action leaves it: the raw JSON reply. */
export function agentJsonComment({ lens, id = 500, findings = [], bot = true, fenced = false, body = null }) {
  const json = JSON.stringify({ lens, summary: "s", findings }, null, 2);
  return {
    id,
    user: { login: bot ? "github-actions[bot]" : "a-person" },
    body: body ?? (fenced ? "```json\n" + json + "\n```" : json),
  };
}

/**
 * The shipped persona H1 for a display name, mirroring what action.yml's compose
 * step publishes as LENS_HEADING. Returns "" for a name no persona claims.
 */
export function headingForDisplayName(displayName) {
  const yml = actionYml();
  const m = yml.match(/const NAMES = \{([\s\S]*?)\n\s*\};/);
  if (!m) return "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*"?([a-z0-9-]+)"?:\s*"([^"]+)",?\s*$/);
    if (kv && kv[2] === displayName) {
      try {
        const txt = readFileSync(join(ROOT, "lenses", `${kv[1]}.md`), "utf8");
        const h = txt.split("\n").find((l) => l.startsWith("# "));
        return h ? h.replace(/^#\s*/, "").trim() : "";
      } catch { return ""; }
    }
  }
  return "";
}
