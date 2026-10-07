/**
 * DOM renderer for layout.ts node trees. Every GuiNode becomes an absolutely positioned <div> (matrix transform),
 * keeping a node -> element map so widgets can find and mutate named parts (text, images, visibility).
 */
import { fontCss, fontSpecFor } from './fontmap';
import { blendModeCss, colorTransformToCss, filtersToCss, globalFilterDefs, installFilterDefs, maskBox, maskCss, mulMatrix, type MaskSource } from './effects';
import type { GuiNode, Matrix, TextSymbol } from './layout';

export type NodeMap = Map<GuiNode, HTMLElement>;

const SHEET = `
.g-n{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}
.g-n.g-hit{pointer-events:auto}
.g-tex{position:absolute;display:block;max-width:none;user-select:none;-webkit-user-drag:none}
.g-text{position:absolute;box-sizing:border-box;padding:0 2px;display:flex;align-items:center;overflow:visible;white-space:nowrap}
.g-text.g-top{align-items:flex-start}
.g-t{display:block;width:100%;line-height:1.1}
.g-text.g-wrap .g-t{white-space:pre-wrap;word-break:normal;overflow-wrap:normal}
.g-state{position:absolute;left:0;top:0}
`;
let sheetInstalled = false;
export function installBaseStyles(doc: Document = document): void {
  if (sheetInstalled && doc.getElementById('g-base')) return;
  const st = doc.createElement('style');
  st.id = 'g-base';
  st.textContent = SHEET;
  doc.head.appendChild(st);
  sheetInstalled = true;
}

function matrixCss(m: Matrix): string {
  return `matrix(${m.map((v) => +v.toFixed(5)).join(',')})`;
}

/** Style a text field element from its symbol (DCTextField semantics: Flash 2px gutter, anchored at field bounds). */
export function styleText(box: HTMLElement, span: HTMLElement, t: TextSymbol, size = t.size): void {
  const [x0, y0, x1, y1] = t.bounds;
  const spec = fontSpecFor(t.font, t.bold, t.italic);
  box.style.cssText += `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;`;
  const ls = t.letterSpacing ? `letter-spacing:${t.letterSpacing}px;` : '';
  span.style.cssText = `${fontCss(spec, size)}color:${t.color};text-align:${t.align === 'justify' ? 'left' : t.align};${ls}`;
  span.dataset.size = String(t.size);
  box.classList.toggle('g-wrap', t.multiline || t.wordWrap);
  if (t.multiline || t.wordWrap) box.classList.add('g-wrap');
}

function leafTexture(node: GuiNode, acc: Matrix): MaskSource | undefined {
  if (node.texture) return { url: node.texture.path, tex: node.texture, matrix: acc };
  const kids = node.children.filter((c) => c.kind !== 'unknown');
  if (kids.length === 1) return leafTexture(kids[0], mulMatrix(acc, kids[0].matrix));
  return undefined;
}

export interface RenderOptions {
  nodes?: NodeMap;
  /** Render every state frame of button sprites (default true). */
  buttonStates?: boolean;
}

export function renderNode(node: GuiNode, opts: RenderOptions = {}): HTMLElement {
  installBaseStyles();
  const map = opts.nodes ?? new Map();
  const el = build(node, map, opts, true);
  installFilterDefs(globalFilterDefs);
  return el;
}

function build(node: GuiNode, map: NodeMap, opts: RenderOptions, isRoot = false): HTMLElement {
  const d = document.createElement('div');
  d.className = 'g-n';
  map.set(node, d);
  if (node.name) d.dataset.name = node.name;
  if (!isRoot) d.style.transform = matrixCss(node.matrix);
  if (!node.visible) d.style.display = 'none';
  const css = colorTransformToCss(node.colorTransform, globalFilterDefs);
  if (css.opacity !== undefined) d.style.opacity = String(css.opacity);
  const filt = [filtersToCss(node.filters, globalFilterDefs), css.filter ?? ''].filter(Boolean).join(' ');
  if (filt) d.style.filter = filt;
  const bm = blendModeCss(node.blendMode);
  if (bm) d.style.mixBlendMode = bm;
  if (node.texture) {
    const i = document.createElement('img');
    i.className = 'g-tex';
    i.draggable = false;
    i.src = node.texture.path;
    i.style.cssText = `left:${node.texture.x}px;top:${node.texture.y}px;width:${node.texture.w}px;height:${node.texture.h}px`;
    d.appendChild(i);
  }
  if (node.text) {
    const box = document.createElement('div');
    box.className = 'g-text';
    const span = document.createElement('span');
    span.className = 'g-t';
    styleText(box, span, node.text);
    span.textContent = node.text.text;
    box.appendChild(span);
    d.appendChild(box);
  }
  if (node.kind === 'button' && node.states && opts.buttonStates !== false) {
    for (const [state, kids] of Object.entries(node.states)) {
      const holder = document.createElement('div');
      holder.className = 'g-state';
      holder.dataset.state = state;
      holder.style.display = state === 'up' ? '' : 'none';
      appendChildren(holder, kids, map, opts);
      d.appendChild(holder);
    }
  } else appendChildren(d, node.children, map, opts);
  return d;
}

function appendChildren(parent: HTMLElement, kids: GuiNode[], map: NodeMap, opts: RenderOptions): void {
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.maskUntilDepth !== undefined) {
      const src = leafTexture(k, k.matrix);
      const group = document.createElement('div');
      group.className = 'g-n g-mask';
      let j = i + 1;
      const box = src ? maskBox(src) : null;
      let target: HTMLElement = group;
      if (box) {
        // real box + shifted inner holder so the CSS mask is painted over the whole mask rect
        group.style.cssText += box.css;
        target = document.createElement('div');
        target.className = 'g-n';
        target.style.cssText = `left:${-box.x}px;top:${-box.y}px`;
        group.appendChild(target);
      }
      for (; j < kids.length && kids[j].depth <= k.maskUntilDepth; j++) target.appendChild(build(kids[j], map, opts));
      if (src && !box) group.style.cssText += maskCss(src);
      parent.appendChild(group);
      i = j - 1;
      continue;
    }
    parent.appendChild(build(k, map, opts));
  }
}

/** Find all nodes with an instance name inside a node, also looking in every button state. */
export function findAllNamed(node: GuiNode, name: string): GuiNode[] {
  const out: GuiNode[] = [];
  const visit = (n: GuiNode, top: boolean) => {
    if (!top && n.name === name) out.push(n);
    const lists = n.states ? Object.values(n.states) : [n.children];
    for (const l of lists) for (const c of l) visit(c, false);
  };
  visit(node, true);
  return out;
}
