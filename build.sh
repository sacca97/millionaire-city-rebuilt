#!/usr/bin/env bash
# Install dependencies and build the client (Node 20+ required).
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node 20+ is required"; exit 1; }
npm ci --workspace @mcity/shared --workspace @mcity/rules --workspace @mcity/server --workspace @mcity/client --include-workspace-root
npm run build:client
echo "Build done. Start with ./run.sh"
