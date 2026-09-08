// Delivery half of the unsubmitted-review nudge.
//
// The decision — nudge or give up — lives in submission-state.mjs and was always
// tested. Delivery was not, and delivery is what broke: the handler used the
// `pi` captured when the extension loaded, and pi invalidates that context
// whenever the session is replaced or disposed. Every nudge threw
// "This extension ctx is stale after session replacement or reload", so the
// fallback for a lens that submitted nothing never fired; the run fell through
// to final-message parsing, found prose, and the job died with "no parseable
// JSON object" — four lens jobs on 2026-09-07 alone.
//
// pi builds a fresh context per emit (`runner.emit` → `createContext()` →
// `handler(event, ctx)`), so the handler must use the ctx it is handed. This
// lives here, apart from the .ts, so a test can hold the fake pi and prove it.

import { NUDGE_MESSAGE } from "./submission-state.mjs";

/**
 * Wire the nudge onto an extension API.
 *
 * @param {{on: Function, sendUserMessage?: Function}} pi  the captured extension API
 * @param {{onSettled: () => {nudge: boolean, reason: string}}} tracker
 * @param {(msg: string) => void} [log]
 */
export function attachNudge(pi, tracker, log = console.log) {
  pi.on("agent_settled", async (_event, ctx) => {
    const decision = tracker.onSettled();
    if (!decision.nudge) {
      log(`submit_findings: ${decision.reason}`);
      return;
    }
    log(`::warning::submit_findings: ${decision.reason} — asking it to submit.`);
    try {
      // The per-emit ctx first. Fall back to the captured API only when this
      // runtime hands the handler nothing usable — never make it worse.
      const target = typeof ctx?.sendUserMessage === "function" ? ctx : pi;
      target.sendUserMessage(NUDGE_MESSAGE);
    } catch (e) {
      // Never fatal. If this runtime will not take a programmatic message, the
      // run should end the way it would have without the nudge, not worse.
      log(
        `::warning::submit_findings: could not send the nudge (${e instanceof Error ? e.message : String(e)}); ` +
          `falling through to the action's final-message handling.`,
      );
    }
  });
}
