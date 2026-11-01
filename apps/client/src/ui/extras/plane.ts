// The plane that flies over the city with the city name (utils/particles/Plane.as, started by DollarsGame.as:1630-1637 on entering
// the run state, and again by PopupCollectibleManager.as:159-166 when a plane collection reward is claimed).
//  - static planes (plain.swf: plain, plane_02, plane_03): clip `<sku>` with a `Tail` child whose `Caption` text = city name; enters at the
//    right edge of the visible map and moves left PLANE_SPEED=5 px per logic frame until it has left the screen (Plane.logicUpdate :119-140).
//  - plane_04 is `isAnimated` (Plane.as:186): class `plane` of plane_show.swf, a 276-frame timeline starting at (1528, 933) that removes itself at its last frame.
// Approximation: the original draws the tail through a wave-simulating Flag (utils/effects/Flag.as); here the tail is a flat banner.
import { getText } from '../../gui/i18n';
import { popups } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import { localBounds } from '../../gui/widget';
import type { UiContext } from '../context';
import { ClipPlayer } from './clip';
import { definitions } from './xml';
import { mapHolder, visibleWorldRect } from './maplayer';

export const PLANE_SPEED = 5; // px per logic frame (Plane.PLANE_SPEED)
export const LOGIC_FPS = 25; // stage frame rate the original logic update runs at
export const ANIMATED_PLANE = 'plane_04';
const ANIMATED_START = { x: 1528, y: 933 }; // Plane.start isAnimated :74-76

export const isAnimatedPlane = (sku: string): boolean => sku === ANIMATED_PLANE;

/** Class name inside plain.swf for a profile planeSku ("plain" default, plane_02, plane_03). */
export function plainClassFor(sku: string): string {
  return ['plane_02', 'plane_03', 'plane_04'].includes(sku) ? sku : 'plain';
}

/** x after `dtMs` of flight (moving left at PLANE_SPEED px per logic frame). */
export function planeX(x: number, dtMs: number): number {
  return x - (PLANE_SPEED * LOGIC_FPS * dtMs) / 1000;
}

/** Plane.logicUpdate end condition: the plane is gone once its right edge has left the visible area. */
export function planeGone(x: number, width: number, visibleLeft: number): boolean {
  return x <= visibleLeft - width;
}

/** collectiblesGroupsDefinitions.xml: group sku -> plane reward sku. */
export function parsePlaneRewards(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of definitions(xml)) if (d.rewardType === 'plane') out.set(d.sku, d.reward);
  return out;
}

let flying = false;

/** Plane.isActive: a plane (start-up or reward) is in the air. */
export const isPlaneFlying = (): boolean => flying;

/**
 * PopupCollectibleManager.claimReward, TYPE_PLANE branch (:159-165): only when no plane is active, setPlane stores Profile.planeSku
 * and the plane flies; the caller continues (GET_REWARD, celebrate popup) when it has left (Plane.EVENT_OPEN_POPUPCOLLECTIBLEGROUP).
 * Resolves false, doing nothing, while another plane is flying.
 */
export async function flyRewardPlane(ctx: UiContext, sku: string): Promise<boolean> {
  if (flying) return false;
  ctx.game.state.profile.raw.planeSku = sku;
  await flyPlane(ctx, sku, ctx.game.state.profile.cityName).catch(() => undefined);
  return true;
}

export async function flyPlane(ctx: UiContext, sku: string, cityName: string): Promise<void> {
  if (flying) return;
  flying = true;
  const holder = mapHolder(ctx);
  try {
    if (isAnimatedPlane(sku)) {
      const player = await ClipPlayer.create('plane_show', 'plane', {
        decorate: (w) => w.find('Tail.Caption')?.setText(cityName, { fit: true })
      });
      player.host.style.transform = `translate(${ANIMATED_START.x}px,${ANIMATED_START.y}px)`;
      holder.appendChild(player.host);
      await player.play();
      player.destroy();
      return;
    }
    const w = await Widget.create('plain', plainClassFor(sku));
    w.find('Tail.Caption')?.setText(cityName, { fit: true });
    const b = localBounds(w.node, true) ?? [0, 0, 354, 100];
    const width = b[2] - b[0];
    const el = w.root;
    el.style.pointerEvents = 'none';
    holder.appendChild(el);
    let x = visibleWorldRect(ctx).right;
    const y = ANIMATED_START.y - (b[3] - b[1]) / 2;
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const step = (now: number): void => {
        // DollarsGame.as:1901-1910: mPlane.pause() while a popup is shown (the oracle's plane only flies once the daily-prize popup closed).
        x = popups.isAnyOpen ? x : planeX(x, now - last);
        last = now;
        el.style.transform = `translate(${x}px,${y}px)`;
        if (planeGone(x, width, visibleWorldRect(ctx).left)) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    w.destroy();
  } finally {
    flying = false;
  }
}

export async function mountPlane(ctx: UiContext): Promise<void> {
  const profile = ctx.game.state.profile;
  const sku = String(profile.raw.planeSku || 'plain');
  const name = profile.cityName || getText('TID_INITIAL_CITY_NAME');
  // RonaldsCity (the tutorial) skips the plane; it flies once the run state starts for the owner (DollarsGame.as:1584-1637).
  const start = (): void => {
    if (ctx.game.tutorial) window.setTimeout(start, 1000);
    else void flyPlane(ctx, sku, name).catch(() => undefined);
  };
  window.setTimeout(start, 1500);

}
