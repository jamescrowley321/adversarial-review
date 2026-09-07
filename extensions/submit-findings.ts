/**
 * `submit_findings` — the lens's output channel.
 *
 * WHY THIS EXISTS
 *
 * A lens used to deliver its review by *ending its message* in a particular
 * JSON shape. Nothing enforced that; the contract was an instruction in the
 * prompt and the model was free to ignore it. It did, repeatedly — three lens
 * jobs died in one day with "no parseable JSON object" (a good review, written
 * as prose), one with an illegal JSON escape, and one emitting an object with
 * no `lens` field. Each failed the merge gate closed on a formatting problem
 * while the actual review sat in the log, readable, unused.
 *
 * A tool call is a different kind of channel. Its arguments are schema-checked
 * by the provider before the call is ever delivered, so prose cannot arrive
 * through it. Moving the findings here does not make the model a better
 * reviewer — it removes an entire class of failure that had nothing to do with
 * review quality.
 *
 * The message channel remains valid and documented: this tool is unavailable
 * when the action runs with a narrowed `loaded_tools`, and the repair path
 * still covers a prose answer. Belt and braces, deliberately.
 *
 * TRUST BOUNDARY
 *
 * This does not widen the read-only tool allowlist. The tool writes one file,
 * to a path this action sets from `runner.temp` — never from pull request
 * content — and touches nothing else: no repo write, no GitHub API, no network,
 * no access to the provider key. A successful prompt injection can call it with
 * attacker-chosen findings, which is exactly what an injection could already do
 * by making the agent write attacker-chosen JSON in its final message. No new
 * capability, one fewer way to fail.
 *
 * `typebox` and `@earendil-works/pi-coding-agent` need not ship with this
 * action: the agent SDK loads extensions through jiti with both specifiers
 * aliased (VIRTUAL_MODULES / getAliases in its extension loader), so they
 * resolve from the SDK regardless of where this file sits on disk.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createSubmissionTracker, NUDGE_MESSAGE } from "./lib/submission-state.mjs";

const FINDING = Type.Object(
  {
    severity: Type.Union(
      [Type.Literal("MUST FIX"), Type.Literal("SHOULD FIX"), Type.Literal("NITPICK")],
      { description: "MUST FIX blocks the merge. SHOULD FIX and NITPICK do not." },
    ),
    location: Type.String({
      description:
        "`file:line` naming a path that appears in the diff you fetched. An invented path cannot be anchored as an inline comment.",
    }),
    detail: Type.String({ description: "What is wrong, concretely. Do not repeat the diff verbatim." }),
    recommendation: Type.String({ description: "How to fix it." }),
  },
  { additionalProperties: false },
);

const PARAMS = Type.Object(
  {
    lens: Type.String({ description: "The exact lens name given in your persona, e.g. \"Edge Case Hunter\"." }),
    summary: Type.String({ description: "One short line. NOT the findings." }),
    findings: Type.Array(FINDING, {
      description: "Every finding. Pass an empty array when there are none — do not omit this.",
    }),
  },
  { additionalProperties: false },
);

export default function submitFindingsExtension(pi: ExtensionAPI) {
  const tracker = createSubmissionTracker();

  // A schema-checked channel guarantees the review is well FORMED. It cannot
  // guarantee the review is SENT. On PR #48 the OWASP LLM lens finished with
  // the message "✅ Agent session completed" and never called this tool at all
  // — no findings anywhere, so the job failed exactly as it used to. The tool
  // fixed malformed output and left "no output" untouched.
  //
  // `agent_settled` fires once the run has finished and nothing further is
  // queued, which is the last moment anything can be recovered. Ask again, at
  // most twice, then stand aside: the action still has its final-message
  // fallback and its loud error, and a lens that has refused three times is
  // not going to be argued into it by a fourth.
  pi.on("agent_settled", async () => {
    const decision = tracker.onSettled();
    if (!decision.nudge) {
      console.log(`submit_findings: ${decision.reason}`);
      return;
    }
    console.log(`::warning::submit_findings: ${decision.reason} — asking it to submit.`);
    try {
      pi.sendUserMessage(NUDGE_MESSAGE);
    } catch (e) {
      // Never fatal. If this runtime will not take a programmatic message, the
      // run should end the way it would have without the nudge, not worse.
      console.log(
        `::warning::submit_findings: could not send the nudge (${e instanceof Error ? e.message : String(e)}); ` +
          `falling through to the action's final-message handling.`,
      );
    }
  });

  pi.registerTool({
    name: "submit_findings",
    label: "Submit Findings",
    description:
      "Submit your completed review. Call this exactly once, as the last thing you do. " +
      "The findings you pass here are the review that gets posted — nothing you write " +
      "outside this call is published.",
    promptSnippet: "Submit the completed review as structured findings.",
    promptGuidelines: [
      "Deliver the review by calling submit_findings — not by describing the findings in a message.",
      "Call it once, after you have finished reviewing. Pass findings: [] when you found nothing.",
    ],
    parameters: PARAMS,
    async execute(_toolCallId, params) {
      // Every failure here returns a RESULT, never throws. A thrown tool call
      // is an error the agent has to interpret; a result can carry the one
      // instruction that recovers the review — emit it in the final message,
      // where the action's older parser will find it. Losing the tool channel
      // must cost fidelity, never the review.
      const fallback = (why: string) => ({
        content: [
          {
            type: "text" as const,
            text:
              `submit_findings could not record your review (${why}). ` +
              `Do not retry this tool. Emit your findings as a single JSON object ` +
              `in your final message instead — that channel still works.`,
          },
        ],
        details: { recorded: false, findings: params.findings.length },
      });

      const out = process.env.ADVERSARIAL_FINDINGS_PATH;
      if (!out || !isAbsolute(out)) {
        tracker.markCalled(false);
        return fallback("ADVERSARIAL_FINDINGS_PATH is unset or not absolute");
      }

      try {
        writeFileSync(out, JSON.stringify(params, null, 2), "utf8");
      } catch (e) {
        // ENOSPC, EACCES, EISDIR, a runner with a full disk. Rare, and exactly
        // the moment when throwing away a completed review is least excusable.
        tracker.markCalled(false);
        return fallback(e instanceof Error ? e.message : String(e));
      }
      tracker.markCalled(true);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Review recorded: ${params.findings.length} finding(s). ` +
              `You are done — do not call this again, and do not restate the findings in your reply.`,
          },
        ],
        details: { recorded: true, findings: params.findings.length },
      };
    },
  });
}
