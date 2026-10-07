// Timeline playback of an exported MovieClip class (the layout reader only draws one frame at a time).
// Each frame is a Widget instantiated with `frame`, cached lazily, and shown/hidden by display. Pure frame maths is exported for tests.
import { loadGui, Widget } from '../../gui/widget';
import type { GuiLayout, SpriteSymbol } from '../../gui/layout';

/**
 * Which 0-based frame is showing `elapsedMs` after gotoAndPlay(1) at `fps`. Looping wraps; otherwise it stays on the last frame.
 * `done` is true once a non-looping clip has played its last frame (Event.ENTER_FRAME `currentFrame >= totalFrames` checks).
 */
export function clipFrameAt(elapsedMs: number, fps: number, count: number, loop = false): { frame: number; done: boolean } {
  if (count <= 1) return { frame: 0, done: !loop };
  const raw = Math.max(0, Math.floor((elapsedMs * fps) / 1000));
  if (loop) return { frame: raw % count, done: false };
  return { frame: Math.min(raw, count - 1), done: raw >= count - 1 };
}

export interface ClipOptions {
  /** Called for each newly instantiated frame widget (set TextFields: Caption, name ...). */
  decorate?: (w: Widget, frame: number) => void;
  fps?: number;
  loop?: boolean;
}

export class ClipPlayer {
  readonly host = document.createElement('div');
  private frames = new Map<number, Widget>();
  private shown = -1;
  private raf = 0;
  private startAt = 0;
  private resolveDone?: () => void;
  private culled = false;

  private constructor(private layout: GuiLayout, private swf: string, private cls: string, readonly count: number, readonly fps: number, private opts: ClipOptions) {
    this.host.className = 'g-n';
    this.host.style.pointerEvents = 'none';
  }

  static async create(swf: string, cls: string, opts: ClipOptions = {}): Promise<ClipPlayer> {
    const layout = await loadGui(swf);
    const id = layout.classes[cls];
    const sym = layout.symbols[String(id)] as SpriteSymbol | undefined;
    if (!sym || sym.t !== 'sprite') throw new Error(`${swf}: no sprite class ${cls}`);
    return new ClipPlayer(layout, swf, cls, sym.frames.length, opts.fps ?? layout.frameRate ?? 24, opts);
  }

  /** Off-screen culling: a culled clip is hidden and stops swapping frames; it resumes at the right time-based frame when shown again. */
  setCulled(c: boolean): void {
    if (c === this.culled) return;
    this.culled = c;
    this.host.style.display = c ? 'none' : '';
  }

  /** Display frame i (0-based, clamped). */
  showFrame(i: number): void {
    const n = Math.max(0, Math.min(i, this.count - 1));
    if (n === this.shown) return;
    let w = this.frames.get(n);
    if (!w) {
      w = new Widget(this.layout, this.cls, { swf: this.swf, frame: n });
      this.opts.decorate?.(w, n);
      this.frames.set(n, w);
      this.host.appendChild(w.root);
    }
    const prev = this.frames.get(this.shown);
    if (prev) prev.root.style.display = 'none';
    w.root.style.display = '';
    this.shown = n;
  }

  /** Play from `from` to `to` (inclusive, either direction) at the clip's frame rate; resolves at the last frame. */
  play(from = 0, to = this.count - 1, onFrame?: (f: number) => void): Promise<void> {
    cancelAnimationFrame(this.raf);
    const dir = to >= from ? 1 : -1;
    const len = Math.abs(to - from) + 1;
    this.startAt = performance.now();
    return new Promise<void>((resolve) => {
      this.resolveDone = resolve;
      const step = (): void => {
        const { frame, done } = clipFrameAt(performance.now() - this.startAt, this.fps, len, this.opts.loop);
        const f = from + dir * frame;
        if (!this.culled) this.showFrame(f);
        onFrame?.(f);
        if (done && !this.opts.loop) {
          this.resolveDone = undefined;
          resolve();
          return;
        }
        this.raf = requestAnimationFrame(step);
      };
      step();
    });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.resolveDone?.();
    this.resolveDone = undefined;
  }

  destroy(): void {
    this.stop();
    for (const w of this.frames.values()) w.destroy();
    this.frames.clear();
    this.host.remove();
  }
}
