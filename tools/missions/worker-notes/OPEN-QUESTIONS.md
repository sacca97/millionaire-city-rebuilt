# Open questions for the Lead (strong model / human)

The sequential agent appends here ONLY when it hit something that needs judgement (a difference between the clients, a mission that does not complete in the original, an unclear mechanism). One entry per item: class, mission sku, what you ran, verbatim output, screenshot or dump paths. Do not try to resolve them yourself.

## C31 (nameCity) — sku 1

- Flow: `tools/oracle/flows/mission-C31-1.mjs`. Both clients ran; mission 1 ended `given` on both.
- `python3 tools/missions/verify.py --flow mission-C31-1 --skus 1 --class C31 --reward-group 0 --reload --orig tools/oracle/out/flow --ours /tmp/ours-solo-C31` -> exit 1.
- Verbatim output:

```
mission-C31-1: DIFFERENT (3 differences, 0 accepted)
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=152000
   completed.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791385236501' OURS='1791385396504'
   final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791385236501' OURS='1791385396504'
```

- Evidence kept at `/tmp/solo-C31-evidence/{orig,ours}/` (screenshots + cmds.jsonl + dumps); note: `tools/missions/worker-notes/C31.md`.
- Needs lead judgement: is `compValueGain` a real product difference or a flow/seed artifact? Is the daily-rewards timestamp difference acceptable?
- Also tooling note: `node tools/oracle/run.mjs flow` writes to `tools/oracle/out/flow` regardless of `FLOW=...`, so verify was run with `--orig tools/oracle/out/flow` (the instructions' `out/flow-mission-<class>-<rep>` path does not match the current harness). Scratch copies were made because the dir is overwritten by the next class.

## C26 (instantBuild) — sku 5

- Flow: `tools/oracle/flows/mission-C26-5.mjs` (attempt 1 with 4.5M coins failed on the original: earn mission 44 auto-completed at boot and its reward popup swallowed all clicks; attempt 2 with `DCCoins=500000` completed mission 5 on both clients).
- `python3 tools/missions/verify.py --flow mission-C26-5 --skus 5 --class C26 --reward-group 0 --reload --orig tools/oracle/out/flow --ours /tmp/ours-solo-C26` -> exit 1.
- Verbatim output (first 25 lines of 35):

```
mission-C26-5: DIFFERENT (31 differences, 0 accepted)
   cmds:    #0 /_dat/security/coinsGain: ORIG=-517 OURS=-513
   cmds:    #0 /_dat/time: ORIG=595702 OURS=591300
   cmds: == ('update_item', 'new_state', None, 1) orig x0 ours x1
   cmds:    only in OURS {"_cmd": "update_item", "_dat": {"action": "new_state", "millis": 43031, "mode": 1, ... "compValueGain": 30000, ... "sid": "2172", "sku": "houses_001_001", "state": 1, "time": 0}}
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=152000
   cmds:    #16 /_dat/security/coinsNow: ORIG=465483 OURS=465487
   cmds:    #17 /_dat/security/compValueNow: ORIG=841483 OURS=841487
   completed.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791385680019' OURS='1791385803107'
   completed.saves.json: universe/universe[0]/DCCoins: ORIGINAL='465483' OURS='465487'
   completed.saves.json: universe/universe[0]/companyValue: ORIGINAL='842000' OURS='911487'
   completed.saves.json: .../Company[houses_001_001@6,-2]/Item[id0]/mode: ORIGINAL='4' OURS='<missing>'
   completed.saves.json: .../Company[houses_001_001@6,-2]/Item[id0]/time: ORIGINAL='595699' OURS='<missing>'
   completed.saves.json: .../Company[houses_001_001@6,-2]/Item[id1]/mode: ORIGINAL='<missing>' OURS='1'
   completed.saves.json: .../Company[houses_001_001@6,-2]/Item[id1]/time: ORIGINAL='<missing>' OURS='0'
   final.saves.json: universe/universe[0]/DCCoins: ORIGINAL='465483' OURS='465487'
   final.saves.json: universe/universe[0]/companyValue: ORIGINAL='842000' OURS='911487'
   (end first 25 lines; full output in tools/missions/worker-notes/C26.md)
```

- Evidence kept at `/tmp/solo-C26-evidence/{orig,ours}/`; note: `tools/missions/worker-notes/C26.md`.
- Needs lead judgement: `compValueGain: ORIG=0 OURS=152000` recurs here (same as C31); ours emits an extra `update_item/new_state mode=1` and stores item id=1/mode=1/time=0 while the original keeps item id=0/mode=4/time=595699; `companyValue` 842000 vs 911487; instant-build cost 517 vs 513 coins.

## C12 (buyExpansion) — sku 4

- Flow: `tools/oracle/flows/mission-C12-4.mjs` (attempt 1 blocked by earn-reward popups; attempt 2 opened the Buy Expansion dialog but the 4M coin option was unaffordable at 590k coins; attempt 3 with `DCCoins=4500000` + popup dismissals completed mission 4 on both clients).
- `python3 tools/missions/verify.py --flow mission-C12-4 --skus 4 --class C12 --reward-group 0 --reload --orig tools/oracle/out/flow --ours /tmp/ours-solo-C12` -> exit 1.
- Verbatim output:

```
mission-C12-4: DIFFERENT (12 differences, 2 accepted)
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=10152000
   cmds:    #26 /_dat/security/compValueGain: ORIG=1740000 OURS=0
   cmds:    #26 /_dat/security/compValueNow: ORIG=8827000 OURS=7087000
   cmds:    #27 /_dat/security/compValueGain: ORIG=1740000 OURS=0
   cmds:    #27 /_dat/security/compValueNow: ORIG=8827000 OURS=7087000
   cmds: == ('update_pollmanager', 'update', 'earn', None) orig x3 ours x4
   cmds:    #0 /_dat/parameter: ORIG='companyValue' OURS='DCCoins'
   cmds:    #1 /_dat/value: ORIG='2' OURS='1'
   cmds:    #2 /_dat/value: ORIG='3' OURS='2'
   cmds:    only in OURS {"_cmd": "update_pollmanager", "_dat": {"action": "update", "parameter": "companyValue", "type": "earn", "value": "3"}}
   completed.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791386262072' OURS='1791386387745'
   final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791386262072' OURS='1791386387745'
```

- Evidence kept at `/tmp/solo-C12-evidence/{orig,ours}/`; note: `tools/missions/worker-notes/C12.md`.
- Needs lead judgement: `compValueGain` mismatch recurs (C31, C26, C12); ours sends `update_pollmanager earn` with parameter `DCCoins` where the original uses `companyValue`, and one extra time.

## C23 (earn) — skus 43 (DIFFERENT) and 98 (BLOCKED)

- Flow sku 43: `tools/oracle/flows/mission-C23-43.mjs`. Original and ours both completed it (`43: given`). verify exit 1:

```
mission-C23-43: DIFFERENT (3 differences, 0 accepted)
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=642000
   completed.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791386580692' OURS='1791386692479'
   final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791386580692' OURS='1791386692479'
```

- Flow sku 98: `tools/oracle/flows/mission-C23-98.mjs`, mission `showInABtest="alt_missions"`. In the ORIGINAL the mission never left `up` (coins 990000 -> 1025000 only from mission 44) with: (1) no flags, (2) `prof.flags="alt_missions:2"` (persisted as `"flags": "alt_missions:2,stopFirstSessionPopups:1"`), (3) `prof.flags="alt_missions:1"`. No verify run. Needs lead: how is `showInABtest="alt_missions"` activated (server-side user flag? different flag name/value?). Affects Rep2 of C31 (89), C12 (151), C24 (308). Evidence: `/tmp/solo-C23-evidence/orig-98-alt1/`; note: `tools/missions/worker-notes/C23.md`.

## C24 (earn) — skus 45 (DIFFERENT) and 308 (BLOCKED)

- Flow sku 45: `tools/oracle/flows/mission-C24-45.mjs`. Original and ours both completed it (`45: given`). verify exit 1:

```
mission-C24-45: DIFFERENT (8 differences, 2 accepted)
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=4452000
   cmds:    #1 /_dat/security/compValueGain: ORIG=0 OURS=4452000
   cmds: == ('update_pollmanager', 'update', 'earn', None) orig x2 ours x3
   cmds:    #0 /_dat/parameter: ORIG='companyValue' OURS='DCCoins'
   cmds:    #1 /_dat/value: ORIG='2' OURS='1'
   cmds:    only in OURS {"_cmd": "update_pollmanager", "_dat": {"action": "update", "parameter": "companyValue", "type": "earn", "value": "2"}}
   completed.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791387276346' OURS='1791387387593'
   final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791387276346' OURS='1791387387593'
```

- Flow sku 308: `tools/oracle/flows/mission-C24-308.mjs` (`showInABtest="alt_missions"`, `unlockSku="98"`). Original left `308: up` (coins 4800000 -> 4890000 only from 44/45); 98 is blocked in C23, so 308 cannot unlock either. No verify run. Evidence: `/tmp/solo-C24-evidence/orig-308/`; note: `tools/missions/worker-notes/C24.md`.
- The `update_pollmanager earn` mismatch from C12 (ours uses parameter `DCCoins`, original `companyValue`, one extra update) recurs in C24-45.

## C09 (build sku, n>1) — sku 11 BLOCKED

- Flow `tools/oracle/flows/mission-C09-11.mjs`: after 3 original-flow attempts the mission never left `up`.
- What was learned: `decorations_font_02` = "Fountain" (level 12, 2x2, 80,000 coins) is on Decorations shop page 5 (4 right-arrow clicks; price button stage (641,358)); exp 12000 reaches level 12. A 6x2 terrain strip at x {556,588,620,652,684,716}, y {225,257}, placement centres (572,241),(636,241),(700,241). The shop REMEMBERS its last page: re-opening it already shows page 5 (`07-11-shop.png`).
- Attempts: (1) wrong price y, (2) page-1 card bought `decorations_font_06` instead of `font_02`, (3) first Fountain bought+placed OK but iterations 2-3 re-navigated left/right and landed on page 9, so only one of three was built.
- Fix for the next attempt: drop the page navigation for iterations 2-3 (just open shop -> Decorations tab -> click (641,358) on the remembered page). Evidence: `/tmp/solo-C09-evidence/orig-attempt3-partial/`; note: `tools/missions/worker-notes/C09.md`. Rep2 sku 92 is `alt_missions` (same block as C23-98).

## C10 (build nameType, n>1) — sku 10 DIFFERENT

- Flow `tools/oracle/flows/mission-C10-10.mjs`. Original and ours both completed it (`10: given`). verify exit 1:

```
mission-C10-10: DIFFERENT (14 differences, 0 accepted)
   cmds:    #1 /_dat/security/coinsNow: ORIG=493000 OURS=492000
   cmds: == ('update_map', 'del', 'Terrain', None) orig x2 ours x0
   cmds:    only in ORIG {"_cmd": "update_map", "_dat": {"action": "del", "security": {"coinsGain": 1000, "coinsNow": 494000, ...}, "sid": "1", "type": "Terrain", "x": "6", "y": "-2"}}
   cmds:    only in ORIG {"_cmd": "update_map", "_dat": {"action": "del", "security": {"coinsGain": 1000, "coinsNow": 493000, ...}, "sid": "1", "type": "Terrain", "x": "7", "y": "-2"}}
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=152000
   cmds:    #16 /_dat/security/coinsNow: ORIG=494000 OURS=492000
   cmds:    #18 /_dat/security/coinsNow: ORIG=529000 OURS=527000
   completed.saves.json: universe/universe[0]/DCCoins: ORIGINAL='494000' OURS='492000'
   completed.saves.json: .../Map[0]/chunk: original lacks 6:-2/7:-2, ours keeps them
   final.saves.json: (same three diffs)
```

- Needs lead: the original refunds+deletes two of the four bought terrain tiles after placing 1x1 decorations; ours keeps them (2000 coin difference). Evidence: `/tmp/solo-C10-evidence/{orig,ours}/`; note: `tools/missions/worker-notes/C10.md`.

## C06 (build nameType, n>1) — sku 9 BLOCKED

- Flow `tools/oracle/flows/mission-C06-9.mjs`: 2 attempts, mission never reached `given`.
- The world is isometric: buying 3x3 plots by a fixed screen grid is unreliable and any 3x3 crossing the road row (world y=-3) is rejected with "You must place this building in a 3x3 plot". Attempt 1 bought 6 tiles and placed none; attempt 2 bought 15 tiles and placed exactly one Pizzeria (`commerce_pizza` at world (6,-5), screenshot `11-24-placed.png`). Needs lead: a flow that places five 3x3 commerces clear of the road row (or a helper that translates world tiles to screen). Evidence: `/tmp/solo-C06-evidence/orig-attempt2/`; note: `tools/missions/worker-notes/C06.md`.

## C08 (build sku, n=1) — sku 6 DIFFERENT; sku 96 alt_missions

- Flow `tools/oracle/flows/mission-C08-6.mjs` (copy of `mission-build.mjs`). Both clients completed mission 6; verify exit 1:

```
mission-C08-6: DIFFERENT (4 differences, 0 accepted)
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=152000
   completed.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791392199234' OURS='1791392371406'
   final.saves.json: dailyBonusInfo/dailyRewardsLastGivenDate: ORIGINAL='1791392199234' OURS='1791392371406'
   final.saves.json: universe/universe[sid1]/World[sid1]/Company[houses_001_002@6,-2]/Item[id0]/time: ORIGINAL='861873' OURS='893409'
```

- Rep2 sku 96 is `alt_missions` (blocked). Evidence: `/tmp/solo-C08-evidence/{orig-6,ours-6}/`; note: `tools/missions/worker-notes/C08.md`.

## C07 (build none, n>1) — sku 148 BLOCKED

- Mission 148 is `showInABtest="alt_missions"`. Flow `tools/oracle/flows/mission-C07-148.mjs` (boot+dump only) confirmed the original leaves `148: up` (nothing offered). Needs lead: the same `alt_missions` activation question as C23-98/C24-308/C08-96. Evidence: `/tmp/solo-C07-evidence-orig/`; note: `tools/missions/worker-notes/C07.md`.

## C30 (moveHouse, subgroup) — sku 87 DIFFERENT

- Flow `tools/oracle/flows/mission-C30-87.mjs`. Both clients completed it (`87: given`). verify exit 1:

```
mission-C30-87: DIFFERENT (14 differences, 0 accepted)
   cmds:    #0 /_dat/dec: ORIG=1 OURS=0
   cmds:    #0 /_dat/security/coinsNow: ORIG=495600 OURS=493600
   cmds: == ('update_map', 'del', 'Terrain', None) orig x2 ours x0
   cmds:    only in ORIG {"action": "del", "security": {"coinsGain": 1000, ...}, "type": "Terrain", "x": "6", "y": "-2"}
   cmds:    only in ORIG {"action": "del", "security": {"coinsGain": 1000, ...}, "type": "Terrain", "x": "6", "y": "-1"}
   cmds:    #0 /_dat/security/compValueGain: ORIG=0 OURS=152000
   completed.saves.json: universe/universe[0]/DCCoins: ORIGINAL='515600' OURS='513600'
   completed.saves.json: .../Map[0]/chunk: original lacks 6:-1/6:-2
```

- Same original terrain-refund quirk as C10 (`update_map del Terrain`), plus a new `/ _dat/dec` diff (orig 1, ours 0). Evidence: `/tmp/solo-C30-evidence/{orig-87,ours-87}/`; note: `tools/missions/worker-notes/C30.md`.

## C17/C20/C18/C19/C11/C29/C25 — BLOCKED; C13/C14/C03/C04/C05 — SKIPPED

- C17 sku 31 and C06 sku 9 and C11 sku 2 and C19 sku 32 all need a 3x3 commerce placed/collected. Fixed-screen-grid purchase is unreliable (isometric map; the road row at world y=-3 invalidates a 3x3), so the commerce could not be placed (`You must place this building in a 3x3 plot`). Evidence: `/tmp/solo-C06-evidence/orig-attempt2/`, `/tmp/solo-C17-evidence/orig-attempt1/`.
- C20 sku 55 (`Houses%2`, amount 200): normal Bungalow collection with poll `collectHouses%2/199` or `collectHouses/199` did not complete it; the type/duration poll key and level-2 house requirement are unknown.
- C18 sku 95, C19 rep2 255, C11 rep2 90, C29 sku 110, C25 rep2 94 are `showInABtest="alt_missions"` (never offered; see C23-98).
- C25 sku 64 (`giveEmail`): no in-game trigger found in the rule XML; UI not located, no run.
- C13/C14 (checkInfluence) and C03/C04/C05 (bonus) were SKIPPED(needs lead) per section 6: they need a commerce next to houses plus population, and commerce placement is blocked.
- All notes in `tools/missions/worker-notes/C*.md`.

