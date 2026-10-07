# Plan: mission chains parity (rewrite vs original)

Task: exhaustively exercise all 318 mission definitions in the default and alt sets. Read first: `docs/parity-plan.md` (handover: setup, test method, safety rules), `docs/save-parity.md`, `docs/visual-parity.md`, `tools/oracle/README.md`. Missions that depend on social/rival/investment/news interactions must be covered with deterministic local fixtures or an explicitly recorded blocker; do not silently omit them.

## 1. Goal

Prove (or fix until true) that every default and alt mission behaves identically in the rewrite and in the original 0.501 Flash client, including across page reloads:
- progress counting (what events advance which mission),
- the Up -> Reached -> Given state machine and the commands sent at each step,
- rewards (coins, exp, item rewards) and what ends up in the saved documents,
- survival of progress and state after a reload (both clients),
- the missions panel and popups (already matched visually in round 1; re-check only what changes).

Required coverage is all 87 default missions and all 231 alt missions. A row is complete only when its actual progress trigger, state transition, reward, saved state, and reload behavior have been checked in both clients. Seed only prerequisites, timers, balances, and unavailable external state; never seed a mission as Reached/Given in place of exercising its trigger. Every seeded prerequisite must be recorded in the checklist.

## 2. What exists (read these)

Ours
- `apps/client/src/game/missions.ts` (+ `missions.test.ts`): definition parsing, PollEvent/PollManager, MissionObjectManager state machine. Sends three commands per mission (unlock, reached, given); nothing sent on load; claim pays the profile first, then sends `update_missions` with a negative-delayed claim.
- `apps/client/src/ui/missions/` (`panel.ts`, `popups.ts`, `iconlayer.ts`, `logic.ts`, `system.ts`, `index.ts`): panel, reward popups, left icon column.
- `game.poll(type, sku?)` in `game/game.ts` feeds events (build, move, collect, instantBuild, buyExpansion, etc.). `commands.ts` builders: `update_missions`, `update_pollmanager`, `poll(...)`.
- Server: `apps/server/src/commandHandlers.ts` `applyMissionsMutation` (around line 1520) and `commandHandlers/offline.ts` `stepMission` / `getMissionReward` (Java port of `GamePlay.java:1346-1389`: not in any list -> Up -> Reached -> Given; reward paid only on Reached->Given, validated against missionDefinitions.xml; balance ends at max(client `*Now` snapshot, before+reward)). `saveDefaults/tutorial.ts` no longer seeds the Up list.
- Data: `assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/missionDefinitions.xml` (318 definitions: types build 78, collect 49, checkInfluence 39, upgrade 39, earn 28, collectUpgraded 26, bonus 18, visitPartner 8, buyExpansion 6, investment 6, investmentDone 6, nameCity 2, buy 2, instantBuild 2, visitCity 2, beat 2, giveEmail 2, moveHouse 2, askForHelp 1). Rewards: `rewardType`/`rewardAmount` plus A/B variants `rewardTypeABtest1/2`, `rewardAmountABtest1/2` (e.g. "coins;exp" = "45000;170").
- Mission sets: 87 missions load by default; 231 `alt_missions` are selected by the `altMissions` profile flag (A/B group in the original; `archive-recovery-2026-10-06/java/dollars/Rules.java` shows how variants are chosen).

Original (the references to port from)
- Decompiled client: `decompiled/scripts/com/dchoc/dollars` (regenerate if missing, see `docs/parity-plan.md` section 2): look for MissionObjectManager, PollEvent/PollManager, MissionDefinition, UserDataFacade `updateMissions`/`updatePollManager`, the mission panel classes.
- Recovered Java: `archive-recovery-2026-10-06/java/dollars/GamePlay.java:1346` (missions state machine), `SecurityNormal.java` (reward validation), `Rules.java` (A/B variants).
- Oracle harness: `tools/oracle` (`node tools/oracle/run.mjs flow` with `FLOW=<name>`, flows in `tools/oracle/flows/`; rewrite: `MCITY_CLIENT_DIST=/tmp/<dir> PREVIEW=http://127.0.0.1:31863/ tools/oracle/ours-flow.mjs <name>` so the isolated server serves the test build and API from one origin; `cmds-diff.py` compares command payloads, `save-diff.py` compares saved documents; `MCITY_ORACLE_PORT_BASE` shifts original ports). Relevant flows: `mission-earn.mjs`, `missions-instant-expansion.mjs`.

## 3. Scope: which mission types to cover

Cover every row in `docs/missions-complete-checklist.md`: all 87 default missions and all 231 alt missions, including `upgrade`, `collectUpgraded`, `visitPartner`, `visitCity`, `investment`, `investmentDone`, `askForHelp`, and `beat`.

For every mission ID, exercise the condition that advances it, then claim its reward, inspect all changed saves and commands, reload, and confirm it remains Given without paying twice. Run the default set through its real prerequisite order where possible. For independent condition/reward coverage, seed only the documented prerequisite state and keep the mission itself Up. Run the alt set separately with `altMissions` enabled. Use deterministic fake neighbors/rival listings/partner responses only where remote services would otherwise block an action; validate the triggered command and resulting mission state against the original client. Mark a row blocked only when the original client cannot execute the action with the available local fixture, and retain the exact evidence.

## 4. Method

Setup and safety (same rules as the handover): temp DB per run; oracle base port 31853 (server 31853-55, control 31856), rewrite on 31863-65 serving the test client from `MCITY_CLIENT_DIST` (build with `npx vite build --outDir /tmp/<dir>`); never touch 31803; never `pkill -f` by pattern; record PIDs and stop only the processes started by the runner. At the end leave no processes running.

Phase A: static comparison (about 30-45 min)
1. Extract from the decompiled client and the Java: how events map to missions (event type and parameter matching, amount counting, whether progress is stored per mission or in PollManager counters, when `reached` is sent, when the reward is paid, what `update_pollmanager` carries).
2. Diff that against `game/missions.ts` and the server `stepMission`. Write the findings to `docs/missions-parity.md` and fix obvious differences first.
3. Pin findings in unit tests: for ~15 concrete (mission SKU, event sequence) cases assert reached/given transitions, reward amounts, and commands emitted. Reuse `apps/client/src/game/missions.test.ts` unless a separate suite materially improves organization.

Phase B: exhaustive mission runs (estimate after building the runner)
1. Generate and maintain a runnable row for every checklist ID. For default missions, first play the natural prerequisite chain from a clean save as far as the original supports it. Also isolate each mission with a fresh temporary save where its prerequisite is satisfied and the mission is Up; perform real UI/game actions to trigger it. Do not set its poll count, Reached state, or Given state to simulate success.
2. Repeat all 231 missions with the alt set enabled. Record the active A/B reward group and exercise each row's configured reward. Ensure fixtures cover each distinct reward variant used by the row.
3. Build a reusable action driver by event type and parameter (construction, collection, thresholds, rival/neighbor actions, etc.) so repeated mission rows share navigation but still log per-ID trigger and claim results. Seed only prerequisite state, resources, map space, shortened timers, and deterministic external responses.
4. Capture after each step: the commands the client sent (`cmdlog.cjs`), full save dumps, HUD numbers (coins, exp), and mission popup/panel screenshots.
5. Reload both clients and capture again: mission lists, poll counters, restored reward state, and no repeated payout.
6. Diff with `cmds-diff.py` and `save-diff.py`; ignore only seed timestamps, tokens, and the daily-reward roll. Fix every other mismatch or document an accepted difference with its reason (as done for `earnDCCoins`).
7. Fix our side (`game/missions.ts`, `ui/missions`, `net/commands.ts`); fix the server only where the original Java shows our server deviates (`applyMissionsMutation`, `offline.ts`). Keep the trusting-client model.

Phase C: reload robustness (run for every mission in Phase B)
- Specific scenarios: reload when a mission is Reached but not Given (the Get Reward button must appear and pay once); reload between the `reached` and `given` commands (queue flush on pagehide); reload mid-chain; claim then reload (no double pay); two missions reaching in one action (e.g. the Pizzalicious tier); the daily-reward and magazine popups stacking over mission popups.
- Verify each mission after claim/reload; additionally compare interruption points (Reached but unclaimed, between Reached and Given, and mid-chain) for each distinct transition path in both sets.

Phase D: alt-set coverage (included in Phase B, not optional)
- Confirm the profile flag selects all 231 alt definitions and excludes the 87 default definitions, then complete every alt row through its actual trigger and reward.
- Exercise default and AB reward variants recorded in the checklist, including item substitution, and assert exact inventory/currency/experience changes.

## 5. Deliverables and acceptance

- `docs/missions-parity.md`: table `mission/type | events driven | commands (orig vs ours) | save diff | reload result | status MATCH/fixed/accepted/remaining`, and the rules extracted in Phase A with decompiled/Java file:line citations.
- `docs/missions-complete-checklist.md`: all 318 mission definitions with set, SKU, trigger, prerequisite, reward variants, trigger status, claim/reload status, and evidence links. Every row must end MATCH or carry a specific blocker and evidence.
- New flows under `tools/oracle/flows/` (names like `mission-build.mjs`, `mission-collect.mjs`, `mission-reload.mjs`) runnable in both clients.
- Focused cases in `apps/client/src/game/missions.test.ts` (and server tests if the server changes).
- `docs/parity-plan.md` updated: mark item "Alt-mission set untested / mission chains across reloads" done or list what remains.
- Acceptance: all 318 checklist rows trigger, claim, persist, and reload in both clients, or have a specific original-client blocker with evidence; applicable command payloads and save changes match except documented differences; no reward is lost or doubled; `npm run test:rewrite` and `cd apps/client && npx tsc --noEmit` stay green. Do not commit.

## 6. Time estimate

This is a multi-session effort. First build the checklist and reusable action drivers; then execute each row in batched original/rewrite runs. Do not replace row-level results with type-level sampling.

## Execution update (2026-10-07)

- Phase A static audit completed and written to `docs/missions-parity.md`. Fixed shared threshold counter ordering/duplicates and mission reward A/B selection on client and server.
- Added focused client cases in the existing `apps/client/src/game/missions.test.ts` (reusing the current suite rather than creating a second file) and a server case in `apps/server/test/offline.test.ts`.
- Passed: `npm run test --workspace @mcity/client -- --run src/game/missions.test.ts`, client `tsc --noEmit`, `npm run test --workspace @mcity/server -- --run test/offline.test.ts` (22 tests), server `npx tsc --noEmit -p apps/server/tsconfig.json`, and `git diff --check`.
- Phase B/C representative oracle flows now completed: startup earn missions 44/43; exact-SKU build mission 6; collect mission 35; expansion and instant-build missions 4/5; loaded Reached mission 2 claim/reload; mission 20 group-2 item reward/reload. Results and known diffs are in `docs/missions-parity.md`. These establish mission event/reward/reload behavior for those cases, not exhaustive parity.
- The earn oracle exposed two client issues: saved profile earn/beat thresholds were not checked at startup, and a reward-triggered nested update reordered chained mission commands. Both are fixed; 17 mission tests and client typecheck pass. `tools/oracle/ours-flow.mjs` starts the local server directly with Node/tsx and waits for shutdown; the isolated server serves the separate client build via `MCITY_CLIENT_DIST` (Vite preview does not proxy `/Game`). The flows ran on original ports 31853-31856 and rewrite ports 31863-31865. Test build: `/tmp/mcity-mission-parity/dist`, via a separate `--outDir`.
- Remaining representative gaps: move, influence/bonus, prerequisite-chain endpoints/mid-chain reload, two missions reaching from one action, popup stacking, and alt-set gameplay. The new exhaustive scope additionally includes rival/partner/investment interactions, which need deterministic fixtures or evidence-backed blockers. Default item rewards now have a matched claim/reload flow using mission 47; saved state for Name It is also confirmed as Given in both clients after reload. The move probe seeded starter tree sid 2090 to `(4,1)`; `(506,364)` selected the Bungalow at `(4,2)` and emitted only `update_item/upd_suspended`, while `(490,292)` did not select the tree even with an explicit move confirmation. Mission 87 did not advance; a valid tree-selection and completed-move sequence is still needed. The `mission-collect` flow also exposes an unrelated `update_next_rent` metadata difference (original five updates vs rewrite seven); it is recorded as open, not as a mission mismatch.
- Alt-set parsing and both reward variants have unit coverage; alt-set gameplay sanity remains outstanding. Do not run `tools/apply_optimised_assets.py`; build test clients only with a separate `--outDir`; do not commit while the shared repository has other agents' uncommitted work.

## 7. Known risks

- The original's mission logic may count some events at a different moment than ours (construction start vs completion, collect vs giveRent): this is the most likely source of real differences.
- Seeding PollManager counters directly requires knowing the document layout: read an original-client save dump after a real mission first.
- Oracle input coordinates for popups are pixel-guessed; reuse `tools/oracle/lib.mjs` helpers and existing flows rather than re-deriving them.
- The oracle takes ~45 s to load; use `o.waitGame()`.
