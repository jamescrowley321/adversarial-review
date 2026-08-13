# Attribution & provenance

## The method

Adversarial Review is the CI-hardened form of an open-source review framework by
James Crowley, run across several repositories (identity libraries, planning
brains, and application code). The core idea — **independent, fresh-context,
diff-only reviewers**, because a reviewer that already saw the code get written
is biased toward confirming its own work — is documented as the "blind
adversarial review" pattern in that framework's engineering method.

## The personas

The five review personas — **Blind Hunter, Edge Case Hunter, Acceptance Auditor,
Sentinel, Viper** — originate as the author's `review-agents/` prompt library
used by the Ralph autonomous-development loop. This action packages the
domain-neutral versions of those personas (not any project-specific variant) so
they apply to any codebase.

## The CI hardening

The parallel-matrix execution, the shared prompt-injection trust boundary, the
per-lens "did the review actually land?" verification with a single retry, the
attributable fail-loud, and the fail-closed merge-gate aggregation were authored
and paid for by James Crowley while wiring this framework into a private
application repository. That hardened workflow is extracted here, generalized,
and released under his own name as a reusable GitHub Action.

Engine: the [pi coding agent](https://pi.dev) via
[`shaftoe/pi-coding-agent-action`](https://github.com/shaftoe/pi-coding-agent-action).
