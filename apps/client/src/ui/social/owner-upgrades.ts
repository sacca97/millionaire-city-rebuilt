// Owner side of the visitor upgrades (UpgradesManager.load/isItemUpgraded, StateItemObject.enter:696): houses that visitors
// helped upgrade show a star and pay +10% on the next collection (Game.collectRent); get_upgrades_list(own) lists them.
import type { UiContext } from '../context';
import { parseUpgradeList } from './visit-logic';

export async function mountOwnerUpgrades(ctx: UiContext): Promise<void> {
  const { game, conn, city } = ctx;
  const res = await conn.query('get_upgrades_list');
  const list = parseUpgradeList(res?._dat as Record<string, unknown> | undefined);
  for (const sid of list.bySid.keys()) if (game.item(sid)) game.upgrades.set(sid, 0);

  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  ctx.root.appendChild(layer);
  const marks = new Map<string, HTMLElement>();
  const loop = () => {
    const k = city.world.scale.x;
    const live = new Set<string>();
    for (const sid of game.upgrades.keys()) {
      const it = game.item(sid);
      if (!it) continue;
      live.add(sid);
      let el = marks.get(sid);
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
        el.innerHTML = '<div style="position:absolute;left:-9px;top:-18px;font:900 22px Arial;color:#ffd21a;text-shadow:0 0 5px #fff,0 2px 1px #8a5a00">★</div>';
        marks.set(sid, el);
        layer.appendChild(el);
      }
      el.style.transform = `translate(${(it.tileX + it.cols) * 32 * k + city.world.x - 12 * k}px,${it.tileY * 32 * k + city.world.y + 6 * k}px)`;
    }
    for (const [sid, el] of marks) if (!live.has(sid)) { el.remove(); marks.delete(sid); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
