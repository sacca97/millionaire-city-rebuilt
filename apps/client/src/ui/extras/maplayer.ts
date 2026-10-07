// Additive DOM overlay that follows the Pixi world camera (translate + scale of CityView.world) so extras can put clips
// (bubbles, plane) in world pixels without touching view/city.ts. Sits below popups (z-index 1000+), ignores the pointer.
import type { UiContext } from '../context';

let holder: HTMLElement | undefined;
let size: { w: number; h: number } | undefined;
type WorldRect = { left: number; top: number; right: number; bottom: number };
const frameListeners = new Set<(r: WorldRect) => void>();

/** Called every animation frame (after the overlay transform follows the camera) with the visible world rectangle. Returns an unsubscribe. */
export function onMapFrame(fn: (r: WorldRect) => void): () => void {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

export function mapHolder(ctx: UiContext): HTMLElement {
  if (holder) return holder;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5';
  holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0';
  layer.appendChild(holder);
  ctx.root.appendChild(layer);
  const h = holder;
  let lastTransform = '';
  const follow = (): void => {
    const w = ctx.city.world;
    const t = `translate(${w.x}px,${w.y}px) scale(${w.scale.x})`;
    if (t !== lastTransform) {
      lastTransform = t;
      h.style.transform = t;
    }
    if (frameListeners.size > 0) {
      const r = visibleWorldRect(ctx);
      for (const fn of frameListeners) fn(r);
    }
    requestAnimationFrame(follow);
  };
  new ResizeObserver(() => (size = undefined)).observe(ctx.root);
  follow();
  return holder;
}

/** World-space rectangle currently visible on screen (world px). */
export function visibleWorldRect(ctx: UiContext): { left: number; top: number; right: number; bottom: number } {
  const w = ctx.city.world;
  const k = w.scale.x;
  // clientWidth/Height force a synchronous layout; cache them (invalidated by a ResizeObserver on the root).
  size ??= { w: ctx.root.clientWidth || window.innerWidth, h: ctx.root.clientHeight || window.innerHeight };
  const width = size.w;
  const height = size.h;
  return { left: -w.x / k, top: -w.y / k, right: (width - w.x) / k, bottom: (height - w.y) / k };
}
