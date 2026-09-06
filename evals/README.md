# Lens evals

The gate blocks merges across every repo that installs this action. A lens prompt
regression is therefore a production incident, and this suite exists because
several have shipped: a persona whose emitted `lens` name failed the job, a lens
that returned prose instead of JSON, and an Acceptance Auditor that blocked four
pull requests on findings that were not true.

## Two layers, deliberately

**Layer 1 — envelope contract. Offline, deterministic, no key.**
Validates a lens's final message against the contract in
`lenses/shared-instructions.md`: one JSON object and nothing else, no markdown
fence, `lens` matching the job name under the same fuzzy rule `action.yml` uses,
`findings` an array (never `null`, never absent), every `severity` in the enum,
every `location` a `file:line` whose path appears in the diff.

Runs on every PR in `lint.yml`. Milliseconds, free. This layer catches most of
what has actually broken in production.

**Layer 2 — lens judgment. Sampled, needs the pi CLI.**
Runs a persona against a fixture and asserts on *whether it blocks*, never on its
prose. Model output varies, so each fixture runs N times and must agree on at
least `--threshold` of them. Raw outputs land in `.eval-runs/` for diagnosis.

```
node evals/run.mjs --layer 1
node evals/run.mjs --layer 2 --samples 5 --threshold 0.8
node evals/run.mjs --layer 2 --fixture grounding-deleted-guard-must-block
MODEL=google/gemini-2.5-pro node evals/run.mjs
```

Layer 2 skips with a message when `pi` is not runnable. A skip is not a pass.

## Adding a fixture

`evals/fixtures/<name>/` with three files:

| file | contents |
|---|---|
| `pr.json` | `{ "title", "body" }` — what `get_issue_or_pr_thread` would return |
| `diff.patch` | what `get_pr_diff` would return |
| `expect.json` | `{ "lens", "must_block", "why" }` |

`why` is not decoration. It records the real incident the fixture pins, so a
future maintainer can tell a deliberate behaviour change from a regression.

## The positive control is not optional

`grounding-deleted-guard-must-block` asserts the lens **does** block when a diff
deletes an auth check. Without it, every other fixture here could be satisfied by
making the lens never block — which would be a worse failure than the one this
suite was built to catch. Keep at least one must-block fixture per persona.

## Changing a lens prompt

A change to `lenses/*.md` should arrive with a fixture. If it fixes a false
positive, add the case that was wrongly blocked. If it fixes a miss, add the case
that should have blocked. Write the fixture first and watch it fail.
