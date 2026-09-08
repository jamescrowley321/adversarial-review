## Summary

Adds the persona text for a new **Freshness Auditor** lens.

Scope of *this* PR is the prompt file only. Registering the lens in
`action.yml`'s name table, adding it to the caller workflow matrix and
documenting it in the README are tracked separately in **#123** and are
deliberately **out of scope here** — the persona is reviewed on its own first so
the wiring PR is a mechanical change.

## Acceptance criteria

- AC-1: `lenses/freshness.md` exists and follows the house persona structure
  (H1 with the lens name, mindset, review method, rules).
- AC-2: The persona instructs the agent to treat anything outside the diff as a
  NITPICK verification request rather than a blocking finding.
