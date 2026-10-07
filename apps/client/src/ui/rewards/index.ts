import type { UiContext } from '../context';
import { mountCollectibles } from './collectibles';
import { mountDailyBonus } from './dailybonus';

/** Daily bonus, collectibles, gifts/offers (feature-inventory sections 7 and 8). */
export async function mount(ctx: UiContext): Promise<void> {
  await mountCollectibles(ctx);
  await mountDailyBonus(ctx);
}
