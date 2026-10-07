/**
 * Pixi-agnostic reader for the GUI layouts written by tools/export_gui.py
 * (apps/client/public/gui/<swf>/layout.json). Units are pixels.
 */

export type Matrix = [number, number, number, number, number, number]; // a b c d tx ty (Flash order)
export type Rect = [number, number, number, number]; // x0 y0 x1 y1

export interface ColorTransform {
  mult?: number[]; // r g b a multipliers
  add?: number[]; // r g b a offsets (0..255)
}

export interface FilterDef {
  type: string; // dropshadow | glow | colormatrix | blur | bevel ...
  [key: string]: unknown;
}

/** One placed object on a frame's display list (depth-ordered, back to front). */
export interface Placement {
  d: number;
  ref?: number;
  n?: string;
  m?: Matrix;
  ct?: ColorTransform;
  f?: FilterDef[];
  clip?: number; // this object is a mask for depths (d, clip]
  bm?: number;
  vis?: false;
}

export interface ShapeSymbol {
  t: 'shape';
  bounds: Rect;
  png: string | null;
}
export interface TextSymbol {
  t: 'text';
  bounds: Rect;
  font?: string;
  size: number;
  color: string;
  align: 'left' | 'right' | 'center' | 'justify';
  text: string;
  html?: string;
  multiline: boolean;
  wordWrap: boolean;
  input: boolean;
  autoSize: boolean;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  leading?: number;
  variable?: string;
}
export interface SpriteSymbol {
  t: 'sprite';
  /** frames[i] === 0 means "same as the previous frame". */
  frames: (Placement[] | 0)[];
  labels?: Record<string, number>; // label -> frame index (0-based)
  bounds?: Rect;
  /** Button-style clip: frames labelled UpState/OverState/DownState/(HitState). */
  button?: true;
  /** Composited preview PNGs: <png><n>.png, n = 1..pngFrames (offset = bounds min). */
  png?: string;
  pngFrames?: number;
}
export interface OtherSymbol {
  t: 'morph' | 'statictext' | 'button2';
  bounds?: Rect;
}
export type Symbol = ShapeSymbol | TextSymbol | SpriteSymbol | OtherSymbol;

export interface GuiLayout {
  swf: string;
  frameRate: number;
  stage: Rect;
  fonts: string[];
  classes: Record<string, number>;
  symbols: Record<string, Symbol>;
  root: SpriteSymbol;
}

export type NodeKind = 'sprite' | 'button' | 'shape' | 'text' | 'unknown';

export interface GuiNode {
  /** Instance name ('' if unnamed). */
  name: string;
  kind: NodeKind;
  symbolId?: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Radians. */
  rotation: number;
  matrix: Matrix;
  visible: boolean;
  alpha: number;
  colorTransform?: ColorTransform;
  filters?: FilterDef[];
  blendMode?: number;
  /** If set, this node is a mask covering the next `maskDepthCount` siblings' depths. */
  maskUntilDepth?: number;
  depth: number;
  texture?: { path: string; x: number; y: number; w: number; h: number };
  text?: TextSymbol;
  /** Frame labels of this sprite (label -> 0-based frame). */
  labels?: Record<string, number>;
  frame: number;
  frameCount: number;
  children: GuiNode[];
  /** For buttons: instantiated state frames keyed by lower-case label ('up','over','down','hit'). */
  states?: Record<string, GuiNode[]>;
}

export interface InstantiateOptions {
  /** Base URL of the swf folder (e.g. '/gui/hud'). Default ''. */
  baseUrl?: string;
  /** Frame index (0-based) or label to show for the root sprite. Default 0. */
  frame?: number | string;
  /** Recursion cap. */
  maxDepth?: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export async function loadLayout(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<GuiLayout> {
  const res = await fetchFn(`${baseUrl}/layout.json`);
  if (!res.ok) throw new Error(`layout ${baseUrl}: HTTP ${res.status}`);
  return (await res.json()) as GuiLayout;
}

/** Resolve a (possibly deduped) frame to its placement list. */
export function frameAt(sprite: SpriteSymbol, frame: number): Placement[] {
  let i = Math.max(0, Math.min(frame, sprite.frames.length - 1));
  while (i > 0 && sprite.frames[i] === 0) i--;
  const f = sprite.frames[i];
  return f === 0 ? [] : f;
}

export function resolveFrame(sprite: SpriteSymbol, frame: number | string | undefined): number {
  if (typeof frame === 'string') return sprite.labels?.[frame] ?? 0;
  return frame ?? 0;
}

function decompose(m: Matrix) {
  const [a, b, c, d, tx, ty] = m;
  return {
    x: tx,
    y: ty,
    scaleX: Math.hypot(a, b),
    scaleY: Math.sign(a * d - b * c || 1) * Math.hypot(c, d),
    rotation: Math.atan2(b, a),
  };
}

function makeNode(p: Placement, kind: NodeKind, symbolId?: number): GuiNode {
  const matrix = p.m ?? IDENTITY;
  const dc = decompose(matrix);
  const ct = p.ct;
  return {
    name: p.n ?? '',
    kind,
    symbolId,
    ...dc,
    matrix,
    visible: p.vis !== false,
    alpha: ct?.mult ? ct.mult[3] ?? 1 : 1,
    colorTransform: ct,
    filters: p.f,
    blendMode: p.bm,
    maskUntilDepth: p.clip,
    depth: p.d,
    frame: 0,
    frameCount: 1,
    children: [],
  };
}

function build(layout: GuiLayout, p: Placement, opts: Required<InstantiateOptions>, depth: number): GuiNode {
  const id = p.ref;
  const sym = id === undefined ? undefined : layout.symbols[String(id)];
  if (!sym || depth > opts.maxDepth) return makeNode(p, 'unknown', id);
  switch (sym.t) {
    case 'shape': {
      const n = makeNode(p, 'shape', id);
      if (sym.png) {
        const [x0, y0, x1, y1] = sym.bounds;
        n.texture = { path: `${opts.baseUrl}/${sym.png}`, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      return n;
    }
    case 'text': {
      const n = makeNode(p, 'text', id);
      n.text = sym;
      return n;
    }
    case 'sprite':
      return buildSprite(layout, sym, p, opts, depth, 0, id);
    default:
      return makeNode(p, 'unknown', id);
  }
}

function buildSprite(
  layout: GuiLayout,
  sym: SpriteSymbol,
  p: Placement,
  opts: Required<InstantiateOptions>,
  depth: number,
  frame: number,
  id?: number,
): GuiNode {
  const n = makeNode(p, sym.button ? 'button' : 'sprite', id);
  n.labels = sym.labels;
  n.frameCount = sym.frames.length;
  const fill = (fr: number) => frameAt(sym, fr).map((c) => build(layout, c, opts, depth + 1));
  if (sym.button) {
    n.states = {};
    for (const [label, idx] of Object.entries(sym.labels ?? {})) {
      n.states[label.replace(/State$/i, '').toLowerCase()] = fill(idx);
    }
    n.children = n.states['up'] ?? fill(0);
  } else {
    n.frame = frame;
    n.children = fill(frame);
  }
  return n;
}

/**
 * Instantiate an exported class (name or symbol id) into a tree of plain nodes.
 * The returned node's own matrix is identity.
 */
export function instantiate(layout: GuiLayout, ref: string | number, options: InstantiateOptions = {}): GuiNode {
  const opts: Required<InstantiateOptions> = { baseUrl: '', frame: 0, maxDepth: 24, ...options };
  const id = typeof ref === 'number' ? ref : layout.classes[ref];
  const sym = id === undefined ? undefined : layout.symbols[String(id)];
  if (!sym) throw new Error(`unknown GUI symbol: ${String(ref)}`);
  const p: Placement = { d: 0, ref: id };
  if (sym.t === 'sprite') return buildSprite(layout, sym, p, opts, 0, resolveFrame(sym, opts.frame), id);
  return build(layout, p, opts, 0);
}

/** Instantiate the SWF main timeline. */
export function instantiateRoot(layout: GuiLayout, options: InstantiateOptions = {}): GuiNode {
  const opts: Required<InstantiateOptions> = { baseUrl: '', frame: 0, maxDepth: 24, ...options };
  return buildSprite(layout, layout.root, { d: 0 }, opts, 0, resolveFrame(layout.root, opts.frame));
}

/** Depth-first lookup of a descendant by instance name ('a.b' paths allowed). */
export function findByName(node: GuiNode, path: string): GuiNode | undefined {
  const [head, ...rest] = path.split('.');
  for (const c of node.children) {
    if (c.name === head) return rest.length ? findByName(c, rest.join('.')) : c;
  }
  for (const c of node.children) {
    if (!c.name) {
      const r = findByName(c, path);
      if (r) return r;
    }
  }
  return undefined;
}

export function* walk(node: GuiNode): Generator<GuiNode> {
  yield node;
  for (const c of node.children) yield* walk(c);
}

/** URL of a class's pre-composited preview PNG frame (1-based), with the offset to draw it at. */
export function classPreview(layout: GuiLayout, cls: string, baseUrl = '', frame = 1) {
  const id = layout.classes[cls];
  const s = id === undefined ? undefined : layout.symbols[String(id)];
  if (!s || s.t !== 'sprite' || !s.png || !s.bounds) return undefined;
  return { path: `${baseUrl}/${s.png}${frame}.png`, x: s.bounds[0], y: s.bounds[1] };
}
