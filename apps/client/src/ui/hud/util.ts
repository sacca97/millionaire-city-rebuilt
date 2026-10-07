/** Small DOM helpers shared by the HUD pieces (frame-animated clips, hover tips, hit areas). */
import { Tooltip } from "../../gui/tooltip";
import { Widget, localBounds, loadGui, type Part } from "../../gui/widget";

/** Instantiate any symbol of a swf (not only exported classes), optionally at a frame (0-based). */
export async function symbolWidget(swf: string, symbolId: number, frame = 0): Promise<Widget> {
  const layout = await loadGui(swf);
  return new Widget(layout, symbolId as unknown as string, { swf, frame });
}

/**
 * MovieClip frame control for a non-button part (gotoAndStop / play): re-instantiates the clip's symbol at the wanted frame and
 * swaps it into the DOM at the same placement (the toolkit renders one frame per instance).
 */
export class FrameClip {
  private el: HTMLElement;
  private timer = 0;
  private current = 0;
  readonly frameCount: number;
  constructor(private readonly swf: string, private readonly part: Part) {
    this.el = part.el;
    this.frameCount = part.node.frameCount;
  }
  get frame(): number {
    return this.current;
  }
  /** 0-based frame. */
  goto(frame: number): this {
    const f = Math.max(0, Math.min(frame, this.frameCount - 1));
    if (f === this.current && this.el !== this.part.el) return this;
    const layout = this.part.widget.layout;
    const w = new Widget(layout, this.part.node.symbolId as unknown as string, { swf: this.swf, frame: f });
    const n = this.part.node;
    w.root.style.transform = this.part.el.style.transform || `matrix(${n.matrix.join(",")})`;
    if (this.part.el.style.display) w.root.style.display = this.part.el.style.display;
    this.el.parentElement?.replaceChild(w.root, this.el);
    this.el = w.root;
    this.current = f;
    return this;
  }
  /** Play once from frame 0 at `fps`, then rest on `rest` (default 0). */
  playOnce(fps = 24, rest = 0, onEnd?: () => void): void {
    this.stop();
    let f = 0;
    this.goto(0);
    this.timer = window.setInterval(() => {
      f += 1;
      if (f >= this.frameCount) {
        this.stop();
        this.goto(rest);
        onEnd?.();
      } else this.goto(f);
    }, 1000 / fps);
  }
  loop(fps = 12, from = 0, to = this.frameCount - 1): void {
    this.stop();
    let f = from;
    this.timer = window.setInterval(() => {
      f = f >= to ? from : f + 1;
      this.goto(f);
    }, 1000 / fps);
  }
  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }
  setVisible(v: boolean): void {
    this.el.style.display = v ? "" : "none";
    this.part.el.style.display = v ? "" : "none";
  }
}

/** Invisible hit rectangle over a part's art (parts themselves are pointer-events:none). */
export function hitArea(part: Part, pad = 0): HTMLElement {
  const b = localBounds(part.node, true) ?? [0, 0, 20, 20];
  const h = document.createElement("div");
  h.className = "g-n g-hit";
  h.style.cssText = `left:${b[0] - pad}px;top:${b[1] - pad}px;width:${b[2] - b[0] + 2 * pad}px;height:${b[3] - b[1] + 2 * pad}px`;
  part.el.appendChild(h);
  return h;
}

/** HudOwner.setTip*: TipBox shown immediately on mouse over, removed on mouse out. `text` may be a function (live value). */
export function hoverTip(target: HTMLElement, text: string | (() => string), live = false): { destroy(): void } {
  const tip = new Tooltip("");
  let timer = 0;
  const get = () => (typeof text === "function" ? text() : text);
  const over = () => {
    tip.setText(get());
    tip.showAt(target);
    if (live) timer = window.setInterval(() => tip.setText(get()), 250);
  };
  const out = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
    tip.hide();
  };
  target.addEventListener("pointerenter", over);
  target.addEventListener("pointerleave", out);
  target.addEventListener("pointerdown", out);
  return {
    destroy() {
      out();
      target.removeEventListener("pointerenter", over);
      target.removeEventListener("pointerleave", out);
      target.removeEventListener("pointerdown", out);
    },
  };
}
