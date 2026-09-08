# Blind Peer Review

**A fresh-context, diff-only adversarial code-review gate for GitHub pull
requests.** Skeptical AI review lenses run in parallel — each a *fresh
[pi](https://pi.dev) agent session that sees only the diff* — post their findings
as PR reviews, and a fail-closed merge gate blocks the merge on any blocking finding.

Built on the principle that a reviewer which already "saw" the code get written
is biased toward confirming its own work. So every lens starts cold, with no
plan, no task state, and no memory of the implementation — it reads the code the
way an attacker or a new maintainer would.

The reviewer personas are plain, harness-neutral markdown. The same lenses run as
a **GitHub Action** (the CI merge gate), a **Claude Code plugin**
(`/blind-peer-review`), and templates for **Codex** and **Cursor** — plus a local
pre-push runner. Tune a lens once; every harness picks it up.

## The lenses

Five adversarial defect-hunters, plus optional Compliance and OWASP lenses — all
run in parallel:

| Lens | Looks for | Blocks merge on |
|------|-----------|-----------------|
| **Cold Read** | Logic errors, missing error handling, footguns — with zero project context | Bugs, security holes, data loss |
| **Edge Cases** | Every branch and boundary condition for genuinely unhandled paths | `[CRASH]` / `[DATA]` paths |
| **Acceptance Criteria** | Whether every acceptance criterion in the PR body is implemented *and* tested | Unmet / partial ACs |
| **Security Review** | Exploitable vulnerabilities (OWASP-aligned), concrete attack scenario required | Confirmed/likely exploits |
| **Red Team** | Red-team attack paths — only active when auth/crypto/middleware/infra changes | Critical/high exploit chains |
| **Compliance** *(opt-in)* | Policy: AI-provenance disclosure, human accountability, no secrets — plus your own rules | Undisclosed AI PRs, policy violations |
| **OWASP Web Top 10** *(opt-in)* | The 2021 web risks (A01–A10), each finding tagged with its category | Exploitable A0x issues |
| **OWASP LLM Top 10** *(opt-in)* | The GenAI/LLM 2026 risks (LLM01–LLM10); activates only on AI/LLM code | Exploitable LLM0x issues |

Findings use one severity vocabulary: **MUST FIX** (blocks), **SHOULD FIX**,
**NITPICK**. Any MUST FIX makes that lens request changes, which fails the gate.

## Quick start

1. Add the caller workflow to your repo as `.github/workflows/blind-peer-review.yml`
   (copy [`examples/caller-workflow.yml`](examples/caller-workflow.yml)).
2. Add a repository secret **`OPENROUTER_API_KEY`** (an [OpenRouter](https://openrouter.ai)
   key with access to the configured model).
3. In branch protection for `main`, require the **`Merge Gate`** status check.

That's it — every PR to `main` now gets a multi-lens adversarial review, and the
merge is blocked until the MUST FIX findings are resolved.

> The example already grants what the lenses need: **`issues: read`** (the Compliance
> lens reads the PR thread) and **`timeout-minutes: 15`** on the review job (verbose
> security lenses run 6–8 min on a large diff). Keep both if you adapt it.

## How it works

- The caller runs `mode: lens` as a **matrix** (one parallel job per lens),
  then a `mode: gate` job that `needs:` them.
- Each lens job composes its persona + a shared output contract, runs the
  [pi coding agent](https://pi.dev) (via `shaftoe/pi-coding-agent-action`) routed
  through OpenRouter, and the agent **emits its findings as JSON** in its final
  message. The action parses that JSON, renders the `## <Lens>` review body, and
  **posts the PR review deterministically via Octokit** — the agent never calls
  the GitHub write API. This decoupling eliminates the flake class where the
  model botched the review-posting tool call under concurrent load.
- **Flake handling:** if the agent's JSON is missing/malformed (or the agent
  produced no output), the lens job **fails loudly and attributably** so a
  re-run targets the one flaky lens, never a silent miscount. There is **no
  automatic retry** (each lens runs once); end users can wire their own retry.
- **The gate** counts only well-formed reviews on the head SHA, keeps the latest
  per lens (so a stale `CHANGES_REQUESTED` from an earlier attempt can't block a
  clean re-run), and **fails closed** if any lens is missing or requested changes.
- **Security:** the lens agent's evidence tools are **read-only** (`get_pr_diff`,
  `get_issue_or_pr_thread`) — it cannot post reviews, run shell, write repo
  files, or reach secrets. A successful prompt injection can't exfiltrate the
  provider key or mutate the repo. The one write it can perform,
  `submit_findings`, writes a single file under `runner.temp` at a path this
  action sets and pull request content never touches; the review is still posted
  by this action via Octokit, not by the agent.
- **The output contract is enforced, not requested.** A lens delivers its review
  by *calling* `submit_findings`, whose arguments the provider validates against
  the schema before the call is delivered — so a review written as prose cannot
  arrive through that channel. That was the largest single cause of failed lens
  jobs. The older final-message JSON contract still works and is the documented
  fallback; set `submit_findings_tool: false` to run message-only.

## Inputs

| Input | Default | Notes |
|-------|---------|-------|
| `mode` | — (required) | `lens` or `gate` |
| `submit_findings_tool` | `true` | Deliver the review through a schema-checked `submit_findings` tool call instead of the agent's final message. `false` runs message-only. |
| `lens` | — | Required for `mode: lens`: `cold_read` \| `edge_case` \| `acceptance` \| `security` \| `red_team` \| `policy` \| `owasp_web` \| `owasp_llm` |
| `lenses` | `cold_read,edge_case,acceptance,security,red_team` | Gate's expected set — must match the caller matrix |
| `github_token` | — (required) | `${{ secrets.GITHUB_TOKEN }}`; needs `pull-requests: write` |
| `api_key` | — | Provider key (required for `mode: lens`) |
| `provider` | `openrouter` | pi provider backend |
| `model` | `z-ai/glm-5.2` | Any model your provider exposes |
| `models_config` | — (empty) | JSON for pi's `~/.pi/agent/models.json` (path is `$HOME`-relative), written before the lens runs (`mode: lens` only). Enforce per-model OpenRouter routing guardrails — `compat.openRouterRouting` with `zdr: true`, `sort: "price"`, `quantizations`, and `ignore` lists — on the request itself, not just at the account level. **Strict allowlist:** only `providers.<provider>.modelOverrides.<model>.compat.openRouterRouting` with safe scalar/array keys is accepted; dangerous keys (`baseUrl`, `endpoint`, `headers`, `apiKey`, `token`) are rejected loudly to prevent redirecting key-bearing requests. Invalid/out-of-schema JSON fails the job. Empty/omitted removes any stale file (no-op on ephemeral runners). Must be workflow-author-controlled — never derive from untrusted PR/issue content. |
| `thinking_level` | `medium` | `low` \| `medium` \| `high` |
| `diff_max_lines` | `2000` | Diff truncation guard. The limit is disclosed to the agent so a truncated diff is not mistaken for a complete one — raise it for large PRs rather than letting reviews run on a partial diff. |
| `diff_max_bytes` | `204800` | Diff truncation guard (same disclosure). |
| `diff_ignore_patterns` | lockfiles, build output, vendored code | Space-separated globs. Withheld paths are named in the lens prompt, so an excluded file is reported as unverified rather than missing. |
| `pr_number` | triggering PR | Override for manual runs |
| `dismiss_superseded` | `true` | On re-run, dismiss this lens's prior reviews from earlier commits + collapse their comments as OUTDATED (keeps re-pushed PRs quiet) |
| `cleanup_agent_comments` | `true` | **Deletes** the raw-JSON comment the pi agent action posts on the PR as a side effect of running. That comment is the agent's final message verbatim — the same findings this action re-posts as a rendered `## <Lens>` review — so it is an unreadable duplicate, and nothing else removes it: `dismiss_superseded` reaches reviews and their *inline* comments only. One accumulates per lens per push (8 lenses × 7 pushes left 60 on a single PR). Deletion is lossless because the content is reproduced in the review. Only a bot-authored comment that parses as JSON, carries a `findings` array, and names *this* lens is touched, and only after the review has landed. Set `false` to keep them. |

### Toggling lenses

The example caller has a single `ENABLED` list (in its `config` job) that drives
**both** the parallel review matrix **and** the gate — one source of truth.
Comment a line to disable a lens; uncomment `owasp_web` / `owasp_llm` to enable
them. Run only `blind,edge_case,acceptance` for correctness; add `security` /
`red_team` for security; add `policy` for policy; add the OWASP lenses for OWASP
coverage. Every enabled lens runs as its own parallel job.

### Gate the lenses behind your cheap checks

Don't pay for an AI review of a PR that fails lint. Add a `preflight` job that
`mode: preflight` uses to **wait for your deterministic checks to pass**, and
have the review matrix `needs:` it — so the paid lenses never start unless the
cheap gates are green (see the example caller):

```yaml
preflight:
  steps:
    - uses: jamescrowley321/blind-peer-review@v1
      with:
        mode: preflight
        github_token: ${{ secrets.GITHUB_TOKEN }}
        required_checks: "lint, typecheck, build, secret-scan"   # EXACT check-run names
review:
  needs: [config, preflight]   # only runs if preflight passed
```

`required_checks` are the exact check-run names (list only checks that run on
every PR). Preflight polls until they complete, **fails** if any fails (so the
lenses are skipped), and gives up after `preflight_timeout_seconds` (default
600). The preflight job needs `permissions: { checks: read }`.

## Compliance & AI-provenance policy

The **Compliance** lens is a review agent for governance rather than defects. It
reads the PR and enforces a built-in baseline:

- **AI-provenance disclosure** — an AI-assisted PR must state the **harness/agent**
  and **model(s)** used; a human must attest accountability.
- **Human accountability** — a named human is responsible for the change.
- **No committed secrets or private data.**

In CI the Compliance lens enforces **only** this trusted baseline — it does not
read any rules file out of the pull request under review, so a PR can't weaken its
own policy check (prompt-injection safety). To add project-specific policy for
**local** review, commit `.blind-peer-review/lenses/policy.md` (a trusted
override the local harnesses read). Pair the lens with the
[PR template](.github/pull_request_template.md), which carries the AI-provenance
block contributors fill in.

Because it's an agent (not a regex), it catches undisclosed AI-authored PRs and
policy violations the same way the other lenses catch bugs. Like the other
lenses it runs on pi and needs the provider secret, so it can't run on fork PRs.

## Versioning

Releases follow [SemVer]. **Pin `@v1`** — it always tracks the latest `v1.x.x`
and is advanced automatically on every release, so you get fixes and features
without changing your workflow; a breaking change would ship as `v2`. Prefer a
full `vX.Y.Z` tag (or a commit SHA, which OpenSSF Scorecard rewards) if you want
to pin exactly. Releases are cut with [release-please]; see
[CONTRIBUTING.md](CONTRIBUTING.md#cutting-a-release).

[SemVer]: https://semver.org
[release-please]: https://github.com/googleapis/release-please

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
- **Protect your key.** Because the review job runs with your provider key, use a
  budget-capped, repo-scoped key and keep secrets withheld from fork PRs — see
  [SECURITY.md → protecting your provider key](SECURITY.md#hardening-protecting-your-provider-key)
  (including why an approval environment does *not* close the collaborator path).

## Use it in your editor / harness

The lenses are one markdown library ([`lenses/`](lenses)) with thin per-harness
adapters, so the same personas review your code in CI *and* in your editor:

- **Claude Code** — install the plugin, then run
  `/blind-peer-review:check` on your working diff, or invoke a single
  lens (e.g. the `security` agent):

  ```
  /plugin marketplace add jamescrowley321/blind-peer-review
  /plugin install blind-peer-review@blind-peer-review
  ```

- **Codex / Cursor** — copy the template from [`adapters/`](adapters) into your
  repo (`AGENTS.md` for Codex, `.cursor/rules/` for Cursor) and vendor `lenses/`.
- **pi (local)** — `node scripts/run-local.mjs` (below).

### Tune a lens per repo (override)

Commit `.blind-peer-review/lenses/<key>.md` to *replace* a base persona for your
repo (e.g. a PHI/PII-tuned `sentinel.md`). The **local** harnesses read it — it's
your own trusted file. **CI (the pi Action) never reads it**: a pull request must
not be able to rewrite its own reviewer (OWASP LLM01), so the gate always runs the
pinned base set. See [`lenses/README.md`](lenses/README.md).

## Local mode (pre-CI)

Run the same lenses against your working tree before you push (Node, no shell):

```bash
node scripts/run-local.mjs --base origin/main        # review your branch vs main
node scripts/run-local.mjs --lens sentinel,red_team     # a subset
```

Requires the `pi` CLI and a provider key in `OPENROUTER_API_KEY`. Findings are
written to `.blind-peer-review/`.

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
