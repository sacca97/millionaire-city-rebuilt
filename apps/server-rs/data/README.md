# Fixed save data

These JSON files hold the pure data of the former TypeScript save defaults (`apps/server/src/saveDefaults/`, last present in git
history). **They are the source of truth now**: the TS server and its export script are gone, edit the JSON directly. The Rust server
embeds them with `include_str!`, so rebuild after a change. Format: each file is an object keyed by export name, in source order,
pretty-printed with 2-space indent and a trailing newline. A former `Set` is an array in insertion order.

The table below records where each entry came from (historic TS source files, for reference when reading git history). Entries
marked LOGIC were ported to Rust code and have no JSON.

| Source file | Symbol | Class | Notes |
|---|---|---|---|
| `constants.ts` | `DEFAULT_CITY_NAME` | PURE DATA -> `constants.json` | |
| `constants.ts` | `DEFAULT_CITY_NAME_CODES` | PURE DATA -> `constants.json` | |
| `constants.ts` | `DEFAULT_ABANDON_MINUTES` | PURE DATA -> `constants.json` | |
| `constants.ts` | `DEFAULT_ABANDON_TIME_PERCENTAGE` | PURE DATA -> `constants.json` | |
| `constants.ts` | `STARTER_WORLD_SID` | PURE DATA -> `constants.json` | |
| `constants.ts` | `STARTER_COMPANY_MINE_SID` | PURE DATA -> `constants.json` | |
| `constants.ts` | `STARTER_COMPANY_RIVAL_SID` | PURE DATA -> `constants.json` | |
| `constants.ts` | `STARTER_COIN_BALANCE` | PURE DATA -> `constants.json` | |
| `constants.ts` | `STARTER_COMPANY_VALUE` | PURE DATA -> `constants.json` | |
| `constants.ts` | `NPC_PRIMARY_USER_ID` | PURE DATA -> `constants.json` | |
| `constants.ts` | `NPC_SHEIK_USER_ID` | PURE DATA -> `constants.json` | |
| `constants.ts` | `TUTORIAL_COMPLETED_HQ_TILE` | PURE DATA -> `constants.json` | |
| `constants.ts` | `TUTORIAL_COMPLETED_HOUSE_TILE` | PURE DATA -> `constants.json` | |
| `constants.ts` | `TUTORIAL_COMPLETED_TREE_TILE` | PURE DATA -> `constants.json` | |
| `constants.ts` | `TUTORIAL_COMPLETED_TERRAIN_TILES` | PURE DATA -> `constants.json` | |
| `constants.ts` | `TUTORIAL_COMPLETED_ROAD_TILES` | PURE DATA -> `constants.json` | |
| `constants.ts` | `TUTORIAL_COMPLETED_INITIAL_MISSIONS` | PURE DATA -> `constants.json` | |
| `constants.ts` | `COMPLETED_MISSION_POLL_RULES` | PURE DATA -> `constants.json` | |
| `constants.ts` | `STALE_TUTORIAL_POLL_MISSION_SKUS` | PURE DATA -> `constants.json` | `Set`, written as an array |
| `constants.ts` | `UNLOCKED_MISSION_RULES` | PURE DATA -> `constants.json` | |
| `collectibles.ts` | `createEmptyCollectiblesDocument` | PURE DATA -> `collectibles.json` | No inputs; called with no args |
| `collectibles.ts` | `createEmptyCollectiblePendingDocument` | PURE DATA -> `collectibles.json` | No inputs; called with no args |
| `items.ts` | `createHeadQuarterDecorations` | PURE DATA -> `items.json` | Default arg `currentSku = "HeadQuarter_01"`; called with no args |
| `items.ts` | `createCompanyElement` | LOGIC | Wraps attributes and children in a `Company` element; uses attributes and children inputs |
| `items.ts` | `createRivalSaleItem` | LOGIC | Builds a rival-sale `Item` with `csid` from `STARTER_COMPANY_RIVAL_SID`; uses sid, sku, x, y |
| `items.ts` | `createBuiltItem` | LOGIC | Builds a built `Item` element; uses sid, csid, sku, x, y |
| `items.ts` | `createWaitingContractHouseItem` | LOGIC | Builds a house `Item` in the waiting-contract state; uses sid, csid, sku, x, y |
| `items.ts` | `createRentingIncomeItem` | LOGIC | Builds a renting house `Item` with income state; uses its sid, csid, sku, position and income arguments |
| `items.ts` | `createHeadQuarterItem` | LOGIC | Builds the HQ `Item` with its decorations; uses sid, csid, x, y, currentSku |
| `items.ts` | `isItemElement` | LOGIC | Tests whether an entry has an `Item` array; uses the entry |
| `items.ts` | `isHouseSku` | LOGIC | `sku.startsWith("houses_")`; uses the sku |
| `items.ts` | `getNextItemSid` | LOGIC | Max numeric `sid` over items, plus one; uses the item list |
| `geometry.ts` | `createRectChunk` | LOGIC | Lists `x:y` tiles of a rectangle; uses start and size |
| `geometry.ts` | `createHorizontalChunk` | LOGIC | Lists `x:y` tiles on a row; uses start, end, y |
| `geometry.ts` | `createVerticalChunk` | LOGIC | Lists `x:y` tiles on a column; uses x, start, end |
| `neighbors.ts` | `createNeighborUniverse` | LOGIC | Picks the NPC universe for a user id (advisor or Sheik); uses `targetUserId`, `bossGenre` |
| `neighbors.ts` | `createVisitorNeighborUniverse` | LOGIC | Empty tutorial-finished town with the HQ only; uses `targetUserId` |
| `ronaldLayout.ts` | `RONALD_PLOTS_TYPE` | PURE DATA -> `ronaldLayout.json` | |
| `ronaldLayout.ts` | `RONALD_TERRAIN_RANGES` | PURE DATA -> `ronaldLayout.json` | |
| `ronaldLayout.ts` | `RONALD_ROAD_RANGES` | PURE DATA -> `ronaldLayout.json` | |
| `ronaldLayout.ts` | `RONALD_LAYOUT_ITEMS` | PURE DATA -> `ronaldLayout.json` | |
| `ronaldLayout.ts` | `RonaldLayoutItem`, `RonaldLayoutItemState` | TYPE | Type-only, no runtime data |
| `sheikLayout.ts` | `SHEIK_PLOTS_TYPE` | PURE DATA -> `sheikLayout.json` | |
| `sheikLayout.ts` | `SHEIK_TERRAIN_RANGES` | PURE DATA -> `sheikLayout.json` | |
| `sheikLayout.ts` | `SHEIK_ROAD_RANGES` | PURE DATA -> `sheikLayout.json` | |
| `sheikLayout.ts` | `SHEIK_LAYOUT_ITEMS` | PURE DATA -> `sheikLayout.json` | |
| `sheikLayout.ts` | `TileRange`, `SheikLayoutItem`, `SheikLayoutItemState` | TYPE | Type-only, no runtime data |
| `starter.ts` | `createFreshSaveBundle` | PURE DATA -> `starter.json` | Default arg `userExtId = DEFAULT_USER_EXT_ID`; called with no args. Whole fresh save bundle (17 tags) |
| `starter.ts` | `SaveBundle` | TYPE | Type-only, no runtime data |
| `starterDecorations.ts` | `createStarterDecorationItems` | LOGIC | Maps the (unexported) starter decoration table to `Item`s; uses `companySid`. The table is inside the `starter.json` bundle |
| `timers.ts` | `normalizeHouseRentState` | LOGIC | Normalizes a house's rent `State` element (inserts one if missing); uses state, item children, `nowMs` |
| `timers.ts` | `normalizeConstructionState` | LOGIC | Normalizes a construction timer state; uses the state's time, mode, savedAt and `nowMs` |
| `timers.ts` | `getContractIncomeTimeMs` | LOGIC | Looks up income time by contract sku in a map built from `contracts.xml` (0 if unknown); uses contract sku |
| `tutorial.ts` | `normalizeCompletedTutorialUniverse` | LOGIC | Repairs a finished-tutorial save; uses the document and `nowMs` (defaults to `Date.now()`) |
| `tutorial.ts` | `normalizeIncompleteTutorialUniverse` | LOGIC | Repairs an unfinished-tutorial save (no-op if tutorial already ended); uses the document |
| `paths.ts` | `RULES_ROOT`, `SETTINGS_PATH`, `CONTRACTS_PATH`, `ITEM_DEFINITIONS_PATH`, `MISSION_DEFINITIONS_PATH`, `XP_TABLE_PATH` | NOT DATA (paths) | Filesystem paths to the rules XML, resolved from `__dirname`; not exported. The Rust server resolves its own paths |
| `saveDefaults.ts` | (re-exports only) | n/a | Barrel file; no symbols of its own |
