# INVESTIGATE-C06: construction RESUME / upd_suspended (mission-C06-9) and rival-buy company value (mission-C11-2)

Read-only investigation. No code or oracle run was changed.

## 1. Original behaviour (C06-9)

Original log (tools/oracle/out/flow-mission-C06-9/cmds.jsonl), five new_item packets, each `isSuspended "1"`, mode 1, time 1200000:

| sid  | (x,y)  | footprint (3x3)  | original after new_item                    |
|------|--------|------------------|--------------------------------------------|
| 2172 | -10,-5 | x-10..-8 y-5..-3 | nothing                                    |
| 2173 | -4,-5  | x-4..-2  y-5..-3 | nothing                                    |
| 2174 | 3,-5   | x3..5    y-5..-3 | nothing                                    |
| 2175 | 6,-5   | x6..8    y-5..-3 | nothing                                    |
| 2176 | 8,1    | x8..10   y1..3   | new_mode mode 2, isSuspended 0, expGain 200 |

Correction to the premise: the RESUME in the original is on the FIFTH site (sid 2176 at (8,1)), not the first. Sites 1-4 never get any update_item after new_item. No upd_suspended is sent for any construction site.

Why only 2176: connectivity. The saved map (final.saves.json, World[2].Map[1].Road chunk) has road tiles on y=0 for x=-7..11 plus x=-1 (y 0..4), y=4 (x 0..4), x=2 (y 1..4). Only site 2176 has a road tile on its perimeter: (8,0),(9,0),(10,0) lie directly under its bottom row. Sites 2172-2175 have no road tile touching their footprint (their perimeter rows are y=-6 and y=-2, and column x=-1 for site 2173 is not road at y -5..-3). Our own economy agrees (see section 3): it reports exactly 2172-2175 as disconnected. Nothing else (tutorial, first build, prior suspend) gates it in the original: the 2176 site is the only connected one.

### AS rule (decompiled/scripts/com/dchoc/dollars/world/items/...)

1. Creation. ItemObject.changeState (ItemObject.as:1132-1135) calls `suspend()` when `needsHQConnection && !isHQConnected() && isMine()`. The new_item is then sent at ItemObject.as:1160-1170 with `isSuspended` from getPersistence (ItemObject.as:2378, `isSuspended ? "1" : "0"`). So new_item always reports isSuspended 1 for a fresh site, because the HQ search has not run yet.
2. Placement. Map.placeItem (Map.as:1531-1533) calls `searchHQConnection()` for items that need the HQ. ItemObject.searchHQConnection (ItemObject.as:813-822) calls applyHQConnection (ItemObject.as:1915-1965):
   - connected and `!mIsConnected` (ItemObject.as:1937-1939): mIsConnected=true, and in STATE_RUN_WORLD `resume()` (ItemObject.as:1952).
   - not connected: `suspend(); mIsConnected=false` (ItemObject.as:1957-1958).
3. The mIsConnected/mIsSuspended flags are guarded transitions. StateMachine.suspend (framework/states/StateMachine.as:99-110) and StateMachine.resume (:72-83) only call the state when the flag actually flips. `isSuspended` getter is StateMachine.as:66-68.
4. StateOnConstruction.resume (StateOnConstruction.as:198-212): exp and ParticlesManager only when `mMode == MODE_INIT` (:201-210), then `setMode(MODE_RESUME)` (:211). setMode sends new_mode (:178) with isSuspended read at send time (:168, after StateMachine.resume cleared the flag, so "0").
5. StateOnConstruction.suspend (StateOnConstruction.as:49-53) calls `setMode(MODE_PAUSED)`. setMode (:153-183) skips the send when `mMode == MODE_INIT && param1 == MODE_PAUSED` (:162). So a site that was never connected (still INIT) sends NOTHING when suspended or left disconnected.
6. Construction never sends upd_suspended. Only StateOnRent does (StateOnRent.as:915-923 suspend, :980-990 resume). StateOnConstruction inherits no network call from StateItemObject.
7. Timer. StateOnConstruction.doLogicUpdate (:252-263) counts down whenever isTimerCountDownEnabled() and Tutorial.smTutorialEnd. It does not check isSuspended. That is why items keep counting down while suspended in both runs.

### What the original does, by case

- New site, not road-connected at placement: new_item(isSuspended 1, mode 1). Nothing else. Stays mode 1 (INIT) with no exp until it becomes connected.
- New site, connected at placement: new_item(isSuspended 1) then new_mode{mode 2, time, isSuspended 0, expGain 200} (in the same packet).
- INIT site that later becomes connected (road built): resume() gives the exp once (StateOnConstruction.as:201-210) and new_mode mode 2.
- RESUMED (mode 2) site that later gets cut off: suspend() -> setMode(PAUSED): new_mode{mode 3, time, isSuspended 1}, no exp.
- RESUMED-then-PAUSED site reconnected: resume() -> setMode(RESUME): new_mode{mode 2, time, isSuspended 0}, no exp (mMode is PAUSED, not INIT).
- Never upd_suspended for construction.

## 2. Our code (apps/client/src/game/game.ts)

- build() at game.ts:777-842:
  - :800 `deferStart` (tutorial hold only).
  - :808 `suspended: deferStart` on the placed item.
  - :823 new_item sent with `isSuspended: true` (matches the original).
  - :832-838 the non-deferred branch ALWAYS does `addExp(r.exp)` + `item.mode = RESUME` + `constructionMode(RESUME)`. There is no HQ-connection check. This is the bug: it sends RESUME and +200 exp for sites 2172-2175, which the original does not (4 x 200 = 800 exp, which is exactly the 7000 vs 6200 gap).
- pushSuspension() at game.ts:346-362 runs every tick (game.ts:670). It sends `setSuspended` (upd_suspended, commands.ts:459-460) for every item whose suspended flag changed, including construction sites. This is the cause of the 4 extra upd_suspended(1) in our log. The original never sends it for construction; it sends new_mode{mode 3} for RESUMED sites instead.
- Mode numbers: commands.ts:217 CONSTRUCTION_MODE {INIT 1, RESUME 2, PAUSED 3, INSTANT_BUILD 4}.

### Rule to implement

A. In build(), after the new_item send (game.ts ~823) and before any RESUME: call `this.economy.invalidate()` and then `this.economy.isConnected(sid)` (economy.ts:274-278, the item is already in itemMap/world). If not connected (or deferStart): do not addExp, do not set RESUME, keep mode INIT and set `suspended: true` on the placed item (currently only the deferStart case does this). If connected: keep the current RESUME path.
B. In pushSuspension() (game.ts:346-362), split by stateId:
   - Rent items: keep setSuspended (upd_suspended) as now (StateOnRent.as:915-990).
   - Construction items, mode INIT: mirror the flag only, no packet, on suspend or disconnect. On reconnect (not boot), do what resumeTutorialConstruction does (game.ts:1706-1716): addExp(def.exp), mode=RESUME, send constructionMode(RESUME, time, isSuspended false). At boot (boot=true) do not send and do not give exp (the AS sends queueRequest SET_ITEM_CONNECTION instead, ItemObject.as:1937-1946, and does not call resume).
   - Construction items, mode RESUME: on suspend send constructionMode(PAUSED, time, isSuspended true, NO_GAIN) and set mode=PAUSED (StateOnConstruction.as:49-53, 153-183); on reconnect send constructionMode(RESUME, time, isSuspended false, NO_GAIN) and set mode=RESUME, no exp (StateOnConstruction.as:198-212).
   - Construction items, mode PAUSED: reconnect behaves like RESUMED reconnect (no exp).
   - Mode INSTANT_BUILD (4): never sends (StateOnConstruction.as:162).

Expected result for C06-9 after the fix: 2172-2175 new_item only (isSuspended 1, mode 1, no upd_suspended), 2176 new_item + new_mode{mode 2, isSuspended 0, expGain 200}. Saved exp 6200, saved modes 1,1,1,1,2.

## 3. Mission-C11-2: why the rival buy adds only +9000 in the original

Original sequence (tools/oracle/out/flow-mission-C11-2/cmds.jsonl), sid 2001:
- new_mode mode 3 (buying), coinsGain -13800, compValueNow 872000.
- new_mode mode 4 (bought), csid 1, compValueGain -13800, compValueNow 858200 (the coins spent lower the company value, since company value includes coins).
- new_state state 1 (RENT), time 180000, compValueGain **+9000**, compValueNow 867200.
- next update_missions (same ms): compValueGain **+60000**, compValueNow 927200.
- saved companyValue after reload: 867200 (completed.saves.json and final.saves.json).

AS mechanics:
- StateOnIA.setMode(MODE_BUYING) (StateOnIA.as:121-129) constructs NotificationSellingEnd. Its constructor calls doTransaction() when the buyer is mine (NotificationSellingEnd.as:29-32, 40-62): coins -13800 at mode 3.
- StateOnIA.setMode(MODE_BOUGHT) (StateOnIA.as:131-137) shows the notification. The user clicks OK, which runs NotificationSellingEnd.onAccept (NotificationSellingEnd.as:69-89) in this order:
  1. :82 World.changeCompanyItem moves the item to the mine (World.as:332-339).
  2. :83 Map.sellTerrain. Map.as:2568-2572: since the item is now the mine's, `companyValue += baseRows*baseCols*terrainPrice` = 9 x 1000 = 9000.
  3. :84 CompanyMine.initItemAfterBuying (CompanyMine.as:31-47). Line 44 `changeState(new StateOnRent)` runs first. ItemObject.changeState sends new_state (ItemObject.as:1180) via updateItem -> UserDataFacadeOnline.updateItem (UserDataFacadeOnline.as:127-141) -> securityUpdate() (UserDataFacade.as:362-381, compValueGain at :377). The snapshot at this moment contains only the +9000 terrain.
  4. Only then, CompanyMine.as:46 adds `companyValue += item.getCompanyValue()` (60000). Nothing is sent at this point, so the 60000 is reported by the next securityUpdate() snapshot: the update_missions from the buy poll (the MISSION_EVENT_BUY_ITEM registration, NotificationSellingEnd.as:74-75). That is the +60000 in the update_missions.

So the 60000 is added after the new_state snapshot, not before. This explains the split +9000 (new_state) / +60000 (missions) in the original.

Ours: apps/client/src/game/game.ts adoptRival, finish() at :444-458:
- :446 `this.companyValue += def.rules.companyValue` runs BEFORE the newState send at :451. That puts the 60000 into the new_state snapshot (9000 + 60000 = 69000), which the original does not do.
- :448 terrain +9000 is correct and already before :451.

Rule to change: move line 446 (`this.companyValue += def.rules.companyValue`) to after the newState send at :451 and before `this.poll("buy", ...)` at :457. Then new_state reports +9000 and the buy poll's update_missions reports +60000, matching the original.

Server note: apps/server/src/commandHandlers.ts:321-322 routes update_missions to applyMissionsMutation, which does not apply the money snapshot (money.ts applyMoneySecuritySnapshot). That is why the original's saved companyValue stays 867200 even though the client reports 927200. Our server parity is unchanged by this fix; nothing server-side needs to change.
