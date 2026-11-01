#!/usr/bin/env bash
# Start the Rust server (serves the built client). Save file: ~/mcity.sqlite (override with MCITY_DB_PATH).
set -euo pipefail
cd "$(dirname "$0")"
[ -d apps/client/dist ] || ./build.sh
export MCITY_DB_PATH="${MCITY_DB_PATH:-$HOME/mcity.sqlite}"
export MCITY_DISABLE_FB_SHIM=1
PORT="${MCITY_HTTP_PORT:-31803}"
echo "Open http://127.0.0.1:$PORT/"
BIN=apps/server-rs/target/release/mcity-server
[ -x "$BIN" ] || (cd apps/server-rs && cargo build --release)
exec "$BIN"
