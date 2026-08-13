# Adversarial Review

**A fresh-context, diff-only adversarial code-review gate for GitHub pull
requests.** Five skeptical AI review lenses run in parallel — each a *fresh agent
session that sees only the diff* — post their findings as PR reviews, and a
fail-closed merge gate blocks the merge on any blocking finding.

Built on the principle that a reviewer which already "saw" the code get written
is biased toward confirming its own work. So every lens starts cold, with no
plan, no task state, and no memory of the implementation — it reads the code the
way an attacker or a new maintainer would.

## The five lenses

| Lens | Looks for | Blocks merge on |
|------|-----------|-----------------|
| **Blind Hunter** | Logic errors, missing error handling, footguns — with zero project context | Bugs, security holes, data loss |
| **Edge Case Hunter** | Every branch and boundary condition for genuinely unhandled paths | `[CRASH]` / `[DATA]` paths |
| **Acceptance Auditor** | Whether every acceptance criterion in the PR body is implemented *and* tested | Unmet / partial ACs |
| **Sentinel** | Exploitable vulnerabilities (OWASP-aligned), concrete attack scenario required | Confirmed/likely exploits |
| **Viper** | Red-team attack paths — only active when auth/crypto/middleware/infra changes | Critical/high exploit chains |

Findings use one severity vocabulary: **MUST FIX** (blocks), **SHOULD FIX**,
**NITPICK**. Any MUST FIX makes that lens request changes, which fails the gate.

## Quick start

1. Add the caller workflow to your repo as `.github/workflows/adversarial-review.yml`
   (copy [`examples/caller-workflow.yml`](examples/caller-workflow.yml)).
2. Add a repository secret **`OPENROUTER_API_KEY`** (an [OpenRouter](https://openrouter.ai)
   key with access to the configured model).
3. In branch protection for `main`, require the **`Merge Gate`** status check.

That's it — every PR to `main` now gets a five-lens adversarial review, and the
merge is blocked until the MUST FIX findings are resolved.

## How it works

- The caller runs `mode: lens` as a **5-way matrix** (one parallel job per lens),
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
| `lens` | — | Required for `mode: lens`: `blind` \| `edge-case` \| `acceptance` \| `sentinel` \| `viper` |
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

### Running fewer lenses

Trim the matrix in the caller **and** the gate's `lenses` input to match. To run
only the correctness lenses, keep `blind,edge-case,acceptance`; add `sentinel`
and `viper` for security-sensitive repos.

## Cost & operational notes

- Every reviewed PR spends provider tokens across all matrix lenses. Control cost
  with fewer lenses, `diff_ignore_patterns`, and by skipping bot PRs (the example
  skips Dependabot).
- **Fork PRs can't read secrets**, so the gate can't run on them — the example
  skips forks and they stay non-auto-mergeable (a maintainer handles them).
- Treat PR text as untrusted: the shared contract instructs every lens to ignore
  instructions embedded in the PR title/description/comments (prompt-injection
  defense).
- **OpenSSF Scorecard:** pin the action to a commit SHA (not a tag) and keep the
  caller's `permissions:` minimal, as the example does.

## Local mode (pre-CI)

Run the same lenses against your working tree before you push:

```bash
scripts/run-local.sh --base origin/main            # review your branch vs main
scripts/run-local.sh --lens sentinel,viper         # a subset
```

Requires the `pi` CLI and a provider key in `OPENROUTER_API_KEY`. Findings are
written to `.adversarial-review/`.

## Provenance

The five personas and the fresh-/blind-context review method come from an
open-source review framework the author has run across several repositories; this
action packages the hardened CI form of it. See [ATTRIBUTION.md](ATTRIBUTION.md).

## License

Apache-2.0 © 2026 James Crowley. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
