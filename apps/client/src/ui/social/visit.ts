// Visiting another city (DollarsGame.visitUniverse :664/:1382, visitWorld :770, RoleVisitor, PopupVisit, PopupDailyIncome,
// StateOnRentVisitor, model/upgrades/UpgradesManager.as). Only NPC cities exist offline (Ronald/Cindy = user 100, Sheik = 101);
// get_world with targetUserId returns them and the city is rendered read-only: the HUD tools bar is covered by a visitor bar
// with the remaining-upgrade counter and a "home" button, clicking a house helps upgrade it (+exp/+coins, add_upgrade_item).
import { Button } from '../../gui/button';
import { coins as fmtCoins } from '../../gui/format';
import { getText } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import { MAP_COLS, MAP_ROWS, tileX, tileY } from '../../game/geometry';
import { parseWorld, type PlacedItem, type WorldState } from '../../model/save';
import { uiBus } from '../bus';
import { getHud } from '../hud';
import type { UiContext } from '../context';
import { loadRuleXml } from '../rewards/rules-xml';
import { parseUpgradeList, upgradeEligible, UPGRADE_REWARD } from './visit-logic';

const NPC_IDS = new Set(['100', '101']);
const TILE = 32;

export class VisitController {
  state?: WorldState;
  userId?: string;
  name = '';
  /** remaining upgrades allowed today for this visit (get_upgrades_list upgradesUniverseAvailable) */
  upgradesLeft = 0;
  readonly upgraded = new Set<string>();
  private companyValue = 0;
  private photo?: string;
  private saved?: { handlers: UiContext['city']['pointerHandlers']; provider: UiContext['city']['stateProvider'] };
  private sparkles: HTMLElement;
  /** WelcomeProgress.smDailyBonusTime: npc sku -> true once the daily NPC income was taken this session. */
  private npcIncomeTaken = new Set<string>();

  constructor(readonly ctx: UiContext) {
    this.sparkles = document.createElement('div');
    this.sparkles.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:40';
  }

  get visiting(): boolean {
    return this.userId !== undefined;
  }

  async init(): Promise<void> {
    uiBus.on('visit', ({ userId, name, companyValue, photo }) => void this.enter(userId, name, companyValue, photo).catch((e) => console.warn('visit failed', e)));
    this.ctx.root.appendChild(this.sparkles);
    const st = document.createElement('style');
    st.textContent = '@keyframes mc-rise{from{transform:translateY(0);opacity:1}to{transform:translateY(-46px);opacity:0}}';
    document.head.appendChild(st);
  }

  /** DollarsGame.visitUniverse */
  async enter(userId: string, name: string, companyValue = 0, photo?: string): Promise<void> {
    this.companyValue = companyValue;
    this.photo = photo;
    if (this.visiting) await this.exit();
    const { conn, city, game } = this.ctx;
    game.setTool({ kind: 'select' });
    game.select(null);
    const res = await conn.query('get_world', { targetUserId: Number(userId) });
    const dat = (res?._dat ?? {}) as Record<string, unknown>;
    const state = parseWorld(dat);
    if (!state.mine) throw new Error('visited world has no company');
    const up = await conn.query('get_upgrades_list', { userId: Number(userId) });
    const list = parseUpgradeList(up?._dat as Record<string, unknown> | undefined);
    this.upgradesLeft = list.available;
    this.upgraded.clear();
    for (const sid of list.sidsBy(game.state.profile.raw.extId ?? '')) this.upgraded.add(sid);
    // StateOnRentVisitor.doEnter: every rent-state building is shown as RENTING to the visitor
    for (const it of state.mine.items) if (it.stateId === 1) it.state = { ...it.state, mode: '4', time: '0' };
    this.state = state;
    this.userId = userId;
    this.name = name;
    // take over the city view (the visited sids may collide with ours: no live state provider while away)
    this.saved = { handlers: city.pointerHandlers, provider: city.stateProvider };
    city.stateProvider = undefined;
    city.pointerHandlers = { click: (wx, wy) => this.onClick(wx, wy), move: () => undefined, leave: () => undefined };
    const traffic = city.world.children[1];
    if (traffic) traffic.visible = false;
    await city.render(state);
    city.centerOn(MAP_COLS / 2, MAP_ROWS / 2);
    this.buildBar();
    uiBus.emit('visitStarted', { userId, name });
    // popups are shown in sequence (PopupVisit, then PopupDailyIncome); do not block the visit on them
    void this.welcome().then(() => this.maybeNpcIncome()).catch((e) => console.warn('visit popups', e));
  }

  /** Back to my own city. */
  async exit(): Promise<void> {
    if (!this.visiting) return;
    const { city, game } = this.ctx;
    getHud()?.tools.setVisitor(false);
    getHud()?.hud.setVisited(null);
    uiBus.emit('visitorChrome', { on: false });
    this.userId = undefined;
    this.state = undefined;
    if (this.saved) {
      city.pointerHandlers = this.saved.handlers;
      city.stateProvider = this.saved.provider;
    }
    const traffic = city.world.children[1];
    if (traffic) traffic.visible = true;
    await city.render(game.state);
    city.centerOn(MAP_COLS / 2, MAP_ROWS / 2);
    document.body.style.cursor = '';
    uiBus.emit('visitEnded');
  }

  // ---- visitor bar (RoleVisitor toolbar: upgrades counter + home) --------------------------------------------------------

  /** Visitor toolbar = the original ToolsBar in RoleVisitor config (ui/hud/toolsbar.ts setVisitor): Home button + upgrades counter. */
  private buildBar(): void {
    const hud = getHud();
    hud?.tools.setVisitor(true, this.upgradesLeft, () => void this.exit());
    hud?.hud.setVisited({ name: this.state?.profile.cityName || this.name, value: this.companyValue, photo: this.photo });
    uiBus.emit('visitorChrome', { on: true });
  }

  private updateCounter(): void {
    getHud()?.tools.setUpgrades(this.upgradesLeft);
  }

  // ---- popups ---------------------------------------------------------------------------------------------------------

  /** PopupVisit: shown on the first visit ever (Profile.firstVisit), then update_money first_visit. */
  private async welcome(): Promise<void> {
    const { game } = this.ctx;
    if (String(game.state.profile.raw.firstVisit ?? '0') === '1') return;
    game.state.profile.raw.firstVisit = '1';
    const female = String(game.state.profile.raw.bossGenre ?? '0') === '1';
    const w = await Widget.create('houses_info', female ? 'popup_wellcome_city_02' : 'popup_wellcome_city_01');
    const p = new Popup(w);
    w.setText('FriendUpgrade', getText('TID_VISIT_FRIEND_POPUP_TITLE'), { fit: true });
    w.setText('TextInfo_01', getText('TID_VISIT_FRIEND_POPUP_TEXT1'), { fit: true });
    w.setText('TextInfo_02', getText('TID_VISIT_FRIEND_POPUP_TEXT2'), { fit: true });
    new Button(w.part('OkButton')).onClick(() => p.close());
    game.sendCommand(game.commands.firstVisitMoney());
    await new Promise<void>((resolve) => {
      p.on('close', () => resolve());
      p.show();
    });
  }

  /**
   * DollarsGame.visitCheckGiveReward (:2409) + visitGetRewardCoins (:848) + onCloseDailyIncome (:910): visiting an NPC once per
   * dailyBonusMinTime pays settings.dailyBonus (advisor only) plus the npcIncome wonders aimed at that NPC.
   */
  private async maybeNpcIncome(): Promise<void> {
    const { game, defs } = this.ctx;
    if (!this.userId || !NPC_IDS.has(this.userId)) return;
    const female = String(game.state.profile.raw.bossGenre ?? '0') === '1';
    const sku = this.userId === '101' ? 'Sheik' : female ? 'Cindy' : 'Ronald';
    const isAdvisor = sku !== 'Sheik';
    if (this.npcIncomeTaken.has(sku)) return;
    // wonders of subtype npcIncome that I own and that target this NPC (or "Advisor")
    let wonders = 0;
    let wonderCoins = 0;
    for (const it of game.items()) {
      const a = defs.get(it.sku)?.attrs;
      if (!a || a.subtype !== 'npcIncome' || it.stateId === 0) continue;
      if (a.target === sku || (isAdvisor && a.target === 'Advisor')) {
        wonders++;
        wonderCoins += Number(a.incomeValue) || 0;
      }
    }
    if (!isAdvisor && wonders === 0) return;
    const settings = await loadRuleXml('settings.xml');
    const base = isAdvisor ? Number(settings.children[0]?.a.dailyBonus ?? 5000) : 0;
    const total = base + wonderCoins;
    if (total <= 0) return;
    const w = await Widget.create('hud', female ? 'popup_stocks_background_02' : 'popup_stocks_background_01');
    const p = new Popup(w);
    w.setText('Caption', getText('TID_POPUP_LEVEL_TITLE'), { fit: true });
    w.setText('Text1', getText('TID_POPUP_DAILY_BONUS_TEXT_1'), { fit: true });
    w.setText('TextInfo', getText('TID_POPUP_DAILY_BONUS_TEXT_2'), { fit: true });
    w.setText('Money', getText('TID_COIN_SYMBOL') + total, { fit: true });
    new Button(w.part('OkButton')).onClick(() => p.close());
    this.npcIncomeTaken.add(sku);
    await new Promise<void>((resolve) => {
      p.on('close', () => {
        game.applyGain({ coins: total });
        game.sendCommand(game.commands.dailyBonusDone());
        game.toast(`+${fmtCoins(total)}`, 'coins');
        resolve();
      });
      p.show();
    });
  }

  // ---- visitor click: help upgrade a house -----------------------------------------------------------------------------

  private itemAt(tx: number, ty: number): PlacedItem | undefined {
    for (const it of this.state?.mine?.items ?? []) {
      const d = this.ctx.defs.get(it.sku);
      const cols = d?.cols ?? 1;
      const rows = d?.rows ?? 1;
      const x = tileX(it.x);
      const y = tileY(it.y);
      if (tx >= x && tx < x + cols && ty >= y && ty < y + rows) return it;
    }
    return undefined;
  }

  private onClick(wx: number, wy: number): void {
    const it = this.itemAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
    if (!it || !this.userId) return;
    this.upgrade(it, wx, wy);
  }

  /** StateOnRentVisitor.doDoClick */
  upgrade(it: PlacedItem, wx: number, wy: number): boolean {
    const { game } = this.ctx;
    if (!upgradeEligible(it.sku, it.stateId, this.upgradesLeft, this.upgraded.has(it.sid))) {
      if (this.upgradesLeft <= 0 && it.sku.startsWith('houses_')) game.toast(getText('TID_CANT_UPGRADE_MORE_TODAY'), 'info');
      return false;
    }
    game.applyGain({ coins: UPGRADE_REWARD.coins, exp: UPGRADE_REWARD.exp });
    // add_upgrade_item carries securityUpdate(): built right after the gain so the snapshot holds the +100 / +10
    game.sendCommand(game.commands.addUpgradeItem({ ownerId: this.userId!, visitorId: this.ctx.conn.uid, sid: it.sid, type: 0 }));
    this.upgraded.add(it.sid);
    this.upgradesLeft--;
    this.updateCounter();
    this.sparkle(wx, wy);
    game.emitSound('collect_rent');
    game.toast(`+${UPGRADE_REWARD.coins}  +${UPGRADE_REWARD.exp} xp`, 'coins');
    return true;
  }

  /** ParticleUpgrade stand-in: rising star at the clicked house. */
  private sparkle(wx: number, wy: number): void {
    const { city } = this.ctx;
    const k = city.world.scale.x;
    const el = document.createElement('div');
    el.textContent = '★';
    el.style.cssText = `position:absolute;left:${wx * k + city.world.x - 10}px;top:${wy * k + city.world.y - 20}px;font:900 28px Arial;color:#ffd21a;text-shadow:0 0 6px #fff,0 2px 2px #8a5a00;animation:mc-rise 1.1s ease-out forwards`;
    this.sparkles.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
}

