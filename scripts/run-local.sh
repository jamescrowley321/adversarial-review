#!/usr/bin/env bash
# Adversarial Review — local mode.
#
# Runs the review personas against your working branch BEFORE you push, using the
# pi CLI directly (no GitHub, no PR). Each lens reads the branch diff and writes
# its findings to .adversarial-review/<lens>.md. Language-agnostic.
#
# Usage:
#   scripts/run-local.sh                      # all lenses vs origin/main
#   scripts/run-local.sh --base main          # diff against a different base
#   scripts/run-local.sh --lens sentinel,viper
#   PI_BIN=pi MODEL=z-ai/glm-5.2 scripts/run-local.sh
#
# Requires: git, the `pi` CLI on PATH, and a provider key in OPENROUTER_API_KEY
# (or your provider's env var). Adjust PI_INVOKE below for your pi version.

set -euo pipefail

BASE="origin/main"
LENSES="blind,edge-case,acceptance,sentinel,viper"
PI_BIN="${PI_BIN:-pi}"
PROVIDER="${PROVIDER:-openrouter}"
MODEL="${MODEL:-z-ai/glm-5.2}"
THINKING="${THINKING:-medium}"

while [ $# -gt 0 ]; do
  case "$1" in
    --base)  BASE="$2"; shift 2;;
    --lens)  LENSES="$2"; shift 2;;
    --model) MODEL="$2"; shift 2;;
    --provider) PROVIDER="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LENS_DIR="$HERE/lenses"
OUT=".adversarial-review"
mkdir -p "$OUT"

command -v "$PI_BIN" >/dev/null 2>&1 || { echo "error: '$PI_BIN' not on PATH (set PI_BIN)"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "error: git not found"; exit 1; }

# Build the diff once. Merge-base (...) so we only see this branch's changes.
git diff "$BASE"...HEAD > "$OUT/review-diff.patch" || {
  echo "error: could not diff against '$BASE' — is it fetched? (git fetch origin)"; exit 1; }
if [ ! -s "$OUT/review-diff.patch" ]; then
  echo "No changes vs $BASE — nothing to review."; exit 0
fi
echo "Diff: $(wc -l < "$OUT/review-diff.patch") lines vs $BASE"

name_of() { case "$1" in
  blind) echo "Blind Hunter";; edge-case) echo "Edge Case Hunter";;
  acceptance) echo "Acceptance Auditor";; sentinel) echo "Sentinel";;
  viper) echo "Viper";; *) echo "";; esac; }

IFS=',' read -ra KS <<< "$LENSES"
for k in "${KS[@]}"; do
  k="$(echo "$k" | tr -d '[:space:]')"; [ -z "$k" ] && continue
  LN="$(name_of "$k")"
  [ -z "$LN" ] && { echo "skip: unknown lens '$k'"; continue; }
  PERSONA="$LENS_DIR/$k.md"
  [ -f "$PERSONA" ] || { echo "skip: missing $PERSONA"; continue; }

  PROMPT_FILE="$OUT/.$k.prompt.md"
  {
    echo "LOCAL MODE: There is no pull request. The full diff to review is in the"
    echo "file \`$OUT/review-diff.patch\` (a \`git diff\`). Read that file instead of"
    echo "calling any GitHub tool. Read surrounding source files on disk to confirm"
    echo "findings. Do NOT modify any files."
    echo
    sed 's/__PR_NUMBER__/N\/A (local review)/g' "$PERSONA"
    echo
    echo "## Output (local)"
    echo "Print your findings to stdout as a markdown section beginning with"
    echo "\`## $LN\`, using the severity terms MUST FIX / SHOULD FIX / NITPICK and"
    echo "\`file:line\` references. If no findings, write \"No findings.\""
  } > "$PROMPT_FILE"

  echo "── $LN ──"
  # Adjust this line for your pi version if needed (prompt fed on stdin).
  PI_INVOKE=("$PI_BIN" --provider "$PROVIDER" --model "$MODEL" --thinking "$THINKING")
  if "${PI_INVOKE[@]}" < "$PROMPT_FILE" > "$OUT/$k.md" 2> "$OUT/$k.err"; then
    echo "  → $OUT/$k.md"
  else
    echo "  ! failed (see $OUT/$k.err)"
  fi
done

echo
echo "Done. Findings in $OUT/. Review MUST FIX items before pushing."
