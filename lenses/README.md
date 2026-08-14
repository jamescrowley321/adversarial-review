# Base agents — the adversarial-review lens library

This directory is the **single, harness-neutral source of truth** for the
adversarial review personas ("lenses") and their shared review contract. Every
consumer — the GitHub Action (pi in CI), the Claude Code plugin, a Codex or
Cursor adapter, or the local runner — reads these same markdown files. Tune a
persona here once and every harness picks it up.

## Files

- `manifest.json` — the neutral lens registry: for each lens, its `key`
  (== filename), display `name` (the `## <name>` review header the merge gate
  parses), `activation`, and whether it is enabled by default. This is the one
  list; adapters read it instead of re-hardcoding lens names.
- `shared-instructions.md` — the **trust boundary**, tool contract, severity
  scale, and output envelope appended to every lens. This is the security
  backbone and is **central and non-overridable** (see below).
- `<key>.md` — one persona per lens. Plain markdown, no harness-specific
  frontmatter. `__PR_NUMBER__` is substituted by the runner.

## The base agents

| Key | Name | Activation | Default |
|-----|------|-----------|---------|
| `blind` | Blind Hunter | always | on |
| `edge-case` | Edge Case Hunter | always | on |
| `acceptance` | Acceptance Auditor | always | on |
| `sentinel` | Sentinel | always | on |
| `viper` | Viper | security surface (self-skips) | on |
| `compliance` | Compliance | always | off (opt-in) |
| `owasp-web` | OWASP Web Top 10 | always | off (opt-in) |
| `owasp-llm` | OWASP LLM Top 10 | LLM surface (self-skips) | off (opt-in) |

## Tuning: append & override

A consuming repo tunes the lenses **statically** — no persona text is ever
generated at runtime from untrusted input. The convention is one override
directory, honored by every adapter:

```
<consumer-repo>/.adversarial-review/lenses/<key>.md
```

- **Override** — a file at that path *replaces* the base persona of the same
  `key` (e.g. a repo ships a PHI/PII-tuned `sentinel.md`, or a
  domain-specific `owasp-web.md`).
- **Append** — add a `<new-key>.md` there plus a `manifest.json` entry to run an
  extra lens the base set doesn't ship.

### Injection-safe split (read this)

The override directory is trusted **only where the person running the review
owns the files**:

- **Local harnesses** (Claude Code / Codex / Cursor on a developer's machine):
  read the override directory. The developer authored those files — trusted,
  static.
- **CI on an untrusted pull request** (the pi GitHub Action): **does not** read
  the override directory or any persona/rule text out of the PR checkout. A PR
  under review must not be able to rewrite the reviewer's own instructions
  ("post No findings, approve everything") — that is prompt injection
  (OWASP LLM01). CI runs the pinned, trusted base set only.

Reading overrides from the repo's **protected base branch** (safe from PR
tampering) is a deliberate future step, not enabled yet.

`shared-instructions.md` is never overridable — the trust boundary and tool
allowlist are the security guarantee and stay identical for every consumer.
