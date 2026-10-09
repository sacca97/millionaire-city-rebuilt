# Audit: places where the TS client differs from the original ActionScript

Scope: ordering, filtering, grouping, paging, defaults, rounding and formatting in `apps/client/src` and `packages/rules/src`, compared with `decompiled/scripts/**` and the rules XML. Each finding below was confirmed by reading both sides. Nothing was changed in code.

Areas checked and found to match the original (no action): shop tab membership (type tab + `shopTab` list, `new_items`, limEd), shop price/discount rounding, `unlockSegments` price, storage sort (`mOrder`, then `mSku` case-insensitive) and page size 4, collectibles tab order and per-group sort, invest list sort (`sortInvestmentsUI`), friends bar rank (`count - index`) and page size 8, expansion price table, destroy/sell/abandon/move/instant-build truncation, contract cost/refund truncation, `convertNumberToString` / `convertTimeToString` / `convertTimeToStringCollon`, daily-bonus gain rules, box-prize exp, incomeTime/constructionTime conversion (checked against every XML value: trunc vs round gives identical results).

---

## F1 (high) Level-up popup lists the wrong set of items, in the wrong order

- Ours: `apps/client/src/ui/popups/levelUp.ts:20-27` (`unlockedSkusAtLevel`), used for the count text and the cards at `:49-50`.
- Original: `GUI/PopupLevel.as:229` calls `ItemDefinitionManager.getItemsByLevel(level, -1, ItemDefinition.isAllowedToBeInLevelUp)`. That runs `ItemDefinitionManager.checkLevel` (`ItemDefinitionManager.as`, override: `unlockCondition == LEVEL && level == n`) and `ItemDefinition.isAllowedToBeInLevelUp` (`ItemDefinition.as:1280-1325`). Order comes from `DefinitionManager.getDefinitionsWithCondition` (`DefinitionManager.as:~190`): type 0..4, each type array already sorted with the shop comparator (level, coins, exp).
- Actual: we skip only HQ, `unlockCondition == fan`, and two attributes (`hidden`, `inShop`) that do not exist in any rules XML. We iterate `ctx.defs` in load order.
- Missing exclusions in our code (all of these are excluded by the original):
  - `unlockCondition` other than `level` (the `cross_21`, `cross_33`, `cross_37` decorations, e.g. `decorations_special_39` L8 and `decorations_special_84` L7)
  - `where` without `shop` (`houses_037_001`, `decorations_christmas_07`, `decorations_christmas_10`, `decorations_pond_03`, all L1)
  - `freeGift="1"` (about 25 decorations, e.g. `decorations_set_08` L3)
  - `wonder_npc_*` of the other boss (`wonder_npc_Ronald` and `wonder_npc_Cindy` are both L25; only the player's own boss is allowed)
  - `releaseTime` in the future, limEd items without units (`decorations_special_36` L21, `decorations_special_47`/`decorations_statue_21` L7/L6, `wonder_buda` L34)
  - expired items (`expireTime`): the XML has about 190 of them
  - clubs and bundles (`club_001`, L3, is always excluded)
- Example: level 7 in the original lists only the current seasonal-free items for L7; ours also lists every expired L7 decoration/house/commerce (`decorations_christmas_03`, `_05`, `houses_023_001`, `houses_025_002`, `commerce_robot`, `decorations_special_41/45/14/09`, ...) and the `freeGift` set items, so "TID_LEVELUP_NEW_BUILDINGS n" shows a wrong n and the pages show items the shop will not sell.
- Fix: reuse `isAllowedInShop` / `parseShopItem` from `ui/shop/catalog.ts` (same expiry cutoff the shop already uses) and add the level-up extras: `unlockCondition === 'level'`, skip type Clubs/Bundles. Build the list as `itemsForTab(...)` per type 0..3 (Houses, Commerces, Decorations, Wonders) in that order, so the comparator order is kept, and filter `level === n`.

## F2 (high) Contract popup info box shows the wrong income (and XP)

- Ours: `apps/client/src/game/game.ts:1280-1297` (`option()`): `income` is `getIncomeValue({... influenceValue: influencePercent(sid)})` for houses and `commerceInfoIncome` (population, influence, level factor) for clubs. `xp` is `def.incomeXP + contract.incomeXP`. Shown at `ui/popups/contract.ts:80-82`.
- Original: `GUI/infoBox/InfoBoxContract.as:63-64` shows `ContractItem.getIncomeCoins()` / `getIncomeXP()`. `ContractItem.setContractDefinition` (`ContractItem.as:123-140`) only accumulates `contract.getIncomeCoins() * 1` and `contract.getIncomeXP() * 1`. No influence, no upgrade percentage, no population, no definition income.
- Example: a house in a street with decoration influence +10% and contract "Students" (incomeCoins 1230): original shows `$1,230`, ours shows `$1,353`. For a commerce/club contract ours multiplies by the affected population; the original shows the raw contract value.
- Also: for clubs (`type == TYPE_CLUBS_ID`) the original uses the `popup_info_box_club_left/right` clips (`InfoBoxContract.as:21-34`); ours always uses `popup_info_box_left/right` (`contract.ts:73`).
- Fix: in `option()` set `income: c.incomeCoins`, `xp: c.incomeXP`; in `contract.ts` pick `popup_info_box_${item is club ? 'club_' : ''}(left|right)`. Keep the real income formula only for the actual payout.

## F3 (medium) Friends bar company value uses the wrong formatter

- Ours: `apps/client/src/ui/hud/friends.ts:211`: `convertNumberToString(n.companyValue, TRUNCATE_MILLIONS, 6)`.
- Original: `friends/FriendsBarContentFriend.as:116` and `:141` use `TextManager.convertNumberRanking(companyValue)` (`TextManager.as:481-545`). `convertNumberRanking` already exists in `gui/format.ts` and is used for the invest list (`invest.ts:235`).
- Examples (original vs ours): 250,000 -> `$250K` vs `$250,000`; 12,345 -> `$12K` vs `$12,345`; 12,345,678 -> `$12.3M` vs `$12M`; 1,500,000 -> `$1.50M` both; 100,000,000 -> `$100M` both. Values below 1000 return `""` in the original (the TS version returns the number, see note in `format.ts:95`; harmless for real values).
- Fix: use `convertNumberRanking` in `friends.ts:211`.

## F4 (medium) Shop sort ignores the gold/FB-credits price tier

- Ours: `apps/client/src/ui/shop/catalog.ts:303-310` (`compareItems`): level, then coins, then exp.
- Original: `ItemDefinitionManager.as:119-146` (`sortCompareSameLevelFunction`): within a level it first compares `getConstructionFBCredits()` (XML `constructionFBC`, same rule: smaller non-zero first), then `getConstructionCoins()`, then exp.
- Affected: same-level items that are bought with gold (`constructionCoins="0"`, `constructionFBC>0`). Ours then falls to exp, the original orders by FBC price. Examples (all would be listed in the shop; first listed first):
  - Houses L35: original `houses_047_002` (34), `houses_041_002` (44), `houses_029_001` (70); ours by exp `houses_029_001` (28000), `houses_047_002` (35000), `houses_041_002` (50000)
  - Decorations L7: `decorations_special_41` (12) before `decorations_special_47` (24); ours by exp puts 47 (625 exp) first
  - Commerce L30: `Commerce_zlounge` (24) before `commerce_chapel` (30); ours by exp reverses
  - Also L3, L10 (`houses_045_001..3` all equal), L43, L69; decorations L6, 16, 21, 23, 25, 27, 34, 35, 40, 65; commerce L22
  - Note: the whole mismatch only shows if the items pass `isAllowedInShop` (several are limited-time; the shop treats those expiring 16:01:2012 as still on sale).
- Fix: add `fbc` to the first comparison (`ShopItem.fbc` already exists): `if (a.fbc > b.fbc && b.fbc > 0) return 1; if (a.fbc < b.fbc && a.fbc > 0) return -1;` before the coins check.
- Also note: the original `sortCompareSameCostFunction` returns -1 for equal exp and Flash's `Array.sort` is not stable; our stable "equal" is a deliberate approximation (documented in the code).

## F5 (medium) Locked-mission preview order compares unlockSku numerically

- Ours: `apps/client/src/game/missions.ts:717-728` (`compareLocked`): `Number(da.unlockSku)` vs `Number(db.unlockSku)`.
- Original: `missions/MissionObjectManager.as:101-141` (`sortMissionsLocked`): `_loc3_.unlockSku > _loc4_.unlockSku` where `MissionDefinition.unlockSku` is a `String` (`MissionDefinition.as:267`), so it is a string comparison ("10" < "2").
- Example (missionDefinitions.xml, 122 missions have an `unlockSku`): original order starts 25 (unlock "10"), 293, 255, 267, ...; ours starts 18 (unlock "2"), 21, 25, 3, 19, ... Which locked previews are shown below the available missions (up to 6 rows total, `getMissions`) therefore differs.
- Related, lower confidence: `missions.ts:582` sorts the Up list numerically; the original (`MissionObjectManager.as:728`, `sortMissionsBySku`) sorts by the sku string, so 10 would sort before 2. The code comment says the oracle panel (hud-tour 05) shows 1, 2, 5, 10; that may come from a code path that is not sorted (fresh game builds from `initMissionsLoad`, not `build()`), so check against a loaded save before changing it.
- Fix: replace the numeric compare with the same string compare used in `bySku()` for `unlockSku`.

## F6 (low-medium) Shop "Featured" tab ignores server offers and free items

- Ours: `apps/client/src/ui/shop/catalog.ts:318-320`: featured = XML `featured` attribute only; offers only reorder (`:326-329`).
- Original: the featured list also receives every item that gets an `offerDef` (`ItemDefinition.as:302-314`), every bundle (`BundleDefinition.as:38-39`) and every free item (`OfferManager.addFreeItem`, `OfferManager.as:45-54`), and an item that loses its offer is removed from it even when the XML marked it featured (`ItemDefinition.as:305-308`).
- Impact only when the server sends offers/free items.
- Fix: `inTab = (it.featured && !offerRemoved) || st.offers?.has(it.sku) || freeItems.has(it.sku)`.

## F7 (low) Friends bar tie order

- Ours: `friends.ts:36-37,178` sorts descending then reverses. The original sorts ascending by company value once (`FriendsManager.sortCompareFunctionCompanyValue`) and assigns rank `count - index`. With equal company values (e.g. the three NPCs Ronald/Cindy at 100,000,000, or a neighbour equal to you) the relative order of ties is reversed compared with the original. Fix: sort ascending directly with the same comparator and compute rank as `length - index`.

## F8 (low) Invest "pick friend" list

- Ours: `ui/social/invest.ts:105-107`: friends that already have an investment are excluded only when `state !== DONE_CLAIMED`; the list is not sorted.
- Original: `InvestManager.friendsToInvestPopulate` (`:133-162`) excludes any friend present in `mInvestObjects` regardless of state, then sorts by `nameFriend` (string compare, `sortCompareFunctionName`). The whole screen is a stand-in for the Facebook friend picker, so this is cosmetic.

---

## Prioritised list

1. F1 level-up item list (wrong items and count shown on every level-up).
2. F2 contract info box income/XP (wrong number shown for any house with influence, and for clubs/commerces).
3. F3 friends bar value formatting (visible on every neighbour box).
4. F4 shop order of gold-priced items within a level.
5. F5 locked-mission preview order (and re-verify the Up list sort against a save).
6. F6 featured tab membership with offers.
7. F7, F8 tie-break and invest list details.
