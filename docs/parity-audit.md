# Parity audit: rewrite vs original (0.501 rules)

Original = `decompiled/scripts/com/dchoc/dollars` (client) and `archive-recovery-2026-10-06/java/dollars` (server). Golden tests: `apps/client/test/parity.test.ts`, `apps/server/test/parity.test.ts`.

| Rule | Original | Ours | Verdict |
|---|---|---|---|
| Level/XP table (level 2 = 470, 351 levels) | RulesFacade.as:577-604 | packages/rules definitions.ts parseXpTable, game/rules.ts levelOf | MATCH |
| Level-up gold | Profile.as:1485 reads `@DCCashLevelUp`, absent -> int(empty XMLList)=0; Java grants none | rules.levelCash (all 0) | MATCH |
| Time price / terrain price (level row, index level-1) | Profile.as:2042, :1898 | rules.ts timePrice/terrainPrice | MATCH |
| Build level check, price, construction time | ItemDefinition/ActionGetItemDefinitions.as:80-130 | game.ts checkBuild | MATCH |
| Item numeric attributes are `int()` casts (tenants 11.2, movePriceCoins 1879949.4, influenceRatio 3.2, incomeValue...) | ActionGetItemDefinitions.as:75-110 | definitions.ts | MISMATCH (fixed: truncate) |
| Instant build price: remaining time, `int(int(timePrice*min)*factor)` | RulesFacade.as:331, Profile.as:2042, StateOnConstructionOwner.as:168 | game.ts instantBuildPrice via instantBuildPriceAt | MISMATCH (fixed: double cast; e.g. houses_001_002 L31 333 s: 742 not 743) |
| packages/rules `instantBuildPrice` used last XPTable row | ItemDefinition.as:476 is an overflow log only | marked diagnostic; new `instantBuildPriceAt` | MISMATCH (fixed) |
| Move price `movePriceCoins + instantBuild(constructionTime, min(1,factor))` | ToolMove.as:132 | rules.ts movePrice | MATCH (now double cast) |
| Early gold unlock price | RulesFacade.as:878-906 + unlockSegmentsSetMode(LIMITED) :1703 enables the visibility window (levelsVisible 1/3/4/10) | catalog.ts unlockSegmentsPrice, data.ts loads unlockSegmentsVisibility.xml | MISMATCH (fixed: previously every higher item was priced) |
| Gold cap 65 | settings unlockMaxPrice, ItemDefinition.as:1163 | catalog.ts unlockPrice | MATCH |
| Contract list per house (contractsSkus order, trimmed, unsorted) | ContractsTypeDefinition.as, ContractBoxSingle.as | rules.ts contractsForDef | MATCH |
| Contract coins/cost `int`, time hours->ms (no rounding diffs in data) | ActionGetContractDefinitions.as:19 | rules.ts | MATCH |
| Income per contract (def incomeValue + contract coins, uint math, influence %, levelFactor) | ItemObject.as:329-374 | income.ts getIncomeValue | MATCH |
| Commerce/club income, population | ItemObject.as:2011, StateOnRent.as:1440-1470 | economy.ts | MATCH |
| Upgrades +10%/+12% on coins and XP (owner, `getExtraPercentage`) | ItemObject.as:767, :358; social.xml | game.ts collectRent | MATCH |
| Double rent x incomeMultiplier (2) | StateOnRent.as giveIncome/giveDCCoins | economy.ts withDoubleRent | MATCH |
| Abandon time max(incomeTime*100%, 60 min) | RulesFacade.as:832 | rules.ts abandonTimeMs | MATCH |
| Rent accelerator `int(maxTime*pct/100)`, houses only | StateOnRent.as:1816, ItemObject.as:1424 | economy.ts | MATCH |
| Company value | Company.as getCompanyValue, Profile.as:1532 | economy.ts computeCompanyValue/expansionsValue | MATCH |
| Demolish profit 35% of def value; company value drops by def value + contract cost | StateItemObject.as:783-814 | game.ts sellItem | MISMATCH (fixed: contract cost was not subtracted) |
| `getSellPrice` (20%, NPC sale/StateOnIA) | ItemObject.as:699 | not used in owner flow | UNVERIFIABLE (feature absent) |
| Cancel contract refund `int(cost*50/100)` | StateOnRent.as:459 | game.ts cancelContract | MATCH |
| Terrain buy/destroy, road free (destroys terrain with 100% refund) | Map.as:1776, :1688, :2263 | game.ts | MATCH |
| Plot/expansion prices by purchased count; unlock order | Profile.as:1687-1696, RulesFacade.as:606 | game.ts buyPlot, ui/popups | MATCH |
| Gold<->coins exchange (ceil, 60000) | PopupConfirm.as:58-69, :321 | popups/logic.ts, game.exchangeGold | MATCH |
| Decoration influence (decorations only, % sum), wonder influence attribute | ItemObject.as:2031, ItemDefinition.as:1493 | influence.ts | MATCH |
| Wonder incomeMultiplier / npcIncome effects | server-side (GamePlay.java:2882) | none client-side | UNVERIFIABLE |
| Daily reward values/scaling | DailyBonusManager.as:61-95 | dailybonus-logic.ts | MATCH |
| Mission rewards/conditions (default, non-AB) | MissionDefinition.as | missions.ts | MATCH |
| Collectible drop probability | CollectiblesRules.java (1.25%..20.83% by contract hours) | server collectibles.ts | MISMATCH (fixed, server; was flat 12.5%) |
| Server dailyBonusDone fallback 20000 | SecurityNormal.java:91 | commandHandlers.ts | MISMATCH (fixed) |
| Server price checks (instant build, move, unlock, terrain, expansion) | SecurityNormal.java | server applies client snapshot | UNVERIFIABLE (not recomputed) |
| Rounding: AS3 `int()` truncates toward zero (JS Math.trunc); uint stores clamp/wrap | various | `Math.trunc`, `u()` | MATCH; no data overflows int32 (max instant price 2.05e9 at L351) |

Counts: MATCH 24, MISMATCH (fixed) 8, UNVERIFIABLE 3.
