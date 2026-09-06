// A faithful port of the agent action's own diff truncation, so an eval can
// exercise the FETCH PATH rather than only the inline-diff path.
//
// Ported from shaftoe/pi-coding-agent-action, the engine action.yml pins:
//   packages/pi-orchestrator/src/pi/tools/get-pr-diff.ts
//   @ c1e0b11c0b667f8e8fe9d0df8810c0745bfff59e  (v2.27.1 — the pinned SHA)
//
// Why a port and not a call: `get_pr_diff` only exists inside a live agent
// session with a GitHub provider attached. The harness has neither, so the only
// way to put a lens in front of a genuinely truncated diff is to reproduce what
// the tool would have handed it — byte-for-byte, markers included.
//
// A port can drift from upstream. Two things keep that honest: the pinned SHA
// above names exactly what this mirrors, and `contract.test.mjs` asserts the
// marker text and the bytes-before-lines precedence, so a silent divergence
// shows up as a failing test rather than as a fixture that stops meaning
// anything. Re-check this file whenever the pin in action.yml moves.

/** Marker upstream appends to a BYTE-truncated diff. */
export const byteMarker = (maxBytes) => `\n... (truncated at ${maxBytes} bytes)`;

/** Marker upstream appends to a LINE-truncated diff. */
export const lineMarker = (maxLines, remaining) =>
  `\n... (truncated at ${maxLines} lines, ${remaining} more)`;

/**
 * Truncate to `maxBytes`, walking back to a UTF-8 boundary and then snapping to
 * the last newline, so the cut never lands mid-character or mid-line.
 */
export function truncateDiffByBytes(diff, maxBytes) {
  if (Buffer.byteLength(diff, "utf8") <= maxBytes) return { text: diff, truncated: false };

  const marker = byteMarker(maxBytes);
  const budget = maxBytes - Buffer.byteLength(marker, "utf8");
  const buf = Buffer.from(diff, "utf8");
  let cutAt = Math.min(budget, buf.length);

  // Never split a UTF-8 continuation byte.
  while (cutAt > 0 && ((buf[cutAt] ?? 0) & 0xc0) === 0x80) cutAt--;

  let sliced = buf.subarray(0, cutAt).toString("utf8");
  const lastNewline = sliced.lastIndexOf("\n");
  if (lastNewline > 0) sliced = sliced.slice(0, lastNewline);

  return { text: sliced + marker, truncated: true };
}

/** Truncate to `maxLines` lines, replacing the tail with the line marker. */
export function truncateDiffByLines(diff, maxLines) {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return { text: diff, truncated: false };
  const remaining = lines.length - maxLines;
  return {
    text: lines.slice(0, maxLines).join("\n") + lineMarker(maxLines, remaining),
    truncated: true,
  };
}

/**
 * Bytes first, then lines — upstream's order. The byte cut already snapped to a
 * newline, so the line cut is skipped once bytes have fired.
 */
export function truncateDiff(diff, maxLines, maxBytes) {
  const byBytes = truncateDiffByBytes(diff, maxBytes);
  if (byBytes.truncated) return { text: byBytes.text, truncated: true, reason: "bytes" };
  const byLines = truncateDiffByLines(diff, maxLines);
  if (byLines.truncated) return { text: byLines.text, truncated: true, reason: "lines" };
  return { text: diff, truncated: false, reason: null };
}

/**
 * The tool RESULT text, as the agent receives it. The fence and the `PR #n
 * Diff:` header are part of what get_pr_diff returns, so a fetch-path fixture
 * that omits them is not reproducing the fetch path.
 */
export const renderGetPrDiff = (pullNumber, text) =>
  `PR #${pullNumber} Diff:\n\`\`\`diff\n${text}\n\`\`\``;
