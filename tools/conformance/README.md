# Black-box conformance suite for the Millionaire City server

Proves that the server behaves like the original TypeScript reference server (deleted from the tree, still in git history: the last
commit that contains `apps/server`). It starts the server under test as a **child process**, talks to it only over **HTTP(S)**, and
reads or seeds state only through the **SQLite file**. Nothing from the server source is imported. The server under test is the Rust
server (`apps/server-rs`, binary `mcity-server`); all tests, including the NPC friends ones, run by default.

## Running

```sh
make server        # cargo build --release in apps/server-rs (once, and after server changes)
make conformance   # the whole suite against the release binary (path resolved through tools/server-binary.mjs)
# a single file / test name filter
npm run conformance -w @mcity/conformance -- offline
# against another binary or command (any shell command that starts the server, configured only through the env vars of
# docs/rust-server-plan.md: MCITY_HTTP_PORT, MCITY_HTTPS_PORT, MCITY_FACEBOOK_PORT, MCITY_DB_PATH, MCITY_CLIENT_DIST, ...)
MCITY_SERVER_CMD="$(node tools/server-binary.mjs --debug)" npm run conformance -w @mcity/conformance
```

The command is run as `sh -c "exec $MCITY_SERVER_CMD"` (so it cannot start with `VAR=value`, put variables in the environment).

Environment knobs of the suite itself:

| variable | meaning |
| --- | --- |
| `MCITY_SERVER_CMD` | shell command that starts the server under test (default: the release binary resolved by `tools/server-binary.mjs`) |
| `MCITY_SERVER_CWD` | working directory of that command (default: the repository root) |
| `CONF_LIVE_SEED=1` | seed the database while the server keeps running instead of stop/write/start (only valid for servers that read the DB on every request; the Rust server caches, so do not use it) |
| `CONF_WORKERS` | number of test files running in parallel (default 6; each server uses 3 ports of 32200-32399) |
| `CONF_RECORD=1` | re-record `fixtures/routes.golden.json` (one file at a time: `-- routes`, then `-- facebookShim`); only for an intended behaviour change |

## How the harness works (`lib/`)

* `lib/server.ts` `ServerHandle`: creates a fresh temp dir `/tmp/conf-XXXXXX` (DB at `save.sqlite`), reserves three free ports in
  32200-32399 (atomic lock dirs `/tmp/conf-port-N`, plus a bind test), spawns the command with `detached: true` (own process group)
  and env `MCITY_HTTP_PORT / MCITY_HTTPS_PORT / MCITY_FACEBOOK_PORT / MCITY_DB_PATH / MCITY_CLIENT_DIST`
  (all other `MCITY_*` of the caller's shell are removed). The Facebook stand-in is enabled unless a test sets `noFacebookShim`.
  It waits for `GET /health` (200, or 400 when a launch secret is set), failing fast if the process exits.
  `stop()` sends SIGTERM to the **process group it started**, SIGKILL after 4 s; `cleanup()` also removes the temp dir and the
  port locks, and runs from `afterEach` (`cleanupServersAfterEach()`) or `afterAll` (`sharedServer()`), also when the test failed.
  A `process.on("exit")` hook kills any group still registered. `lib/globalSetup.ts` removes stale `/tmp/conf-*` older than 15 min.
* `lib/client.ts` `GameClient`: the real `/Game` wire protocol. `login()` (form `uid, cmd=login, version, data, flash_version`),
  signed `cmdList` requests (`sig = md5(sorted "k=v&..." + token + "Host4h")`, `data = {_cmdList:[{_cmd,_dat,_cnt}], _msgCount, _sync}`),
  envelope parsing (`<Response><data><chk/><commands><![CDATA[{list,_msgCount,_sync}]]>`, `chk` validated).
  `send(cmd, dat)` returns the first answer's `_dat` (what `CommandService.handleCommand(...)[0]._dat` was in the old tests).
* `lib/db.ts` `SaveDb`: `better-sqlite3` on the file (`users`, `sessions`, `save_documents(user_id, tag, json, updated_at)`,
  `meta`). `doc(tag)`, `setDoc`, `editDoc`, `editUniverse(({profile, mine, rival, worldContainer}) => ...)`, `meta`, `session`.
* `lib/saves.ts`, `lib/rules.ts`, `lib/collectibles.ts`, `lib/util.ts`, `lib/golden.ts`, `lib/http.ts`: save-item builders,
  rule-data readers (served by the server itself), the deterministic collectible roll, golden-response checks, HTTPS helpers.
* `fixtures/golden.json`: a few facts the old tests imported from `src/saveDefaults` (starter decoration skus, Ronald layout size...);
  It is static now (the generator needed the TS sources). `fixtures/routes.golden.json`: status, content-type/cache
  headers and sha256 of the body of ~75 routes, recorded from the original TS server.

### Seeding pattern (important for servers that cache documents)

State is **read** at any time with `server.doc(tag)`, `server.profile()`, `server.ctx()`, `server.meta(key)` or `server.readDb(fn)`
(read-only connection, safe while the server runs).
State is **written** only with the server **stopped**:

```ts
const s = await startServer();                 // fresh DB, server running, default save created by the server itself
await s.seed((db) => db.editUniverse(({ profile, mine }) => { profile.tutorialEnd = "1"; mine.Company.push(item); }));
// ^ stop -> write through SQLite -> start (the new process loads the seeded rows)
await s.restartWith((db) => ...);              // same, but explicit: use when the test is about startup normalisation/migration
await s.restart();                             // stop -> start without writing (persistence across a restart)
```

With `CONF_LIVE_SEED=1`, `seed()` writes while the server runs (the TS server re-reads the DB per request); `restartWith()` and
`restart()` always restart. Because a seed restarts the server, a seeded **incomplete tutorial** save with houses/commerce is reset by
the startup check (as in the original); tests that need houses first send `update_profile tutorial_completed`, or seed
`profile.tutorialEnd = "1"` (as the original tests do).
Time-dependent behaviour is tested by seeding stored timestamps (`savedAt`, `dailyRewardsLastGivenDate`, `startedAt`, ...) relative to
`Date.now()`; nothing sleeps more than a few ms.

## Files

| file | content |
| --- | --- |
| `clientStatic.conf.test.ts` | port of `clientStatic.test.ts` (server started with `MCITY_CLIENT_DIST` = temp dir with the fixture files) |
| `parity.conf.test.ts` | port of `parity.test.ts` (golden numbers through commands, `/local/resources`, the collectible roll threshold) |
| `offline.conf.test.ts` | port of `offline.test.ts` |
| `server.startup.conf.test.ts` | startup, listeners, launch secret, certificates, login + starter documents |
| `server.npc.conf.test.ts` | NPC neighbour worlds and visitor upgrades |
| `server.persistence.conf.test.ts` | save mutations persisted across restarts |
| `server.houses.conf.test.ts`, `server.rivals.conf.test.ts` | house rent timers, rival properties, tutorial bungalow, construction timers |
| `server.missions.conf.test.ts`, `server.tutorial.conf.test.ts` | mission reconciliation, tutorial reset/repair |
| `server.collectibles.conf.test.ts` | house collectible awards and claims |
| `server.misc.conf.test.ts` | archived assets, rule patching, VIP club, signature, payments, launcher page, `/local/*` |
| `routes.conf.test.ts` (new) | every route of `serverApp.ts`: golden status/headers/body hash, `/local/*` validation, `/Game` protocol edge cases |
| `friends.conf.test.ts` (new, ) | offline NPC friends (Facebook shim friends, own-city NPC upgrades, `/local/npc-invest`, page hook); runs by default; see docs/rust-server-friends.md |
| `facebookShim.conf.test.ts` (new) | all Facebook stand-in endpoints, name/picture following the local profile, enable/disable switches |

## Coverage: original test -> conformance test

All 114 vitest cases of the four original files (4 + 15 + 25 + 70) have a conformance counterpart; none is skipped. Tests marked
`archivedAssetTest` in the original are skipped here too when the archived game data is missing from `assets/`.

| original file | original test | conformance file |
| --- | --- | --- |
| clientStatic.test.ts | hashed assets are immutable and precompressed (br preferred) | clientStatic.conf.test.ts |
| clientStatic.test.ts | json without precompressed file is gzipped on the fly, with ETag and 304 | clientStatic.conf.test.ts |
| clientStatic.test.ts | identity when the client does not accept compression; index.html no-cache | clientStatic.conf.test.ts |
| clientStatic.test.ts | png URL is answered from the webp sibling | clientStatic.conf.test.ts |
| parity.test.ts | exchange: Settings.smCashToCoins = 60000 (SecurityNormal.java:85) | parity.conf.test.ts |
| parity.test.ts | dailyBonusDone coins = dailyBonus*4 = 20000 (SecurityNormal.java:91) | parity.conf.test.ts (title extended: "... and the bonus timer is 24h") |
| parity.test.ts | chance table has 11 income-time rows, max 20.8333% at 24h | parity.conf.test.ts |
| parity.test.ts | daily reward groups cycle 1..5 (DailyRewardsRules.java:46) | parity.conf.test.ts |
| parity.test.ts | level %i starts at xp %i (XPTable) | parity.conf.test.ts |
| parity.test.ts | collectible drop chance contract %s = %f (CollectiblesRules.java:182, chances table) | parity.conf.test.ts |
| offline.test.ts | update_money unlockItem fills the unlocked list once | offline.conf.test.ts |
| offline.test.ts | exchange applies cashToCoins when no snapshot is supplied and applies the reported gain otherwise | offline.conf.test.ts |
| offline.test.ts | service stores <sku>TimeOver and get_world exposes <sku>TimeLeft; expired ones are dropped | offline.conf.test.ts |
| offline.test.ts | openBox consumes the box and stores move/item prizes; rentAccelerator consumes an accelerator and flags the house | offline.conf.test.ts |
| offline.test.ts | daily reward progress follows the original streak rules | offline.conf.test.ts |
| offline.test.ts | daily reward claim is once per day, granted the next day (GamePlay.java:1787-1834, SecurityNormal.java:641) | offline.conf.test.ts |
| offline.test.ts | daily reward claim is refused when the sku is not in the day's group (SecurityNormal.java:649-655) | offline.conf.test.ts |
| offline.test.ts | missions follow up -> reached -> given and pay the definition reward once (GamePlay.java:1346) | offline.conf.test.ts |
| offline.test.ts | mission claim without a snapshot pays coins+exp and item rewards go to storage | offline.conf.test.ts |
| offline.test.ts | mission reward A/B group 2 grants the selected item instead of the base coins | offline.conf.test.ts |
| offline.test.ts | upgrade eligibility accepts on-rent houses of any mode (state id 1) | offline.conf.test.ts |
| offline.test.ts | dailyBonusDone sets the NPC timers reported by get_welcome_progress (GamePlay.java:972-986) | offline.conf.test.ts |
| offline.test.ts | daily item rewards go to storage | offline.conf.test.ts |
| offline.test.ts | update_next_rent is stored (bounds checked) and profile flag/service/newItemsRevDone persist | offline.conf.test.ts |
| offline.test.ts | item mutations: storage placement, free moves, contractGroupSku, upgradeType and mode 6 persistence | offline.conf.test.ts |
| offline.test.ts | collectibles: caps, sell only drops the pending entry, tradein reward and ask list | offline.conf.test.ts |
| offline.test.ts | add_upgrade_item applies the visitor reward snapshot | offline.conf.test.ts |
| offline.test.ts | ask_for_help / ask_for_cash answer immediately; invest_* run against the investments list | offline.conf.test.ts |
| offline.test.ts | finished investments reach state 3 and pay out once through invest_results | offline.conf.test.ts |
| offline.test.ts | a failed (state 11) investment is hidden from the list but kept in the save | offline.conf.test.ts |
| offline.test.ts | get_world for NPCs and unknown ids never returns the player's own city | offline.conf.test.ts |
| offline.test.ts | a live save with items placed before tutorial_completed is not reset; restart_tutorial is the explicit opt-in | offline.conf.test.ts |
| offline.test.ts | deleting every road/terrain tile keeps all items across get_world and a server restart | offline.conf.test.ts |
| offline.test.ts | buy_crew persists <Crew bought> on the item and survives a reload | offline.conf.test.ts |
| offline.test.ts | collecting a house rent with a built Houses wonder pushes doubleRent once; the client's doubleRent param resets it | offline.conf.test.ts |
| server.test.ts | migrates compatible older save schemas without resetting player data | server.startup.conf.test.ts |
| server.test.ts | rolls back the HTTP listener when HTTPS startup fails | server.startup.conf.test.ts |
| server.test.ts | requires a launch-secret proof for authenticated health checks | server.startup.conf.test.ts |
| server.test.ts | fails closed when the required Facebook shim port is unavailable | server.startup.conf.test.ts |
| server.test.ts | binds the Facebook shim only to the loopback interface | server.startup.conf.test.ts |
| server.test.ts | uses macOS-compatible certificates for both local HTTPS servers | server.startup.conf.test.ts |
| server.test.ts | returns logOK and startup documents | server.startup.conf.test.ts |
| server.test.ts | returns distinct NPC neighbor worlds for the advisor city and Sheik city | server.npc.conf.test.ts |
| server.test.ts | allows up to five daily visitor upgrades per NPC city and persists upgraded buildings | server.npc.conf.test.ts |
| server.test.ts | persists save mutations across restarts | server.persistence.conf.test.ts |
| server.test.ts | persists tutorial-style new_item payloads with their real coordinates | server.persistence.conf.test.ts |
| server.test.ts | persists new item placement security gains across restart | server.persistence.conf.test.ts |
| server.test.ts | preserves item sku when update payload sends a blank embedded sku | server.persistence.conf.test.ts |
| server.test.ts | persists rented house contract state across restarts | server.persistence.conf.test.ts |
| server.test.ts | does not resurrect collected house rent after restart | server.houses.conf.test.ts |
| server.test.ts | persists the original late-collection countdown when a house becomes rent-ready | server.houses.conf.test.ts |
| server.test.ts | marks overdue ready rent as abandoned after the original grace period | server.houses.conf.test.ts |
| server.test.ts | collapses unsupported house collectible states back to waiting for contract on restart | server.houses.conf.test.ts |
| server.test.ts | advances offline house contract timers based on saved wall-clock time | server.houses.conf.test.ts |
| server.test.ts | moves bought rival sale items into the player company | server.rivals.conf.test.ts |
| server.test.ts | does not reset completed saves after the rival starter properties are bought out | server.rivals.conf.test.ts |
| server.test.ts | preserves tutorial bungalow contracts and unbought rival sale houses across restart | server.rivals.conf.test.ts |
| server.test.ts | merges the legacy duplicate tutorial bungalow back onto the tutorial tile | server.rivals.conf.test.ts |
| server.test.ts | advances offline construction timers based on saved wall-clock time | server.rivals.conf.test.ts |
| server.test.ts | keeps zero-time construction saves finished on restart | server.rivals.conf.test.ts |
| server.test.ts | does not reset offline-finished construction timers on repeated normalization | server.rivals.conf.test.ts |
| server.test.ts | stamps savedAt for live construction item mutations | server.rivals.conf.test.ts |
| server.test.ts | persists mission completion and poll manager progress across restarts | server.missions.conf.test.ts |
| server.test.ts | resets incomplete tutorial progress on restart | server.tutorial.conf.test.ts |
| server.test.ts | removes tutorial-placed map tiles and cypress tree from incomplete tutorial saves on restart | server.tutorial.conf.test.ts |
| server.test.ts | preserves decoration-only incomplete tutorial saves on restart | server.tutorial.conf.test.ts |
| server.test.ts | repairs broken completed tutorial saves on restart | server.tutorial.conf.test.ts |
| server.test.ts | reconciles early completed missions from saved poll progress | server.missions.conf.test.ts |
| server.test.ts | marks the city-name mission completed once the city is renamed | server.missions.conf.test.ts |
| server.test.ts | settles stale early bonus missions from saved poll progress on restart | server.missions.conf.test.ts |
| server.test.ts | persists mission reward claims even when the claim update has no negative security delta | server.missions.conf.test.ts |
| server.test.ts | applies delayed mission reward security gains once when expNow is stale | server.missions.conf.test.ts |
| server.test.ts | removes impossible poll-driven reward state on restart and respects the level derived from xp | server.missions.conf.test.ts |
| server.test.ts | demotes saved poll-driven reached missions back to up on restart | server.missions.conf.test.ts |
| server.test.ts | serves placeholder feed art for missing mission images | server.misc.conf.test.ts |
| server.test.ts | serves archived assets with case-insensitive path matching | server.misc.conf.test.ts |
| server.test.ts | keeps locale text assets LF-only for Flash text parsing | server.misc.conf.test.ts |
| server.test.ts | does not serve item SWF fallbacks for missing main item assets | server.misc.conf.test.ts |
| server.test.ts | serves only archived item definitions and makes archived limited-time items permanent | server.misc.conf.test.ts |
| server.test.ts | keeps collectible collections with advisor-variant item rewards | server.misc.conf.test.ts |
| server.test.ts | serves the bank commerce icon for missing commerce icons | server.misc.conf.test.ts |
| server.test.ts | accepts local VIP Club email registration and exposes confirmation | server.misc.conf.test.ts |
| server.test.ts | serves an empty generated gifts list for client startup | server.misc.conf.test.ts |
| server.test.ts | accepts WCRM VIP Club registration and exposes WCRM confirmation | server.misc.conf.test.ts |
| server.test.ts | accepts invalid signatures in offline mode | server.misc.conf.test.ts |
| server.test.ts | sanitizes startup XML-backed values before sending them to the client | server.misc.conf.test.ts |
| server.test.ts | returns free-purchase success for frictionless payments | server.misc.conf.test.ts |
| server.test.ts | persists purchased gold across restart | server.misc.conf.test.ts |
| server.test.ts | persists first friend visit prompt dismissal across restart | server.misc.conf.test.ts |
| server.test.ts | launcher keeps the normal gold HUD mode while exposing purchase success callbacks | server.misc.conf.test.ts |
| server.test.ts | launcher renders the original social panel shells without custom offline content | server.misc.conf.test.ts |
| server.test.ts | launcher blocks external URL opens and omits obsolete plugin download metadata | server.misc.conf.test.ts |
| server.test.ts | launcher response sends restrictive browser security headers | server.misc.conf.test.ts |
| server.test.ts | client local resource updates resynchronize the security baseline | server.misc.conf.test.ts |
| server.test.ts | saves local profile name and picture settings | server.misc.conf.test.ts |
| server.test.ts | adjusts local money, gold, and xp settings | server.misc.conf.test.ts |
| server.test.ts | awards a pending house collectible when an eligible level-6 house becomes rent-ready | server.collectibles.conf.test.ts |
| server.test.ts | does not award a house collectible before the level-6 unlock | server.collectibles.conf.test.ts |
| server.test.ts | does not award a collectible on every completed house contract | server.collectibles.conf.test.ts |
| server.test.ts | keeps a collected house collectible and clears it from the pending list | server.collectibles.conf.test.ts |
| server.test.ts | persists bought collectible pieces across restart | server.collectibles.conf.test.ts |
| server.test.ts | persists collectible plane rewards to the profile plane | server.collectibles.conf.test.ts |
| server.test.ts | persists collectible HQ skin rewards to the saved headquarters | server.collectibles.conf.test.ts |
| server.test.ts | persists item collectible reward claims from reward placement | server.collectibles.conf.test.ts |
| server.test.ts | projects pending house collectibles back into the world on restart | server.collectibles.conf.test.ts |

(`test.each` rows of `parity.test.ts` are one line each here: levels x6, collectible contracts x5.)

### Tests that needed a different (black-box) form

* **Pure helpers** (`parity.test.ts`, `offline.test.ts`): asserted through their observable effect, same numbers:
  `CASH_TO_COINS` (exchange command), `DAILY_BONUS_COINS/TIME_MS` (`dailyBonusDone` + `meta.daily_bonus_at_1`), `levelFromExp`
  (`/local/resources` level from stored xp), `getDailyRewardGroupByDay` (claim accepted/refused per day), `getDailyRewardDefinition`
  (the reward definition is read from the served `dailyRewardsDefinitions.xml`), `collectibleDropChance` (the roll
  `hash("sid:sku:contract:savedAt") % 100000 / 100000 <= chance` is deterministic: the test finds a `savedAt` for the last bucket that
  awards and the first that does not, so the exact threshold of every contract is pinned), `isUpgradeEligibleItem`
  (`add_upgrade_item` + `get_upgrades_list`), `normalizeCompletedTutorialUniverse(...) === false` (a second restart leaves the stored
  universe byte-identical).
* **`Math.random` stub** (`offline.test.ts` doubleRent): not possible black-box. The roll is 2 %: the test runs batches of 100
  rent cycles (`new_mode` 5 + `state` collect) and asserts the protocol: a `doubleRent:"Houses"` push eventually happens, never again
  while it is pending, and the client's `doubleRent` param consumes it so another push can happen again. Failure probability
  < 1e-9 per run, runtime ~1 s.
* **Server internals** (`serverApp.httpServer === undefined`, `facebookShim` handle, `address().address`): observed as "the port is not
  listening" / "the process exits non-zero" / "127.0.0.2 is refused" (loopback-only bind).
* **Repo file checks** that are not server behaviour (`client local resource updates resynchronize the security baseline` reads
  `client-patch-sources/.../Server.as`): kept as the same file assertion, it passes on any server.

### Internal only, not black-box testable

No whole original test is internal-only. Partial limits:

* `parity.test.ts` "chance table has 11 income-time rows": the 2 h and 18 h rows have no contract in `contracts.xml`, so only the 9
  reachable rows are pinned through the roll threshold; the row count itself is asserted on the test's copy of the table.
* Exact uncaught-exception log lines and `console.warn` output of the server are not asserted (stdout is only kept as a log for failures).
* The in-memory `doubleRentHousesAvailable` flag is only observable through the push protocol above.

## Notes for implementers of another server

* Startup work is observable without any request: the schema migration (`meta.save_schema_version` = `8`), the completed-tutorial
  normalisation (construction timers, house rent state) and the incomplete-tutorial reset run when the process starts
  (`createServerApp` -> `ensureDefaultUser`); see `server.startup`, `server.tutorial`, `server.rivals` ("repeated normalization").
* Error cases pinned by `routes.conf.test.ts`: unmatched routes answer Express' default 404 page (the golden hash includes it),
  `/mcity/0.501/*` misses answer 404 with an empty body, `/Game` answers `offlineError` per failing command.
* The golden file records TS behaviour verbatim, including `Content-Type` charsets and `Cache-Control` of `sendFile`
  (`public, max-age=0`) vs the case-insensitive asset middleware (`public, max-age=86400`).
