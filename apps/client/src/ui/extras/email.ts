// "Give your e-mail" mission popup (GUI/PopupEmail.as, Missions.swf popup_mission_Email_0<boss>), opened by
// MissionObjectManager.openDescription for `giveEmail` missions (:461-468).
// Original flow: user + domain fields, legal checkbox, OK validates (TextManager.isMail, "domain" placeholder check) and registers the address
// with the Digital Chocolate CRM (wcrm /registration/register); the mission becomes REACHED later when CheckConfirmEmail sees the confirmation
// (checkmail 0 UNCHECKED -> 1 CHECKING -> 2 CHECKED; mission 64). Offline-safe equivalent: nothing is sent anywhere, the address is only kept in
// localStorage, and the confirmation is immediate (the original's OFFLINE_GAMEPLAY_MODE reads a static checkMail.html the same way).
import { Button } from '../../gui/button';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { createConfirmPopup } from '../../gui/popups';
import { Widget } from '../../gui/widget';
import type { MissionObject } from '../../game/missions';
import type { UiContext } from '../context';
import { fillRewardContainer } from '../missions/art';
import { SKU, missionDescription, missionTitle } from '../missions/logic';

export const MAIL_CHECKED = 2;
export const MAIL_CHECKING = 1;
export const MAIL_UNCHECKED = 0;
export const MAIL_USER_RESTRICT = /[^A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]/g; // PopupEmail.RESTRINCTION_CHARS
export const MAIL_DOMAIN_RESTRICT = /[^A-Za-z0-9._]/g;

/** TextManager.isMail (TextManager.as:84-120). */
export function isMail(s: string | null | undefined): boolean {
  if (!s || s === 'null' || s === 'undefined') return false;
  const at = s.indexOf('@');
  if (at === -1 || at !== s.lastIndexOf('@')) return false;
  const [user, domain] = s.split('@');
  if (user.length < 1) return false;
  if (!domain.includes('.') || domain.length < 1) return false;
  const parts = domain.split('.');
  const tld = parts[parts.length - 1];
  if (domain.length - tld.length < 4) return false;
  return tld.length >= 2 && tld.length <= 4;
}

/** PopupEmail.checkMail error text (TID) for the current fields, or null when the address can be accepted. */
export function emailError(user: string, domain: string): string | null {
  if (!isMail(`${user}@${domain}`)) return 'TID_MISSION64_SINTAX_ERROR';
  if (domain.indexOf('domain') > -1) return 'TID_MESSION64_POPUPERROR3';
  return null;
}

function field(w: Widget, name: string, initial: string, restrict: RegExp): HTMLInputElement {
  const part = w.part(name);
  const b = part.node.text?.bounds ?? [0, 0, 200, 22];
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.className = 'g-input';
  input.style.cssText = `position:absolute;left:${part.x + b[0]}px;top:${part.y + b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px;box-sizing:border-box;pointer-events:auto;font:${part.node.text?.size ?? 18}px "Lilita One","Challenge Bold LET",sans-serif;color:${part.node.text?.color ?? '#003242'};background:transparent;border:0;outline:0;padding:0 4px`;
  part.hide();
  w.root.appendChild(input);
  input.addEventListener('click', () => {
    if (input.dataset.cleared !== '1') {
      input.dataset.cleared = '1';
      input.value = ''; // onMailUserClick / onMailDomainClick clear the sample text once
    }
  });
  input.addEventListener('input', () => { input.value = input.value.replace(restrict, ''); });
  return input;
}

export async function openEmailPopup(ctx: UiContext, obj: MissionObject, hooks: { onConfirmed?: (email: string) => void; onClose?: () => void } = {}): Promise<Popup> {
  const boss = Number(ctx.game.state.profile.raw.bossGenre ?? 0) === 1 ? 2 : 1;
  const w = await Widget.create(SKU, `popup_mission_Email_0${boss}`);
  const p = new Popup(w);
  w.setText('Reward', getText('TID_GEN_REWARD') + getText('TID_ESPACIO2PUNTOS'));
  w.setText('Title', missionTitle(obj.def));
  const info = w.part('TextInfo');
  info.setText(missionDescription(obj.def, true), { fit: true });
  w.find('Email1')?.setText(getText('TID_MISSION64_ENTER_EMAIL'), { fit: true });
  await fillRewardContainer(w, obj.def.rewards);

  const user = field(w, 'NameEmail1', 'example', MAIL_USER_RESTRICT);
  const domain = field(w, 'DomainEmail1', 'domain.com', MAIL_DOMAIN_RESTRICT);
  const conditions = w.part('checkBoxText').find('Conditions');
  conditions?.setText(getText('TID_MISSION64_CHECK_LEGAL_TEXT'), { fit: true });
  conditions?.el.style.setProperty('text-decoration', 'underline');

  // legal checkbox: toggles the checked mark; OK needs a checked box and a typed user name (onCheckPressed/onCheckMail)
  const box = w.part('CheckBox');
  const mark = document.createElement('div');
  mark.textContent = '✓';
  mark.style.cssText = 'position:absolute;left:1px;top:-6px;font:bold 20px Arial,sans-serif;color:#003242;display:none;pointer-events:none';
  box.el.appendChild(mark);
  const hit = document.createElement('div');
  hit.style.cssText = 'position:absolute;left:-2px;top:-6px;width:24px;height:24px;cursor:pointer;pointer-events:auto';
  box.el.appendChild(hit);
  let checked = false;
  const ok = new Button(w.part('Done'));
  const refresh = (): void => {
    mark.style.display = checked ? 'block' : 'none';
    if (checked && user.value !== '') ok.enable();
    else ok.disable();
  };
  hit.addEventListener('click', () => { checked = !checked; refresh(); });
  user.addEventListener('input', refresh);
  ok.disable();

  ok.onClick(() => {
    const err = emailError(user.value, domain.value);
    if (err) {
      info.setText(getText(err), { fit: true });
      info.setTextColor('#ff0000');
      return;
    }
    const address = `${user.value}@${domain.value}`;
    try { localStorage.setItem('mcity.email', address); } catch { /* storage unavailable */ }
    ctx.game.sendCommand(ctx.game.commands.checkmail(MAIL_CHECKED)); // CheckConfirmEmail.checkStatus: confirmed
    hooks.onConfirmed?.(address);
    p.accept(); // closeDescriptionEmail: close + advice message
  });
  p.wireClose(new Button(w.part('mClose')));
  p.on('accept', () => {
    // closeDescriptionEmail: the small message popup with the advice to confirm the address
    void createConfirmPopup({ title: '', body: t('TID_MISSION64_EMAIL_ADVICE', [`${user.value}@${domain.value}`]), buttons: [] }).then((m) => m.show());
  });
  p.on('close', () => hooks.onClose?.());
  p.show();
  return p;
}
