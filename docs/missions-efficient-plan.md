# Efficient mission parity: class-based plan

Replaces the "test all 318 missions one by one on the oracle" approach of `docs/missions-parity-plan.md` / `docs/missions-complete-checklist.md` (keep those as history; do not extend the checklist by hand). The agent instructions to paste into models are in `docs/missions-agent-instructions.md`.

## 1. Idea

The 318 definitions (87 default, 231 alt) are instances of 36 **mechanism classes** (`docs/missions-classes.md`, generated): event type x how the parameter matches x target amount 1 or >1 x threshold condition x prerequisite kind. Reward handling is separate code and is classified separately (7 reward-shape classes x 3 reward groups). Behaviour is shared code, so:

1. **Everything that is data is checked on all 318 rows, cheaply, automatically** (no oracle).
2. **Everything that is behaviour is checked once per class on the ORACLE (the real original client)**, with the original's commands and saved documents compared against ours, including a reload.
3. A row is only "MATCH" when a script says so, from tamper-evident evidence. Nobody types statuses.

Scope: 25 in-scope classes (228 missions). 11 classes (90 missions: upgrade, collectUpgraded, visitPartner, visitCity, investment, investmentDone, askForHelp, beat) are DEFERRED by the user.

## 2. What already exists (this repo, generated/verified on the current tree)

| Piece | File | What it does |
|---|---|---|
| Class generator | `tools/missions/classes.py` | writes `tools/missions/out/classes.json` and `docs/missions-classes.md` (36 mechanism classes, 7 reward-shape classes, a representative sku per class and a second one from the other set) |
| Static sweep (all 318) | `tools/missions/static_sweep.py` | checks unique skus, 87/231 split, prerequisites exist in the same set and have no cycle, reward lists well formed, reward item skus exist, parameters resolve (mirrors `itemEventParameters`), every event type has an emission point in the client. Current result: 0 errors, 9 warnings (all explained below) |
| Synthetic sweep (all 318 x 3 reward groups) | `apps/client/test/missions-sweep.test.ts` | drives every mission through OUR state machine: unlocked -> reached send -> reward -> given send with the delayed claim, exact coins/exp/item rewards for groups 0/1/2, no double pay, reload restores GIVEN with no send. Plus a full-set run per set (default completes fully; alt completes except 4 data-quirk missions). 956 tests pass |
| Evidence writer | `tools/missions/verify.py` | compares one original-vs-ours oracle run (commands + every save dump incl. a reload dump) and writes `tools/missions/evidence/<flow>.json` with file hashes. `tools/missions/accepted.json` lists accepted differences with reasons (only the Lead edits it) |
| Status generator | `tools/missions/mark.py` | recomputes `docs/missions-status.md` (the only authoritative status table) from the class map, evidence (hashes re-checked), the static sweep and the synthetic sweep. Statuses: MATCH (oracle), MATCH by class Cxx, STATIC (needs a citation in `tools/missions/manual.json`), DEFERRED, TODO |
| Oracle harness | `tools/oracle/` | `FLOW=<name> node tools/oracle/run.mjs flow` (original) and `tools/oracle/ours-flow.mjs <name>` (ours) over the same flow file in `tools/oracle/flows/`; existing mission flows: `mission-build`, `mission-collect`, `mission-earn`, `mission-expansion`, `mission-reload`, `mission-reward-variant`, `mission-default-item-reward`, `missions-instant-expansion`, plus `move`, `sell-rival-roads` |

Findings already produced by the new tooling:
- **Bug fixed:** `checkInfluence` missions (39 missions, 11 default) could never progress: `Game` emitted `commerce-population` but nothing listened. `ui/missions/system.ts` now feeds `checkInfluence<nameType>` and `checkInfluence<sku>` as in `StateOnRent.as:1348-1372`. Still needs oracle evidence (classes C13, C14).
- Quirks identical to the original (MATCH by code): missions 217, 222, 227, 238 (alt `checkInfluence` stadium missions) have no `amount`, so `hasTrigger()` is false (`MissionDefinition.as:282-285`) and they never progress in either client; `bonus houses_001` (25, 26) matches no sku and is fed via the `houses_<n>` sub-key in `ui/missions/system.ts`.
- Event types with no emission point in our client: askForHelp, investmentDone, visitPartner (all deferred classes).

## 3. Pipeline (what to run, in order)

```text
python3 tools/missions/classes.py            # regenerate classes (only if rules XML changed)
python3 tools/missions/static_sweep.py       # must exit 0
cd apps/client && npx vitest run test/missions-sweep.test.ts   # must pass (956 tests)
# per class: write flow -> run original -> run ours -> verify (see section 5)
python3 tools/missions/mark.py               # regenerate docs/missions-status.md
```

## 4. Work packages

**WP0 (done here):** classes, static sweep, synthetic sweep, verify/mark tooling, `checkInfluence` fix.

**WP1 Lead (strong model), about 1.5 h:** read decompiled `missions/*`, `utils/poll/*`, `model/*` mission code and the Java `GamePlay.java:1346`; confirm for each mechanism class how the original counts (event key, when emitted, parameter fan-out); compare with `ui/missions/system.ts` and `game/game.ts` emission points; fix differences; maintain `accepted.json` and `manual.json`; review every non-equal evidence.

**WP2 Workers (cheap models), about 3 h total, parallelisable by class group:** write and run oracle flows per class using the recipes below, then run `verify.py`. Workers never change product code.

Suggested order (cheapest and most informative first). `rep` skus come from `docs/missions-classes.md`.

| Group | Classes | Existing recipe to copy | Notes |
|---|---|---|---|
| A (done flows exist) | C31 nameCity, C26 instantBuild, C12 buyExpansion, C23/C24 earn, C09/C10 build sku, C15 collect nameType | `missions-instant-expansion`, `mission-expansion`, `mission-earn`, `mission-build`, `mission-collect` | turn the existing flow outputs into `verify.py` evidence first; only run new flows where no evidence file can be produced from a run that has two save dumps |
| B build variants | C06 build nameType>1, C07 build no-param>1, C08 build other>1, C10 build sku>1 | `mission-build` | build a decoration/commerce with the shop tabs (see recipe file for tab coordinates); use an item that the rep mission names |
| C collect variants | C16-C20 | `mission-collect` | needs a house with a signed contract and shortened timers (seed or DB edit as in `build-flow`) |
| D move and email | C29/C30 moveHouse, C25 giveEmail | `move`, email popup path in `ui/extras/email.ts` | move uses the briefcase multi-tool (see `flows/move.mjs`) |
| E influence | C13/C14 checkInfluence, C03-C05 bonus | none | hardest: a commerce next to houses; seed items in the save and wait for population; only after the Lead confirms the fix |
| F buy | C11 buy | `sell-rival-roads` | rival purchase completes the `buy` event; the user deferred rival polish but the `buy` mission class needs one run |

**WP3 Lead, about 45 min:** read all worker notes and evidence, decide accepted differences or fixes, rerun the sweeps, run `mark.py`, write the summary in `docs/parity-plan.md`.

**WP4 optional alt-set sanity (about 30 min, low value):** the alt set only activates with the `altMissions` profile flag (A/B group). The synthetic sweep already covers all 231 rows; add one oracle run with `altMissions` set and one alt mission per differing class only if a class has an alt-only reward shape (R01 is 231 alt missions: coins+exp, no group 2).

## 5. How a class run works (exact)

1. Seed: a flow file exports `seed(u, prof)` setting `prof.exp`, `prof.DCCoins`, `prof.DCCash` and the mission lists (copy the `Missions` block from `flows/mission-build.mjs`: `Up` chunk "6" means mission 6 is Up). To test the reward group set the profile flag (`flags` string, e.g. `missionAltReward:1`) in the same `seed`.
2. Act: the flow clicks the minimum real actions that trigger the mission (copy click sequences from the recipe flows; coordinates are in a 760x600 stage and are shared by both clients).
3. Record: `stat("label")` prints coins/xp/company value; `dump("label")` writes a save dump; the harness writes every cmdList to `cmds.jsonl`. Every flow must call `dump("completed")` after the mission completes and `await reload()` then `dump("final")` after a reload.
4. Original: `FLOW=<name> MCITY_ORACLE_PORT_BASE=<base> node tools/oracle/run.mjs flow` (outputs `tools/oracle/out/flow-<name>/`).
5. Ours: build a test client to a scratch dir (`cd apps/client && npx vite build --outDir /tmp/mc-<id>`), then `CHROME=$HOME/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome MCITY_CLIENT_DIST=/tmp/mc-<id> OUT=/tmp/ours-<name> PORT=<port> PREVIEW=http://127.0.0.1:<port>/ node tools/oracle/ours-flow.mjs <name>`.
6. Verify: `python3 tools/missions/verify.py --flow <name> --skus <comma list> --class <Cxx> --reward-group <0|1|2> --reload --orig tools/oracle/out/flow-<name> --ours /tmp/ours-<name>`.
7. Result: `EQUAL` (evidence written) or `DIFFERENT` with the remaining differences printed: record them in `tools/missions/worker-notes/<Cxx>.md` and stop on that class (do not fix product code).

Reward-shape coverage: after the mechanism runs, run one mission per reward-shape class and per reward group that exists for it (table at the bottom of `docs/missions-status.md`), reusing a cheap mechanism (e.g. nameCity-like or earn flows) with the other group's flag.

## 6. Acceptance

- `python3 tools/missions/static_sweep.py` exits 0; `missions-sweep.test.ts` passes; `npm run test:rewrite` and `cd apps/client && npx tsc --noEmit` pass.
- `docs/missions-status.md`: every in-scope class has at least one `MATCH (oracle)` row (so all its rows read `MATCH by class`), or its blocker is written in a worker note and in `docs/parity-plan.md`; no in-scope row is `TODO` without a stated reason.
- Reward-shape table has an oracle run for every class in the groups that exist.
- Reload checks included in every evidence file (`--reload`), including one run where the mission is Reached but unclaimed at reload.

## 7. Time estimate

About 4-6 hours of agent time end to end (Lead 2.25 h + workers 3 h in parallel), compared with days for 318 oracle runs. The data-level risk across all 318 rows is covered by the sweeps in minutes.

## 8. Risks

- The class key assumes the same code path serves all members. If the oracle shows a member-specific behaviour (e.g. a sku with a special-case in `ItemObject.registerEvent`), split the class (edit `classes.py`) and run that member.
- Counting moments (construction start vs finish, collect vs give-income) are the likeliest real differences; the build and collect runs exist to catch them.
- Seeding mission/poll documents requires the exact document layout; copy from a real original-client dump (`tools/oracle/out/flow-*/final.saves.json`).
