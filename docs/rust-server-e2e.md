# Rust server end-to-end check (real clients)

Date 2026-10-31. Rust binary built with `CARGO_TARGET_DIR=apps/server-rs/target-e2e cargo build` (debug), copied to the scratchpad and run from there.
All runs used a fresh temp SQLite DB per run; part A used `MCITY_ORACLE_PORT_BASE=31853`, everything sequential.

## Switch added (opt-in, default unchanged)

- `MCITY_ORACLE_SERVER_CMD=<path to mcity-server>` makes `tools/oracle/lib.mjs` (used by `run.mjs`) and `tools/oracle/ours-flow.mjs` start that binary instead of `npx tsx src/main.ts`. Unset = the TS server exactly as before.
- New helpers: `tools/oracle/serverCmd.mjs` (spawn specs) and `tools/oracle/cmdlog-proxy.cjs`.
- The Rust server has no cmdlog hook (the TS server uses `NODE_OPTIONS=--require cmdlog.cjs`), so the binary runs on inner ports (public base 31853 -> inner 31863, 31863 -> 31853; override with `MCITY_ORACLE_INNER_BASE`) behind a transparent proxy on the public ports. The proxy terminates TLS (self-signed via openssl; the clients ignore cert errors), appends every cmdList POST to `cmds.jsonl` in the cmdlog.cjs format, and rewrites the inner port numbers in text responses back to the public ones (the launcher page embeds the server's own ports; without the rewrite the client bypasses the proxy, which is why my first Rust runs had no cmds.jsonl and were rerun).
- Not used: `tools/missions/verify.py` (it writes evidence files into the repo); the same checks were run directly with `cmds-diff.py` and `save-diff.py`.

## A. Original Flash client (TS server vs Rust server)

| flow | both ran | cmds (TS/Rust) | save dumps |
|---|---|---|---|
| tutorial-full | yes | 23/23 | 12 dumps, 0 differences |
| FLOW=build-flow | yes | 18/18 | 1 volatile difference |
| FLOW=mission-C31-1 | yes | 11/11 | 1 volatile per dump |
| FLOW=mission-C12-4 | yes | 11/11 | 1 volatile per dump |

The only save difference anywhere is `dailyBonusInfo/dailyRewardsLastGivenDate` (timestamp). An earlier tutorial-full pair also differed in `dailyRewardsNextRewardId` (reward_03 vs reward_02): it is a random pick (`pickDailyRewardByDay(count, random)`, offline.ts); the final pair was identical. "orig" below = TS server run, "ours" = Rust server run.

tutorial-full:
```
cmds: 23 vs 23 lines
== ('load_success', None, None, None) orig x2 ours x2
== ('update_item', 'new_item', None, None) orig x3 ours x3
== ('update_item', 'new_mode', None, 1) orig x3 ours x3
== ('update_item', 'new_mode', None, 2) orig x2 ours x2
== ('update_item', 'new_mode', None, 4) orig x1 ours x1
== ('update_item', 'new_mode', None, 5) orig x1 ours x1
== ('update_item', 'new_mode', None, 6) orig x1 ours x1
== ('update_item', 'new_state', None, 0) orig x1 ours x1
== ('update_map', 'add', 'Road', None) orig x2 ours x2
== ('update_map', 'add', 'Terrain', None) orig x2 ours x2
== ('update_missions', 'update', None, None) orig x5 ours x5
== ('update_next_rent', 'update_next_rent', None, None) orig x2 ours x2
save-diff 0_welcome ... 9_final (12 dumps): differences: 0
```
build-flow (cmds-diff.py crashed on the raw Rust log: after the 2nd reload the Flash client put `uid` before `data` in the POST body in that run, which is the client's field ordering, not the server; bodies were normalised before diffing):
```
== ('load_success', None, None, None) orig x3 ours x3
== ('update_item', 'new_item', None, None) orig x1 ours x1
== ('update_item', 'new_mode', None, 1) orig x1 ours x1
   #0 /_dat/time: ORIG=3591684 OURS=3591682
== ('update_item', 'new_mode', None, 2) orig x1 ours x1
== ('update_item', 'new_mode', None, 4) orig x1 ours x1
== ('update_item', 'new_mode', None, 5) orig x1 ours x1
== ('update_item', 'new_state', None, 1) orig x1 ours x1
== ('update_map', 'add', 'Terrain', None) orig x4 ours x4
== ('update_missions', 'update', None, None) orig x5 ours x5
== ('update_next_rent', 'update_next_rent', None, None) orig x4 ours x4
== ('update_pollmanager', 'add', 'collect', None) orig x1 ours x1
-- final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1793474655497' OURS='1793476610786'
```
mission-C31-1:
```
cmds: 11 vs 11 lines
== ('load_success', None, None, None) orig x2 ours x2
== ('update_missions', 'update', None, None) orig x18 ours x18
== ('update_next_rent', 'update_next_rent', None, None) orig x2 ours x2
-- completed.saves.json: dailyRewardsLastGivenDate ORIGINAL='1793475858126' OURS='1793475967685'
-- final.saves.json: same single difference
```
mission-C12-4:
```
cmds: 11 vs 11 lines
== ('load_success', None, None, None) orig x2 ours x2
== ('update_missions', 'update', None, None) orig x28 ours x28
== ('update_next_rent', 'update_next_rent', None, None) orig x2 ours x2
== ('update_plots', 'bought', None, None) orig x1 ours x1
== ('update_pollmanager', 'add', 'buyExpansion', None) orig x1 ours x1
== ('update_pollmanager', 'update', 'earn', None) orig x3 ours x3
-- completed.saves.json: dailyRewardsLastGivenDate ORIGINAL='1793476073928' OURS='1793476186232'
-- final.saves.json: same single difference
```
The only command-payload difference is a client timer value (`update_item new_mode 1 /_dat/time`, 2 ms apart).

Screenshots (Rust runs: game loads, tutorial played to the end, houses built and rent collected, missions completed, reload fine), in /tmp/claude-1000/-home-sacca-Projects-millionaire-city-rebuilt/39a06830-a49c-4673-b4c4-4aff8a375348/scratchpad/e2e-shots:
`A-rust-tutorial-final.png`, `A-rust-tutorial-reloaded.png`, `A-rust-build-flow-collect.png`, `A-rust-C31-1-complete.png`, `A-rust-C12-4-reloaded.png`.

## B. Our TypeScript client (vite build in /tmp/mc-e2e, `ours-flow.mjs`, port 31863)

| flow | both ran | cmds (TS/Rust) | result |
|---|---|---|---|
| build-flow | yes | 46/46 | same command groups; final save only `dailyRewardsLastGivenDate`; one client timer `time` 3589762 vs 3589251 |
| mission-C31-1 | yes | 26/26 | same command groups; both dumps only `dailyRewardsLastGivenDate` |

```
build-flow: cmds: 46 vs 46 lines (same group table as part A; update_missions x4, update_next_rent x5)
   #0 /_dat/time: ORIG=3589762 OURS=3589251
-- final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1793476862159' OURS='1793477012864'
mission-C31-1: cmds: 26 vs 26 lines
== ('load_success', None, None, None) orig x2 ours x2
== ('update_missions', 'update', None, None) orig x17 ours x17
== ('update_next_rent', 'update_next_rent', None, None) orig x2 ours x2
-- completed/final.saves.json: dailyRewardsLastGivenDate only
```
Harness notes: the first TS mission run died at "server" (port 31863 held by a proxy orphaned by my own crashed first Rust run, caused by a bug in my ours-flow edit, fixed); rerun passed (attempt 2). Failed ours-flow runs leave `/tmp/mcity-ours-*` behind (pre-existing behaviour), which also confused my DB-capture loop once.
Screenshots: `B-rust-ours-build-flow-last.png`, `B-rust-ours-C31-1-complete.png` in /tmp/claude-1000/-home-sacca-Projects-millionaire-city-rebuilt/39a06830-a49c-4673-b4c4-4aff8a375348/scratchpad/e2e-shots.

## C. Cross-opening databases

DBs were captured (sqlite backup loop) from an ours-flow build-flow run on each server (post-tutorial, 2 houses, `tutorialEnd=1`). The TS-written DB was opened by the Rust server and the Rust-written DB by the TS server; each was loaded with our client and screenshotted. Both show the identical city (level 1, 101 xp, $346,260 cash, $752,260 value, HQ + 2 houses + roads + fountain, neighbour bar). Rust served 13 /Game POSTs on the TS DB without errors. Screenshots: `/tmp/claude-1000/-home-sacca-Projects-millionaire-city-rebuilt/39a06830-a49c-4673-b4c4-4aff8a375348/scratchpad/e2e-shots/rust-opens-ts-db.png`, `/tmp/claude-1000/-home-sacca-Projects-millionaire-city-rebuilt/39a06830-a49c-4673-b4c4-4aff8a375348/scratchpad/e2e-shots/ts-opens-rust-db.png`.

## Rust server bugs found

None. All observed differences are volatile (timestamp, random daily reward pick, client timer jitter, client POST field ordering).
