#!/usr/bin/env bash
# Start the Rust server (serves the built client). Save file: ~/mcity.sqlite (override with MCITY_DB_PATH).
set -euo pipefail
cd "$(dirname "$0")"
[ -d apps/client/dist ] || ./build.sh
export MCITY_DB_PATH="${MCITY_DB_PATH:-$HOME/mcity.sqlite}"
export MCITY_DISABLE_FB_SHIM=1
PORT="${MCITY_HTTP_PORT:-31803}"
echo "Open http://127.0.0.1:$PORT/"
# Cargo may build outside apps/server-rs/target (CARGO_TARGET_DIR or ~/.cargo/config.toml target-dir).
BIN="$(node tools/server-binary.mjs)"
# Always ask cargo: it rebuilds only when the server sources changed.
if command -v cargo >/dev/null; then (cd apps/server-rs && cargo build --release); fi
[ -x "$BIN" ] || { echo "no server binary at $BIN and no cargo: install Rust (https://rustup.rs)"; exit 1; }
exec "$BIN"
