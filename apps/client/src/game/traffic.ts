// Port of the ambient traffic from dollars/utils/traffic/{TrafficAgentManager,TrafficAgent}.as.
// Pure logic (no DOM/Pixi). Units: pixels, milliseconds; speed in px/ms (definition speed / 1000).
// Not ported: crossing yield/wait states (STATE_NEAR_CROSSING/WAITING), pedestrians (none exist in
// the traffic rules: the only agents are cars and the scooter).
import { computeTileIndices } from "../terrain";

export const TILE = 32;
export const DIR_RIGHT = 0;
export const DIR_UP = 1;
export const DIR_LEFT = 2;
export const DIR_DOWN = 3;
/** TrafficAgent.as:41-42 */
export const DIR_COL = [1, 0, -1, 0];
export const DIR_ROW = [0, -1, 0, 1];

const INNER_RADIUS = 12; // MOVEMENT_CIRCLE_INNER_RADIUS
const OUTER_RADIUS = 22; // MOVEMENT_CIRCLE_OUTER_RADIUS
const COLLISION_DISTANCE = 60;
const ACCELERATION = 0.0001;
const STOP_TIMER = 4000;
const EXPIRE_MS = 5 * 60000;
const ALPHA_MS = 1000;

/** trafficAgentDefinitions.xml */
export interface TrafficDef {
  sku: string;
  speed: number;
  width: number;
  height: number;
  /** owning any one of these skus enables the agent; empty = always */
  spawnCondition: string[];
}

export const TRAFFIC_DEFS: TrafficDef[] = [
  { sku: "car_roadster", speed: 80, width: 28, height: 14, spawnCondition: ["commerce_night_club"] },
  { sku: "car_taxi", speed: 30, width: 28, height: 14, spawnCondition: ["commerce_hotel", "commerce_casino"] },
  { sku: "car_police", speed: 50, width: 21, height: 13, spawnCondition: ["commerce_bank"] },
  { sku: "scooter", speed: 30, width: 21, height: 13, spawnCondition: ["commerce_pizza"] },
  { sku: "car_01", speed: 35, width: 21, height: 13, spawnCondition: [] },
  { sku: "car_02", speed: 50, width: 21, height: 13, spawnCondition: [] },
  { sku: "car_03", speed: 60, width: 21, height: 13, spawnCondition: [] },
  { sku: "car_04", speed: 50, width: 21, height: 13, spawnCondition: [] },
  { sku: "car_05", speed: 70, width: 21, height: 13, spawnCondition: [] }
];

/** trafficAgentManagerDefinition.xml (askForANewAgent: 30 s / spawnAgentsMin, TrafficAgentManagerDefinition.as:96) */
export const TRAFFIC_MANAGER = {
  spawnProbabilityMin: 50,
  spawnProbabilityMax: 80,
  spawnAgentsMin: 3,
  spawnAgentsMax: 7,
  spawnAgentsLimit: 20,
  spawnAskForANewAgentMs: 10000,
  spawnMinTilesBetweenAgents: 3
};

export interface RoadMap {
  cols: number;
  rows: number;
  /** road tile indices (y * cols + x) */
  roads: Set<number>;
}

/** Relative save coordinates -> road tile index set (city.ts tileX/tileY convention). */
export function roadSetFromRelative(roads: Array<[number, number]>, cols: number, rows: number): RoadMap {
  const set = new Set<number>();
  for (const [x, y] of roads) {
    set.add((y + rows / 2) * cols + (x + cols / 2));
  }
  return { cols, rows, roads: set };
}

/** Mulberry32 seedable RNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type State = "running" | "turning" | "ending";

export class TrafficAgent {
  x = 0;
  y = 0;
  alpha = 0;
  /** degrees, screen-clockwise, 0 = right (Vector2D.angle). Frame = floor(rotation) + 1. */
  rotation = 0;
  enabled = false;
  state: State = "running";
  velocity = 0;
  maxSpeed = 0;
  def!: TrafficDef;
  index = 0;
  tileX = 0;
  tileY = 0;
  dir = DIR_RIGHT;
  nextDir = -1;
  // turn / straight reference
  cx = 0;
  cy = 0;
  radius = 0;
  angle0 = 0;
  sweep = 0; // signed +-90 deg in radians
  progress = 0;
  fadeIn = 0;
  fadeOut = 0;
  private stopped = 0;
  private expire = EXPIRE_MS;
  private px = 0;
  private py = 0;

  constructor(private sim: TrafficSim) {}

  /** Blended heading while turning (movementGetCurrentDirection). */
  heading(): [number, number] {
    const dx = DIR_COL[this.dir];
    const dy = DIR_ROW[this.dir];
    if (this.nextDir < 0) {
      return [dx, dy];
    }
    const x = dx + DIR_COL[this.nextDir];
    const y = dy + DIR_ROW[this.nextDir];
    const m = Math.hypot(x, y) || 1;
    return [x / m, y / m];
  }

  setup(def: TrafficDef, index: number): void {
    this.def = def;
    this.index = index;
    this.velocity = 0;
    this.maxSpeed = def.speed / 1000;
    this.stopped = 0;
    this.expire = EXPIRE_MS;
    this.nextDir = -1;
    this.fadeOut = 0;
    this.fadeIn = ALPHA_MS;
    this.alpha = 0;
    this.enabled = true;
  }

  /** wanderStart: pick a direction on the tile and place the agent in its lane (movementStartMovement). */
  start(tx: number, ty: number): boolean {
    const dirs = this.sim.passableDirs(tx, ty, -1);
    if (dirs.length === 0) {
      this.enabled = false;
      return false;
    }
    const d = dirs[Math.floor(this.sim.rng() * dirs.length)];
    this.tileX = tx;
    this.tileY = ty;
    this.dir = d;
    this.state = "running";
    const left = tx * TILE;
    const top = ty * TILE;
    const r = d === DIR_DOWN || d === DIR_RIGHT ? INNER_RADIUS : OUTER_RADIUS;
    if (DIR_COL[d] !== 0) {
      this.x = left + TILE / 2;
      this.y = top + TILE - r;
    } else {
      this.x = left + r;
      this.y = top + TILE / 2;
    }
    this.rotation = this.baseRotation(d);
    this.setStraightCenter();
    this.px = this.x;
    this.py = this.y;
    return true;
  }

  private setStraightCenter(): void {
    this.cx = this.tileX * TILE + TILE / 2 + DIR_COL[this.dir] * (TILE / 2);
    this.cy = this.tileY * TILE + TILE / 2 + DIR_ROW[this.dir] * (TILE / 2);
    this.nextDir = -1;
  }

  /** Choose direction for the current tile, set up straight/turn (wanderChooseDirection + movementSetTurnCenterPos). */
  private chooseAndSetup(): void {
    if (!this.sim.isPassable(this.tileX, this.tileY)) {
      this.end();
      return;
    }
    const opts = this.sim.passableDirs(this.tileX, this.tileY, this.dir);
    if (opts.length === 0) {
      // dead end: drive on until off the road, then fade (checkEndOfRoad)
      this.setStraightCenter();
      return;
    }
    const pick = opts[Math.floor(this.sim.rng() * opts.length)];
    if (pick === this.dir) {
      this.state = "running";
      this.setStraightCenter();
      return;
    }
    // turn: arc centre sits at the tile corner (movementSetTurnCenterPos)
    const cur = this.dir;
    this.nextDir = pick;
    const inner =
      (cur === DIR_LEFT && pick === DIR_UP) ||
      (cur === DIR_UP && pick === DIR_RIGHT) ||
      (cur === DIR_RIGHT && pick === DIR_DOWN) ||
      (cur === DIR_DOWN && pick === DIR_LEFT);
    this.radius = inner ? INNER_RADIUS : OUTER_RADIUS;
    const tcx = this.tileX * TILE + TILE / 2;
    const tcy = this.tileY * TILE + TILE / 2;
    this.cx = tcx + (TILE / 2) * (-DIR_COL[cur] + DIR_COL[pick]);
    this.cy = tcy + (TILE / 2) * (-DIR_ROW[cur] + DIR_ROW[pick]);
    // start vector = -next * R, end vector = cur * R
    this.angle0 = Math.atan2(-DIR_ROW[pick], -DIR_COL[pick]);
    const a1 = Math.atan2(DIR_ROW[cur], DIR_COL[cur]);
    let diff = a1 - this.angle0;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    this.sweep = diff >= 0 ? 1 : -1;
    this.progress = 0;
    this.state = "turning";
  }

  end(): void {
    if (this.state !== "ending") {
      this.state = "ending";
      this.fadeOut = ALPHA_MS;
    }
  }

  private baseRotation(d: number): number {
    return [0, 270, 180, 90][d];
  }

  update(dt: number): void {
    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      this.alpha = 1 - this.fadeIn / ALPHA_MS;
    }
    if (this.state === "ending") {
      this.fadeOut = Math.max(0, this.fadeOut - dt);
      this.alpha = Math.min(this.alpha, this.fadeOut / ALPHA_MS);
      if (this.fadeOut <= 0) {
        this.enabled = false;
      }
      return;
    }
    this.expire -= dt;
    if (this.expire <= 0) {
      this.end();
      return;
    }
    if (!this.sim.isPassable(this.tileX, this.tileY)) {
      this.end();
      return;
    }
    // stuck detection (checkCarStopped)
    if (this.x === this.px && this.y === this.py) {
      this.stopped += dt;
      if (this.stopped >= STOP_TIMER) {
        this.end();
        return;
      }
    } else {
      this.stopped = 0;
    }
    this.px = this.x;
    this.py = this.y;

    this.updateSpeed(dt);
    if (this.state === "running") {
      const dx = DIR_COL[this.dir];
      const dy = DIR_ROW[this.dir];
      const before = (this.x - this.cx) * dx + (this.y - this.cy) * dy;
      this.x += dx * this.velocity * dt;
      this.y += dy * this.velocity * dt;
      const after = (this.x - this.cx) * dx + (this.y - this.cy) * dy;
      this.rotation = this.baseRotation(this.dir);
      if (before < 0 && after >= 0) {
        // left the tile: enter the next one and choose again (advanceTile + advanceTurnCenterPoint)
        this.tileX += dx;
        this.tileY += dy;
        this.chooseAndSetup();
      }
    } else if (this.state === "turning") {
      this.progress += (this.velocity / this.radius) * dt;
      const t = Math.min(this.progress, Math.PI / 2);
      const a = this.angle0 + this.sweep * t;
      this.x = this.cx + Math.cos(a) * this.radius;
      this.y = this.cy + Math.sin(a) * this.radius;
      let rot = this.baseRotation(this.dir) + this.sweep * (t * 180) / Math.PI;
      rot = ((rot % 360) + 360) % 360;
      this.rotation = rot;
      if (this.progress >= Math.PI / 2) {
        this.dir = this.nextDir;
        this.nextDir = -1;
        this.rotation = this.baseRotation(this.dir);
        this.tileX += DIR_COL[this.dir];
        this.tileY += DIR_ROW[this.dir];
        this.state = "running";
        this.chooseAndSetup();
      }
    }
  }

  /** Speed control from the nearest tagged neighbour (TrafficAgent.logicUpdate / manager.avoidObstacles). */
  private updateSpeed(dt: number): void {
    const own = this.def.speed / 1000;
    const hit = this.sim.avoidObstacles(this);
    if (hit) {
      if (hit.turning) {
        this.maxSpeed = hit.v;
      } else {
        const lim = 2.5 * this.def.width;
        if (hit.d <= lim) {
          this.maxSpeed = hit.v;
        } else {
          const r = (hit.d - lim) / (COLLISION_DISTANCE - lim);
          this.maxSpeed = r >= 0 && r <= 0.05 ? hit.v : hit.v + (own - hit.v) * r;
        }
      }
    } else {
      this.maxSpeed = own;
    }
    this.maxSpeed = Math.min(this.maxSpeed, own);
    this.velocity = Math.max(0, Math.min(this.maxSpeed, this.velocity + ACCELERATION * dt));
  }
}

export interface TrafficOptions {
  seed?: number;
  /** owned-building counts (registerOccurrenceGetAmount) for spawnCondition */
  owned?: (sku: string) => number;
  /** number of owned plots, getNumberOfPlots(); caps the agent count */
  plots?: number;
  defs?: TrafficDef[];
}

export class TrafficSim {
  readonly agents: TrafficAgent[] = [];
  rng: () => number;
  private map: RoadMap;
  private mapData: Uint16Array = new Uint16Array(0);
  private roadList: number[] = [];
  private spawnTimer = TRAFFIC_MANAGER.spawnAskForANewAgentMs;
  private nextIndex = 0;
  private owned: (sku: string) => number;
  plots: number;
  private defs: TrafficDef[];

  constructor(map: RoadMap, opts: TrafficOptions = {}) {
    this.map = map;
    this.rng = makeRng(opts.seed ?? 1);
    this.owned = opts.owned ?? (() => 0);
    this.plots = opts.plots ?? 10;
    this.defs = opts.defs ?? TRAFFIC_DEFS;
    this.setRoads(map);
  }

  setRoads(map: RoadMap): void {
    this.map = map;
    this.mapData = computeTileIndices({ cols: map.cols, rows: map.rows, terrain: new Set(), road: map.roads });
    this.roadList = [...map.roads].sort((a, b) => a - b);
  }

  isRoad(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.map.cols && ty < this.map.rows && this.map.roads.has(ty * this.map.cols + tx);
  }

  /** TileData.isPassable: road and mapData != 66 */
  isPassable(tx: number, ty: number): boolean {
    return this.isRoad(tx, ty) && this.mapData[ty * this.map.cols + tx] !== 66;
  }

  /**
   * Directions an agent may take from a tile (getPossibleDirections / wanderChooseDirection):
   * no reversing (same axis, other direction) and the 63/65/67/69 tile-pair exclusions.
   */
  passableDirs(tx: number, ty: number, curDir: number): number[] {
    const out: number[] = [];
    const here = this.mapData[ty * this.map.cols + tx];
    for (let d = 0; d < 4; d += 1) {
      const nx = tx + DIR_COL[d];
      const ny = ty + DIR_ROW[d];
      if (nx < 0 || ny < 0 || nx >= this.map.cols || ny >= this.map.rows) {
        continue;
      }
      let ok = true;
      if (curDir !== -1) {
        const n = this.mapData[ny * this.map.cols + nx];
        if (
          d !== curDir &&
          (d % 2 === curDir % 2 ||
            (n === 65 && here === 67) ||
            (n === 67 && here === 65) ||
            (n === 63 && here === 69) ||
            (n === 69 && here === 63))
        ) {
          ok = false;
        }
      }
      if (ok && this.isPassable(nx, ny)) {
        out.push(d);
      }
    }
    return out;
  }

  /** manager.tagNeighbors + avoidObstacles; returns the blocking neighbour info or null. */
  avoidObstacles(a: TrafficAgent): { v: number; d: number; turning: boolean } | null {
    const [hx, hy] = a.heading();
    let best: TrafficAgent | undefined;
    let bestD = Infinity;
    for (const o of this.agents) {
      if (o === a || !o.enabled || o.state === "ending") {
        continue;
      }
      const rx = o.x - a.x;
      const ry = o.y - a.y;
      if (rx * hx + ry * hy < 0) {
        continue; // behind
      }
      const [ox, oy] = o.heading();
      const cos = Math.max(-1, Math.min(1, hx * ox + hy * oy));
      if (Math.abs((Math.acos(cos) * 180) / Math.PI) > 90) {
        continue;
      }
      const hw = o.def.width / 2;
      const front = Math.hypot(o.x + ox * hw - a.x, o.y + oy * hw - a.y);
      const back = Math.hypot(o.x - ox * hw - a.x, o.y - oy * hw - a.y);
      if (front <= back) {
        continue;
      }
      const d = Math.hypot(rx, ry);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best && bestD < COLLISION_DISTANCE) {
      return { v: best.velocity, d: bestD, turning: best.state === "turning" };
    }
    return null;
  }

  private active(): number {
    return this.agents.filter((a) => a.enabled).length;
  }

  update(dt: number): void {
    for (const a of this.agents) {
      if (a.enabled) {
        a.update(dt);
      }
    }
    this.spawnUpdate(dt);
  }

  /** spawnLogicUpdate */
  private spawnUpdate(dt: number): void {
    const m = TRAFFIC_MANAGER;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) {
      return;
    }
    this.spawnTimer = m.spawnAskForANewAgentMs;
    this.trySpawn();
  }

  /** One spawn attempt (timer step body). Returns the agent if spawned. */
  trySpawn(): TrafficAgent | undefined {
    const m = TRAFFIC_MANAGER;
    const n = this.active();
    const cap = Math.max(Math.min(this.plots, m.spawnAgentsLimit), m.spawnAgentsMin);
    if (n >= cap || this.roadList.length === 0) {
      return undefined;
    }
    let prob = 100;
    if (n > m.spawnAgentsMin) {
      const slope = (m.spawnProbabilityMax - m.spawnAgentsMin) / (m.spawnAgentsMax - m.spawnAgentsMin);
      prob = m.spawnProbabilityMax - n * slope;
    }
    if (this.rng() * 100 > prob) {
      return undefined;
    }
    const idx = this.roadList[Math.floor(this.rng() * this.roadList.length)];
    const tx = idx % this.map.cols;
    const ty = Math.floor(idx / this.map.cols);
    if (!this.isPassable(tx, ty)) {
      return undefined;
    }
    const wx = tx * TILE;
    const wy = ty * TILE;
    const min2 = (m.spawnMinTilesBetweenAgents * TILE) ** 2;
    for (const o of this.agents) {
      if (o.enabled && (o.x - wx) ** 2 + (o.y - wy) ** 2 < min2) {
        return undefined;
      }
    }
    const pool = this.defs.filter((d) => d.spawnCondition.length === 0 || d.spawnCondition.some((s) => this.owned(s) > 0));
    if (pool.length === 0) {
      return undefined;
    }
    // original picks int(random * (len - 1)): the last eligible definition is never chosen
    const def = pool[Math.floor(this.rng() * Math.max(1, pool.length - 1))];
    let agent = this.agents.find((a) => !a.enabled);
    if (!agent) {
      agent = new TrafficAgent(this);
      this.agents.push(agent);
    }
    agent.setup(def, this.nextIndex++);
    return agent.start(tx, ty) ? agent : undefined;
  }

  /** Drops agents whose tile stopped being a road (map edited). */
  setRoadsAndPrune(map: RoadMap): void {
    this.setRoads(map);
    for (const a of this.agents) {
      if (a.enabled && !this.isPassable(a.tileX, a.tileY)) {
        a.end();
      }
    }
  }
}
