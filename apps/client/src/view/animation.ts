// Pure logic: save state -> visual spec, frame selection and timing.
// Ported from ItemObject.as (state clips), StateOnRent.as (frames per mode), StateOnConstruction.as
// and TopLayer.as (icon animation). No Pixi imports so it is unit-testable.

/** StateItemObject.STATE_ON_*_ID. */
export const STATE_ID = {
  CONSTRUCTION: 0,
  RENT: 1,
  SELLING: 2,
  IA: 3,
  HEADQUARTER: 4,
  BUILT: 5,
  DEMOLITION: 6,
  HIRE_CREW: 7
} as const;

/** StateOnRent.MODE_*. */
export const RENT_MODE = {
  NONE: 0,
  WAITING_FOR_CONTRACT: 1,
  SIGNING_CONTRACT: 2,
  CANCELING_CONTRACT: 3,
  RENTING: 4,
  GET_RENT: 5,
  GIVING_RENT: 6,
  ABANDONED: 7,
  RESETING_ABANDONED: 8,
  COLLECTIBLE: 14,
  GIVING_COLLECTIBLE: 15
} as const;

/** Per-item state as stored in the save (<State id mode time>). time is the remaining ms. */
export interface ItemStateInput {
  stateId: number;
  mode: number;
  /** Remaining time in ms (construction or income countdown). */
  time: number;
}

export interface VisualContext {
  isAnimated: boolean;
  isClub: boolean;
  /** Item SWF has its own "building" clip. */
  hasBuildingClip: boolean;
  hasNormal2Clip: boolean;
  /** Total construction time in ms (definition constructionTime minutes). */
  constructionMs: number;
  /** Total income time in ms for the active contract; 0 when unknown. */
  incomeMs: number;
}

export type ClipName = "building" | "normal" | "normal_2" | "generic";
export type IconKind = "contract" | "rent" | "commerce";

export interface VisualSpec {
  clip: ClipName;
  /** 1-based frame to hold, or "loop" to play the clip at the SWF frame rate. */
  frame: number | "loop";
  /** Construction progress 0..1 (draws the bar at BarPosition), undefined otherwise. */
  progress?: number;
  /** Floating TopLayer icon. */
  icon?: IconKind;
  /** Effect_* clips are shown (hidden while under construction). */
  effects: boolean;
}

/** StateOnRent.regla3: integer-truncating a*c/b (AS3 int assignment truncates). */
export const regla3 = (a: number, b: number, c: number): number => Math.trunc((a * c) / b);

/**
 * Frame (1-based) of the `normal` clip while renting (StateOnRent.update, MODE_RENTING):
 * frame = (2 - regla3(time, max, 3)) + 1, clamped to Flash's [1,3]. Frame 4 is the collect frame.
 */
export function rentingFrame(timeMs: number, maxMs: number): number {
  if (maxMs <= 0) {
    return 1;
  }
  const f = 2 - regla3(Math.min(Math.max(timeMs, 0), maxMs), maxMs, 3) + 1;
  return Math.min(3, Math.max(1, f));
}

export function constructionProgress(timeMs: number, totalMs: number): number {
  if (totalMs <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - timeMs / totalMs));
}

/** Index (0-based) of the frame a clip of `count` frames shows at `nowMs`, at `fps`. */
export function loopFrameIndex(nowMs: number, fps: number, count: number): number {
  if (count <= 1 || fps <= 0) {
    return 0;
  }
  return Math.floor((nowMs * fps) / 1000) % count;
}

// TopLayer.as:92-115: icon sprite sheet (4 frames of 75x75) plays 0,1,2,3,2,1.
const ICON_SEQUENCE = [
  { frame: 0, ms: 150 },
  { frame: 1, ms: 130 },
  { frame: 2, ms: 130 },
  { frame: 3, ms: 150 },
  { frame: 2, ms: 130 },
  { frame: 1, ms: 130 }
];
const ICON_CYCLE_MS = ICON_SEQUENCE.reduce((s, e) => s + e.ms, 0);

export function iconFrame(nowMs: number): number {
  let t = ((nowMs % ICON_CYCLE_MS) + ICON_CYCLE_MS) % ICON_CYCLE_MS;
  for (const e of ICON_SEQUENCE) {
    if (t < e.ms) {
      return e.frame;
    }
    t -= e.ms;
  }
  return 0;
}

export function resolveVisual(st: ItemStateInput, ctx: VisualContext, isCommerce = false): VisualSpec {
  const normalLoop = (clip: ClipName = "normal"): VisualSpec => ({
    clip,
    frame: ctx.isAnimated ? "loop" : 1,
    effects: true
  });
  switch (st.stateId) {
    case STATE_ID.CONSTRUCTION:
    case STATE_ID.HIRE_CREW: {
      const progress = constructionProgress(st.time, ctx.constructionMs);
      if (st.stateId === STATE_ID.CONSTRUCTION && st.time <= 0) {
        return normalLoop(); // StateOnConstruction.viewUpdate: time<=0 -> normal clip
      }
      return {
        clip: ctx.hasBuildingClip ? "building" : ctx.isClub ? "normal" : "generic",
        frame: ctx.hasBuildingClip ? "loop" : 1,
        progress,
        effects: false
      };
    }
    case STATE_ID.RENT: {
      // Clubs use normal_2 (STATE_HQ_NORMAL) while waiting for a contract.
      const idle: ClipName = ctx.isClub && ctx.hasNormal2Clip ? "normal_2" : "normal";
      switch (st.mode) {
        case RENT_MODE.RENTING:
          return { clip: "normal", frame: rentingFrame(st.time, ctx.incomeMs), effects: true };
        case RENT_MODE.GET_RENT:
        case RENT_MODE.GIVING_RENT:
          return { clip: "normal", frame: 4, icon: isCommerce ? "commerce" : "rent", effects: true };
        case RENT_MODE.ABANDONED:
          return { clip: "normal", frame: 1, effects: true };
        case RENT_MODE.WAITING_FOR_CONTRACT:
        case RENT_MODE.NONE:
          return { clip: idle, frame: 1, icon: "contract", effects: true };
        default:
          return { clip: idle, frame: 1, effects: true };
      }
    }
    case STATE_ID.HEADQUARTER:
      return normalLoop(ctx.isClub && ctx.hasNormal2Clip ? "normal_2" : "normal");
    default:
      return normalLoop();
  }
}
