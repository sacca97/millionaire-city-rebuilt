/**
 * Popup base + manager, port of com.dchoc.dollars.GUI.Popup:
 *  - modal dim: black @ 20% over the whole stage
 *  - open: box scales 0 -> 1 / alpha 0.2 -> 1 from the click position to the centre in 0.35 s (Back.easeOut)
 *  - close: 0.2 s linear back to scale 0 / alpha 0.2 at the start position, then removed
 *  - events: 'accept' (only when closed via accept()), 'close'
 * Extras vs the original: popup stack with z-order, ESC closes the topmost popup.
 */
import { Button, playUiSound } from './button';
import { Widget } from './widget';
import { installBaseStyles } from './dom';

export const TWEEN_IN_MS = 350;
export const TWEEN_OUT_MS = 200;
export const TWEEN_MIN_ALPHA = 0.2;
export const DIM_ALPHA = 0.2;
const EASE_BACK_OUT = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

type Handler = () => void;

export class PopupManager {
  host: HTMLElement | undefined;
  /** Uniform UI scale applied to popup boxes (1 = original pixel size). */
  scale = 1;
  readonly stack: Popup[] = [];
  private keyHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const top = this.stack[this.stack.length - 1];
    if (top && top.closeOnEscape && !top.closing) {
      e.preventDefault();
      top.close();
    }
  };

  /** Attach to the element that overlays the canvas (position:relative/absolute, any size). */
  mount(host: HTMLElement): void {
    installBaseStyles();
    this.host = host;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    window.removeEventListener('keydown', this.keyHandler);
    window.addEventListener('keydown', this.keyHandler);
  }
  get isAnyOpen(): boolean {
    return this.stack.length > 0;
  }
  get top(): Popup | undefined {
    return this.stack[this.stack.length - 1];
  }
  /** @internal */
  _push(p: Popup): void {
    this.stack.push(p);
    this.relayer();
  }
  /** @internal */
  _remove(p: Popup): void {
    const i = this.stack.indexOf(p);
    if (i >= 0) this.stack.splice(i, 1);
    this.relayer();
  }
  private relayer(): void {
    this.stack.forEach((p, i) => {
      p.dim.style.zIndex = String(1000 + i * 2);
      p.boxEl.style.zIndex = String(1001 + i * 2);
    });
  }
}

export const popups = new PopupManager();

let holderEl: HTMLElement | undefined;
function popupHolder(): HTMLElement {
  if (!holderEl || !holderEl.isConnected) {
    holderEl = document.createElement('div');
    holderEl.setAttribute('aria-hidden', 'true');
    holderEl.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;height:600px;visibility:hidden;pointer-events:none';
    document.body.appendChild(holderEl);
  }
  return holderEl;
}

export class Popup {
  readonly dim: HTMLDivElement;
  readonly boxEl: HTMLDivElement;
  closeOnEscape = true;
  /** Draw the modal dim (Popup constructor param mDrawBackground). */
  drawBackground = true;
  open = false;
  closing = false;
  private accepted = false;
  private handlers: Record<string, Set<Handler>> = { accept: new Set(), close: new Set() };
  private anim?: Animation;
  private origin = { x: 0, y: 0 };

  constructor(readonly widget: Widget, readonly manager: PopupManager = popups) {
    this.dim = document.createElement('div');
    this.dim.className = 'g-dim';
    this.dim.style.cssText = `position:absolute;inset:0;background:rgba(0,0,0,${DIM_ALPHA});pointer-events:auto;`;
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'g-popup';
    this.boxEl.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;';
    this.boxEl.appendChild(widget.root);
    // Text fitting (setTextScaled) measures real layout, so a popup being built must already be in the document: park it in a hidden
    // holder until show() re-parents it to the host.
    popupHolder().appendChild(this.boxEl);
  }

  on(ev: 'accept' | 'close', fn: Handler): this {
    this.handlers[ev].add(fn);
    return this;
  }
  off(ev: 'accept' | 'close', fn: Handler): this {
    this.handlers[ev].delete(fn);
    return this;
  }
  private emit(ev: 'accept' | 'close'): void {
    for (const h of [...this.handlers[ev]]) h();
  }

  /** Wire a button so a click closes the popup (the 'X' button: DynamicButton CLICK -> onClose). */
  wireClose(btn: Button): this {
    btn.onClick(() => this.close());
    return this;
  }
  /** Wire a button so a click accepts + closes (Popup.onAccept). */
  wireAccept(btn: Button): this {
    btn.onClick(() => this.accept());
    return this;
  }

  /** Open centred on the host. `from` = where the tween starts (original: the mouse position). */
  show(from?: { x: number; y: number }): this {
    const host = this.manager.host;
    if (!host) throw new Error('PopupManager.mount(host) not called');
    if (this.open) return this;
    this.open = true;
    this.closing = false;
    this.accepted = false;
    const rect = host.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    this.origin = from ? { x: from.x - rect.left - cx, y: from.y - rect.top - cy } : { x: 0, y: 0 };
    if (this.drawBackground) host.appendChild(this.dim);
    host.appendChild(this.boxEl);
    this.manager._push(this);
    this.widget.root.style.transformOrigin = '0 0';
    const s = this.manager.scale;
    const full = `translate(0px,0px) scale(${s})`;
    const start = `translate(${this.origin.x}px,${this.origin.y}px) scale(0)`;
    this.widget.root.style.transform = full;
    playUiSound('open');
    this.run([{ transform: start, opacity: TWEEN_MIN_ALPHA }, { transform: full, opacity: 1 }], TWEEN_IN_MS, EASE_BACK_OUT, () => this.onShown());
    return this;
  }

  /** Called when the open tween has finished (Popup.startPopup -> startButtons). */
  protected onShown(): void {}

  accept(): void {
    this.accepted = true;
    this.close();
  }

  /** Close with the 0.2 s linear shrink; resolves listeners afterwards. */
  close(): void {
    if (!this.open || this.closing) return;
    this.closing = true;
    this.dim.remove(); // original removes the dim immediately
    const s = this.manager.scale;
    const full = `translate(0px,0px) scale(${s})`;
    const end = `translate(${this.origin.x}px,${this.origin.y}px) scale(0)`;
    playUiSound('close');
    this.run([{ transform: full, opacity: 1 }, { transform: end, opacity: TWEEN_MIN_ALPHA }], TWEEN_OUT_MS, 'linear', () => this.finishClose());
  }

  private run(frames: Keyframe[], ms: number, easing: string, done: () => void): void {
    this.anim?.cancel();
    const el = this.widget.root;
    if (typeof el.animate !== 'function') {
      done();
      return;
    }
    const last = frames[frames.length - 1];
    el.style.willChange = 'transform, opacity';
    this.anim = el.animate(frames, { duration: ms, easing, fill: 'forwards' });
    this.anim.onfinish = () => {
      el.style.transform = String(last.transform);
      el.style.opacity = String(last.opacity);
      this.anim?.cancel();
      el.style.willChange = '';
      done();
    };
  }

  private finishClose(): void {
    this.open = false;
    this.closing = false;
    this.manager._remove(this);
    this.boxEl.remove();
    if (this.accepted) this.emit('accept');
    this.emit('close');
  }

  /** Close immediately without animation (e.g. screen change). */
  destroy(): void {
    this.anim?.cancel();
    this.dim.remove();
    this.boxEl.remove();
    this.manager._remove(this);
    this.open = false;
    this.widget.destroy();
  }
}
