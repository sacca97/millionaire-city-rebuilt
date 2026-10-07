/**
 * Item icons for the shop/storage cards: ItemDefinition.getIcon(holder): the `normal_new`/`normal` clip scaled to fit the
 * holder (ItemDefinition.as:865-935: scale = min((h-10)/clipH, (w-20)/clipW), never above 1) and centred in it.
 * Art comes from the exported sprite library (public/sprites/index.json), same data the city view uses.
 */
import type { Part } from '../../gui/widget';

interface SymbolInfo {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  frames: string[];
}
type Index = Record<string, Record<string, SymbolInfo>>;

let indexPromise: Promise<Index> | undefined;
function loadIndex(): Promise<Index> {
  indexPromise ??= fetch('/sprites/index.json').then((r) => (r.ok ? (r.json() as Promise<Index>) : {})).catch(() => ({}));
  return indexPromise;
}

/** Position/size of the icon inside a holder of w x h (pure; unit tested). */
export function fitIcon(holderW: number, holderH: number, clipW: number, clipH: number): { scale: number; x: number; y: number; w: number; h: number } {
  const sy = (holderH - 10) / clipH;
  const sx = (holderW - 20) / clipW;
  const scale = Math.min(1, sx > sy ? sy : sx);
  const w = clipW * scale;
  const h = clipH * scale;
  return { scale, x: (holderW - w) / 2, y: (holderH - h) / 2, w, h };
}

export const ICON_CLASS = 'shop-item-icon';

/** Draw the item art into `holder` (a named placeholder part such as `image` / `instance`). Resolves true when art was found. */
export async function setItemIcon(holder: Part, sku: string): Promise<boolean> {
  const idx = await loadIndex();
  // advisor-specific buildings (houses_037_001 Cake House) only exist as `<sku>_Cindy` / `<sku>_Ronald`
  const genre = String((globalThis as { __mcity?: { game?: { state?: { profile?: { raw?: Record<string, unknown> } } } } }).__mcity?.game?.state?.profile?.raw?.bossGenre ?? '0');
  const key = idx[sku] ? sku : idx[`${sku}_${genre === '1' ? 'Cindy' : 'Ronald'}`] ? `${sku}_${genre === '1' ? 'Cindy' : 'Ronald'}` : sku;
  const sym = idx[key]?.normal_new ?? idx[key]?.normal;
  const file = sym?.frames[0];
  if (!sym || !file) return false;
  const b = holder.bounds() ?? [0, 0, 130, 130];
  const f = fitIcon(b[2] - b[0], b[3] - b[1], sym.width, sym.height);
  holder.el.querySelector(`:scope > img.${ICON_CLASS}`)?.remove();
  const img = document.createElement('img');
  img.className = `${ICON_CLASS} g-tex`;
  img.src = `/sprites/${file}`;
  img.draggable = false;
  img.style.cssText = `position:absolute;left:${b[0] + f.x}px;top:${b[1] + f.y}px;width:${f.w}px;height:${f.h}px;pointer-events:none`;
  holder.el.appendChild(img);
  return true;
}

/** A DCResourceManager bitmap placed at a part's origin at natural size (the AS `new Bitmap(get("gold"))` at icon.x/icon.y). */
export function putBitmap(host: Part, url: string, at?: { x: number; y: number }): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'g-tex';
  img.src = url;
  img.draggable = false;
  img.style.cssText = `position:absolute;left:${at?.x ?? 0}px;top:${at?.y ?? 0}px;pointer-events:none`;
  host.el.appendChild(img);
  return img;
}

export const ICON_URL = {
  coins: '/mcity/0.501/Datas/button/common/cash.png',
  gold: '/mcity/0.501/Datas/button/common/gold.png',
  fbc: '/mcity/0.501/Datas/button/common/fbc.png',
} as const;
