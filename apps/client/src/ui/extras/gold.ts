// Gold popup (PopupGold.as). The original sold gold packages for Facebook credits; here gold cannot be bought: the "Add" buttons only
// explain how to earn it (level-ups, missions, the daily bonus). The server still understands update_money buyGold for old clients.
import { getText } from '../../gui/i18n';
import { StandardPopup } from '../../gui/popups';
import { uiBus } from '../bus';
import type { UiContext } from '../context';

const WAYS_TO_EARN = [
  'Level up: every new level pays gold.',
  'Complete missions: many rewards include gold.',
  'Claim the daily bonus every day you play.',
  'Collect special drops that appear on your buildings.'
];

export function mountGold(_ctx: UiContext): void {
  let open = false;
  uiBus.on('openAddGold', async () => {
    if (open) return;
    open = true;
    const body = document.createElement('div');
    body.style.cssText = 'width:420px;font:800 15px Nunito,sans-serif;color:#003242;text-align:left';
    body.innerHTML = `<div style="margin-bottom:8px;text-align:center">Gold cannot be bought. Earn it by playing:</div><ul style="margin:0;padding-left:22px;line-height:1.5">${WAYS_TO_EARN.map((w) => `<li>${w}</li>`).join('')}</ul>`;
    const popup = await StandardPopup.create(getText('TID_POPUP_GOLD_TITLE'), body, { w: 440, h: 215 });
    popup.on('close', () => { open = false; });
    popup.show();
  });
}
