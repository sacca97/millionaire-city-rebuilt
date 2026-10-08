# INVESTIGATE C07: "World of Wonder: N More" (sku 148, 208, 253)

Read-only investigation. No oracle runs, no edits outside this file.

## Verdict

In the decompiled ORIGINAL client, no in-game action advances 148, 208 or 253. Their poll key is the bare string `"build"`, and no code path registers a bare `"build"`. Every build registers only `build<nameType>`, `build<nameType>_<subtype>` and `build<sku>`. The rebuilt TS client has the same fan-out, so TS matches the original (both never advance).

The mission text says the opposite of what the data does. EN.txt:1759, for 148, reads "Build any 2 more Wonders of your choice", and the 208 and 253 descriptions say the same for 3 and 4. The XML has no `parameter="Wonders"`, so the intended trigger is lost in the data. This is a data bug in the original, not something a player can work around.

## Why (original, decompiled/scripts/com/dchoc/dollars)

1. Definition. `assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/missionDefinitions.xml` lines 146, 205, 249: `type="build"`, `amount="2|3|4"`, no `parameter` attribute. Compare mission 9 (line 10: `type="build" parameter="Commerces"`) and mission 92 (`parameter="decorations_tree_01"`). The C06 class (`docs/missions-classes.md:13`, `build|p:nameType`) uses the parameter. C07 (`p:none`) has none.
2. Parsing. `model/rules/ActionGetMissionDefinitions.as:22-24`: `eventType = @type`, `eventParameter = @parameter` (missing attribute gives `""`), `eventAmount = @amount`. No `@condition`, so `eventCondition` stays `NO_CONDITION` (-1).
3. Event key. `MissionDefinition.as:139` `getEventSku()` = `eventType + eventParameter` = `"build"`. `MissionObject.as:59-62` creates `new PollEvent("build", "", -1)` in the PollManager dictionary, keyed by `sku`. `MissionObject.as:170` and `:231` read progress from the same key.
4. Feed. `PollManager.as:112-117` `registerEvent(param1, param2 = "")` does `param1 += param2` (:117), then looks up the dictionary. The only build feed is `map/tools/ToolBuild.as:243` `_loc2_.registerEvent(MISSION_EVENT_BUILD_ITEM)` (`MISSION_EVENT_BUILD_ITEM = "build"`, `missions/MissionsEventIDs.as:6`). That `_loc2_` is an ItemObject, so the call is `ItemObject.registerEvent` (`world/items/ItemObject.as:2787-2802`), which always passes a second argument: `nameType` (:2791), `nameType + "_" + subtype` (:2797), `sku` (:2801). The feeds are therefore `buildHouses|Commerces|Decorations|Wonders|Clubs`, their subtypes, and the sku. Never the bare `build`.
5. Other `registerEvent` call sites in the package are for other events (buildRoads, instantBuild, askForHelp, buyExpansion, visit*, investment*, collect*, upgrade, buy/sell), or fan out through ItemObject. None uses `"build"` alone. `ToolBuild.as:243` is the only `"build"` call site in the decompiled tree.
6. Wonder path. A wonder can only reach the poll through an ItemObject, which always appends a parameter, so it cannot produce a bare `build`. A wonder build feeds `buildWonders` and `build<sku>` (`NAME_TYPES`, `ItemDefinition.as:78`, index 3 = "Wonders"). `WonderTypeDefinition.as` only calls `Profile.registerEventsAdd/Remove` (NPC income), not PollManager. No mission uses `parameter="Wonders"` (grep confirmed).
7. Oracle consistency. Decorations built feed `builddecorations_tree_01` (mission 92 completes). Houses feed `buildHouses` / `houses_001_001`, which no mission listens to, so the PollManager stays empty (matches the C07 notes). Mission 148 stays at 0 because nothing writes key `build`.
8. Archive copy (`archive-recovery-2026-10-06/actionscript/...`) has the same fan-out (`ItemObject.as:375-390`), so this is not a decompile artifact.
9. Server. `archive-recovery-2026-10-06/java` has no `"build"` string literal. `GamePlay.java:1346-1380` `updateMissions` only moves the sku between the Up, Reached and Given chunks (`Util.chunkValueAdd/Remove`) and never computes progress. The server cannot feed a `build/N` Count entry, so the client is the only feeder, and it never registers a bare `build`.

## Gating (for 148/208/253 to be Up, not to advance)

- `altMissions:1` profile flag (`showInABtest="alt_missions"`), per `docs/missions-flow-recipes.md` and the C07 notes.
- `unlockLevel` 19 (148), 42 (208), 69 (253).
- Nothing about a wonder, its price or its shop page affects the trigger.

## Answers

(1) In-game sequence: none. In the original, building any wonder, house, decoration or club, from any shop page, does not advance 148/208/253. The only build events are the nameType and sku keys listed in point 4.

(2) Our equivalent and parity:
- Build sources: `apps/client/src/game/game.ts:911` (`build`, comment `// ToolBuild.as:243`) and `game/game.ts:973` (`buildWithoutConstruction`, :920) both call `this.poll("build", sku)`. `game/game.ts:1874-1878` `poll()` emits `{type, sku, extra}`.
- Fan-out: `apps/client/src/ui/missions/system.ts:167-182` (`game.on("poll", ...)`). With a sku it calls `manager.register(type, p)` for each `itemEventParameters(nameType, sku, subtype)` (`game/missions.ts:816-822`, same order as ItemObject.as:2791-2801). `nameTypeOf` (`game/missions.ts:808-812`) mirrors NAME_TYPES.
- Key lookup: `game/missions.ts:310-312` `registerEvent(type, parameter = "")` -> `events.get(type + parameter)`. `eventSku` (`game/missions.ts:160`) = type + parameter, so 148 is keyed `"build"`.
- The bare `manager.register("build")` is reached only when `sku === undefined` (`system.ts:169-170`), which never happens for `"build"` because both game.ts call sites pass the sku.

Parity: MATCHES the original. Both never advance these three missions.

Proposed change (NOT parity; an intent-based fix to a data bug, only if the team wants the missions completable as the text describes): in `apps/client/src/ui/missions/system.ts` `wire()`, in the `else` branch at :178-179, when `type === MISSION_EVENT.build && nameTypeOf(...) === "Wonders"`, also call `manager.register(MISSION_EVENT.build)` (bare key). That makes any Wonder build count toward the parameter-less build missions (148/208/253 only, since no other mission uses key `build`). Strict parity with the original means no change.

## Lead: optional falsification test (not run)

A single oracle run that builds `wonder_statue_of_money` (cheapest per C07 notes) should show the poll chunk gets `buildWonders` and `buildwonder_statue_of_money` with no matching event, and mission 148 stays at 0. If the chunk shows a bare `build` entry, this verdict is wrong.

## Files
- assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/missionDefinitions.xml:146, 205, 249
- assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Locale/EN.txt:1759, 1879, 1967 (descriptions: "Build any N more Wonders")
- decompiled/scripts/com/dchoc/dollars/utils/poll/PollManager.as:112-117
- decompiled/scripts/com/dchoc/dollars/world/items/ItemObject.as:2787-2802
- decompiled/scripts/com/dchoc/dollars/map/tools/ToolBuild.as:243
- decompiled/scripts/com/dchoc/dollars/missions/MissionObject.as:59-62
- decompiled/scripts/com/dchoc/dollars/missions/MissionDefinition.as:139
- decompiled/scripts/com/dchoc/dollars/model/rules/ActionGetMissionDefinitions.as:22-24
- archive-recovery-2026-10-06/java/dollars/GamePlay.java:1346-1380
- apps/client/src/game/missions.ts:160, 310-312, 808-822
- apps/client/src/ui/missions/system.ts:167-182
- apps/client/src/game/game.ts:911, 973, 1874-1878
