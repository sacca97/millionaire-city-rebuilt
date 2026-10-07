/**
 * ProgressBar, port of DCFillBar: a clip with `bar_size` (bounding box, gives max width) and `bar` (stretched horizontally).
 * width = 1 + (v - min) * (maxW - 1) / (max - min); animated at 0.1 px/ms while growing, instant when shrinking.
 */
import type { Part } from './widget';
import { localBounds } from './widget';

export const FILL_ANIMATION_SPEED = 0.1;
export const FILL_MIN_WIDTH = 1;

/** Pure: target pixel width for a value (DCFillBar.setValue). */
export function fillWidth(value: number, min: number, max: number, maxWidth: number): number {
  const v = Math.max(min, Math.min(max, value));
  if (max === min) return FILL_MIN_WIDTH;
  return FILL_MIN_WIDTH + ((v - min) * (maxWidth - FILL_MIN_WIDTH)) / (max - min);
}

export class ProgressBar {
  private target = FILL_MIN_WIDTH;
  private current = FILL_MIN_WIDTH;
  private value = 0;
  private maxWidth: number;
  private barW0: number;
  private bar: Part;
  private raf = 0;

  constructor(container: Part, private min = 0, private max = 1) {
    const box = container.get('bar_size');
    this.bar = container.get('bar');
    const sb = localBounds(box.node, true);
    this.maxWidth = sb ? (sb[2] - sb[0]) * Math.abs(box.node.scaleX || 1) : 100;
    const bb = localBounds(this.bar.node, true);
    this.barW0 = bb ? bb[2] - bb[0] : 1;
    box.hide(); // bounding box is invisible in the original (alpha 0)
    this.setValue(0, false);
  }

  setRange(min: number, max: number): this {
    this.min = min;
    this.max = max;
    return this.setValue(this.value, false);
  }

  /** animate=false -> setValueWithoutBarAnimation. */
  setValue(v: number, animate = true): this {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this.target = fillWidth(this.value, this.min, this.max, this.maxWidth);
    if (!animate || this.target < this.current) this.apply(this.target);
    else this.startAnim();
    return this;
  }

  /** Advance the grow animation by dt ms (DCFillBar.logicUpdate). Called by the internal rAF loop. */
  tick(dtMs: number): boolean {
    if (this.current < this.target) {
      const step = dtMs * FILL_ANIMATION_SPEED;
      this.apply(this.current + step > this.target || step === 0 ? this.target : this.current + step);
    }
    return this.current < this.target;
  }

  private startAnim(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') {
      if (typeof requestAnimationFrame === 'undefined') this.apply(this.target);
      return;
    }
    let last = performance.now();
    const loop = (now: number) => {
      this.raf = 0;
      if (this.tick(now - last)) this.raf = requestAnimationFrame(loop);
      last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  private apply(w: number): void {
    this.current = w;
    const m = this.bar.node.matrix;
    this.bar.setMatrix([w / this.barW0, m[1], m[2], m[3], m[4], m[5]]);
  }
  get widthPx(): number {
    return this.current;
  }
  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}
