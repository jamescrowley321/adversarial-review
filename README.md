# Adversarial Review

**A fresh-context, diff-only adversarial code-review gate for GitHub pull
requests.** Skeptical AI review lenses run in parallel — each a *fresh
[pi](https://pi.dev) agent session that sees only the diff* — post their findings
as PR reviews, and a fail-closed merge gate blocks the merge on any blocking finding.

Built on the principle that a reviewer which already "saw" the code get written
is biased toward confirming its own work. So every lens starts cold, with no
plan, no task state, and no memory of the implementation — it reads the code the
way an attacker or a new maintainer would.

## The lenses

Five adversarial defect-hunters, plus optional Compliance and OWASP lenses — all
run in parallel:

| Lens | Looks for | Blocks merge on |
|------|-----------|-----------------|
| **Blind Hunter** | Logic errors, missing error handling, footguns — with zero project context | Bugs, security holes, data loss |
| **Edge Case Hunter** | Every branch and boundary condition for genuinely unhandled paths | `[CRASH]` / `[DATA]` paths |
| **Acceptance Auditor** | Whether every acceptance criterion in the PR body is implemented *and* tested | Unmet / partial ACs |
| **Sentinel** | Exploitable vulnerabilities (OWASP-aligned), concrete attack scenario required | Confirmed/likely exploits |
| **Viper** | Red-team attack paths — only active when auth/crypto/middleware/infra changes | Critical/high exploit chains |
| **Compliance** *(opt-in)* | Policy: AI-provenance disclosure, human accountability, no secrets — plus your own rules | Undisclosed AI PRs, policy violations |
| **OWASP Web Top 10** *(opt-in)* | The 2021 web risks (A01–A10), each finding tagged with its category | Exploitable A0x issues |
| **OWASP LLM Top 10** *(opt-in)* | The GenAI/LLM 2026 risks (LLM01–LLM10); activates only on AI/LLM code | Exploitable LLM0x issues |

Findings use one severity vocabulary: **MUST FIX** (blocks), **SHOULD FIX**,
**NITPICK**. Any MUST FIX makes that lens request changes, which fails the gate.

## Quick start

1. Add the caller workflow to your repo as `.github/workflows/adversarial-review.yml`
   (copy [`examples/caller-workflow.yml`](examples/caller-workflow.yml)).
2. Add a repository secret **`OPENROUTER_API_KEY`** (an [OpenRouter](https://openrouter.ai)
   key with access to the configured model).
3. In branch protection for `main`, require the **`Merge Gate`** status check.

That's it — every PR to `main` now gets a multi-lens adversarial review, and the
merge is blocked until the MUST FIX findings are resolved.

## How it works

- The caller runs `mode: lens` as a **matrix** (one parallel job per lens),
  then a `mode: gate` job that `needs:` them.
- Each lens job composes its persona + a shared output contract, runs the
  [pi coding agent](https://pi.dev) (via `shaftoe/pi-coding-agent-action`) routed
  through OpenRouter, and the agent posts a `## <Lens>` PR review.
- **Flake handling:** each lens verifies its own review actually landed on the
  head commit, retries once, then **fails loudly and attributably** — so a
  re-run targets the one flaky lens, never a silent miscount.
- **The gate** counts only well-formed reviews on the head SHA, keeps the latest
  per lens (so a stale `CHANGES_REQUESTED` from an earlier attempt can't block a
  clean re-run), and **fails closed** if any lens is missing or requested changes.

## Inputs

| Input | Default | Notes |
|-------|---------|-------|
| `mode` | — (required) | `lens` or `gate` |
| `lens` | — | Required for `mode: lens`: `blind` \| `edge-case` \| `acceptance` \| `sentinel` \| `viper` \| `compliance` \| `owasp-web` \| `owasp-llm` |
| `lenses` | `blind,edge-case,acceptance,sentinel,viper` | Gate's expected set — must match the caller matrix |
| `github_token` | — (required) | `${{ secrets.GITHUB_TOKEN }}`; needs `pull-requests: write` |
| `api_key` | — | Provider key (required for `mode: lens`) |
| `provider` | `openrouter` | pi provider backend |
| `model` | `z-ai/glm-5.2` | Any model your provider exposes |
| `thinking_level` | `medium` | `low` \| `medium` \| `high` |
| `diff_max_lines` | `2000` | Diff truncation guard |
| `diff_max_bytes` | `204800` | Diff truncation guard |
| `diff_ignore_patterns` | lockfiles, build output, vendored code | Space-separated globs |
| `pr_number` | triggering PR | Override for manual runs |
| `compliance_rules_file` | `.github/adversarial-review/compliance.md` | Extra Compliance-lens rules (used when `lens: compliance`) |

### Toggling lenses

The example caller has a single `ENABLED` list (in its `config` job) that drives
**both** the parallel review matrix **and** the gate — one source of truth.
Comment a line to disable a lens; uncomment `owasp-web` / `owasp-llm` to enable
them. Run only `blind,edge-case,acceptance` for correctness; add `sentinel` /
`viper` for security; add `compliance` for policy; add the OWASP lenses for OWASP
coverage. Every enabled lens runs as its own parallel job.

## Compliance & AI-provenance policy

The **Compliance** lens is a review agent for governance rather than defects. It
reads the PR and enforces a built-in baseline:

- **AI-provenance disclosure** — an AI-assisted PR must state the **harness/agent**
  and **model(s)** used; a human must attest accountability.
- **Human accountability** — a named human is responsible for the change.
- **No committed secrets or private data.**

On top of the baseline it appends **your repo's own rules** from
`compliance_rules_file` (default `.github/adversarial-review/compliance.md`), so
each project can enforce its own policy (commit conventions, dependency rules,
pinned actions, whatever) without changing the action. Pair it with the
[PR template](.github/pull_request_template.md), which carries the AI-provenance
block contributors fill in.

Because it's an agent (not a regex), it catches undisclosed AI-authored PRs and
policy violations the same way the other lenses catch bugs. Like the other
lenses it runs on pi and needs the provider secret, so it can't run on fork PRs.

## Cost & operational notes

- Every reviewed PR spends provider tokens across all matrix lenses. Control cost
  with fewer lenses, `diff_ignore_patterns`, and by skipping bot PRs (the example
  skips Dependabot).
- **Fork PRs can't read secrets**, so the gate can't run on them — the example
  skips forks and they stay non-auto-mergeable (a maintainer handles them).
- **Billing is per-consumer.** The action uses *only* the `api_key` you pass from
  the consuming repo's own `OPENROUTER_API_KEY` secret — there is no fallback to
  any other key, and `mode: lens` fails fast if it's missing. Use a **distinct,
  budget-capped key per repo** so spend is attributed and bounded, and never
  reuse a personal key inside an org/company repo.
- Treat PR text as untrusted: the shared contract instructs every lens to ignore
  instructions embedded in the PR title/description/comments (prompt-injection
  defense).
- **OpenSSF Scorecard:** pin the action to a commit SHA (not a tag) and keep the
  caller's `permissions:` minimal, as the example does.

## Local mode (pre-CI)

Run the same lenses against your working tree before you push (Node, no shell):

```bash
node scripts/run-local.mjs --base origin/main        # review your branch vs main
node scripts/run-local.mjs --lens sentinel,viper     # a subset
```

Requires the `pi` CLI and a provider key in `OPENROUTER_API_KEY`. Findings are
written to `.adversarial-review/`.

## Credits & provenance

The reviewer runtime is the **[pi coding agent](https://pi.dev)** — every lens is
a pi session, driven in CI through
[`shaftoe/pi-coding-agent-action`](https://github.com/shaftoe/pi-coding-agent-action).
The personas and the fresh-/blind-context review method grew out of the
**[BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD)** code-review
workflow and the **[ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)**
loop. This action packages the hardened CI form of that framework. Full detail in
[ATTRIBUTION.md](ATTRIBUTION.md).

## License

Apache-2.0 © 2026 James Crowley. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
