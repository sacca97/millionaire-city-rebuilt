# Save parity: non-tutorial flows, original (oracle) vs rewrite

Method: the SAME scripted click flow (`tools/oracle/flows/<name>.mjs`, stage coordinates, shared by both clients) is run
1. in the ORIGINAL Flash client: `FLOW=<name> MCITY_ORACLE_PORT_BASE=31853 node tools/oracle/run.mjs flow` (adapter `scenarios/flow.mjs`), and
2. in the rewrite: `CHROME=<chromium> OUT=<dir> PORT=31863 PREVIEW=http://127.0.0.1:5176/ node tools/oracle/ours-flow.mjs <name>` (760x600 viewport,
   static build served by `vite preview`, own server + temp DB per run),
both on the same seeded post-tutorial save (`flowlib.mjs seedFlow`: `tutorialEnd=1`, `bossGenre=1`, `dailyBonusInfo.dailyRewardsLastGivenDate=now` so no random daily
roll interferes unless a flow sets `export const daily = true`). Both servers log every cmdList payload (`cmdlog.cjs`).
Compare with `python3 tools/oracle/save-diff.py <orig>/final.saves.json <ours>/final.saves.json` (golden save: all `save_documents`) and
`python3 tools/oracle/cmds-diff.py <orig>/cmds.jsonl <ours>/cmds.jsonl` (payloads grouped by command/action/mode, field by field; `V=1` also shows get_*/update_profile).
Note the oracle talks to OUR server, so a save difference can come from the client payload OR from how our server applies it; the original Java
(`archive-recovery-2026-10-06/java/dollars`) decides which side is right.

## Key finding (server): money is applied from the reported GAIN
`SecurityNormal.verify` (java:784-787) does `mExp += expGain; mCoins += coinsGain; mCash += cashGain; mCompValue = compValueNow`. Our server applied the
reported `*Now` snapshot instead. The original client builds its security object from a tracker that lags (coinsNow/expNow/compValueNow are the values
BEFORE the command's own spend/gain on map, contract and collect commands), so a snapshot-trusting server dropped spends (contract 90, second terrain tile,
...). Fixed in `apps/server/src/commandHandlers/money.ts` (exp/coins/cash accumulate the gain, company value keeps the reported Now; `buy_crew` now applies
its security too). The oracle's own payloads are the proof (see rows below).

## Flow table
| flow | commands | diff fields (after fixes) | status |
|---|---|---|---|
| build-flow: terrain x4, shop house, construction (timer shortened by DB edit + reload), contract (Family), rent ready, collect | update_map add Terrain, update_item new_item / new_mode 2 / new_state 1 / new_mode 4 / new_mode 5 / new_mode 1, update_pollmanager | save: `companyValue` 752000 (orig, lags by the last event) vs 752260 (ours exact); payload-only: pre-spend `coinsNow`/`compValueNow`/`compValueGain` lag (ours reports post-spend), `update_next_rent` (orig only, meta not save), boot-time `update_profile` | MATCH (DB identical except company value lag) |
| sell-rival-roads: sign contract on seeded house, sell it (destroy tool), build 2 roads, destroy 1 road, buy rival for-sale townhouse, buy 2 terrain tiles, reload | update_item new_mode 4 / destroy / new_mode 3 / new_mode 4 csid / new_state 1, update_map add Road / del Road / add Terrain | save: only seed timestamp | MATCH after fixes |
| missions-instant-expansion (seed coins 4.5M, 100 gold): 1M magazine, Name It mission (type "MyTown", claim +20,000), 4 terrain, house, instant build (coins), mission 5 claim (+40,000), drag map, Buy Expansion popup -> pay cash 4M | update_profile firstMission / city_name_codes / fourMillions, update_missions (reached + claim), update_pollmanager earn companyValue 1,2,3 / instantBuild / buyExpansion, update_plots bought | save: `fourMillions` (fixed), instant price 465 vs 461 and coins by 4 (price falls with the remaining time, ours ran 4 s later), PollManager `earnDCCoins/1` only in ours | MATCH after fix; earnDCCoins accepted difference (see Round 5) |
| daily-bonus: claim the Day 1 prize, reload | update_daily_reward {sku, security gain}, flag stopFirstSessionPopups | reward roll is random server-side (sku/coins differ per run); structure identical; orig DB company value lags the reward (pre-gain Now) | MATCH (modulo roll) |
| first session after tutorial (no daily due) | update_profile flag `stopFirstSessionPopups:1` | save `flags` | fixed (was missing) |

## Fixes made from these flows
- Server: gain-based money (above); `buy_crew` applies security; test expectations in `apps/server/test/offline.test.ts`, `apps/client/test/commands.integration.test.ts` updated.
- Client: `new_item` for a construction site is always `isSuspended:1` (orig), followed at once by the RESUME `new_mode` with the XP gain.
- Client: rent-ready report carries the abandon time rounded up to the second (3,600,000 not 3,599,987), collect (GET_RENT -> WAITING_FOR_CONTRACT) carries the remaining abandon countdown (orig 3,591,766) instead of 0.
- Client: rival building buy sends MODE_BUYING (3, time 3000, coinsGain -price) first, then after the 3 s bar MODE_BOUGHT (4, csid) and the RENT new_state; the building's footprint
  adds terrain value (9 tiles x 1,000 for a townhouse) to the company value as the original does (orig terrain sync in GamePlay.java:2455).
- Client: after the daily-reward step (popup closed or none due) the first post-tutorial session sends `update_profile {action:"flag", name:"stopFirstSessionPopups", value:1}` (WelcomeProgress.firstSessionProgress).
- Client: `load_success {sig:395581429}` is sent once the world is shown (it was never sent; the sig is `RulesFacade.sigGetTotal()` of the 0.501 rules as seen in the oracle).

## Round 5 (2026-10-07): closing the open items
- **earnDCCoins (ACCEPTED difference, cause found)**: `Profile.build(false)` (DollarsGame.as:1816, while loading) runs `eventsBuild` (Profile.as:1074) which checks earn<companyValue|DCCoins|DCCash> against the values STORED in the save; `UserDataFacadeOnline.updatePollManager` only sends in STATE_RUN_WORLD (:1603), so the original registers `earnDCCoins` (and any satisfied condition) locally without a command when the save already holds >= 1M coins. Ours registers it at the first coin change and sends it, so the persisted PollManager chunk has an extra `earnDCCoins/1`. Verified with the oracle (flow `earn-coins`: starting at 990,000 coins the original DOES send `update earn DCCoins 1` when the claim crosses 1M). No gameplay effect: mission 43/122 completes at the same moment (counter >= condition either way) and both clients rebuild the same local state from the save. Left as is by decision.
- **Company value lag (FIXED, matches the original)**: `securityCreateObj` builds `*Now` from the stale `smCompValue` baseline and the facade's `securityUpdate()` only advances it afterwards (UserDataFacadeOnline.as:90-95, 136-141, 244-249, 822-827, 1232-1237; DailyBonusManager.as:91). The server keeps `compValueNow` (SecurityNormal.java:787), so the DB value lags the last event by one command. Ours synced the baseline BEFORE building the object (`Game.syncBaseline`, missions/collectibles hosts, `dailyReward`): removed. Server: `applyMoneySecurityFieldWithPositiveDeltaFallback` added the gain on top of `Now`, now `Now` wins for companyValue (java:787). Result: build-flow, daily-bonus, collectibles, move and sell-rival-roads saves are identical to the original except seed timestamps / random daily roll. Tests: `game.integration.test.ts` accepts the lagging DB value (any value the client had) and checks coins/exp/cash exactly.
- **Gold instant build (MATCH)**: instant build is always paid in coins (`instantBuildCash`); the gold path is the "Not Enough Cash" PopupConfirm exchange (`instantBuildStart`). Flow `instant-gold` (34,300 coins, 100 gold): `update_money exchange`, `update_pollmanager add instantBuild`, `update_item new_mode` payloads identical, coins 59835 vs 59839 (4 s of price decay). Only timing differs (ours completed construction before the dump).
- **Move (driveable, MATCH)**: the briefcase at the left of the toolbar IS the multifunction `SpecialButton` (move / collect / contract). The earlier "not reachable" note was wrong. Flow `move`: payload `{x,y,dec}` and the saved position identical; the original wraps it in `upd_suspended 1` (pick, StateOnRent.suspend) and `upd_suspended 0` (before `move`, endMoving -> resume): added to `Game.startMove/moveItem`. The toolbar move tool opens PopupPayMove (price + "rent the crane operator for 10 gold", `update_money service`), the vault free-move entry the plain confirm (ToolMove.itemAttachedCheckPrize): implemented (`confirmPayMove`, `Game.rentMove`).
- **Collectibles (MATCH)**: flow `collectibles` (level 9 seed): first open sends `update_profile flag collectiblesFirstShown`, the info button click `collectiblesHelpShown2`; claiming the HQ group sends `update_collectible GET_REWARD` and the DB (collectiblesList skus/rewards, HQ `currentSku HeadQuarter_02`, `shadowRows`) is identical. Remaining payload-only: `compValueGain` (stale baseline).

| rent-accelerator: seed 2 x rentAcc30 in storage, sign Family contract, vault -> storage -> Use -> click house | update_money rentAccelerator {sku fgift_018, itemSid} | item `time` only (timing) | MATCH |
- Scope: rival buy (sell-rival-roads) was matched but the social/rival/investment group is deferred by the user; collectibles not driven.
