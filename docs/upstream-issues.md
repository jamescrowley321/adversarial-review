# Upstream issues — `shaftoe/pi-coding-agent-action`

Defects found in the agent action this project pins, each with the workaround
that is live in this repo. **Nothing here has been filed upstream.** These are
written up so a human can send them; do not auto-file them.

Pinned engine: `shaftoe/pi-coding-agent-action@c1e0b11c0b667f8e8fe9d0df8810c0745bfff59e` (v2.27.1).
Re-check both when that pin moves — a fixed upstream defect means a workaround
here can be retired, and a workaround nobody retires becomes folklore.

---

## 1. `filterDiffByIgnoreFiles` splits on an unanchored substring

**Where:** `packages/pi-platform-github/src/tools/pr-diff.ts`

```ts
const hunkSeparator = 'diff --git ';
const hunks = diff.split(hunkSeparator);   // substring split, not line-anchored
```

**What goes wrong.** The split is on the *substring* `diff --git `, not on a
line start. Any file whose **content** contains that sequence — a committed
`.patch` or `.diff` fixture, documentation showing a diff, a test snapshot — is
cut into extra chunks. Each phantom chunk's path is then parsed out of the
file's *own internal* header:

```ts
const match = headerLine.match(/^(a\/.+?)\s+b\//);
const filePath = match?.[1] ?? headerLine;   // falls back to raw text on no match
```

So `diff_ignore_patterns` is matched against a path that exists only inside the
ignored file. The result inverts the feature: the fixture file *is* excluded,
while its contents leak through as separate pseudo-files that no ignore pattern
can address. The `?? headerLine` fallback also means an unparseable header
yields a garbage path, which never matches a pattern and is therefore kept.

**Observed impact.** On PR #28 of this repo, five lenses blocked the merge
reporting a planted IDOR and a planted hardcoded credential as real defects in
`src/routes/documents.js` — a file this repository does not contain. Adding
`evals/fixtures/` to `diff_ignore_patterns` did not help, and could not.

**Suggested fix.** Anchor the split to a line start, e.g. split on
`/^diff --git /m`, and skip a chunk whose header does not parse rather than
falling back to the raw line.

**Our workaround (live).** Fixture patches are stored with `DIFFGIT ` where a
real patch says `diff --git `, and decoded at load time — so the token never
appears verbatim on disk and there is no split point to trip over.
`evals/lib/fixtures.mjs` → `decodeFixtureDiff`; enforced for every fixture by
`evals/validate-fixtures.mjs`, which fails the build if a literal `diff --git `
is committed.

---

## 2. `truncateDiffByBytes` can return more than `maxBytes`

**Where:** `packages/pi-orchestrator/src/pi/tools/get-pr-diff.ts`

```ts
const marker = BYTE_TRUNCATION_MARKER(maxBytes);   // "\n... (truncated at N bytes)"
const budget = maxBytes - Buffer.byteLength(marker, 'utf8');   // not floored at 0
let cutAt = Math.min(budget, buf.length);
...
let sliced = buf.subarray(0, cutAt).toString('utf8');
```

**What goes wrong.** The marker is 26 + `digits(maxBytes)` bytes. When
`maxBytes` is smaller than that — anything under roughly 30 — `budget` is
**negative**. `Buffer.subarray` interprets a negative end index as an offset
from the end of the buffer, so instead of slicing nothing it slices *almost
everything*, and the marker is then appended to it. The function returns more
data than the caller asked for: the opposite of its contract.

Reproduction:

```js
truncateDiffByBytes("line one\nline two\nline three\n", 1)
// → "lin\n... (truncated at 1 bytes)"   — 30 bytes returned for a 1-byte cap
```

**Impact.** Cosmetic at production caps (the shipped default is 102400) and no
crash, so this is low severity. It matters to anyone deliberately passing a
small `diff_max_bytes`, who silently gets *more* diff than they budgeted for
rather than less.

**Suggested fix.** Floor the budget at zero — `Math.max(0, maxBytes - markerBytes)` —
or return just the marker when the cap cannot accommodate it.

**Our workaround (live).** The compose step in `action.yml` validates
`diff_max_bytes` before it reaches the engine and refuses anything below a
1024-byte floor, falling back to the shipped default with a warning. Covered by
`evals/contract.test.mjs` → `diff cap validation`. The ported copy of this
algorithm in `evals/lib/pi-diff.mjs` reproduces the defect **deliberately** —
it mirrors the tool rather than improving on it, so a fixture measures what a
lens actually sees — and pins the behaviour in a test so the port cannot be
"fixed" into divergence by accident.

---

## 3. `get_pr_diff` wraps the diff in a markdown fence without escaping it

**Where:** `packages/pi-orchestrator/src/pi/tools/get-pr-diff.ts`

```ts
return diffToolResult(`PR #${pullNumber} Diff:\n\`\`\`diff\n${truncated.text}\n\`\`\``, details);
```

**What goes wrong.** The diff is interpolated into a fenced block with no
escaping. A pull request that changes a file containing a line of three
backticks — a README, a prompt file, any Markdown — closes the fence early. From
the model's point of view the remainder of that file's contents is no longer
quoted tool output but ordinary prose in the conversation.

**Impact.** It is a prompt-injection surface, and an easy one: the attacker
controls the file contents in the PR under review, which is precisely the
untrusted input the fence exists to delimit. Severity depends on the consumer's
prompt — this action wraps the tool result in its own `----- BEGIN DIFF UNDER
REVIEW -----` markers and instructs the lens to treat everything between them as
data, which limits but does not eliminate the exposure.

**Suggested fix.** Choose a fence longer than the longest backtick run in the
payload (the CommonMark rule), or drop the fence and delimit with a token that
cannot occur in a diff.

**Our workaround (partial).** The composed prompt wraps the whole tool result in
`----- BEGIN/END DIFF UNDER REVIEW -----` markers, and `shared_instructions.md`
opens with a trust boundary telling the lens that everything it reads through a
tool is untrusted data and that smuggled instructions are themselves a MUST FIX
finding. Three fixtures (`injection_diff_comment`, `injection_hidden_unicode`,
`injection_pr_body`) measure that the lens reports rather than obeys. The port
in `evals/lib/pi-diff.mjs` reproduces the unescaped fence **deliberately**, for
the same reason it reproduces the byte-budget defect: a fixture has to show a
lens what the real tool would have handed it.
