# Rust server rewrite

**Status (wave 3 done):** the Rust server is the only server. `apps/server` (TypeScript) was deleted; it stays in git history (last commit that contains it). `make run/dev`, `run.sh`, the desktop app, `tools/app`, CI and the oracle harness use the Rust binary. The conformance suite moved to `tools/conformance` (`make conformance`, 209/209, no Rust-only gating). `apps/server-rs/data/*.json` are the source of truth for the fixed save data (the export script is gone). `apps/server/assets` moved to `apps/server-rs/assets`. Everything below is the historical plan; paths `apps/server/...` refer to git history.

Goal: replace the Node/TypeScript server (`apps/server`) with a Rust server that behaves identically, so both the original Flash
client (parity harness `tools/oracle/`) and the TS client (`apps/client`, stays TypeScript) work unchanged. The TS server remains
the reference until the Rust server passes the whole conformance suite; then the desktop app switches to the Rust binary.

## Fixed decisions (all agents follow these)

- Location: `apps/server-rs/`, one Cargo package `mcity-server`, binary `mcity-server`. `target/` is gitignored.
- Same external contract as the TS server: same env vars (`apps/server/src/config.ts`: `MCITY_HTTP_PORT`, `MCITY_HTTPS_PORT`,
  `MCITY_FACEBOOK_PORT`, `MCITY_DB_PATH`, `MCITY_UID`, `MCITY_LANG`, `MCITY_DISABLE_FB_SHIM`, `MCITY_REQUIRE_FB_SHIM`,
  `MCITY_LAUNCH_SECRET`, `MCITY_CLIENT_DIST`, and the `MCITY_SWF_DEBUG` / `MCITY_USE_CLIMATE` / `MCITY_OLD_ITEM_DESIGNS` launcher
  flags), same defaults, same routes, same response bytes/JSON shapes, same log-relevant behaviour.
- Same SQLite schema and document encoding as `apps/server/src/database.ts` / `repository.ts`: a database file written by one server
  must be readable by the other. No schema changes.
- Crates: `axum` + `tokio`; `rusqlite` with the `bundled` feature (no system SQLite); `rustls` + `rcgen` for the HTTPS listeners and
  the Facebook stand-in certificate; `serde` / `serde_json` (keep key order where the TS output relies on insertion order:
  `serde_json` with `preserve_order`); `quick-xml` if XML parsing is needed. Add others only when clearly necessary.
- Fixed save data (`apps/server/src/saveDefaults/*`: tutorial save, Ronald/Sheik layouts, starter, neighbors, timers, ...) is
  exported from the TS sources to JSON in `apps/server-rs/data/` by `apps/server/src/scripts/exportDefaults.ts`, and the Rust
  server embeds it with `include_str!`. Logic in those files is ported; pure data is not retyped by hand.
- Proof of equivalence: the black-box conformance suite in `apps/server/conformance/` (vitest). It starts the server under test as a
  child process from `MCITY_SERVER_CMD` (default: the TS server), on free ports and a temp database, talks to it only over HTTP(S),
  and inspects or seeds state only through the SQLite file (`better-sqlite3`, server stopped while seeding if the server caches).
  Every behaviour covered by `apps/server/test/*.test.ts` gets a conformance test. A Rust module is done when its conformance
  tests pass against both servers.
- Every Rust function ported from TS cites the TS source (`commandHandlers.ts:<line>`); where the TS cites the Java
  (`GamePlay.java:<line>`), keep that citation too.

## Waves

1. (in parallel) scaffold + HTTP surface + repository + `/Game` dispatch skeleton (Sonnet); conformance suite against the TS server
   (Sonnet); saveDefaults data export (Haiku).
2. Command packages, one agent each, listed in the "Porting packages" section below (written by the scaffold agent): ported until
   their conformance tests pass against the Rust binary.
3. Full suite green on both; oracle smoke runs through the Rust server; desktop app switched; TS server removed.

## Porting packages

> **Historical tables.** The per-module "Status" columns below record the wave-1/wave-2 plan; every `todo`/`stub` row has
> since been implemented (all `cmdList` commands, `save_defaults.rs` seeding, `get_world`, NPC friends). See
> `docs/status.md` for the current state and test counts, and `docs/rust-server-e2e.md` for the end-to-end evidence.

Status of the scaffold (wave 1): everything outside the command handlers is ported and verified byte-for-byte against the TS
server (see "Scaffold verification" below). Layout of `apps/server-rs/` (`cargo build`, `cargo test`; binary `mcity-server`):

| Rust file | Ports | Status |
|---|---|---|
| `src/config.rs` | `config.ts` | done |
| `src/database.rs`, `src/repository.rs` | `database.ts`, `repository.ts` (same schema/encoding; compat test `src/compat_tests.rs` runs the TS repository through `npx tsx`) | done, except seeding (see `save_defaults.rs`) |
| `src/save_tree.rs`, `src/encoding.rs` | `saveTree.ts`, `commandHandlers/encoding.ts` | done |
| `src/rules.rs` | `rules.ts` | done |
| `src/protocol.rs` | `packages/shared/src/protocol.ts` (envelope, `chk`, command-list decoding) | done |
| `src/server_app.rs`, `src/http.rs` | `serverApp.ts` routing/start/stop, Express-like helpers (sendFile/ETag/Range, static, 404/redirect pages) | done |
| `src/assets.rs` | `serverApp.ts` rules-XML patching, case-insensitive assets, fallbacks, static | done |
| `src/local_api.rs` | `serverApp.ts` `/local/*`, profile picture, VIP e-mail flag | done |
| `src/launcher.rs`, `templates/launcher.html` | `launcherHtml.ts` (template generated from the TS function with sentinels; output byte-identical) | done |
| `src/facebook_shim.rs`, `src/tls.rs` | `facebookShim.ts`, self-signed certs (rcgen) | done |
| `src/client_static.rs` | `clientStatic.ts` | done (not exercised: `apps/client/dist/index.html` absent in the checkout) |
| `src/game.rs` | `/Game` handler: login, payments, signature log, envelope, per-command error fallback | done |
| `src/commands/mod.rs` | `CommandService.handleCommand` dispatch table (`ALL_TABLES`, one `COMMANDS` table per package module) | done |
| `src/save_defaults.rs` | `saveDefaults.ts`, `saveDefaults/*` | **skeleton**: `create_fresh_save_bundle` returns Err until `data/` is complete; `normalize_*_tutorial_universe` are no-ops. The Rust server therefore works on DBs created by the TS server but cannot seed a fresh save yet (package "world") |

### Dispatch contract (all command packages)

- A command handler is `fn(&CommandService, user_id, &Value /* {_cmd,_dat} */) -> Result<Vec<Value>, String>`; register it with one row
  in the `COMMANDS` table of the package's own module. `Err`/panic becomes the TS `offlineError` response automatically.
- Build responses with `protocol::packet(cmd, dat, Some(sync))` (key order `_cmd,_dat,_sync` matters). Sync: `svc.sync(user_id)`;
  mutations call `svc.repository.increment_session_sync(user_id)` exactly where the TS does.
- Documents are `serde_json::Value` (`preserve_order`). `svc.repository.get_document / set_document / get_meta / set_meta`.
- Commands with no row log `unported command <name>` and answer `{success:"true",ignored:"1"}` (what the TS answers for a command it
  does not know).
- Every function cites its TS source (`commandHandlers.ts:<line>`) and the Java citation the TS carries.

### Every `cmdList` command (TS = `apps/server/src/commandHandlers.ts` unless noted)

| Command | TS (dispatch -> implementation) | Rust module | Status | Package |
|---|---|---|---|---|
| `ping`, `empty` | :161 | `commands/reads.rs` | done | - |
| `get_customizer_info` | :248 | `reads.rs` | done | - |
| `get_friends_list` | :250 | `reads.rs` | done | - |
| `get_neighbor_list` | :252 | `reads.rs` | done | - |
| `get_neighbor_info` | :254 | `reads.rs` | done | - |
| `get_help_building_list` | :258 | `reads.rs` | done | - |
| `get_unlocked_items_list` | :262 | `reads.rs` | done | - |
| `get_limited_edition_items_list` | :264 | `reads.rs` | done | - |
| `get_storage_list` | :266 | `reads.rs` | done | - |
| `get_partners_list` | :283 | `reads.rs` | done | - |
| `get_game_config` | :292 | `reads.rs` | done | - |
| `get_welcome_progress` | :285 | `reads.rs` | done | - |
| `load_success` | :294 | `reads.rs` | done | - |
| `get_world` | :216-246 (+ `createNeighborUniverse`, `persistExpiredServices` :525, `projectServiceTimes`, collectible projection) | `commands/world.rs` | todo (stub) | P6 |
| `get_upgrades_list` | :260 -> `buildUpgradesListDocument` :595 | `commands/offline.rs` | todo (stub) | P3 |
| `add_upgrade_item` | :163/:543 -> `applyUpgradeCommand` :628 | `offline.rs` | todo | P3 |
| `get_daily_rewards_info` | :272 | `offline.rs` | todo | P3 |
| `update_daily_reward` | :328 -> `applyDailyRewardMutation` :476 | `offline.rs` | todo | P3 |
| `get_investments_list` | :290 -> `getInvestmentsDocument` :465 | `offline.rs` | todo | P3 |
| `invest_on_friend`, `invest_on_friend_reminder`, `invest_get_inversion`, `invest_cancel`, `invest_results` | :356 `handleNoopCommand` -> `handleInvestCommand` :380 | `offline.rs` | todo | P3 |
| `ask_for_help`, `ask_for_cash`, `postReward` | :356-376 | `offline.rs` | todo | P3 |
| `update_missions` | :322 -> `applyMissionsMutation` :1511 | `offline.rs` | todo | P3 |
| `update_pollmanager` | :325 -> `applyPollManagerMutation` :1569 | `offline.rs` | todo | P3 |
| `update_profile` | :307 -> `applyProfileMutation` :689 (+ `applyGameConfigProfileMutation` :788, `restart_tutorial` action :772) | `commands/profile_money.rs` | todo (stub) | P2 |
| `update_money` | :310 -> `applyMoneyMutation` :804, `applyMoneyAction` :861, `applyRentAccelerator` :971 | `profile_money.rs` | todo | P2 |
| `update_item` | :313 -> `applyItemMutation` :1253 (+ `rollDoubleRent` :132, `applyItemStorageEffects` :1403, `applyUpgradeAppliedEffect` :1425, collectible hooks :1171-1250) | `commands/items_map.rs` | todo (stub) | P4 |
| `update_map` | :316 -> `applyMapMutation` :1438 | `items_map.rs` | todo | P4 |
| `update_plots` | :319 -> `applyPlotsMutation` :1482 | `items_map.rs` | todo | P4 |
| `update_next_rent` | :334 -> `applyNextRentMutation` :514 | `items_map.rs` | todo | P4 |
| `get_collectibles_list` | :268 -> `getNormalizedCollectiblesDocument` :990 | `commands/collectibles.rs` | todo (stub) | P5 |
| `get_friends_collectible_sents_list` | :270 -> `getNormalizedCollectiblePendingDocument` :998 | `collectibles.rs` | todo | P5 |
| `ask_collectible`, `update_collectible` | :167 -> `handleCollectibleCommand` :553 (actions KEEP/BUY/SELL/GET_REWARD/SEND :563-575; `applyCollectible*Mutation` :1006-1195) | `collectibles.rs` | todo | P5 |
| unknown command | :186 -> `{success:"true",ignored:"1"}` | `commands/mod.rs` | done (logs `unported command`) | - |

Mutation commands (`MUTATION_COMMANDS`, :303-354) share the envelope step: apply, `incrementSessionSync`, answer `[echo of payload, ...sideEffects]`
(`update_daily_reward` refused claim answers `{success:"false"}` without bumping sync). Whoever ports the first mutation command
writes that shared wrapper in their own module; the other mutation packages copy the 10-line pattern (do not edit `mod.rs`).

### Library modules the commands call (pure functions, no routing)

| Rust module | Ports | Used by |
|---|---|---|
| `commands/universe.rs` | `commandHandlers/universe.ts` (295 lines; `MutableNode` = `serde_json::Value`/`Map`) | P2, P3, P4, P5, P6 |
| `commands/state.rs` | `commandHandlers/state.ts` (99) | P4 |
| `commands/plots.rs` | `commandHandlers/plots.ts` (38) | P4 |
| `commands/upgrades.rs` | `commandHandlers/upgrades.ts` (47) | P3, P6 |
| `commands/money.rs` | `commandHandlers/money.ts` (226) | P2, P4, P5 |
| `commands/offline_lib.rs` | `commandHandlers/offline.ts` (445) | P2, P3, P4, P6 |
| `commands/collectibles_lib.rs` | `commandHandlers/collectibles.ts` (618) | P4, P5, P6 |

### HTTP routes (all done, all in `src/server_app.rs` unless noted; matching is case-insensitive, one trailing slash tolerated)

| Route | TS | Rust |
|---|---|---|
| request logging `[http] METHOD url` (not for /health) | serverApp.ts:122 | `server_app.rs::entry` |
| `GET /health` (+ HMAC proof when `MCITY_LAUNCH_SECRET`) | :131 | `health` |
| `ALL /event/track` | :148 | `dispatch` |
| `GET/POST /local/profile`, `GET /local/resources`, `POST /local/resources/adjust`, `GET /local/profile-picture` | :152-192 | `local_api.rs` |
| `GET /launcher` | :194 | `launcher`, `launcher.rs` |
| `GET /client/Dollars.private.swf`, `GET /favicon.ico` | :225, :229 | `dispatch` |
| `/cbar/*` static (extensions htm, html, css, png) | :233 | `assets::serve_static` |
| `GET /crossdomain.xml` | :241 | `dispatch` |
| `GET /mcity/0.501/Datas/rules/TutorialHQPositions.xml` | :248 | `dispatch` |
| `GET /mcity/0.501/Datas/rules/:fileName` (patched item/collectible rules XML) | :252 | `assets::patched_rules_xml` |
| `GET .../Datas/userData/{fan.xml,giftsList.xml,checkSendMail.xml,checkMail.html}` | :265-281 | `dispatch` |
| `GET /registration/register`, `/registration/isconfirmed` (+ trailing slash) | :282, :287 | `dispatch` |
| `GET /mcity/0.501/Datas/splash.swf` | :291 | `dispatch` |
| `/mcity/0.501/*` case-insensitive asset middleware | :295, :633 | `assets::case_insensitive_asset` |
| feed / icon / commerce-type fallbacks | :297, :327, :350, :373 | `assets::{feed_fallback,asset_fallback}` |
| `/mcity/0.501/*` static (extensions swf xml txt png jpg css js) + missing-asset 404 | :396, :404 | `assets::{serve_static,missing_asset}` |
| built client static (when `MCITY_CLIENT_DIST/index.html` exists) | :411, clientStatic.ts | `client_static.rs` |
| `POST /Game` | :414 | `game.rs` |
| Facebook stand-in: `/crossdomain.xml`, `/me/friends`, `/method/friends.getAppUsers`, `/method/users.getInfo`, `/method/pages.isFan`, `/:id/picture` | facebookShim.ts:35-85 | `facebook_shim.rs` |

### Packages (parallelisable; each owns its files, nobody else edits them)

Stage 1 (libraries, no dependency between them; do first because stage 2 calls into them):

- **P1 libs-a** (Haiku, mechanical): `commands/universe.rs`, `state.rs`, `plots.rs`, `upgrades.rs`, `money.rs`. Direct ports of 5
  small TS files with unit tests per function. `MutableNode` helpers should take/return `&mut Value` / `Option<&mut Value>`.
- **P1b libs-b** (Sonnet, game logic over rules XML): `commands/offline_lib.rs`, `commands/collectibles_lib.rs`
  (offline.ts + collectibles.ts: services, storage, daily rewards, investments, missions, collectible drops/trade-in). Reads rules XML
  through `rules.rs`; unit tests with fixture documents.

Stage 2 (command handlers; start once the stage-1 function signatures exist, or stub the callee locally in the same file):

- **P2 profile-money** (Sonnet): `commands/profile_money.rs`: `update_profile`, `update_money`. Needs libs P1/P1b.
- **P3 offline-features** (Sonnet): `commands/offline.rs`: missions, poll manager, daily rewards, investments, upgrades, `invest_*`,
  `ask_for_help/cash`, `postReward`.
- **P4 items-map** (Sonnet, the most delicate: `update_item` is ~180 lines with Java parity quirks): `commands/items_map.rs`:
  `update_item`, `update_map`, `update_plots`, `update_next_rent`.
- **P5 collectibles** (Sonnet): `commands/collectibles.rs`: `get_collectibles_list`, `get_friends_collectible_sents_list`,
  `ask_collectible`, `update_collectible`.
- **P6 world** (Sonnet; needs `apps/server-rs/data/` complete, and `collectibles_lib` + `offline_lib` for the projections):
  `commands/world.rs` (`get_world`) and `src/save_defaults.rs` (fresh bundle from `data/*.json`, `createNeighborUniverse`,
  `createVisitorNeighborUniverse`, tutorial normalisation, timers), which unlocks seeding a fresh DB in Rust.

Haiku can do P1 (P1b has game logic: Sonnet). Everything else needs Sonnet-level care because of the Java-parity details cited in the TS.
The packages touch disjoint Rust files; `commands/mod.rs`, `repository.rs`, `protocol.rs` are scaffold-owned: if a package needs a new
repository helper, add it in its own module as an `impl SaveRepository` block in a separate file under `src/commands/`.

### Scaffold verification (wave 1)

Same requests sent to the TS server and to the Rust binary started on identical temp databases (ports 32110/32120, FB shim
disabled; plus a run with `MCITY_LAUNCH_SECRET` and the Facebook shim on): ~70 requests (health, event, crossdomain, all patched
rules XML, static assets and fallbacks, userData, registration, launcher incl. `?debug=1&climate=true&oldItems=yes`, all `/local/*`
including picture upload/clear, `/Game` login, cmdList of the ported reads, unknown commands, bad counts, JSON body, 404s,
trailing slash/upper-case paths, HEAD, Facebook shim endpoints). Bodies and headers (except `Date`, `ETag`, `Last-Modified`,
`X-Powered-By`) are identical; the only differences are values that are time/random by nature (login token and
`currentServerTime`, profile-picture version timestamp, HEAD with `curl -I`).

## Offline NPC friends

The friends backend (Facebook shim friends, NPC upgrades of the own city, NPC investments, page hook) is Rust-only: see `docs/rust-server-friends.md`.
