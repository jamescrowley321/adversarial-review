# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); this project uses semantic
version tags (`v1`, `v1.0.0`, …), and consumers pin `@v1` (it tracks the latest
`v1.x.x`).

Releases are automated with [release-please](https://github.com/googleapis/release-please):
each `## [x.y.z]` section below is drafted from the Conventional Commits since the
previous release and can be curated in the release PR before it is merged. See
[CONTRIBUTING.md](CONTRIBUTING.md#cutting-a-release) for the flow. Sections at and
above `[1.4.1]` predate the automation and were hand-written.

## [1.4.1] — 2026-08-17

### Changed
- **Severity is now grounded in what the lens can actually see.** Added a
  Grounding rule to `lenses/shared-instructions.md`: a lens may not raise
  **MUST FIX**/**SHOULD FIX** on a concern that rests on code outside the diff
  (a workflow/job `name:`, an `if:`/fork guard in an unchanged hunk, whether a
  pinned SHA is malicious, whether an external model slug exists) — those become
  a single **NITPICK** verification request or are omitted. The gate counts the
  severity, not the "cannot confirm" caveat, so hedged-but-blocking findings
  were failing merges on unverifiable speculation (observed: 3 false MUST
  FIX/SHOULD FIX on one CI-only PR, each provably wrong). Genuine conflicts
  between two visible sources (diff vs. fetched PR description) and prompt-
  injection carve-outs remain MUST FIX.

## [1.4.0] — 2026-08-17

### Changed
- **Decoupled review posting from the agent.** `mode: lens` no longer has the
  agent call `create_pull_request_review` itself. The agent now emits its
  findings as a JSON object in its final message (`steps.pi.outputs.response`);
  the action parses/validates that JSON, renders the `## <Lens>` review body, and
  posts the PR review deterministically via Octokit (`pulls.createReview`). This
  eliminates the flake class where the model botched the review-posting tool call
  under concurrent load (observed: ~2/7 lenses per run failed to post, different
  lenses each time).
- Removed `create_pull_request_review` from the default `loaded_tools`. The
  lens agent is now strictly read-only (`get_pr_diff`, `get_issue_or_pr_thread`)
  — it cannot post reviews, run shell, write files, or reach secrets. Tighter
  security boundary (OWASP LLM01).
- Removed automatic per-lens retry from `mode: lens`. Each lens runs exactly
  once; a flaky/empty/malformed model output fails the lens job loudly and
  attributably so a human re-runs it. The agent no longer needs retries to post,
  since posting is deterministic. End users who want retry can add it in their
  caller workflow.
- Restored parallel lens execution (the `max-parallel: 1` interim measure is
  no longer needed now that posting doesn't depend on the model).
- Lens personas updated to emit JSON findings instead of review-body prose.

## [1.3.1] — 2026-08-15

### Added
- Initial extraction of the adversarial-review gate into a standalone,
  reusable composite GitHub Action (`mode: lens` and `mode: gate`).
- Five domain-neutral defect-hunting personas: Blind Hunter, Edge Case Hunter,
  Acceptance Auditor, Sentinel, Viper.
- **Compliance lens** (opt-in): an agent that enforces an AI-provenance policy
  (disclose harness + model, human accountability, no committed secrets).
- Contribution policy: `CONTRIBUTING.md` (with the AI-assisted-contribution
  requirements) and a PR template carrying the AI-provenance block.
- Shared output contract with a prompt-injection trust boundary, a single
  severity vocabulary (MUST FIX / SHOULD FIX / NITPICK), and a strict
  `## <Lens>` review envelope for gate parsing.
- Per-lens "review landed" verification and attributable fail-loud (no
  automatic retry — see [Unreleased]).
- Fail-closed merge gate with same-SHA scoping and latest-per-lens dedup.
- `scripts/run-local.mjs` for pre-CI local review of a working branch.
- Example consumer workflow (`examples/caller-workflow.yml`).

### Security
- Removed the `compliance_rules_file` input and the runtime read of a rules file
  from the pull-request checkout. The reviewer's instructions now come only from
  the action's pinned, trusted lenses — a PR can no longer inject reviewer
  instructions via a repo file (OWASP LLM01). CI runs the static base set only.

### Notes
- Action step logic is written in Node (`shell: node {0}`) — no Bash.
- Generalized the Sentinel and Viper security lenses away from the
  multi-tenant / PHI framing of their originating application repo, so they
  apply to any codebase.
- Credit: personas derive from the BMAD Method and ralph-orchestrator; the
  reviewer runtime is the pi coding agent.
