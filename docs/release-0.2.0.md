# 0.2.0 — Rust server, Tauri desktop

This release replaces the TypeScript game server with the Rust server (`apps/server-rs`, `mcity-server`) and the
Electron launcher with a Tauri 2 app that embeds the server in-process. The game client remains TypeScript/PixiJS.

## Highlights

- **Rust server**: same routes, env vars, response bytes and SQLite schema as the old server; database files are
  interchangeable. Includes save seeding, patched rules XML, HTTPS, the Facebook stand-in, the launcher page and the
  local API.
- **Offline NPC friends**: Ronald, Cindy and Sheik are served by our own backend (friends bar, visits, upgrades,
  investments); no Facebook account is used.
- **Tauri desktop app**: one binary, system web view, server embedded in-process on a free local port; same save
  location as the Electron app (`<config dir>/millionaire-city-app/data/mcity.sqlite`).
- **Client parity work**: first-session tutorial, missions, shop, collectibles, friends/investments, vector roads and
  the GUI parity fixes recorded in `docs/parity-audit.md`, `docs/save-parity.md` and `docs/visual-parity.md`.
- **Performance**: one SQLite transaction per request, document write-through cache, LTO release build, capped
  renderer resolution, adaptive idle frame rate, virtualised shop pages and immutable asset caching. See
  `docs/rust-server-performance.md` and `docs/perf-review.md`.

## Verification

- Client tests: 1,201 passed (34 files)
- Rules tests: 15 passed
- Rust tests: 60 passed
- Black-box conformance: 209/209 passed
- Mission status: MATCH 274, MATCH (oracle) 39, STATIC 5, TODO 0

## Upgrading and saves

Portable builds need no installer. Existing saves keep working; the server reads the same SQLite format. Do not run a
portable build and a development server against the same save at the same time.

## Known limitations

- The original Flash client is not shipped; it remains only in `tools/oracle` for parity checks.
- Single-player/offline: no real friends, Facebook features or server-side price validation.
- Only Linux has been smoke-tested; Windows and macOS installers are built by the manual workflow, not code-signed.
- Remaining parity differences are listed in `docs/status.md`.
