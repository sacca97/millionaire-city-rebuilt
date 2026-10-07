/**
 * ScrollList: clipped viewport with wheel / drag / scrollbar (CSS-drawn track + handle; the original used its own scroll art).
 * Content is any element or list of elements; supports vertical or horizontal layout and programmatic scrollTo.
 */
export interface ScrollListOptions {
  width: number;
  height: number;
  horizontal?: boolean;
  /** Pixels per wheel notch (default 40). */
  wheelStep?: number;
  /** Scrollbar thickness in px (default 12). */
  barSize?: number;
  /** Scrollbar colours. */
  trackColor?: string;
  handleColor?: string;
}

export function clampScroll(pos: number, contentSize: number, viewSize: number): number {
  return Math.max(0, Math.min(pos, Math.max(0, contentSize - viewSize)));
}
/** Handle length/offset for a scrollbar track. */
export function handleMetrics(pos: number, contentSize: number, viewSize: number, trackSize: number, minHandle = 20) {
  if (contentSize <= viewSize) return { len: trackSize, off: 0 };
  const len = Math.max(minHandle, (viewSize / contentSize) * trackSize);
  const off = (pos / (contentSize - viewSize)) * (trackSize - len);
  return { len, off };
}

export class ScrollList {
  readonly el: HTMLDivElement;
  readonly content: HTMLDivElement;
  private bar: HTMLDivElement;
  private handle: HTMLDivElement;
  private pos = 0;
  private opts: Required<ScrollListOptions>;

  constructor(opts: ScrollListOptions) {
    this.opts = { horizontal: false, wheelStep: 40, barSize: 12, trackColor: 'rgba(0,50,66,0.25)', handleColor: '#992f00', ...opts };
    const o = this.opts;
    this.el = document.createElement('div');
    this.el.className = 'g-scroll';
    this.el.style.cssText = `position:absolute;width:${o.width}px;height:${o.height}px;overflow:hidden;pointer-events:auto;touch-action:none;`;
    this.content = document.createElement('div');
    this.content.style.cssText = `position:absolute;left:0;top:0;${o.horizontal ? 'display:flex;flex-direction:row;height:100%;' : `width:calc(100% - ${o.barSize + 2}px);`}`;
    this.el.appendChild(this.content);
    this.bar = document.createElement('div');
    this.bar.style.cssText = o.horizontal
      ? `position:absolute;left:0;bottom:0;width:100%;height:${o.barSize}px;background:${o.trackColor};border-radius:${o.barSize / 2}px;`
      : `position:absolute;right:0;top:0;height:100%;width:${o.barSize}px;background:${o.trackColor};border-radius:${o.barSize / 2}px;`;
    this.handle = document.createElement('div');
    this.handle.style.cssText = `position:absolute;background:${o.handleColor};border-radius:${o.barSize / 2}px;cursor:grab;${o.horizontal ? 'top:0;height:100%' : 'left:0;width:100%'}`;
    this.bar.appendChild(this.handle);
    this.el.appendChild(this.bar);

    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollTo(this.pos + Math.sign(e.deltaY || e.deltaX) * o.wheelStep);
    }, { passive: false });

    this.handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handle.setPointerCapture(e.pointerId);
      const startPos = this.pos;
      const start = o.horizontal ? e.clientX : e.clientY;
      const move = (ev: PointerEvent) => {
        const delta = (o.horizontal ? ev.clientX : ev.clientY) - start;
        const { track, content, view } = this.sizes();
        const len = handleMetrics(0, content, view, track).len;
        const range = track - len;
        if (range > 0) this.scrollTo(startPos + (delta / range) * (content - view));
      };
      const up = () => {
        this.handle.removeEventListener('pointermove', move);
        this.handle.removeEventListener('pointerup', up);
      };
      this.handle.addEventListener('pointermove', move);
      this.handle.addEventListener('pointerup', up);
    });
    this.bar.addEventListener('pointerdown', (e) => {
      if (e.target !== this.bar) return;
      const r = this.bar.getBoundingClientRect();
      const frac = ((o.horizontal ? e.clientX - r.left : e.clientY - r.top) / (o.horizontal ? r.width : r.height));
      const { content, view } = this.sizes();
      this.scrollTo(frac * (content - view));
    });
    this.refresh();
  }

  private sizes() {
    const o = this.opts;
    const content = o.horizontal ? this.content.scrollWidth : this.content.scrollHeight;
    const view = o.horizontal ? o.width : o.height;
    return { content, view, track: view };
  }

  setItems(items: HTMLElement[]): this {
    this.content.replaceChildren(...items);
    this.pos = 0;
    this.refresh();
    return this;
  }

  get position(): number {
    return this.pos;
  }

  scrollTo(p: number): this {
    const { content, view } = this.sizes();
    this.pos = clampScroll(p, content, view);
    this.content.style.transform = this.opts.horizontal ? `translateX(${-this.pos}px)` : `translateY(${-this.pos}px)`;
    this.refresh();
    return this;
  }

  /** Recompute the scrollbar after content changes. */
  refresh(): void {
    const { content, view, track } = this.sizes();
    const m = handleMetrics(this.pos, content, view, track);
    this.bar.style.display = content <= view ? 'none' : '';
    if (this.opts.horizontal) {
      this.handle.style.left = `${m.off}px`;
      this.handle.style.width = `${m.len}px`;
    } else {
      this.handle.style.top = `${m.off}px`;
      this.handle.style.height = `${m.len}px`;
    }
  }
}
