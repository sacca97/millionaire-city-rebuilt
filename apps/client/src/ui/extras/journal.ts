// Newspaper / magazine popup (GUI/NewsPaper.as + PopupJournal.as, newspaper.swf / magazine_cover.swf).
// Sequence (NewsPaper.start/updateAnim/closeNews/goBack): the 33-frame clip `newspaper` (a paper that spins in from below) plays on top of the
// stage dim; at currentFrame == totalFrames-15 the `popup_journal` frame (sunburst box with the Done/X button) opens underneath it; at the
// last frame the paper stays and the buttons activate. Closing the box plays the clip backwards from frame 20 to frame 1, then everything goes.
// The user name goes into the paper's `text` field (news only); the Facebook profile photo (`foto`) and Share are not available offline.
import { Button } from '../../gui/button';
import { getText } from '../../gui/i18n';
import { Popup, popups } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { ClipPlayer } from './clip';

/** NewsPaper.updateAnim / closeNews frame numbers (1-based AS frames converted to 0-based indexes). */
export function coverTimeline(totalFrames: number): { reveal: number; last: number; reverseFrom: number } {
  return { reveal: totalFrames - 15 - 1, last: totalFrames - 1, reverseFrom: 20 - 1 };
}

export async function openJournal(ctx: UiContext, type: 'news' | 'magazine'): Promise<Popup> {
  const swf = type === 'news' ? 'newspaper' : 'magazine_cover';
  const w = await Widget.create(swf, 'popup_journal');
  const p = new Popup(w);
  p.drawBackground = false; // the cover layer owns the dim (Popup.show of NewsPaper draws it at the start)
  w.hide('ShareSuccess');
  const done = new Button(w.part('Done'));
  done.setLabel(getText('TID_BUTTON_SKIP'));
  done.onClick(() => p.close());

  const userName = ctx.game.state.profile.userName;
  const cover = await ClipPlayer.create(swf, 'newspaper', {
    decorate: (cw) => { if (type === 'news') cw.find('news.text')?.setText(userName); }
  });
  const dim = document.createElement('div');
  dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.2);pointer-events:none;z-index:1000';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1100';
  const center = document.createElement('div');
  center.style.cssText = `position:absolute;left:50%;top:50%;transform:scale(${popups.scale});transform-origin:0 0`;
  center.appendChild(cover.host);
  stage.appendChild(center);
  const host = popups.host ?? ctx.root;
  host.append(dim, stage);

  const tl = coverTimeline(cover.count);
  let revealed = false;
  p.on('close', () => {
    // closeNews/goBack: play the paper back from frame 20 to 1, then remove it
    void cover.play(tl.reverseFrom, 0).then(() => {
      cover.destroy();
      dim.remove();
      stage.remove();
    });
  });
  void cover.play(0, tl.last, (f) => {
    if (!revealed && f >= tl.reveal) {
      revealed = true;
      p.show();
    }
  });
  return p;
}

/** Approximation of 'until the friends bar has loaded' (see mountJournal). */
const RETRY_WINDOW_MS = 8000;

export function mountJournal(ctx: UiContext): void {
  uiBus.on('openNews', () => void openJournal(ctx, 'news'));
  // Magazine: Profile.logicUpdate :2110 - company value >= 1M, profile flag millionNewsFeed unset, no popup open.
  // The flag is persisted by the million_news_feed command (Profile.as:2114) and read at load (:1224).
  let seen = String(ctx.game.state.profile.raw.millionNewsFeed ?? '0') === '1';
  const check = (cv: number, atLoad = false): void => {
    // DollarsGame.mShowPopup is already set while a mission PopupReward is being built (rewardPopupOpen), before it is on the popup stack.
    const rewardPending = (window as unknown as { __missions?: { manager: { rewardPopupOpen: boolean } } }).__missions?.manager.rewardPopupOpen === true;
    if (seen || cv < 1_000_000 || popups.isAnyOpen || (rewardPending && !atLoad)) return;
    seen = true;
    ctx.game.sendCommand(ctx.game.commands.millionNewsFeed());
    void openJournal(ctx, 'magazine');
  };
  // Profile.logicUpdate runs before MissionObjectManager.logicUpdate in the first frame of the world (DollarsGame.as:1943 vs 2020): the
  // check at load precedes the reward popups of the missions that become reached at load (oracle R04-65-g1 / R05-61-g1).
  // At load the reward popups of the missions that are reached are not up yet (that is MissionObjectManager.logicUpdate, after this).
  // Oracle C04-29 / C05-27: the magazine command is in the first batch at load. Open question (C03-25): there the original sends none
  // although the company value is also >= 1,000,000 at load; see tools/missions/worker-notes/OPEN-QUESTIONS.md.
  // In the original the rewards of the missions reached at load are paid after this first check (the first mission commands carry the
  // value without them: C03-25 952,000 vs 1,072,000 here; C05-27 1,141,000 vs 1,216,000), so subtract what they paid.
  const paid = (window as unknown as { __missions?: { paidCoins: number } }).__missions?.paidCoins ?? 0;
  check(ctx.game.profile.companyValue - paid, true);
  ctx.game.on('profile', (pr) => check(pr.companyValue));
  // Profile.logicUpdate keeps mNewCompanyValue (and so repeats the check every frame) until the friends bar knows the player's own
  // neighbour entry (Profile.as:2125-2128): a retry window right after load, then one check per company value change.
  const retry = setInterval(() => check(ctx.game.profile.companyValue), 1000);
  setTimeout(() => clearInterval(retry), RETRY_WINDOW_MS);
}
