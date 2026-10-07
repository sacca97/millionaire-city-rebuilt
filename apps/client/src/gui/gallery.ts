// UI gallery dev page: standard popups through the widget toolkit. ?open=<name> shows one modally (with animation).
import './fonts';
import { fontsReady } from './fonts';
import { loadLocale } from './i18n';
import { popups, type Popup } from './popup';
import { Button } from './button';
import { Widget } from './widget';
import { createConfirmPopup, createExchange, createExchangeGoldConfirm, createInstantBuild, createStandardDemo, createTradeBox } from './popups';

const stage = document.getElementById('stage')!;
await Promise.all([loadLocale('EN'), fontsReady()]);
popups.mount(stage);
const builders: Record<string, () => Promise<Popup>> = {
  confirm: () => createExchangeGoldConfirm(5, 1000, () => {}),
  confirm_gold: () => createConfirmPopup({ title: 'Not enough Gold', body: 'You need {0xFF6600}3{/} more Gold Bars.', buttons: [{ slot: 2, kind: 'gold', label: 'Add Gold', onClick: () => {} }] }),
  trade: () => createTradeBox({ price: 100000 }),
  instant: () => createInstantBuild({ price: 250000, fbc: 12, canAffordCash: true }),
  exchange: () => createExchange({ gold: 12, coins: 1234567, coinsPerGold: 100000 }),
  standard: () => createStandardDemo(),
};
const q = new URLSearchParams(location.search).get('open');
if (q) (await builders[q]()).show();
else {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:8px;top:8px;display:flex;gap:6px;z-index:5';
  for (const k of Object.keys(builders)) {
    const b = document.createElement('button');
    b.textContent = k;
    b.onclick = async () => (await builders[k]()).show();
    bar.appendChild(b);
  }
  stage.appendChild(bar);
  void Button; void Widget;
}
document.title = 'ready';
