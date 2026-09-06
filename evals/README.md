# Lens evals

Lens quality used to be unmeasurable. A bad prompt edit was discovered when a
lens blocked a real PR for a false reason, or when a persona rename killed every
lens job in the org. This suite makes both classes of failure fail **here**,
before release.

Two layers, split by cost.

| | What it does | Cost | Runs |
|---|---|---|---|
| **`contract.test.mjs`** | Drives `action.yml`'s **own** findings parser and merge gate over recorded inputs | free, ~0.1s | every PR |
| **`run.mjs`** | Feeds frozen PR fixtures through the **shipped prompts** to a pinned model, scores the gate verdict | ~$0.30/run | PRs touching `lenses/**`, `action.yml`, `evals/**` |

Both exercise the real action. `evals/lib/action-script.mjs` lifts the inline
`script:` / `run:` block scalars straight out of `action.yml` and executes them
against stubs, so there is no second copy of the parser, the gate or the prompt
assembly to drift out of sync. Edit the action and these evals test the edit.

## Running

```bash
node --test evals/contract.test.mjs   # offline contract + regression guards
node evals/validate-fixtures.mjs      # fixture lint (no network)
node evals/verify-guards.mjs          # prove the guards trip on pre-fix history

export OPENROUTER_API_KEY=...
node evals/run.mjs                    # smoke set, 3 reps
node evals/run.mjs --full             # every fixture
node evals/run.mjs --dry-run          # compose prompts, print the plan, spend nothing
node evals/run.mjs --lens acceptance --reps 5
node evals/run.mjs --write-baseline   # record the scorecard and always exit 0
```

`--dry-run` with `EVAL_PRINT_PROMPT=1` prints the exact prompt a lens receives.

### Phases, and why CI splits them

`run.mjs` runs in three phases (`--phase`, default `all`):

| Phase | Does | Needs the key? | Executes PR-controlled `action.yml` script? |
|---|---|---|---|
| `compose` | fixtures → the action's compose step → prompt files | no | **yes** |
| `call` | prompt files → model → response files | **yes** | no |
| `score` | response files → the action's findings parser → scorecard | no | **yes** |

Locally `all` runs them back to back. CI runs them as three separate steps on
purpose: the harness deliberately executes script text lifted from the pull
request's own `action.yml`, so no step should hold `OPENROUTER_API_KEY` while
doing it. Splitting them means a malicious edit to `action.yml` in a PR has no
secret within reach. It also makes runs re-scorable without re-spending — fix a
scoring bug and re-run `--phase score` over the responses you already paid for.

The model defaults to whatever `action.yml` ships as its `model` default, so a
scorecard describes the configuration consumers actually run. It is recorded in
the report: a lens score is meaningless without it, and this repo has already
been bitten once by an OpenRouter slug being retired underneath it (the undated
`anthropic/claude-sonnet-5` alias, v1.7.1).

## What is asserted — and what deliberately is not

The **gate verdict** is the only exact assertion, because it is the only thing
that stops a merge. A lens that phrases a finding differently on every run is
fine; a lens that blocks a clean PR is not.

Asserted:

- **block / no block** — must be **unanimous across reps**. A fixture that blocks
  2 of 3 times is flagged instability, not a pass.
- **`location_matches`** — for must-block fixtures, a regex on the finding
  `location` only. Blocking for the wrong reason is not a pass.
- **JSON validity** — the action's real parser must accept the output. It also
  enforces the lens name and the severity enum, so those come along for free.

Never asserted: `detail` or `recommendation` prose, finding counts, ordering,
severity wording beyond the enum. Failure detail *is* printed in the scorecard so
a failure is diagnosable without a rerun — printed for diagnosis, not asserted.

## Fixture classes

Two, because they fail differently and a suite with only one is gameable.

- **`must-block`** — a real defect is present. Expected: the gate blocks, and a
  finding's location names the right file. Without these, "stop the false
  positives" degenerates into "never block anything."
- **`must-not-block`** — a known false-positive shape. Expected: the gate does
  not block. Seeded from real incidents.

## Adding a case

```
evals/fixtures/<case-name>/
  diff.patch      # frozen unified diff — generate it with `git diff`, never by hand
  pr-body.md      # the PR description the lens reads
  expected.json
```

```json
{
  "class": "must-not-block",
  "smoke": true,
  "pr_title": "feat(search): keyboard navigation for the results dropdown",
  "guards": "Incident 1a — the Acceptance Auditor reported an implementation missing on a PR whose diff changed exactly those files.",
  "lenses": {
    "acceptance": { "block": false }
  }
}
```

- `class` — `must-block` or `must-not-block`.
- `smoke` — in the small set that runs on every lens-touching PR. Keep it small.
- `guards` — **required.** Name the incident or failure shape. A fixture whose
  reason for existing isn't written down gets deleted by the next person.
- `lenses` — one entry per lens this fixture targets. `must-block` entries also
  need `location_matches` (a regex against `file:line`).

Then run `node evals/validate-fixtures.mjs`. It checks the diff's hunk headers
against its body, that the diff has anchorable lines, that every lens key is one
the action ships, and that `location_matches` can actually be satisfied by a file
in that diff — a fixture that can never pass is worse than no fixture.

Generate `diff.patch` from a real tree rather than writing it by hand:

```bash
git init /tmp/fx && cd /tmp/fx
# write the "before" state, commit, write the "after" state
git add -A && git diff --cached -U3 > diff.patch
```

## Regression guards

Every documented incident has a guard, and `verify-guards.mjs` proves each guard
is load-bearing by replaying it against the commit that shipped the bug — a
regression test that passes against both the broken and the fixed code guards
nothing.

| Incident | Guard | Layer |
|---|---|---|
| Acceptance Auditor asserted an implementation was missing on a diff that contained it | `acceptance-implementation-present` | live |
| Acceptance Auditor invented a cross-browser requirement from a Chromium-only config | `acceptance-config-not-overread` | live |
| Acceptance Auditor failed ACs on a docs PR | `acceptance-docs-only` | live |
| Acceptance Auditor failed ACs on a prompt PR whose body described downstream work | `acceptance-downstream-issue` | live |
| `lenses/sentinel.md`'s subtitle made the model emit `lens: "Security Auditor"`, failing the job deterministically | `contract.test.mjs → incident 3` | offline |

The model-behaviour incidents cannot be replayed from git — the artifact that
failed was a model response, not code — so they live in `fixtures/` and are
measured, not proved.

## Fixtures contain deliberate defects

`evals/fixtures/*/diff.patch` are a vulnerable-code corpus: a deleted
tenant-ownership guard, a hardcoded credential, an unimplemented acceptance
criterion. That is the point — a suite of only clean fixtures scores a lens that
never blocks anything as perfect.

Two consequences worth knowing:

- The planted credential is written to be obviously non-functional
  (`SG.EXAMPLE-NOT-A-REAL-KEY.…`). A lens should still flag it — it is a
  credential hardcoded in source — but it is not a realistic-entropy key, so it
  neither trips secret scanners nor sets a precedent for committing one.
- `.gitleaks.toml` allowlists `evals/fixtures/*/diff.patch` and nothing else.
  Every other path in the repo, `evals/` included, is still scanned.

## Known gaps

Recorded honestly rather than tuned until green. See the `known gaps` block in
`contract.test.mjs`, marked `todo` so CI stays green while the gap stays visible.

- **Persona subtitles are still unguarded as a class.** Incident 3's fix added an
  `aliases` map covering the two subtitles seen in the wild. The failure *mode* —
  a model emitting the persona's subtitle instead of its primary name — still
  fails for all eight lenses, including `sentinel.md`'s current subtitle
  ("Security Review Agent"). Drop the `todo` flags in the PR that fixes it and
  they become permanent guards.

## Ground rules

- **Do not change a lens prompt and eval it in the same PR.** Establish the
  baseline first so a prompt change is measured against something.
- **A failing fixture is a finding, not a bug in the fixture.** Record it. Do not
  tune fixtures until they pass.
