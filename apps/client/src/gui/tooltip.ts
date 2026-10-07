/** Tooltip, port of TipBox: 12px Helvetica Rounded, #4B1400 text on #FFF08D, 3px #992F00 border, radius 10, max width 200. */
import { fontCss, fontSpecFor } from './fontmap';

export const TIP_DELAY_MS = 500;
const TIP_STYLE = `position:fixed;z-index:100000;pointer-events:none;box-sizing:border-box;padding:5px;max-width:210px;width:max-content;background:#fff08d;border:3px solid #992f00;border-radius:10px;color:#4b1400;line-height:1.2;${fontCss(fontSpecFor('HelveticaRounded LT Std Bd'), 12)}`;

export class Tooltip {
  readonly el: HTMLDivElement;
  constructor(text = '') {
    this.el = document.createElement('div');
    this.el.style.cssText = TIP_STYLE;
    this.setText(text);
  }
  setText(s: string): void {
    this.el.textContent = s;
  }
  /** Show above `anchor`, centred, clamped to the viewport (DynamicButton.showTooltip). */
  showAt(anchor: HTMLElement, host: HTMLElement = document.body): void {
    host.appendChild(this.el);
    const r = anchor.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = r.left + (r.width - w) / 2;
    x = Math.max(0, Math.min(x, window.innerWidth - w));
    let y = r.top - h - 10;
    if (y < 0) y = r.bottom + 10;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
  hide(): void {
    this.el.remove();
  }
}

/** Attach a hover tooltip (500 ms delay) to any element. */
export function attachTooltip(target: HTMLElement, text: string, delay = TIP_DELAY_MS) {
  const tip = new Tooltip(text);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const over = () => {
    clearTimeout(timer);
    timer = setTimeout(() => tip.showAt(target), delay);
  };
  const out = () => {
    clearTimeout(timer);
    tip.hide();
  };
  target.addEventListener('pointerenter', over);
  target.addEventListener('pointerleave', out);
  target.addEventListener('pointerdown', out);
  return {
    setText: (s: string) => tip.setText(s),
    destroy: () => {
      out();
      target.removeEventListener('pointerenter', over);
      target.removeEventListener('pointerleave', out);
      target.removeEventListener('pointerdown', out);
    },
  };
}
