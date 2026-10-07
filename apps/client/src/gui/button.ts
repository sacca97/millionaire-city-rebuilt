/**
 * Button: the original buttons are MovieClips with frame labels UpState/OverState/DownState (+ 'disabled').
 * Mirrors DynamicButton: hover -> OverState, press -> DownState, disabled keeps UpState with a saturation(0) filter,
 * label goes into ButtonText.Caption (shrunk to fit), optional tooltip after 500ms, click sound hook.
 */
import { Part, Widget, localBounds, type TextOptions } from './widget';
import { findAllNamed } from './dom';
import type { GuiNode } from './layout';
import { attachTooltip } from './tooltip';

export type UiSound = 'click' | 'hover' | 'open' | 'close';
let soundHook: ((s: UiSound) => void) | undefined;
/** Wire UI sounds (e.g. to the audio module). Called with 'click' for button presses, 'open'/'close' for popups. */
export function setUiSoundHook(fn: ((s: UiSound) => void) | undefined): void {
  soundHook = fn;
}
export function playUiSound(s: UiSound): void {
  soundHook?.(s);
}

type StateName = 'up' | 'over' | 'down' | 'select';

export class Button {
  private enabled = true;
  private state: StateName = 'up';
  private listeners = new Set<(e: PointerEvent | undefined) => void>();
  private hit: HTMLElement;
  private tip?: { setText(s: string): void; destroy(): void };
  private pressed = false;
  private label = '';

  /** Wrap an existing named part (e.g. widget.part('button_close')) whose node is a labelled button clip. */
  constructor(readonly part: Part) {
    const b = localBounds(part.node, true) ?? [-20, -15, 20, 15];
    this.hit = document.createElement('div');
    this.hit.className = 'g-n g-hit g-btnhit';
    this.hit.style.cssText = `left:${b[0]}px;top:${b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px;cursor:pointer;touch-action:manipulation`;
    part.el.appendChild(this.hit);
    const h = this.hit;
    h.addEventListener('pointerenter', () => {
      if (!this.enabled) return;
      this.setState(this.pressed ? 'down' : 'over');
      playUiSound('hover');
    });
    h.addEventListener('pointerleave', () => {
      if (!this.enabled) return;
      this.setState('up');
    });
    h.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.pressed = true;
      this.setState('down');
      e.stopPropagation();
    });
    h.addEventListener('pointerup', () => {
      this.pressed = false;
      if (this.enabled) this.setState('over');
    });
    h.addEventListener('pointercancel', () => {
      this.pressed = false;
      if (this.enabled) this.setState('up');
    });
    h.addEventListener('click', (e) => {
      if (!this.enabled) {
        e.stopImmediatePropagation();
        return;
      }
      playUiSound('click');
      for (const l of [...this.listeners]) l(e as PointerEvent);
    });
  }

  /** Instantiate a button class standalone, e.g. Button.create('buttons','button_possitive',{label:'OK'}). */
  static async create(swf: string, cls: string, opts: { label?: string; textOpts?: TextOptions } = {}): Promise<Button> {
    const w = await Widget.create(swf, cls);
    const b = new Button(w.self);
    if (opts.label !== undefined) b.setLabel(opts.label, opts.textOpts);
    return b;
  }

  get el(): HTMLElement {
    return this.part.el;
  }
  get isEnabled(): boolean {
    return this.enabled;
  }

  onClick(fn: (e?: PointerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Programmatic click (honours disabled). */
  click(): void {
    if (!this.enabled) return;
    playUiSound('click');
    for (const l of [...this.listeners]) l(undefined);
  }

  private selected = false;
  /** DynamicButton.setSelected/setUnselected: stays on the SelectState frame (when the clip has one) until unselected. */
  setSelected(on = true): this {
    this.selected = on;
    this.setState(this.state);
    return this;
  }
  get isSelected(): boolean {
    return this.selected;
  }
  private tabDown = false;
  /** TabButton.select/unselect: the selected tab stays on DownState and ignores hover (GUI/TabButton.as:217). */
  setTabSelected(on: boolean): this {
    this.tabDown = on;
    this.hit.style.pointerEvents = on ? 'none' : '';
    this.setState('up');
    // TabButton.setLabel/select (:205, :222): the selected caption's shadow colour becomes 0x2B4F8A (2835082)
    for (const cap of findAllNamed(this.part.node, 'Caption')) {
      const holder = this.part.widget.partOf(cap).el.parentElement;
      if (!holder) continue;
      const own = holder.closest<HTMLElement>('.g-n[style*="drop-shadow"]');
      if (!own) continue;
      own.dataset.tabFilter ??= own.style.filter;
      own.style.filter = on ? own.dataset.tabFilter.replace(/rgba?\([^)]*\)/g, 'rgb(43, 79, 138)') : own.dataset.tabFilter;
    }
    return this;
  }

  private setState(s: StateName): void {
    this.state = s;
    const states = this.part.node.states;
    if (!states) return;
    const want = this.tabDown && states['down'] ? 'down' : this.selected && states['select'] ? 'select' : states[s] ? s : 'up';
    for (const h of Array.from(this.part.el.querySelectorAll(':scope > .g-state')) as HTMLElement[]) {
      h.style.display = h.dataset.state === want ? '' : 'none';
    }
  }
  get currentState(): string {
    return this.state;
  }

  /** DynamicButton.enable/disable: disabled stays on UpState, desaturated, ignores clicks. */
  setEnabled(on: boolean): this {
    this.enabled = on;
    this.setState('up');
    this.part.el.style.filter = on ? '' : 'grayscale(1)';
    this.hit.style.cursor = on ? 'pointer' : 'default';
    return this;
  }
  enable(): this {
    return this.setEnabled(true);
  }
  disable(): this {
    return this.setEnabled(false);
  }
  setVisible(v: boolean): this {
    this.part.setVisible(v);
    return this;
  }
  moveTo(x: number, y: number): this {
    this.part.moveTo(x, y);
    return this;
  }

  /** Label in every state's ButtonText.Caption (DynamicButton.setLabel -> setTextScaled(caption,false)). */
  setLabel(text: string, opts: TextOptions = {}): this {
    this.label = text;
    // Captions of hidden state frames measure as 0 wide, so they would never shrink: show every state while fitting.
    const states = Array.from(this.part.el.querySelectorAll<HTMLElement>(':scope > .g-state'));
    const saved = states.map((h) => h.style.display);
    for (const h of states) h.style.display = '';
    for (const cap of findAllNamed(this.part.node, 'Caption')) {
      this.part.widget.partOf(cap).setText(text, { rich: false, ...opts });
    }
    states.forEach((h, i) => (h.style.display = saved[i]));
    return this;
  }
  get labelText(): string {
    return this.label;
  }

  /** DynamicButton.setOfferLabel (offer banner caption on *_offer buttons). */
  setOfferLabel(text: string): this {
    for (const o of findAllNamed(this.part.node, 'offer')) {
      const cap = this.part.widget.partOf(o).find('caption');
      cap?.setText(text, { rich: false });
    }
    return this;
  }

  /** DynamicButton.updateWidth: stretch base and widen the caption (used by footer buttons). */
  setWidth(w: number): this {
    for (const bt of findAllNamed(this.part.node, 'ButtonText')) {
      const base = bt.children.find((c) => c.name === 'base');
      if (!base) continue;
      const bb = localBounds(base, true);
      if (!bb) continue;
      const delta = w - (bb[2] - bb[0]);
      const bp = this.part.widget.partOf(base);
      bp.setWidth(w);
      const cap = bt.children.find((c) => c.name === 'Caption');
      if (cap?.text) {
        const box = this.part.widget.partOf(cap).el.querySelector(':scope > .g-text') as HTMLElement | null;
        if (box) {
          box.style.width = `${parseFloat(box.style.width) + delta}px`;
          box.style.left = `${parseFloat(box.style.left) - delta / 2}px`;
        }
      }
      const icon = this.part.node.children.find((c) => c.name === 'icon');
      if (icon) this.part.widget.partOf(icon).moveTo(icon.x - delta / 2, icon.y);
    }
    if (this.label) this.setLabel(this.label);
    return this;
  }

  /** Tooltip after 500 ms hover (DynamicButton.setTip). */
  setTip(text: string): this {
    if (this.tip) this.tip.setText(text);
    else this.tip = attachTooltip(this.hit, text);
    return this;
  }

  destroy(): void {
    this.listeners.clear();
    this.tip?.destroy();
    this.part.el.remove();
  }
}

/** Convenience: turn a button-typed node into a Button if it is one. */
export function isButtonNode(n: GuiNode): boolean {
  return n.kind === 'button';
}
