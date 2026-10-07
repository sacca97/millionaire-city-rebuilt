// Daily bonus popup: GUI/dailyReward/PopupDailyReward.as + DailyReward.as + DailyBigReward.as, DailyBonusManager.as,
// art Dailybonus.swf. Shown at start-up when isBonusEnabled() (WelcomeProgress.STEP_DAILY_BONUS, WelcomeProgress.as:466).
import { parseFlags } from '../../game/missions';
import { Button } from '../../gui/button';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget, localBounds } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import {
  dayStates, isBonusEnabled, LAST_DAY, parseDailyInfo, rewardGain, type DailyDefinition, type DailyInfo, type DayState,
} from './dailybonus-logic';
import { loadRuleXml } from './rules-xml';
import { place, playClip } from './util';

const SWF = 'Dailybonus';
const XINIT = -235; // PopupDailyReward consts
const XOFFSET = 110;
const YOFFSET = -100;

async function loadDefs(): Promise<Map<string, DailyDefinition>> {
  const root = await loadRuleXml('dailyRewardsDefinitions.xml');
  const m = new Map<string, DailyDefinition>();
  for (const d of root.children) {
    m.set(d.a.sku, {
      sku: d.a.sku, bonusType: d.a.bonusType as DailyDefinition['bonusType'], value: d.a.bonusValue,
      group: Number(d.a.group), chances: Number(d.a.chances), date: d.a.date ?? '',
    });
  }
  return m;
}

/** DailyReward.rewardType / DailyBigReward.rewardType */
const rewardClass = (d?: DailyDefinition) =>
  d?.bonusType === 'exp' ? 'Reward_Xp_2' : d?.bonusType === 'coins' ? 'Reward_coins_2' : d?.bonusType === 'cash' ? 'Reward_DC_cash_2' : 'Daily_Reward_01';
const rewardBox = (day: number) => (day >= 1 && day <= 4 ? `Daily_Reward_0${day}` : 'Daily_Reward_01');

async function rewardFace(def: DailyDefinition | undefined): Promise<Widget> {
  const w = await Widget.create(SWF, rewardClass(def));
  if (def) {
    const sym = def.bonusType === 'coins' ? getText('TID_COIN_SYMBOL') : '';
    w.find('TextInfo')?.setText(sym + def.value, { fit: true });
  }
  return w;
}

export interface DailyPopupOptions {
  info: DailyInfo;
  defs: Map<string, DailyDefinition>;
  level: number;
  bossFemale: boolean;
  /** Called when the player claims (keepDailyBonus). */
  onClaim: (def: DailyDefinition) => void;
}

export async function createDailyRewardPopup(o: DailyPopupOptions): Promise<Popup> {
  const w = await Widget.create(SWF, 'popup_dailyreward');
  const p = new Popup(w);
  p.closeOnEscape = false;
  if (o.bossFemale) {
    // PopupDailyReward.load: swap boss for boss_02 at the same position.
    const boss = w.part('boss');
    const alt = await Widget.create(SWF, 'boss_02');
    boss.hide();
    place(w.root, alt, boss.x, boss.y);
  }
  w.setText('Caption', getText('TID_DAILY_BONUS_TITLE'), { fit: true });
  w.setText('TextInfo', getText('TID_DAILY_BONUS_BODY'), { fit: true });
  const confirm = new Button(w.part('ConfirmButton'));
  confirm.setLabel(getText('TID_DAILY_BONUS_BUTTON'));
  confirm.disable(); // startButtons: disabled until the claim animation ends
  confirm.onClick(() => p.close());

  const states = dayStates(o.info);
  const enableConfirm = () => confirm.enable();

  for (const st of states) {
    const big = st.day === LAST_DAY;
    await buildBox(w, p, st, big, o, enableConfirm);
  }
  return p;
}

async function buildBox(host: Widget, _p: Popup, st: DayState, big: boolean, o: DailyPopupOptions, onDone: () => void): Promise<void> {
  const def = st.sku ? o.defs.get(st.sku) : undefined;
  const cls = big
    ? (st.state === 'current' ? 'popup_box_dailyreward_special' : 'popup_box_dailyreward_special_lock')
    : (st.state === 'pending' ? 'popup_box_dailyreward_lock' : 'popup_box_dailyreward');
  const box = await Widget.create(SWF, cls);
  const x = XINIT + (st.day - 1) * XOFFSET;
  place(host.root, box, x, YOFFSET);
  // DailyReward: mTitle "Day N"; DailyBigReward: Caption.
  const title = box.find('mTitle') ?? box.find('Caption');
  title?.setText(t('TID_DAILY_BONUS_DAY', [String(st.day)]), { fit: true });

  // The box clip: a closed gift (frame 32 = last) unless this day was already collected (shows the reward face).
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  const boxClass = big ? 'Daily_Reward_special_01' : rewardBox(st.day);
  const lastFrame = big ? 48 : 31;
  const gift = await Widget.create(SWF, boxClass, { frame: lastFrame });
  const b0 = localBounds((await Widget.create(SWF, boxClass, { frame: 0 })).node, true);
  const gx = (b0 ? b0[2] - b0[0] : 40) + (big ? 10 : 7);
  const gy = (b0 ? b0[3] - b0[1] : 40) + (big ? 30 : 23);
  box.root.appendChild(holder);
  if (st.state === 'collected' && def) {
    const face = await rewardFace(def);
    place(holder, face, 0, 0);
  } else {
    place(holder, gift, gx, gy);
  }

  const ok = box.find('okButton');
  if (!ok) return;
  const btn = new Button(ok);
  if (st.state === 'collected') {
    ok.hide();
  } else if (st.state === 'pending') {
    btn.disable();
  } else if (def) {
    // DailyReward.onClaim: play the burst animation, then swap in the reward face; keepDailyBonus fires immediately.
    btn.onClick(async () => {
      btn.disable();
      o.onClaim(def);
      holder.replaceChildren();
      const clip = await playClip(holder, SWF, boxClass, { x: gx, y: gy }, { fps: 24 });
      await clip.done;
      ok.hide();
      holder.replaceChildren();
      place(holder, await rewardFace(def), 0, 0);
      onDone();
    });
  }
}

export async function mountDailyBonus(ctx: UiContext): Promise<void> {
  const { game, conn } = ctx;
  let open = false;

  // WelcomeProgress.firstSessionProgress (:264-273): after the daily-reward step (popup closed or not shown) the first post-tutorial
  // session sets the profile flag stopFirstSessionPopups=1 (update_profile {action:"flag"}) and the welcome sequence ends.
  const markFirstSession = (): void => {
    const raw = game.state.profile.raw as Record<string, unknown>;
    const flags = parseFlags(String(raw.flags ?? ''));
    if ((flags.stopFirstSessionPopups ?? 0) >= 1) return;
    raw.flags = [String(raw.flags ?? ''), 'stopFirstSessionPopups:1'].filter(Boolean).join(',');
    game.sendCommand(game.commands.flag('stopFirstSessionPopups', 1));
  };
  const show = async (force = false): Promise<void> => {
    if (open) return;
    const res = await conn.query('get_daily_rewards_info');
    const info = parseDailyInfo(res?._dat as Record<string, unknown> | undefined);
    const defs = await loadDefs();
    if (!force && (!isBonusEnabled(info, conn.now()) || !defs.has(info.nextRewardId))) { markFirstSession(); return; }
    open = true;
    const popup = await createDailyRewardPopup({
      info, defs, level: game.profile.level,
      bossFemale: String(game.state.profile.raw.bossGenre ?? '0') === '1',
      onClaim: (def) => {
        const g = rewardGain(def, game.profile.level);
        game.applyGain(g);
        // DailyBonusManager.keepDailyBonus: update_daily_reward {sku, security(+item)}
        game.sendCommand(game.commands.dailyReward(def.sku, { exp: g.exp, coins: g.coins, cash: g.cash }, g.item));
        game.emitSound('reward_click');
      },
    });
    popup.on('close', () => { open = false; if (!force) markFirstSession(); });
    popup.show();
  };
  uiBus.on('openDailyBonus', () => void show(true));
  // WelcomeProgress step: shortly after the world is up.
  // DollarsGame.as:1596: WelcomeProgress only after smTutorialEnd
  if (!ctx.game.tutorial?.active) setTimeout(() => void show().catch((e) => console.warn('daily bonus', e)), 1500);
}
