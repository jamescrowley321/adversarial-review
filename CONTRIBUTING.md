# Contributing to Adversarial Review

Thanks for your interest in contributing. This repo is a **composite GitHub
Action** — mostly `action.yml`, the persona prompts in `lenses/`, and a bit of
Bash — so the contribution loop is lighter than a typical library.

## Code of Conduct

Be respectful, constructive, and collaborative. We're building something useful
together.

## What's here

| Path | What it is |
|------|------------|
| `action.yml` | The composite action (`mode: lens` / `mode: gate`), Node steps — no shell |
| `lenses/*.md` | The six review personas + the shared output contract |
| `scripts/run-local.mjs` | Local pre-CI runner (Node) |
| `examples/caller-workflow.yml` | Drop-in consumer workflow |
| `.github/adversarial-review/compliance.md` | This repo's own Compliance-lens rules |
| `.github/workflows/` | Self-review dogfood, lint, and release automation |
| `release-please-config.json`, `.release-please-manifest.json`, `version.txt` | release-please config + tracked version (see [Cutting a release](#cutting-a-release)) |

## Local development

No build step. Validate your changes the way CI does (Node, no shell):

```bash
node --check scripts/run-local.mjs                 # syntax-check the runner
```

To exercise the personas against a real diff without opening a PR:

```bash
node scripts/run-local.mjs --base origin/main
```

(Needs the `pi` CLI and `OPENROUTER_API_KEY`.) The end-to-end path — the action
posting real PR reviews — is covered by the **self-review** workflow, which runs
this action on its own pull requests.

## Making changes

### Branch naming

Descriptive names with a type prefix: `feat/`, `fix/`, `docs/`, `refactor/`,
`test/`, `chore/`, `ci/` — e.g. `feat/add-timeout-input`.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`.

### Pull requests

- **Keep PRs focused** — one change per PR.
- **Explain what and why**, not just how. If you change a persona, say what class
  of defect the change is meant to catch (or stop over-reporting).
- **Fill in the AI-provenance block** in the PR description (see below).
- Expect this action's own five lenses to review your PR. Resolve **MUST FIX**
  findings before merge.

## Cutting a release

Releases are automated with [release-please]. You do **not** run `gh release
create` by hand — cutting a release *is* merging the release PR.

1. **Land changes on `main`** as usual, with [Conventional Commit] messages.
   The commit *type* decides the SemVer bump: `feat:` → minor, `fix:` / `perf:`
   → patch, and a `!` or a `BREAKING CHANGE:` footer → major. `docs:`, `chore:`,
   `ci:`, `refactor:`, `test:`, and `style:` do **not** cut a release on their
   own — so use `feat:`/`fix:` for anything a consumer should get a new tag for.
2. **release-please opens a release PR** (titled `chore(main): release x.y.z`)
   and keeps it up to date as more commits land. It bumps `version.txt` and
   `.release-please-manifest.json` and prepends a `CHANGELOG.md` section drafted
   from the commits. This PR is the human decision point — curate the changelog
   wording in it if you want, then approve it like any other PR.
3. **Merge the release PR.** On merge, the `Release Please` workflow publishes
   the `vX.Y.Z` GitHub Release **and**, in the same run, advances the `vX` major
   tag (e.g. `v1`) to the released commit — so consumers pinned to `@v1` pick it
   up automatically. No PAT, GitHub App, or manual tag move is involved.

Why the major-tag move lives in the same workflow: a Release published with the
default `GITHUB_TOKEN` can't trigger a *separate* `on: release` workflow, so a
standalone tag-mover would silently stop `@v1` from advancing. Folding it into
the release-please run avoids that (and avoids managing a token). If you ever
must publish out-of-band, move the tag yourself:
`git tag -f v1 <released-sha> && git push -f origin v1`.

[release-please]: https://github.com/googleapis/release-please
[Conventional Commit]: https://www.conventionalcommits.org/

## AI-Assisted Contributions

Contributions that use AI tools (GitHub Copilot, Claude Code, ChatGPT, Cursor,
the Ralph loop, `pi`, etc.) are welcome. We apply the same quality standards to
all contributions regardless of how they were authored.

### Requirements for AI-assisted PRs

- **All CI checks must pass** — lint, the adversarial-review gate, everything. No exceptions.
- **Audit disclosure is required.** Every AI-assisted PR must record, in the PR
  description's **AI provenance** block, the **harness/agent(s)** and the
  **model(s)** used to produce the change (e.g. harness `Claude Code`, model
  `claude-opus-4-8`; or harness `ralph-orchestrator + pi`, model `z-ai/glm-5.2`).
  This is enforced by the **Compliance** lens — a PR flagged AI-assisted that
  omits the harness or model **fails review**. See
  [`.github/pull_request_template.md`](.github/pull_request_template.md).
- **A human is accountable.** A named human must review the change and attest to
  it. The submitter is responsible for the correctness, security, and quality of
  the code regardless of whether it was AI-generated.
- **Advisory-only AI.** AI output — including this project's own review lenses —
  is advisory until a human attests. Do not treat a green gate as sign-off.

### What we look for

- No hallucinated APIs, invented flags, or unpinned/unverified action refs.
- Persona edits keep the strict `## <Lens>` output envelope (the merge gate parses it).
- Step logic stays in Node (`shell: node {0}`); the runner passes `node --check`.

## Provenance & credit

The review method and personas derive from an open-source lineage — the BMAD
Method's code-review workflow and the Ralph orchestrator loop. See
[ATTRIBUTION.md](ATTRIBUTION.md).

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0. See [LICENSE](LICENSE).
