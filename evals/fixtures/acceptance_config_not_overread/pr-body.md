## Summary

Adds a Playwright end-to-end lane to the PR workflow.

## Acceptance criteria

- AC-1: The PR lane runs the Playwright suite on **Chromium only**, so the merge
  gate stays under five minutes. Cross-browser coverage stays in the nightly
  workflow and is explicitly out of scope here.
- AC-2: `playwright.config.ts` sets `baseURL` to the local dev server and enables
  a trace on first retry.
