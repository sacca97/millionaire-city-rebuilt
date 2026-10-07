/**
 * Widget: one instantiated layout.json class (e.g. popup_confirm) as DOM, with named-part lookup (AS: mBox["title"]) and
 * DCTextField-style text setters. Parts are cheap handles onto GuiNode + HTMLElement.
 */
import { renderNode, findAllNamed, type NodeMap } from './dom';
import { fitTextToBox, type FitOptions } from './textfit';
import { parseColorSpans } from './i18n';
import { fontCss, fontSpecFor } from './fontmap';
import { findByName, instantiate, loadLayout, walk, type GuiLayout, type GuiNode, type Matrix, type Rect } from './layout';

const layoutCache = new Map<string, Promise<GuiLayout>>();
export const GUI_BASE = '/gui';

/** Load (and cache) the layout of an exported SWF folder, e.g. 'popup_confirm'. */
export function loadGui(swf: string, base = GUI_BASE): Promise<GuiLayout> {
  const key = `${base}/${swf}`;
  let p = layoutCache.get(key);
  if (!p) {
    p = loadLayout(key);
    layoutCache.set(key, p);
  }
  return p;
}

/** Bounds of a node's own art (textures/text fields) in the node's local space, descending sprites. null if empty. */
export function localBounds(node: GuiNode, includeInvisible = false, upStateOnly = true): Rect | null {
  let acc: Rect | null = null;
  const add = (r: Rect) => {
    acc = acc ? [Math.min(acc[0], r[0]), Math.min(acc[1], r[1]), Math.max(acc[2], r[2]), Math.max(acc[3], r[3])] : r;
  };
  const rec = (n: GuiNode, m: Matrix) => {
    if (!includeInvisible && !n.visible) return;
    const own: Rect[] = [];
    if (n.texture) own.push([n.texture.x, n.texture.y, n.texture.x + n.texture.w, n.texture.y + n.texture.h]);
    if (n.text) own.push(n.text.bounds);
    for (const [x0, y0, x1, y1] of own) {
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) add([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    }
    const kids = upStateOnly || !n.states ? n.children : Object.values(n.states).flat();
    for (const c of kids) rec(c, mul(m, c.matrix));
  };
  rec(node, [1, 0, 0, 1, 0, 0]);
  return acc;
}
function mul(p: Matrix, c: Matrix): Matrix {
  return [p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1], p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3], p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5]];
}

export interface TextOptions extends FitOptions {
  /** Shrink to fit like TextManager.setTextScaled (default true). */
  fit?: boolean;
  /** Interpret {0xRRGGBB}..{/} colour tags (TextManager.changColors). Default true. */
  rich?: boolean;
  /** Starting font size for the shrink loop (default: the field's designed size). */
  size?: number;
}

/** Handle on one named node of a widget. */
export class Part {
  constructor(
    readonly widget: Widget,
    readonly node: GuiNode,
    readonly el: HTMLElement,
  ) {}

  get name(): string {
    return this.node.name;
  }
  get x(): number {
    return this.node.x;
  }
  get y(): number {
    return this.node.y;
  }

  /** Descendant part by instance name ('a.b' allowed). */
  find(path: string): Part | undefined {
    const n = findByName(this.node, path);
    return n ? this.widget.partOf(n) : undefined;
  }
  get(path: string): Part {
    const p = this.find(path);
    if (!p) throw new Error(`no part '${path}' in ${this.name || 'widget'}`);
    return p;
  }

  setVisible(v: boolean): this {
    this.node.visible = v;
    this.el.style.display = v ? '' : 'none';
    return this;
  }
  show(): this {
    return this.setVisible(true);
  }
  hide(): this {
    return this.setVisible(false);
  }
  get visible(): boolean {
    return this.node.visible;
  }

  setOpacity(a: number): this {
    this.el.style.opacity = String(a);
    return this;
  }

  /** Move relative to the parent (replaces the translation of the placement matrix). */
  moveTo(x: number, y: number): this {
    const m = this.node.matrix;
    this.node.matrix = [m[0], m[1], m[2], m[3], x, y];
    this.node.x = x;
    this.node.y = y;
    this.el.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${x},${y})`;
    return this;
  }
  /** Replace the full placement matrix. */
  setMatrix(m: Matrix): this {
    this.node.matrix = m;
    this.node.x = m[4];
    this.node.y = m[5];
    this.el.style.transform = `matrix(${m.join(',')})`;
    return this;
  }
  /** Stretch horizontally to a pixel width (Flash `width =`): scales local x. */
  setWidth(w: number): this {
    const b = localBounds(this.node, true);
    if (!b) return this;
    const m = this.node.matrix;
    const w0 = b[2] - b[0];
    if (w0 <= 0) return this;
    return this.setMatrix([w / w0, m[1], m[2], m[3], m[4], m[5]]);
  }
  /** Bounds in the part's own coordinate space. */
  bounds(): Rect | null {
    return localBounds(this.node, true);
  }

  // ---- text ----
  /** The first text field in this part (itself or a descendant, e.g. ButtonText -> Caption). */
  textPart(): Part | undefined {
    for (const n of walk(this.node)) if (n.text) return this.widget.partOf(n);
    return undefined;
  }
  private get box(): HTMLElement | null {
    return this.el.querySelector(':scope > .g-text');
  }

  /** Set a text field's content (plain or coloured), shrinking to fit like setTextScaled. */
  setText(s: string, opts: TextOptions = {}): this {
    const tp = this.node.text ? this : this.textPart();
    if (!tp) throw new Error(`part '${this.name}' has no text field`);
    const box = tp.box;
    if (!box) return this;
    const span = box.firstElementChild as HTMLElement;
    const t = tp.node.text!;
    span.textContent = '';
    if (opts.rich === false) span.textContent = s;
    else {
      for (const sp of parseColorSpans(s)) {
        if (sp.color) {
          const c = document.createElement('span');
          c.style.color = sp.color;
          c.textContent = sp.text;
          span.appendChild(c);
        } else span.appendChild(document.createTextNode(sp.text));
      }
    }
    // Flash text fields use \n for line breaks; wrapped fields preserve them via pre-wrap
    if (opts.fit !== false) fitTextToBox(box, span, opts.size ?? t.size, opts);
    return this;
  }
  /** Reset text size back to the symbol's size (TextManager.restoreOriginalSize). */
  restoreTextSize(): this {
    const tp = this.node.text ? this : this.textPart();
    const span = tp?.box?.firstElementChild as HTMLElement | undefined;
    if (tp && span) span.style.fontSize = `${tp.node.text!.size}px`;
    return this;
  }
  setTextColor(css: string): this {
    const tp = this.node.text ? this : this.textPart();
    const span = tp?.box?.firstElementChild as HTMLElement | undefined;
    if (span) span.style.color = css;
    return this;
  }
  setTextAlign(a: 'left' | 'center' | 'right'): this {
    const tp = this.node.text ? this : this.textPart();
    const span = tp?.box?.firstElementChild as HTMLElement | undefined;
    if (span) span.style.textAlign = a;
    return this;
  }
  /** Anchor wrapped text to the top of its field instead of centering vertically. */
  setTextTop(top = true): this {
    this.textPart()?.box?.classList.toggle('g-top', top);
    return this;
  }
  /** Override the font face on a text field with a custom CSS font. */
  setFontFace(face: string, size?: number): this {
    const tp = this.node.text ? this : this.textPart();
    const span = tp?.box?.firstElementChild as HTMLElement | undefined;
    if (tp && span) span.style.cssText += fontCss(fontSpecFor(face), size ?? tp.node.text!.size);
    return this;
  }
  get textContent(): string {
    return (this.node.text ? this : this.textPart())?.box?.textContent ?? '';
  }

  // ---- images ----
  /**
   * Replace this part's art with an image (placeholders like `image`, `button_1`, icon holders), fitted into its bounds
   * (or an explicit box) preserving aspect ratio. Returns the <img>.
   */
  setImage(url: string, box?: { x: number; y: number; w: number; h: number }, fit: 'contain' | 'fill' | 'natural' = 'contain'): HTMLImageElement {
    const b = box ?? (() => {
      const r = localBounds(this.node, true) ?? [0, 0, 0, 0];
      return { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] };
    })();
    for (const c of Array.from(this.el.children)) (c as HTMLElement).style.display = 'none';
    this.el.querySelector(':scope > img.g-img')?.remove();
    const img = document.createElement('img');
    img.className = 'g-tex g-img';
    img.src = url;
    img.draggable = false;
    if (fit === 'natural') img.style.cssText = `left:${b.x}px;top:${b.y}px;`;
    else img.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;object-fit:${fit === 'fill' ? 'fill' : 'contain'}`;
    this.el.appendChild(img);
    return img;
  }

  /** Append an element/widget into this part at its own origin (e.g. fill a holder with a button). */
  append(child: HTMLElement | Widget, at?: { x: number; y: number }): this {
    const el = child instanceof Widget ? child.root : child;
    if (at) el.style.transform = `translate(${at.x}px,${at.y}px)`;
    this.el.appendChild(el);
    return this;
  }
}

export interface WidgetOptions {
  baseUrl?: string;
  frame?: number | string;
}

export class Widget {
  readonly node: GuiNode;
  readonly root: HTMLElement;
  protected readonly nodes: NodeMap = new Map();
  private parts = new Map<GuiNode, Part>();

  constructor(
    readonly layout: GuiLayout,
    readonly cls: string,
    opts: WidgetOptions & { swf?: string } = {},
  ) {
    const baseUrl = opts.baseUrl ?? (opts.swf ? `${GUI_BASE}/${opts.swf}` : layout.swf ? `${GUI_BASE}/${layout.swf}` : GUI_BASE);
    this.node = instantiate(layout, cls, { baseUrl, frame: opts.frame });
    this.root = renderNode(this.node, { nodes: this.nodes });
    this.root.classList.add('g-widget');
    this.root.dataset.cls = cls;
  }

  /** Load the swf layout and instantiate a class from it. */
  static async create(swf: string, cls: string, opts: WidgetOptions = {}): Promise<Widget> {
    const layout = await loadGui(swf);
    return new Widget(layout, cls, { ...opts, swf });
  }

  partOf(node: GuiNode): Part {
    let p = this.parts.get(node);
    if (!p) {
      const el = this.nodes.get(node);
      if (!el) throw new Error('node not rendered by this widget');
      p = new Part(this, node, el);
      this.parts.set(node, p);
    }
    return p;
  }
  /** The root as a Part (for setImage etc). */
  get self(): Part {
    return this.partOf(this.node);
  }

  find(path: string): Part | undefined {
    const n = findByName(this.node, path);
    return n ? this.partOf(n) : undefined;
  }
  /** Part by instance name; throws if absent (like AS mBox["x"] returning null then crashing). */
  part(path: string): Part {
    const p = this.find(path);
    if (!p) throw new Error(`${this.cls}: no child '${path}'`);
    return p;
  }
  /** All parts with this instance name, also inside every button state. */
  partsNamed(name: string): Part[] {
    return findAllNamed(this.node, name).map((n) => this.partOf(n));
  }

  setText(path: string, s: string, opts?: TextOptions): this {
    this.part(path).setText(s, opts);
    return this;
  }
  show(path: string, v = true): this {
    this.part(path).setVisible(v);
    return this;
  }
  hide(path: string): this {
    return this.show(path, false);
  }

  /**
   * AS pattern: `var ph = mBox["button_1"]; ph.visible=false; btn.x=ph.x; btn.y=ph.y; mBox.addChild(btn)`.
   * Hides the placeholder and puts `child` at its position inside this widget.
   */
  fillPlaceholder(name: string, child: HTMLElement | Widget): this {
    const ph = this.part(name);
    ph.hide();
    const el = child instanceof Widget ? child.root : child;
    el.style.transform = `translate(${ph.x}px,${ph.y}px)`;
    this.root.appendChild(el);
    return this;
  }

  destroy(): void {
    this.root.remove();
    this.parts.clear();
    this.nodes.clear();
  }
}
