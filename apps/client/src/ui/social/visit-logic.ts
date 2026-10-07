// Pure rules of the visitor upgrade mechanic (social.xml + UpgradesManager/StateOnRentVisitor).
export const UPGRADE_REWARD = { coins: 100, exp: 10 }; // social.xml upgradesVisitorDCCoinsPerUpgrade / ExpPerUpgrade
export const OWNER_EXTRA_PERCENT = 10; // upgradesOwnerExtraPercentage
export const MAX_UPGRADES_PER_VISIT = 5; // upgrade_maximunOf_items

/** ItemDefinition.isUpgradeAllowed (houses that are not headquarters) + StateOnRentVisitor.doIsMouseOverEnabled. */
export function upgradeEligible(sku: string, stateId: number, left: number, alreadyUpgraded: boolean): boolean {
  return sku.startsWith('houses_') && stateId === 1 && left > 0 && !alreadyUpgraded;
}

export interface UpgradeList {
  available: number;
  /** sid -> visitor ext ids */
  bySid: Map<string, string[]>;
  sidsBy(extId: string): string[];
}

/** get_upgrades_list: {upgradesList:[{upgrade, sid, extId}...], upgradesUniverseAvailable}. */
export function parseUpgradeList(dat: Record<string, unknown> | undefined): UpgradeList {
  const bySid = new Map<string, string[]>();
  const list = (dat?.upgradesList as Array<Record<string, unknown>> | undefined) ?? [];
  for (const e of list) {
    if (!('upgrade' in e)) continue;
    const sid = String(e.sid ?? '');
    const l = bySid.get(sid) ?? [];
    l.push(String(e.extId ?? ''));
    bySid.set(sid, l);
  }
  return {
    available: Number(dat?.upgradesUniverseAvailable ?? 0) || 0,
    bySid,
    sidsBy: (extId) => [...bySid.entries()].filter(([, v]) => v.includes(extId)).map(([k]) => k),
  };
}
