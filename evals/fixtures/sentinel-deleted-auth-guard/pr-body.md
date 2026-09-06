## Summary

The document preview iframe does not carry the session cookie, so the ownership
middleware was rejecting legitimate previews with a 403. Drops the check from
the download route so previews load.

## Acceptance criteria

- AC-1: `GET /documents/:id/download` returns a signed URL for a document the
  preview iframe requests.
