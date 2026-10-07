// Gold / FBC purchase popup (PopupGold.as + FBCreditsPurchase). Offline: every package is granted for free; the server awards
// gold+freeGold from fbcredits.xml (money.ts reconcilePremiumCurrencyPurchase) when it gets update_money buyGold {sku=item_id}.
import { convertNumberToString, TRUNCATE_THOUSAND } from '../../gui/format';
import { getText } from '../../gui/i18n';
import { StandardPopup } from '../../gui/popups';
import { uiBus } from '../bus';
import type { UiContext } from '../context';

interface Pkg { id: string; gold: number; free: number; dollars: string }

async function loadPackages(): Promise<Pkg[]> {
  const xml = await (await fetch('/mcity/0.501/Datas/rules/fbcredits.xml')).text();
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  // items 0..5 are the regular packages; the rest are CRM discount variants (checkCRM=1)
  return [...doc.querySelectorAll('Definition')]
    .filter((d) => d.getAttribute('checkCRM') !== '1')
    .map((d) => ({ id: d.getAttribute('item_id')!, gold: Number(d.getAttribute('gold')), free: Number(d.getAttribute('freeGold')), dollars: d.getAttribute('dolars')! }));
}

export function mountGold(ctx: UiContext): void {
  let open = false;
  uiBus.on('openAddGold', async () => {
    if (open) return;
    open = true;
    const pk = await loadPackages();
    const body = document.createElement('div');
    body.style.cssText = 'width:420px;font:800 15px Nunito,sans-serif;color:#003242;text-align:center';
    body.innerHTML = `<div style="margin-bottom:8px">${getText('TID_POPUP_GOLD_TEXT1')}</div>`;
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;pointer-events:auto';
    for (const p of pk) {
      const b = document.createElement('button');
      b.style.cssText = 'cursor:pointer;border:2px solid #f2a900;border-radius:8px;background:#fff7d6;padding:8px 4px;font:inherit;color:inherit';
      b.innerHTML = `<div style="font-size:22px">${convertNumberToString(p.gold + p.free, TRUNCATE_THOUSAND, 6)}</div><div>Gold${p.free ? ` <small>(+${p.free})</small>` : ''}</div><div style="color:#2a7d00">FREE</div>`;
      b.onclick = () => { ctx.game.buyGoldPackage(p.id, p.gold + p.free); popup.close(); };
      grid.appendChild(b);
    }
    body.appendChild(grid);
    const popup = await StandardPopup.create(getText('TID_POPUP_GOLD_TITLE'), body, { w: 440, h: 235 });
    popup.on('close', () => { open = false; });
    popup.show();
  });
}
