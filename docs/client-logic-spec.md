# Client logic spec (L0, in progress)

Source: `decompiled/` (gitignored), produced with
`java -jar generated/tools/ffdec-26.0.0/ffdec.jar -export script decompiled assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Dollars.swf`.
Paths below are relative to `decompiled/scripts/com/dchoc/`.

## Verified facts

- Dollars.swf is AS3: FFDec exported 612 scripts.
- ExternalInterface appears only in `dollars/server/Server.as` and `dollars/utils/Mouse/MouseWheelEnabler.as` (plus bundled debug libraries). No `loadBytes`, `Socket`, `LocalConnection`, `Stage3D` or `domainMemory` in game code.
- Logical tile: `tileWidth=32 tileHeight=32`; area `15x10` tiles (`rules/mapDefinition.xml`, read in `dollars/map/MapDefinition.as:90`).
- (SUPERSEDED, see correction below: the city uses a top-down view) Isometric transform (`framework/world/view/IsometricView.as`), with tile screen size (W,H) and world tile size (SX,SY):
  - screen.x = W * (wx - wy) * 0.5 / SX
  - screen.y = H * ((wx + wy) * 0.5 - wz) / SY
  - inverse: wx = sx*SX/W + sy*SY/H; wy = sy*SY/H - sx*SX/W
  - `World` defaults to W=64 screen width. The screen height passed in at construction is still to be found.
- Placement (`dollars/map/Map.as:1462 placeItem`) uses `baseCols` x `baseRows` from itemDefinitions.xml and marks tiles as terrain. No standalone overlap/free-tile function was found by name, so validation is probably in the tools (`dollars/map/tools/ToolBuild.as`, `ToolMove.as`) or `TileData`.
- Rent/income state machine: `dollars/world/items/states/StateOnRent.as`. Income time comes from `ItemObject.incomeTime` (`dollars/world/items/ItemObject.as:436`), with contract override and `RulesFacade.settingsGetAbandonTime`.

## Verified: correction and L0 results

**Correction:** the city map is **top-down, not isometric**. `dollars/map/Map.as:283` sets `mView = new TopDownView()`. The `IsometricView` formulas above belong to the framework `World` default and are not used for city rendering. Do not build an isometric renderer.

- Top-down mapping (`framework/world/view/TopDownView.as`): screen = world, with optional snapping to the nearest tile when `param3` is true (rounds up past half a tile). With `tileWidth=tileHeight=32` (`mapDefinition.xml`), `tileX = floor(worldX / 32)` and `getTileXToWorld(i) = i * 32` (`Map.as:834`, `Map.as:2540`).
- Draw order: `WorldDisplayContainerSorted.sortChildren` is a single bubble pass that swaps neighbours by `mWorldX/Y + size`. It belongs to the framework `World`. The city uses layered sprites in `Map` (cars layers, top layer). Exact per-layer order is still to be read in `Map.as`.
- **Placement rule** (`Map.isBuildable`, `Map.as:1545`; called via `Tool.isItemAttachedAbleToBePlaced` -> `Map.isBuildableFromScreen`, `Map.as:688`): valid only if every tile in the `baseCols x baseRows` footprint is inside the map, passes `TileData.getIsBuildable()` (buildable flag, no base item, not a road, not solid; `TileData.as:127`), is inside the player's area (`isTileInAreaMine`), and is the player's terrain (`isMyTerrain`) when the item `requiresTerrainMine` and needs a plot. `ToolMove` also allows the item's current position. All of this is client-side. The server does not validate it.
- **Income** (`ItemObject.getIncomeValue`, `ItemObject.as:329`):
  - base = `def.getIncomeValue()` (XML `incomeCoins`) + `contract.getIncomeCoins()` (`getIncomeCoins`, `:987`).
  - commerce buildings: base x total population of the houses affected by the commerce.
  - upgrades: `+ extraPercentage(sid) * value / 100`.
  - then `+ influenceValue%` of the value, and `+ incomeLevelFactor * population` when positive.
  - income XP: `def.getIncomeXP() + contract.getIncomeXP()` (`:2923`). Income time: `ItemObject.incomeTime` (`:436`).
- Item definition values are checksummed and encrypted client-side (`ItemDefinition.as:357`, `EncryptionUtils.decrypt`), so edited XML must keep the client's integrity checks in mind.
- Money changes are reported through `UserDataFacadeOnline.updateMoney` -> `Server.sendCommand("update_money", ...)` (`UserDataFacadeOnline.as:1712`). The server stores the result and does not compute it.

## Open questions (next steps)

1. Layer order inside `Map` (cars, items, top layer) and sprite anchor handling in `ItemSprite`/`ItemObject`.
2. `influenceValue` and `getPopulation` details, `UpgradesManager.getExtraPercentage`.
3. Exact `update_money` / `update_item` payloads after place and collect, from `Server.as` and `UserDataFacadeOnline.as`.
4. Anchors and offsets inside item SWFs (L1).

## L0/L1 results (second pass)

- **Layers** (`Map.as:253-268`, bottom to top): `Background`, car layers, `mItemObjectsLayerBottom` (item L0), `mItemObjectsLayerTop` (item L1), `mItemObjectsLayerDialog`.
- **Draw order** (`Map.addIntoDisplay`, `Map.as:1768`; `ItemSprite.sortDisplayList`, `utils/animations/ItemSprite.as:66`): each item's L0 `depth` is the tile index (row-major, `row * cols + col`) of the point `(worldX + sizeX, worldY + sizeY - tileHeight)`, which is the bottom-right footprint tile's row. Children are sorted ascending by `depth`. L1 is not sorted.
- **Sprite origin:** `ItemObject.setWorldPosition` (`ItemObject.as:2720`) places both layers at `(worldX, worldY)`, the footprint's top-left. State clips (`normal`, `building`, ...) are then added at `y = baseHeight` (`ItemObject.as:2261`, `2307`, `2334`), so a state clip's own origin lands on the footprint's **bottom-left** corner. Artwork extends up and to the right (shadow) from that point.
  - Check: `commerce_bank.swf` (3x3 tiles, footprint 96x96) has a 143x116 state sprite whose shape bounds are x 0..143, y -116..0 (twips / 20).
- **Item SWF structure** (`Assets/items/<sku>.swf`, e.g. `commerce_bank.swf`): exported symbol classes `normal`, `normal_new`, `icon_02`, `icon_02_new`, `BarPosition`, `BarPosition_new` (`ItemDefinition.getDisplayObject`, `ItemDefinition.as:330`: prefers `<name>_new`, falls back to `<name>`). `normal` has 4 frames. Each frame is a stack of shapes and bitmaps.
- **FFDec exports** frames as cropped PNGs (`-export sprite,shape,image`): bank `normal_new` -> 4 PNGs, 143x116. The crop discards the symbol-origin offset, so offsets must be computed from shape bounds or placement matrices in `-swf2xml` output and stored in a JSON sidecar.
- **Money payloads:** `update_item` carries `action`, `sid`, `sku`, `security` (snapshot), `millis` (`UserDataFacadeOnline.as:120-153`). `update_money` and `update_map` also carry `security`. `update_plots` carries plot XML.

## Next

1. Write `tools/export-item-sprites` (Node + ffdec CLI): for each `Assets/items/*.swf`, export each state clip's frames as PNG plus `{sku, state, frame, offsetX, offsetY, w, h}` JSON, using the bottom-left origin rule above.
2. Verify the rule on 3 buildings by overlaying the PNGs on the footprint using a saved city, and compare to a Flash screenshot.
3. Read the `building` / `on construction` states and the `normal` frame selection (what do the 4 frames mean?).
4. Trace the `update_item` actions the server actually receives for place, collect and contract (compare with `commandHandlers`).

## L1 result: sprite exporter

`tools/export_item_sprites.py <ffdec.jar> <swf> <out_dir>` writes per-symbol PNG frames plus `sprites.json` (`class`, `offsetX/offsetY` in px from the symbol origin, `width/height`, frame list). It ran on all 279 item SWFs in about 5 minutes with no errors. Computed width/height equal the FFDec PNG size (±1 px) for 771 of 803 symbols (96%). The 32 mismatches are mostly `Effect_*` symbols and a few decorations (glow/filter/mask bounds); the `normal` state clips of buildings match. Placement of the PNGs on the footprint still needs verification against a Flash screenshot (next: render a saved city).

## Render spike result

`tools/render_city_spike.py <save.json> <items_export_dir> <rules_dir> <out.png>` draws company 1 of a save bundle from the exported sprites. Run on the server's fresh starter save (`createFreshSaveBundle()`): 61/61 items drawn, none missing.

Rules used and checked visually (trees, fountain placed on a road-bounded plaza, shadows falling right; not yet compared against a Flash screenshot):
- map is `miniExpansionsSide x areaTileCols` = 6x15 = 90 columns and 6x10 = 60 rows (`mapDefinition.xml`, `MapDefinition.as:94-118`), top extra rows = 0 (`Map.as:3336`);
- save coordinates are relative: `tile = rel + cols/2` (x) and `rel + rows/2` (y) (`Map.getTileRelativeXToTile`, `Map.as:810`; `getTileRelativeYToTile`, `Map.as:2405`);
- world position = tile * 32; the sprite goes at `(tx*32 + offsetX, (ty+rows)*32 + offsetY)`;
- footprints come from `itemDefinitions.xml`, `commerceDefinitions.xml` and `decorationDefinitions.xml` (`baseCols`, `baseRows`).

Not yet covered: which frame of `normal` to show for each building state (construction, rented, abandoned), `building`-state clips, terrain/road tile art (spike uses flat colours), Terrain `chunk` format variants, items in other companies, `Effect_*` overlays.

## Building states and frames (`ItemObject.as:2240-2345`)

- **Normal state:** the item SWF's `normal` clip (`normal_new` preferred). It is an animation. It plays only if the item definition has `isAnimated="1"` (71 of 93 definitions) and the stage quality is not LOW; otherwise it is stopped on frame 1. Frame labels inside (for example `house_01_income_01` in `commerce_bank.swf`) are not yet mapped to states.
- **Construction state:** the item SWF's `building` clip if it exists; otherwise a generic `T<rows>x<cols>` bitmap from `BuildingState.swf` (`ModelConfig.BUILDING_STATE_SWF`), placed at `y = baseHeight - bitmap.height` (clubs use `normal` plus a crew icon). Decorations have no bar position and no building state.
- **Anchoring:** all state clips are added at `y = baseHeight` (`ItemObject.as:2307`, loop at `~2316`), as already noted.
- `BarPosition` is a marker clip: its first child's x/y plus `baseHeight` give the progress-bar/icon anchor (`ItemObject.as:2252-2254`).
