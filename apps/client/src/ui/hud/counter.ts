/**
 * Animated number counter for the HUD coin/gold/XP fields. HudOwner keeps mCoinsCounter/mExpCounter with
 * INCREMENT_TIME = 500 ms (HudOwner.as:~150): displayed values run towards the real value instead of jumping.
 * Pure (no DOM): the caller feeds dt and renders `value`.
 */
export const INCREMENT_TIME = 500;

export class Counter {
  private from: number;
  private to: number;
  private elapsed = INCREMENT_TIME;
  /** Currently displayed (integer) value. */
  value: number;

  constructor(initial = 0, private readonly duration = INCREMENT_TIME) {
    this.value = this.from = this.to = initial;
  }

  get target(): number {
    return this.to;
  }
  get running(): boolean {
    return this.value !== this.to;
  }

  /** Set a new target; animate=false jumps. Retargeting mid-animation starts from the currently shown value. */
  set(target: number, animate = true): void {
    this.from = this.value;
    this.to = target;
    this.elapsed = animate ? 0 : this.duration;
    if (!animate) this.value = target;
  }

  /** Advance by dt ms. Returns true when the displayed value changed. */
  tick(dtMs: number): boolean {
    if (!this.running) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + dtMs);
    const k = this.elapsed / this.duration;
    const next = k >= 1 ? this.to : Math.trunc(this.from + (this.to - this.from) * k);
    const changed = next !== this.value;
    this.value = next;
    return changed;
  }
}
