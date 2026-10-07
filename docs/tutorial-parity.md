# Tutorial parity: original Flash client (oracle) vs rewrite

Method: `MCITY_ORACLE_PORT_BASE=31853 node tools/oracle/run.mjs tutorial-full` plays the ORIGINAL client's whole first session on a fresh save
(boss select, steps 0-9, invite popup, reload). `tools/oracle/ours-tutorial.mjs` plays the same clicks in the rewrite (760x600, server 31863,
preview build on 5176). Every step: screenshot, save dump (`out/tutorial/saves-orig/*.saves.json` vs `out/tutorial/ours/saves/ours_*.json`) and the
raw cmdList payloads (`tools/oracle/cmdlog.cjs`, server preload; `out/tutorial/orig-cmds.jsonl` / `ours-cmds.jsonl`). Composites (left ORIGINAL,
right REWRITE): `tools/oracle/out/compare3/tut_<step>.png`. Tools: `tools/oracle/save-diff.py <orig> <ours>` (golden-save diff, timestamps ignored).
`MCITY_ORACLE_PORT_BASE` (default 31833) now shifts all oracle ports (server/https/fb/control = base..base+3).

## Step table
| Step | Result |
|---|---|
| Boss select (white screen, 2 advisors) | fixed: our fake title card removed (white stage like the original); Cindy label wraps differently (remaining, cosmetic) |
| Camera start (Map.cameraStart tutorial branch) | fixed: `city.cameraStartTutorial` (x centred +1 tile, y centred above a 124 px friends bar); map pixel-aligned |
| 0 Your Company (text, popup position, Next enabled) | MATCH (text top-anchored, 18 px lines, fixed) |
| 1 Place HQ (arrow over 4 tiles, HQ forced on tile (-1,-3)) | fixed: white build-grid cells over HQ + 2 plot tiles instead of green box; MATCH rest. Bounce phase of arrow differs (animated) |
| 2 Buy Plots (toolbar arrow on Buy button, 2 forced tiles, 1,000 each) | MATCH (arrow now on button centre) |
| 3 Build House (shop arrow, ghost on 2x2 plot) | MATCH; fixed: new_item is `isSuspended=1`, no XP until roads |
| 4 Road (2 forced pieces) | fixed: XP +100 and RESUME (mode 2, time 600000) only when the 2nd road is built (orig HUD XP 0 until then) |
| 5 Instant Build | fixed: popup shows $468 (not free); new_mode 4 carries time 599,900 (-100 trick); arrow on site top |
| 6 Sign Contract | MATCH visually; fixed payload: raw mode 2 (SIGNING) without contractGroupSku while tutorial runs |
| 7 Decoration (tab arrow, ghost only on (4,1), +2% badge) | MATCH; cost 2,000 / +5 XP identical |
| 8 Collect Rent | fixed: GET_RENT reported with time 3,600,000; collect removes contract cost from company value (+267, not +357) |
| 9 final popup (money rain) | fixed: NoteRain started/stopped like onStep10/11 |
| Invite Neighbors popup | fixed: `popup_invite_neighbor_1/2` shown before tutorial_completed/firstMission and reload (orig keeps session; we reload to re-init areas) |
| Friends bar content during tutorial | remaining: orig shows loading spinner, ours the neighbour list; bottom bar not dimmed under popups |
| Left mission icon column visible right after the invite popup | remaining (we reload) |

Rewards (DB, orig == ours at the end): coins 380000 -> 379000/378000 (plots) -> 348000 (house) -> 347532 (instant 468) -> 347442 (contract 90) ->
345442 (tree 2000) -> 345799 (rent 357); XP 0/0/0/100/100/100/105/106; tutorial rain/timing: first rent timer 5000 ms (TUTORIAL_BUILD_HOUSE_TIME).

## Golden save diff (after tutorial, ignoring timestamps)
Fixed in our client payloads: item `type` (0 house/HQ, 2 decoration) on every new_item; HQ state `{id:4}` only (no mode/time) plus the
`Decorations` child; suspended house + deferred XP; rival NPC house `new_mode {mode:1,time:0}` sent with the HQ placement (save had Item id3/mode2 instead
of id1/mode1); `newToolRev=3` at tutorial start and `newItemsRevDone` on first shop open (profile newToolRev/newItemsRev were 0/missing);
no `upd_suspended` for items found disconnected while the world loads (UDFO.updateItem only sends in RUN_WORLD; the NPC house stayed `isSuspended=1` in ours).
Remaining differing fields: `dailyBonusInfo.dailyRewardsNextRewardId` (orig rolls it at boot via get_daily_rewards_info; ours only after the tutorial; random value anyway);
intermediate (not final) `companyValue` at step 5 (orig reports the +30,000 building value with the contract command, ours with the construction-end command);
intermediate coins/time jitter (DB lags a command in the orig; contract `time` 3000 vs 5000 is timer sampling).
Payload-only differences (no save effect): orig also sends city_name_codes, checkmail, 3x gameConfig, load_success at boot and `update_missions` x5 at welcome;
map commands carry the pre-spend `coinsNow` in the orig; instant build/collect are split in two commands (new_state + new_mode; GIVING_RENT then WAITING) in the orig.
