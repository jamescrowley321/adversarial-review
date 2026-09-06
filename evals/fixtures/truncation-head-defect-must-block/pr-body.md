Surfaces the audit trail on the document detail response so the compliance
view can render who touched a document and when.

## Acceptance criteria

1. `GET /api/documents/:id` accepts an `audit=1` query parameter and includes
   the audit trail in the rendered payload when it is set.
2. The document list keeps working while a query is in flight and does not set
   state after the effect is torn down.
3. The reindex worker pages through documents in `updated_at` order.
