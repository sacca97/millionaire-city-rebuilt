#!/usr/bin/env bash
# Pack everything needed to build and run the rewrite on another machine.
# Usage: tools/make-bundle.sh [output.zip] [--with-opt]
#   --small     ship the optimised assets (public-opt, ~270 MB) AS apps/client/public instead of the originals (~540 MB): about half the size
#   --with-opt  also include apps/client/public-opt next to the originals
# Excluded: node_modules, git data, generated/, decompiled/, tmp/, archive-*, the original zip, build output, oracle output,
# databases, the Flash runtime binaries of apps/desktop (not needed to run the rewrite).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="mcity-rewrite-bundle.zip"
WITH_OPT=0
SMALL=0
for a in "$@"; do
  case "$a" in
    --with-opt) WITH_OPT=1 ;;
    --small) SMALL=1 ;;
    *) OUT="$a" ;;
  esac
done
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT_ABS"

PATHS=(
  build.sh run.sh package.json package-lock.json tsconfig.base.json LICENSE NOTICE.md README.md
  scripts packages apps/server apps/client assets docs tools
  apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/src
)
EXCLUDES=(
  '*/node_modules/*' '*/dist/*' '*.sqlite' '*.sqlite-shm' '*.sqlite-wal' '*.tsbuildinfo'
  'tools/oracle/out/*' 'apps/client/public-bak/*' '*/__pycache__/*' '*.pyc'
)
[ "$WITH_OPT" = 1 ] || EXCLUDES+=('apps/client/public-opt/*')

if [ "$SMALL" = 1 ]; then
  [ -d apps/client/public-opt ] || { echo "apps/client/public-opt missing (run tools/optimize_assets.py)"; exit 1; }
  STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
  for p in "${PATHS[@]}"; do mkdir -p "$STAGE/$(dirname "$p")"; ln -s "$PWD/$p" "$STAGE/$p" 2>/dev/null || true; done
  rm -f "$STAGE/apps/client"; mkdir -p "$STAGE/apps/client"
  for e in apps/client/* apps/client/.[!.]*; do [ -e "$e" ] || continue; case "$e" in apps/client/public|apps/client/public-opt|apps/client/public-bak|apps/client/node_modules|apps/client/dist) ;; *) ln -s "$PWD/$e" "$STAGE/$e" ;; esac; done
  ln -s "$PWD/apps/client/public-opt" "$STAGE/apps/client/public"
  (cd "$STAGE" && zip -qr "$OUT_ABS" "${PATHS[@]}" -x "${EXCLUDES[@]}")
elif command -v zip >/dev/null 2>&1; then
  zip -qr "$OUT_ABS" "${PATHS[@]}" -x "${EXCLUDES[@]}"
else
  OUT_ABS="${OUT_ABS%.zip}.tar.gz"
  TAR_EX=(); for e in "${EXCLUDES[@]}"; do TAR_EX+=(--exclude="${e%/\*}" --exclude="$e"); done
  tar czf "$OUT_ABS" "${TAR_EX[@]}" "${PATHS[@]}"
fi
echo "bundle: $OUT_ABS ($(du -h "$OUT_ABS" | cut -f1))"
cat <<'MSG'

On the other machine (Node 20+ or 22):
  unzip mcity-rewrite-bundle.zip -d millionaire-city-rebuilt && cd millionaire-city-rebuilt
  ./build.sh
  ./run.sh
  open http://127.0.0.1:31803/
MSG
