// Floating rent numbers on the map (StateOnRent.onIncome -> PointsAnimation coins/xp).
import { convertNumberToString, TRUNCATE_THOUSAND } from '../../gui/format';
import { getText } from '../../gui/i18n';
import { TILE } from '../../game/geometry';
import { RENT_MODE, STATE_ID } from '../../net/commands';
import type { UiContext } from '../context';

const FONT = "800 20px Nunito, 'Trebuchet MS', sans-serif";

function css(el: HTMLElement, s: string): HTMLElement {
  el.style.cssText = s;
  return el;
}

export function mountOverlays(ctx: UiContext): void {
  const { game, city, root } = ctx;
  const layer = css(document.createElement('div'), 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3000');
  root.appendChild(layer);

  // Generic toasts (game 'toast') are rendered by the HUD area (ui/hud/toast.ts); only the map floaters live here.

  // ---- floating numbers at the house that paid rent ----
  const float = (wx: number, wy: number, lines: Array<{ text: string; color: string }>) => {
    const s = city.world.scale.x;
    const x = city.world.x + wx * s;
    const y = city.world.y + wy * s;
    lines.forEach((l, i) => {
      const el = css(
        document.createElement('div'),
        `position:absolute;left:${x}px;top:${y - i * 24}px;transform:translate(-50%,-100%);font:${FONT};color:${l.color};text-shadow:0 0 3px #fff,0 2px 2px rgba(0,0,0,.5);white-space:nowrap`,
      );
      el.textContent = l.text;
      layer.appendChild(el);
      el.animate?.([{ opacity: 1, transform: 'translate(-50%,-100%)' }, { opacity: 0, transform: 'translate(-50%,-260%)' }], { duration: 1600, delay: i * 120, easing: 'ease-out', fill: 'forwards' }).addEventListener('finish', () => el.remove());
      if (typeof el.animate !== 'function') setTimeout(() => el.remove(), 1600);
    });
  };
  const modes = new Map<string, number>();
  for (const it of game.items()) modes.set(it.sid, it.stateId === STATE_ID.RENT ? it.mode : -1);
  let lastCoins = game.profile.coins;
  let lastExp = game.profile.exp;
  const pending: Array<{ sid: string }> = [];
  game.on('item-changed', (it) => {
    const prev = modes.get(it.sid);
    modes.set(it.sid, it.stateId === STATE_ID.RENT ? it.mode : -1);
    // collected: GET_RENT -> WAITING_FOR_CONTRACT (houses); rent income is coins + xp.
    if (prev === RENT_MODE.GET_RENT && it.mode === RENT_MODE.WAITING_FOR_CONTRACT && it.stateId === STATE_ID.RENT) pending.push({ sid: it.sid });
  });
  game.on('item-added', (it) => modes.set(it.sid, -1));
  game.on('profile', (p) => {
    const dc = p.coins - lastCoins;
    const dx = p.exp - lastExp;
    lastCoins = p.coins;
    lastExp = p.exp;
    const hit = pending.shift();
    if (!hit) return;
    const it = game.item(hit.sid);
    if (!it) return;
    const lines: Array<{ text: string; color: string }> = [];
    if (dc > 0) lines.push({ text: `+${getText('TID_COIN_SYMBOL')}${convertNumberToString(dc, TRUNCATE_THOUSAND, 7)}`, color: '#2e9d34' });
    if (dx > 0) lines.push({ text: `+${dx} XP`, color: '#e0a000' });
    if (lines.length) float((it.tileX + it.cols / 2) * TILE, it.tileY * TILE, lines);
  });
}
