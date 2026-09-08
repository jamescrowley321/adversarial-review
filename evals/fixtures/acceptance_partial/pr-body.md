## Summary
Add a `GET /api/v1/widgets/:id` endpoint for the dashboard.

## Acceptance criteria
- AC-1: `GET /api/v1/widgets/:id` returns the widget as JSON with fields `id`, `name`, `createdAt`.
- AC-2: When the widget does not exist the endpoint returns **404** with body `{"error":"not_found"}` — covered by a unit test.
- AC-3: Every response sets `Cache-Control: private, max-age=60`.
