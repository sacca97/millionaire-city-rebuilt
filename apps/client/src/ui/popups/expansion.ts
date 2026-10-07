// Expansion (plot) purchase popup + map overlays. Port of GUI/PopupConfirmExpansion.as (expansions.swf popup_confirm_expansion),
// map/Background.as:339-410 (dim shape + popup_for_sale_expansion sign per unowned plot) and Map.showBuyPlot (:1710-1730).
// Offline: Facebook credits and the investor ("free with N successful investments") path are not available; the investor
// button is shown disabled with the "need N investments" text exactly as the original does when the count is short.
import { Button } from '../../gui/button';
import { convertNumberToString, TRUNCATE_MILLIONS } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import { TILE } from '../../game/geometry';
import { uiBus } from '../bus';
import { parseInvestments } from '../social/invest-logic';
import type { UiContext } from '../context';
import { createConfirmPopup } from '../../gui/popups';
import { showNoGold, ensureCoins } from './flows';
import { parseExpansionPrices, plotAction, priceFor, type ExpansionPrice } from './logic';

let prices: ExpansionPrice[] = [];

export async function loadExpansionPrices(): Promise<void> {
  try {
    const res = await fetch('/mcity/0.501/Datas/rules/expansionsPrices.xml');
    if (res.ok) prices = parseExpansionPrices(await res.text());
  } catch {
    /* keep empty: popup shows zero prices */
  }
}

/** InvestManager.statsGetInvestmentsSuccesfullyCount (rewarded investments, from get_investments_list). */
async function investorCount(ctx: UiContext): Promise<number> {
  try {
    const res = await ctx.conn.query('get_investments_list');
    return parseInvestments(res?._dat as Record<string, unknown> | undefined).rewarded;
  } catch {
    return 0;
  }
}

export function currentPrice(ctx: UiContext): ExpansionPrice {
  return priceFor(prices, ctx.game.expansionCount);
}

/** Map.showBuyPlot + PopupConfirmExpansion.showPopup. */
export async function openExpansion(ctx: UiContext, plot: number): Promise<void> {
  const { game } = ctx;
  const action = plotAction(game.expansions.states[plot]);
  if (action === 'locked') {
    const p = await createConfirmPopup({ title: '', body: getText('TID_EXPANSION_LOCKED'), buttons: [] });
    p.show();
    return;
  }
  if (action !== 'buy') return;
  const price = currentPrice(ctx);
  const w = await Widget.create('expansions', 'popup_confirm_expansion');
  const p = new Popup(w);
  w.setText('TextInfo_01', getText('TID_CONFIRM_EXP_PAY_INVEST'), { fit: true });
  w.setText('TextInfo_03', getText('TID_CONFIRM_EXP_PAY_COINS'), { fit: true });
  w.setText('TextInfo_02', getText('TID_CONFIRM_EXP_PAY_GOLD'), { fit: true });
  w.setText('Expand', getText('TID_CONFIRM_EXP_TITLE'), { fit: true });
  p.wireClose(new Button(w.part('mClose')));
  const slot = async (btnName: string, boxName: string, btnCls: string, boxCls: string, label: string) => {
    const ph = w.part(btnName);
    ph.hide();
    const b = new Button((await Widget.create('expansions', btnCls)).self);
    b.setLabel(label);
    b.moveTo(ph.x, ph.y);
    w.root.appendChild(b.el);
    const bp = w.part(boxName);
    bp.hide();
    const box = await Widget.create('expansions', boxCls);
    box.root.style.transform = `translate(${bp.x}px,${bp.y}px)`;
    w.root.appendChild(box.root);
    return { b, box };
  };
  const buy = (pay: { coins?: number; cash?: number }) => {
    if (game.buyPlot(plot, pay)) {
      p.accept();
      uiBus.emit('plotsChanged');
    }
  };
  // left: coins
  const left = await slot('button_buy_1', 'box_1', 'button_buy', 'box_cash', convertNumberToString(price.coins, TRUNCATE_MILLIONS, 6));
  left.b.onClick(() => {
    // PopupConfirmExpansion.onBuy(true): enough coins -> pay; else exchange gold (startAskForHelpFBCredits).
    void ensureCoins(ctx, price.coins, () => buy({ coins: price.coins }));
  });
  // centre: investors (free with N successful investments); no investments offline -> disabled "need N" state
  const mid = await slot('button_buy_2', 'box_2', 'button_invest', 'box_invest_pending', getText('TID_INVEST_POPUP1_TITLE'));
  const friends = w.part('Friends');
  friends.setText(t('TID_NEED_FRIENDS', [String(price.investors)]), { fit: true });
  friends.setTextColor('#CC0000'); // textColor 13369344
  mid.box.setText('Caption', getText('TID_GEN_FREE'), { fit: true });
  // PopupConfirmExpansion.showPopup (:182-229): fewer successful investments than needed -> the Invest button closes the popup and opens
  // the investment menu on "new" (onInvest/close); enough -> green "Buy" button, free (onBuyCashDiscount -> onAccept) and TID_HAVE_FRIENDS.
  const rewarded = await investorCount(ctx);
  if (rewarded < price.investors) {
    mid.b.onClick(() => {
      p.on('close', () => uiBus.emit('openInvest'));
      p.close();
    });
  } else {
    friends.setText(t('TID_HAVE_FRIENDS', [String(price.investors)]), { fit: true });
    friends.setTextColor('#009932'); // textColor 39218
    mid.b.setLabel(getText('TID_HINT_BUTTON_BUY'));
    mid.b.onClick(() => buy({}));
  }
  // right: gold
  const right = await slot('button_buy_3', 'box_3', 'button_buy', 'box_gold', convertNumberToString(price.cash, TRUNCATE_MILLIONS, 6));
  right.b.onClick(() => {
    if (game.profile.cash >= price.cash) buy({ cash: price.cash });
    else void showNoGold(ctx, 0).then(() => undefined);
  });
  p.show();
}

/** Background.as plot overlays: 30% black over every unowned plot + a "for sale"/"locked" sign (clickable when for sale). */
export function mountPlotOverlays(ctx: UiContext): void {
  const { game, city } = ctx;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0';
  ctx.root.prepend(layer);
  let cursorEl: HTMLElement | undefined;
  const buyCursor = (on: boolean): void => {
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:99999;display:none';
      ctx.root.appendChild(cursorEl);
      window.addEventListener('pointermove', (e) => { if (cursorEl) cursorEl.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, { passive: true });
      void Widget.create('Dollars', 'com.dchoc.framework.utils.AssetManager_BuyAreaCursor').then((w) => cursorEl?.appendChild(w.root));
    }
    cursorEl.style.display = on ? '' : 'none';
  };
  const signs: Array<{ plot: number; dim: HTMLElement; sign: HTMLElement; w: Widget }> = [];
  // Background.fencesBuild (:177-251): fence_<plot> around every plot not owned, fence_<a>_<b> between consecutive plots with the same
  // unlock order while either is not owned. fence.swf symbols are drawn in absolute map coordinates.
  const fences: Array<{ el: HTMLElement; plots: number[] }> = [];
  const fenceHolder = document.createElement('div');
  fenceHolder.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:1'; // above the 30% dim, like mItemObjectsLayerBottom
  layer.prepend(fenceHolder);
  const syncFences = (): void => {
    for (const f of fences) f.el.style.display = f.plots.some((p) => game.expansions.states[p] !== 2) ? '' : 'none';
  };
  void (async () => {
    const names = [...Array(game.expansions.defs.length).keys()].map((i) => `fence_${i}`).concat(
      game.expansions.defs.flatMap((_, a) => [a + 1, a + 5].map((b) => `fence_${a}_${b}`)));
    for (const n of names) {
      const w = await Widget.create('fence', n).catch(() => undefined);
      if (!w) continue;
      w.root.style.cssText += ';position:absolute;left:0;top:0';
      fenceHolder.appendChild(w.root);
      fences.push({ el: w.root, plots: n.split('_').slice(1).map(Number) });
    }
    syncFences();
  })();

  const build = async () => {
    for (const s of signs) {
      s.dim.remove();
      s.sign.remove();
      s.w.destroy();
    }
    signs.length = 0;
    const ex = game.expansions;
    for (let plot = 0; plot < ex.defs.length; plot += 1) {
      if (ex.states[plot] === 2) continue;
      const dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;background:rgba(0,0,0,.3)';
      const w = await Widget.create('expansions', 'popup_for_sale_expansion');
      w.setText('prize', getText('TID_CLICK_TO_BUY'), { fit: true });
      w.setText('TopText', getText('TID_PANEL_EXPANSION_FOR_SALE'), { fit: true });
      w.part('locked').setVisible(ex.states[plot] !== 1); // Background.as:401 hides `locked` for TYPE_NORMAL
      const sign = document.createElement('div');
      sign.style.cssText = `position:absolute;left:0;top:0;z-index:2;transform-origin:0 0;pointer-events:${ex.states[plot] === 1 ? 'auto' : 'none'};cursor:pointer`;
      sign.appendChild(w.root);
      if (ex.states[plot] === 1) {
        // The widget parts are pointer-events:none, so give the sign a hit box (the board without its legs); Map.as BuyAreaCursor on hover.
        const hit = document.createElement('div');
        hit.style.cssText = 'position:absolute;left:-60px;top:-75px;width:120px;height:75px;pointer-events:auto;cursor:none';
        hit.addEventListener('click', () => uiBus.emit('openExpansion', { plot }));
        hit.addEventListener('pointerenter', () => buyCursor(true));
        hit.addEventListener('pointerleave', () => buyCursor(false));
        sign.appendChild(hit);
      }
      layer.append(dim, sign);
      signs.push({ plot, dim, sign, w });
    }
  };
  const frame = () => {
    const k = city.world.scale.x;
    const ex = game.expansions;
    fenceHolder.style.transform = `translate(${city.world.x}px,${city.world.y}px) scale(${k})`;
    for (const s of signs) {
      const r = ex.plotRect(s.plot);
      const x = city.world.x + r.x * TILE * k;
      const y = city.world.y + r.y * TILE * k;
      s.dim.style.width = `${r.w * TILE}px`;
      s.dim.style.height = `${r.h * TILE}px`;
      s.dim.style.transform = `translate(${x}px,${y}px) scale(${k})`;
      // Background.as:382-399: centre of the plot, nudged a quarter of the plot toward the map centre.
      // Plot grid is 5x5 (MapDefinition expansionsSide); (w>>1)+x, then +-(w>>2) toward the central (unlock order 0) plot column/row.
      const side = Math.round(Math.sqrt(ex.defs.length));
      const central = Math.max(0, ex.defs.findIndex((d) => d.unlockedOrder === 0));
      const pw = r.w * TILE;
      const ph = r.h * TILE;
      let cx = r.x * TILE + (pw >> 1);
      let cy = r.y * TILE + (ph >> 1);
      const col = s.plot % side;
      const row = Math.floor(s.plot / side);
      if (col < central % side) cx += pw >> 2;
      else if (col > central % side) cx -= pw >> 2;
      if (row < Math.floor(central / side)) cy += ph >> 2;
      else if (row > Math.floor(central / side)) cy -= ph >> 2;
      const sx = city.world.x + cx * k;
      const sy = city.world.y + cy * k;
      s.sign.style.transform = `translate(${sx}px,${sy}px) scale(${k})`;
    }
    requestAnimationFrame(frame);
  };
  void build().then(() => requestAnimationFrame(frame));
  let sig = game.expansions.states.join();
  const refresh = () => {
    const now = game.expansions.states.join();
    if (now !== sig) {
      sig = now;
      syncFences();
      void build();
    }
  };
  game.on('map', refresh);
  uiBus.on('plotsChanged', refresh);
}
