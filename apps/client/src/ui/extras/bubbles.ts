// Transient map bubbles above buildings: the houses_info `Event_*` clips the original adds to an item's layer.
//  - Event_Start_Income "Contract signed" when a house starts renting     (StateOnRent.setMode MODE_RENTING, contractAddView(CONTRACT_SIGN_END_ID), :608-612;
//                                                                         text TID_CONTRACT_SIGNED set by contractSignEndCheckEnd :934-947)
//  - Event_Start_Income "Connected to road" when a suspended item reconnects (ItemObject.viewAttach VIEW_CONNECTED_TO_ROAD :2165-2185, TID_HOUSE_CONNECTED)
//  - Event_Empty_House (looping) while a house is abandoned                (StateOnRent MODE_ABANDONED :730-733) and Event_Empty_House_Ok on reset (:735-738)
// Clips are centred on the footprint (mWorldX + baseWidth>>1, mWorldY + baseHeight>>1). The map overlay is a DOM layer that follows the
// Pixi world transform every frame, so view/city.ts needs no change. Mission icons are HUD-only in the original (MissionsIconLayerDisplay
// adds them to the hud), so there are no mission/NPC bubbles on the map.
import { TILE } from '../../game/geometry';
import { getText } from '../../gui/i18n';
import { RENT_MODE, STATE_ID } from '../../net/commands';
import type { UiContext } from '../context';
import { ClipPlayer } from './clip';
import { mapHolder, onMapFrame } from './maplayer';

export type BubbleKind = 'contractSigned' | 'connected' | 'abandoned' | 'abandonReset';

export interface Snap {
  stateId: number;
  mode: number;
  suspended: boolean;
  isCommerce: boolean;
}

export const BUBBLE_SPEC: Record<BubbleKind, { cls: string; tid?: string; loop: boolean }> = {
  contractSigned: { cls: 'Event_Start_Income', tid: 'TID_CONTRACT_SIGNED', loop: false },
  connected: { cls: 'Event_Start_Income', tid: 'TID_HOUSE_CONNECTED', loop: false },
  abandoned: { cls: 'Event_Empty_House', loop: true },
  abandonReset: { cls: 'Event_Empty_House_Ok', loop: false }
};

const SIGNING_MODES: number[] = [RENT_MODE.WAITING_FOR_CONTRACT, RENT_MODE.SIGNING_CONTRACT, RENT_MODE.WAITING_FOR_TURN_TO_SIGN_CONTRACT, RENT_MODE.POSTPONING_SET_MODE, RENT_MODE.NONE];

/** Which bubble (if any) a state change from `prev` to `cur` triggers. Pure. */
export function bubbleTransition(prev: Snap | undefined, cur: Snap): BubbleKind | null {
  if (!prev) return null;
  const rent = cur.stateId === STATE_ID.RENT;
  if (rent && prev.stateId === STATE_ID.RENT) {
    // houses only: commerces start income without the sign animation (_loc15_ = !isACommerce)
    if (!cur.isCommerce && cur.mode === RENT_MODE.RENTING && SIGNING_MODES.includes(prev.mode)) return 'contractSigned';
    if (cur.mode === RENT_MODE.ABANDONED && prev.mode !== RENT_MODE.ABANDONED) return 'abandoned';
    if (prev.mode === RENT_MODE.ABANDONED && (cur.mode === RENT_MODE.WAITING_FOR_CONTRACT || cur.mode === RENT_MODE.RESETING_ABANDONED)) return 'abandonReset';
  }
  if (prev.suspended && !cur.suspended && (rent || cur.stateId === STATE_ID.BUILT)) return 'connected';
  return null;
}

export const isAbandoned = (s: Snap): boolean => s.stateId === STATE_ID.RENT && s.mode === RENT_MODE.ABANDONED;

export async function mountBubbles(ctx: UiContext): Promise<void> {
  const holder = mapHolder(ctx);

  const snaps = new Map<string, Snap>();
  const persistent = new Map<string, ClipPlayer>();
  const pending = new Set<string>(); // looping bubbles being created

  const place = (sid: string, p: ClipPlayer): boolean => {
    const it = ctx.game.item(sid);
    if (!it) return false;
    p.host.style.transform = `translate(${(it.tileX + it.cols / 2) * TILE}px,${(it.tileY + it.rows / 2) * TILE}px)`;
    holder.appendChild(p.host);
    return true;
  };

  const spawn = async (sid: string, kind: BubbleKind): Promise<void> => {
    const spec = BUBBLE_SPEC[kind];
    if (spec.loop) pending.add(sid);
    const player = await ClipPlayer.create('houses_info', spec.cls, {
      loop: spec.loop,
      decorate: (w) => {
        const cap = w.find('Caption');
        if (cap && spec.tid) cap.setText(getText(spec.tid), { fit: true });
      }
    });
    if (spec.loop) pending.delete(sid);
    const now = snaps.get(sid);
    if (spec.loop && (!now || !isAbandoned(now))) return player.destroy();
    if (!place(sid, player)) return player.destroy();
    if (spec.loop) {
      persistent.get(sid)?.destroy();
      persistent.set(sid, player);
      void player.play();
    } else {
      void player.play().then(() => player.destroy());
    }
  };

  const scan = (): void => {
    const seen = new Set<string>();
    for (const it of ctx.game.items()) {
      seen.add(it.sid);
      const cur: Snap = { stateId: it.stateId, mode: it.mode, suspended: !!it.suspended, isCommerce: it.isCommerce };
      const prev = snaps.get(it.sid);
      snaps.set(it.sid, cur);
      const kind = bubbleTransition(prev, cur);
      if (kind && !(kind === 'abandoned' && pending.has(it.sid))) void spawn(it.sid, kind);
      // abandoned houses at load time also show the looping icon; leaving the mode removes it
      if (isAbandoned(cur) && !persistent.has(it.sid) && !pending.has(it.sid) && kind !== 'abandoned') void spawn(it.sid, 'abandoned');
      if (!isAbandoned(cur)) {
        persistent.get(it.sid)?.destroy();
        persistent.delete(it.sid);
      }
    }
    for (const sid of [...snaps.keys()]) {
      if (seen.has(sid)) continue;
      snaps.delete(sid);
      persistent.get(sid)?.destroy();
      persistent.delete(sid);
    }
  };
  scan();
  window.setInterval(scan, 250);
  // Viewport culling of the looping abandoned-house icons (each is a few hundred DOM nodes animated at the clip rate).
  const CLIP_HALF = 200; // world px around the item centre (bubble art is < 400 px)
  onMapFrame((r) => {
    for (const [sid, p] of persistent) {
      const it = ctx.game.item(sid);
      if (!it) continue;
      const cx = (it.tileX + it.cols / 2) * TILE;
      const cy = (it.tileY + it.rows / 2) * TILE;
      p.setCulled(cx + CLIP_HALF < r.left || cx - CLIP_HALF > r.right || cy + CLIP_HALF < r.top || cy - CLIP_HALF > r.bottom);
    }
  });
}
