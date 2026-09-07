---
name: check
description: Run the multi-lens adversarial code review on the working diff — fresh-context skeptical reviewers (Cold Read, Edge Cases, Acceptance Criteria, Security Review, Red Team, plus opt-in Policy & Provenance / OWASP) that hunt bugs, security holes, and unmet acceptance criteria before you push. Use when the user asks to adversarially review changes, review the diff/branch, run the lenses, or check a change before committing, pushing, or opening a PR.
argument-hint: "[--base <ref>] [--lens cold-read,security,...] [--add owasp-web,owasp-llm,policy]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# Blind Peer Review (local)

Run the blind-peer-review lenses against the working change and return a
fail-closed verdict. Each lens is a **fresh, independent** reviewer that sees only
the diff — never the plan, the intent, or the other lenses' findings. This is the
local twin of the CI merge gate; the personas are the same markdown files.

## 1. Scope the diff

- Base ref = the `--base <ref>` argument if given, else `origin/main`. Compute the
  change with `git diff <base>...HEAD`. If `<base>` is unresolved (not fetched),
  fall back to `git diff --merge-base <default-branch> HEAD`, then `git diff HEAD`.
- If the diff is empty, say so and stop.
- Write the diff to `.blind-peer-review/out/review-diff.patch` so every lens reads
  the exact same bytes.

## 2. Choose the lenses

- Read `${CLAUDE_PLUGIN_ROOT}/lenses/manifest.json` — the lens registry.
- Default set = the code lenses: `cold-read, edge-case, acceptance, security, red-team`.
- `--lens a,b,c` replaces the set; `--add x,y` adds opt-in lenses
  (`owasp-web`, `owasp-llm`, `policy`).

## 3. Resolve each persona (local override wins)

For lens `<key>`:

- If `.blind-peer-review/lenses/<key>.md` exists in THIS repo, use it as the
  persona — a trusted, developer-authored local override.
- Otherwise use `${CLAUDE_PLUGIN_ROOT}/lenses/<key>.md` (the base agent).
- Always also load `${CLAUDE_PLUGIN_ROOT}/contracts/shared-review-contract.md`
  (trust boundary, severity, output envelope).

Overrides are read only from local, committed repo files — never from untrusted
input. The persona files may mention GitHub tools (`get_pr_diff`); that is the CI
wording — ignore it here, you are local and read the patch file directly.

## 4. Run the lenses as fresh, parallel subagents

For each chosen lens, spawn a **separate** `Task` subagent (so each starts with a
clean context) with this prompt:

> LOCAL MODE — there is no pull request. The full diff to review is in
> `.blind-peer-review/out/review-diff.patch`. Read that file; read surrounding
> source on disk ONLY to confirm a finding; do NOT modify any file.
>
> {the resolved persona for this lens, with `__PR_NUMBER__` → "N/A (local)"}
>
> {contracts/shared-review-contract.md}
>
> There is no submission tool here: your FINAL message is the contract's JSON
> object and nothing else — no prose, no markdown fences.

Run them concurrently; never let one lens see another's output. Save each lens's
returned object to `.blind-peer-review/out/<key>.json`.

## 5. Adjudicate (fail closed)

Parse each lens's returned JSON and decide on the parsed `severity` values:

- A lens **BLOCKS** if any finding has `"severity": "MUST FIX"`.
- A lens whose output does not parse as the contract object **FAILED** — treat that
  as blocking, not as clean. A review nobody could read has not passed. Say what the
  lens returned instead so it can be re-run.
- **Never decide by searching the text for the words "MUST FIX".** A lens reporting
  "no MUST FIX findings" is a PASS, and substring matching would block it — the
  reason this step reads parsed fields and not prose.
- Print a summary table: lens → PASS / BLOCK / FAILED / (skipped), with each lens's
  MUST FIX count.
- Verdict: **BLOCK** if any lens blocked or failed, else **PASS**. State it plainly
  and list every MUST FIX finding (lens, `location`, `detail`) so they can be fixed
  before pushing.

Do not soften or re-adjudicate a lens's MUST FIX — surface it as written.
