// DOM layer that follows the map camera: world (tile) coordinates -> screen, used by the economy overlays
// (no-road icons, influence areas, population badges, floating income text). The Pixi stage is the sibling canvas; the camera is
// `ctx.city.world` (position + uniform scale), exactly what hud/infobox.ts uses.
import { TILE } from "../../game/geometry";
import type { UiContext } from "../context";

export class MapLayer {
  readonly el: HTMLElement;
  private readonly frames = new Set<() => void>();
  private raf = 0;

  constructor(private readonly ctx: UiContext) {
    this.el = document.createElement("div");
    this.el.className = "mc-economy-layer";
    this.el.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:30";
    ctx.root.append(this.el);
    const loop = (): void => {
      for (const fn of this.frames) fn();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Called every animation frame (positions follow pan/zoom). */
  onFrame(fn: () => void): () => void {
    this.frames.add(fn);
    return () => this.frames.delete(fn);
  }

  get scale(): number {
    return this.ctx.city.world.scale.x;
  }

  /** Screen position (px, relative to the overlay) of an absolute tile coordinate (fractions allowed). */
  screen(tx: number, ty: number): { x: number; y: number } {
    const w = this.ctx.city.world;
    const k = w.scale.x;
    return { x: w.x + tx * TILE * k, y: w.y + ty * TILE * k };
  }

  /** Position/size an absolutely positioned element over a tile rectangle. */
  placeRect(el: HTMLElement, x0: number, y0: number, cols: number, rows: number): void {
    const p = this.screen(x0, y0);
    const k = this.scale;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${cols * TILE * k}px`;
    el.style.height = `${rows * TILE * k}px`;
  }

  /** Put an element whose origin is its anchor (icon widgets) at a tile point, scaled with the map. */
  placePoint(el: HTMLElement, tx: number, ty: number, offsetY = 0): void {
    const p = this.screen(tx, ty);
    const k = this.scale;
    el.style.transform = `translate(${p.x}px,${p.y + offsetY * k}px) scale(${k})`;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
