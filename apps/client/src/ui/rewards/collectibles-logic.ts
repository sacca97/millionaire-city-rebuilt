// Pure model of the collectibles system (collectibles/CollectibleManager.as, CollectibleGroupObject.as, CollectibleObject.as).
// Server document (get_collectibles_list): Objects@skus "sku:count,...", Rewards@skus "groupSku,...", Pending@tupla "sid:sku,...".

export interface CollectibleDef {
  sku: string;
  tid: string;
  /** 1-based slot inside its collection (orderInCollection). */
  order: number;
  collection: string;
  priceCoins: number;
  priceCash: number;
  priceFBC: number;
}

export interface GroupDef {
  sku: string;
  tid: string;
  reward: string;
  rewardType: string;
  requirements?: string;
  order: number;
  tradeIn: boolean;
  commerce: boolean;
  icon?: string;
}

export interface RewardDef {
  sku: string;
  tid: string;
  rewardType: string;
  value?: string;
}

/** CollectibleGroupObject.STATE_* */
export const GroupState = { LOCKED: 0, INCOMPLETED: 1, PENDING_TO_GET_REWARD: 2, COMPLETED: 3 } as const;
export type GroupStateValue = (typeof GroupState)[keyof typeof GroupState];

export const MAX_UNITS = 99; // settings collectibleMaxUnitsPerItem
export const UNLOCK_LEVEL = 6; // settings collectibleUnlockLevel

export class CollectibleStore {
  counts = new Map<string, number>();
  claimed = new Set<string>();
  pending = new Map<string, string>();
  readonly byGroup = new Map<string, CollectibleDef[]>();

  constructor(
    readonly defs: Map<string, CollectibleDef>,
    readonly groups: GroupDef[],
    readonly rewards: Map<string, RewardDef>,
  ) {
    for (const d of defs.values()) {
      const l = this.byGroup.get(d.collection) ?? [];
      l.push(d);
      this.byGroup.set(d.collection, l);
    }
    for (const l of this.byGroup.values()) l.sort((a, b) => a.order - b.order);
  }

  /** CollectibleManager.build: parse the three server attributes. */
  load(skus: string, rewards: string, tupla: string): void {
    this.counts.clear();
    this.claimed.clear();
    this.pending.clear();
    for (const e of skus.split(',')) {
      if (!e) continue;
      const [sku, c] = e.split(':');
      const n = c === undefined ? 1 : Number(c);
      if (n > 0 && this.defs.has(sku)) this.counts.set(sku, Math.min(n, MAX_UNITS));
    }
    for (const g of rewards.split(',')) if (g) this.claimed.add(g);
    for (const e of tupla.split(',')) {
      if (!e) continue;
      const [sid, sku] = e.split(':');
      if (sid && sku && this.defs.has(sku)) this.pending.set(sid, sku);
    }
  }

  count(sku: string): number {
    return this.counts.get(sku) ?? 0;
  }

  group(sku: string): GroupDef | undefined {
    return this.groups.find((g) => g.sku === sku);
  }

  members(groupSku: string): CollectibleDef[] {
    return this.byGroup.get(groupSku) ?? [];
  }

  /** CollectibleGroupObject.checkState: every member collected at least once. */
  isComplete(groupSku: string): boolean {
    const m = this.members(groupSku);
    return m.length > 0 && m.every((d) => this.count(d.sku) > 0);
  }

  /**
   * Derived group state. LOCKED until the required group's reward was claimed; a claimed non-reclaimable group is COMPLETED;
   * reclaimable (trade-in) groups go back to INCOMPLETED / PENDING depending on the remaining units (tradeIn()).
   */
  state(groupSku: string): GroupStateValue {
    const g = this.group(groupSku);
    if (!g) return GroupState.LOCKED;
    if (g.requirements && !this.claimed.has(g.requirements)) return GroupState.LOCKED;
    if (this.claimed.has(g.sku) && !g.tradeIn) return GroupState.COMPLETED;
    return this.isComplete(g.sku) ? GroupState.PENDING_TO_GET_REWARD : GroupState.INCOMPLETED;
  }

  canKeep(sku: string): boolean {
    return this.count(sku) < MAX_UNITS;
  }

  canGiveAway(sku: string): boolean {
    return this.count(sku) > 1;
  }

  /** wouldThisCollectibleCompleteTheGroup */
  wouldComplete(sku: string): boolean {
    const d = this.defs.get(sku);
    if (!d) return false;
    return this.members(d.collection).every((m) => (m.sku === sku ? this.count(m.sku) === 0 : this.count(m.sku) > 0));
  }

  /** keepCollectible(sku, true): +1 unit (capped). Returns true when this completed a not-yet-complete group. */
  keep(sku: string): { completedGroup?: string } {
    const d = this.defs.get(sku);
    if (!d) return {};
    const was = this.state(d.collection);
    if (this.canKeep(sku)) this.counts.set(sku, this.count(sku) + 1);
    const now = this.state(d.collection);
    return was === GroupState.INCOMPLETED && now === GroupState.PENDING_TO_GET_REWARD ? { completedGroup: d.collection } : {};
  }

  /** CollectibleManager.sellItem: coins paid for one unit (the pending drop is never added). */
  sellValue(sku: string): number {
    return this.defs.get(sku)?.priceCoins ?? 0;
  }

  /** claimReward -> tradeIn(): mark claimed; reclaimable groups consume one unit of each member. */
  claim(groupSku: string): void {
    const g = this.group(groupSku);
    if (!g) return;
    if (g.tradeIn) {
      for (const m of this.members(groupSku)) {
        const c = this.count(m.sku) - 1;
        if (c <= 0) this.counts.delete(m.sku);
        else this.counts.set(m.sku, c);
      }
    }
    this.claimed.add(groupSku);
  }

  removePending(sid: string): string | undefined {
    const s = this.pending.get(sid);
    this.pending.delete(sid);
    return s;
  }

  /** Groups of a tab: vault = commerce groups, collections = house groups (PopupCollectables.getCollections/getCommerceCollections). */
  tab(commerce: boolean): GroupDef[] {
    const rank = (g: GroupDef) => {
      const s = this.state(g.sku);
      return s === GroupState.LOCKED ? 1 : s === GroupState.COMPLETED ? 2 : 0; // fillTabs: unlocked, locked, completed
    };
    return this.groups
      .filter((g) => g.commerce === commerce)
      .sort((a, b) => rank(a) - rank(b) || a.order - b.order);
  }
}

/** Parses the three rules files. */
export function buildStore(
  collectibles: Array<Record<string, string>>,
  groups: Array<Record<string, string>>,
  rewards: Array<Record<string, string>>,
): CollectibleStore {
  const defs = new Map<string, CollectibleDef>();
  for (const a of collectibles) {
    defs.set(a.sku, {
      sku: a.sku, tid: a.tid, order: Number(a.orderInCollection), collection: a.collection,
      priceCoins: Number(a.priceCoins) || 0, priceCash: Number(a.priceCash) || 0, priceFBC: Number(a.priceFBC) || 0,
    });
  }
  const gdefs: GroupDef[] = groups.map((a) => ({
    sku: a.sku, tid: a.tid, reward: a.reward, rewardType: a.rewardType, requirements: a.requirements || undefined,
    order: Number(a.order) || 0, tradeIn: a.tradein === '1', commerce: a.commerce === '1', icon: a.icon,
  }));
  const rdefs = new Map<string, RewardDef>();
  for (const a of rewards) rdefs.set(a.sku, { sku: a.sku, tid: a.tid, rewardType: a.rewardType, value: a.value });
  return new CollectibleStore(defs, gdefs, rdefs);
}

/** "set" reward value "cash:coins:exp" (PopupCollectibleManager.showCelebratePopup). */
export function parseSetReward(value: string | undefined): { cash: number; coins: number; exp: number } {
  const [cash, coins, exp] = (value ?? '').split(':').map((x) => Number(x) || 0);
  return { cash: cash ?? 0, coins: coins ?? 0, exp: exp ?? 0 };
}
