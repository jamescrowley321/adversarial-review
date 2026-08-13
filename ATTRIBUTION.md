# Attribution & provenance

## The method

Adversarial Review is the CI-hardened form of an open-source review framework by
James Crowley, run across several repositories. The core idea — **independent,
fresh-context, diff-only reviewers**, because a reviewer that already saw the
code get written is biased toward confirming its own work — is documented as the
"blind adversarial review" pattern in that framework's engineering method.

## Lineage of the personas

The five review personas — **Blind Hunter, Edge Case Hunter, Acceptance Auditor,
Sentinel, Viper** — grew out of two open-source projects, and credit is due to both:

- **[BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD)** — the
  agile AI-driven development method whose code-review workflow (staged,
  adversarial, persona-based review) shaped the review decomposition these
  personas use.
- **[ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)** —
  the Ralph autonomous-development loop, under which the author's
  `review-agents/` prompt library (the direct ancestors of these personas) was
  authored and run.

This action packages the domain-neutral versions of those personas so they apply
to any codebase.

## The review engine — the pi coding agent

The lenses are executed by the **[pi coding agent](https://pi.dev)** (pi.dev):
each persona runs as a fresh, isolated pi session that reads the diff and posts
its findings as a PR review. In CI this action drives pi through
**[`shaftoe/pi-coding-agent-action`](https://github.com/shaftoe/pi-coding-agent-action)**
(SHA-pinned), routed through a provider (default: OpenRouter, model
`z-ai/glm-5.2`). The local runner (`scripts/run-local.mjs`) invokes the `pi` CLI
directly. Without pi, there is no reviewer — full credit to the pi project for
the agent runtime this is built on.

## The CI hardening

The parallel-matrix execution, the shared prompt-injection trust boundary, the
per-lens "did the review actually land?" verification with a single retry, the
attributable fail-loud, the fail-closed merge-gate aggregation, and the
configurable Compliance lens were extracted from an application repository,
generalized, and released here under the Apache-2.0 license.
