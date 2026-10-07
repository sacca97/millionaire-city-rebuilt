// Shared seed helper for commerce classes (C13 C14 C17 C18 C19 C03 C04 C05): a road-connected commerce with
// houses that have a SIGNED contract and are RENTING, so the commerce has Customers > 0 and Income > 0 at boot.
//
// Usage inside a flow's seed:
//   import { seedCommerce, PIZZA_AT_6_1 } from "./lib-commerce.mjs";
//   export const seed = (u, prof) => { seedCommerce(u, prof, PIZZA_AT_6_1); ...mission chunks... };
//
// Geometry (verified on the post-tutorial baseline, tools/oracle/out/post-tutorial/post-tutorial.saves.json):
//   - HQ at (-1,-3) footprint x -1..2, y -3..-1; starter roads along y=0 (x -7..11) and y=4 (x -1..4), columns x=-1..4 between.
//   - The tutorial bungalow houses_001_001 sid 2171 at (4,2), 2x2 (4..5, 2..3), already owned terrain, adjacent road (4,4).
//   - Pizza at origin (6,1), 3x3 (6..8, 1..3): needs 9 new owned tiles; touches road (6,0),(7,0),(8,0); its influence
//     area (ratio 2) is x 4..10, y -1..5, which covers the bungalow footprint, so the bungalow is its customer.
//   - Click the centre tile of a block: pizza at (6,1) -> click (588,353). Bungalow (4,2) -> click (506,364).
//
// Document layout used: universe[...] World (whose "0") .Company[] items {sid, csid, sku, x, y, isSuspended, Item:[{State:[],id,mode,time,...}]};
// Map (World) .Map[0] .Terrain (chunk "x:y,x:y,") and .Road (chunk "x:y,...").

const SIZE = { commerce_pizza: [3, 3], houses_001_001: [2, 2], houses_002_001: [3, 3], houses_023_001: [2, 2] };

export const PIZZA_AT_6_1 = {
  commerce: { sku: "commerce_pizza", sid: "9101", x: 6, y: 1 },
  houses: [{ sid: "2171" }],                 // the existing tutorial bungalow, signed and renting (seeded at boot)
};

// Florist (level 7, pop >= 30 needs two 20-tenant houses): florist origin (3,-3) 3x3, houses_023_001 2x2 at (6,-2) and (6,1),
// both waiting and signed in-session (click (572,241) and (572,337)). Influence area of the florist (ratio 3): x 0..8, y -6..2.
export const FLORIST_AT_3_M3 = {
  commerce: { sku: "commerce_flower_shop", sid: "9101", x: 3, y: -3 },
  houses: [
    { sid: "9102", sku: "houses_023_001", x: 6, y: -2, waiting: true },
    { sid: "9103", sku: "houses_023_001", x: 6, y: 1, waiting: true },
  ],
};

export const PIZZA_AT_6_1_WAITING = {
  commerce: { sku: "commerce_pizza", sid: "9101", x: 6, y: 1 },
  houses: [{ sid: "2171", waiting: true }],  // bungalow with no contract; the flow calls signHouse(o) in-session
};

const world = (u) => u.universe.find((e) => Array.isArray(e.World)).World;
const mineOf = (u) => world(u).find((c) => c.whose === "0");

/** Append the given tiles to the Terrain chunk, skipping tiles already owned. */
export const addTerrain = (u, tiles) => {
  const map = world(u).find((e) => Array.isArray(e.Map)).Map;
  const terrain = map.find((e) => Array.isArray(e.Terrain));
  const owned = new Set((terrain.chunk || "").split(",").filter(Boolean));
  const add = tiles.map(([x, y]) => `${x}:${y}`).filter((t) => !owned.has(t));
  if (add.length) terrain.chunk = (terrain.chunk ? terrain.chunk.replace(/,?$/, ",") : "") + add.join(",") + ",";
};

const footprint = (x, y, cols, rows) => { const t = []; for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) t.push([x + i, y + j]); return t; };

/**
 * Seed the commerce, the houses (existing sids are updated, new ones are added) and the terrain they stand on.
 * opts.commerce {sku, sid, x, y, mode?, time?}; opts.houses [{sid, x?, y?, sku?, contractSku?}] (existing houses keep their place).
 * Commerce: mode "4" (RENT, collectable), time "0". Houses: mode "4" (RENTING), long timer, contract "1".
 */
export const seedCommerce = (u, prof, opts) => {
  const now = String(Date.now());
  const mine = mineOf(u);
  const { commerce, houses = [] } = opts;
  const [cc, cr] = SIZE[commerce.sku] ?? [3, 3];
  const tiles = footprint(commerce.x, commerce.y, cc, cr);
  for (const h of houses) {
    if (h.x !== undefined) { const [hc, hr] = SIZE[h.sku ?? "houses_001_001"]; tiles.push(...footprint(h.x, h.y, hc, hr)); }
  }
  addTerrain(u, tiles);
  for (const h of houses) {
    const existing = mine.Company.find((c) => c.sid === h.sid);
    // h.waiting: house seeded WITHOUT a contract (mode 1); the flow signs it in-session with signHouse(), so the original
    // counts the population during play instead of at boot.
    const item = h.waiting
      ? { State: [], id: "1", mode: "1", time: "0" }
      : { State: [], id: "1", mode: "4", time: h.time ?? "3600000", savedAt: now, contractSku: h.contractSku ?? "1", contractGroupSku: h.contractGroupSku ?? "1" };
    if (existing) { existing.Item = [item]; continue; }
    mine.Company.push({ Item: [item], sid: h.sid, csid: "1", sku: h.sku ?? "houses_001_001", x: String(h.x), y: String(h.y), isSuspended: "0" });
  }
  const cmode = commerce.mode ?? "4";
  mine.Company.push({ Item: [{ State: [], id: "1", mode: cmode, time: commerce.time ?? "0", savedAt: now }], sid: commerce.sid, csid: "1", sku: commerce.sku, x: String(commerce.x), y: String(commerce.y), isSuspended: "0" });
  prof.exp = prof.exp && Number(prof.exp) >= 6000 ? prof.exp : "6000";
  prof.DCCoins = "500000";
};

/** Sign the first contract of a waiting house (click the house, then the first contract card; coordinates from the recipes). */
export const signHouse = async (o, x = 506, y = 364) => {
  await o.click(x, y); await o.sleep(2500);
  await o.click(290, 215); await o.sleep(4000);
};

/**
 * Seed one decoration (no terrain needed: decorations stand on unowned grass). Used for the influence of houses (bonus classes):
 * decorations_font_02 (fountain, 2x2, influence ratio 2, value 14) covers the houses around it (ItemObject.influenceValue).
 */
export const addDecoration = (u, sku, sid, x, y) => {
  mineOf(u).Company.push({ Item: [{ State: [], id: "5" }], sid: String(sid), csid: "1", sku, x: String(x), y: String(y), isSuspended: "0" });
};

export const sidsOf = (u) => mineOf(u).Company.map((c) => c.sid);
