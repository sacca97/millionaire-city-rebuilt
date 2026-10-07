// Investments UI: GUI/PopupInvest.as (+ InvestFriendContent, InvestFriendInvestor, PopupInvestStart/Success/Fail),
// invests/InvestManager.as, invests/InvestDefinitionManager.as, art investment.swf, rules investDefinitions.xml.
// Offline the "friends" you can invest in are the NPC cities (the TS server auto-accepts and finishes them); Facebook friend
// requests, reminders and "ask for speed" are omitted.
import { Button } from '../../gui/button';
import { coins as fmtCoins, convertNumberRanking, convertNumberToString, TRUNCATE_MILLIONS } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { createConfirmPopup } from '../../gui/popups';
import { Widget } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { loadRuleXml } from '../rewards/rules-xml';
import { place } from '../rewards/util';
import {
  InvestState, isSuccessful, parseInvestments, sortInvestments, successPercentage, timeLeftLabel, type InvestDefinition, type InvestObject,
} from './invest-logic';

const SWF = 'investment';
const NPC_PHOTO = '/mcity/0.501/Datas/Assets/npcs/';

interface Friend { extId: string; name: string; photo: string }
const FRIENDS: Friend[] = ['Ronald', 'Cindy', 'Sheik'].map((n) => ({ extId: `npc_${n}`, name: n, photo: `${NPC_PHOTO}${n}.png` }));

export class InvestUI {
  def!: InvestDefinition;
  list: InvestObject[] = [];
  started = 0;
  rewarded = 0;
  private popup?: Popup;

  constructor(readonly ctx: UiContext) {}

  async init(): Promise<void> {
    const x = await loadRuleXml('investDefinitions.xml');
    const a = x.children[0]?.a ?? {};
    this.def = {
      timeMs: (Number(a.time) || 20) * 86_400_000,
      target: Number(a.target) || 4_000_000,
      cost: Number(a.inversion) || 0,
      rewardCoins: Number(a.rewardDCCoins) || 0,
      rewardCash: Number(a.rewardDCCash) || 0,
    };
    uiBus.on('openInvest', () => void this.open());
  }

  async reload(): Promise<void> {
    const res = await this.ctx.conn.query('get_investments_list');
    const p = parseInvestments(res?._dat as Record<string, unknown> | undefined);
    this.list = p.list;
    this.started = p.started;
    this.rewarded = p.rewarded;
  }

  private friend(extId: string): Friend {
    return FRIENDS.find((f) => f.extId === extId) ?? { extId, name: extId.replace(/^npc_/, ''), photo: '' };
  }

  // ---- main popup ---------------------------------------------------------------------------------------------------------

  async open(): Promise<void> {
    if (this.popup?.open) return;
    await this.reload();
    const w = await Widget.create(SWF, 'popup_investment_background');
    const p = new Popup(w);
    this.popup = p;
    p.wireClose(new Button(w.part('mClose')));
    w.hide('search');
    w.hide('HelpButton'); // PopupHelpInvest slideshow omitted
    const btnNew = new Button(w.part('NewButton'));
    btnNew.setLabel(getText('TID_INVEST_BUTTON1'), { fit: true });
    const btnStats = new Button(w.part('StatisticsButton'));
    btnStats.setLabel(getText('TID_INVEST_STATS_TITLE'), { fit: true });
    const btnCheck = new Button(w.part('CheckButton'));
    btnCheck.setLabel(getText('TID_INVEST_BUTTON2'), { fit: true });
    const up = new Button(w.part('mArrowUp'));
    const down = new Button(w.part('mArrowDown'));

    const view = document.createElement('div');
    view.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
    w.root.appendChild(view);
    let tab: 'new' | 'pick' | 'check' | 'stats' = 'new';
    let page = 0;

    const render = async () => {
      view.replaceChildren();
      btnNew.setSelected(tab === 'new' || tab === 'pick');
      btnStats.setSelected(tab === 'stats');
      btnCheck.setSelected(tab === 'check');
      up.part.setVisible(tab !== 'stats' && tab !== 'new');
      down.part.setVisible(tab !== 'stats' && tab !== 'new');
      if (tab === 'new') {
        // PopupInvest.onNewInvest: the info screen popup_investment_select_friends (y + 25) with the "Send Investment Request" button; the original
        // then asks Facebook for friends (onGetFriends, unavailable offline) - here it opens the NPC-city picker below (tab 'pick').
        w.setText('Caption', getText('TID_INVEST_TITLE1'), { fit: true });
        const info = await Widget.create(SWF, 'popup_investment_select_friends');
        const days = Math.round(this.def.timeMs / 86_400_000);
        info.setText('TextInfo_01', t('TID_INVESTMENTS_RESUME', ['$' + this.def.target, days, '$' + this.def.rewardCoins]));
        // TextManager.reformatTextField resets the field's format: oracle shows it top-aligned (centred 14 px).
        const tf = info.part('TextInfo_01').el;
        for (const sp of Array.from(tf.querySelectorAll<HTMLElement>('.g-t'))) { sp.style.fontSize = '14px'; sp.style.letterSpacing = '0'; if (sp.parentElement) sp.parentElement.style.alignItems = 'flex-start'; }
        const pickBtn = new Button(info.part('SelectButton'));
        pickBtn.setLabel(getText('TID_INVESTMENTS_BUTTON'), { fit: true });
        pickBtn.onClick(() => { tab = 'pick'; page = 0; void render(); });
        place(view, info, 0, 25);
      } else if (tab === 'pick') {
        w.setText('Caption', getText('TID_INVEST_TITLE1'), { fit: true });
        const free = FRIENDS.filter((f) => !this.list.some((i) => i.extId === f.extId && i.state !== InvestState.DONE_CLAIMED));
        const perPage = 12;
        const maxPage = Math.max(0, Math.ceil(free.length / perPage) - 1);
        page = Math.min(page, maxPage);
        const shown = free.slice(page * perPage, (page + 1) * perPage);
        for (let i = 0; i < shown.length; i++) await this.friendBox(view, shown[i], i);
        up.setEnabled(page > 0);
        down.setEnabled(page < maxPage);
      } else if (tab === 'check') {
        w.setText('Caption', getText('TID_INVEST_TITLE2'), { fit: true });
        const rows = sortInvestments(this.list);
        const perPage = 5;
        const maxPage = Math.max(0, Math.ceil(rows.length / perPage) - 1);
        page = Math.min(page, maxPage);
        const shown = rows.slice(page * perPage, (page + 1) * perPage);
        for (let i = 0; i < shown.length; i++) await this.investorRow(view, shown[i], i, () => void reload());
        up.setEnabled(page > 0);
        down.setEnabled(page < maxPage);
      } else {
        w.setText('Caption', getText('TID_INVEST_STATS_TITLE'), { fit: true });
        const sp = await Widget.create(SWF, 'popup_investment_statistics');
        sp.setText('TextInfo_03', getText('TID_INVEST_STATS_1'), { fit: true });
        sp.setText('TextInfo_03_01', String(this.started));
        sp.setText('TextInfo_01', getText('TID_INVEST_STATS_2'), { fit: true });
        sp.setText('TextInfo_01_01', String(this.rewarded));
        sp.setText('TextInfo_02', getText('TID_INVEST_STATS_3'), { fit: true });
        sp.setText('TextInfo_02_01', String(successPercentage(this.started, this.rewarded))); // PopupInvest.showStats :258 (no % sign)
        place(view, sp, 0, 0);
      }
    };
    const reload = async () => { await this.reload(); await render(); };
    btnNew.onClick(() => { tab = 'new'; page = 0; void render(); });
    btnCheck.onClick(() => { tab = 'check'; page = 0; void render(); });
    btnStats.onClick(() => { tab = 'stats'; void render(); });
    up.onClick(() => { page = Math.max(0, page - 1); void render(); });
    down.onClick(() => { page += 1; void render(); });
    this.onChanged = () => void reload();
    await render();
    p.show();
  }

  private onChanged: () => void = () => undefined;

  /** InvestFriendContent: friend_box (frame 2 on hover) -> PopupInvestStart. */
  private async friendBox(host: HTMLElement, f: Friend, i: number): Promise<void> {
    const normal = await Widget.create(SWF, 'friend_box', { frame: 0 });
    const hover = await Widget.create(SWF, 'friend_box', { frame: 1 });
    for (const w of [normal, hover]) {
      w.setText('FriendName', f.name, { fit: true });
      if (f.photo) w.part('photo').setImage(f.photo);
    }
    hover.root.style.display = 'none';
    const box = document.createElement('div');
    const col = i % 4, row = Math.floor(i / 4);
    box.style.cssText = `position:absolute;left:0;top:0;cursor:pointer;pointer-events:auto;transform:translate(${-181.5 + 94 * col + 39.6}px,${-140.9 + 110 * row + 49.5}px)`;
    const inner = document.createElement('div');
    inner.style.cssText = 'transition:transform .08s';
    inner.append(normal.root, hover.root);
    box.appendChild(inner);
    // hit area (the clip is mouseChildren=false)
    const hit = document.createElement('div');
    hit.style.cssText = 'position:absolute;left:-38px;top:-50px;width:80px;height:100px';
    box.appendChild(hit);
    box.addEventListener('pointerenter', () => { normal.root.style.display = 'none'; hover.root.style.display = ''; inner.style.transform = 'scale(1.07)'; });
    box.addEventListener('pointerleave', () => { normal.root.style.display = ''; hover.root.style.display = 'none'; inner.style.transform = ''; });
    box.addEventListener('click', () => void this.startPopup(f));
    host.appendChild(box);
  }

  /** PopupInvestStart */
  private async startPopup(f: Friend): Promise<void> {
    const w = await Widget.create(SWF, 'popup_investment_start');
    const p = new Popup(w);
    w.setText('Caption', getText('TID_INVEST_POPUP1_TITLE'), { fit: true });
    const days = Math.round(this.def.timeMs / 86_400_000);
    w.setText(
      'TextInfo',
      t('TID_INVEST_POPUP1_TEXT', [f.name, getText('TID_COIN_SYMBOL') + convertNumberToString(this.def.cost, 0, 0), days, getText('TID_COIN_SYMBOL') + convertNumberToString(this.def.target, 0, 0), getText('TID_COIN_SYMBOL') + convertNumberToString(this.def.rewardCoins, 0, 0)]),
      { fit: true },
    );
    if (f.photo) w.part('photo').setImage(f.photo);
    const btn = new Button(w.part('InvestButton'));
    btn.setLabel(getText('TID_BUTTON_TEXT_INVEST'), { fit: true });
    p.wireClose(new Button(w.part('CancelButton')));
    btn.onClick(() => void this.invest(f, p));
    p.show();
  }

  /** InvestManager.investInFriend + PopupInvestStart.onInvest */
  private async invest(f: Friend, p: Popup): Promise<void> {
    const { game } = this.ctx;
    if (game.profile.coins < this.def.cost) {
      p.close();
      const missing = this.def.cost - game.profile.coins;
      const dlg = await createConfirmPopup({
        title: getText('TID_NO_CASH_TITLE'),
        body: t('TID_NOT_ENOUGH_CASH', [Math.ceil(missing / game.rules.settings.cashToCoins), fmtCoins(missing)]),
        buttons: [{ slot: 2, kind: 'gold', label: getText('TID_BUTTON_TEXT_ADDCASH'), onClick: () => uiBus.emit('openAddGold') }],
      });
      dlg.show();
      return;
    }
    if (this.def.cost > 0) {
      game.applyGain({ coins: -this.def.cost });
      game.sendCommand(game.commands.money('invest_cost'));
    }
    game.sendCommand(game.commands.query('invest_on_friend', { fExtId: f.extId }));
    if (String(game.state.profile.raw.firstInvest ?? '0') !== '1') {
      game.state.profile.raw.firstInvest = '1';
      game.sendCommand(game.commands.firstInvest());
    }
    await game.flush();
    p.close();
    this.onChanged();
  }

  /** InvestFriendInvestor */
  private async investorRow(host: HTMLElement, o: InvestObject, i: number, changed: () => void): Promise<void> {
    const f = this.friend(o.extId);
    const cls = o.state === InvestState.RUNNING ? 'popup_investment_box_speed' : o.state === InvestState.DONE || o.state === InvestState.DONE_CLAIMED ? 'popup_investment_box_results' : 'popup_investment_box_remind';
    const w = await Widget.create(SWF, cls);
    w.setText('Name', f.name, { fit: true });
    if (f.photo) w.part('photo').setImage(f.photo);
    if (o.state === InvestState.RUNNING) {
      const tl = timeLeftLabel(o.timeLeft);
      w.setText('day_number', String(tl.n));
      w.setText('days', getText(tl.hours ? 'TID_INVEST_HOURS_LEFT' : 'TID_INVEST_DAYS_LEFT'), { fit: true });
      w.setText('money', `${getText('TID_COIN_SYMBOL')}${convertNumberRanking(o.companyValue)}/${convertNumberToString(this.def.target, TRUNCATE_MILLIONS, 6)}`, { fit: true });
      w.hide('SpeedButton'); // "ask for speed": Facebook post
    } else if (o.state === InvestState.DONE) {
      const b = new Button(w.part('ResultButton'));
      b.setLabel(getText('TID_INVEST_BUTTON_RESULTS'), { fit: true });
      b.onClick(() => void this.results(o, f, changed));
    } else if (o.state === InvestState.DONE_CLAIMED) {
      w.hide('ResultButton');
      w.hide('alert');
    } else {
      w.hide('RemindButton');
      const c = new Button(w.part('CancelButton'));
      c.setLabel(getText('TID_GEN_BUTTON_CANCEL'), { fit: true });
      c.onClick(() => void this.cancel(o, changed));
    }
    place(host, w, -185.5, -149.85 + 69 * i);
  }

  private async cancel(o: InvestObject, changed: () => void): Promise<void> {
    const { game } = this.ctx;
    const p = await createConfirmPopup({
      title: getText('TID_INVEST_CANCEL_TEXT'),
      body: '',
      buttons: [{ slot: 2, kind: 'green', label: getText('TID_BUTTON_YES'), onClick: () => { game.sendCommand(game.commands.query('invest_cancel', { fExtId: o.extId })); void game.flush().then(changed); } }],
    });
    p.show();
  }

  /** InvestFriendInvestor.onResults -> PopupInvestSuccess / PopupInvestFail -> InvestManager.applyInvestmentDone */
  private async results(o: InvestObject, f: Friend, changed: () => void): Promise<void> {
    const { game } = this.ctx;
    const ok = isSuccessful(o, this.def);
    const finish = () => {
      game.sendCommand(game.commands.query('invest_results', { fExtId: o.extId, success: ok }));
      if (ok) {
        // InvestDefinitionManager.giveReward: coins/cash (persisted with the next snapshot; update_money carries it now)
        game.applyGain({ coins: this.def.rewardCoins, cash: this.def.rewardCash });
        game.sendCommand(game.commands.money('invest_reward'));
        game.toast(`+${fmtCoins(this.def.rewardCoins)}`, 'coins');
        this.ctx.game.emitSound('reward_click');
      }
      void game.flush().then(changed);
    };
    let w: Widget;
    if (ok) {
      w = await Widget.create(SWF, 'popup_good_result');
      w.setText('Caption', getText('TID_INVEST_SUCCESS_TITLE'), { fit: true });
      w.setText('TextInfo', getText('TID_INVEST_SUCCESS_TEXT'), { fit: true });
      w.setText('Money', getText('TID_COIN_SYMBOL') + convertNumberToString(this.def.rewardCoins, 0, 0), { fit: true });
      w.part('goldicon').hide();
      w.hide('ThanksButton'); // thank on Facebook
      const p = new Popup(w);
      if (f.photo) w.part('photo').setImage(f.photo);
      p.wireClose(new Button(w.part('skip')));
      p.on('close', finish);
      p.show();
    } else {
      w = await Widget.create(SWF, 'popup_bad_result');
      w.setText('Caption', getText('TID_INVEST_NO_SUCCESS_TITLE'), { fit: true });
      w.setText('TextInfo', getText('TID_INVEST_NO_SUCCESS_TEXT'), { fit: true });
      const p = new Popup(w);
      if (f.photo) w.part('photo').setImage(f.photo);
      const okb = new Button(w.part('OkButton'));
      okb.setLabel(getText('TID_BUTTON_OK'), { fit: true });
      p.wireClose(okb);
      p.on('close', finish);
      p.show();
    }
  }
}

export async function mountInvest(ctx: UiContext): Promise<InvestUI> {
  const ui = new InvestUI(ctx);
  await ui.init();
  (window as unknown as { __invest?: InvestUI }).__invest = ui;
  return ui;
}
