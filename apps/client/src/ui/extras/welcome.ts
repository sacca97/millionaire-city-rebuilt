// WelcomeProgress popup chain (model/WelcomeProgress.as:447-833), started at run-state entry when the tutorial is over (DollarsGame.as:1596-1601).
// Server answer (apps/server get_welcome_progress = GamePlay.java:972-986): attributes `help` (help2applies not yet welcomed), `invest`,
// `newItems`, `npc<Sku>TimeLeft` (daily-bonus timers, ms), `allItemsUnlockables`, `vip`, optional child `loginSourceParam` {sku, extId, itemSku}.
// There is NO `ranking` / `buildings` field: ranking is Company-side (smRanking) and buildings come from Company.progressGetEventCount.
// Steps implemented (others need Facebook/CRM/friends): 1 DAILY_BONUS lives in ui/rewards (popup opens by itself; the chain waits for it),
// 4 PROGRESS (disabled in the original: USE_PROGRESS_POPUP = false), 5 LOGIN_SOURCE news-feed reward, 7 NEW_ITEM.
// Not offline: 2 FAKE_CREDITS, 3 FAN (fan doc value=2 here), 6 BUILDING_FINISH, 8/9 investment reminders (ui/social), 10 SERVICE_EXPIRED, 11 CRM, 12 PENDING_COLLECTIBLES (ui/rewards), 13 CHECK_MAIL.
import { Button } from '../../gui/button';
import { getText, t } from '../../gui/i18n';
import { Popup, popups } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { loadNewsFeeds, openNewsFeedReward, presentable } from './newsfeed';

/** WelcomeProgress.USE_PROGRESS_POPUP: the "while you were away" summary exists in the client but is switched off. */
export const USE_PROGRESS_POPUP = false;

export interface LoginSource {
  sku: string;
  extId: string;
  itemSku: string;
}

export interface WelcomeData {
  help: number;
  invest: number;
  newItems: boolean;
  /** npc sku -> ms until the daily bonus of that NPC is available (npc<sku>TimeLeft). */
  npcTimeLeft: Record<string, number>;
  loginSource?: LoginSource;
}

type Dat = Record<string, unknown>;

/** WelcomeProgress constructor :158-178 + loginSourceBuild :843-853 over the JSON form of the <welcome> element. */
export function parseWelcome(dat: Dat): WelcomeData {
  const num = (v: unknown): number => Number(v ?? 0) || 0;
  const npcTimeLeft: Record<string, number> = {};
  for (const [k, v] of Object.entries(dat)) {
    const m = /^npc(.+)TimeLeft$/.exec(k);
    if (m) npcTimeLeft[m[1]] = num(v);
  }
  // loginSourceParam is a child element: either a key of the object or an entry of the children array under "welcome"
  let src: Dat | undefined = dat.loginSourceParam as Dat | undefined;
  const kids = dat.welcome;
  if (!src && Array.isArray(kids)) src = (kids as Dat[]).find((c) => c && typeof c === 'object' && 'loginSourceParam' in c) as Dat | undefined;
  const loginSource = src && String(src.sku ?? '') !== '' ? { sku: String(src.sku), extId: String(src.extId ?? ''), itemSku: String(src.itemSku ?? '') } : undefined;
  return { help: num(dat.help), invest: num(dat.invest), newItems: num(dat.newItems) === 1, npcTimeLeft, loginSource };
}

export type WelcomeStep = 'progress' | 'loginSource' | 'newItem';

/** Ordered steps that will show something (STEP_PROGRESS 4 < STEP_LOGIN_SOURCE 5 < STEP_NEW_ITEM 7). */
export function planWelcome(data: WelcomeData, o: { buildings?: number; ranking?: number; newsFeed?: boolean; useProgress?: boolean } = {}): WelcomeStep[] {
  const steps: WelcomeStep[] = [];
  if ((o.useProgress ?? USE_PROGRESS_POPUP) && ((o.ranking ?? 0) > 0 || data.help > 0 || (o.buildings ?? 0) > 0)) steps.push('progress');
  if (o.newsFeed) steps.push('loginSource');
  if (data.newItems) steps.push('newItem');
  return steps;
}

/** PopupProgerss.showPopupParams(ranking, help, buildings, investments): `invest` is not shown by the box. */
export async function openWelcomeBack(ranking: number, help: number, buildings: number): Promise<Popup> {
  const w = await Widget.create('houses_info', 'popup_wellcome_back');
  const p = new Popup(w);
  w.setText('Caption', getText('TID_PROGRESS_TITLE'));
  w.setText('TextInfo_01', t('TID_PROGRESS_RANKING', [String(ranking)]), { fit: true });
  w.setText('TextInfo_02', t('TID_PROGRESS_HELP', [String(help)]), { fit: true });
  w.setText('TextInfo_04', t('TID_PROGRESS_BUILDING', [String(buildings)]), { fit: true });
  new Button(w.part('OkButton')).onClick(() => p.close());
  return p.show();
}

/** PopupNewItem (Missions.swf popup_new_item): "go to the shop" opens the buy box, the X closes. */
export async function openNewItem(): Promise<Popup> {
  const w = await Widget.create('Missions', 'popup_new_item');
  const p = new Popup(w);
  new Button(w.part('go_to_the_shop')).onClick(() => {
    p.close();
    uiBus.emit('openShop', {}); // DollarsGame.showBuyBox
  });
  p.wireClose(new Button(w.part('mClose')));
  return p.show();
}

const closed = (p: Popup): Promise<void> => new Promise((res) => p.on('close', () => res()));

/** The chain advances only once no other popup (e.g. the daily bonus) is on screen: WelcomeProgress waits for each EVENT_CLOSE. */
async function whenIdle(): Promise<void> {
  while (popups.isAnyOpen) await new Promise((r) => setTimeout(r, 300));
}

export async function runWelcome(ctx: UiContext, data: WelcomeData): Promise<void> {
  const { defs } = await loadNewsFeeds();
  const myExtId = String(ctx.game.state.profile.raw.userId ?? '');
  const feed = data.loginSource ? presentable(defs, data.loginSource.sku, data.loginSource.extId, myExtId) : undefined;
  for (const step of planWelcome(data, { newsFeed: !!feed })) {
    await whenIdle();
    if (step === 'progress') await closed(await openWelcomeBack(0, data.help, 0));
    else if (step === 'loginSource' && feed) await closed(await openNewsFeedReward(ctx, feed));
    else if (step === 'newItem') await closed(await openNewItem());
  }
}

export async function mountWelcome(ctx: UiContext): Promise<void> {
  if (ctx.game.tutorial) return; // WelcomeProgress needs Tutorial.smTutorialEnd
  const dat = (await ctx.conn.query('get_welcome_progress'))?._dat as Dat | undefined;
  if (!dat) return;
  // let the daily bonus (ui/rewards) open first: it is step 1 of the same chain
  await new Promise((r) => setTimeout(r, 2500));
  await runWelcome(ctx, parseWelcome(dat));
}
