// Game event -> sound mapping, mirroring the original (decompiled/scripts/com/dchoc/...).
// The original has NO click / popup-open / construction-done sounds; only the events below.

export type SoundName =
  | 'Main_Music' | 'Ronald_Music' | 'Tutorail_Music'
  | 'Income_Sound' | 'Contract_Sound' | 'Build_Sound' | 'Destroy_Sound' | 'Level_Sound';

export type AudioEvent =
  | 'build_placed' | 'item_moved' | 'item_demolished' | 'collect_rent'
  | 'contract_signed' | 'level_up' | 'reward_click';

// Names: dollars/model/ModelConfig.as:288-304; files: dollars/flow/DollarsGame.as:941-948.
export const EVENT_SOUNDS: Record<AudioEvent, SoundName> = {
  build_placed: 'Build_Sound',      // map/tools/ToolBuild.as:289-291
  item_moved: 'Build_Sound',        // map/tools/ToolMove.as:264-266
  item_demolished: 'Destroy_Sound', // world/items/ItemObject.as:2917-2919 (not for decorations)
  collect_rent: 'Income_Sound',     // world/items/states/StateOnRent.as:1485-1487
  contract_signed: 'Contract_Sound',// world/items/states/StateOnRent.as:448-450
  level_up: 'Level_Sound',          // GUI/PopupLevel.as:220-222
  reward_click: 'Income_Sound',     // GUI/newsfeeds/NewsFeedRewardPresentation.as:96-98 (clickSoundFx in rewardTypesDefinitions.xml)
};

/** Event -> sound, honoring the decoration exception for demolish. */
export function soundForEvent(ev: AudioEvent, opts: { isDecoration?: boolean } = {}): SoundName | null {
  if (ev === 'item_demolished' && opts.isDecoration) return null;
  return EVENT_SOUNDS[ev] ?? null;
}

/** Music choice, flow/DollarsGame.as:1400-1421 (getCurrentMusic). Visiting a friend uses the tutorial track. */
export function musicFor(state: {
  role: 'owner' | 'visitor';
  tutorialDone: boolean;
  ownerIsNpc?: boolean;
}): SoundName {
  if (state.role === 'owner') return state.tutorialDone ? 'Main_Music' : 'Tutorail_Music';
  return state.ownerIsNpc ? 'Ronald_Music' : 'Tutorail_Music'; // SOUND_VISIT_FRIEND = SOUND_TUTORIAL (ModelConfig.as:304)
}

/** Game config 'music'/'sound' -> bool, DollarsGame.as:1106-1121 (missing => on). */
export function parseFlag(v: string | number | undefined | null): boolean {
  if (v === undefined || v === null || v === '') return true;
  return Number(v) !== 0;
}
