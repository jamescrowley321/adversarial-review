<!--
Project-specific Compliance-lens rules for THIS repository — REFERENCE ONLY.

As of the injection-safe change, the Action no longer reads any rules file out of
the PR checkout, so this file is NOT auto-loaded in CI (CI enforces only the
built-in baseline: AI-provenance disclosure, human accountability, no committed
secrets). It documents this repo's policy and can be used as a LOCAL override by
committing an equivalent full persona at `.adversarial-review/lenses/compliance.md`.
Keep rules concrete and checkable; give each a severity (MUST FIX / SHOULD FIX / NITPICK).
-->

- **Conventional Commits.** The PR title and commits must follow Conventional
  Commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, …). Non-conforming → SHOULD FIX.
- **Persona output envelope.** Any change to a file under `lenses/` must preserve
  the strict `## <Lens Name>` output contract the merge gate parses. Breaking it → MUST FIX.
- **Pin third-party actions.** New third-party (non-`actions/`) GitHub Actions
  referenced in `action.yml` or workflows must be pinned to a commit SHA (not a
  floating tag), for OpenSSF Scorecard. First-party `actions/*` may use a major
  version tag. Unpinned third-party → MUST FIX.
- **No new runtime dependencies** without a justification in the PR description → SHOULD FIX.
