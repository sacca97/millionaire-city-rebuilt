// Error / disconnect popups for the command-queue events.
// Original: DollarsGame.externalRequest (flow/DollarsGame.as:478-518) -> ShowPopup.show (model/ShowPopup.as:119-134),
// PopupConnection.as (PopupNetworkBusy: no button; GamePlayConnection has OK), PopupOutOfSync.as (OK -> TASK_BROWSER_REFRESH = page reload).
import { Button } from '../../gui/button';
import { getText } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import type { UiContext } from '../context';

const CLS = 'com.dchoc.framework.utils.AssetManager_';

/** Which TID to show for a logout reason (DollarsGame.as:488-509). */
export function logoutTid(reason: string): string {
  if (reason === 'world') return 'TID_LOAD_CITY_ERROR';
  if (reason === 'update_version') return 'TID_CONNECTIVITY_SERVER_JUST_UPDATED';
  if (reason === 'syncNotMatch' || /msgCount|sync/i.test(reason)) return 'TID_CONNECTIVITY_SERVER_MULTIPLE_SESSIONS';
  if (reason === 'security') return 'TID_CONNECTIVITY_ERROR';
  return 'TID_GENERIC_ERROR';
}

async function open(cls: string, textPath: string, text: string, okPath?: string, onOk?: () => void): Promise<Popup> {
  const w = await Widget.create('Dollars', CLS + cls);
  const p = new Popup(w);
  p.closeOnEscape = false;
  for (const n of ['plots_info', 'locked']) w.find(n)?.setVisible(false);
  w.setText(textPath, text, { fit: true });
  if (okPath && w.find(okPath)) {
    const b = new Button(w.part(okPath));
    b.onClick(() => (onOk ? onOk() : p.close()));
  }
  p.show();
  return p;
}

export function mount(ctx: UiContext): void {
  let busy: Popup | undefined;
  ctx.game.queue.on((e) => {
    if (e.type === 'pause') {
      // REQ_GAME_PLAY_PAUSE: "network busy" popup without button (blocks input until resume)
      if (!busy) void open('PopupConnection', 'TextInfo_01', getText('TID_CONNECTIVITY_NETWORK_BUSY')).then((p) => (busy = p));
    } else if (e.type === 'resume') {
      busy?.close(); // REQ_GAME_PLAY_RESUME -> ShowPopup.close
      busy = undefined;
    } else if (e.type === 'logout' || e.type === 'desync') {
      busy?.close();
      busy = undefined;
      // smInstance.mEnabled = false: the original stops the game; OK reloads the page.
      void open('PopupOutOfSync', 'text_body', getText(logoutTid(e.reason)), 'OkButton', () => location.reload());
    }
  });
  // Server-sent logout (UserDataFacadeOnline.as:1500-1580: command logOut with _dat.type, e.g. update_version / syncNotMatch).
  ctx.game.queue.on((e) => {
    if (e.type === 'response' && (e.command._cmd === 'logOut' || e.command._cmd === 'logKO')) {
      const type = String((e.command._dat as Record<string, unknown> | undefined)?.type ?? '');
      void open('PopupOutOfSync', 'text_body', getText(logoutTid(type)), 'OkButton', () => location.reload());
    }
  });
}
