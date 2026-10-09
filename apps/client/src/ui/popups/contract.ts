// Contract selection popup. Port of containers/ContractBox(+Single).as, ContractItem.as, InfoBoxContract.as
// (decompiled/scripts/com/dchoc/dollars/...). Art: contracts.swf popup_background_contract / popup_box_contract(+_locked) /
// popup_info_box_(left|right). Items: 3 columns x 2 rows per page (ContractBox.addItem, NUM_ITEMS_PAGE=6).
import { Button } from '../../gui/button';
import { convertNumberToString, convertTimeToString, TRUNCATE_MILLIONS, TRUNCATE_THOUSAND } from '../../gui/format';
import { getText, t, tidIndex } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { confirmDestroy } from './flows';
import { localBounds, Widget } from '../../gui/widget';
import { RENT_MODE, STATE_ID } from '../../net/commands';
import type { ContractOption } from '../../game/game';
import type { UiContext } from '../context';
import { ensureCoins } from './flows';
import { contractSlot } from './logic';

const PAGE = 6;
const open = new Map<string, Popup>();
const opening = new Set<string>();

/** rules/contractsNames.xml order; ContractDefinition.build() maps contract @name -> that entry's tid (TID_CONTRACT<n>, n = 1-based position). */
const CONTRACT_NAMES = ['Tourists', 'Students', 'Family', 'Pensioners', 'Athletes', 'Pilots', 'Hostesses', 'Artists', 'Friends', 'Rock Star', 'Football Star', 'Season Short', 'Season Medium', 'Season Long'];
export function contractName(o: ContractOption): string {
  const i = CONTRACT_NAMES.indexOf(o.name);
  return i >= 0 && tidIndex(`TID_CONTRACT${i + 1}`) >= 0 ? getText(`TID_CONTRACT${i + 1}`) : o.name;
}

async function makeItem(ctx: UiContext, sid: string, o: ContractOption, index: number, host: HTMLElement, parentW: Widget, onSign: (o: ContractOption) => void, popup: Popup): Promise<void> {
  const slot = contractSlot(index);
  const w = await Widget.create('contracts', o.unlocked ? 'popup_box_contract' : 'popup_box_contract_locked');
  // ContractItem.viewBuild
  if (!o.unlocked) {
    w.setText('LevelNeeded', t('TID_DEFINITION_LEVEL', [String(o.level)]));
    w.part('locked').get('LockedText').setText(getText('TID_GEN_LOCKED'));
  }
  if (o.icon !== 'contract_01') {
    try {
      const icon = await Widget.create('contracts', o.icon);
      w.part('contract').append(icon);
    } catch {
      /* icon class missing: leave the default art */
    }
  }
  w.setText('ContractPrize', getText('TID_COIN_SYMBOL') + convertNumberToString(o.cost, TRUNCATE_THOUSAND, 6));
  w.setText('Caption', contractName(o), { fit: true });
  w.setText('Time_Number', convertTimeToString(o.timeMs, true));
  w.part('gold').setVisible(true); // frame 0 (gold.stop())

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;left:0;top:0;transform:translate(${slot.x}px,${slot.y}px);transition:none`;
  const inner = document.createElement('div');
  inner.style.cssText = 'position:absolute;left:0;top:0;transition:transform .05s linear;transform-origin:0 0';
  inner.appendChild(w.root);
  wrap.appendChild(inner);
  const b = localBounds(w.node, true) ?? [-50, -70, 50, 70];
  const hit = document.createElement('div');
  hit.style.cssText = `position:absolute;left:${b[0]}px;top:${b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px;pointer-events:auto;${o.unlocked ? 'cursor:pointer' : ''}`;
  inner.appendChild(hit);
  host.appendChild(wrap);
  hit.dataset.contractIndex = String(index); // the tutorial arrow points at item 0

  if (!o.unlocked) return;
  // ContractItem.as:215-221: during the tutorial only the first contract can be chosen (the others are greyed out)
  if (ctx.game.tutorial && !ctx.game.tutorial.contractAllowed(index)) {
    inner.style.filter = 'grayscale(1)';
    hit.style.pointerEvents = 'none';
    return;
  }
  let info: Widget | undefined;
  let pressed = false;
  const cx = (b[0] + b[2]) / 2;
  const setScale = (s: number) => (inner.style.transform = `scale(${s})`);
  hit.addEventListener('pointerenter', async () => {
    setScale(1.05); // ContractItem.onMouseOver: GTween scale 1 -> 1.05 in 0.05 s
    const right = index % 3 !== 2;
    const iw = await Widget.create('contracts', right ? 'popup_info_box_right' : 'popup_info_box_left');
    if (!hit.matches(':hover')) return;
    iw.setText('Caption', contractName(o), { fit: true });
    iw.setText('Income', getText('TID_SHOP_RENT'));
    iw.setText('XP', getText('TID_SHOP_RENT_XP'));
    iw.setText('Income_Number', getText('TID_COIN_SYMBOL') + convertNumberToString(o.income, TRUNCATE_MILLIONS, 6));
    iw.setText('DailyXP', String(o.xp));
    iw.setText('attendance', getText('TID_CURRENT_STATUS'));
    iw.setText('attendance_number', String(ctx.game.item(sid)?.def.rules.tenants ?? 0));

    iw.root.style.cssText += `;left:0;top:0;transform:translate(${slot.x + (right ? b[2] : b[0])}px,${slot.y + (b[1] + b[3]) / 2 - 20}px);pointer-events:none;z-index:5`;
    info?.destroy();
    info = iw;
    host.appendChild(iw.root);
  });
  hit.addEventListener('pointerleave', () => {
    setScale(1);
    pressed = false;
    inner.style.filter = '';
    info?.destroy();
    info = undefined;
  });
  hit.addEventListener('pointerdown', () => {
    pressed = true;
    inner.style.filter = 'brightness(1.25)'; // ContractItem.onMouseDown ink 50% white
  });
  hit.addEventListener('pointerup', () => {
    inner.style.filter = '';
  });
  hit.addEventListener('click', () => {
    if (!pressed) return;
    info?.destroy();
    onSign(o);
  });
  void popup;
  void parentW;
}

/** DollarsGame.mPopupContract.showPopupParam(item): choose a contract for a house waiting for one. */
export async function openContractPopup(ctx: UiContext, sid: string): Promise<void> {
  const { game } = ctx;
  const item = game.item(sid);
  if (!item || item.stateId !== STATE_ID.RENT || item.mode !== RENT_MODE.WAITING_FOR_CONTRACT || open.has(sid)) return;
  if (opening.has(sid)) return; // HUD actions and the popups area both react to the same selection
  opening.add(sid);
  // ContractBoxSingle.createItems: the order of contractsTypes.xml, NOT sorted (locked high-level contracts such as Pilots / Artists / Football Star
  // sit between the unlocked ones; sorting by level used to move them to the end for 35 of the 36 contract types).
  const options = game.contractOptions(sid);
  if (!options.length) {
    opening.delete(sid);
    return;
  }
  const w = await Widget.create('contracts', 'popup_background_contract');
  const p = new Popup(w);
  open.set(sid, p);
  p.on('close', () => {
    open.delete(sid);
    opening.delete(sid);
  });
  w.setText('Caption', getText('TID_CONTRACT_POPUP_TITLE'));
  const closeBtn = new Button(w.part('mClose'));
  p.wireClose(closeBtn);
  const tutorial = game.tutorial?.active === true; // ContractBox.show (:352-361): cancel disabled, no scrolling
  if (tutorial) {
    closeBtn.disable();
    p.closeOnEscape = false;
  }
  const left = new Button(w.part('mArrowLeft'));
  const right = new Button(w.part('mArrowRight'));
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0';
  w.root.appendChild(host);
  const pages = Math.ceil(options.length / PAGE);
  let page = 0;
  const sign = (o: ContractOption) => {
    // ContractBox.onContract: enough coins -> accept and sign; else exchange gold (single house: startAskForHelpFBCredits).
    void ensureCoins(ctx, o.cost, () => {
      if (game.signContract(sid, o.sku)) p.accept();
    });
  };
  const render = async () => {
    host.replaceChildren();
    left.setEnabled(!tutorial && page > 0);
    right.setEnabled(!tutorial && page < pages - 1);
    const slice = options.slice(page * PAGE, page * PAGE + PAGE);
    for (let i = 0; i < slice.length; i += 1) await makeItem(ctx, sid, slice[i], i, host, w, sign, p);
  };
  left.onClick(() => {
    if (page > 0) {
      page -= 1;
      void render();
    }
  });
  right.onClick(() => {
    if (page < pages - 1) {
      page += 1;
      void render();
    }
  });
  await render();
  p.show();
}

/** StateOnRent.doDoClick MODE_RENTING: confirm cancelling the running contract (PopupConfirmDestroy + TID_CANCEL_CONTRACT). */
export async function confirmCancelContract(ctx: UiContext, sid: string): Promise<void> {
  const p = await confirmDestroy(getText('TID_CANCEL_CONTRACT'), 0, () => ctx.game.cancelContract(sid));
  p.show();
}


