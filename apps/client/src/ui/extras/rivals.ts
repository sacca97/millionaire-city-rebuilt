// Rival companies' buildings (World > Company whose != 0, state StateOnIA id 3). Mode 2 (MODE_IN_SALE) draws the `PopupForSale` sign
// (AssetManager.PopupForSale = Dollars.swf class AssetManager_PopupForSale) on the item's L1 layer at (worldSizeX/2, baseHeight)
// (StateOnIA.viewStart :244-251); TopText = TID_PANEL_FOR_SALE, prize = TID_COIN_SYMBOL + convertNumberToString(sellPrice,
// TRUNCATE_THOUSAND, 6) (viewForSale :372-382) with sellPrice = ItemObject.getSellPrice (rules.rivalSellPrice).
// The building art itself is drawn by view/city.ts (main.ts adds the rival items); only the sign lives here.
import { rivalSellPrice } from '../../game/rules';
import { TILE } from '../../game/geometry';
import { convertNumberToString, TRUNCATE_THOUSAND } from '../../gui/format';
import { getText } from '../../gui/i18n';
import { Widget } from '../../gui/widget';
import { tileX, tileY } from '../../game/geometry';
import { createTradeBox } from '../../gui/popups';
import { ensureCoins } from '../popups/flows';
import type { UiContext } from '../context';
import { mapHolder } from './maplayer';
import { rivalHit } from '../hud/cursor';
import { disconnectedItems, type InfluenceNode } from '../../game/influence';
import { MAP_COLS, MAP_ROWS } from '../../game/geometry';
import type { GameItem } from '../../game/game';

const MODE_IN_SALE = 2; // StateOnIA.MODE_IN_SALE
const SELL_BAR_MS = 3000; // StateItemObject.SELL_BAR_TIME = AGILE_BAR_TIME

export async function mountRivals(ctx: UiContext): Promise<void> {
  const holder = mapHolder(ctx);
  const signs: Array<{ w: Widget; sku: string; cols: number; rows: number }> = [];
  for (const company of ctx.game.state.companies) {
    if (company === ctx.game.state.mine) continue;
    for (const it of company.items) {
      if (it.stateId !== 3 || Number(it.state.mode ?? 0) !== MODE_IN_SALE) continue;
      const def = ctx.defs.get(it.sku);
      if (!def) continue;
      const w = await Widget.create('Dollars', 'com.dchoc.framework.utils.AssetManager_PopupForSale');
      for (const n of ['Caption', 'Text_Title', 'OkButton', 'locked', 'Fill_Bar', 'plots_info', 'ButtonText', 'BuildButton', 'TextInfo']) w.find(n)?.hide();
      w.part('TopText').setText(getText('TID_PANEL_FOR_SALE'), { rich: false });
      w.root.style.cssText += ';position:absolute;left:0;top:0';
      w.root.style.transform = `translate(${(tileX(it.x) + def.cols / 2) * TILE}px,${(tileY(it.y) + def.rows) * TILE}px)`;
      w.root.dataset.rivalSid = it.sid;
      holder.appendChild(w.root);
      signs.push({ w, sku: it.sku, cols: def.cols, rows: def.rows });
      void it;
    }
  }
  const price = (s: (typeof signs)[number]): string => {
    const g = ctx.game;
    const def = ctx.defs.get(s.sku)!;
    const p = rivalSellPrice(g.rules, g.profile.level, def.rules, s.cols, s.rows);
    return getText('TID_COIN_SYMBOL') + convertNumberToString(p, TRUNCATE_THOUSAND, 6);
  };
  const refresh = (): void => signs.forEach((s) => s.w.part('prize').setText(price(s), { rich: false }));
  refresh();
  ctx.game.on('levelUp', refresh);
  // ItemObject.applyHQConnection also runs for rival buildings: one cut off from the HQ shows ItemNoRoadIcon at its centre (oracle compare4
  // exp-map: the far rival house) and the "disconnected" info box.
  const icons = new Map<string, HTMLElement>();
  let off = new Set<string>();
  const nodeOf = (sid: string, sku: string, x: number, y: number, cols: number, rows: number, isHQ = false): InfluenceNode => ({ sid, type: 0, isHQ, x, y, cols, rows, ratio: 0, value: 0 });
  const recompute = (): void => {
    const hq = ctx.game.items().find((i) => i.sku === 'HeadQuarter');
    const nodes: InfluenceNode[] = [];
    if (hq) nodes.push(nodeOf(hq.sid, hq.sku, hq.tileX, hq.tileY, hq.cols, hq.rows, true));
    for (const c of ctx.game.state.companies) {
      if (c === ctx.game.state.mine) continue;
      for (const it of c.items) {
        if (it.stateId !== 3) continue;
        const def = ctx.defs.get(it.sku);
        if (def) nodes.push(nodeOf(it.sid, it.sku, tileX(it.x), tileY(it.y), def.cols, def.rows));
      }
    }
    off = disconnectedItems(nodes, ctx.game.world.roads, MAP_COLS, MAP_ROWS);
    for (const [sid, el] of icons) if (!off.has(sid)) { el.remove(); icons.delete(sid); }
    for (const sid of off) {
      if (icons.has(sid)) continue;
      const it = ctx.game.state.companies.flatMap((c) => c.items).find((i) => i.sid === sid);
      const def = it && ctx.defs.get(it.sku);
      if (!it || !def) continue;
      const holderEl = document.createElement('div');
      holderEl.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;transform:translate(${(tileX(it.x) + def.cols / 2) * TILE}px,${(tileY(it.y) + def.rows / 2) * TILE}px)`;
      icons.set(sid, holderEl);
      void Widget.create('Dollars', 'com.dchoc.framework.utils.AssetManager_ItemNoRoadIcon').then((w) => { holderEl.append(w.root); holder.appendChild(holderEl); });
    }
  };
  recompute();
  window.setInterval(recompute, 700);
  // Hover: StateOnIA.doDoMouseOver -> InfoBoxCommerceRival / InfoBoxWonder + BuyCursor + the yellow footprint frame (hud/index.ts, infobox.ts).
  rivalHit.fn = (tx, ty) => {
    for (const c of ctx.game.state.companies) {
      if (c === ctx.game.state.mine) continue;
      for (const it of c.items) {
        if (it.stateId !== 3 || Number(it.state.mode ?? 0) !== MODE_IN_SALE) continue;
        const def = ctx.defs.get(it.sku);
        if (!def) continue;
        const fx = tileX(it.x), fy = tileY(it.y);
        if (tx >= fx && tx < fx + def.cols && ty >= fy && ty < fy + def.rows) {
          return { sid: it.sid, sku: it.sku, stateId: 3, mode: MODE_IN_SALE, time: 0, incomeMs: 0, isCommerce: def.rules.kind === 'commerce', suspended: off.has(it.sid), placed: it, def, x: it.x, y: it.y, tileX: fx, tileY: fy, cols: def.cols, rows: def.rows } as unknown as GameItem;
        }
      }
    }
    return undefined;
  };
  void mountRivalTrade(ctx);
}

// ---- hover box + buy flow ---------------------------------------------------------------------------------------------
// StateOnIA.doDoMouseOver (:221-235): InfoBoxCommerceRival / InfoBoxWonder on hover, BuyCursor while MODE_IN_SALE; doDoClick (:191-205):
// TradeProcess(PopupTradeBox TYPE_BUY "Buy for") -> onTrade -> setMode(MODE_BUYING) (coins check :121) -> after the sell bar -> MODE_BOUGHT
// -> NotificationSellingEnd -> adoptRival. Timers: for-sale -> WAIT after settings timeItemOnSale only when areRivalCompanySalesTemporal.
export async function mountRivalTrade(ctx: UiContext): Promise<void> {
  const canvasAt = (e: MouseEvent): boolean => e.target instanceof HTMLCanvasElement;
  const rivalAt = (x: number, y: number) => {
    const t = ctx.city.pointerToTile(x, y);
    for (const c of ctx.game.state.companies) {
      if (c === ctx.game.state.mine) continue;
      for (const it of c.items) {
        if (it.stateId !== 3 || Number(it.state.mode ?? 0) !== MODE_IN_SALE) continue;
        const def = ctx.defs.get(it.sku);
        if (!def) continue;
        const fx = tileX(it.x);
        const fy = tileY(it.y);
        if (t.x >= fx && t.x < fx + def.cols && t.y >= fy && t.y < fy + def.rows) return { it, def, company: c };
      }
    }
    return undefined;
  };
  let busy = false;
  window.addEventListener('click', (e) => {
    if (busy || !canvasAt(e) || ctx.game.tool.kind !== 'select') return;
    const r = rivalAt(e.clientX, e.clientY);
    if (!r) return;
    const price = rivalSellPrice(ctx.game.rules, ctx.game.profile.level, r.def.rules, r.def.cols, r.def.rows);
    busy = true;
    void createTradeBox({
      price,
      affordable: true,
      onAccept: () => {
        void ensureCoins(ctx, price, () => {
          // MODE_BUYING: sign hidden, SellBarOnHouse fills for SELL_BAR_TIME (3 s), then the item changes company.
          ctx.game.adoptRival(r.it, price, SELL_BAR_MS);
          r.company.items = r.company.items.filter((i) => i !== r.it);
          for (const w of document.querySelectorAll('[data-rival-sid="' + r.it.sid + '"]')) w.remove();
          void showSellBar(ctx, r.it, r.def, price);
        });
      },
    }).then((p) => {
      p.on('close', () => { busy = false; });
      p.show();
    });
  });
  // pointer cursor: the BuyCursor sprite comes from hud/cursor.ts (cursorFor IA mode 2)
}

/**
 * StateOnIA.setMode(MODE_BUYING) (:121-129): AssetManager.SellBarOnHouse at the item's BarPosition, filled linearly over SELL_BAR_TIME
 * (DCFillBar.setValueWithoutBarAnimation each logic update), plus the "-$price" PointsAnimation of NotificationSellingEnd.doTransaction.
 * The bar frame is a baked sprite (symbol 77, bounds -25,-25.5); the red fill sits in its dark slot (x 47..116, y 17..34 of the PNG).
 */
async function showSellBar(ctx: UiContext, it: { sku: string; x: number; y: number }, def: { cols: number; rows: number }, price: number): Promise<void> {
  const holder = mapHolder(ctx);
  const w = await Widget.create('Dollars', 'com.dchoc.framework.utils.AssetManager_SellBarOnHouse');
  const anchor = ctx.city.barAnchor(it.sku) ?? { x: 0, y: -def.rows * TILE };
  const bx = tileX(it.x) * TILE + anchor.x;
  const by = (tileY(it.y) + def.rows) * TILE + anchor.y;
  const fill = document.createElement('div');
  fill.style.cssText = 'position:absolute;left:22px;top:-8.5px;width:0;height:17px;background:#e60000;border-radius:3px;pointer-events:none';
  w.root.appendChild(fill);
  w.root.style.cssText += `;position:absolute;left:0;top:0;transform:translate(${bx}px,${by}px)`;
  holder.appendChild(w.root);
  const label = document.createElement('div');
  label.textContent = '-' + getText('TID_COIN_SYMBOL') + price;
  label.style.cssText = `position:absolute;left:0;top:0;font-family:'MC Helvetica Rounded Bd','Nunito',sans-serif;font-size:18px;color:#fff;filter:drop-shadow(0 0 0.7px #249400);white-space:nowrap;pointer-events:none;transform:translate(${bx + 10}px,${by - 12}px)`;
  holder.appendChild(label);
  const t0 = performance.now();
  const step = (): void => {
    const f = Math.min(1, (performance.now() - t0) / SELL_BAR_MS);
    fill.style.width = `${69 * f}px`;
    label.style.opacity = String(Math.max(0, 1 - (performance.now() - t0) / 1500));
    if (f < 1) requestAnimationFrame(step);
    else { w.root.remove(); label.remove(); }
  };
  step();
}
