# Progress log (the single sequential agent updates this file after EVERY class; re-read it at the start of every session)

Format: one line per class, newest at the bottom. status = EQUAL | DIFFERENT | INVALID | BLOCKED | SKIPPED(needs lead)

| Class | Rep | Flow file | Original ran | Ours ran | verify exit | status | note file / reason |
|---|---|---|---|---|---|---|---|
| C31 | 1 | mission-C31-1.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C31.md (compValueGain 0 vs 152000; dailyRewardsLastGivenDate timing) |
| C26 | 5 | mission-C26-5.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C26.md (31 diffs: compValueGain, update_item/new_state, item id/mode, companyValue) |
| C12 | 4 | mission-C12-4.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C12.md (compValueGain pattern; update_pollmanager earn: companyValue vs DCCoins, 3x vs 4x) |
| C23 | 43 | mission-C23-43.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C23.md (compValueGain 0 vs 642000; daily date) |
| C23 | 98 | mission-C23-98.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C23.md (alt_missions mission never given in original; 3 flag attempts) |
| C24 | 45 | mission-C24-45.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C24.md (compValueGain 0 vs 4452000 x2; update_pollmanager earn 2x vs 3x) |
| C24 | 308 | mission-C24-308.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C24.md (alt_missions + unlockSku 98, never given in original) |
| C09 | 11 | mission-C09-11.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C09.md (3 attempts; shop page navigation bug, fix documented); rep2 92 alt_missions |
| C10 | 10 | mission-C10-10.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C10.md (original refunds/deletes terrain 6:-2,7:-2; coins 494000 vs 492000; compValueGain) |
| C06 | 9 | mission-C06-9.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C06.md (isometric plot geometry + road row; only 1/5 Pizzerias placed, 2 attempts) |
| C08 | 6 | mission-C08-6.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C08.md (compValueGain 0 vs 152000; daily date; build time countdown) |
| C08 | 96 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C08.md (alt_missions) |
| C07 | 148 | mission-C07-148.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C07.md (alt_missions; confirmed 148: up in original) |
| C15 | 35 | mission-C15-35.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C15.md (compValueGain; update_next_rent 5x vs 7x) |
| C16 | 36 | mission-C16-36.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C16.md (only dailyRewardsLastGivenDate timing) |
| C17 | 31 | mission-C17-31.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C17.md (commerce 3x3 placement fails; isometric) |
| C30 | 87 | mission-C30-87.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C30.md (terrain refund 6:-1/6:-2; compValueGain; /_dat/dec 1 vs 0) |
| C20 | 55 | mission-C20-55.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C20.md (Houses%2 amount 200; unknown poll key, 2 attempts) |
| C18 | 95 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C18.md (alt_missions + commerce collect) |
| C19 | 32 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C19.md (5 commerce collects; placement blocked); rep2 255 alt |
| C11 | 2 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C11.md (buy commerce_pizza; placement blocked); rep2 90 alt |
| C29 | 110 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C29.md (alt_missions) |
| C25 | 64 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C25.md (giveEmail UI trigger unknown); rep2 94 alt |
| C13 | 23 | - | n | - | - | SKIPPED(needs lead) | tools/missions/worker-notes/C13.md (needs commerce+population) |
| C14 | 18 | - | n | - | - | SKIPPED(needs lead) | tools/missions/worker-notes/C14.md (needs commerce+population) |
| C03 | 25 | - | n | - | - | SKIPPED(needs lead) | tools/missions/worker-notes/C03.md (needs commerce+population) |
| C04 | 29 | - | n | - | - | SKIPPED(needs lead) | tools/missions/worker-notes/C04.md (needs commerce+population) |
| C05 | 27 | - | n | - | - | SKIPPED(needs lead) | tools/missions/worker-notes/C05.md (needs commerce+population) |
| C24 | 308 | mission-C24-308.mjs | y | y | 0 | EQUAL | tools/missions/evidence/mission-C24-308.json (seed Given:"98" for unlockSku; altMissions:1) |
| C20 | 55 | mission-C20-55.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C20.md (55 given on both; update_next_rent/`_dat/time` command metadata, same class as C15-35) |
| C09 | 11 | mission-C09-11.mjs | y | y | 0 | EQUAL | tools/missions/evidence/mission-C09-11.json (3 free 2x2 grass spots (6,-2)(3,-2)(-4,-2); navigate to shop page 5 every pass) |
| C06 | 9 | mission-C06-9.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C06.md (9 given both; ours emits update_item/new_mode x5 + upd_suspended + 200 exp/build, original keeps mode=1; same construction-end gap as C26) |
| C11 | 2 | mission-C11-2.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C11.md (2 given both; rival-buy payload: orig keeps Item time=180000 & compValue 867200, ours time=0 & 927200) |
| C07 | 148 | mission-C07-148.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C07.md (altMissions:1 activates the set; 148 not advanced by 2 Cypress (mission 92 completed) nor 2 Bungalows — no build poll emitted) |
| C17 | 31 | mission-C17-31.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C17.md (seeded commerce road-connected but Customers 0 -> Income $0, no collect event; 4 attempts) |
| C29 | 110 | mission-C29-110.mjs | y | y | 0 | EQUAL | tools/missions/evidence/mission-C29-110.json (altMissions:1; seeded Cypress (7,-3); move tool drops it on a bought 2x2 plot) |
| C23 | 98 | mission-C23-98.mjs | y | y | 0 | EQUAL | tools/missions/evidence/mission-C23-98.json (H2: altMissions:1; no unlockSku on 98, so no Given seed; first ours run crashed at reload, rerun) |
| C08 | 96 | mission-C08-96.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C08.md (H2: 2 attempts, same diff; orig re-sends update_missions 97-103 after reload and drops them from Up at completion; ours does not) |
| C17 | 31 | mission-C17-31.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C17.md (H1: both complete 31; orig new_mode 6 collect step + one extra update_next_rent; seeded-at-boot checkInfluence gap avoided by in-session signing) |
| C19 | 32 | mission-C19-32.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C19.md (H1: both give 32 from counter 4 + 1 collect; same collect diff as C17; 5 collects is a counter shortcut) |
| C13 | 23 | mission-C13-23.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C13.md (H1: both give 23; update_next_rent 3x vs 1x; final companyValue 2424000 vs 2374000) |
| C14 | 18 | mission-C14-18.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C14.md (H1: both give 18; only update_next_rent 3x vs 1x and house timers) |
| C03 | 25 | mission-C03-25.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C03.md (H1: both give 25; original sends NO bonus poll update, ours sends bonus houses_001 1 and 2; 61 diffs) |
| C05 | 27 | mission-C05-27.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C05.md (H1: both give 27; only PollManager chunk: ours persists bonushouses_002_001/1, original sends no bonus update) |
| C04 | 29 | mission-C04-29.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C04.md (H1: both give 29 (villa 90 pct via 7 fountains); same bonus gap as C05; rep2 99 not run) |
| C18 | 95 | mission-C18-95.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/C18.md (altMissions:1, counter shortcut 4 -> 5; 0 differences, 5 accepted) |
| R04 | 65 g0 | mission-R04-65.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/R04.md (claim update order: unlocked missions sent before claimed sku 65; exp 10000 on sku 11 and 65; mechanism C36) |
| R04 | 65 g1 | mission-R04-65-g1.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/R04.md (same ordering diff, 33 diffs; final coins equal 2450000) |
| R04 | 65 g2 | mission-R04-65-g2.mjs | y | n | - | BLOCKED | tools/missions/worker-notes/R04.md (ours: 5 Chromium crashes/fetch failures after claim; infra) |
| R05 | 61 g0 | mission-R05-61.mjs | y | n | - | BLOCKED | tools/missions/worker-notes/R05.md (ours: 7 infra failures: crashes, screenshot timeouts, SqliteError disk I/O, nav timeout) |
| R05 | 61 g1 | mission-R05-61-g1.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/R05.md (coins 7470000 credited twice in ours: final coins 16445000 vs 8510000) |
| R05 | 61 g2 | mission-R05-61-g2.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/R05.md (0 differences, 3 accepted) |
| R06 | 66 g0 | mission-R06-66.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/R06.md (0 differences, 3 accepted) |
| R06 | 66 g1 | mission-R06-66-g1.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/R06.md (group-1 reward credited twice in ours: DCCoins 1490000 vs 1055000; millionNewsFeed missing) |
| R06 | 66 g2 | mission-R06-66-g2.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/R06.md (0 differences, 3 accepted) |
| C35 | 39 | mission-C35-39.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C35.md (orig: friends bar stays a spinner, no neighbour list offline; 3 attempts, 39 stays up) |
| C36 | 65 | mission-C36-65.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C36.md (orig: partnersList empty offline, friends bar spinner; 65 stays up; 1 attempt, same as C35) |
| C27 | 66 | mission-C27-66.mjs | n | - | - | BLOCKED | tools/missions/worker-notes/C27.md (orig: toolbar chart icon opens nothing (2 attempts); investment window needs the expansion popup, then FB friends offline) |
| C28 | 67 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C28.md (not run: needs the investment window, unreachable in orig via C27) |
| C33 | 68 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C33-C34-C32-C22-C21.md (not run; needs a visit, same as C35) |
| C34 | 69 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C33-C34-C32-C22-C21.md (not run; needs a visit, same as C35) |
| C32 | 40 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C33-C34-C32-C22-C21.md (not run; needs a visit, same as C35) |
| C22 | 77 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C33-C34-C32-C22-C21.md (not run; needs a visit, same as C35) |
| C21 | 104 | - | n | - | - | BLOCKED | tools/missions/worker-notes/C33-C34-C32-C22-C21.md (not run; needs a visit, same as C35) |
| C27 | 66 | mission-C27-66-b.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C27.md (ours never registers investment on claim (invest.ts:269-276); 66 stays Up; orig given + storage reward; counter shortcut investment/7 + 3 claims; mission 44 popup needs closing) |
| C28 | 67 | mission-C28-67.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C28.md (ours never registers investmentDone on claim; 67 stays Up; orig given + storage tree_18; counter shortcut investmentDone/4 + 1 claim) |
| C35 | 39 | mission-C35-39.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/C35.md (rerun with the Rust server: friends bar shows NPCs; 0 differences, 2 accepted) |
| C36 | 65 | mission-C36-65-visits.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/C36.md (40 visits, mission-39 popup closed after the first Home; 0 differences, 2 accepted) |
| C02 | 56 | mission-C02-56-taipei.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/C02.md (seeded house_064_002 Taipei 101 for the city value; 0 differences, 2 accepted) |
| C02 | 183 | mission-C02-183-taipei.mjs | y | y | 0 | EQUAL | tools/missions/worker-notes/C02.md (25 s wait before the dump: mission chain 98/122/308-314 finishes; 0 differences, 2 accepted) |
| C22 | 77 | mission-C22-77.mjs | n | - | - | INVALID | tools/missions/worker-notes/C22.md (2 attempts, both invalid: orphan oracle server PID 815722 holds port 32650, its kill was denied by the permission system; not run) |
| C21 | 104 | mission-C21-104.mjs | n | - | - | INVALID | tools/missions/worker-notes/C21.md (not run; same orphan-server blocker as C22; static: no collectUpgraded emitter in apps/client, game.ts:1467) |
| C27 rerun | 66 | mission-C27-66-b.mjs | y (not rerun) | y | 1 | DIFFERENT | tools/missions/worker-notes/C27.md "Rerun after fix" (66 now Given in ours, storage reward present; 144 diffs left: invest_results type, update_money invest_reward, DCCoins/companyValue save timing, flags) |
| C28 rerun | 67 | mission-C28-67.mjs | y (not rerun) | y | 1 | DIFFERENT | tools/missions/worker-notes/C28.md "Rerun after fix" (67 now Given in ours, storage reward present; 131 diffs left, incl. mission 64 dropped from ours Up, not traced) |
| C33 | 68 | mission-C33-68.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C33.md (68 Given in orig, Up in ours: no `upgrade` event in visit.ts:211-226; type 0 vs 1 and reward 100 vs 150; over the attempt budget with calibration runs, see note) |
| C34 | 69 | mission-C34-69.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C34.md (69 Given in orig, Up in ours: same missing `upgrade` event; counter 50 vs 49) |
| C32 | 40 | mission-C32-40.mjs | y | y | 1 | DIFFERENT | tools/missions/worker-notes/C32.md (40 Given in orig, Up in ours: same missing `upgrade` event, nameType "Houses") |
| C27 rerun 2026-11-01 | 66 | mission-C27-66-b.mjs | y (not rerun) | y | 1 | DIFFERENT | tools/missions/worker-notes/C27.md "Rerun 2026-11-01" (invest_results type 5, no invest_reward, flags fixed; 121 left: mission 64 sent late in ours = give-back gate system.ts:90-91, no ?nogiveback in this run; rest is investmentsList id-keyed harness artifact) |
| C28 rerun 2026-11-01 | 67 | mission-C28-67.mjs | y (not rerun) | y | 1 | DIFFERENT | tools/missions/worker-notes/C28.md "Rerun 2026-11-01" (with ?nogiveback=1 no product diff left in cmds/saves; 108 left are all investmentsList id-keyed harness artifact) |
| C22 rerun 2026-11-01 | 77 | mission-C22-77.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C22.md "Rerun 2026-11-01" (collectUpgraded now in ours; ordering only vs orig) |
| C21 rerun 2026-11-01 | 104 | mission-C21-104.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C21.md "Rerun 2026-11-01" (collectUpgraded now in ours; accepted cmds #0 /_dat/time rule is not flow-limited) |
| C34 rerun 2026-11-01 | 69 | mission-C34-69.mjs | y | y (?nogiveback=1) | 1 | DIFFERENT | tools/missions/worker-notes/C34.md "Rerun 2026-11-01" (69 Given both; 18 left: add_upgrade_item ownerId/visitorId payload ids, StateOnRentVisitor.as:42-43 vs visit.ts:222; 3 attempts) |
| C33 rerun 2026-11-01 | 68 | mission-C33-68.mjs | y | y (?nogiveback=1) | 1 | DIFFERENT | tools/missions/worker-notes/C33.md "Rerun 2026-11-01" (68 Given both; same 18 id-payload lines as C34) |
| C32 rerun 2026-11-01 | 40 | mission-C32-40.mjs | y | y (?nogiveback=1) | 1 | DIFFERENT | tools/missions/worker-notes/C32.md "Rerun 2026-11-01" (40 Given both; same 18 id-payload lines as C34) |
| C27 rerun 2026-11-01 (b) | 66 | mission-C27-66-b.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C27.md "Rerun 2026-11-01" (0 left, 8 accepted: dailyRewards + investment startedAt ids 900001+) |
| C28 rerun 2026-11-01 | 67 | mission-C28-67.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C28.md "Rerun 2026-11-01" (0 left, 8 accepted: same as C27) |
| C01 | 3 | mission-C01-3.mjs | y | y (?nogiveback=1) | 1 | DIFFERENT | tools/missions/worker-notes/C01.md (3 given both, +35000 both; 1 left: completed-dump construction countdown ~0.9 s wall-clock gap, not covered by a rule) |
| C34 rerun (ids fix) 2026-11-01 | 69 | mission-C34-69.mjs | y (not rerun) | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C34.md "Rerun (ids fix) 2026-11-01" (0 left, 2 accepted: dailyRewardsLastGivenDate; add_upgrade_item ids now numeric 1/1) |
| C33 rerun (ids fix) 2026-11-01 | 68 | mission-C33-68.mjs | y (not rerun) | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C33.md "Rerun (ids fix) 2026-11-01" (0 left, 2 accepted: dailyRewardsLastGivenDate) |
| C32 rerun (ids fix) 2026-11-01 | 40 | mission-C32-40.mjs | y (not rerun) | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/C32.md "Rerun (ids fix) 2026-11-01" (0 left, 2 accepted: dailyRewardsLastGivenDate) |
| R01 | 183 g1 | mission-R01-183-taipei-g1.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R01.md (1 attempt; g1 pays the base amounts 3530000/2500, so the group is not visible in amounts) |
| R01 | 183 g2 | mission-R01-183-taipei-g2.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R01.md (1 attempt; key r2:- is wrong: no ABtest2 means the base coins+exp 3530000/2500 is paid in both) |
| R02 | 3 g1 | mission-R02-3-g1.mjs | y | y (?nogiveback=1) | 4 | DIFFERENT | tools/missions/worker-notes/R02.md (2 attempts, same diff: orig sends the 11 earn-mission updates ~5 s after the ask, ours only after the reload (system.ts:95-116); mission 3 reward itself equal) |
| R02 | 3 g2 | mission-R02-3-g2.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R02.md (1 attempt; coinsGain 35000 both) |
| R03 | 56 g1 | mission-R03-56-taipei-g1.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R03.md (1 attempt; coinsGain 5340000 exp 2720 both) |
| R03 | 56 g2 | mission-R03-56-taipei-g2.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R03.md (1 attempt; houses_008_005 item in final dump both) |
| R07 | 32 g1 | mission-R07-32-g1.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R07.md (1 attempt; commerce_coffee 1 both; reward identical in all groups) |
| R07 | 32 g2 | mission-R07-32-g2.mjs | y | y (?nogiveback=1) | 0 | EQUAL | tools/missions/worker-notes/R07.md (1 attempt; commerce_coffee 1 both) |
| R04 rerun 2026-11-01 (orig side only) | 65 g1 | mission-R04-65-g1.mjs | y (rerun, friends server) | y (scratchpad o-R04, not rerun) | 0 | EQUAL | tools/missions/worker-notes/R04.md "Rerun 2026-11-01" (0 differences, 3 accepted; claim screenshots checked) |
| R05 rerun 2026-11-01 (orig side only) | 61 g1 | mission-R05-61-g1.mjs | y (rerun, friends server) | y (scratchpad o-R05, not rerun) | 0 | EQUAL | tools/missions/worker-notes/R05.md "Rerun 2026-11-01" (0 differences, 3 accepted; claim screenshots checked) |
