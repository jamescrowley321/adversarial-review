# Security Policy

Adversarial Review is a GitHub Action that runs AI review agents on pull requests
with access to a repository's diff and a provider API key. A vulnerability here
could leak that key, post forged reviews, or let malicious PR content subvert the
merge gate — so reports are taken seriously and triaged promptly.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **[Private Vulnerability Reporting](https://github.com/jamescrowley321/adversarial-review/security/advisories/new)**
(repository **Security** tab → **Report a vulnerability**). This opens a private
advisory visible only to you and the maintainers, where a fix can be coordinated.

When you report, please include as much of the following as you can:

- The affected version / commit or tag (`v1`, a SHA, …).
- The security impact — e.g. provider-key exposure, a prompt-injection that
  defeats the untrusted-PR-content trust boundary, a way to make the merge gate
  pass with unresolved MUST FIX findings, or forged/spoofed lens reviews.
- A minimal reproduction — ideally a sample PR diff/description that demonstrates
  the problem.

## What to expect

- **Acknowledgement** within 3 business days.
- An initial assessment (severity, affected versions, likely fix) within 10
  business days.
- Coordinated disclosure: a fix is prepared privately, released, and only then is
  the advisory published — with credit to the reporter unless you prefer to
  remain anonymous.

## Supported versions

This project is pre-1.0 and evolving. Security fixes are made against the latest
release and the moving major tag (`v1`); there is no back-porting to older
pre-release versions at this time.

## Scope

In scope: `action.yml`, the lens personas and shared output contract in
`lenses/`, the merge-gate and provenance logic, and `scripts/run-local.mjs`.

Out of scope (report upstream): the [pi coding agent](https://pi.dev) runtime and
[`shaftoe/pi-coding-agent-action`](https://github.com/shaftoe/pi-coding-agent-action),
and the model provider (e.g. OpenRouter) and the models themselves.
