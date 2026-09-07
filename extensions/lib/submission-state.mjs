// Whether a lens has delivered its review, and what to do when it has not.
//
// Split out of submit-findings.ts on purpose: that file imports `typebox` and
// the agent SDK, which only resolve inside a pi session, so nothing in it can
// be unit-tested. This module has no imports at all, so the decision that
// actually matters — nudge, or give up — is exercised by the offline suite.

/** Nudges before giving up and letting the action's message fallback take over. */
export const MAX_NUDGES = 2;

/**
 * What the agent is told when it stops without submitting. Deliberately blunt
 * and repeated verbatim: a lens that ignored the instruction once is not going
 * to be persuaded by a rephrasing, and varying the text would make the failure
 * harder to recognise in a log.
 */
export const NUDGE_MESSAGE =
  "You have not submitted your review. Nothing you have written so far will be " +
  "posted. Call the submit_findings tool now with `lens`, `summary` and " +
  "`findings`. If you found no problems, pass an empty findings array — that is " +
  "a normal result. Do not reply with a message; the tool call IS the review.";

/**
 * Tracks one lens run.
 *
 * The distinction that drives everything: NOT CALLED means the review is still
 * recoverable by asking again. CALLED-BUT-FAILED means the tool ran and could
 * not record, and the agent has already been told in the tool result to use its
 * final message instead — nudging there would talk it out of the fallback that
 * is now its only route.
 */
export function createSubmissionTracker({ maxNudges = MAX_NUDGES } = {}) {
  let called = false;
  let recorded = false;
  let nudges = 0;

  return {
    /** @param {boolean} ok — did the call actually record the review? */
    markCalled(ok) {
      called = true;
      if (ok) recorded = true;
    },

    get state() {
      return { called, recorded, nudges };
    },

    /** Decide what happens now that the agent has stopped. */
    onSettled() {
      if (recorded) {
        return { nudge: false, reason: "review submitted" };
      }
      if (called) {
        return {
          nudge: false,
          reason:
            "submit_findings ran but could not record the review; the tool result already told the agent to fall back to its final message",
        };
      }
      if (nudges >= maxNudges) {
        return {
          nudge: false,
          reason: `agent stopped without submitting after ${nudges} nudge(s) — giving up so the action's own fallback and error path can run`,
        };
      }
      nudges += 1;
      return {
        nudge: true,
        attempt: nudges,
        maxNudges,
        reason: `agent stopped without calling submit_findings (nudge ${nudges}/${maxNudges})`,
      };
    },
  };
}
