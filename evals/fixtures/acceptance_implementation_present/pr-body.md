## Summary

Adds keyboard navigation to the search-results dropdown so the list is usable
without a mouse.

## Acceptance criteria

- AC-1: `ArrowDown` / `ArrowUp` move the highlighted result and wrap at both ends.
- AC-2: `Enter` navigates to the highlighted result's `href`.
- AC-3: `Escape` closes the dropdown and returns focus to the search input.
- AC-4: Each of the above is covered by a unit test.
