# Parity plan: TypeScript rewrite vs the original Millionaire City

Handoff document. Goal: a TypeScript client (`apps/client`) that is equivalent to the original Flash game (0.501), running against the existing server (`apps/server`, which keeps the original save/protocol format). Written so another agent (e.g. Codex) can continue without this session's context.

Status snapshot: final handover; all subagents have finished and all test servers are stopped (no ports listening). Testing was deliberately stopped here. Results of the last runs: client 219 tests (28 files), server 106 (3 files), rules 15, `tsc --noEmit` clean in client and server. Detailed results: `docs/parity-audit.md` (formulas), `docs/visual-parity.md` (screens, Round 1-3 tables), `docs/tutorial-parity.md` (tutorial + save diff).

## 1. What exists

| Area | Where | Notes |
|---|---|---|
| Client (Vite + PixiJS v8, DOM UI overlay) | `apps/client/src` | `game/` logic, `view/` rendering, `ui/<area>/` screens, `gui/` widget toolkit, `net/` protocol + command builders, `audio/` |
| Ported rules library | `packages/rules` | pure TS: definitions, placement, income, timers, XP |
| Server | `apps/server` | Express + SQLite JSON documents; extended with `commandHandlers/offline.ts` (ports of original Java semantics) |
| Original decompiled client | `decompiled/scripts/com/dchoc/dollars` | gitignored, regenerate (see below) |
| Original Java backend (recovered) | `archive-recovery-2026-10-06/java/dollars` | `GamePlay.java`, `SecurityNormal.java`, `Server.java`, `Rules.java`; see `docs/archive-reference.md` |
| Oracle harness (original Flash client running headless) | `tools/oracle` | the key tool for parity checks |
| Docs | `docs/` | `client-dev.md` (setup), `client-logic-spec.md` (verified geometry/rules), `feature-inventory.md`, `parity-audit.md`, `visual-parity.md`, `gui-assets.md` |

Nothing is committed. Untracked/modified: `apps/client/`, `packages/rules/`, `tools/`, `docs/`, server edits, `package.json`, `.gitignore`, plus user material (`millionaire-city.zip`, `archive-*` directories) that must not be committed or deleted.

## 2. Setup from a clean checkout

Original art, sprites and sounds are NOT in git (not redistributable; `NOTICE.md`). Regenerate locally. Needs Java, Python 3 with Pillow and numpy, `rsvg-convert`, Node 22.

```text
npm ci
npm run build -w @mcity/shared
# FFDec 26.0.0 -> generated/tools/ffdec-26.0.0/ffdec.jar (npm run prepare-client in apps/server downloads it too)
java -jar generated/tools/ffdec-26.0.0/ffdec.jar -export script decompiled assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Dollars.swf
python3 tools/export_all_items.py && python3 tools/export_hq.py && python3 tools/export_framerates.py
python3 tools/export_gui.py --jobs 4          # apps/client/public/gui (113 MB)
python3 tools/export_sounds.py
python3 tools/fix_old_grass.py                # recolour old olive grass baked into sprites (marker-based, run once)
```

Run:

```text
# game server on an isolated DB (never reuse another agent's DB):
cd apps/server && MCITY_DB_PATH=/tmp/mc.sqlite MCITY_HTTP_PORT=31803 MCITY_HTTPS_PORT=31804 MCITY_FACEBOOK_PORT=31805 npx tsx src/main.ts
# client dev server (proxies /Game and /mcity to the server):
cd apps/client && npx vite --host 127.0.0.1                      # http://127.0.0.1:5173
# production build served by the game server at http://127.0.0.1:<MCITY_HTTP_PORT>/ :
npm run build:client && (start server as above)
```

Dev helpers in the browser: `window.__mcity` ({conn, game, city, defs, audio}), debug panel on the backtick key (time scale, build, collect all), `?skipTutorial`. Screenshot helper pattern: Playwright (`playwright-core`, Chromium at `~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, launch args `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`).

## 3. How to test

Automated (must stay green; run before and after every change):

```text
npm run test:rewrite                      # client + server + rules suites
cd apps/client && npx tsc --noEmit        # client typecheck
cd apps/server && npx tsc --noEmit
```

Last known results: client 219 tests, server 106, rules 15 (27+ test files). Golden numeric tests: `apps/client/test/parity.test.ts`, `apps/server/test/parity.test.ts`. End-to-end through a real server on a temp DB: `apps/client/test/commands.integration.test.ts`, `apps/client/test/game.integration.test.ts`.

Parity against the real original (the oracle), see `tools/oracle/README.md`:

```text
node tools/oracle/run.mjs <scenario>      # runs the ORIGINAL client (Electron 10 + Pepper Flash under xvfb-run), isolated server on 31833-35, control port 31836
```

Scenarios in `tools/oracle/scenarios/`: `fresh-boot`, `post-tutorial`, `shop-houses`, `build-house`, `build-flow` (terrain, build, construction, contract, rent-ready, collect with timer shortening via DB edits), `hud-tour`, `ui-tour`, `tutorial-full` (complete original tutorial), `hold`/`hold-fresh` (idle, drive by hand over the control port). `MCITY_ORACLE_PORT_BASE` shifts all oracle ports (default 31833) so two runs can coexist; `cmdlog.cjs` is a server preload that logs the cmdList payloads. Our side: `ours-tutorial.mjs`; for tutorial runs use a static build (`vite preview`), because Vite hot reload from edits resets runs. Outputs: `tools/oracle/out/<scenario>/*.png` and `*.saves.json` (all `save_documents` rows). Our side: `tools/oracle/ours-shot.mjs`, `ours-tutorial.mjs`, `seed-post-tutorial.cjs`, `save-diff.py` (golden-save diff). Composites go to `tools/oracle/out/compare*/`.

Method for every screen or flow:
1. Seed the SAME save in both clients (post-tutorial seed sets `tutorialEnd=1`, `bossGenre=1`; the harness can mutate documents/timestamps).
2. Drive the same actions (oracle: `/mouse`, `/key`, `/eval` on the control port; coordinates are in a 760x600 SWF inside a scrolling launcher page, use the harness `o.scroll`/`o.clickSwf`).
3. Compare screenshots side by side (original cropped to the 760x600 stage; ours at 760x600) AND diff the server save documents (`save-diff.py`, ignore timestamps/tokens) AND compare HUD numbers (coins, XP, company value) at every step.
4. Fix our side (never change the server's trust model to "fix" a diff without checking the Java), re-run, record in the docs.

Safety rules learned the hard way:
- Never `pkill -f` by pattern (it kills your own shell and other agents' servers). Start processes with `setsid nohup ... &`, record PIDs, kill by PID; check ports with `ss -ltnp | grep -E '31[0-9]{3}|517'`.
- Use a separate DB and port set per run; do not reuse a DB across tests (the shared dev DB tmp/dev.sqlite is polluted by old test runs, e.g. a negative company value).
- Advance game time with the debug panel `timeScale` or by editing DB timestamps, never `tick(hugeDt)` (desyncs the command queue).

## 4. What has already been tested (as of this snapshot)

Automated: all suites green (see section 3). New server behaviour from the recovered Java is covered by tests in `apps/server/test/offline.test.ts` and `parity.test.ts`.

Formula audit (`docs/parity-audit.md`): 24 MATCH, 8 MISMATCH (fixed), 3 UNVERIFIABLE. Covers XP/level table, build prices and unlock rules (incl. gold early unlock window and 65 cap), construction and instant-build prices (double `int()` truncation), contracts and income, abandon times, rent accelerator, company value, sell/demolish, terrain/road/plot prices, gold exchange, daily rewards, mission rewards, collectible drop chance, AS3 int/uint rounding.

Visual and behavioural parity vs the original via the oracle (`docs/visual-parity.md`):
- MATCH: map terrain/roads/crosswalks, HQ, houses, sprite anchors/depth order, toolbar, HUD (after layout fixes), construction art, daily prize popup, destroy confirm, house hover box, contract popup, vault and storage popups, magazine gating, shop four tabs/paging/locked cards, friends-bar layout.
- Numbers identical in the build flow: placing a 30,000 house moves company value 762,000 -> 732,000; built 762,000; contract 762,090; collect 762,350 (+350 coins, +1 XP); terrain tiles cost 1,000 each.
- Fixed to match: rival for-sale buildings and signs, HUD layout in a virtual 760-wide stage, fonts (original TTFs extracted), options gear, left mission-icon column with advisor and "Click me!", mission order, camera start/limits, building ghost and tool cursors, hover frame, "+$350/+1 XP" floaters, level-up and mission-complete popups, exchange popup advisor art, collectibles album tabs/captions, hourglass and buy cursors.
- Tutorial parity (`docs/tutorial-parity.md`, 37 composites in `tools/oracle/out/compare3/`): the ORIGINAL tutorial was scripted in the oracle and compared step by step with ours; after the full session the save documents match except the fields listed in section 5 item 1. Fixed on our side: boss-select screen, camera start, popup text anchoring, step-1 grid, toolbar arrows, instant build not free ($468, time 599,900), house placed suspended (XP/RESUME after the second road piece), raw tutorial contract payload, collect reports GET_RENT time 3,600,000 and company value +267, invite-neighbors popup before `tutorial_completed`/`firstMission`, `type` on every new_item, HQ state `{id:4}` + `Decorations`, rival NPC house `new_mode {mode:1}` when HQ is placed, `newToolRev=3`, `newItemsRevDone` on first shop open.
- Persistence across reload verified for placement, construction, contracts, rent, move, sell, roads, mission rewards.
- Rival buy flow works in ours (server stores the bought building under the player's company); NOT compared against the oracle.

## 4b. Deferred by decision (TODO later, do not work on these now)

The user chose to defer the social/rival group until the rest is done:
- Upgrades and visitor popups, NPC city visiting polish (Ronald/Cindy/Sheik).
- Investments (new/portfolio/statistics tabs, results popups).
- News/journal and the second mission-complete popup the original stacks on the magazine at 1M company value.
- Rival (for-sale) buildings: hover info box, 3 s buying bar, in-sale/wait timers, oracle comparison of the buy flow.
- Facebook-dependent stand-ins: friends/neighbors list (original: loading spinner), ask-for-help, invites, cross-promotion, gift sending.

These stay as listed in section 5 (items 5, 6, 14) and are excluded from the completion estimate until picked up again.

## 5. Leftovers (current; supersedes earlier per-round lists)

Closed since the first version of this plan (details in `docs/save-parity.md`, `docs/visual-parity.md`, `docs/tutorial-parity.md`): tutorial golden-save diff; save diffs for build/contract/collect/sell/road/terrain/expansion/instant build (coins and gold)/"Name It" mission/daily bonus/rent accelerator/move/collectibles; expansion signs and popup; move tool; rival buy flow, hover box, buying bar; investments intro; collectibles (album, Get/Buy, Gift window, `New!` star, arrow, help, claim popup); larger-window layout (virtual 760 stage kept); company value baseline lag; server now adds reported gains like the Java server. Accepted difference: our client persists the `earnDCCoins` counter at the first coin change (original keeps it locally; no gameplay effect).

A. Deferred by decision (section 4b): upgrades/visitors and NPC visiting polish (half-added `ToolsBar.setVisitor`, `HudView.setVisited`, `visitorChrome` are unverified), investments results/"i" slideshow, news/journal and the second magazine mission-complete popup, rival in-sale timers (inactive in 0.501 anyway), Facebook-dependent stand-ins (friends bar spinner vs our neighbour list, ask-for-help, invites, cross-promotion emitter, gift sending).

B. Gameplay still approximate or only reviewed against code
1. Wonder `incomeMultiplier`/`npcIncome`, and the Java server's security recomputation, are server-side in the original and not replicated (trust model kept on purpose).
2. Commerce population/influence, crew/clubs (friend hiring disabled), upgrades visuals: verified in-browser by their author only, not oracle-compared.
3. Mission parity has oracle coverage for full trigger/claim/reload paths on missions 1, 4, 5, 6, 35, 43, and 44; claim/reload only on missions 2, 20 (group 2), and 47 (`docs/missions-parity.md`). Exhaustive coverage is now required for all 318 definitions (87 default, 231 alt), tracked row by row in `docs/missions-complete-checklist.md`. Move, influence/bonus, prerequisite chains, multi-mission triggers, popup stacking, and social/rival/partner/investment interactions still need trigger coverage or evidence-backed blockers. This is not full mission parity.
3b. SUPERSEDING PLAN for item 3 (agreed with the user): do NOT continue the row-by-row exhaustive checklist. Use the class-based plan in `docs/missions-efficient-plan.md` (36 mechanism classes, oracle run per class, all 318 rows covered by `tools/missions/static_sweep.py` + `apps/client/test/missions-sweep.test.ts`), statuses generated into `docs/missions-status.md` by `tools/missions/mark.py`, agent prompts in `docs/missions-agent-instructions.md`, click recipes in `docs/missions-flow-recipes.md`. Already found and fixed by the new tooling: `checkInfluence` missions (39) never progressed because nothing listened to `commerce-population` (`ui/missions/system.ts`); needs oracle evidence for classes C13/C14.
4. Daily bonus: once-per-day claim limit not enforced on our server; welcome-back popup fields guessed.
5. HQ skin change after a collectible reward redraws only after reload; item picking uses footprints only.
6. Tutorial leftovers: step 5 `companyValue` (689,532 original vs 719,532 ours), one-step DB-lag differences in step 6, boot-time payload-only differences, Cindy label wrap on the boss-select screen.

C. Quality
7. Unit tests do not cover several UI flows verified by screenshot only (shop buy flow, early-unlock popup, sell/cancel-contract confirms, hire-crew popup, collectibles reward claim paths).
8. Font stand-in width differences in some popups (e.g. body text ~14 px vs ~16 px original).

D. Shipping (not started)
9. Production build is ~500 MB (unpruned sprites/gui); needs pruning for distribution.
10. Original assets are not redistributable (`NOTICE.md`): a bring-your-own-assets/regeneration step (section 2) must be part of any release.
11. No Electron wrapper/installer for the rewrite (legacy launcher in `apps/desktop` unchanged); the server serves `apps/client/dist` at `/` when present.
12. Nothing is committed; the work is uncommitted on `main` (new `apps/client/`, `packages/rules/`, `tools/`, `docs/`, server edits).

## 6. Reference

- Original behaviour source of truth, in this order: decompiled client (`decompiled/`), recovered Java (`archive-recovery-2026-10-06/java`), 0.501 rules XML (`assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules`), then the oracle's observed behaviour. The archived XML/SQL config row is a DIFFERENT dataset from 0.501: never overwrite the 0.501 rules with it.
- Cite decompiled `file:line` in comments when porting; many existing comments do.
- Do not edit or delete `millionaire-city.zip` or the `archive-*` directories; do not commit generated assets (`apps/client/public/{sprites,gui,audio,fonts?,ground}`, `generated/`, `decompiled/`, `tools/oracle/out/`).

## Round 4 update (2026-10-07)
- FIXED: expansion signs (position, fences via `fence.swf`, click + BuyAreaCursor), purchase popup Invest/Buy logic; move tool (multi-tool click no longer also selects; refused placement shows `popup_missage`); rival buildings (hover InfoBoxCommerceRival/Wonder, no-road icon, 3 s SellBar then ownership change; timers are inactive in 0.501); left info-box x; investments intro screen and stats without %.
- Larger windows: checked at 1280x800 and 1920x1080, virtual-760-stage decision kept.
- Collectibles: Cake House frame colour fixed, Gift opens the Send Gift window, Get/Buy matches; still open: "New!" star + info arrow flags, claim-reward popups. Other open items: visitor mode (half-added `ToolsBar.setVisitor`, `HudView.setVisited`, `visitorChrome`; unverified), news/journal and second mission popup on the magazine, investments help "i" slideshow.

## Round 5 update (2026-10-07)
- DONE: company value lag (client no longer pre-syncs the security baseline; server keeps compValueNow), gold instant build (exchange path), move via the briefcase multifunction bar (PopupPayMove + rent crane + upd_suspended), collectibles (flags, New! star, arrow, help slideshow, "Well Done!" claim popup). New flows in `tools/oracle/flows`: `instant-gold`, `earn-coins`, `move`, `collectibles` (coordinates in the files; collectibles needs `AX=162 AY=394 CX=607 CY=521`). Oracle outputs in `tools/oracle/out/flow-<name>`.
- ACCEPTED difference: persisted `earnDCCoins/1` counter (see docs/save-parity.md Round 5).
- Still deferred as before: upgrades/visitors, investments results, news/journal, rival timers, Facebook stand-ins. Not ported: claim flow for `item` rewards compared only by code (ToolBuild gift), HQ auto-scroll before the claim popup, plane reward animation, collectible Get-button tutorial arrow (`collectiblesShopGetEnhancedShown`).

## Round 6 update (quality and optimisation)

- Assets/build (`docs/performance.md`, "Assets and build"): optimised build staged in `apps/client/public-opt/` (lossless WebP, dedup, 333 unreachable clips dropped): 537 MB -> 277 MB, boot 311 req / 14.4 MB -> 260 req / 7.8 MB, pixel check 0 diffs over 15,474 files. NOT swapped in: run `python3 tools/apply_optimised_assets.py apply` (backup in `public-bak`, `restore` undoes) only when no other agent is using `apps/client/public`; then `npm run build:client` (`MCITY_OPT=1` selects public-opt). Pipeline order: export -> `fix_old_grass.py` -> `optimize_assets.py`. Server static serving (`apps/server/src/clientStatic.ts`): brotli/gzip, immutable caching for hashed assets, ETag + 1-day for sprites/gui/ground/audio, serves `X.png` from `X.webp`.
- Runtime (`docs/performance.md`): viewport culling, fewer per-frame allocations, overlay transform caching; ~8-10% fps and ~2x less JS per frame on a 441-item stress city (SwiftShader; ~90% of main-thread time is software fill, so real GPUs will differ). Remaining runtime lever: sprite atlases / fewer sprites.
- Bug fixed: the client crashed at boot (`Economy.nodeOf`) when a save held an item whose definition is not served (e.g. expired limited-edition `houses_015_001_bavarian`). `Game.boot` now keeps such items in the save untouched but does not simulate them (`console.warn`). Covered by tsc/vitest only; not driven at runtime with such a save. TODO: add a regression test with a save containing an unknown sku.
- Open question: in the stress city a click on a decoration selected nothing (before and after the perf changes). Check against the original (`ItemObject`/`Tool` select rules for decorations) and the oracle whether decorations are selectable; may be correct.
- Not done: 5-minute memory soak (a ~20 s run showed flat heap), per-sku split of index.json, ground tiling, gui preview pruning (~15 MB), full place-and-collect run on the optimised build.

## Round 7 update (Lead pass on mission parity, class based; see docs/missions-efficient-plan.md)

Result (docs/missions-status.md, generated): 10 oracle-EQUAL runs (C31 nameCity, C08 build sku, C10 build subgroup, C16/C15 collect, C23/C24 earn incl. alt mission 98, C30 moveHouse, C12 buyExpansion) = 104 missions MATCH (10 oracle + 94 by class), 4 STATIC (alt checkInfluence missions without `amount`), 90 DEFERRED, 120 TODO.

Fixed in the client (all verified against the preserved original runs):
- Security baseline order: `security.init()` now runs AFTER the boot-time company value recompute, as the original does (DollarsGame.as:815 recompute, :1582 securityInit): first snapshot compValueGain 0 (was +152,000).
- Decorations placed or moved onto owned terrain destroy that terrain with refund + `update_map del Terrain` (Map.placeItem :1514-1527, destroyTile/destroyTileApplyEconomy); order new_item, del Terrain, poll (move: del Terrain before the move cost and command); `dec` = 1 for decorations on move/destroy (getFormatId).
- `update_next_rent`: Profile.nextRentUpdate dedupe rule ported (same item running down to 0 sends nothing).
- Earn thresholds checked against the SAVED coins/cash/company value at load are local counts (nothing sent before RUN_WORLD; Profile.eventsBuild), the recomputed company value is checked afterwards and sends.
- Plot purchase: company value recomputed after the `update_plots` command (Map.buyPlot), mission event registered after it.
- Construction end: the building value is added after the `new_state` command is created (the next snapshot carries it); `smLastCompValueGain` starts NaN (serialises as null) like the original.
- checkInfluence missions (39) were never fed (nothing listened to `commerce-population`).

Accepted differences (tools/missions/accepted.json, with reasons): seed timestamps (`dailyRewardsLastGivenDate`), flow-timing countdowns, and in C15 the `update_next_rent` 180 caused by our page-unload flush of queued commands (the original loses commands still queued when the page reloads).

OPEN, high priority gameplay difference found (not implemented): CONSTRUCTION END NEEDS A CLICK in the original. When construction time reaches 0 (also right after an instant build) the house shows `NotificationConstructionEnd` (`Event_Contract_anim`, StateOnConstructionOwner.as:268-278); clicking it calls `company.initItemAfterConstruction` (NotificationConstructionEnd.as:onAccept), which sends `new_state` RENT and adds the building value. Ours completes automatically. Effect: C26 (instant build) stays DIFFERENT (original keeps `Item id0 mode 4 time <remaining>` in the save until the click; ours writes `id1 mode1` at once) and the timing of company value/new_state differs in every build flow. Needs: construction-end state in `game/simulation.ts` and `game.ts` (no auto transition), click handling in `activateTile`, the bubble in `ui/extras/bubbles.ts`, load behaviour for items whose time ran out, tutorial instant-build step, and test updates.

Other open: C24-308 (alt) needs `altMissions:1` in its seed; classes C06, C07, C09, C11, C17-C20, C25, C29 still blocked on flow authoring (placement coordinates), influence/bonus classes C13, C14, C03-C05 not attempted. Harness fixes: `tools/oracle/run.mjs` now writes `out/flow-<FLOW>`; `tools/missions/rerun_ours.sh` reruns our side against a preserved original run.
