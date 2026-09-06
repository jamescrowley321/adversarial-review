## Summary
Tells the autonomous loop to fix the CI baseline first. The CI work itself is issue #51 and is implemented by the loop, not by this PR.

The baseline task must: add a Test job, fix the TS2307 @playwright/test error, de-duplicate the two workflows, and settle the install path.
