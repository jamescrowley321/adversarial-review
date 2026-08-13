# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); this project uses semantic
version tags (`v1`, `v1.0.0`, …).

## [Unreleased]

### Added
- Initial extraction of the adversarial-review gate into a standalone,
  reusable composite GitHub Action (`mode: lens` and `mode: gate`).
- Five domain-neutral defect-hunting personas: Blind Hunter, Edge Case Hunter,
  Acceptance Auditor, Sentinel, Viper.
- **Compliance lens** (opt-in): an agent that enforces an AI-provenance policy
  (disclose harness + model, human accountability, no committed secrets) plus
  per-repo rules loaded from `compliance_rules_file`.
- Contribution policy: `CONTRIBUTING.md` (with the AI-assisted-contribution
  requirements) and a PR template carrying the AI-provenance block.
- Shared output contract with a prompt-injection trust boundary, a single
  severity vocabulary (MUST FIX / SHOULD FIX / NITPICK), and a strict
  `## <Lens>` review envelope for gate parsing.
- Per-lens "review landed" verification, one retry on flaky/empty output, and
  attributable fail-loud.
- Fail-closed merge gate with same-SHA scoping and latest-per-lens dedup.
- `scripts/run-local.mjs` for pre-CI local review of a working branch.
- Example consumer workflow (`examples/caller-workflow.yml`).

### Notes
- Action step logic is written in Node (`shell: node {0}`) — no Bash.
- Generalized the Sentinel and Viper security lenses away from the
  multi-tenant / PHI framing of their originating application repo, so they
  apply to any codebase.
- Credit: personas derive from the BMAD Method and ralph-orchestrator; the
  reviewer runtime is the pi coding agent.
