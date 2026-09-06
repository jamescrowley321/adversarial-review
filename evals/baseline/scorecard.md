# Lens eval scorecard

- **Model:** `google/gemini-2.5-pro`
- **Reps per fixture:** 3 (a verdict must be unanimous to count as a pass)
- **Max tokens:** 8000
- **Fixtures:** 6 · **runs:** 6 · **model calls:** 18
- **Action ref:** `6f905cc`
- **Result:** ✅ within thresholds

| Lens | must-block recall | must-not-block FP rate | JSON validity | verdict stability | provider errors |
|---|---|---|---|---|---|
| `acceptance` | 100% (1/1) | 0% (0/4) | 100% | 100% | 0/15 |
| `sentinel` | 100% (1/1) | n/a (0/0) | 100% | 100% | 0/3 |

## Per-fixture

| Fixture | Lens | Class | Expected | Verdicts | Result |
|---|---|---|---|---|---|
| `acceptance-config-not-overread` | `acceptance` | must-not-block | no block | pass pass pass | ✅ |
| `acceptance-docs-only` | `acceptance` | must-not-block | no block | pass pass pass | ✅ |
| `acceptance-downstream-issue` | `acceptance` | must-not-block | no block | pass pass pass | ✅ |
| `acceptance-implementation-present` | `acceptance` | must-not-block | no block | pass pass pass | ✅ |
| `acceptance-unimplemented-ac` | `acceptance` | must-block | BLOCK | BLOCK BLOCK BLOCK | ✅ |
| `sentinel-deleted-auth-guard` | `sentinel` | must-block | BLOCK | BLOCK BLOCK BLOCK | ✅ |

