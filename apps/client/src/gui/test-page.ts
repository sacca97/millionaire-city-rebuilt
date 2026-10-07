// Throwaway verification page: renders layouts as absolutely-positioned DOM.
import { instantiate, loadLayout, type GuiNode } from './layout';

function el(n: GuiNode): HTMLElement {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;';
  const [a, b, c, dd, tx, ty] = n.matrix;
  d.style.transform = `matrix(${a},${b},${c},${dd},${tx},${ty})`;
  if (!n.visible) d.style.display = 'none';
  if (n.alpha !== 1) d.style.opacity = String(n.alpha);
  d.title = n.name;
  if (n.texture) {
    const i = document.createElement('img');
    i.src = n.texture.path;
    i.style.cssText = `position:absolute;left:${n.texture.x}px;top:${n.texture.y}px;width:${n.texture.w}px;height:${n.texture.h}px`;
    d.appendChild(i);
  }
  if (n.text) {
    const t = n.text;
    const [x0, y0, x1, y1] = t.bounds;
    const s = document.createElement('div');
    s.textContent = t.text;
    s.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;font:${t.bold ? 'bold ' : ''}${t.size}px Impact,'Arial Narrow',sans-serif;color:${t.color};text-align:${t.align};white-space:${t.wordWrap ? 'normal' : 'nowrap'}`;
    d.appendChild(s);
  }
  for (const c of n.children) d.appendChild(el(c));
  return d;
}

const stage = document.getElementById('stage')!;
const items: [string, string, number, number][] = [
  ['popup_instant_build', 'popup_instant_build', 200, 130],
  ['popup_confirm_buy', 'popup_confirm_buy', 560, 120],
  ['shop', 'shop_box', 80, 360],
  ['shop', 'shop_box_locked', 260, 360],
  ['buttons', 'button_possitive', 420, 300],
  ['buttons', 'button_gold_icon', 420, 360],
  ['buttons', 'button_close', 420, 420],
  ['popup_confirm', 'popup_confirm', 640, 360],
];
stage.style.width = '1000px';
stage.style.height = '520px';
for (const [swf, cls, x, y] of items) {
  const base = `/gui/${swf}`;
  const layout = await loadLayout(base);
  const root = el(instantiate(layout, cls, { baseUrl: base }));
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
  stage.appendChild(root);
}
document.title = 'ready';
