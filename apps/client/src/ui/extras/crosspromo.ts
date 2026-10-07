// Cross-promotion confirm popup (GUI/PopupConfirmMma.as, Missions.swf popup_mission_Mma; rules/crosspromotionDefinitions.xml).
// Original: shop items locked by `unlockCondition="cross_<appId>"` (ItemContentLockCrossPromotion) show "Play <game>" which opens this
// confirm; YES opens the partner game's Facebook URL and, with Config.OFFLINE_GAMEPLAY_MODE, unlocks the item right away (:onUnlock).
// Offline-safe equivalent: no navigation (the partner apps no longer exist); YES/accept just reports the unlock through `onUnlock`.
import { Button } from '../../gui/button';
import { getText } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { definitions } from './xml';

export interface CrossPromo {
  sku: string;
  image: string;
  url: string;
  tidTitle: string;
  tidBody: string;
}

/** Defaults of the first entries (no tidTitle/tidBody attribute) are the MMA texts used by the original popup. */
export const DEFAULT_TID = { title: 'TID_UNLOCK_GYM_TITLE', body: 'TID_UNLOCK_GYM_BODY' };

export function parseCrossPromos(xml: string): Map<string, CrossPromo> {
  const out = new Map<string, CrossPromo>();
  for (const d of definitions(xml)) {
    out.set(d.sku, { sku: d.sku, image: d.image ?? '', url: d.url ?? '', tidTitle: d.tidTitle ?? DEFAULT_TID.title, tidBody: d.tidBody ?? DEFAULT_TID.body });
  }
  return out;
}

let cache: Promise<Map<string, CrossPromo>> | undefined;
const load = (): Promise<Map<string, CrossPromo>> => (cache ??= fetch('/mcity/0.501/Datas/rules/crosspromotionDefinitions.xml').then((r) => r.text()).then(parseCrossPromos));

export async function openCrossPromotion(appId: string | number, onUnlock?: () => void): Promise<Popup | undefined> {
  const def = (await load()).get(String(appId));
  if (!def) return undefined;
  const w = await Widget.create('Missions', 'popup_mission_Mma');
  const p = new Popup(w);
  w.setText('Title', getText(def.tidTitle), { fit: true });
  w.setText('TextInfo', getText(def.tidBody), { fit: true });
  // PopupConfirmMma: logo placeholder swapped for the partner's `logo<game>` class unless it is the default MMA one
  if (def.image !== 'logomma') {
    try {
      const logo = await Widget.create('Missions', def.image);
      const ph = w.part('logo');
      ph.hide();
      logo.root.style.transform = `translate(${ph.x}px,${ph.y}px)`;
      w.root.insertBefore(logo.root, ph.el.nextSibling);
    } catch { /* image class missing: keep the placeholder logo */ }
  }
  const yes = new Button(w.part('YesButton'));
  yes.setLabel(getText('TID_BUTTON_YES'));
  const no = new Button(w.part('NoButton'));
  no.setLabel(getText('TID_BUTTON_NO'));
  yes.onClick(() => {
    onUnlock?.();
    p.accept();
  });
  p.wireClose(no);
  return p.show();
}

export function mountCrossPromotion(_ctx: UiContext): void {
  uiBus.on('openCrossPromotion', ({ appId, onUnlock }) => void openCrossPromotion(appId, onUnlock));
}
