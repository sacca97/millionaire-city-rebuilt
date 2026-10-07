#!/usr/bin/env bash
# Pack everything needed to build and run the rewrite on another machine.
# Usage: tools/make-bundle.sh [output.zip] [--with-opt]
#   --with-opt  also include apps/client/public-opt (optimised assets, ~270 MB, optional)
# Excluded: node_modules, git data, generated/, decompiled/, tmp/, archive-*, the original zip, build output, oracle output,
# databases, the Flash runtime binaries of apps/desktop (not needed to run the rewrite).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="mcity-rewrite-bundle.zip"
WITH_OPT=0
for a in "$@"; do
  case "$a" in
    --with-opt) WITH_OPT=1 ;;
    *) OUT="$a" ;;
  esac
done
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT_ABS"

PATHS=(
  package.json package-lock.json tsconfig.base.json LICENSE NOTICE.md README.md
  scripts packages apps/server apps/client assets docs tools
  apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/src
)
EXCLUDES=(
  '*/node_modules/*' '*/dist/*' '*.sqlite' '*.sqlite-shm' '*.sqlite-wal' '*.tsbuildinfo'
  'tools/oracle/out/*' 'apps/client/public-bak/*' '*/__pycache__/*' '*.pyc'
)
[ "$WITH_OPT" = 1 ] || EXCLUDES+=('apps/client/public-opt/*')

if command -v zip >/dev/null 2>&1; then
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
  npm ci --workspace @mcity/shared --workspace @mcity/rules --workspace @mcity/server --workspace @mcity/client --include-workspace-root
  npm run build:client
  cd apps/server && MCITY_DB_PATH=$HOME/mcity.sqlite MCITY_DISABLE_FB_SHIM=1 npx tsx src/main.ts
  open http://127.0.0.1:31803/
MSG
