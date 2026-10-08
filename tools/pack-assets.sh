#!/usr/bin/env bash
# Pack the converted game art (not in git) so another checkout can run: tools/pack-assets.sh [out.zip]
# Uses apps/client/public-opt (optimised, ~270 MB) when it exists, else apps/client/public. Unpack in the other checkout's repo root:
#   unzip mcity-assets.zip        (creates apps/client/public/...)  then:  make build OPT=0 && make run
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(cd "$(dirname "${1:-mcity-assets.zip}")" && pwd)/$(basename "${1:-mcity-assets.zip}")"
SRC=apps/client/public; [ -d apps/client/public-opt ] && SRC=apps/client/public-opt
[ -d "$SRC" ] || { echo "no $SRC here: nothing to pack"; exit 1; }
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/apps/client"; ln -s "$PWD/$SRC" "$STAGE/apps/client/public"
rm -f "$OUT"; (cd "$STAGE" && zip -qr "$OUT" apps/client/public)
echo "assets: $OUT ($(du -h "$OUT" | cut -f1)) from $SRC"
