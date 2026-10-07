// Shared helpers for ui/rewards + ui/social.
import { Button } from '../../gui/button';
import { Widget } from '../../gui/widget';

/** Place a widget (or element) at (x,y) inside `host` (AS: child.x = x; child.y = y; host.addChild(child)). */
export function place(host: HTMLElement, el: HTMLElement | Widget, x: number, y: number): void {
  const e = el instanceof Widget ? el.root : el;
  e.style.transform = `translate(${x}px,${y}px)`;
  host.appendChild(e);
}

/** Swap the placeholder part for a freshly created button class (AS: new DynamicButton(...) at placeholder x/y). */
export async function buttonAt(host: Widget, placeholder: string, swf: string, cls: string, label: string): Promise<Button> {
  const b = await Button.create(swf, cls, { label });
  host.fillPlaceholder(placeholder, b.part.widget);
  return b;
}

/**
 * Plays frames [from..to] (0-based) of a timeline sprite by re-instantiating the class per frame (the toolkit renders one
 * frame per widget). Resolves when the last frame is shown; `onFrame` may swap content. Mounted at (x,y) inside `host`.
 */
export async function playClip(
  host: HTMLElement,
  swf: string,
  cls: string,
  at: { x: number; y: number },
  opts: { from?: number; to?: number; fps?: number; frames?: Widget[] } = {},
): Promise<{ done: Promise<void>; root: HTMLElement; stop(): void }> {
  const first = await Widget.create(swf, cls, { frame: opts.from ?? 0 });
  const total = first.node.frameCount;
  const to = Math.min(opts.to ?? total - 1, total - 1);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  holder.style.transform = `translate(${at.x}px,${at.y}px)`;
  holder.appendChild(first.root);
  host.appendChild(holder);
  let stopped = false;
  const done = new Promise<void>((resolve) => {
    let f = opts.from ?? 0;
    const step = async () => {
      if (stopped || f >= to) return resolve();
      f++;
      const w = await Widget.create(swf, cls, { frame: f });
      holder.replaceChildren(w.root);
      setTimeout(step, 1000 / (opts.fps ?? 24));
    };
    setTimeout(step, 1000 / (opts.fps ?? 24));
  });
  return { done, root: holder, stop: () => { stopped = true; } };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Re-instantiate a named child sprite of `parent` as its own widget at the given 0-based frame (AS: child.gotoAndStop(n)),
 * placed where the child was; the original child is hidden. Returns the standalone widget.
 */
export function childAtFrame(parent: Widget, swf: string, name: string, frame: number): Widget {
  const ph = parent.part(name);
  const id = ph.node.symbolId;
  if (id === undefined) throw new Error(`${name}: no symbol`);
  const w = new Widget(parent.layout, id as unknown as string, { swf, frame });
  ph.hide();
  const m = ph.node.matrix;
  w.root.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`;
  parent.root.appendChild(w.root);
  return w;
}

let inkInstalled = false;
/** CSS filter that paints a sprite as a flat silhouette in the given colour (FiltersManager.setInk(…, 3368601, 1)). */
export function inkFilter(hex = 0x336699): string {
  if (!inkInstalled) {
    inkInstalled = true;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    svg.innerHTML = `<filter id="mc-ink" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0"/></filter>`;
    document.body.appendChild(svg);
  }
  return 'url(#mc-ink)';
}
