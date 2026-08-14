---
name: review
description: Run the multi-lens adversarial code review on the working diff — fresh-context skeptical reviewers (Blind Hunter, Edge Case Hunter, Acceptance Auditor, Sentinel, Viper, plus opt-in Compliance/OWASP) that hunt bugs, security holes, and unmet acceptance criteria before you push. Use when the user asks to adversarially review changes, review the diff/branch, run the lenses, or check a change before committing, pushing, or opening a PR.
argument-hint: "[--base <ref>] [--lens blind,sentinel,...] [--add owasp-web,owasp-llm,compliance]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# Adversarial Review (local)

Run the adversarial-review lenses against the working change and return a
fail-closed verdict. Each lens is a **fresh, independent** reviewer that sees only
the diff — never the plan, the intent, or the other lenses' findings. This is the
local twin of the CI merge gate; the personas are the same markdown files.

## 1. Scope the diff

- Base ref = the `--base <ref>` argument if given, else `origin/main`. Compute the
  change with `git diff <base>...HEAD`. If `<base>` is unresolved (not fetched),
  fall back to `git diff --merge-base <default-branch> HEAD`, then `git diff HEAD`.
- If the diff is empty, say so and stop.
- Write the diff to `.adversarial-review/out/review-diff.patch` so every lens reads
  the exact same bytes.

## 2. Choose the lenses

- Read `${CLAUDE_PLUGIN_ROOT}/lenses/manifest.json` — the lens registry.
- Default set = the code lenses: `blind, edge-case, acceptance, sentinel, viper`.
- `--lens a,b,c` replaces the set; `--add x,y` adds opt-in lenses
  (`owasp-web`, `owasp-llm`, `compliance`).

## 3. Resolve each persona (local override wins)

For lens `<key>`:

- If `.adversarial-review/lenses/<key>.md` exists in THIS repo, use it as the
  persona — a trusted, developer-authored local override.
- Otherwise use `${CLAUDE_PLUGIN_ROOT}/lenses/<key>.md` (the base agent).
- Always also load `${CLAUDE_PLUGIN_ROOT}/lenses/shared-review-contract.md`
  (trust boundary, severity, output envelope).

Overrides are read only from local, committed repo files — never from untrusted
input. The persona files may mention GitHub tools (`get_pr_diff`); that is the CI
wording — ignore it here, you are local and read the patch file directly.

## 4. Run the lenses as fresh, parallel subagents

For each chosen lens, spawn a **separate** `Task` subagent (so each starts with a
clean context) with this prompt:

> LOCAL MODE — there is no pull request. The full diff to review is in
> `.adversarial-review/out/review-diff.patch`. Read that file; read surrounding
> source on disk ONLY to confirm a finding; do NOT modify any file.
>
> {the resolved persona for this lens, with `__PR_NUMBER__` → "N/A (local)"}
>
> {shared-review-contract.md}
>
> Emit your findings as a section beginning `## <Lens Name>`.

Run them concurrently; never let one lens see another's output. Save each lens's
returned section to `.adversarial-review/out/<key>.md`.

## 5. Adjudicate (fail closed)

- A lens **BLOCKS** if its section contains any `MUST FIX`.
- Print a summary table: lens → PASS / BLOCK / (skipped), with the MUST FIX count.
- Verdict: **BLOCK** if any lens blocks, else **PASS**. State it plainly and list
  every MUST FIX finding (lens, `file:line`, description) so they can be fixed
  before pushing.

Do not soften or re-adjudicate a lens's MUST FIX — surface it as written.
