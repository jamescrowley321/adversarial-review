<!--
Project-specific Compliance-lens rules for THIS repository.

The Compliance lens always enforces its built-in baseline (AI-provenance
disclosure, human accountability, no committed secrets). Anything you write here
is ADDED on top of that baseline. Keep rules concrete and checkable; give each a
severity (MUST FIX / SHOULD FIX / NITPICK).

Consumers of the action: drop your own version of this file at
`.github/adversarial-review/compliance.md` (or point `compliance_rules_file` at
another path) to enforce your own policy.
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
