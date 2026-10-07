import { describe, expect, it } from 'vitest';
import { RENT_MODE, STATE_ID } from '../../net/commands';
import { bubbleTransition, isAbandoned, type Snap } from './bubbles';
import { clipFrameAt } from './clip';
import { DEFAULT_TID, parseCrossPromos } from './crosspromo';
import { emailError, isMail } from './email';
import { coverTimeline } from './journal';
import { newsFeedDescTid, newsFeedReward, parseNewsFeeds, parseRewardClickSounds, presentable } from './newsfeed';
import { isAnimatedPlane, parsePlaneRewards, planeGone, planeX, plainClassFor } from './plane';
import { logoutTid } from './connection';
import { parseWelcome, planWelcome } from './welcome';
import { definitions } from './xml';

const snap = (o: Partial<Snap>): Snap => ({ stateId: STATE_ID.RENT, mode: RENT_MODE.WAITING_FOR_CONTRACT, suspended: false, isCommerce: false, ...o });

describe('xml definitions reader', () => {
  it('reads attributes and decodes entities', () => {
    expect(definitions('<a><Definition sku="1" url="http://x/?a=1&amp;b=2" /><Definition sku="2"></Definition></a>')).toEqual([{ sku: '1', url: 'http://x/?a=1&b=2' }, { sku: '2' }]);
  });
});

describe('clip frame maths', () => {
  it('plays at fps and holds the last frame', () => {
    expect(clipFrameAt(0, 25, 33)).toEqual({ frame: 0, done: false });
    expect(clipFrameAt(400, 25, 33)).toEqual({ frame: 10, done: false });
    expect(clipFrameAt(5000, 25, 33)).toEqual({ frame: 32, done: true });
  });
  it('loops', () => {
    expect(clipFrameAt(1000, 30, 30, true)).toEqual({ frame: 0, done: false });
    expect(clipFrameAt(1100, 30, 30, true).frame).toBe(3);
  });
});

describe('map bubbles', () => {
  it('contract signed on a house, not on a commerce', () => {
    expect(bubbleTransition(snap({}), snap({ mode: RENT_MODE.RENTING }))).toBe('contractSigned');
    expect(bubbleTransition(snap({ isCommerce: true }), snap({ isCommerce: true, mode: RENT_MODE.RENTING }))).toBeNull();
  });
  it('abandoned and reset', () => {
    expect(bubbleTransition(snap({ mode: RENT_MODE.GET_RENT }), snap({ mode: RENT_MODE.ABANDONED }))).toBe('abandoned');
    expect(bubbleTransition(snap({ mode: RENT_MODE.ABANDONED }), snap({}))).toBe('abandonReset');
    expect(isAbandoned(snap({ mode: RENT_MODE.ABANDONED }))).toBe(true);
  });
  it('reconnected to the road', () => {
    expect(bubbleTransition(snap({ suspended: true }), snap({}))).toBe('connected');
    expect(bubbleTransition(undefined, snap({}))).toBeNull();
  });
});

describe('plane', () => {
  it('moves 5px per logic frame and leaves the screen', () => {
    expect(planeX(1000, 1000)).toBe(875);
    expect(planeGone(-300, 350, 0)).toBe(false);
    expect(planeGone(-350, 350, 0)).toBe(true);
  });
  it('class selection', () => {
    expect(isAnimatedPlane('plane_04')).toBe(true);
    expect(plainClassFor('plain')).toBe('plain');
    expect(plainClassFor('plane_03')).toBe('plane_03');
    expect(plainClassFor('bogus')).toBe('plain');
  });
  it('plane rewards by group', () => {
    const m = parsePlaneRewards('<D><Definition sku="2" reward="plane_02" rewardType="plane"/><Definition sku="3" reward="x" rewardType="item"/></D>');
    expect([...m]).toEqual([['2', 'plane_02']]);
  });
});

describe('news feed rewards', () => {
  const defs = parseNewsFeeds('<D><Definition sku="levelUp" tid="T" rewardType="Exp" rewardAmount="500" expiredTime="7"/><Definition sku="askForHelpAsk" expiredTime="7"/><Definition sku="missionReward" rewardType="DCCoins" rewardAmount="2000"/></D>');
  it('reward kinds and texts', () => {
    expect(newsFeedReward(defs.get('levelUp')!)).toEqual({ kind: 'exp', amount: 500 });
    expect(newsFeedReward(defs.get('askForHelpAsk')!)).toBeUndefined();
    expect(newsFeedDescTid({ kind: 'exp', amount: 1 })).toBe('TID_NEWSFEED_REWARD_POST_POPUP_DESC_EXP');
    expect(newsFeedDescTid({ kind: 'coins', amount: 1 })).toBe('TID_NEWSFEED_REWARD_POST_POPUP_DESC_DCCOINS');
  });
  it('only foreign posts with a reward are presented', () => {
    expect(presentable(defs, 'missionReward', '42', '7')?.sku).toBe('missionReward');
    expect(presentable(defs, 'missionReward', '7', '7')).toBeUndefined();
    expect(presentable(defs, 'askForHelpAsk', '42', '7')).toBeUndefined();
    expect(presentable(defs, 'nope', '42', '7')).toBeUndefined();
  });
  it('click sound per reward type', () => {
    expect([...parseRewardClickSounds('<D><Definition sku="Exp"/><Definition sku="DCCoins" clickSoundFx="Income_Sound"/></D>')]).toEqual([['DCCoins', 'Income_Sound']]);
  });
});

describe('welcome chain', () => {
  it('parses the server answer (GamePlay.getWelcomeProgress)', () => {
    const w = parseWelcome({ welcome: [], vip: '0', help: '2', invest: '0', newItems: '1', npcRonaldTimeLeft: '5000', npcCindyTimeLeft: '0' });
    expect(w).toMatchObject({ help: 2, invest: 0, newItems: true, npcTimeLeft: { Ronald: 5000, Cindy: 0 } });
    expect(w.loginSource).toBeUndefined();
  });
  it('reads loginSourceParam from the children', () => {
    const w = parseWelcome({ welcome: [{ loginSourceParam: [], sku: 'levelUp', extId: '9', itemSku: '' }] });
    expect(w.loginSource).toEqual({ sku: 'levelUp', extId: '9', itemSku: '' });
  });
  it('plans steps in WelcomeProgress order; the progress popup is off (USE_PROGRESS_POPUP=false)', () => {
    const w = parseWelcome({ help: '3', newItems: '1' });
    expect(planWelcome(w, { newsFeed: true })).toEqual(['loginSource', 'newItem']);
    expect(planWelcome(w, { useProgress: true })).toEqual(['progress', 'newItem']);
    expect(planWelcome(parseWelcome({}))).toEqual([]);
  });
});

describe('email popup', () => {
  it('TextManager.isMail', () => {
    expect(isMail('bob@mail.com')).toBe(true);
    expect(isMail('bob@mail')).toBe(false);
    expect(isMail('a@@b.com')).toBe(false);
    expect(isMail('@b.com')).toBe(false);
    expect(isMail('bob@m.c')).toBe(false);
    expect(isMail('bob@x.abcde')).toBe(false);
  });
  it('error texts', () => {
    expect(emailError('bob', 'mail.com')).toBeNull();
    expect(emailError('bob', 'x')).toBe('TID_MISSION64_SINTAX_ERROR');
    expect(emailError('bob', 'domain.com')).toBe('TID_MESSION64_POPUPERROR3');
  });
});

describe('cross promotion', () => {
  const m = parseCrossPromos('<d><Definition sku="1" image="logomma" url="http://a/?x=1&amp;y=2" /><Definition sku="21" image="logozombie" url="u" tidTitle="TID_UNLOCK_ZL_TITLE" tidBody="TID_UNLOCK_ZL_BODY" /></d>');
  it('defaults to the MMA texts', () => {
    expect(m.get('1')).toMatchObject({ tidTitle: DEFAULT_TID.title, url: 'http://a/?x=1&y=2' });
    expect(m.get('21')?.tidTitle).toBe('TID_UNLOCK_ZL_TITLE');
  });
});

describe('journal cover', () => {
  it('NewsPaper frames: reveal at totalFrames-15, back from frame 20', () => {
    expect(coverTimeline(33)).toEqual({ reveal: 17, last: 32, reverseFrom: 19 });
  });
});

describe('connection errors', () => {
  it('logout reasons', () => {
    expect(logoutTid('update_version')).toBe('TID_CONNECTIVITY_SERVER_JUST_UPDATED');
    expect(logoutTid('whatever')).toBe('TID_GENERIC_ERROR');
  });
});
