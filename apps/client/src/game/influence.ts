// Influence areas, commerce population and HQ road connectivity (pure logic, no Game/Pixi dependencies).
//
// Ported from the original's incremental bookkeeping, recomputed from scratch (the map is 90x60, items are few hundreds):
//  - ItemObject.influenceLoopNeighbours (ItemObject.as:456-491): an item with influenceRatio r covers the tiles
//    x in [tx-r, tx+cols+r), y in [ty-r, ty+rows+r) (r = ItemDefinition.getInfluenceRatio, ItemDefinition.as:1088).
//  - TileData.addItemInfluence (TileData.as:58-69) -> ItemObject.registerItemInfluence (ItemObject.as:2031-2068): a house
//    (ItemDefinition.isAffectedByInfluence = houses, not HQ, :1528) standing on a covered tile becomes related to the
//    influencer and (only) when the influencer is a decoration (isAffectedByType :1493) gains def.influenceValue percent.
//  - ItemObject.influenceGetItemsAffectedByCommerce (:743-765) / isAffectedByType (:2614): a commerce or club is paid for the
//    related houses that are not suspended and whose state is RENT in mode RENTING/GET_RENT (StateOnRent.isAffectedByType :1538).
//  - ItemObject.getPopulation (:2011-2029): commerce = sum of the affected houses' tenants; house = tenants once it has a contract.
//  - ItemObject.searchHQConnection / Map.astarSearchItem (Map.as:2461) / ItemObject.roadLoopNeighbours (:2100-2127), Astar
//    (utils/astar/Astar.as:107-150, 4-neighbour, road tiles only): connectivity item <-> HQ over the road graph.

export const TYPE_HOUSES = 0;
export const TYPE_COMMERCES = 1;
export const TYPE_DECORATIONS = 2;
export const TYPE_WONDERS = 3;
export const TYPE_CLUBS = 4;
export type ItemType = 0 | 1 | 2 | 3 | 4;

/** Static part of a placed item as far as influence/connectivity is concerned (absolute tiles). */
export interface InfluenceNode {
  sid: string;
  type: ItemType;
  isHQ: boolean;
  x: number;
  y: number;
  cols: number;
  rows: number;
  /** ItemDefinition.influenceRatio (0 = no area). */
  ratio: number;
  /** ItemDefinition.influenceValue (percent given to affected houses; decorations only). */
  value: number;
}

export interface Rect {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** ItemDefinition.isAffectedByInfluence (:1528). */
export const isHouseLike = (n: Pick<InfluenceNode, "type" | "isHQ">): boolean => n.type === TYPE_HOUSES && !n.isHQ;
/** ItemDefinition.hasCommerceBehaviour (:628): commerces and clubs are paid by the population around them. */
export const hasCommerceBehaviour = (type: number): boolean => type === TYPE_COMMERCES || type === TYPE_CLUBS;
/** ItemDefinition.needsHQConnection (:1585): everything but the HQ and decorations. */
export const needsHQConnection = (n: Pick<InfluenceNode, "type" | "isHQ">): boolean => !n.isHQ && n.type !== TYPE_DECORATIONS;

/** Footprint of an item. */
export const footprint = (n: Pick<InfluenceNode, "x" | "y" | "cols" | "rows">): Rect => ({ x0: n.x, y0: n.y, x1: n.x + n.cols, y1: n.y + n.rows });

/** Area an item with `ratio` covers (ItemObject.influenceLoopNeighbours). */
export function influenceRect(n: Pick<InfluenceNode, "x" | "y" | "cols" | "rows" | "ratio">): Rect {
  return { x0: n.x - n.ratio, y0: n.y - n.ratio, x1: n.x + n.cols + n.ratio, y1: n.y + n.rows + n.ratio };
}

export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export interface InfluenceIndex {
  /** influencer sid -> sids of houses on its area. */
  covers: Map<string, string[]>;
  /** house sid -> sids of influencers (ratio > 0, any type) whose area it stands on. */
  coveredBy: Map<string, string[]>;
}

/**
 * All (influencer, house) relations. Equivalent to attaching every item with an area on the tiles (TileData.addItemInfluence)
 * and letting each house tile register it; each pair counts once (registerItemInfluence's indexOf check).
 */
export function buildInfluenceIndex(nodes: readonly InfluenceNode[]): InfluenceIndex {
  const covers = new Map<string, string[]>();
  const coveredBy = new Map<string, string[]>();
  const houses = nodes.filter(isHouseLike);
  for (const j of nodes) {
    if (j.ratio <= 0) continue;
    const area = influenceRect(j);
    const list: string[] = [];
    for (const h of houses) {
      if (h.sid === j.sid || !rectsOverlap(area, footprint(h))) continue;
      list.push(h.sid);
      const back = coveredBy.get(h.sid);
      if (back) back.push(j.sid);
      else coveredBy.set(h.sid, [j.sid]);
    }
    covers.set(j.sid, list);
  }
  return { covers, coveredBy };
}

/**
 * ItemObject.influenceValue for a house (:2539-2551): sum of the influenceValue of the decorations covering it
 * (registerItemInfluence :2052-2061) + the company wonder attribute "influence" for Houses (`wonderPercent`).
 */
export function houseInfluencePercent(
  houseSid: string,
  index: InfluenceIndex,
  bySid: ReadonlyMap<string, InfluenceNode>,
  wonderPercent = 0
): number {
  let v = 0;
  for (const sid of index.coveredBy.get(houseSid) ?? []) {
    const j = bySid.get(sid);
    if (j && j.type === TYPE_DECORATIONS) v += j.value;
  }
  return v + wonderPercent;
}

/** Live facts the population rules need (supplied by the Game from the running items). */
export interface PopulationSource {
  /** Not suspended (HQ-connected) and state RENT in mode RENTING/GET_RENT (isAffectedByType). */
  isAffecting(sid: string): boolean;
  /** getPopulation of a house: tenants once it has a contract, else 0. */
  housePopulation(sid: string): number;
}

/** ItemObject.influenceGetItemsAffectedByCommerce: the houses a commerce/club is paid for. */
export function affectedHouses(commerceSid: string, index: InfluenceIndex, src: PopulationSource): string[] {
  return (index.covers.get(commerceSid) ?? []).filter((sid) => src.isAffecting(sid));
}

/** ItemObject.getPopulation for a commerce/club. */
export function commercePopulation(commerceSid: string, index: InfluenceIndex, src: PopulationSource): number {
  let p = 0;
  for (const sid of affectedHouses(commerceSid, index, src)) p += src.housePopulation(sid);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------
// HQ road connectivity
// ---------------------------------------------------------------------------------------------------------------------

/** ItemObject.roadLoopNeighbours: the ring of tiles around the footprint, corners excluded; returns the road ones. */
export function roadTilesAround(
  n: Pick<InfluenceNode, "x" | "y" | "cols" | "rows">,
  isRoad: (x: number, y: number) => boolean
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dx = -1; dx <= n.cols; dx += 1) {
    for (let dy = -1; dy <= n.rows; dy += 1) {
      const cornerX = dx === -1 || dx === n.cols;
      const cornerY = dy === -1 || dy === n.rows;
      if (cornerX && cornerY) continue;
      if (isRoad(n.x + dx, n.y + dy)) out.push([n.x + dx, n.y + dy]);
    }
  }
  return out;
}

/** Road tiles reachable (4-neighbour) from the road tiles touching the HQ. */
export function roadsReachableFromHQ(
  hq: Pick<InfluenceNode, "x" | "y" | "cols" | "rows">,
  roads: ReadonlySet<number>,
  cols: number,
  rows: number
): Set<number> {
  const isRoad = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows && roads.has(y * cols + x);
  const seen = new Set<number>();
  const stack: Array<[number, number]> = roadTilesAround(hq, isRoad);
  for (const [x, y] of stack) seen.add(y * cols + x);
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!isRoad(nx, ny)) continue;
      const k = ny * cols + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * Map.astarSearchItem outcome per item. Returns the sids that are NOT connected to the HQ. With no HQ on the map nothing is
 * affected (Company.isAffectedByHQConnection :1473); the HQ and decorations never need a connection (needsHQConnection).
 */
export function disconnectedItems(
  nodes: readonly InfluenceNode[],
  roads: ReadonlySet<number>,
  cols: number,
  rows: number
): Set<string> {
  const out = new Set<string>();
  const hq = nodes.find((n) => n.isHQ);
  if (!hq) return out;
  const reach = roadsReachableFromHQ(hq, roads, cols, rows);
  const isRoad = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows && roads.has(y * cols + x);
  for (const n of nodes) {
    if (!needsHQConnection(n)) continue;
    const tiles = roadTilesAround(n, isRoad);
    if (!tiles.some(([x, y]) => reach.has(y * cols + x))) out.add(n.sid);
  }
  return out;
}
