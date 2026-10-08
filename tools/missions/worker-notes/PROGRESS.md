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
