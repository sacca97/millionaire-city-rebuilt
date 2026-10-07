// News-feed reward presentation (GUI/newsfeeds/NewsFeedRewardPresentation.as; model/newsFeeds/NewsFeedDefinition(Manager).as).
// The original shows it at WelcomeProgress step LOGIN_SOURCE when the player came back through a Facebook post whose
// loginSourceParam.sku has a news-feed definition with a reward and the post was not the player's own (WelcomeProgress.loginSourceBuild :843-853).
// Accepting applies the reward, plays the reward type's clickSoundFx (rewardTypesDefinitions.xml: DCCoins -> Income_Sound) and sends
// update_money action "reward" {value: sku} (the server credits NewsFeedsDefinitions.getRewardExp/Coins/Cash, SecurityNormal.java:113-117).
import { Button } from '../../gui/button';
import { getText } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import type { MissionReward } from '../../game/missions';
import type { UiContext } from '../context';
import { definitions } from './xml';
import { drawReward } from '../missions/art';

export interface NewsFeedDef {
  sku: string;
  tid?: string;
  rewardType?: string;
  rewardAmount: number;
  /** days */
  expiredTime: number;
}

export function parseNewsFeeds(xml: string): Map<string, NewsFeedDef> {
  const out = new Map<string, NewsFeedDef>();
  for (const d of definitions(xml)) {
    out.set(d.sku, { sku: d.sku, tid: d.tid, rewardType: d.rewardType, rewardAmount: Number(d.rewardAmount ?? 0), expiredTime: Number(d.expiredTime ?? 0) });
  }
  return out;
}

/** rewardTypesDefinitions.xml: reward type -> clickSoundFx (only DCCoins has one). */
export function parseRewardClickSounds(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of definitions(xml)) if (d.clickSoundFx) out.set(d.sku, d.clickSoundFx);
  return out;
}

/** NewsFeedDefinition.hasReward / getReward: Exp -> RewardExp, DCCoins -> RewardCoins. */
export function newsFeedReward(def: NewsFeedDef): MissionReward | undefined {
  if (def.rewardAmount <= 0) return undefined;
  if (def.rewardType === 'Exp') return { kind: 'exp', amount: def.rewardAmount };
  if (def.rewardType === 'DCCoins') return { kind: 'coins', amount: def.rewardAmount };
  return undefined;
}

/** Description TID of the post-popup (showPopupParams: RewardExp -> DESC_EXP, otherwise DESC_DCCOINS). */
export const newsFeedDescTid = (r: MissionReward): string => (r.kind === 'exp' ? 'TID_NEWSFEED_REWARD_POST_POPUP_DESC_EXP' : 'TID_NEWSFEED_REWARD_POST_POPUP_DESC_DCCOINS');

/** Whether a login source triggers the presentation: known sku with a reward, from somebody else (loginSourceBuild). */
export function presentable(defs: Map<string, NewsFeedDef>, sku: string, extId: string, myExtId: string): NewsFeedDef | undefined {
  const d = defs.get(sku);
  if (!d || newsFeedReward(d) === undefined) return undefined;
  return extId === myExtId ? undefined : d;
}

let cache: Promise<{ defs: Map<string, NewsFeedDef>; sounds: Map<string, string> }> | undefined;
export function loadNewsFeeds(): Promise<{ defs: Map<string, NewsFeedDef>; sounds: Map<string, string> }> {
  cache ??= (async () => {
    const base = '/mcity/0.501/Datas/rules/';
    const [a, b] = await Promise.all([fetch(base + 'newsFeedsDefinitions.xml').then((r) => r.text()), fetch(base + 'rewardTypesDefinitions.xml').then((r) => r.text())]);
    return { defs: parseNewsFeeds(a), sounds: parseRewardClickSounds(b) };
  })();
  return cache;
}

/** popup_gift_found (collectables.swf): Caption, TextInfo, container_reward, AcceptButton ("OK"). */
export async function openNewsFeedReward(ctx: UiContext, def: NewsFeedDef): Promise<Popup> {
  const reward = newsFeedReward(def)!;
  const { sounds } = await loadNewsFeeds();
  const w = await Widget.create('collectables', 'popup_gift_found');
  const p = new Popup(w);
  p.closeOnEscape = false;
  w.setText('Caption', getText('TID_NEWSFEED_REWARD_POST_POPUP_TITLE'), { fit: true });
  w.hide('TextInfo_02');
  w.setText('TextInfo', getText(newsFeedDescTid(reward)), { fit: true });
  // fill the reward into container_reward (scale min(cw/w, ch/h, 1), centred)
  const ph = w.part('container_reward');
  const drawn = await drawReward(reward);
  const b = ph.bounds() ?? [0, 0, 125, 105];
  const cw = b[2] - b[0];
  const ch = b[3] - b[1];
  const k = Math.min(cw / drawn.w, ch / drawn.h, 1);
  drawn.el.style.transformOrigin = '0 0';
  drawn.el.style.transform = `translate(${ph.x + b[0] + (cw - drawn.w * k) / 2}px,${ph.y + b[1] + (ch - drawn.h * k) / 2}px) scale(${k})`;
  ph.hide();
  w.root.appendChild(drawn.el);
  const ok = new Button(w.part('AcceptButton'));
  ok.setLabel(getText('TID_PARTNER_POST_BUTTON2'));
  ok.onClick(() => {
    // Reward.apply(): coins/exp to the profile; then update_money "reward" with the news-feed sku
    const applied = ctx.game.applyGain(reward.kind === 'exp' ? { exp: reward.amount } : { coins: reward.amount });
    if (applied) {
      if (reward.kind === 'coins' && sounds.get(def.rewardType ?? '')) ctx.game.emitSound('reward_click');
      ctx.game.sendCommand(ctx.game.commands.reward(def.sku));
    }
    p.accept();
  });
  return p.show();
}
