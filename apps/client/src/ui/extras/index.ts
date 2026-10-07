import type { UiContext } from '../context';
import { mount as mountConnection } from './connection';
import { mountBubbles } from './bubbles';
import { mountCrossPromotion } from './crosspromo';
import { mountGold } from './gold';
import { mountJournal } from './journal';
import { mountPlane } from './plane';
import { mountRivals } from './rivals';
import { mountQuality } from './quality';
import { mountScale } from './scale';
import { mountWelcome } from './welcome';

/** Extras: connection errors, gold purchase, journal, welcome-back, quality, UI scaling (feature-inventory 5, 6.2, 12, 13). */
export async function mount(ctx: UiContext): Promise<void> {
  mountConnection(ctx);
  mountGold(ctx);
  mountJournal(ctx);
  mountQuality();
  mountScale(ctx);
  mountCrossPromotion(ctx);
  void mountBubbles(ctx).catch(() => undefined);
  void mountRivals(ctx).catch((e) => console.error('rivals', e));
  void mountPlane(ctx).catch(() => undefined);
  void mountWelcome(ctx).catch(() => undefined);
}
