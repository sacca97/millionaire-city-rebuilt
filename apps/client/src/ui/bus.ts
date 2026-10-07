/**
 * UI event bus: the contract between UI areas (hud -> popups/shop/missions/...). The HUD only emits these; the area that
 * owns the matching popup subscribes with `uiBus.on('openContract', ({ sid }) => ...)`.
 */
export interface UiEvents {
  /** Selected item context action "sign contract" (PopupContract / contract picker). */
  openContract: { sid: string };
  /** Build/shop button (DollarsGame.showBuyBox). `tab` is a shop tab id/sku group when known. */
  openShop: { tab?: string };
  openMissions: undefined;
  openOptions: undefined;
  /** Storage / inventory (button_multifuncion_storage). */
  openStorage: undefined;
  /** Vault button: collectibles. */
  openCollectibles: undefined;
  /** Invest button (PopupInvest). */
  openInvest: undefined;
  /** HudOwner.onAddCoins -> PopupExchange (gold -> coins). */
  openExchange: undefined;
  /** HudOwner.onAddCash -> DollarsGame.addGold(). */
  openAddGold: undefined;
  openNews: undefined;
  /** Click on the city-name text in the HUD (rename). */
  openCityName: undefined;
  /** Friends bar: visit a neighbor (userId from the neighbor list; NPC ids included). Visiting is handled elsewhere. */
  visit: { userId: string; name: string; companyValue?: number; photo?: string };
  openInvite: undefined;
  /** Full level-up popup (PopupLevel) belongs to the popups area. */
  levelUp: { level: number; cashReward: number };
  /** Instant build / speed-up popup for a house under construction (popups area). */
  openInstantBuild: { sid: string };
  /** Expansion plot purchase popup (plot index; popups area). Emitted by the for-sale signs on the map. */
  openExpansion: { plot: number };
  /** Plot ownership changed (after a purchase). */
  plotsChanged: undefined;
  /** Rewards area: open the daily bonus popup (also shown automatically at start-up when due). */
  openDailyBonus: undefined;
  /** Social area: a visit started/ended (visitor mode renders another city read-only). */
  visitStarted: { userId: string; name: string; companyValue?: number; photo?: string };
  visitEnded: undefined;
  /** Visitor toolbar/HUD chrome switched on/off (hides the owner-only mission icon column). */
  visitorChrome: { on: boolean };
  /** Social area: popups opened from the HUD/info boxes. */
  openWonders: undefined;
  openCrew: { sid: string };
  /** Missions area: toolbar boss marker (ToolsBar.bossAlertOnChange): new mission / mission reached / none. HUD subscribes. */
  missionAlert: { kind: "none" | "newMission" | "missionReached" };
  /** Shop (cross_<appId> locked item) / CRM: partner-game promotion confirm (extras/crosspromo.ts). `onUnlock` runs on YES. */
  openCrossPromotion: { appId: string | number; onUnlock?: () => void };
  /** Economy area: a stored rent accelerator was chosen in the storage ("Use"); the map click applies it (ToolRentAccelerator). */
  startAccelerator: { sku: string; percent: number; amount: number };
  /** Tool changed from the toolbar (informational). */
  toolChanged: { tool: string };
}

type Listener<T> = (payload: T) => void;

export class UiBus {
  private listeners = new Map<keyof UiEvents, Set<Listener<never>>>();
  on<K extends keyof UiEvents>(type: K, fn: Listener<UiEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }
  emit<K extends keyof UiEvents>(type: K, ...payload: UiEvents[K] extends undefined ? [] : [UiEvents[K]]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) (fn as Listener<UiEvents[K] | undefined>)(payload[0]);
  }
}

export const uiBus = new UiBus();
