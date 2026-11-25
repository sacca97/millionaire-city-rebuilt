# Project status

Last updated 2026-11-25 on `main`. This is the authoritative status; the status paragraphs in older documents
(`rust-server-plan.md`, `parity-plan.md`, `perf-review.md`, ...) are kept as the history of how the work got here.

## What the project is

- `apps/server-rs`: `mcity-server`, the Rust game server (axum + rusqlite). It replaces the deleted TypeScript
  server with the same routes, env vars, SQLite schema and response bytes.
- `apps/client`: the TypeScript/PixiJS web client, including the first-session tutorial, missions, shop, collectibles,
  friends/investments and the original protocol (`POST /Game`, XML envelope with CDATA JSON).
- `apps/desktop`: Tauri 2 shell with the server embedded in-process (system web view; no Flash, no Electron).
- `tools/oracle`: the original Flash client (Electron 10 + Pepper Flash), kept only as a parity oracle and never shipped.

There is no Rust client rewrite; the client is intentionally TypeScript. See `MODERNIZATION_PLAN.md` for the
Rust-server/client-engine decision record.

## Verified on this tree

All of these run headless (terminal, jsdom or headless Chromium only):

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Client tests (`npm run test -w @mcity/client`) | 1,201 passed (34 files), including the real-server integration tests |
| Rules tests (`npm run test -w @mcity/rules`) | 15 passed |
| Rust tests (`cargo test` in `apps/server-rs`) | 60 passed |
| Black-box conformance (`make conformance`) | 209/209 passed (15 files) |
| Mission status (`python3 tools/missions/mark.py`) | MATCH 274, MATCH (oracle) 39, STATIC 5, TODO 0 |
| Oracle end-to-end (`docs/rust-server-e2e.md`) | only volatile differences (timestamps, random daily reward, client timer jitter) |

Binary paths are resolved through `tools/server-binary.mjs` (`cargo metadata`), so `CARGO_TARGET_DIR` and a
global cargo `build.target-dir` work for `make`, `run.sh`, conformance, the client integration tests and the oracle.

## Recently completed (previously listed as open)

- First-session tutorial: splash, boss selection and steps 0-9 are implemented in `apps/client/src/game/tutorial.ts`
  and `apps/client/src/ui/tutorial/`. `?skipTutorial` remains the development shortcut.
- Shop paging is virtualised (current page +/-1); it no longer builds every card of every tab.
- Renderer resolution is capped, the ticker drops to 30 fps when idle, `/assets/*` is cached immutable, and the
  unused per-item construction `Graphics` is no longer allocated.
- Offline NPC friends (Ronald/Cindy/Sheik), visits, upgrades and investments are served by the Rust backend;
  no Facebook is required.

## Open items

### Gameplay and parity

- **C26 instant build**: after an instant build the original keeps the item in construction (mode 4, full remaining
  time) and sends no `new_state` within 9+ s; ours finishes it. Documented difference, see `docs/parity-plan.md`
  Round 9.
- **C20-55**: five payload differences (first `new_state` company value 842,000 vs 872,000, one `next_rent`).
- **C08-96 (alt set)**: after a reload the original re-sends level-gated `update_missions` 97..103; cause unknown.
  The class is matched through mission-C08-6.
- **F5 Up/list ordering**: the locked-mission preview compares `unlockSku` numerically, while the original compares
  the string. Re-verify the Up list against a loaded save before changing it (`docs/audit-original-mismatches.md` F5).
- **F6 offer removal**: featured membership now includes offers/free items, but the original also removes an item
  from Featured when its offer disappears; there is no offer-removal signal in our state.
- **Visual parity**: `normal` animation frame labels are not mapped per state; `Effect_*` overlays, the rival hover
  box/buying bar, and parts of the investments/expansion flows are not compared yet (`docs/visual-parity.md`).
- **Timings**: construction-end is now derived from the SWF (42 frames at 30 fps = 1.4 s). `GIVING_RENT_MS` stays
  20 s because the oracle still showed mode 6 after 10+ s, although the SWF animation is 2.67 s.

### Server

- Money, prices and placement are applied from the client's security snapshot; the server does not recompute them
  (fine for the offline single-player case, a prerequisite for any network play).
- `getSellPrice`, wonder `incomeMultiplier`/`npcIncome` and visitor help effects remain unverified/absent.

### Performance

Measured opportunities still open from `docs/perf-review.md`:

- ground overdraw: the opaque backdrop plus terrain/road tiles draw roughly 3.5x the screen;
- asset atlases: ~1,074 boot requests and many unique textures.

A 5-minute headless idle soak is now automated with `tools/perf/soak.mjs`. On the post-tutorial starter save the JS heap
sawtoothed between 10.6 and 17.7 MB (GC drops, no upward trend), DOM nodes settled at 1,992 and item views stayed at 65.
The stress-city soak from `docs/perf-review.md` (445 items) has not been repeated.

### Packaging

- Only Linux has been run by hand; Windows and macOS installers are built by the manual GitHub workflow but not
  smoke-tested. Builds are not code-signed.

## Where to look

- `docs/rust-server-plan.md`: server porting history and module map.
- `docs/rust-server-e2e.md`, `docs/rust-server-friends.md`, `docs/rust-server-performance.md`: server evidence.
- `docs/parity-audit.md`, `docs/save-parity.md`, `docs/missions-status.md`: gameplay parity.
- `docs/visual-parity.md`, `docs/tutorial-parity.md`: GUI/tutorial comparisons.
- `docs/audit-original-mismatches.md`, `docs/client-logic-spec.md`, `docs/feature-inventory.md`: client logic.
- `docs/perf-review.md`, `docs/performance.md`: performance measurements.
