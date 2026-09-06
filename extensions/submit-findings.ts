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
      const out = process.env.ADVERSARIAL_FINDINGS_PATH;
      // Fail the CALL, not the run: the action falls back to parsing the final
      // message, so a misconfigured path costs fidelity, never the review.
      if (!out || !isAbsolute(out)) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "submit_findings is not wired up in this environment (ADVERSARIAL_FINDINGS_PATH is unset or not absolute). " +
                "Emit your findings as a single JSON object in your final message instead.",
            },
          ],
          details: { recorded: false, findings: params.findings.length },
        };
      }

      writeFileSync(out, JSON.stringify(params, null, 2), "utf8");

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
