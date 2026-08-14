# Harness adapters

The lenses in [`../lenses/`](../lenses) are plain, harness-neutral markdown — one
source of truth. Each harness reads the *same* personas; you tune a lens once and
every harness picks it up. This directory holds the thin adapters for harnesses
that live in the *consuming* repo (Codex, Cursor); the pi and Claude Code adapters
ship in this repo directly.

| Harness | Adapter | Where it lives | Runs |
|---------|---------|----------------|------|
| **pi** (CI gate) | [`../action.yml`](../action.yml) + [`../examples/caller-workflow.yml`](../examples/caller-workflow.yml) | this repo → consumer `.github/workflows/` | On every PR; fail-closed merge gate |
| **pi** (local) | [`../scripts/run-local.mjs`](../scripts/run-local.mjs) | this repo | `node scripts/run-local.mjs` before pushing |
| **Claude Code** | [`../skills/adversarial-review/`](../skills/adversarial-review) + [`../agents/`](../agents) | installed plugin | `/adversarial-review:adversarial-review`, or invoke a lens agent |
| **Codex** | [`codex/AGENTS.md`](codex/AGENTS.md) | consumer repo `AGENTS.md` | Codex reads it before working |
| **Cursor** | [`cursor/adversarial-review.mdc`](cursor/adversarial-review.mdc) | consumer repo `.cursor/rules/` | Ask Cursor to run the review |

## The one override convention (all harnesses honor it)

A consuming repo tunes a lens by committing `.adversarial-review/lenses/<key>.md`;
that file *replaces* the base persona of the same key for the local harnesses.

**Injection-safe split:** local harnesses (Claude Code, Codex, Cursor, the local
runner) read the override — the developer authored those files, so they're
trusted. **CI on an untrusted PR (the pi Action) never reads them** — a PR must
not be able to rewrite its own reviewer (OWASP LLM01). CI runs the pinned base
set only; see [`../lenses/README.md`](../lenses/README.md).

## Getting the lenses into a consumer repo

The local harnesses need the persona files on disk. Either vendor `lenses/` into
the consumer repo, add this repo as a submodule, or (Claude Code) install the
plugin so `${CLAUDE_PLUGIN_ROOT}/lenses/` resolves. The Codex and Cursor templates
below assume `lenses/` is reachable from the repo root — adjust the paths to match
how you vendored it.
