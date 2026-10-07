# Oracle flow recipes for mission runs (copy, don't invent)

All coordinates are in the 760x600 stage (same for the original and for our client in `tools/oracle/ours-flow.mjs`). They were copied from working flows in `tools/oracle/flows/`; re-check with a screenshot (`await shot("label")`) before relying on them for a new situation. A flow file exports `seed(u, prof)` (and optionally `seedDocs`, `daily`) and a default `async function (o)`; helpers on `o`: `boot()`, `sleep(ms)`, `click(x,y)` (as `c`), `mv(x,y)` (as `m`, hover), `shot(label)`, `stat(label)` (prints coins/company value/xp/cash/items), `dump(label)` (writes `<label>.saves.json`), `reload()`, `type(text)`, `drag(x1,y1,x2,y2)`, `mutateDoc(tag, fn)`, `getDoc(tag)`.

## Seeding

```js
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";                        // level / money for the step
  const mission = prof.Profile.find((e) => Array.isArray(e.Missions));
  mission.Missions = [{ Up: [], chunk: "6" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];   // mission 6 is Up
  const poll = prof.Profile.find((e) => Array.isArray(e.PollManager));
  poll.PollManager = [{ Count: [], chunk: "collectHouses/9" }];       // counter already at 9 (flows/mission-collect.mjs)
};
```
Several missions Up: comma separated chunk (`"6,7"`). Reward group: add the flag to the profile flags string (read how `flows/mission-reward-variant.mjs` does it). Alt mission set (`showInABtest="alt_missions"`): the profile flag is named **`altMissions`** with value 1 (`Profile.as:151,267-269`), written as `altMissions:1` in the `flags` string (comma separated `name:value`). `alt_missions:1` is NOT the flag (that is the XML A/B group name) and does nothing; four earlier alt runs were blocked by this mistake.

## Tools bar (y = 459)
select (506,459), terrain (563,459), shop/build (618,459), road (676,459), destroy (733,459). Multi-tool briefcase (55,452), then the move tool (65,398) (`flows/move.mjs`).

## Buy a 2x2 plot (needed before placing a house)
```js
await c(563, 459); await sleep(1000);
for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
```

## Place a house from the shop
```js
await c(618, 459); await sleep(3000);      // open the shop (Houses tab)
await c(255, 355); await sleep(3000);      // buy card used in flows/mission-collect.mjs (383,355 in mission-build.mjs: different card)
await m(572, 241); await sleep(800);       // ghost over the plot
await c(572, 241); await sleep(3500);      // place
```
For other tabs/cards take a screenshot of the open shop and read the card positions; tabs are along the top (Houses, Commerces, Decorations, Wonders).

## Sign a contract / collect
Click the placed house (`506,364` or `575,243` depending on the seed), then the first contract card `(290,215)`. To skip waiting for timers:
```js
mutateDoc("universe", (u) => {
  const mine = u.universe.find((e) => e.World).World.find((c) => c.whose === "0");
  const house = mine.Company.find((i) => i.sku === "houses_001_001" && i.x === "6");
  house.Item[0].time = "4000"; house.Item[0].savedAt = String(Date.now());   // 4 s left
});
await reload(); await sleep(6000);
```
then click the house again to collect (`flows/mission-collect.mjs`).

## Missions panel and popups
Open the missions panel (35,357); first list entry (517,220); close popups (570,127), (578,154); magazine close (533,67). City name typing: `await c(388,257); await o.type("MyTown")` (`flows/missions-instant-expansion.mjs`).

## Always end a flow with
```js
dump("completed");              // right after the mission completes
await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
```
`verify.py --reload` requires a dump whose name contains `reload` or `final`.

## Map geometry (VERIFIED, replaces the earlier wrong "isometric" belief)

The city map is TOP-DOWN with 32 px tiles (`docs/client-logic-spec.md`; `TopDownView`). In the flows' default boot camera, the stage centre of save-relative tile (tx,ty) is

```text
x = 556 + (tx - 6) * 32        y = 225 + (ty + 2) * 32          (760x600 stage)
```
(check: tiles 6:-2, 7:-2, 6:-1, 7:-1 are the clicks (556,225), (588,225), (556,257), (588,257) used by every flow; tiles 6:-3..6:-5 are y = 193, 161, 129.) A building is placed by clicking the centre of its footprint block: a 2x2 at tiles (6..7, -2..-1) is clicked at (572,241); a 3x3 at tiles (6..8, -5..-3) at (588,193).

Commerces (3x3) and houses need ALL footprint tiles to be OWNED terrain (otherwise "You must place this building in a 3x3 plot"). Do not buy them with 9 uncertain terrain clicks: seed the terrain in the flow's `seed` and click only the shop and the placement tile:

```js
export const seed = (u, prof) => {
  // append a 3x3 block of owned terrain at tiles x 6..8, y -5..-3 (relative coords, "x:y" comma list) to the player's Map Terrain chunk
  const world = u.universe.find((e) => Array.isArray(e.World)).World;
  const map = world.find((e) => Array.isArray(e.Map)).Map;
  const terrain = map.find((e) => Array.isArray(e.Terrain));
  const add = []; for (let x = 6; x <= 8; x++) for (let y = -5; y <= -3; y++) add.push(`${x}:${y}`);
  terrain.chunk = (terrain.chunk ? terrain.chunk.replace(/,?$/, ",") : "") + add.join(",") + ",";
  prof.exp = "6000"; prof.DCCoins = "500000";
};
```
(Verify the document layout once against `tools/oracle/out/flow-<any>/completed.saves.json`: key path `universe[...]/World/Map[0]/Terrain`, `chunk` string "x:y,x:y,".) Avoid tiles on the Road chunk of the same Map element; the starter roads run along y = 0 (x -7..) and a vertical stub: check the chunk before choosing a block. Decorations do not need terrain.

## Reload timing (both clients)

Our client flushes queued commands when the page unloads; the original LOSES commands still queued (its cache timer is 2-7 s). To compare like with like, put `await sleep(8000)` before every `reload()` so both clients have delivered everything. Verify differences that disappear after this wait are timing, not logic.

## Boot popups swallow clicks

If a seeded save makes an earn/company-value mission complete at boot (for example DCCoins >= 1,000,000 or company value above 1,000,000), its reward popup opens on top of the game and eats the first clicks. Keep `DCCoins` around 500,000 unless the flow is the earn mission itself, and dismiss popups with the close coordinates above before acting.

## Contract choice and collect poll keys

`collectHouses%N` (mission type `collect`, parameter `Houses%N`) counts collections of houses whose SIGNED contract has `incomeTime` = N hours (`ContractDefinition.setIncomeTime`: the raw XML string is the "time sku"). For the Bungalow (contract type 1: list `1,2,3,154,4,5,6,171,7,8,9` with income times 0.05, 0.5, 1, 2, 4, 8 ...) `Houses%2` needs contract **154** (the 4th card, income time 2 h), not the first card. Seed the counter as `PollManager` chunk `collectHouses%2/199` (see the seeding block above) and collect once.

## Alt-set missions

Profile flag `altMissions:1` (comma separated `name:value` in `prof.flags`) activates the 231 alt missions (`Profile.as:151,267`). `alt_missions` is only the XML A/B group name and does nothing. Alt missions have their own `showInABtest` entries; a flow for an alt rep must set the flag in `seed`.
