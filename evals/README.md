# Lens evals

Lens quality used to be unmeasurable. A bad prompt edit was discovered when a
lens blocked a real PR for a false reason, or when a persona rename killed every
lens job in the org. This suite makes both classes of failure fail **here**,
before release.

Two layers, split by cost.

| | What it does | Cost | Runs |
|---|---|---|---|
| **`contract.test.mjs`** | Drives `action.yml`'s **own** findings parser and merge gate over recorded inputs | free, ~0.1s | every PR |
| **`run.mjs`** | Feeds frozen PR fixtures through the **shipped prompts** to a pinned model, scores the gate verdict | ~$0.30/run | `main` only — push, or dispatch |

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

## Coverage

Every shipped lens has **both** a must-block and a must-not-block fixture in the
smoke set. A lens with only positive cases can be satisfied by blocking
everything; a lens with only negative cases can be satisfied by blocking
nothing. Both failure modes have happened here.

| Lens | smoke block / no-block |
|---|---|
| `blind` | 2 / 1 |
| `edge-case` | 1 / 1 |
| `acceptance` | 1 / 4 |
| `sentinel` | 2 / 2 |
| `viper` | 1 / 2 |
| `compliance` | 1 / 1 |
| `owasp-web` | 1 / 1 |
| `owasp-llm` | 1 / 1 |

Three behaviours get their own treatment:

- **Truncation.** `get_pr_diff` cuts a large diff at `diff_max_lines` /
  `diff_max_bytes` and appends its own marker. The prompt discloses those caps
  (#36), but a lens that is *told* about a limit and a lens that *behaves* when
  it hits one are different claims, and only the first was ever tested. The two
  `truncation-*` fixtures use the fetch path below to put a lens in front of a
  genuinely truncated diff — one where the evidence for an AC is below the cut,
  one where a real defect is above it.
- **Activation gates.** `viper` and `owasp-llm` are supposed to emit `[]` and
  stop when the diff has no surface they cover. `max_findings: 0` asserts that.
  "Did not block" is not enough — a lens that skips but still files NITPICKs
  isn't skipping, and that noise is what the gate exists to prevent.
- **Prompt injection.** Three fixtures plant instructions in a code comment, in
  hidden zero-width Unicode, and in the PR body. The lens must report each as a
  `MUST FIX` and *not* obey it — and `injection-diff-comment` also carries a real
  command-injection bug, so obeying the injection loses a genuine finding too.

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

**`diff.patch` is stored with `DIFFGIT ` where a real patch says `diff --git `.**
Not cosmetic: the review agent's diff-fetch filters by splitting the PR diff on
the *substring* `"diff --git "`, unanchored. A committed patch file contains that
substring on its own content lines, so each inner header splits off a phantom
chunk whose path is the fixture's *internal* path — which `diff_ignore_patterns`
can never match. On PR #28 that had five lenses blocking on the planted IDOR and
credential as though they were real defects in files this repo does not have.
`validate-fixtures.mjs` enforces the encoding; `loadFixture` decodes it.

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
  need `location_matches` (a regex against `file:line`), or
  `location_not_asserted: "<reason>"` when the finding has no diff path to anchor
  to (e.g. it is about the PR body).
- `max_findings` — optional. `0` asserts an activation gate fired: the lens
  emitted nothing at all. Cannot be combined with `block: true`.
- `fetch` — optional. Switches the fixture to the **fetch path**; see below.

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

## The fetch path

By default a fixture's diff is fed to the lens inline, and the preamble says so:
the diff below is complete, there is nothing left to fetch. True for almost every
fixture, and it keeps the prompt honest.

It is false for exactly the case that matters most. In production the lens calls
`get_pr_diff`, and on a large PR that tool returns a *cut* diff with a marker
appended — `... (truncated at 2000 lines, 3855 more)`. A harness that always
hands over a complete diff can never measure what a lens does at that boundary,
which is the suspected trigger for the worst incident in this repo's history.

A fixture opts into the fetch path with `fetch`:

```json
"fetch": { "max_lines": 53 }
```

What changes:

- The fixture's diff is run through `evals/lib/pi-diff.mjs` — a port of the
  agent action's own truncation, pinned to the SHA `action.yml` uses — and the
  payload becomes the **tool result**, `PR #42 Diff:` header, ```` ```diff ````
  fence and truncation marker included.
- The **same caps** are passed to the compose step, so the limit the prompt
  discloses is the limit that was applied. Production's invariant; a fixture
  that broke it would teach the lens to distrust the disclosure.
- The preamble drops its completeness claim — and says nothing about
  truncation either. In production the marker is the only signal, so it is the
  only signal here. Announcing the cut would measure instruction-following
  rather than whether the lens notices the boundary.

`diff.patch` still stores the **whole** diff: the hunk arithmetic stays
checkable, the truncation stays reproducible, and the cap is the only thing you
tune. `validate-fixtures.mjs` refuses a `fetch` block that does not actually
truncate anything, and checks a must-block fixture's `location_matches` against
what survives the cut rather than the full diff — a defect below the cut can
never be reported.

Both classes are represented, deliberately. Teaching a lens that "the diff was
truncated" means "lower the severity and move on" would buy the false-positive
fix with a missed-defect regression, and `truncation-head-defect-must-block` is
what makes that trade visible.

## Fixtures ported from production incidents

Five fixtures come from real Acceptance Auditor failures on `healthcloud-console-web`
(#52, #56, #58) rather than being synthesised here:

| Fixture | What it reproduces |
|---|---|
| `acceptance-absent-claim-is-false` | "the implementation is missing" against a diff that contains it |
| `acceptance-absent-claim-buried-in-noise` | the same PR at its real size — 5,855 insertions, mostly lockfile churn, the real change near the end. Diff volume is the suspected trigger. Non-smoke: it is large. |
| `acceptance-requirement-invented` | "requires Chromium, Firefox and WebKit" against a config declaring one project |
| `acceptance-non-implementation-pr` | four ACs failed because the PR "does not contain the workflow files" — the deliverable was the instruction text |
| `grounding-deleted-guard-must-block` | positive control: an AC says access control is preserved and the diff deletes the check on a visible `-` line |

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
| …generalized: a model emitting **any** persona's subtitle instead of its primary name | `contract.test.mjs → "emitting only the subtitle of lenses/*.md validates"`, one per shipped lens | offline |

The model-behaviour incidents cannot be replayed from git — the artifact that
failed was a model response, not code — so they live in `fixtures/` and are
measured, not proved.

## Why the paid layer does not run on pull requests

The harness executes script text lifted from the checked-out `action.yml`, and
`run.mjs` is itself repo code. That is deliberate — an eval that reimplements
the parser passes while the shipped action is broken. Running repo code on a
runner is what every CI job does, and a fork PR gets no secrets and a read-only
token, so the **offline** layer is safe on anything.

Combining that with a provider key is the part that is not safe. A **same-repo
branch** PR does receive secrets, so a `pull_request`-triggered live job would
hand `OPENROUTER_API_KEY` to code the PR author controls. That is no worse than
what any same-repo PR can already do to this repo's workflows — but "no worse
than the hole that already exists" is a bad reason to add another one, and this
repo's own Sentinel and Viper lenses flag it on sight.

So the paid layer only ever runs against `main` — code that has already been
reviewed and merged. The workflow **refuses any other ref**, dispatch included,
before checkout and before any step that holds the key.

To score a lens change *before* merging it, run the harness locally with your
own key — which is the normal development loop anyway:

```bash
OPENROUTER_API_KEY=... node evals/run.mjs --full
```

Every deterministic regression guard lives in the offline layer, so PR coverage
never depends on the paid one.

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

## Observed live failure modes

Field data from real runs, pinned as contract tests in the `observed live
failures` block so the behaviour is described rather than rediscovered.

- **The provider returns empty 200s.** OpenRouter intermittently answers with
  an empty message and `finish_reason: "error"` — 3 of 18 calls on one run. The
  client retries these, and if they survive retries the scorecard reports them
  as *provider errors*, excluded from the JSON-validity denominator. A bad
  minute upstream must never read as a lens that emits invalid output.
- **The live layer composed a prompt production never sends.** Until the fetch
  path landed, `composeFromAction` left `IGNORED_PATHS`, `MAX_LINES` and
  `MAX_BYTES` unset, so the `Diff scope:` and `Diff limits:` paragraphs were
  absent from every prompt the paid layer ever sent — while being present in
  every real run, because all three inputs ship defaults. The offline tests
  proved the compose step *could* emit them and passed throughout; nothing
  proved a scored prompt *did*. A prompt-fidelity gap is invisible by
  construction, so both paragraphs now have an assertion in `composeFromAction`
  and a contract test over the composed prompt.

- **Illegal JSON escapes fail a lens outright.** Seen on PR #28: Viper quoted a
  regex in `detail`, wrote a lone backslash, and the job died with `Bad escaped
  character in JSON`. The action fails loud and asks for a re-run rather than
  guessing at a repair — that is the documented design — but it makes any lens
  that quotes regexes or Windows paths a flake source, and the gate's
  fail-closed "missing lens" branch turns that flake into a blocked merge.
  Whether the parser should repair common bad escapes is a live question; the
  test asserts today's behaviour so a change to it is deliberate and visible.

## Where the baseline lives

`evals/baseline/` is written by a run and is **git-ignored**. The record is the
`lens-eval-scorecard-*` artifact on the `Evals` workflow run for the merge you
care about — a copy committed to the repo goes stale the moment a fixture is
added, and a stale baseline is worse than none. (The one that shipped in #28
said 6 fixtures while `main` had 29.)

Treat a scorecard as the number a prompt change is measured against, not a
target to hit.

## Ground rules

- **Do not change a lens prompt and eval it in the same PR.** Establish the
  baseline first so a prompt change is measured against something.
- **A failing fixture is a finding, not a bug in the fixture.** Record it. Do not
  tune fixtures until they pass.
