import { popups } from '../../gui/popup';
import type { UiContext } from '../context';

/**
 * The original stage is NO_SCALE (Dollars.as:92) so the HUD stays 1:1; only popups are enlarged on big viewports so the
 * 760px-wide boxes do not look tiny at 1920x1080 (1.0 up to 1280x800, max 1.35).
 */
export function popupScaleFor(w: number, h: number): number {
  return Math.max(1, Math.min(1.35, Math.min(w / 1280, h / 800)));
}

export function mountScale(_ctx: UiContext): void {
  const apply = () => { popups.scale = popupScaleFor(window.innerWidth, window.innerHeight); };
  apply();
  window.addEventListener('resize', apply);
}
