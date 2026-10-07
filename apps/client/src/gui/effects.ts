/**
 * Flash display-object effects -> CSS.
 *  - dropshadow / glow  -> CSS filter drop-shadow() (stacked for Flash "strength"), distance 0 + strength>1 gives the hard text outline look
 *  - blur               -> CSS blur()
 *  - colormatrix / colour transform -> SVG feColorMatrix referenced by filter:url(#id) (defs injected on demand)
 *  - clip depth masks   -> CSS mask-image (translate/scale masks) or clip-path polygon fallback
 * Unsupported (ignored): knockout, innerShadow/innerGlow, hideObject, bevel/gradient filters, rotated alpha masks (rect fallback),
 * additive colour offsets on alpha, blend modes other than normal/add/multiply/screen/overlay/darken/lighten/difference.
 */
import type { ColorTransform, FilterDef, Matrix, Rect } from './layout';

export type FilterDefs = Map<string, string>; // id -> <filter> markup

const f = (n: number) => +n.toFixed(3);

function rgba(c: unknown): string {
  // layout stores colours as ['#rrggbb', alpha]
  const [hex, a] = Array.isArray(c) ? (c as [string, number]) : [String(c ?? '#000000'), 1];
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${a ?? 1})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${f(a ?? 1)})`;
}

function stableId(prefix: string, values: number[]): string {
  let h = 5381;
  for (const v of values) h = ((h * 33) ^ Math.round(v * 1000)) >>> 0;
  return `${prefix}${h.toString(36)}`;
}

/** Register an feColorMatrix filter (4x5 row-major, offsets in 0..255 as Flash stores them) and return its CSS reference. */
export function colorMatrixFilter(matrix: number[], defs: FilterDefs): string {
  const id = stableId('cm', matrix);
  if (!defs.has(id)) {
    const vals = matrix.map((v, i) => (i % 5 === 4 ? f(v / 255) : f(v))).join(' ');
    defs.set(id, `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="${vals}"/></filter>`);
  }
  return `url(#${id})`;
}

/** Number of stacked drop-shadows approximating Flash strength (alpha gain). */
export function shadowRepeats(strength: number): number {
  if (!(strength > 1)) return 1;
  return Math.min(4, Math.ceil(strength / 2));
}

/** CSS filter list for Flash filters. Returns '' if nothing is representable. */
export function filtersToCss(filters: FilterDef[] | undefined, defs: FilterDefs): string {
  if (!filters?.length) return '';
  const out: string[] = [];
  for (const fl of filters) {
    switch (fl.type) {
      case 'dropshadow':
      case 'glow': {
        if (fl.innerShadow || fl.innerGlow || fl.knockout) break;
        const isGlow = fl.type === 'glow';
        const dist = isGlow ? 0 : Number(fl.distance ?? 0);
        const ang = Number(fl.angle ?? 0);
        const dx = f(Math.cos(ang) * dist);
        const dy = f(Math.sin(ang) * dist);
        // Flash blurX is the box-blur extent (3 passes ~ gaussian with sd ~ extent / 3); CSS drop-shadow takes the sd directly.
        // Oracle: the hard outline of strength>=4 text (blur 2 on buttons/card titles, blur 3 on the HUD) has the same ~2 px
        // thickness, so those shadows never go below sd 1.
        const sd = Math.max(Number(fl.blurX ?? 0), Number(fl.blurY ?? 0)) / 3;
        const blur = f(Number(fl.strength ?? 1) >= 4 && sd > 0 ? Math.max(1, sd) : sd);
        const strength = Number(fl.strength ?? 1);
        let color = rgba(isGlow ? fl.glowColor : fl.dropShadowColor);
        if (strength < 1) {
          const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(color);
          if (m) color = `rgba(${m[1]},${m[2]},${m[3]},${f(Number(m[4]) * strength)})`;
        }
        const one = `drop-shadow(${dx}px ${dy}px ${blur}px ${color})`;
        for (let i = shadowRepeats(strength); i > 0; i--) out.push(one);
        break;
      }
      case 'blur': {
        const b = Math.max(Number(fl.blurX ?? 0), Number(fl.blurY ?? 0));
        if (b > 0) out.push(`blur(${f(b / 2)}px)`);
        break;
      }
      case 'colormatrix': {
        const m = fl.matrix as number[] | undefined;
        if (m && m.length === 20) out.push(isIdentityMatrix(m) ? '' : isGrayscale(m) ? 'grayscale(1)' : colorMatrixFilter(m, defs));
        break;
      }
      default:
        break;
    }
  }
  return out.filter(Boolean).join(' ');
}

const IDENT = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
export const isIdentityMatrix = (m: number[]) => m.every((v, i) => Math.abs(v - IDENT[i]) < 1e-4);
export function isGrayscale(m: number[]): boolean {
  // saturation(0) matrix: identical luminance rows, alpha untouched
  return (
    Math.abs(m[0] - m[5]) < 1e-3 && Math.abs(m[5] - m[10]) < 1e-3 && Math.abs(m[1] - m[6]) < 1e-3 && Math.abs(m[6] - m[11]) < 1e-3 &&
    Math.abs(m[2] - m[7]) < 1e-3 && Math.abs(m[7] - m[12]) < 1e-3 && Math.abs(m[3]) + Math.abs(m[8]) + Math.abs(m[13]) < 1e-3 &&
    Math.abs(m[4]) + Math.abs(m[9]) + Math.abs(m[14]) < 1e-3 && Math.abs(m[18] - 1) < 1e-3 && Math.abs(m[0] + m[1] + m[2] - 1) < 5e-3
  );
}

/** Colour transform -> opacity + optional SVG filter. */
export function colorTransformToCss(ct: ColorTransform | undefined, defs: FilterDefs): { opacity?: number; filter?: string } {
  if (!ct) return {};
  const m = ct.mult ?? [1, 1, 1, 1];
  const a = ct.add ?? [0, 0, 0, 0];
  const res: { opacity?: number; filter?: string } = {};
  const alpha = Math.max(0, Math.min(1, (m[3] ?? 1) + (a[3] ?? 0) / 255));
  if (alpha !== 1) res.opacity = f(alpha);
  const rgbIdentity = [0, 1, 2].every((i) => Math.abs((m[i] ?? 1) - 1) < 1e-3 && Math.abs(a[i] ?? 0) < 0.5);
  if (!rgbIdentity) {
    const mat = [m[0], 0, 0, 0, a[0], 0, m[1], 0, 0, a[1], 0, 0, m[2], 0, a[2], 0, 0, 0, 1, 0];
    res.filter = colorMatrixFilter(mat, defs);
  }
  return res;
}

let svgHost: SVGSVGElement | undefined;
const installed = new Set<string>();
/** Inject pending filter defs into a hidden <svg> in the document (idempotent). */
export function installFilterDefs(defs: FilterDefs, doc: Document = document): void {
  const fresh = [...defs].filter(([id]) => !installed.has(id));
  if (!fresh.length) return;
  if (!svgHost || !svgHost.isConnected) {
    svgHost = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgHost.setAttribute('width', '0');
    svgHost.setAttribute('height', '0');
    svgHost.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    doc.body.appendChild(svgHost);
    installed.clear();
    for (const [id] of defs) if (!fresh.some(([i]) => i === id)) installed.add(id);
  }
  svgHost.insertAdjacentHTML('beforeend', fresh.map(([, markup]) => markup).join(''));
  for (const [id] of fresh) installed.add(id);
}

/** Process-wide defs registry used by the DOM renderer. */
export const globalFilterDefs: FilterDefs = new Map();

// ---- masks ----

export function mulMatrix(p: Matrix, c: Matrix): Matrix {
  // result = p * c (apply c first, then p); Flash order [a b c d tx ty]
  return [
    p[0] * c[0] + p[2] * c[1],
    p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3],
    p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4],
    p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}

export interface MaskSource {
  url: string;
  /** texture rect in its shape's local space */
  tex: { x: number; y: number; w: number; h: number };
  /** shape local -> parent-of-group coordinates */
  matrix: Matrix;
}

/** CSS declarations for a mask given its source (alpha-accurate when the matrix has no rotation/skew, else rect clip-path). */
export function maskCss(src: MaskSource): string {
  const [a, b, c, d, tx, ty] = src.matrix;
  const { x, y, w, h } = src.tex;
  if (Math.abs(b) < 1e-4 && Math.abs(c) < 1e-4 && a > 0 && d > 0) {
    const mx = f(tx + x * a);
    const my = f(ty + y * d);
    return `-webkit-mask:url(${src.url}) ${mx}px ${my}px/${f(w * a)}px ${f(h * d)}px no-repeat;mask:url(${src.url}) ${mx}px ${my}px/${f(w * a)}px ${f(h * d)}px no-repeat;-webkit-mask-clip:no-clip;mask-clip:no-clip;`;
  }
  const pts = ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][])
    .map(([px, py]) => `${f(a * px + c * py + tx)}px ${f(b * px + d * py + ty)}px`)
    .join(',');
  return `clip-path:polygon(${pts});`;
}

/**
 * Axis-aligned masks: a group element needs a real box covering the mask rect, otherwise Chromium paints the content of a
 * 0x0 group unmasked (mask-clip applies to the element's box). Returns the box in parent coordinates, or null for the
 * clip-path fallback. The group's children must be shifted by (-x,-y).
 */
export function maskBox(src: MaskSource): { x: number; y: number; w: number; h: number; css: string } | null {
  const [a, b, c, d, tx, ty] = src.matrix;
  if (!(Math.abs(b) < 1e-4 && Math.abs(c) < 1e-4 && a > 0 && d > 0)) return null;
  const x = f(tx + src.tex.x * a);
  const y = f(ty + src.tex.y * d);
  const w = f(src.tex.w * a);
  const h = f(src.tex.h * d);
  const m = `url(${src.url}) 0px 0px/${w}px ${h}px no-repeat`;
  return { x, y, w, h, css: `left:${x}px;top:${y}px;width:${w}px;height:${h}px;-webkit-mask:${m};mask:${m};` };
}

export function rectUnion(rs: Rect[]): Rect {
  return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
}

// Flash blendMode ids: 1 normal,2 layer,3 multiply,4 screen,5 lighten,6 darken,7 difference,8 add,9 subtract,10 invert,11 alpha,12 erase,13 overlay,14 hardlight
const FLASH_BLEND: Record<number, string> = { 3: 'multiply', 4: 'screen', 5: 'lighten', 6: 'darken', 7: 'difference', 8: 'plus-lighter', 13: 'overlay', 14: 'hard-light' };
export function blendModeCss(bm: number | undefined): string | undefined {
  return bm === undefined ? undefined : FLASH_BLEND[bm];
}
