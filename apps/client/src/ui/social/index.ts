import type { UiContext } from '../context';
import { mountInvest } from './invest';
import { mountOwnerUpgrades } from './owner-upgrades';
import { VisitController } from './visit';

/** Upgrades/visitors/neighbors, wonders/crew, investments (feature-inventory sections 9-11). */
export async function mount(ctx: UiContext): Promise<void> {
  const visit = new VisitController(ctx);
  await visit.init();
  await mountOwnerUpgrades(ctx);
  await mountInvest(ctx);
  (window as unknown as { __visit?: VisitController }).__visit = visit;
}
