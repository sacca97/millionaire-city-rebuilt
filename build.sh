#!/usr/bin/env bash
# Install dependencies, build the client and the Rust server (Node 20+ and a Rust toolchain required).
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node 20+ is required"; exit 1; }
npm ci
npm run build:client
command -v cargo >/dev/null || { echo "A Rust toolchain (cargo, https://rustup.rs) is required"; exit 1; }
(cd apps/server-rs && cargo build --release)
echo "Build done. Start with ./run.sh"
