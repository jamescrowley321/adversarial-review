## Summary

New auth middleware with a path-prefix bypass (any URL starting with /public skips verification, including /public/../admin) and a hardcoded fallback JWT secret.
