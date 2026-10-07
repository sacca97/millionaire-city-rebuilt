# Influence, bonus and giveEmail mission classes: oracle plan

Classes: C03, C04, C05 (`bonus`), C13, C14 (`checkInfluence`), C25 (`giveEmail`). Planning document only: no oracle run was made and no product code was read for changes.

Legend: **[V]** verified in code, XML or a dump (file:line given). **[G]** guess. **[U]** unknown, must be settled on the oracle. Decompiled paths are under `decompiled/scripts/com/dchoc/dollars/` (short form `dollars/...`). XML paths are under `assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/` (short form `rules/...`).

## 0. Geometry source and conventions

- **Baseline = post-tutorial save, not `starter.ts`.** Flows boot the post-tutorial save (`tutorialEnd=1`). `tools/oracle/out/post-tutorial/post-tutorial.saves.json` and `tools/oracle/out/flow-mission-C24-308/completed.saves.json` have the same mine items, 43 Terrain tiles and 31 Road tiles [V]. The baseline contains a HeadQuarter (sid 2170, origin -1,-3, footprint 4x3, `rules/itemDefinitions.xml:2`), a tutorial bungalow `houses_001_001` (sid 2171, origin 4,2, `State id=1 mode=1`, i.e. waiting for a contract), a fountain `decorations_font_02` (sid 1002, 0,2) and 60 trees [V]. `apps/server/src/saveDefaults/starter.ts` has no HQ and different roads, so its coordinates are not used here.
- Rival items (`csid=2`, not counted by any mission): commerce_pizza (-7,-3), houses_002_001 (-4,1), houses_002_002 (9,-3), houses_001_002 (-13,1) [V].
- Footprint origin is the top-left tile; a block covers `[x, x+cols) x [y, y+rows)` (`Map.as:1500-1509`, `ItemDefinition` baseCols/baseRows) [V].
- Screen mapping (verified by working flows, `docs/missions-flow-recipes.md`): `x = 556 + (tx-6)*32`, `y = 225 + (ty+2)*32`. Click conventions used by working flows: 2x2 origin (tx,ty) at `(x+16, y+16)` (e.g. `(572,241)` for (6,-2), `mission-C09-11.mjs`); 3x3 origin at `(x+32, y+32)` (e.g. `(588,321)` for (6,0), `mission-C17-31.mjs`). [U] whether these conventions place a block exactly where planned: check with a hover screenshot before the click.
- The tools bar is at y=459 (recipe). Tiles whose footprint reaches screen y >= 449 are not usable as placement targets.
- Placement rules used by the designs: commerces and houses need ALL footprint tiles owned (recipe, `docs/missions-flow-recipes.md`); decorations need UNOWNED free grass (`mission-C09-11.mjs` header) [V]; seeded owned terrain is appended to the Map `Terrain` chunk as `x:y,` (recipe).
- **HQ connection gates population [V].** A commerce or house that is not connected to the HQ by road is suspended. `ItemObject.as:2614-2623` (`isAffectedByType`) requires `!mIsSuspended`; `applyHQConnection` (`ItemObject.as:1915-1963`) calls `suspend()` when `isHQConnected` fails; the search is `Map.astarSearchItem` (`Map.as:2461`) started from `ItemObject.as:816`. `needsHQConnection` is false only for HQ and decorations (`ItemDefinition.as:1585-1587`). Our port: `apps/client/src/game/influence.ts:134-200` (ring roads + flood fill from the HQ ring). Every design below was checked against this rule (ring of the footprint touches a road reachable from the HQ ring) on the baseline dump [V, computed].
- Influence area: a building with `influenceRatio = R` covers tiles `[tx-R, tx+cols+R)` x `[ty-R, ty+rows+R)` (`ItemObject.as:456-491`; `ItemDefinition.as:1088-1097`) [V]. A house is registered by a source when ANY of its footprint tiles lies in that area (`TileData.as:58-69`, `Map.as:1500-1509`) [V]. Our port: `influence.ts:73-92` (footprint overlap) [V].

## 1. Shared mechanics of the original

- **Events and keys.** A mission with `amount > 0` owns one `PollEvent` keyed `type + parameter` (`MissionObject.as:57-65`; `MissionDefinition.as:282-285`). Missions with the same key merge into one event, adding one condition each (`PollManager.as:133-154`). Counters and conditions are global: `PollEvent.checkCondition` does not look at the mission's state (`PollEvent.as:199-228`) [V]. Every definition in the active set gets a `MissionObject`, including LOCKED ones, so their conditions are always present (`MissionObjectManager.as:361-394`, `:686-725`) [V].
- **Threshold.** `PollEvent.checkCondition(value, sid)`: for every condition whose counter is 0, if `value >= condition` then `register(i)` (`PollEvent.as:199-228`, `:215-217`). `register` sets the counter to 1, sends `updatePollManager("update", {type, parameter, value: progress})` for condition events (`PollEvent.as:102-121`). The progress string is the number of leading satisfied conditions (`PollEvent.as:133-153`) [V]. Consequence: two conditions met in one call send `value "1"` then `value "2"`.
- **Gate.** `needsToBeChecked()` is true only while some counter is 0 (`PollEvent.as:56-85`), and only for the owner role (`RoleOwner.as:133-136`; `Role.as:36-39`) [V].
- **Reached.** `MissionObject.logicUpdate` moves UNLOCKED to REACHED when `getCount(idByCondition(condition)) >= eventAmount` (`MissionObject.as:208-250`) [V]. Unlock: `unlockLevel` if > -1, else `unlockSku` must be hasBeenReached (`MissionObject.as:324-340`; `unlock/UnlockMissionBySku.as:19-33`) [V]. The per-frame driver is `DollarsGame.as:2020` (`MissionObjectManager.logicUpdate`) [V].
- **Persistence.** `PollManager.getPersistence` writes `<Count chunk="sku/progress,...">` for events with counter 0 > 0 (`PollManager.as:55-75`; `PollEvent.as:170-173`) [V].
- **Command shapes** (`apps/client/src/net/commands.ts:604-618`, `:543-545`, `:599-601`; `tools/oracle/out/flow-mission-C24-308/cmds.jsonl` shows `{"action":"update","type":"earn","value":"1","parameter":"companyValue"}` under `update_pollmanager`) [V]:
  - `update_pollmanager` `{action:"update", type, parameter, value}`.
  - `update_profile` `{value, action:"checkmail"}` (`commands.ts:561`).
  - `update_missions` `{sku, action:"update"}` (`commands.ts:599-601`; `MissionObjectManager.as:283-287`).

## 2. Bonus classes C03, C04, C05 (mission event `bonus`)

### 2.1 Representatives (from `rules/missionDefinitions.xml`)

| Class | Rep (default/alt) | XML attributes | Rep2 |
|---|---|---|---|
| C03 | 25 | `sku="25" unlockSku="10" type="bonus" parameter="houses_001" amount="1" condition="12"` (line 26) | none (class has 2 members, both default: 25, 26) |
| C04 | 29 | `sku="29" unlockLevel="18" type="bonus" parameter="houses_006_001" amount="1" condition="90"` (line 30) | 99 (alt): `sku="99" unlockLevel="3" type="bonus" parameter="houses_001_001" amount="1" condition="12" showInABtest="alt_missions"` (line 99) |
| C05 | 27 | `sku="27" unlockSku="26" type="bonus" parameter="houses_002_001" amount="1" condition="30"` (line 28) | none |

Same-event siblings: 26 (`bonus houses_001`, condition 16, `unlockSku="25"`, line 27) and 28 (`bonus houses_002_001`, condition 60, `unlockSku="27"`, line 29). Their conditions share the PollEvent with 25 and 27.

### 2.2 How the original counts it

- **Emission.** `ItemObject.checkInfluenceEvent` (`ItemObject.as:2859-2876`): only if `mCompany.isMine()`; checks `PollManager.getEvent("bonus" + def.sku)` (line 2862-2868) and `"bonus" + def.subsku` (2869-2873), then `checkCondition(this.influenceValue, sid)`. `subsku` is only set for houses: `sku.split("_")[0] + "_" + [1]` (`ItemDefinition.as:504-508`), so `houses_001_001` gives `houses_001` [V].
- **Value = the house's influence percent.** `influenceValue` (`ItemObject.as:2539-2551`) = sum of `influenceValue` of the decorations covering it (`registerItemInfluence`, `ItemObject.as:2031-2068`, adds `itemDefinition.getInfluenceValue()` at line 2052-2058) plus the wonder attribute. Only decorations count: `ItemDefinition.isAffectedByType` returns true only for TYPE_DECORATIONS (`ItemDefinition.as:1493-1495`) and houses are `isAffectedByInfluence` (`:1528-1530`). Commerce influence values are 0 (`rules/commerceDefinitions.xml` lines 2-6, `influenceValue="0"`); decoration values are in `rules/decorationDefinitions.xml` (fountain `decorations_font_02`: ratio 2, value 14, level 12, 2x2, 80,000; tree_01: ratio 1, value 2; tree_02: ratio 2, value 2; tree_03: ratio 1, value 3; tree_05: ratio 2, value 5, 2x1) [V].
- **Influence ignores suspension.** `influenceValue` has no HQ check (`ItemObject.as:2539-2551`), so bonus does not need the HQ road [V].
- **When it is called** (all in `ItemObject.as`): `registerItemInfluence` line 2063 (a decoration starts covering the house; the new value is checked immediately); `unregisterItemInfluence` line 547 (decoration removed or moved); `refresh()` line 1337 (called from `World.changeCompanyItem`, `World.as:332-339`); `logicUpdate` line 2849, only when a company wonder attribute changed (`:2847-2848`, `Company.as:573-586`). Attach happens at item init (`ItemObject.as:1667-1678`, `attachInfluence` at 1678) and after a move (`:1607-1616`) [V].
- **Thresholds.** Same `>=` rule as section 1. Example: house with 19% checks conditions 12 and 16 in one call: commands `value "1"` then `value "2"` for `bonus houses_001` [V by code].
- **Ordering risk** [U]: whether PollEvents exist when a seeded house is initialised at boot (`Profile.build` builds missions and polls at `Profile.as:572-573`; world items init at `ItemObject.as:1667`). If items init first, the boot-time check finds no event and nothing is sent until the next registration.

### 2.3 How our client does it

- Feed: `apps/client/src/ui/missions/system.ts:183-194`: a 1-second interval over `game.items()`, `checkEvent("bonus"+sku, influencePercent(sid), sid)` and, for houses, `"bonus" + <sku part 0> + "_" + <sku part 1>` (`system.ts:190-191`). Skipped while visiting or in the tutorial (`system.ts:186`).
- `game.items()` is the mine items only (`game.ts:293-299`, `itemMap` filled from `init.state.mine.items`) [V].
- Tutorial gating: `game.tutorial` is undefined once the tutorial is over (`game.ts:231-234`, `:259`) [V], so bonus is fed in post-tutorial flows.
- Value: `economy.influencePercent` (`economy.ts:307-313`) -> `houseInfluencePercent` (`influence.ts:97-112`: decorations covering the house + wonder) [V].
- PollEvent port: `apps/client/src/game/missions.ts:173-260` (`check` :247-259 uses the same `>=` and counter-0 rule; `register` :231-237; `progressAsString` :239-245). Sending: `system.ts:82-85` -> `commands.ts:604-618` [V].
- **Differences:** (B1) timing: ours polls every second, the original reacts to registration. The final counts are the same. (B2) ours checks every owned item, the original only items whose events it changes; no mission event exists for decorations, so no output difference [G]. (B3) load order: see the ordering risk above [U].

### 2.4 Flow design (bonus)

Common seed: `prof.exp = "12000"` (the level-12 fountain needs it; `mission-C09-11.mjs` uses the same), `prof.DCCoins = "500000"`.

**D-BONUS-1: C03 Rep 25 (default) and C04 Rep2 99 (alt), same spot.**

- Existing house: tutorial bungalow `houses_001_001` sid 2171 at (4,2), footprint (4..5, 2..3), waiting for contract [V]. Its current influence is 2, from `decorations_tree_01` sid 2090 at (4,1) (ratio 1, area covers (4,2)) [V, computed].
- Seed: `Missions = [{Up:[], chunk:"25"}, {Reached:[], chunk:""}, {Given:[], chunk:"10"}]` (25 needs `unlockSku="10"`). For C04 Rep2: `flags` gets `altMissions:1` and Up chunk `"99"` (`docs/missions-flow-recipes.md`, alt flag).
- Action (the trigger): buy `decorations_font_02` on Decorations page 5 (`mission-C09-11.mjs`: shop `c(618,459)`, Decorations tab `c(536,164)`, page navigation `(426,381)` / `(743,381)`, buy button `(641,358)`), then place it with origin (6,2): click `(572,369)` (2x2 convention). Tiles (6..7, 2..3) are free and unowned [V, computed].
- Result: the fountain's area covers (4..5, 2..3) (x in [4,9], y in [0,5]) [V, computed]. Influence of 2171 becomes 2 + 14 = 16.
- Expected original commands: `update_pollmanager {type:"bonus", parameter:"houses_001", value:"1"}` then `value:"2"` (conditions 12 and 16 both met; 26 gets reached without its unlock) [V by code]. For C04 Rep2: a single `{type:"bonus", parameter:"houses_001_001", value:"1"}`.
- Expected reached: 25 (and 26 in default) gets REACHED: `update_missions` (`MissionObjectManager.as:283-287`) [V by code].

**D-BONUS-2: C05 Rep 27 (`houses_002_001`, condition 30; needs 26 Given).**

- Seed: `Missions` Up `"27"`, Given `"26"`; terrain seeds (9 tiles, the footprint of the duplex) = rectangle x 3..5, y -3..-1 (none owned today) [V, computed].
- Build `houses_002_001` (3x3, level 1, 100,000 coins; `rules/itemDefinitions.xml`, `tenants="5"`, `contractsTypeSku="3"`) at origin (3,-3). Its footprint is free, HQ-connected through (3,0), (4,0), (5,0) [V, computed]. Current influence: 5, from tree_05 at (0,1) [V, computed].
- Build two fountains, both unowned and free: origin (6,-4) (click `(572,177)`) and origin (6,-2) (click `(572,241)`). Each covers the duplex (x in [4,9]) and neither overlaps it [V, computed].
- Influence after the first fountain: 5 + 14 = 19 (no event). After the second: 5 + 14 + 14 = 33 >= 30: one `update_pollmanager {type:"bonus", parameter:"houses_002_001", value:"1"}`; condition 60 (sku 28) is not met [V, computed].
- Duplex click: `(492,225)` (3x3 convention, origin (3,-3)).

**Not designed: C04 Rep 29** (`houses_006_001`, level 17 house, 4x3, `constructionCoins="2000000"`; needs 90%, about 7 fountains). Use C04 Rep2 99.

### 2.5 Risks (bonus)

- [U] Boot-time versus in-session trigger (ordering risk, 2.2). The designs use the in-session placement on purpose; a seeded version is only a fallback.
- [G] Expected commands depend on whether both conditions of `bonus houses_001` are satisfied in one call (D-BONUS-1). A different order of conditions changes the `value` strings only.
- [U] Whether the original's placement of a fountain touches all tiles of the house in the same call (multiple registrations and checks).

## 3. checkInfluence classes C13, C14 (mission event `checkInfluence`)

### 3.1 Representatives

| Class | Rep (default/alt) | XML attributes | Rep2 |
|---|---|---|---|
| C13 | 23 | `sku="23" unlockLevel="7" type="checkInfluence" parameter="commerce_flower_shop" amount="1" condition="30"` (line 24) | 93 (alt): `sku="93" unlockLevel="1" type="checkInfluence" parameter="commerce_pizza" condition="5" showInABtest="alt_missions"` (line 93) |
| C14 | 18 | `sku="18" unlockSku="2" type="checkInfluence" parameter="commerce_pizza" amount="1" condition="3"` (line 19) | 266 (alt): `sku="266" unlockSku="93" unlockLevel="1" type="checkInfluence" parameter="commerce_pizza" condition="10" showInABtest="alt_missions"` (line 262) |

Siblings in the default set: 19 (pizza, 10, `unlockSku=18`), 20 (pizza, 16, `unlockSku=19`) share the pizza event with 18. Alt set: only 93 (5) and 266 (10) share it, because the default ones are not built when `altMissions` is set (`MissionObjectManager.as:378-386`, `:710-717`) [V]. Mission 2 is `type="buy" parameter="commerce_pizza"` (line 3) [V].

### 3.2 How the original counts it

- **Emission, per frame.** `StateOnRent.doDoLogicUpdate` (`StateOnRent.as:1177`). The block at `:1348-1366` runs for a commerce owned by me (`isMine() && isACommerce()`). It calls `checkCondition(population, sid)` on `"checkInfluence" + nameType` (nameType "Commerces", `:1350-1357`) and on `"checkInfluence" + sku` (`:1359-1364`), only when `needsToBeChecked()`. The population is computed once per call (`getPopulation()`, `:1353-1356`).
- Early exit: before the tutorial ends, commerces return early (`StateOnRent.as:1193-1195`); not relevant post-tutorial [V].
- **Population** = sum over houses in `mInfluenceItemsAffectedByCommerce` of their `getPopulation()` (`ItemObject.as:2011-2024`; list built in `:743-765` from `mInfluenceItems` filtered by private `isAffectedByType`, `:2614-2623`). A house passes the filter only if `!mIsSuspended` (HQ connected) and its state's `isAffectedByType` is true: `StateOnRent.as:1538-1541` (MODE_GET_RENT or MODE_RENTING), `StateOnSelling.as:100-102` (false) [V].
- **House population** = tenants once it has a contract (`mContract != null`), else 0 (`ItemObject.as:2011-2024`; `ItemDefinition.getTenants`). Tenants: `houses_001_001` 3, `houses_002_001` 5, `houses_023_001` 20 (`rules/itemDefinitions.xml`) [V].
- **Area** = the commerce's `influenceRatio` (pizza 2, florist 3: `rules/commerceDefinitions.xml` lines 2 and 4) with the rule in section 0 [V].
- **Threshold** = `population >= condition` (`PollEvent.as:215`), one register per condition; the commands are `update_pollmanager {type:"checkInfluence", parameter:"commerce_pizza", value:"N"}` [V].
- Reached: `MissionObject.logicUpdate` (`MissionObject.as:208-250`), then `update_missions` (`MissionObjectManager.as:283-287`) [V].
- Owner only (`RoleOwner.as:133-136`) [V].

### 3.3 How our client does it

- `apps/client/src/game/game.ts:665-693`: `tick` calls `emitPopulation()` every frame (`:682`); for each commerce in state RENT (`:689`) it emits `commerce-population` **only when the value changed** (`:690-692`).
- `apps/client/src/ui/missions/system.ts:170-175`: `checkEvent("checkInfluence"+"Commerces", pop, sid)` and `checkEvent("checkInfluence"+sku, pop, sid)` [V].
- Population: `economy.ts:281-304` (`isAffecting` = RENT, mode RENTING or GET_RENT, not disconnected; `housePopulation` = tenants when `contractSku` is set; `population` = `commercePopulation`). Influence index: `influence.ts:73-92`, `:119-131`. Disconnection: `influence.ts:134-200` [V].
- PollEvent port: `game/missions.ts:173-332` (`checkEvent` :312-316, `check` :247-259). [V]

### 3.4 Differences (checkInfluence)

- (C1) Ours emits on change; the original checks every frame. Values are equal, but if the PollEvent does not exist at the first emission, ours loses the value (the `lastPopulation` cache is already set; `game.ts:690-692`; `checkEvent` is a no-op, `missions.ts:312-316`), while the original re-checks every frame. **[U]** whether this happens in practice (ordering of `MissionSystem` creation and the first tick).
- (C2) Disconnection: ours uses a flood fill (`influence.ts:181-200`); the original uses A* (`Map.as:2461`). Same intent, not oracle-verified [G].
- (C3) Whether a suspended commerce still runs `doDoLogicUpdate` in the original is **[U]**. Ours does not check the commerce's own connection in `emitPopulation`.

### 3.5 Flow designs (checkInfluence)

Common geometry: pizza P at origin (6,1) covers x in [4,10], y in [-1,5] [V, computed] and contains the tutorial bungalow 2171 footprint (4..5, 2..3) [V, computed]. P's footprint (6..8, 1..3) is free, unowned (seed 9 tiles: `6:1,7:1,8:1,6:2,7:2,8:2,6:3,7:3,8:3` appended to the Terrain chunk) and HQ-connected through (6,0), (7,0), (8,0) [V, computed].

**D-PIZZA-A: C14 Rep 18 (pop >= 3).**

- Seed: exp `6000`, DCCoins `500000`, Missions `Given:"2"` (18 needs `unlockSku="2"`; 18 becomes UNLOCKED through `logicUpdate`, `MissionObject.as:208-220`), terrain as above.
- Actions: shop `c(618,459)`, Commerces tab `c(407,164)`, pizza card `c(255,348)` (both from `mission-C17-31.mjs`, re-check with a screenshot), place P at `(588,353)` (3x3 convention for origin (6,1)). Finish construction as `mission-C17-31.mjs` does (`mutateDoc`: pizza `Item[0].time = "2000"`, `savedAt = now`, then `reload()` after `sleep(8000)`) [U for exact timing].
- Sign the contract on 2171: click the house at `(506,364)` (recipe, `docs/missions-flow-recipes.md`), then the first contract card `(290,215)`. Population becomes 3 when 2171 reaches RENTING/GET_RENT.
- Expected original commands: `update_pollmanager {type:"checkInfluence", parameter:"commerce_pizza", value:"1"}`, then `update_missions` for sku 18 after claim [V by code, timing U].

**D-PIZZA-B: C13 Rep2 93 (alt, pop >= 5).** Flags `altMissions:1`, Up `"93"`. P as above, plus the existing 2171 (3) and a new `houses_001_001` at origin (3,-2): footprint (3..4, -2..-1), 4 seeded tiles (3,-2), (3,-1), (4,-2), (4,-1), HQ-connected through (3,0), (4,0), in P's area through (4,-1) [V, computed]. Click `(476,241)`. Population 3 + 3 = 6 >= 5: one `value "1"` for condition 5.

**D-PIZZA-C: C14 Rep2 266 (alt, pop >= 10; needs 93 Given).** Flags `altMissions:1`, Given `"93"`. P, 2171, plus a `houses_002_001` duplex at origin (3,-3) (footprint 3..5 x -3..-1; 9 seeded tiles; click `(492,225)`), and a `houses_001_001` at origin (6,-2) (footprint 6..7 x -2..-1; 4 seeded tiles; click `(572,241)`). Both are HQ-connected and do not overlap P or each other [V, computed]. Sign 2171 first, then the duplex, then the bungalow. Population: 3 -> 8 -> 11. Expected: `value "1"` (cond 5) after the duplex is signed, then `value "2"` (cond 10) after the bungalow [V by code].

**D-FLORIST: C13 Rep 23 (pop >= 30, level 7).** Florist (`commerce_flower_shop`, 3x3, level 7, 250,000 coins, ratio 3) at origin (3,-3) (area x in [0,8], y in [-6,2]; 9 seeded tiles; click `(492,225)`). Two `houses_023_001` (2x2, 20 tenants, level 7, 600,000 coins each, `contractsTypeSku="9"`) at origin (6,-2) (click `(572,241)`) and (6,1) (click `(572,337)`) [V, computed]. Population 40 >= 30: one `value "1"`. [U] whether contract type 9 is available at level 7 and whether these two houses can be signed in the flow. Cost is about 1.45M coins, so seed DCCoins at about 1,500,000.

### 3.6 Risks (checkInfluence)

- [U] First emission at boot (C1). A seeded RENT commerce with a seeded RENTING house would test this at boot; the designs above use in-session contract signing instead.
- [U] Construction completion via `mutateDoc` (the pizza must be RENT before its population counts).
- [G] The house click `(506,364)` and card `(290,215)` come from another flow's recipe; re-check with a screenshot.
- [U] Suspension of the commerce itself (C3).

## 4. giveEmail class C25

### 4.1 Representatives

- C25 Rep 64: `sku="64" unlockLevel="1" type="giveEmail" amount="1" rewardType="commerce_vip" rewardAmount="1"` (line 65). No `parameter`.
- Rep2 94 (alt): `sku="94" unlockLevel="2" type="giveEmail" amount="1" rewardType="coins;exp" rewardAmount="40000;100" showInABtest="alt_missions"` (line 94).

### 4.2 How the original triggers it (the UI action)

- **Opening the popup.** A click on the mission (missions panel `MissionsBox.as:110` or map icon `MissionsIconLayerDisplay.as:345`) calls `MissionObjectManager.openDescription`; for `giveEmail` it creates `PopupEmail` (`MissionObjectManager.as:450-481`, branch at 461-466) [V].
- **The event is not a PollManager event.** `MISSION_EVENT_GIVE_EMAIL` is referenced only in `MissionsEventIDs.as:54` and `MissionObjectManager.as:461` [V, grep]. Nothing registers a `giveEmail` poll. Mission 64 becomes REACHED from `CheckConfirmEmail` (below).
- **PopupEmail** (`GUI/PopupEmail.as`): fields default to `example` / `domain.com` (`:72-73`); the first click clears them (`:165-169`); user-field restriction (`:81-82`); legal checkbox toggles OK (`:148-158`); OK is enabled after the user name is typed and the checkbox is ticked (`:181-191` on FOCUS_OUT, `:171-179`); validation `checkMail` (`:202-224`: `TextManager.isMail`, and a domain containing "domain" is refused); `sendMail` (`:226-255`) calls `Server.wcrmServerURL + "/registration/register/..."` (or `checkSendMail.xml` in offline mode) [V].
- **Patched client.** The oracle loads `/client/Dollars.private.swf` (`apps/server/src/launcherHtml.ts:574-575`; `serverApp.ts:225-227`), built from `client-patch-sources/...PopupEmail.as` (entry in `apps/server/src/scripts/prepareClient.ts:70-73`). The only change against the decompiled source is one added line after the checkmail block: `CheckConfirmEmail.getInstance().load();` (patched file line 280; `diff --strip-trailing-cr` shows no other difference) [V]. So the original calls the confirmation check immediately after OK.
- `checkMailSent` (`PopupEmail.as:261-286`): status 0/1/2 shows the advice popup (`ShowPopup`), and if `checkmail == "0"` sets it to `"1"` (`:276-279`). The setter sends `update_profile` (`model/profile/Profile.as:1741-1747`, mIsMe) [V].
- `CheckConfirmEmail.load` (`utils/metrics/CheckConfirmEmail.as:66-79`) requests `isconfirmed` (or `checkMail.html` offline). `checkStatus` (`:50-64`): if the body is `"1"`, `getMissionBySku("64").changeState(REACHED)` and `checkmail = "2"` [V].
- Server stubs (oracle-side, shared by both clients): `apps/server/src/serverApp.ts:273-290`: `register` marks the address submitted and answers status 0; `isconfirmed` answers `"1"` once submitted [V].
- Boot path (also a reload check): `WelcomeProgress.as:770-776` (`STEP_CHECK_MAIL`) runs `CheckConfirmEmail.load` when `checkmail != "2"`; the welcome starts once per session when the tutorial has ended and the role is owner (`DollarsGame.as:1597-1600`) [V].
- **Alt set (94).** In the alt set, mission 64 (no `showInABtest`) is not built (`MissionObjectManager.as:378-386`), so `getMissionBySku("64")` returns undefined (`:170-173`) and `checkStatus` would throw on `changeState`. Predicted: 94 is never reached and `checkmail` stays `"1"` [G on runtime effect, V on code path].

Predicted original sequence for Rep 64, one OK click: `update_profile {value:"1", action:"checkmail"}`, then `update_profile {value:"2", action:"checkmail"}`, then `update_missions` for 64 (REACHED), all within the HTTP round trip; no reload needed [V by code, timing U].

### 4.3 How our client does it

- `apps/client/src/ui/missions/popups.ts:51-55` -> `apps/client/src/ui/extras/email.ts:64-121` (own popup built from the `popup_mission_Email` widget).
- OK (`email.ts:101-113`): `emailError` (`:38-42`), `localStorage 'mcity.email'` (`:109`), then `ctx.game.sendCommand(checkmail(MAIL_CHECKED))` (`:110`, value 2), then `hooks.onConfirmed` (`ui/missions/index.ts:45-51` -> `sys.manager.forceReached(obj)`), then `p.accept()`. The advice popup follows accept (`email.ts:115-118`) [V].
- `forceReached` (`game/missions.ts:772-774`): UNLOCKED -> REACHED for the CLICKED mission (64 or 94) [V].
- No `register` request, no `checkmail "1"`, no `isconfirmed` call: `grep` over `apps/client/src` finds only comments [V].

### 4.4 Differences (giveEmail)

- (E1) Default 64: the original sends `checkmail "1"` then `"2"` and reaches 64 after the confirmation round trip; ours sends only `"2"` and reaches 64 at OK. Final documents should match (`checkmail "2"`, 64 REACHED). **Predicted DIFFERENT at command level** [G, needs oracle].
- (E2) Alt 94: the original does not reach 94 (predicted: `checkmail` stays `"1"`); ours reaches 94 and sets `checkmail "2"`. **Predicted DIFFERENT** [G on runtime, high confidence on code].
- (E3) Ours shows the advice popup at accept; the original after the server status. Ordering only [G].

### 4.5 Flow design (giveEmail)

- Seed: Default: Missions `Up:"64"`; `checkmail` stays `"0"` (already `"0"` in the baseline, `pt.json` profile) [V]. Alt: `flags` gets `altMissions:1`, Up `"94"`, checkmail `"0"`.
- Actions: missions panel `c(35,357)` (recipe); first list entry `c(517,220)` (recipe; verify that 64 is first, because other unlocked missions may come first) [U]. In the popup: click the user field (**coordinates [U]**), type `tester`; click the domain field [U], type `example.com` (must not contain "domain"); tick the checkbox [U]; press OK [U]. Wait about 3 s, then `dump("completed")`. Close the advice popup [U] and the reward popup [U] (the claim is a separate click, [U]).
- Expected original commands: `update_profile checkmail "1"`, `update_profile checkmail "2"`, `update_missions` for 64. Expected ours: `update_profile checkmail "2"`, `update_missions` for 64 (no `"1"`).
- Reload check: `sleep(8000)`, `reload()`, `dump("final")`. For the original, the welcome check should be a no-op (checkmail is already `"2"`).

### 4.6 Risks (giveEmail)

- [U] All popup coordinates. Screenshots are required before any click.
- [U] Alt 94 original behaviour (TypeError versus silent failure; whether a dialog blocks later clicks).
- [U] The welcome steps before `STEP_CHECK_MAIL` may show popups that need clicks on reload.
- [G] HTTP timing: the flow must wait for the register and isconfirmed round trips before dumping.

## 5. Predicted differences (summary)

| Class | Rep | Predicted result | Confidence |
|---|---|---|---|
| C03 | 25 | Both emit `"1"`, `"2"` for the same house event if the placement registers; ordering vs load time unknown | medium (B3) |
| C04 | 99 (alt) | Single `"1"` | medium |
| C05 | 27 | Single `"1"` after the second fountain | medium |
| C13 | 93 (alt) | Single `"1"` after the bungalow | medium (C1, C3) |
| C14 | 18 | `"1"` after the contract signs | medium (contract timing) |
| C14 | 266 (alt) | `"1"` then `"2"` | medium |
| C13 | 23 | Not run; cost and contract type 9 unknown | low |
| C25 | 64 | Extra `checkmail "1"`; reached later in the original | high (code), needs oracle |
| C25 | 94 (alt) | Original does not reach; ours reaches | high (code) |

## 6. Unknowns (ranked)

1. **Boot-time versus in-session emission** (PollEvent creation order versus item init, `Profile.as:572-573` versus `ItemObject.as:1667-1678`; ours `game.ts:690-692` change-only emission). Decide with one seeded boot run per class before relying on any seeded house or commerce.
2. **Placement and construction mechanics**: exact click conventions for 2x2 and 3x3 blocks, construction completion via `mutateDoc`, and contract signing timing for a waiting house (2171).
3. **The email popup and the alt-94 runtime**: popup coordinates, whether a TypeError in `checkStatus` blocks later actions, and whether the welcome steps need clicks on reload.
4. **Commerce suspension** (whether a suspended commerce still runs its logic tick).
5. **houses_023_001 availability** (contract type 9 at level 7) for the florist design.
6. **Condition order in merged events**: our `PollEvent.build` and `addCondition` must keep the original order (`MissionObjectManager.as:686-725`); this decides the `"1"`/`"2"` values.
