Adds per-user notification preferences and makes the daily digest respect them.

## Acceptance criteria

1. `GET /api/preferences` returns the signed-in user's preferences, defaulting
   to digest enabled and no quiet hours when no row exists; `PUT` upserts them
   and rejects a non-boolean `digest_enabled` with a 400.
2. A migration creates `user_preferences`, keyed on `user_id` with a cascading
   delete, plus a partial index over the rows the digest job actually scans.
3. The digest worker skips a user whose send time falls inside their quiet
   hours, including a window that wraps midnight (e.g. 22:00–07:00).
