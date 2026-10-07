/** Standard popups built on Widget/Popup, filled the way the original AS classes do (see comments per class). */
import { Button } from './button';
import { coins, convertNumberToString, TRUNCATE_MILLIONS, TRUNCATE_THOUSAND } from './format';
import { getText, t } from './i18n';
import { Popup } from './popup';
import { loadGui, localBounds, Widget, type Part } from './widget';

async function makeButton(swf: string, cls: string, label?: string): Promise<Button> {
  const w = await Widget.create(swf, cls);
  const b = new Button(w.self);
  if (label !== undefined) b.setLabel(label);
  return b;
}
const closeBtn = (w: Widget) => new Button(w.part('button_close'));

export type ConfirmKind = 'green' | 'fbc' | 'gold';
export interface ConfirmButton { slot: 1 | 2 | 3; kind: ConfirmKind; label: string; onClick: () => void; }

/** popup_confirm.swf (PopupConfirm.as): title, body, X, up to 3 buttons that replace the magenta button_1..3 placeholders. */
export async function createConfirmPopup(o: { title: string; body: string; buttons: ConfirmButton[] }): Promise<Popup> {
  const w = await Widget.create('popup_confirm', 'popup_confirm');
  const p = new Popup(w);
  w.setText('title', o.title);
  w.setText('text', o.body, { fit: true });
  p.wireClose(closeBtn(w));
  for (const n of ['button_1', 'button_2', 'button_3']) w.hide(n);
  for (const b of o.buttons) {
    const btn = b.kind === 'gold' ? await makeButton('buttons', 'button_gold', b.label) : await makeButton('popup_confirm', b.kind === 'fbc' ? 'button_fbc' : 'button_green', b.label);
    const ph = w.part(`button_${b.slot}`);
    btn.moveTo(ph.x, ph.y);
    w.root.appendChild(btn.el);
    btn.onClick(() => { b.onClick(); p.close(); });
  }
  return p;
}
/** PopupConfirm.startExchangeGold. */
export function createExchangeGoldConfirm(goldToExchange: number, coinsPerGold: number, onExchange: () => void) {
  return createConfirmPopup({
    title: getText('TID_NO_CASH_TITLE'),
    body: t('TID_NOT_ENOUGH_CASH', [String(goldToExchange), coins(goldToExchange * coinsPerGold)]),
    buttons: [{ slot: 2, kind: 'green', label: getText('TID_EXCHANGE_POPUP_BUTTON_EXCHANGE'), onClick: onExchange }],
  });
}

/** popup_confirm_buy.swf (PopupTradeBox.as): "Buy For:" + price; OK (button_green) replaces button_1, disabled if unaffordable. */
export async function createTradeBox(o: { price: number; instantBuild?: boolean; affordable?: boolean; onAccept?: () => void }): Promise<Popup> {
  const w = await Widget.create('popup_confirm_buy', 'popup_confirm_buy');
  const p = new Popup(w);
  w.setText('title', getText(o.instantBuild ? 'TID_TUTORIAL_TITLE_6' : 'TID_BUY_FOR'));
  w.setText('text', coins(o.price), { fit: true });
  w.hide('button_1');
  const ok = await makeButton('popup_confirm_buy', 'button_green', getText('TID_BUTTON_YES'));
  const ph = w.part('button_1');
  ok.moveTo(ph.x, ph.y);
  w.root.appendChild(ok.el);
  if (o.affordable === false) ok.disable();
  ok.onClick(() => { o.onAccept?.(); p.accept(); });
  p.wireClose(closeBtn(w));
  return p;
}

/** popup_instant_build.swf (PopupInstantBuildSecondStep.as): cash button (button_1) + Facebook-credit button (button_2). */
export async function createInstantBuild(o: { price: number; fbc: number; canAffordCash: boolean; onCash?: () => void; onFbc?: () => void }): Promise<Popup> {
  const w = await Widget.create('popup_instant_build', 'popup_instant_build');
  const p = new Popup(w);
  w.setText('title', getText('TID_MISSION_005_TITLE'));
  w.setText('text_1', getText('TID_CONFIRM_EXP_PAY_COINS'), { fit: true });
  w.setText('text_3', getText('TID_CONFIRM_EXP_PAY_FBC'), { fit: true });
  w.setText('text_2', coins(o.price), { fit: true });
  const b1 = await makeButton('popup_instant_build', 'button_green', getText('TID_HINT_BUTTON_BUY'));
  const b2 = await makeButton('popup_instant_build', 'button_fbc', convertNumberToString(o.fbc, TRUNCATE_MILLIONS, 6));
  for (const [n, b] of [['button_1', b1], ['button_2', b2]] as const) {
    const ph = w.part(n);
    ph.hide();
    b.moveTo(ph.x, ph.y);
    w.root.appendChild(b.el);
  }
  if (o.canAffordCash) b1.onClick(() => { o.onCash?.(); p.accept(); }); else b1.disable();
  b2.onClick(() => { o.onFbc?.(); p.accept(); });
  p.wireClose(closeBtn(w));
  return p;
}

/** houses_info.swf exchange_01/02 (PopupExchange.as): trade gold bars for cash one at a time, Confirm applies. */
export async function createExchange(o: { gold: number; coins: number; coinsPerGold: number; onDone?: (gold: number, coins: number) => void; onAddGold?: () => void; female?: boolean }): Promise<Popup> {
  // PopupExchange.as:48 exchange_01 for BOSS_MALE, exchange_02 (female advisor) otherwise
  const w = await Widget.create('houses_info', o.female ? 'exchange_02' : 'exchange_01');
  const p = new Popup(w);
  let gold = o.gold;
  let cash = o.coins;
  const btn = (n: string, label: string) => { const b = new Button(w.part(n)); b.setLabel(label); return b; };
  const exchange = btn('exchange_cash', getText('TID_EXCHANGE_POPUP_BUTTON_EXCHANGE'));
  const addGold = btn('add_gold', getText('TID_BUTTON_TEXT_ADDCASH'));
  const cancel = btn('CancelButton', getText('TID_GEN_BUTTON_CANCEL'));
  const cancel2 = btn('CancelButton_02', getText('TID_GEN_BUTTON_CANCEL'));
  const done = btn('DoneButton', getText('TID_BUTTON_CONFIRM'));
  w.setText('Caption', getText('TID_EXCHANGE_POPUP_TITLE'));
  w.setText('TextInfo', getText('TID_EXCHANGE_POPUP_HAVE'));
  w.setText('TextInfo1', getText('TID_EXCHANGE_POPUP_TRADE'));
  const fill = () => {
    w.part('Coins').get('DCCoins').setText(convertNumberToString(cash, TRUNCATE_MILLIONS, 8));
    w.part('DCcash').get('DCCash').setText(convertNumberToString(gold, TRUNCATE_THOUSAND, 4));
    w.setText('gold', '1');
    w.setText('cash', coins(o.coinsPerGold, TRUNCATE_THOUSAND, 6));
    const none = gold === 0;
    w.part('exchange_cash').setVisible(!none);
    w.part('CancelButton').setVisible(!none);
    w.part('DoneButton').setVisible(!none);
    w.part('CancelButton_02').setVisible(none);
    w.part('add_gold').setVisible(none && o.gold === 0);
  };
  fill();
  exchange.onClick(() => { cash += o.coinsPerGold; gold--; fill(); });
  addGold.onClick(() => { p.close(); o.onAddGold?.(); });
  for (const c of [cancel, cancel2]) p.wireClose(c);
  done.onClick(() => { o.onDone?.(gold, cash); p.accept(); });
  return p;
}

/** popup_standard.swf (PopupExtended.as): resizable frame; header title, content in the body, footer buttons laid out evenly. */
export class StandardPopup extends Popup {
  private footerButtons: Button[] = [];
  private constructor(w: Widget, private title: Part) { super(w); }

  static async create(titleText: string, content?: HTMLElement, size?: { w: number; h: number }): Promise<StandardPopup> {
    const w = await Widget.create('popup_standard', 'popup');
    const tw = await Widget.create('popup_standard', 'text_title');
    const base = w.part('popup_base');
    for (const n of ['body', 'header', 'buttons_footer', 'icon', 'button_close', 'button_arrow_left', 'button_arrow_right']) w.hide(n);
    const title = tw.part('caption');
    title.setTextAlign('center');
    const p = new StandardPopup(w, title);
    const bb = localBounds(base.node, true)!;
    const header = w.part('header');
    const hb = localBounds(header.node, true)!;
    const hw = (hb[2] - hb[0]) * header.node.scaleX;
    w.root.appendChild(tw.root);
    const close = new Button((await Widget.create('buttons', 'button_close')).self);
    const cp = w.part('button_close');
    close.moveTo(cp.x, cp.y);
    w.root.appendChild(close.el);
    p.wireClose(close);
    // resize frame around content (PopupExtended.setBodySize: base grows, top/bottom/left/right groups shift by half the delta)
    const bodyP = w.part('body');
    const bo = localBounds(bodyP.node, true)!;
    const bw = bo[2] - bo[0];
    const bh = bo[3] - bo[1];
    const cw = size?.w ?? 0;
    const ch = size?.h ?? 0;
    const dw = Math.max(0, cw + 20 - bw);
    const dh = Math.max(0, ch + 20 - bh);
    base.setMatrix([ (bb[2] - bb[0] + dw) / (bb[2] - bb[0]), 0, 0, (bb[3] - bb[1] + dh) / (bb[3] - bb[1]), base.x - dw / 2, base.y - dh / 2]);
    w.part('decoration').moveTo(w.part('decoration').x, w.part('decoration').y - dh / 2);
    close.moveTo(cp.x + dw / 2, cp.y - dh / 2);
    // title sits on the header placeholder, centred over its width
    const tb = title.node.text!.bounds;
    title.moveTo(header.x - hw / 2 - tb[0], header.y - dh / 2 - (tb[3] - tb[1]) / 2 - tb[1]);
    const box = tw.root.querySelector('.g-text') as HTMLElement;
    box.style.width = `${hw}px`;
    box.style.height = '40px';
    box.style.left = '0px';
    title.setText(titleText, { size: 32 });
    p.footerCenter = { x: w.part('buttons_footer').x, y: w.part('buttons_footer').y + dh / 2, w: (localBounds(w.part('buttons_footer').node, true)![2] - localBounds(w.part('buttons_footer').node, true)![0]) * w.part('buttons_footer').node.scaleX + dw };
    if (content) {
      const bc = { x: bodyP.x + (bo[0] + bo[2]) / 2, y: bodyP.y + (bo[1] + bo[3]) / 2 };
      content.style.cssText += `position:absolute;left:${bc.x}px;top:${bc.y}px;transform:translate(-50%,-50%)`;
      w.root.appendChild(content);
    }
    return p;
  }
  footerCenter = { x: 0, y: 0, w: 300 };

  /** Add footer button (max width 150, laid out evenly across the footer like updateButtonsPosition). */
  addButton(btn: Button, onClick?: () => void): this {
    this.footerButtons.push(btn);
    this.widget.root.appendChild(btn.el);
    if (onClick) btn.onClick(onClick);
    const n = this.footerButtons.length;
    const slot = this.footerCenter.w / (n + 1);
    const maxW = Math.min(150, slot * 0.9);
    this.footerButtons.forEach((b, i) => { b.moveTo(this.footerCenter.x - this.footerCenter.w / 2 + slot * (i + 1), this.footerCenter.y); b.setWidth(maxW); });
    return this;
  }
}
export { loadGui };

/** Gallery demo of PopupExtended with a text body and two footer buttons. */
export async function createStandardDemo(): Promise<Popup> {
  const body = document.createElement('div');
  body.style.cssText = 'width:300px;font:800 16px Nunito;color:#003242;text-align:center';
  body.textContent = getText('TID_INSTANTBUILD_TEXT1');
  const p = await StandardPopup.create(getText('TID_MISSION_005_TITLE'), body, { w: 300, h: 120 });
  p.addButton(await makeButton('buttons', 'button_possitive', getText('TID_BUTTON_YES')));
  p.addButton(await makeButton('buttons', 'button_negative', getText('TID_GEN_BUTTON_CANCEL')));
  return p;
}
