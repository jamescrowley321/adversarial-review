# Releases

Releases are authored by [release-please](https://github.com/googleapis/release-please):
every push to `main` updates a **release PR** that bumps the version and
rewrites `CHANGELOG.md` from the Conventional Commits since the last tag.
Merging that PR publishes the `vX.Y.Z` GitHub Release, and the same run advances
the `vX` major tag that consumers pin.

## Why a GitHub App token

A pull request **opened with `GITHUB_TOKEN` triggers no workflows.** That is a
deliberate GitHub safeguard against workflows recursively triggering workflows,
and it has an awkward consequence here: none of branch protection's required
contexts — `lint`, both CodeQL analyses, `Semgrep (SAST)`, `Gitleaks (secret
scanning)` — can ever run on a release PR. They are required, they can never
pass, so the PR sits `BLOCKED` with **zero checks**, forever.

That is not a hypothesis: v1.7.2 was merged with `gh pr merge --admin`, and PR
#38 (`release 1.8.0`) sat blocked with 0 checks until this was fixed.

A GitHub App token fixes it at the root. PRs authored by an app **do** trigger
workflows, so the release PR gets real CI and merges on green like anything else.

## One-time setup

Until this is done the workflow falls back to `GITHUB_TOKEN` and behaves exactly
as it did before — release PRs still need an admin merge, nothing breaks.

1. **Create the app** — <https://github.com/settings/apps/new>. Name it something
   like `adversarial-review-releases`. Uncheck **Webhook → Active**.

   Repository permissions, and nothing else:

   | Permission | Access | Why |
   |---|---|---|
   | Contents | Read and write | push the release branch, create tags, publish the Release |
   | Pull requests | Read and write | open and update the release PR |

2. **Install it** on `jamescrowley321/adversarial-review` only — *Only select
   repositories*, not "All repositories".

3. **Generate a private key** on the app's page and download the `.pem`.

4. **Add the credentials to this repo:**
   - Settings → Secrets and variables → Actions → **Variables** →
     `RELEASE_APP_ID` = the app's numeric App ID (this is not a secret)
   - Settings → Secrets and variables → Actions → **Secrets** →
     `RELEASE_APP_PRIVATE_KEY` = the entire `.pem`, including the
     `-----BEGIN...-----` and `-----END...-----` lines

5. **Delete the `.pem`** from your machine. It can be regenerated at any time,
   and a key sitting in `~/Downloads` is the likeliest way this leaks.

That is the whole change. The next push to `main` mints a token, recreates the
release PR under the app identity, CI runs on it, and it merges itself when
green.

## What is deliberately still manual

**Approval for outside contributors.** The repo is set to
`all_external_contributors` — every workflow run from someone who is not a
collaborator waits for a human to approve it. That is what stops a stranger's
pull request from spending the OpenRouter key or reaching any repo secret, and
**nothing in the release automation touches it.**

The release workflow runs only on `push` to `main` and manual dispatch. It never
runs on a `pull_request` event, so a fork can never reach the App token.

Check it any time:

```bash
gh api repos/jamescrowley321/adversarial-review/actions/permissions/fork-pr-contributor-approval
# {"approval_policy":"all_external_contributors"}
```

## Turning auto-merge off

Delete the *"Let the release PR merge itself once CI is green"* step from
`.github/workflows/release-please.yml`. Everything else keeps working; you just
press merge yourself, on a PR that now has real checks to look at.

## The version bump comes from commit messages

`feat:` → minor, `fix:` → patch, `!` or a `BREAKING CHANGE:` footer → major.
Anything else does not release on its own.

The `Conventional Commits` check on every PR enforces that every commit landing
on `main` declares a type, because a mistyped one is a mis-versioned release.
That was survivable while a human merged each release by hand; once releases
merge themselves, nothing else is looking.

**Not yet enforced:** that the type matches the *change*. v1.7.2 shipped a new
`cleanup_agent_comments` input — a new public surface — as a **patch**, because
every commit was written `fix:`. `action.yml` is the public contract, so this is
mechanically checkable against the merge base: a new key under `inputs:` implies
at least `feat:`, and a removed or renamed input or a changed `default:` implies
a major. Worth adding.
