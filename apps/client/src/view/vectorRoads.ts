/**
 * Roads redrawn as vector art instead of the 32 px tileset bitmaps, so they stay crisp at any zoom. Geometry and colours were measured on
 * `terrain/tiles/tileset.png` (see tools/road-compare for the side-by-side comparer):
 *  - asphalt: white noise, values 66..76 (mean 70.6, std 2.9), one noise pixel per tile pixel;
 *  - curb, from the road edge inwards: 1 px #2e2e2e, 1 px #555555, 1 px #999999, 1 px #3f3f3f;
 *  - only the outer corner of a 90 degree bend is round (radius 10 px), road ends and inner corners are square, street ends stay open;
 *  - lane line: colour 194, 1 px thick, dashes 7.7 px long every 16 px (starting at x=12 and x=28 of a tile; the horizontal line occupies
 *    y 15..16, the vertical one x 16..17); it keeps going through T junctions, bends get a rounded elbow of the same total length (radius 3 px);
 *  - crosswalk tiles (tileset indices 1 horizontal, 2 vertical): 5 bars of 2 x 10 px, 5 px apart.
 * The result is rendered per chunk of tiles to canvases at `scale` times the native resolution.
 */
const TILE = 32;
const BEND_RADIUS = 10;
const LANE_RADIUS = 3;
const DASH = 7.7;

export interface RoadChunk {
  /** Chunk coordinates (in chunks of `chunk` tiles). */
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement;
}

export interface RoadInput {
  cols: number;
  rows: number;
  /** True for road tiles (terrain already excluded). */
  isRoad: (x: number, y: number) => boolean;
  /** Tileset index the game logic picked for a tile (1 / 2 mark the crosswalk tiles), or -1. */
  tileIndex: (x: number, y: number) => number;
  /** Render resolution relative to the 32 px tiles. */
  scale: number;
  /** Tiles per chunk side. */
  chunk: number;
}

/** True when the browser APIs needed to draw the roads exist (not in unit tests). */
export const vectorRoadsSupported = (): boolean => typeof document !== "undefined" && typeof Path2D !== "undefined" && typeof DOMMatrix !== "undefined";

type Pt = [number, number];

/** Boundary edges with the road on the right-hand side, chained into closed loops (outer boundaries and holes), collinear points dropped. */
function outlineLoops(input: RoadInput): Pt[][] {
  const { cols, rows, isRoad } = input;
  const edges = new Map<string, Pt[]>();
  const add = (a: Pt, b: Pt): void => {
    const k = `${a[0]},${a[1]}`;
    let l = edges.get(k);
    if (!l) edges.set(k, (l = []));
    l.push(b);
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoad(x, y)) continue;
      if (!isRoad(x, y - 1)) add([x, y], [x + 1, y]);
      if (!isRoad(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!isRoad(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!isRoad(x - 1, y)) add([x, y + 1], [x, y]);
    }
  }
  const loops: Pt[][] = [];
  while (edges.size > 0) {
    const first = edges.entries().next().value as [string, Pt[]];
    const start = first[0].split(",").map(Number) as Pt;
    let cur = start;
    const pts: Pt[] = [start];
    for (let guard = 0; guard < 100000; guard += 1) {
      const k = `${cur[0]},${cur[1]}`;
      const list = edges.get(k);
      if (!list || list.length === 0) break;
      const next = list.shift() as Pt;
      if (list.length === 0) edges.delete(k);
      if (next[0] === start[0] && next[1] === start[1]) break;
      pts.push(next);
      cur = next;
    }
    const v = pts.filter((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[(i + 1) % pts.length];
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
    });
    if (v.length >= 3) loops.push(v);
  }
  return loops;
}

function roadPath(loops: Pt[][], input: RoadInput): Path2D {
  const { isRoad, scale: S } = input;
  const nbrs = (x: number, y: number): boolean[] => [isRoad(x, y - 1), isRoad(x + 1, y), isRoad(x, y + 1), isRoad(x - 1, y)];
  const path = new Path2D();
  for (const P of loops) {
    const n = P.length;
    const px = (p: Pt): Pt => [p[0] * TILE * S, p[1] * TILE * S];
    const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(px(P[n - 1]), px(P[0]));
    path.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i += 1) {
      const a = P[(i + n - 1) % n];
      const v = P[i];
      const b = P[(i + 1) % n];
      const d1 = [Math.sign(v[0] - a[0]), Math.sign(v[1] - a[1])];
      const d2 = [Math.sign(b[0] - v[0]), Math.sign(b[1] - v[1])];
      const cross = d1[0] * d2[1] - d1[1] * d2[0]; // > 0: right turn = convex corner of the road region
      let r = 0;
      if (cross > 0) {
        const tx = Math.floor(v[0] - 0.5 * d1[0] + 0.5 * d2[0]);
        const ty = Math.floor(v[1] - 0.5 * d1[1] + 0.5 * d2[1]);
        const [u, rt, dn, l] = nbrs(tx, ty);
        const count = Number(u) + Number(rt) + Number(dn) + Number(l);
        // exactly two perpendicular neighbours = a bend; the corner opposite to them is its outer corner
        r = count === 2 && !((u && dn) || (l && rt)) ? BEND_RADIUS : 0;
      }
      const V = px(v);
      const m = mid(V, px(b));
      if (r > 0) path.arcTo(V[0], V[1], m[0], m[1], r * S);
      else {
        path.lineTo(V[0], V[1]);
        path.lineTo(m[0], m[1]);
      }
    }
    path.closePath();
  }
  return path;
}

/** The measured asphalt noise (values 66..76), upscaled 4x with bilinear filtering so it stays soft at zoom like the bitmap. */
let grain: HTMLCanvasElement | undefined;
function grainCanvas(): HTMLCanvasElement {
  if (grain) return grain;
  const hist: Array<[number, number]> = [[66, 114], [67, 184], [68, 248], [69, 232], [70, 200], [71, 200], [72, 158], [73, 130], [74, 196], [75, 153], [76, 65]];
  const total = hist.reduce((a, [, c]) => a + c, 0);
  const base = document.createElement("canvas");
  base.width = base.height = 128;
  const c = base.getContext("2d")!;
  const id = c.createImageData(128, 128);
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < id.data.length; i += 4) {
    let r = rnd() * total;
    let v = 70;
    for (const [val, cnt] of hist) {
      r -= cnt;
      if (r < 0) {
        v = val;
        break;
      }
    }
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  const big = document.createElement("canvas");
  big.width = big.height = 512;
  const bc = big.getContext("2d")!;
  bc.imageSmoothingEnabled = true;
  bc.imageSmoothingQuality = "high";
  bc.drawImage(base, 0, 0, 512, 512);
  return (grain = big);
}

/** Which tile sides [up, right, down, left] carry the lane line. */
function laneSides(input: RoadInput, x: number, y: number): number[] {
  const t = input.tileIndex(x, y);
  if (t === 1) return [0, 1, 0, 1];
  if (t === 2) return [1, 0, 1, 0];
  const n = [input.isRoad(x, y - 1), input.isRoad(x + 1, y), input.isRoad(x, y + 1), input.isRoad(x - 1, y)];
  const c = n.filter(Boolean).length;
  if (c === 2) return n.map((v) => (v ? 1 : 0));
  if (c === 1) {
    const k = n.indexOf(true);
    const o = [0, 0, 0, 0];
    o[k] = 1;
    o[(k + 2) % 4] = 1; // dead end: the line runs to the end of the tile
    return o;
  }
  if (c === 3) return n.indexOf(false) % 2 === 0 ? [0, 1, 0, 1] : [1, 0, 1, 0]; // T junction: the through street keeps its line
  if (c === 4) return [1, 1, 1, 1];
  return [0, 0, 0, 0];
}

/** Renders every chunk that contains (or touches) road tiles. */
export function renderRoadChunks(input: RoadInput): RoadChunk[] {
  const { cols, rows, isRoad, tileIndex, scale: S, chunk: CH } = input;
  const roads: Pt[] = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) if (isRoad(x, y)) roads.push([x, y]);
  if (roads.length === 0) return [];
  const path = roadPath(outlineLoops(input), input);
  const T = TILE * S;
  const chunkPx = CH * T;
  const chunks = new Map<number, RoadChunk>();
  const need = new Set<number>();
  for (const [x, y] of roads) {
    // a road tile can paint up to one tile beyond itself (dashes spill 3.7 px into the neighbour)
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) need.add(Math.floor((y + dy) / CH) * 1000 + Math.floor((x + dx) / CH));
  }
  const pattern = (ctx: CanvasRenderingContext2D): CanvasPattern => {
    const p = ctx.createPattern(grainCanvas(), "repeat")!;
    p.setTransform(new DOMMatrix([S / 4, 0, 0, S / 4, 0, 0]));
    return p;
  };
  for (const key of need) {
    const cx = key % 1000;
    const cy = Math.floor(key / 1000);
    if (cx < 0 || cy < 0) continue;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.ceil(chunkPx);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.translate(-cx * chunkPx, -cy * chunkPx);
    ctx.imageSmoothingEnabled = true;
    const asphalt = pattern(ctx);
    ctx.fillStyle = asphalt;
    ctx.fill(path);
    // curbs: strokes centred on the edge, clipped to the road, widest first (4 px, 3 px, 2 px, 1 px deep)
    ctx.save();
    ctx.clip(path);
    ctx.lineJoin = "round";
    for (const [w, col] of [[8, "#3f3f3f"], [6, "#999999"], [4, "#555555"], [2, "#2e2e2e"]] as const) {
      ctx.lineWidth = w * S;
      ctx.strokeStyle = col;
      ctx.stroke(path);
    }
    // street ends stay open: paint the asphalt back over the curb across a dead-end tile (between the two side curbs)
    ctx.fillStyle = asphalt;
    for (const [x, y] of roads) {
      const n = [isRoad(x, y - 1), isRoad(x + 1, y), isRoad(x, y + 1), isRoad(x - 1, y)];
      if (n.filter(Boolean).length !== 1) continue;
      const X = x * T;
      const Y = y * T;
      const k = n.indexOf(true);
      if (k === 3) ctx.fillRect(X + 28 * S, Y + 4 * S, 4 * S, 24 * S);
      else if (k === 1) ctx.fillRect(X, Y + 4 * S, 4 * S, 24 * S);
      else if (k === 2) ctx.fillRect(X + 4 * S, Y, 24 * S, 4 * S);
      else ctx.fillRect(X + 4 * S, Y + 28 * S, 24 * S, 4 * S);
    }
    ctx.restore();
    // crosswalks (tileset tiles 1 and 2), then the lane line
    ctx.fillStyle = "#c2c2c2";
    for (const [x, y] of roads) {
      const t = tileIndex(x, y);
      if (t !== 1 && t !== 2) continue;
      const X = x * T;
      const Y = y * T;
      for (let k = 0; k < 5; k += 1) {
        const o = 5 + k * 5;
        if (t === 2) ctx.fillRect(X + o * S, Y + 10 * S, 2 * S, 10 * S);
        else ctx.fillRect(X + 10 * S, Y + o * S, 10 * S, 2 * S);
      }
    }
    ctx.strokeStyle = "#c2c2c2";
    const th = S;
    const len = DASH * S;
    const side = (x: number, y: number): number[] => laneSides(input, x, y);
    for (const [x, y] of roads) {
      const sd = side(x, y);
      const n = sd[0] + sd[1] + sd[2] + sd[3];
      const X = x * T;
      const Y = y * T;
      const t = tileIndex(x, y);
      if (t !== 1 && t !== 2) {
        const bend = n === 2 && !(sd[3] && sd[1]) && !(sd[0] && sd[2]);
        if (!bend && n !== 4) { // a four-way crossing keeps only the dashes at its edges (tileset tile 78 has no centre dash)
          if (sd[3] && sd[1]) ctx.fillRect(X + 12 * S, Y + 15 * S, len, th);
          if (sd[0] && sd[2]) ctx.fillRect(X + 16 * S, Y + 12 * S, th, len);
        } else if (bend) {
          // bend: arms + arc add up to the length of every other dash, corner at (16.5, 15.5)
          const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]];
          const [A, B] = [0, 1, 2, 3].filter((k) => sd[k]).map((k) => dir[k]);
          const r = LANE_RADIUS * S;
          const a = Math.max(0, (DASH - (Math.PI / 2) * LANE_RADIUS) / 2) * S;
          const ox = X + 16.5 * S;
          const oy = Y + 15.5 * S;
          ctx.lineWidth = th;
          ctx.lineCap = "butt";
          ctx.beginPath();
          ctx.moveTo(ox + A[0] * (r + a), oy + A[1] * (r + a));
          ctx.lineTo(ox + A[0] * r, oy + A[1] * r);
          ctx.arcTo(ox, oy, ox + B[0] * r, oy + B[1] * r, r);
          ctx.lineTo(ox + B[0] * (r + a), oy + B[1] * (r + a));
          ctx.stroke();
        }
      }
      // dashes that straddle the tile edge towards the right / lower neighbour
      if (isRoad(x + 1, y) && (sd[1] || side(x + 1, y)[3])) ctx.fillRect(X + 28 * S, Y + 15 * S, len, th);
      if (isRoad(x, y + 1) && (sd[2] || side(x, y + 1)[0])) ctx.fillRect(X + 16 * S, Y + 28 * S, th, len);
    }
    chunks.set(key, { cx, cy, canvas });
  }
  return [...chunks.values()];
}
