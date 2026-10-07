# Visual + behaviour parity: in-city view and HUD (original Flash client vs rewrite)

Method: the original runs headless under `tools/oracle` (scenarios `hud-tour`, `ui-tour`, `build-flow`, plus the earlier `post-tutorial`,
`build-house`, `shop-houses`); the rewrite runs on an isolated server (31843-45, copy of the same seeded save: `tools/oracle/seed-post-tutorial.cjs`)
with vite on :5175 and is driven by `tools/oracle/ours-shot.mjs` at 760x600 (the original stage). Oracle PNGs are cropped to the stage
(`+252+203`, 760x600). Side-by-side composites (left ORIGINAL, right REWRITE): `tools/oracle/out/compare/pair_NN_*.png`; raw crops
`or_*.png`, our shots `ours/F_*.png`.

Stage decision: the rewrite keeps a full-window map, but every HUD piece is laid out against a **virtual 760x600 stage centred in the window**
(HudOwner.as:665 `(stageWidth - Config.SCREEN_WIDTH)/2` with a constant 760; options gear, mission-icon column follow the same origin; toolbar/friends bar
were already centred). At 760x600 the layout is now pixel-aligned with the original.

## Matched (verified by composites)
- Map rendering: terrain, roads, fences, HQ, trees, sprite anchors and offsets (HQ, houses, pizza, decorations) are pixel-identical at the same camera;
  initial camera (HQ centre at x/2, y/3+25, Map.cameraStart) now identical.
- Top HUD: XP bar/star/level, coins, gold, Add buttons (label "Add"), city name + value with the green/red trend arrow, outline glow of the texts.
- Toolbar (select/terrain/build/road/demolish + multifunction), briefcase "Contractors" bar, vault bar, friends bar frame and its positions.
- Terrain/road tool hover tile (green fill + grid art), contract popup, shop popup layout, missions panel layout, construction site art, rent-ready icon,
  "Contract Signed!" bubble.
- Numbers (via save dumps and HUD): terrain 1,000 each; Bungalow 30,000 coins / +100 XP at placement; contract Family -90 coins;
  collect +350 coins +1 XP; company value 762,000 -> 732,000 on placing (value is NOT added during construction) -> 762,000 when built
  (+30,000) -> 762,090 when the contract is signed (+90) -> 762,350 after the collect; construction timer text "9 Mins 56 Secs" (ours 57 s: sampling jitter);
  rent time 1 h 3 min; persisted item modes: construction `mode 2 time 600000`, rent-ready `mode 5`, after collect `mode 1`.

## Differences found and FIXED
| Area | Original | Rewrite before | Fix |
|---|---|---|---|
| Rival (for-sale) buildings | 4 buildings of company whose=1 with FOR SALE sign + price (`StateOnIA.viewStart/viewForSale`; price = int((tiles*terrainPrice + companyValue)*20%) -> $13,800 / $21,800 / $33,800) | not rendered, empty cones | `ui/extras/rivals.ts`, `rules.rivalSellPrice`, items added in main.ts, footprint in `GameWorld` |
| HUD origin | centred on constant 760 | centred on measured widget bounds (~58 px off) | `hud.ts` `STAGE_W` |
| Coin/gold block | shifted right by the hidden FC counter width (HudOwner.load :893) | not shifted | `hud.ts` |
| Add buttons | label `TID_BUTTON_TEXT_ADD` ("Add") | "Add Dollars/Add Gold" | `hud.ts` |
| Gold "0" colour | always white (no blink in HudOwner) | red pulse | `hud.ts` |
| Fonts | embedded Challenge Bold LET / Helvetica Rounded | Lilita One / Nunito stand-ins | original TTFs extracted with ffdec to `public/fonts/` (full Latin set), loaded in `gui/fonts.ts`; fontmap updated |
| Text glow | Flash blurX 3 = box blur, strength 10 | 3x too blurry | `gui/effects.ts` blur/3 |
| Options panel | collapsed gear at the stage's right edge, y = stage bottom; expands left | expanded, top-right | `options.ts` (starts collapsed, `OptionsPanel.resize`) |
| Left icon column | mission icons (64 px at x=5, y=70+64*slot, max 4 + advisor "Click me!" label, tooltips, "New/Progress" labels, hover glow) | missing; advisor button in the toolbar | new `ui/missions/iconlayer.ts` (ports MissionsIconLayerManager/Display/MissionIcon); toolbar boss button hidden as in ToolsBar.as:320 |
| Mission order | locked missions (askForHelp, buyExpansion, bonus) with progress sort before unlocked ones; panel lists 1,2,5,10 | string-sorted 1,10,2,5 | `iconlayer.heuristic` (locked weight 0), `game/missions.ts` numeric order |
| Pimp-the-House progress | bonus missions fed by `checkInfluenceEvent` | never fed | `ui/missions/system.ts` (1 s poll, sku + subsku) |
| Mission "Name It" arrow | bobbing SuperupgradeArrow next to Read More | missing | `missions/panel.ts` |
| Camera limits | clamped to map + friends bar | free pan | `city.clampCamera` |
| Company value timing | 0 while building, added at construction end | added at placement | `game.ts` placement + `constructionDone` |
| Construction bar | none above the site | bar drawn | `itemView.ts` |
| Building ghost | opaque building + 3 px green/red frame with tile lines + glow | 70% alpha + thin frame | `city.setGhost` |
| Terrain/road cursor tile | 50% green fill, 2 px outline, `Grill` art (red + `GrillBad` when invalid) | translucent square | `tools.ts` art flag, `city.showGrill` |
| Floating action bar (Collect/Contract/Move/Sell) | does not exist (click item collects/signs) | shown on selection | `actions.ts` flag off |
| Collect feedback | "+$350" (white, green glow) then "+1 XP" over the item, 2 s float-up, no toast | yellow text + toast | `ui/economy/fx.ts`, game.ts toast removed |
| Hover | yellow 2 px frame on the footprint + info box | box only | `hud/index.ts` hover frame; info box re-shown when the item under a still pointer changes |
| Info box of house waiting for a contract | building description (`TID_..._DESCRIPTION`) | "Select Contract" | `infobox.ts` |
| Vault / Collectibles button | enabled/disabled by level on the collectibles button only | whole vault button disabled | `toolsbar.ts` |
| Contract cards after the tutorial | coloured | grey (tutorial lock applied without tutorial) | `popups/contract.ts` |
| Shop order ties | Bungalow Luxury before Kioko House (equal cost/XP keep definition order) | reversed | `shop/catalog.ts` |
| Plane | starts after the daily-prize popup closes | flew behind the popup | `extras/plane.ts` pauses while popups are open |

## Remaining known differences
- Cursor art: original shows an hourglass + people cursor over a construction site and a "sign contract" pen cursor; ours uses the existing
  cursor set but not the construction hourglass.
- Per-frame details: car/pedestrian positions differ (random), plane flight timing, friends bar content (original shows a loading spinner,
  ours the offline neighbour list), mission "Click me!" label timing vs. server load.
- Rival buildings: hover info box (InfoBoxCommerceRival/Wonder), buy flow (TradeProcess / PopupTradeBox) and the in-sale <-> wait timers are not ported;
  the signs are static (mode 2 only).
- Left icon column: no GTween easing curves beyond linear CSS transitions, no blink on REACHED, and the floating "!" on the toolbar missions button is gone because
  the original hides that button.
- Level-up arrows in the column are the two *locked* missions' icons, so they follow the mission rules (e.g. the 3rd icon "Please!" is askForHelp); other
  event types use PNGs from `Assets/missions/icons` and fall back to nothing if a type has no PNG.
- Verified only at 760x600 against the oracle; larger windows centre the virtual stage but the map fills the window (the original is NO_SCALE 760x600).
- Not compared against the oracle: daily prize popup, collectibles album, level-up popup, sell/move flows, expansions (signs on the map are ours), the
  oracle server's different `get_game_config`. Instant build price/behaviour checked in `docs/parity-audit.md` only.
- Our run differs by an extra 10,000 coins / 80 XP in the long driver script because of an exploratory click on the road tool/toolbar in the scripted
  sequence (the dumped save flow of `build-flow` is exact, see above).

## Reproduce
```
node tools/oracle/run.mjs hud-tour | ui-tour | build-flow          # original; outputs in tools/oracle/out/<scenario>
# ours: MCITY_DB_PATH=... MCITY_HTTP_PORT=31843 MCITY_HTTPS_PORT=31844 MCITY_FACEBOOK_PORT=31845 (apps/server: npx tsx src/main.ts)
#       node tools/oracle/seed-post-tutorial.cjs <db>;  MCITY_SERVER=http://127.0.0.1:31843 npx vite --port 5175 (apps/client)
#       CHROME=... node tools/oracle/ours-shot.mjs <prefix> 760 600 '[["wait",3000],["shot","a"]]' http://localhost:5175/
```

## Round 2: popups and panels (composites in `tools/oracle/out/compare2/`, left ORIGINAL, right REWRITE)
| Screen | Status | Notes |
|---|---|---|
| Daily prize popup + claim (`daily*`) | MATCH | day-title outline matched |
| Level-up popup (`lvlup`, `lvl2`) | fixed | Share button + feed text shown, unlocked item art, banknote rain (`extras/noterain.ts`) |
| Mission-complete popup (`r1`, `daily-claim`) | fixed | Share button / feed block, note rain |
| Magazine (1M value) | fixed | gated by `millionNewsFeed` profile flag + `million_news_feed` command, not shown while another popup is open |
| Shop tabs Houses/Commerces/Decorations/Wonders, paging, locked cards (`shop*`) | fixed | New Items tab lists the 16:01:2012 items and shows `newitemimage.png`; text outline matches (effects.ts) |
| Exchange popup (`exchange`) | fixed | exchange_02 for the female advisor |
| Instant-build popup, construction hover (`hover-constr`, `click-constr`) | fixed | hourglass cursor (Instant/Wonder/Buy cursors, `ui/hud/cursor.ts`); price differs only by elapsed construction time |
| Destroy confirm (`destroy-*`), house/deco hover box (`house-hover`), contract popup | MATCH | |
| Friends bar | fixed | layout as original (Add Neighbors slots first, ranks ascending, best at right); original's loading spinner is a placeholder, ours shows the offline neighbors |
| Collectibles album (`album*`) | fixed | tab selection (DownState), Gift buttons, caption fitting, Cake House art; reward art still differs |
| Collectible Get/Buy popup (`album-get`) | fixed | Ask + Buy buttons, photo clip shows the original's "Houses Upgraded" star (Ask opens the neighbor invite offline) |
| Vault / storage popup (`vault`, `album1`) | MATCH | text wrap differs slightly |
| Rival for-sale buy flow (`rival-buy-ours.png`) | fixed (ours only, not oracle-compared) | click sign -> "Buy for" trade box -> coins/gold check -> `game.adoptRival` (pays, moves item into my company, new_mode csid + new_state, Pizzalicious mission fires). Verified: server dump stores the bought building under company whose=0 (csid 1, State id 1 mode 4) and it reloads as mine. Remaining: hover info box (InfoBoxCommerceRival/Wonder), 3 s buying bar, wait/in-sale timers |
| Expansion signs/popup, terrain/road cost popups, move confirm, not-enough-coins, upgrades/visitor popups, missions pages, options, investments, news | remaining | not compared this round |
| Terrain tool hover tile / cursor (`terrain-tool`, `terrain-far`) | MATCH | |
| Not-enough-coins -> Not Enough Gold dialog (`nocoins-terrain`) | fixed | body text was shrunk to 10 px (sub-pixel scrollWidth rounding in textfit); now ~14 px vs original ~16 (stand-in font width) |
| Build tool with unaffordable house (`nocoins-shop`) | fixed | build button shows the selected ring (select does not) |
| Expansion signs + purchase popup, move confirm | remaining | need map drag / multifunction tool in the harness |
| Album reward art (`album2`) | fixed (partly) | Cake House art resolved via `_Cindy/_Ronald` sprite; the group frame (blue vs sepia) depends on collectible group state and still differs for the seeded data |
| Magazine at 1M (`b`) | MATCH | original also stacks a mission-complete popup on it; ours did not show it in this run |
| Options panel, missions panel, toolbar | MATCH (round 1) | |
| Upgrades/visitor popups, investments, news/journal, rival hover box/buying bar/timers, move confirm, expansion popup | remaining | not reached |

## Round 4: expansion, rivals, investments, ... (composites in `tools/oracle/out/compare4/`, left ORIGINAL `or_*.png`, right REWRITE `ours/*.png`; `pair_*.png`)
Harness additions: `ours-shot.mjs` step `["drag",x1,y1,x2,y2]` (map pan); the oracle drag is `/mouse type=move,down,move...,up` (see the `oc.sh` pattern in this round: move, down, 8 moves, up). `tools/export_gui.py` now also exports `Assets/terrain/fence.swf` (`--only fence`).
| Screen | Status | Notes |
|---|---|---|
| Expansion sign on the map (`pair_exp-map`) | fixed | sign position (the 1/4-plot nudge toward the central plot, Background.createExpansions :382-399, was missing: sign was ~120 px off); fence art (`fence.swf`, Background.fencesBuild) was missing at the plot borders and the map edge; sign was not clickable (widget parts are pointer-events:none) -> hit box + BuyAreaCursor |
| Expansion purchase popup (`pair_exp-popup`) | MATCH / fixed | layout identical; the "Invest" button was disabled, now enabled (closes the popup and opens the investment menu on "New", PopupConfirmExpansion.onInvest/close); with enough rewarded investments the centre button becomes the free "Buy" (onBuyCashDiscount, TID_HAVE_FRIENDS green) - logic only, art uses the invest button class |
| Rival buy: trade box (`pair_rival-trade`) | MATCH | |
| Rival hover: InfoBoxCommerceRival / InfoBoxWonder, yellow frame, BuyCursor (`pair_rival-hover-wonder`, `or_hover-commerce`) | fixed | was missing entirely. Also fixed the LEFT info box position for every item (x = item left edge, the left clip's origin is its tail tip; was 235 px too far left) |
| Rival cut off from the HQ road (`or_drag1` house 12,800) | fixed | ItemNoRoadIcon over the sign + "disconnected" info box (InfoBoxAbandoned) |
| Rival buy flow timing (`or_hb1..6`, `ours/e_hb*`) | fixed | coins/company value drop at once, SellBarOnHouse (red bar + pen icon + "-$price") fills for 3 s (SELL_BAR_TIME), then the item becomes the player's, company value + mission event at that moment (was instant) |
| Rival in-sale/wait timers | n/a | `RulesFacade.areRivalCompanySalesTemporal()` returns false in 0.501: signs never expire; nothing to port |
| Investments: statistics / portfolio tabs (`or_inv-stats`, `or_inv-portfolio`) | MATCH / fixed | "Success Percentage" has no % sign in the original (fixed). The "i" help button + bobbing arrow (PopupHelpInvest slideshow) is NOT ported: button hidden (remaining) |
| Investments: "New" tab (`pair_inv-new`) | fixed | original shows the info screen (`popup_investment_select_friends`, text TID_INVESTMENTS_RESUME, "Send Investment Request"); ours showed the NPC grid directly. Now: info screen first; the button opens the NPC-city picker (the original asks Facebook for friends, which is closed offline) |
| Move tool / invalid placement (`pair_move-invalid`) | fixed | the multifunction "move" click also ran ToolSelect (opened the contract popup): `game.multiToolActive`; refused build/move placement now shows PopupMessageSmall (`popup_missage`, TID_PLACE_IN_TERRAIN, terrain icon, OK) instead of a toast. Round 5: the toolbar move tool DOES confirm with PopupPayMove (`popup_confirm_buy_rent_crane_operator`: price + Rent for 10 gold), implemented and matched (`ours-move/07-06-dropped.png` vs `flow-move`) |
| Collectibles album, seeded identically (`tools/oracle/seed-collectibles.cjs` / `lib.mjs seedCollectibles`; `pair_album1`, `pair_coll-get`, `pair_coll-gift`) | fixed / MATCH | Cake House frame was orange/sepia: the `mark` backdrop shape (842) stayed visible under the item art (the original hides `mark` and draws only the building) -> hidden, frame is now blue. Get/Buy popup MATCH. Gift button opened nothing offline: now the PopupSendCollectible window ("Send Gift", search, Millionaire friends/Recommended/All friends tabs, empty list as the original offline). Round 5: "New!" star (hud `new_items`, group `icon`), bobbing TutorialArrow at the info button (`collectiblesHelpShown2`), help slideshow (popup_help_01/02, 4 pages) and the claim popup (`popup_publish_nf_reward` "Well Done!") now match; first-open flags sent |
| Larger windows (`ours/w1280_*`, `ours/w1920_*`) | MATCH (decision kept) | HUD, mission icons, toolbar and friends bar stay anchored to the centred virtual 760 stage / window bottom; popups (daily prize, shop) centre; nothing clipped, no console errors at either size. Map fills the window (the original is fixed 760x600) |

### Deferred (TODO later)
- Visitor mode (oracle `or_visit1/3`): original shows "Friend Upgrade" popup, then "Today's Daily Bonus $5000"; HUD shows friend photo + visited company value, upgrades badge "x 5", round Home button; owner tools and mission icons hidden. Ours used a CSS stand-in bar. Code added but UNVERIFIED (HUD value did not change in the last test): `ToolsBar.setVisitor/setUpgrades`, `HudView.setVisited`, `visit.ts buildBar`, bus `visitorChrome`.
- Investments help "i" button (PopupHelpInvest) not ported.
- News/journal and magazine second popup: not started.
