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
Several missions Up: comma separated chunk (`"6,7"`). Reward group: add the flag to the profile flags string (read how `flows/mission-reward-variant.mjs` does it).

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
