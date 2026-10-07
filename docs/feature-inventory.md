# Feature inventory (equivalence checklist)

Source: decompiled `Dollars.swf` (paths relative to `decompiled/scripts/com/dchoc/dollars/`, shortened to `D/`). Rules/GUI data: `assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/` (shortened to `DATA/`). Read `docs/client-logic-spec.md` first for map/rendering facts.

Confidence: items marked **(read)** were read in source for this inventory. Items marked **(survey)** were located from class/function lists and XML only; their exact rules must still be read before implementation.

Priority: P0 = needed for the first-session loop, P1 = needed for a normal play session, P2 = depth/long tail, P3 = stub or omit offline.
Size: S under 1 day, M 1-3 days, L over 3 days.

## 0. Server command coverage

Client commands (all `sendCommand` literals in `D/`, via `UserDataFacadeOnline.as`): startup reads `get_world`, `get_customizer_info`, `get_friends_list`, `get_neighbor_list`, `get_neighbor_info`, `get_help_building_list`, `get_upgrades_list`, `get_unlocked_items_list`, `get_limited_edition_items_list`, `get_storage_list`, `get_collectibles_list`, `get_friends_collectible_sents_list`, `get_daily_rewards_info`, `get_partners_list`, `get_welcome_progress`, `get_investments_list`, `get_game_config`, `load_success` (`UserDataFacadeOnline.as:1643-1707`). Writes: `update_item` (`:153`), `update_plots` (`:188`), `update_map` (`:829`), `update_profile` (`:384`), `update_money` (`:1719`), `update_next_rent` (`:778`), `update_daily_reward` (`:251`), `update_missions` (`:1247`), `update_pollmanager` (`:1615`), `update_collectible` (`:103`), `ask_collectible` (`:99`), `add_upgrade_item` (`:500`), `postReward` (`:608`), `ping` (in `server/Server.as`).

Server coverage (`packages/shared/src/constants.ts`, `apps/server/src/commandHandlers.ts`):

| Group | Status |
|---|---|
| All 18 `STARTUP_COMMANDS` | Supported (`commandHandlers.ts:141-196`). |
| `update_item/map/plots/profile/money/next_rent/daily_reward/missions/pollmanager` | Supported (`MUTATION_COMMANDS`, `:209-230`). |
| `add_upgrade_item` | Supported (`commandHandlers/upgrades.ts`), but also listed in `NOOP_COMMANDS`. Dispatch order means the upgrade handler wins (`commandHandlers.ts:104`). |
| `update_collectible` actions KEEP/BUY/SELL/GET_REWARD/SEND, `ask_collectible` | Supported (`commandHandlers/collectibles.ts`, `:301-313`). |
| `update_profile` sub-actions | Handled: `city_name(_codes)`, `boss_genre`, `gameConfig`, `tutorial_completed`, `firstMission`, `first_invest`, `firstPartner`, `firstVisit`, `newToolRev`, `checkmail`, `ranking`, `planeSku`, `fourMillions`, `million_news_feed` (`:430-488`). |
| `ask_for_help`, `ask_for_cash`, `postReward`, `invest_*` | Accepted as no-ops (`NOOP_COMMANDS`). Gameplay effect (accelerated build, cash gift, investment payout) is not simulated. |
| `ping`, `update_collectible` unknown actions, any other `_cmd` | Fall through to `{success:"true", ignored:"1"}` (`:116-128`). |
| Facebook/JS tasks (`requestTask` tags: `taskAskForHelp`, `postToFeed`, `cashShop`, `taskInvest`, `becameFan`, `isFan`, `facebookCredits*`, `neighborRequest`, `partnerRequest`, `investmentRequest`, `openUrl`, `taskSendCollectible`, `askForCash`, `videoAd`, `crewRequest`, `publishScore`, `sendLevel`; `UserDataFacade.as:40-96`) | Not server commands. They go through `ExternalInterface.call("flashRequest_Received", ...)` (`server/Server.as:285`) or `flashRequest`/`notifyWCRM_fromFlash`. The shell page (`facebookShim.ts`, `launcherHtml.ts`) must answer or ignore them. See section 9. |

Gaps to flag: no server simulation of help/neighbor visits (`get_neighbor_info` returns static data), investments, upgrades by visitors beyond `add_upgrade_item`, daily reward roll, wonders help. The rewrite must decide per feature whether the TS client or server owns the logic (section 12).

## 1. First-session walkthrough (tutorial) **(read)**

> **Implementation status (core-loop controller, `apps/client/src/game/game.ts`):** the tutorial itself (splash, boss select, forced steps a-end below) is **deferred, not implemented**. `Game.boot` handles the server side: the server serves a tutorial-stage world until `update_profile tutorial_completed` has been persisted, and `repository.ts` *resets the whole save* if houses/HQ exist while `tutorialEnd != "1"`. So when `Profile@tutorialEnd != "1"` boot sends `tutorialCompleted()` first (server then normalises to the completed-tutorial starter: HQ, house, tree, roads, terrain) and re-fetches `get_world`; `game.tutorialSkipped` reports it. Consequences: no boss selection (`boss_genre` never set), construction timers run from the first session (original froze them until `smTutorialEnd`), contracts use the post-tutorial `signContract` payload (`tutorialEnd: true`), music should use the main track.

Trigger: `UserDataFacade.isTutorialRequired()` is true when the universe XML `Profile@tutorialEnd == "0"` (default true if the attribute is absent) (`model/userdata/UserDataFacade.as:906-919`). `DollarsGame.ronaldsCityStateIsRequired()` = required AND `!Tutorial.smTutorialEnd` (`flow/DollarsGame.as:1009`). `Profile.setPersistence` sets `Tutorial.smTutorialEnd = (@tutorialEnd == 1)` (`model/profile/Profile.as:1109`; missing attribute forces true, `:1114-1116`).

Boot and load (applies to every session, `flow/DollarsGame.as`):

1. `STATE_PROGRAM_RESOURCES_TO_LOAD` (`:1526`): `UserDataFacade.load()`, `RulesFacade.load()`, loading screen enters.
2. `STATE_LOAD_RESOURCES` (`:1532`): `XMLTuner`, sounds, resource manager (`loadingInitResourceManager`, `:2353`; includes `BuildingState.swf`, `:2380`). On leaving this state `UnlockedListManager`, `LimEdManager`, `CollectibleManager` (+ pending), `Profile`, `OfferManager`, `StorageManager`, `MissionDefinitionManager`, `FreeGiftDefinitionManager` sequence, `DailyBonusManager` and the CRM customizer are built (`:1471-1521`).
3. `STATE_REQUEST_WORLD` (`:1548`): requests `universe` and `upgradesList`.
4. `STATE_BUILD_WORLD` (`:1556`, step machine `:1733-1880`): step 0 reads the universe, builds Profile, World, FriendsBar, OptionsPanel, 3 roles (owner/editor/visitor), all popups (confirm, instant build, message, rent collector, contract signator, service presentation, contract boxes, `BuyBox`), plane; if tutorial required queues `splash.swf` (`RonaldsCity.SKU`). Step 1 selects role, rebuilds profile and reloads missions. Then smart resource loading for the items in the save, `visitWorld` steps, `load_success` sync (`UserDataFacade.TASK_LOAD_SUCCESS`, report-hacking steps), then `loadGameConfig`, `OptionsPanel.load`, `sortItemsToBuild` and `changeState(STATE_RUN_WORLD)` (`:1876`).
5. `STATE_RUN_WORLD` entry (`:1564-1660`): friends init, tools bar enabled, select tool set, `securityInit`. If the tutorial is required, `StateMachine` switches to `RonaldsCity` (`:1584-1594`). Else if `smTutorialEnd && !smWelcomeDone && owner` starts `WelcomeProgress` (`:1596-1601`, see section 8). Visitors register `visitFriend/visitRonald/visitPartner/visitCity` poll events (`:1612-1628`). Plane flies with the city name (`:1633-1637`). The tutorial path unloads the newspaper assets for level above 7 (`:1650`).

Tutorial sequence. `Tutorial.smTutorialStep` starts at 0 and is incremented at the start of each `onStepN` (`model/Tutorial.as`). Step constants: `BUILD_HOUSE=3, BUILD_ROAD=4, INSTANT_BUILD=5, SIGN_CONTRACT=6, BUILD_DECORATION=7, COLLECT_RENT=8, COUNT=9` (`:83-99`). Popup texts (EN) come from `DATA/Locale/EN.txt` lines 775-795 (TID 774-794 in `TextIDs.as:1554-1594`). The "OK/Next" button of `PopupTutorial` is disabled (`mPopupTutorial.disable()`) until the forced action completes, then `Tutorial.activeOkButton()` (`:582-589`) enables it, resets the tool to select, plays the button animation and disables the map.

| # | Where | What the player sees | Forced action and completion hook |
|---|---|---|---|
| a | `RonaldsCity` (`flow/RonaldsCity.as`) | Full-screen `Splash` clip from `splash.swf` plays to its last frame (`checkAnimEnd` `:42-52`). `PopupSelectBoss` opens (advisor choice Ronald or Cindy; stores `boss_genre`). | Closing the popup (`closeSelectBoss` `:88-100`) leaves the state; `exit()` calls `DollarsGame.startTutorial()` (`:112-114`). |
| b | `DollarsGame.startTutorial` (`:876-884`) | Toolbar buttons all disabled, map disabled, friends bar disabled, boss button shown but disabled. | 3 s timer (`:878`) then `launchTutorial` (`:980`) creates `PopupTutorial` and calls `welcomeTutorial()`. |
| 0 | `Tutorial.welcomeTutorial` (`:614-628`) | Popup "Your Company": "Hello my name is Ronald Goldtooth..." (name from `TID_RONALD_NAME`, Cindy if `bossGenre==female`). Map disabled. Rival company item 0 (the NPC "Ronald" building) gets `setBehaviorTutorial(0)`. | OK -> `onStep1` (`:606`). |
| 1 | `showStep2` (`:630`), `loadLocations` (`:312`) | Popup "Place Headquarters". Loads `DATA/rules/TutorialHQPositions.xml` (copy in `assets/recreations/TutorialHQPositions.xml`: HQ anchor tile (-1,-3), plots (5,2),(5,3), roads (3,4),(4,4), decoration (4,1); all relative tiles, converted with `getTileRelativeXToTile`). `setHQTerrains` (`:182-240`) draws a tutorial arrow above each HQ terrain tile, sets the build tool to `HeadQuarter`, shows the build grid and enables the map. | Player places HQ on the arrowed tiles. `ToolBuild` (`map/tools/ToolBuild.as:246-251`): when step==1 and item is HQ -> `activeOkButton`, `removeHQTerrains` (clears marked terrain `removeTerrain(idx,4,2)`, arrows and grid) and `Map.launchHQSkinAnimation` (`Map.as:394`). |
| 2 | `onStep2` (`:496`) -> `showStep3` (`:668`) | Popup "Buy Plots": buy the 2 missing plots. Buy-terrain toolbar button enabled and a toolbar arrow added at `getTerrainButtonPoint()` (`:161-172`). `addTerrains` (`:281`) draws 2 green tiles plus an arrow at `smAddTerrainTiles` (5,2),(5,3). | Each `EVENT_SET_TERRAIN` dispatched by `Map.buyTerrain` runs `clearTerrain` (`:319`). After 2: `activeOkButton`, buy-terrain button disabled again (`:337-341`). |
| 3 | `onStep3` (`:531`) | Popup "Build a House": "buy a Bungalow, place it on the 2x2 plot". Build (shop) button enabled with arrow at `getShopButtonPoint()`; map disabled until the shop is used. | `ToolBuild` step==3 (`:252-255`): `removeToolbarArrow`, `activeOkButton`. |
| 4 | `onStep4` (`:504`) | Popup "Build a Road": connect the construction site to the HQ with 2 road pieces. Road button enabled and arrowed, `World.registerRoad` (`World.as:397`). `addRoads` (`:395`) draws 2 green road tiles at (3,4),(4,4). | `clearRoad` (`:128`) per placed road tile; after 2: `activeOkButton`, road button disabled (`:146-150`). `Company.as:751` gates construction start: `smTutorialEnd || smTutorialStep >= BUILD_ROAD`. |
| 5 | `onStep5` (`:554`) | Popup "Instant Build": "construction has started... click the Bungalow and accept Instant Build". Last built item (`CompanyMine.getLastItem`) gets `setBehaviorTutorial(5)`; a bouncing arrow is attached to the house sprite (`incomeHouseArrow` `:544`). `StateOnConstruction.setBehaviorTutorial` subtracts 100 from the timer (`states/StateOnConstruction.as:123-129`). | Player clicks the house, instant-build popup (tutorial: free, no gold), `NotificationConstructionEnd` (`notifications/NotificationConstructionEnd.as:33-35`) calls `activeOkButton` when step==5. `StateOnConstructionOwner` removes the arrow when time reaches 0 (`:73`, `:195`). Construction timers do not count down during the tutorial (`StateOnConstruction.as:254`, `StateOnConstructionOwner.as:56` require `smTutorialEnd`). |
| 6 | `onStep6` (`:569`) | Popup "Sign a Contract": click the Bungalow, sign a rental contract (cost $90 shown). House set to `MODE_WAITING_FOR_CONTRACT` (`StateOnRent.as:1046-1049`). | Contract signed in `StateOnRent` (`:431-446`): arrow removed, `activeOkButton`. Only houses react to mouse-over in this phase (`StateOnRent.as:1065-1067`). |
| 7 | `onStep7` (`:519`) | Popup "Buy a Decoration": open Shop, Decoration tab, buy a Cypress Tree, place it next to the Bungalow; "+2% income bonus". Shop button re-enabled and arrowed. `addArrowToDecorations` puts an arrow on the decoration tab (`:438-446`). `addDecoration` (`:375`) marks tile (4,1). | `ToolBuild` rejects placement anywhere except `smAddDecorationTile` (`ToolBuild.as:85-91`); on success it dispatches `EVENT_SET_TERRAIN` (`:257-262`) and `clearDecoration` (`:591`) activates OK. |
| 8 | `onStep8` (`:655`) | Popup "Collect the Rent" (button text becomes "Done"). House `setBehaviorTutorial(8)` -> `enableContract` + `MODE_GET_RENT` (`StateOnRent.as:1050-1054`), arrow on house. | Click collects rent; `StateOnRent.as:1473-1476` calls `activeOkButton`. |
| 9 | `onStep10` (`:448`) | Final popup (title "Level" text, body `TID_TUTORIAL_END`: next tasks, missions button). Note rain: `mRain`/`mRain2` start (`:453-458`). | OK -> `onStep11`. |
| end | `onStep11` (`:461-494`) | Invite-neighbors popup (`PopupInviteNeighbors`), toolbar and Hud buttons enabled, map enabled, friends bar enabled, Ronald's City assets unloaded, music switches from `tutorial2.mp3` to `main.mp3` (`ModelConfig.SOUND_TUTORIAL/SOUND_MAIN`), ranking position computed. | Sets `smTutorialEnd = true`, calls `Profile.tutorialCompleted()` -> `update_profile` action `tutorial_completed` (`Profile.as:709-715`). |

Missions start only after the tutorial: `onStep12` (`:352-373`, referenced by Hud/mission logic) sets `firstMission`, `firstMissionToDo()`, adds a mission arrow and blink on the boss button. `MissionsIconLayerManager.update` only runs when `smTutorialEnd` (`DollarsGame.as:1941`). Idle CRM help popups and investments are also gated on `smTutorialEnd` (`:1962`, `invests/InvestManager.as:247`).

Tutorial side effects elsewhere that must be reproduced: `StateOnIA` (NPC for-sale buildings) forced entry, `isBeingUsedInTutorial` (`StateOnIA.as:168,335,429`), `TileData.as:187` (shadow items only after tutorial), `ToolDecoratorScroll.as:102,126,207`, `PollManager.as:115` (events only after tutorial), `NotificationSellingEnd.as:85` (activate OK on sell), `Profile.as:1190,1229,1269`.

Implementation: P0, L (needs HUD, shop, tools, map input gating, arrows). Data: `TutorialHQPositions.xml`, `splash.swf` (`DATA/` splash), `AssetManager.TutorialArrow` clip (inside `Dollars.swf` assets), `PopupTutorial` (`GUI/PopupTutorial.as`, 265 lines), EN.txt lines 775-795.

## 2. Core loop

### 2.1 World load, save and sync (P0, L)
Build/runtime flow above. Classes: `flow/DollarsGame.as`, `world/Universe.as`, `world/World.as`, `model/userdata/UserDataFacade*.as`, `server/Server.as`, `server/ServerJava.as`, `model/userdata/Social*.as`. Commands: all startup reads, `update_*`. Security snapshot (`security`/`sig`) on money/item writes (`UserDataFacadeOnline.as:120-153`, spec). Data: `rules/universe/map.xml`, `rules/mapDefinition.xml`. Depends on server only. Out-of-sync popup `GUI/PopupOutOfSync.as`, connection-lost `PopupConnection.as` (P2).

### 2.2 Map, camera, tiles (P0, L)
Top-down 32 px tiles, map 90x60 tiles, 5x5 mini-expansion grid per `mapDefinition.xml`; layers, depth sort in spec. Classes: `map/Map.as` (3382 lines), `map/TileData.as`, `map/Background.as`, `map/Layers/TopLayer.as`, `map/logicTiles/*`. Camera: drag-scroll, wheel zoom (`DollarsGame.onScrollMouse` `:1303`), `calculateScrollBottomY`, `cameraStart`. Data: `Assets/terrain/*`, item SWFs. Depends on sprite export tooling (`tools/export_item_sprites.py`). Open: terrain tile art and road autotile frames **(survey)**.

### 2.3 Build / place items (P0, M)
`map/tools/ToolBuild.as` (310 lines) + `Tool.as` (1056): item attached to cursor, red/green footprint, `Map.isBuildable` (spec), cost deduction, `registerEvent(MISSION_EVENT_BUILD_ITEM)` (`ToolBuild.as:240`), storage-sourced placement (`mFromStorage`, `StorageManager.removeItem`), gift placement event, bundle side-effect (`offerDef.offerType == bundle` adds to storage, `:288`), build sound. Commands: `update_item` (add), `update_money`, `update_map`. Data: `itemDefinitions.xml` (144 defs), `commerceDefinitions.xml` (82), `decorationDefinitions.xml` (190), `wonderDefinitions.xml` (23), `clubDefinitions.xml` (1). Depends on: HUD, shop (3.2), construction (2.4).

### 2.4 Construction, instant build, build help (P0, M)
States: `StateOnConstruction/Owner/Visitor` (modes INIT, RESUME, PAUSED, INSTANT_BUILD), progress bar + countdown, `Notification` on completion (`NotificationConstructionEnd`). Instant build: `PopupTradeBox(TYPE_INSTANT_BUILD)`, `PopupInstantBuild` (with friend carousel, FBC path), `PopupInstantBuildSecondStep` (`StateOnConstructionOwner.as:153-225`: cash vs FBC); price from `XPTable.timePrice`/`ItemDefinition`. Build-help by friends: `ask_for_help` (no-op server), `helpConstructionMinTime=15` (`settings.xml`), `FriendsManager.getBuildingHelp`, `PROGRESS_EVENT_CONSTRUCTION_FINISHED_WITH_HELP` (`StateOnConstruction.as:137-142`) -> welcome popup `PopupPartner(TYPE_SHARE_FINISHED)`. Permit limit: `Company.mMaxPermits/mPermits` (`Company.as:76,126`) **(survey)**. P0 for timer+instant build (gold only); help is P3 (stub).

### 2.5 Rent, contracts, income collection (P0, L)
`StateOnRent.as` (2068 lines): modes WAITING_FOR_CONTRACT, SIGNING_CONTRACT, CANCELING_CONTRACT, RENTING, GET_RENT, GIVING_RENT, ABANDONED, RESETING_ABANDONED, WAITING_FOR_TURN_TO_SIGN_CONTRACT, POSTPONING_SET_MODE, COLLECTIBLE, GIVING_COLLECTIBLE (`:66-90`). Contract choice UIs: `containers/ContractBox*.as`, `ContractItem.as`, `PopupMultiContract.as` + `map/tools/ToolContractSignator.as` (area sign, `contractSignatorAreaX/Y=11`), `PopupRentMoneyCollector.as` + `ToolMoneyCollector.as` (area collect, 11x11), `ToolRentAccelerator.as` (+ `world/accelerators`, skus 30s/1m/1h/1d). Income formula in spec. Abandonment: `abandonTimePercentage=100`, `abandonMinTime=60`, `cancelContractProfitPercentage=50`; `update_next_rent`. Commerce income depends on affected houses' population and commerce type (`commerceTypeDefinitions.xml`). Also collectible drops while collecting (`collectRewardInCommerceChances=1`, MODE_COLLECTIBLE). Data: `contracts.xml` (346), `contractsTypes.xml`, `contractsNames.xml`, `settings.xml`. Depends on 2.3, 2.4, XP (2.7), money (2.8). Server: all via `update_item`/`update_next_rent` (supported).

### 2.6 Move, sell, demolish, roads, terrain, expansions (P0/P1, L)
- Move: `ToolMove.as` (291), `PopupConfirmMove`, `PopupPayMove` (move service `servicesDefinitions.xml sku=move`, 24 h, gold price), `Item.isMoveable`, mission event `moveHouse`. `update_item`/`update_map` (P1, M).
- Sell/demolish: `ToolDestroy.as` (reads: item -> `ItemObject.demolish`; empty tile -> road destroy `Map.roadTileDestroy :751` or terrain destroy `Map.destroyTile :2862`), `StateOnDemolition`, `StateOnSelling`, `PopupConfirmDestroy`, sell price `ItemObject.getSellPrice :699`, `sellPricePercentage=20`, `destroyItemProfitPercentage=35`, `destroyTerrainProfitPercentage=100`, `Map.destroyTileApplyEconomy :1688` (P1, M).
- Roads: `ToolRoad.as`, `Map` road tiles, `World.registerRoad`, `isRoad` in `TileData`; mission event `buildRoads`; pathing agents use A* (`utils/astar`) (P0, M).
- Terrain/plots: `ToolTerrain.as`, `Map.buyTerrain :3206`, price `XPTable.terrainPrice` via `RulesFacade.getLevelTerrainPrice`, `Profile.getTerrainPrice :1898`; saved via `update_plots` (P0, M).
- Expansions (areas): `Map.buyExpansion :1754`, `PopupConfirmExpansion`, `Profile.isExpansionAreaMine/ForSale/Type`, `expansionsGetDCCoins/FBCredits`, data `expansions.xml`, `expansionsPrices.xml`, `Assets/GUI/expansions.swf`, mission `buyExpansion`, requires successful investments (`InversorsSuccessful`). `update_map` (P1, M).
- Logic tiles and editor role (`RoleEditor`, `ToolSetTile`, `ToolSetLogicTile`): P3, skip (`Config.EDIT_MODE`).

### 2.7 XP, level, company value (P0, M)
`Profile.levelUp :1485` (cash reward `RulesFacade.getLevelDCCashLevelUp`, level flags for collectibles at level 6 and investments at level 1, `maxExp`, loads next-level resources), `PopupLevel.as` (new unlocked items carousel, feed share button), `Profile.checkLevelUpShow :936`, `calculateCompanyValue :1750`, `getCompanyValuePerExpansions`. Data: `XPTable.xml` (351 levels: xpneed, exchangeGold/FBC, timePrice, terrainPrice, level-up cash), `unlockSegments*.xml` (early-unlock price per level segment). Commands: `update_profile`, `update_money`. P0 except share (P3).

### 2.8 Money (coins, gold/cash, FBC) (P0, M)
Profile `DCCoins`, `DCCash`, `DCCashPaid`, `facebookCredits`, `facebookCreditsNotSpent` (`Profile.as`), `initialDCCoins=380000`, `cashToCoins=60000`, `FBCToCoins=30000`; `PopupExchange.as` (`GUI/exchangeForCash`) converts gold to coins, `PopupGold`, `PopupTradeBox` generic "not enough money, exchange?" flow, `ItemPopupGold`. Payment: `utils/metrics/PaymentManager.as`, `rules/fbcredits.xml` packs, `PopupPaymentFail`. Offline: gold purchase and Facebook credits stubbed (P3). Money mutates only through `update_money`.

## 3. HUD and menus

### 3.1 HUD (P0, M)
`GUI/hud/HudOwner.as` (1002 lines) / `Hud.as` / `Plot.as`: coin counter with tween (`textEffectCoins`), gold counter and add buttons (`onAddCash`, `onAddCoins` -> `PopupExchange`, `onAddFC`), XP bar and level (`setExp`, `setLevel`, tooltips `setTipExpBar`), company value, city name text, boss/advisor icon, friend photo, server-busy light, traffic-direction indicator, service-timer tips (`setTipService`), video-ad button. Data: `Assets/hud/hud.swf`. Hud buttons disabled during tutorial (`HudOwner.enableButtons :479`).

### 3.2 Tools bar (P0, M)
`GUI/ToolsBar.as` (1440): buttons in order SELECT 0, BUILD 1, DEMOLITION 2, ROAD 3, BUY_TERRAIN 4, VAULT 5 (collectibles), BOSS 6 (missions), HOME 7, INVEST 8, MULTI_FUNCTION 9, PARTNER 10, VIDEO 12 (`:83-107`); boss alert states (new mission/reached) with blink; arrows used by tutorial; `MultifunctionBar.as` (contract signator, rent collector, accelerator tools); `VaultBar.as` (collectibles). Tooltips `TID_HINT_MENU_BUTTON_*`. Unlock gating: `sideTabsUnlockLevel=5`, `investmentsUnlockLevel=1`, `collectibleUnlockLevel=6`.

### 3.3 Options panel and sound/quality (P1, S)
`GUI/hud/OptionsPanel.as`: options toggle, fullscreen, zoom in/out/reset, music on/off, sound on/off, quality toggle (LOW disables item animations, `ItemObject` spec), screenshot (`utils/screenshots/Screenshot.as`, P3). Sounds in `DATA/sounds/*.mp3`: `build, bulldoze, contract, levelup, main, money, tutorial2, tycoon`. Sound IDs in `model/ModelConfig.as`. Persist the toggles in the profile `flags` or localStorage (client's choice; original stored via `update_profile gameConfig`).

### 3.4 Friends bar (P1/P3, M)
`friends/FriendsBar.as`, `FriendsBarContent*.as`: bottom scroller of neighbor avatars (rank, level, company value), "Add neighbor" slot, click to visit. Data from `get_neighbor_list`/`get_friends_list`. Offline: show NPC neighbors only (`rules/NPCDefinitions.xml`: Ronald, Cindy, Sheik).

### 3.5 Info boxes and item hover (P1, M)
`GUI/infoBox/*` (`InfoBoxHouse/Commerce/CommerceRival/Construction/Contract/Decoration/Wonder/Abandoned`, `ShopMenuInfo*`), `TipBox.as`, `GUI/DynamicButton.as`, floating text (`utils/particles/TextAnimation`, `PointsAnimation`) for +coins/+xp.

## 4. Shop / buy box

### 4.1 BuyBox shop (P0, L)
`containers/BuyBox.as`, `ItemContainer.as`, `ItemContent.as` and variants: `ItemContentUnlocked`, `Locked` (level), `LockedByCash` (early unlock, `unlockMaxPrice=65`), `LockedFan` (like-us unlock, `unlockCondition="fan"` on one item), `LimEdLocked`, `LockCrossPromotion`, `UnlockedBundle`, `UnlockedOffer` (discount); `FeaturedItemsBox.as`/`FeaturedItemContent.as`; tabs from `rules/gui/shopTabDefinitions.xml` via `GUI/shop/ShopTabDefinitionManager.as` (Houses, Commerce, Decorations, Wonders, Clubs, Limited edition, Services/Storage). Search (`DollarsGame.mShopSearch`), "new item" badge (`shopNewItemsTimer`, `newItemsRev`). Opening: `DollarsGame.showBuyBox :1091` / `onShowBuyBox :992` (map input disabled while open, tool reset to select). Data: item/commerce/decoration/wonder/club definitions, `popups/shop/*`, `Assets/items/*.swf` (285 files), `Assets/GUI/houses_info.swf`. Unlock rules: `UnlockedListManager` (`get_unlocked_items_list`), `unlockSegmentsCash.xml`, `unlockSegmentsVisibility.xml`.

### 4.2 Storage / inventory (P1, M)
`storage/StorageManager.as`, `GUI/storage/PopupStorage.as`, `PopupBoxOpen.as`, `StorageItemContent.as`; `get_storage_list`; items from gifts/bundles/briefcases can be placed from storage (`ToolBuild.mFromStorage`). Commands: `get_storage_list` (supported), writes ride on `update_item`/`update_map` (verify).

### 4.3 Offers and bundles (P2, M)
`offers/OfferManager.as`, `OfferDefinition*.as`, `OfferItemDefinition*.as`; `rules/offerDefinitions.xml` (discount 30/40/50 percent, bundle type); `GUI/bundles/PopupConfirmBundle.as`; free items (`addFreeItem/removeFreeItem`). Time-limited CRM offers (`CustomizerManager.getOfferTimeLeft`) are P3.

### 4.4 Limited editions (P2, S)
`model/limEd/LimEdManager.as`, `ItemContentLimEdLocked`, `get_limited_edition_items_list`, `limEdSoldOutShowTime=48`. Needs server data for sold-out state; offline: show all, never sold out.

## 5. Popups catalogue (P1 unless noted)

All derive from `GUI/Popup.as` (open/close/accept events, modal blocking `DollarsGame.mShowPopup`) and use GUI SWFs from `DATA/popups/*` (`popup_standard.swf`, `buttons.swf`, `common`, `confirm`, `confirm_buy`, `crew_mechanics`, `exchange`, `instant_build`, `shop`) or `Assets/GUI/*`.

| Popup | Purpose |
|---|---|
| `PopupMessage`, `PopupMessageSmall`, `PopupConfirm`, `PopupConfirmDestroy`, `PopupConfirmMove`, `PopupConfirmExpansion`, `PopupValue`, `PopupExtended` | Generic message, confirm, quantity. P0 |
| `PopupTutorial`, `PopupSelectBoss` | Tutorial (section 1). P0 |
| `PopupLevel` | Level-up with unlock carousel and share. P0 |
| `PopupMission`, `PopupName`, `PopupMissionEditText`, `PopupEmail`, `PopupMissionUpgrades` | Mission text, name-city and give-email missions (`MissionObjectManager.as:454`). P1 (email P3) |
| `PopupTradeBox`, `PopupInstantBuild`, `PopupInstantBuildSecondStep`, `PopupGold`, `PopupExchange` | Pay-with-gold flows. P0 |
| `PopupRentMoneyCollector`, `PopupMultiContract`, `ContractBoxSingle/Multiple` | Contract/rent tools. P0/P1 |
| `PopupServicePresentation`, `PopupServiceExpired`, `ItemService` | Time-limited services (move, rent boost, etc., `servicesDefinitions.xml`). P2 |
| `PopupDailyReward`, `PopupDailyRewardSpecial`, `PopupDailyIncome` | Section 8. P1 |
| `PopupNewItem`, `PopupUnlockItem`, `PopupReward` | New/unlocked item notices. P1 |
| `PopupProgerss` | Welcome "while you were away" summary (ranking, help received, buildings completed, investments). P2 |
| `PopupInvest*`, `PopupHelpInvest`, `InvestFriendContent` | Investments. P2/P3 |
| `PopupHelp`, `PopupHelpFriend`, `PopupCrm`, `PopupHelpCollectibles` | Idle-help/CRM. P3 |
| `PopupBecameFan`, `PopupPartner`, `PopupInviteNeighbors`, `PopupVisit` | Social. P3 (stub) |
| `PopupJournal`, `NewsPaper`, `NewsFeedRewardPresentation` | Magazine/news. P2/P3 |
| `PopupConnection`, `PopupOutOfSync`, `PopupConfirmMma`, `PopupPayMove`, `PopupHireCrew` | Misc. P2 |
| Collectible popups (`GUI/Collectibles/*`, 17 classes) | Section 6. |

## 6. Missions and onboarding after tutorial

### 6.1 Missions (P0/P1, L)
`missions/MissionObjectManager.as`, `MissionObject.as`, `MissionDefinition*.as`, `MissionsEventIDs.as`, `unlock/*` (by level or sku), `iconLayer/*` (world icons over mission targets), `containers/MissionsBox.as`, `MissionItem.as`, `GUI/PopupMission.as`. Data: `rules/missionDefinitions.xml` (318 missions; types: build 78, collect 49, upgrade 39, checkInfluence 39, earn 28, collectUpgraded 26, bonus 18, visitPartner 8, investment/investmentDone 6 each, buyExpansion 6, plus nameCity, moveHouse, instantBuild, giveEmail, buy, beat, askForHelp, visitCity), `Assets/GUI/Missions.swf`, `Assets/missions/*` (per-mission item art), `missions_layout.swf`, mission icons (`Assets/missions/icons/*.png`). Event IDs (`MissionsEventIDs.as`): build, buildRoads, sell, buy, buyExpansion, collect, checkInfluence, bonus, instantBuild, informative, askForHelp, earn, upgrade, renovate, repair, visitRonald/Friend/City/Partner, beat, investment, investmentDone, collectUpgraded, checkToolbar, giveEmail, nameCity, moveHouse. Reward types coins/exp/item; `rewardTypeABtest*` variants (use the base). Commands: `update_missions` (supported), `update_pollmanager` for event counters (`utils/poll/PollManager.as`, events registered only after tutorial). `Profile.firstMission/missionAltRewardSet`. Depends on all event sources, `RewardManager` (`rewards/*`, `rewardTypesDefinitions.xml`: Exp, DCCoins).
Alt missions layout flags `altMissionsGet`, `missionsLayoutGet` (A/B test; use default).

### 6.2 WelcomeProgress (returning-session popup chain) (P1, M) **(read)**
`model/WelcomeProgress.as:447-833`, started at run-state entry if `smTutorialEnd && !smWelcomeDone` (`DollarsGame.as:1596`). Ordered steps: 1 DAILY_BONUS (`PopupDailyReward` or `Special` if `DailyBonusDefinition.getDate()!=0`), 2 FAKE_CREDITS info, 3 FAN (`PopupBecameFan`), 4 PROGRESS (`PopupProgerss`, if ranking/help/buildings completed), 5 LOGIN_SOURCE (news-feed reward or collectible-ask/thanks popup from a Facebook post), 6 BUILDING_FINISH (`PopupPartner TYPE_SHARE_FINISHED`), 7 NEW_ITEM (`PopupNewItem`), 8 INVESTMENT_STATUS, 9 INVESTMENT_REMIND, 10 SERVICE_EXPIRED, 11.. CRM events, then PENDING_COLLECTIBLES, CHECK_MAIL, END. First-ever session: `firstSessionProgress` sets `stopPopupFirstSessionPopups` and ends the chain right after the daily bonus step (`:264-275`). Offline minimal set: daily bonus, new item, pending collectibles.

## 7. Collectibles (P2, L)
`collectibles/*` (managers, definitions, groups, rewards, pending), `GUI/Collectibles/*` (found popup, collection book, celebrate, group-complete, buy/ask, send, pending list, confirm sell, new-collectible bar), `ToolsBar` VAULT button, `Assets/GUI/collectables.swf`. Data: `collectiblesDefinitions.xml`, `collectiblesGroupsDefinitions.xml` (reward per completed group: item, HQ skin, etc.), `collectiblesRewardDefinitions.xml`. Settings: `collectibleSlotExpire=8`, `collectibleMaxUnitsPerItem=99`, `collectibleUnlockLevel=6`. Flow: collect rent in commerce -> random collectible found (MODE_COLLECTIBLE in `StateOnRent`) -> keep/sell/send (KEEP/SELL/SEND actions) -> buy missing for coins/cash/FBC (BUY) -> complete group -> reward (GET_REWARD). Server: fully supported by `commandHandlers/collectibles.ts`. Friend sending/asking is P3 (stub; hide the Send/Ask buttons).

## 8. Daily reward, gifts, offers

- Daily bonus (P1, M): `dailyBonus/*`, `GUI/dailyReward/PopupDailyReward.as` (open boxes, `DailyBigReward`, `DailyReward`), `Assets/GUI/Dailybonus.swf`, `rules/dailyRewardsDefinitions.xml` (weighted `chances` per `group`; bonusType exp/coins/item), settings `dailyBonus=5000`, `dailyBonusMinTime=24` h. Commands: `get_daily_rewards_info`, `update_daily_reward` (supported). `WelcomeProgress.isDailyBonusAllowed/getDailyBonusTime`.
- Free gifts / briefcases (P2, M): `freeGift/*`, `rules/giftDefinitions.xml` (types move, rent accelerators, cash, items), `giftSequenceDefinition.xml`, `boxPrizeDefinition.xml` (briefcase, safe box, platinum safe, birthday box prizes), art `DATA/freegifts/*.png`. `Profile.briefcaseCount` (`@bfcCnt`), `FreeGiftDefinitionManager.openBox`. Gift items placed with `EVENT_PLACE_GIFT_ITEM` (`ToolBuild.as:276`). Commands: `postReward` (no-op), `update_item`.
- Offers/bundles: section 4.3. Cross promotion (`GUI/crosspromotion`, `crosspromotionDefinitions.xml`): P3, omit.
- News-feed rewards (`model/newsFeeds`, `newsFeedsDefinitions.xml`: levelUp, missionReward, etc., 7 day expiry): P3, stub (they exist to redeem Facebook posts).

## 9. Upgrades, visitors, neighbors (P2/P3)

- Visitor upgrades ("renovate/help"): `model/upgrades/UpgradesManager.as`, `StateOnBuiltVisitor`/`StateOnRentVisitor`, `social.xml` (visitor reward 10 xp and 100 coins per upgrade; owner extra 10 percent income; super upgrades 15/150/12; max 5 items, 1500 per day), `get_upgrades_list`, `add_upgrade_item`, `PopupMissionUpgrades`, `ParticleUpgrade`. Owner income bonus is part of the income formula (spec). Offline: implement owner-side display of upgrades already in the save; visiting is P3.
- Visiting a neighbor: `DollarsGame.visitUniverse :664/1382`, `RoleVisitor`, `Role` classes, `PopupVisit`, `visitGetRewardCoins :848`, missions visitFriend/visitRonald. Only NPC cities (Ronald/Cindy/Sheik, `NPCDefinitions.xml`) can be visited offline; needs `get_world` for other user ids (P2, M if an NPC world file exists).
- Neighbors/partners: `friends/FriendsManager.as`, `NeighborObject`, `FriendObject`; `get_neighbor_list/info`, `get_partners_list`, `PopupPartner`. P3 stub with static list.
- Help list (`get_help_building_list`), ask-for-help (`askForHelp_accelerateItem_percent=10`): P3.

## 10. Wonders, clubs, crew (P2)

- Wonders: `world/items/wonders/WonderTypeDefinition*.as`, `InfoBoxWonder`, `ShopMenuInfoWonder`, `rules/wonderDefinitions.xml` (23: types `npcIncome`, `incomeMultiplier`, `influence` per `wonderTypeDefinitions.xml`), `incomeMultiplier=2` in settings, `PopupInstantBuild` doubles as the wonder help popup (`DollarsGame.mPopupWonders`). `removeWondersEventlisteners` in `StateOnConstructionOwner :347`. Influence icons `world/items/gui/Influence*.as`. Commands: normal item commands.
- Influence (decorations/commerce affecting houses): `ItemObject.influenceValue` + `InfluenceIcon*` (section 2.5; mission `checkInfluence`); P1 because it affects income.
- Clubs and crew: `StateOnHireCrew/Owner/Visitor`, `crewMechanics/CrewMechanicsManager.as`, `GUI/hireCrew/PopupHireCrew.as`, `CrewItemContent`, `rules/clubDefinitions.xml` (1 club, "Country Club" 5x3), `crewMechanicsDefinition.xml` (price 2 gold or 5 FBC, job TIDs), `popups/crew_mechanics`. `TASK_CREW_REQUEST` is a Facebook task (stub). P2, M.
- HQ decorations: `rules/HQDecorations/skinDefinitions.xml`, `flagDefinitions.xml`, `world/items/decorations/SkinDecoration.as`, `FlagDecoration.as`, collectible rewards of type `hq`. P2, S.

## 11. Investments (P2/P3)
`invests/*`, `rules/investDefinitions.xml` (20 min, target 4,000,000), `Assets/GUI/investment.swf`, toolbar INVEST button (level 1), `PopupInvest*`, missions `investment/investmentDone`, expansion prices depend on successful investments. Social by nature (friends invest in you). Server only has `invest_*` no-ops and `get_investments_list`. Offline: P3 stub; expansion `InversorsSuccessful` gate needs a decision (grant automatically or use coin/gold price path of `expansionsPrices.xml`).

## 12. Social and Facebook: what to stub offline (P3)
- Stub: Facebook credits and gold purchase (`TASK_FACEBOOK_*`, `PaymentManager`, `PopupPaymentFail`), `becameFan/isFan` (return fan = true to unlock the fan item), `postToFeed/publishScore/sendLevel/bookmark/openUrl`, `taskAskForHelp`, `helpInviteFriend`, `neighborRequest/partnerRequest`, video ads, `Wcrm`/CRM scripts (`utils/metrics/*`, `DATA/wcrm`), crosspromotion, news feed rewards, metrics/GA/BA (`MyMetrics`, `GAMetrics`, `BAMetrics`: replace with no-ops), ABTestManager (use default arm).
- Keep as data-only: friends bar, neighbor ranking, NPC cities.
- Hooks: `ExternalInterface.call("flashRequest_Received"...)` (`server/Server.as:285,345,360,553`) and `MouseWheelEnabler.as` (page wheel handling).

## 13. Settings, sound, quality, misc
- `rules/settings.xml` and `social.xml`: all values quoted above (load as config, do not hard-code).
- Quality LOW: skip item animations (`ItemObject.as:2240-2345` spec), `OptionsPanel.onQualityClick`.
- Ambient life (P2, M): `utils/traffic/*` (`TrafficAgentManager`, A* over road tiles, `trafficAgents/*.xml`), `utils/particles/Plane.as` (plane with city-name banner, `Profile.planeSku`), `NoteRain` (money rain on level-up and tutorial end), `utils/particles/climate/*` (weather), `Flag`.
- Time handling: `DollarsGame.setTimeOffset`, `MAX_TIMER_MS` chunks, `smTimeOffset` (`:680`, `:1883-1900`): offline gaps are processed in chunks so construction/rent timers advance for elapsed real time. Required for P0 correctness (P0, S).
- Security/anti-cheat: `EncryptionUtils`, `UserDataFacade.securityInit`, `RulesFacade.sigGetTotal` (`load_success` carries `sig`). The server ignores them; the rewrite may omit encrypted values but must keep the XML data readable (spec).
- Debug/editor: `utils/debug`, `RoleEditor`, `Config.cheatsAreEnabled` (P3, omit).
- Localization: `DATA/Locale/EN.txt` (line = TID + 1), `TextManager` replace-params `%U`, `%U1`; `loadingText*.xml` (loading tips).
- GUI SWF dependency summary: `Assets/GUI/{collectables,contracts,Dailybonus,expansions,houses_info,investment,Missions,Storage}.swf`, `Assets/hud/hud.swf`, `DATA/popups/*`, `DATA/button/common`, `DATA/newspaper.swf`, `magazine_cover.swf`, `plain.swf`, `splash.swf`. The rewrite must either render these SWFs' exported frames (via ffdec like items) or rebuild the UI in HTML/Canvas. Decide per widget before starting HUD work.

## 14. Dependency graph and suggested build order

1. Config/rules loaders (XML to typed data), time model, save load/serialize (M). P0.
2. Map/camera/tile renderer, sprites (L) - 2.2.
3. Money/XP/level + HUD skeleton + tools bar (M+M) - 2.7, 2.8, 3.1, 3.2.
4. BuyBox shop, build tool, placement validation, construction timers (L+M) - 4.1, 2.3, 2.4.
5. Roads/terrain/HQ (M) - 2.6.
6. Rent/contracts/collection (L) - 2.5.
7. Tutorial including RonaldsCity, boss select, popups, arrows (L) - section 1. Requires 2-6. Do it immediately after 6 so the first session is testable end to end.
8. Instant build with gold, level-up popup, generic confirms (M).
9. Missions (L) + poll events (S).
10. Move/sell/demolish, expansions (M+M).
11. Options/sound/quality (S), daily bonus + WelcomeProgress subset (M).
12. Storage, offers, collectibles (L), upgrades display, wonders/influence, clubs/crew (M each).
13. Ambient (traffic, plane, rain) (M).
14. Visiting NPC cities, neighbors list, investments stubs (M).
15. Facebook-dependent features as stubs (S).

Totals (rough): P0 about 25-35 dev days (map L, shop L, rent L, tutorial L, HUD/tools M each), P1 about 15-20 days, P2 about 20-25 days, P3 stubs about 3 days.

## 15. Unverified items and open questions

- Exact HUD/tool-bar layout coordinates and SWF frame labels (need GUI SWF export spike).
- Terrain/road tile art and autotile frame rules.
- Construction time formula, `timePrice` to gold instant-build price, `maxPermits` queue limit: read `ItemDefinition.as`, `Company.as`, `PopupTradeBox.as`.
- Contract `incomeTime` units (XML 0.05 suggests hours) and abandon timers: read `StateOnRent.as` (`:267`, `:793`, `:1193-1264`).
- How `Profile` flags persist (`@flags`, `getPersistence :1634`) and what `update_profile gameConfig` stores (options).
- Whether `get_world` for NPC ids (Ronald, Cindy, Sheik) exists on the server (`rules/universe/map.xml`, `saveDefaults`).
- Server-side gaps listed in section 0 (investments, neighbor info, help).
