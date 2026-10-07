#!/usr/bin/env bash
# Rerun OUR client for classes whose ORIGINAL run was preserved, then verify (original outputs are not rerun).
# Usage: CLIENT_DIST=/path/to/built/client CHROME=/path/to/chromium PORT=31863 tools/missions/rerun_ours.sh C16:36 C31:1 ...
# Each arg is <CLASS>:<REP sku>. The preserved original is /tmp/solo-<CLASS>-evidence/orig* (first match, preferring orig-<REP>).
# Output of ours: $OUTROOT/ours-<CLASS>-<REP> (default /tmp/ours-rerun). Evidence: tools/missions/evidence/mission-<CLASS>-<REP>.json
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${CLIENT_DIST:?set CLIENT_DIST}" "${CHROME:?set CHROME}"
PORT="${PORT:-31863}"; OUTROOT="${OUTROOT:-/tmp/ours-rerun}"; mkdir -p "$OUTROOT"
for spec in "$@"; do
  C="${spec%%:*}"; R="${spec##*:}"; FLOW="mission-$C-$R"
  ORIG="$(ls -d /tmp/solo-$C-evidence/orig-$R /tmp/solo-$C-evidence/orig 2>/dev/null | head -1)"
  if [ -z "$ORIG" ]; then echo "$FLOW: no preserved original run"; continue; fi
  OUT="$OUTROOT/ours-$C-$R"; rm -rf "$OUT"
  echo "== $FLOW (orig $ORIG)"
  CHROME="$CHROME" MCITY_CLIENT_DIST="$CLIENT_DIST" OUT="$OUT" PORT="$PORT" PREVIEW="http://127.0.0.1:$PORT/" \
    node tools/oracle/ours-flow.mjs "$FLOW" > "$OUTROOT/$FLOW.log" 2>&1 || echo "ours run exited non-zero (see $OUTROOT/$FLOW.log)"
  python3 tools/missions/verify.py --flow "$FLOW" --skus "$R" --class "$C" --reward-group 0 --reload --orig "$ORIG" --ours "$OUT" | head -30
done
