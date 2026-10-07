// Missions model: MissionDefinition parsing, PollManager/PollEvent counters and the MissionObjectManager state machine.
// Pure (no DOM, no network): the host (ui/missions/system.ts) supplies the profile/level, command sending and reward payment.
//
// Sources (decompiled 0.501 client): missions/MissionObjectManager.as, MissionObject.as, MissionDefinition.as,
// unlock/*.as, utils/poll/PollEvent.as + PollManager.as, model/rules/ActionGetMissionDefinitions.as, rewards/*.as.
// Server counterpart: archive-recovery-2026-10-06/java/dollars/GamePlay.java:1346 (updateMissions: up -> reached -> given).
import { parseElements } from "@mcity/rules";

// ---------------------------------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------------------------------

/** MissionsEventIDs.as */
export const MISSION_EVENT = {
  build: "build",
  buildRoads: "buildRoads",
  sell: "sell",
  buy: "buy",
  buyExpansion: "buyExpansion",
  collect: "collect",
  checkInfluence: "checkInfluence",
  bonus: "bonus",
  instantBuild: "instantBuild",
  informative: "informative",
  askForHelp: "askForHelp",
  earn: "earn",
  upgrade: "upgrade",
  renovate: "renovate",
  repair: "repair",
  visitRonald: "visitRonald",
  visitFriend: "visitFriend",
  visitCity: "visitCity",
  visitPartner: "visitPartner",
  beat: "beat",
  investment: "investment",
  investmentDone: "investmentDone",
  collectUpgraded: "collectUpgraded",
  checkToolbar: "checkToolbar",
  giveEmail: "giveEmail",
  nameCity: "nameCity",
  moveHouse: "moveHouse"
} as const;

export const NO_CONDITION = -1; // MissionDefinition.NO_CONDITION

/** Client-side change: the give-your-email missions (64 / 94) became the optional "give back" mission and appear at this company value. */
export const GIVE_BACK_UNLOCK_COMPANY_VALUE = 1_000_000;

/** RewardManager.REWARD_*_ID; anything else is an item sku (MissionDefinition.parseRewards default branch). */
export type MissionReward = { kind: "coins"; amount: number } | { kind: "exp"; amount: number } | { kind: "item"; amount: number; sku: string };

export interface MissionDef {
  sku: string;
  /** TID prefix: TID_MISSION_xxx -> _TITLE / _DESC / _DESC_TIP (MissionDefinition.getTextTitle/getTextDescription). */
  tid: string;
  missionName: string;
  eventType: string;
  eventParameter: string;
  /** XML `amount` (uint). */
  eventAmount: number;
  /** XML `condition` (-1 when absent). For `beat` it is an NPC index until `resolveBeatConditions`. */
  eventCondition: number;
  /** `beat` only: the NPC index of the XML condition (art name beat_<index>), kept after the condition is resolved. */
  beatIndex?: number;
  unlockLevel: number;
  unlockSku: string;
  showProgress: boolean;
  imageIsRequired: boolean;
  checkInRoleVisitor: boolean;
  /** `showInABtest` (e.g. "alt_missions"): hidden unless the profile flag `altMissions` is set (Profile.altMissionsGet). */
  showInABTest?: string;
  rewardType: string;
  rewardAmount: string;
  rewardTypeABTest1?: string;
  rewardAmountABTest1?: string;
  rewardTypeABTest2?: string;
  rewardAmountABTest2?: string;
  rewards: MissionReward[];
  feedImg: string;
}

const intOf = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? Math.trunc(n) : d;
};

/** MissionReward list from "coins;exp" / "1;2" (MissionDefinition.parseRewards :388-411). */
export function parseRewards(type: string, amount: string): MissionReward[] {
  const types = type.split(";");
  const amounts = amount.split(";");
  return types.map((t, i): MissionReward => {
    const n = intOf(amounts[i], 0);
    if (t === "coins") return { kind: "coins", amount: n };
    if (t === "exp") return { kind: "exp", amount: n };
    return { kind: "item", amount: n, sku: t };
  });
}

/** ActionGetMissionDefinitions.itemFromXML (ActionGetMissionDefinitions.as:17-79). Document order is preserved. */
export function parseMissionDefinitions(xml: string): MissionDef[] {
  return parseElements(xml, "Definition").map((a) => {
    const rewardType = a.rewardType ?? "";
    const rewardAmount = a.rewardAmount ?? "";
    return {
      sku: a.sku ?? "",
      tid: a.tid ?? "",
      missionName: a.missionName ?? "",
      eventType: a.type ?? "none",
      eventParameter: a.parameter ?? "",
      eventAmount: Math.max(0, intOf(a.amount, 0)),
      eventCondition: a.condition !== undefined && a.condition !== "" ? Number(a.condition) : NO_CONDITION,
      beatIndex: a.type === "beat" && a.condition ? Number(a.condition) : undefined,
      unlockLevel: a.unlockLevel !== undefined ? intOf(a.unlockLevel, -1) : -1,
      unlockSku: a.unlockSku ?? "",
      showProgress: a.showProgress !== undefined ? intOf(a.showProgress, 1) === 1 : true,
      imageIsRequired: intOf(a.imageIsRequired, 0) === 1,
      checkInRoleVisitor: intOf(a.checkInRoleVisitor, 0) === 1,
      showInABTest: a.showInABtest,
      rewardType,
      rewardAmount,
      rewardTypeABTest1: a.rewardTypeABtest1,
      rewardAmountABTest1: a.rewardAmountABtest1,
      rewardTypeABTest2: a.rewardTypeABtest2,
      rewardAmountABTest2: a.rewardAmountABtest2,
      rewards: rewardType ? parseRewards(rewardType, rewardAmount) : [],
      feedImg: a.feedImg ?? "mission.jpg"
    };
  });
}

/** MissionDefinitionManager.reload: apply the player's mission reward A/B group, falling back to base rewards. */
export function rewardVariantDefinitions(defs: MissionDef[], group: number): MissionDef[] {
  if (group !== 1 && group !== 2) return defs;
  const suffix = group === 1 ? "1" : "2";
  return defs.map((d) => {
    const type = d[`rewardTypeABTest${suffix}` as "rewardTypeABTest1" | "rewardTypeABTest2"];
    const amount = d[`rewardAmountABTest${suffix}` as "rewardAmountABTest1" | "rewardAmountABTest2"];
    if (!type || !amount) return d;
    return { ...d, rewardType: type, rewardAmount: amount, rewards: parseRewards(type, amount) };
  });
}

/** Profile flags attribute "a:1,b" -> value map (Profile.flagsRead, Profile.as:1005-1022). */
export function parseFlags(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (raw ?? "").split(",")) {
    if (part === "") continue;
    const [k, v] = part.split(":");
    out[k] = v === undefined ? 1 : Math.trunc(Number(v)) || 0;
  }
  return out;
}

/** MissionObjectManager.build (:557-611): alt-mission A/B test selects exactly one of the two definition sets. */
export function activeDefinitions(defs: MissionDef[], altMissions: boolean): MissionDef[] {
  return defs.filter((d) => (altMissions ? d.showInABTest !== undefined : d.showInABTest === undefined));
}

/** MissionDefinition.getEventSku */
export const eventSku = (d: Pick<MissionDef, "eventType" | "eventParameter">): string => d.eventType + d.eventParameter;
export const hasTrigger = (d: MissionDef): boolean => d.eventAmount > 0;
export const hasUnlockSku = (d: MissionDef): boolean => d.unlockSku !== "";
/** MissionDefinition.showProgress: flag && (amount > 1 || condition > 1). */
export const showsProgress = (d: MissionDef): boolean => d.showProgress && (d.eventAmount > 1 || d.eventCondition > 1);

// ---------------------------------------------------------------------------------------------------------------------
// PollManager / PollEvent
// ---------------------------------------------------------------------------------------------------------------------

export interface PollSink {
  /** UserDataFacade.updatePollManager (UDFO.as:1603): add = counter + 1, update = absolute progress string. */
  poll(action: "add" | "update", type: string, parameter: string, value?: string): void;
}

/** One counter (or a set of per-condition counters when `checkCondition`). PollEvent.as */
export class PollEvent {
  readonly sku: string;
  private counts: number[] = [0];
  private conditions: number[];
  private progress = 0;
  private progressSid: string | undefined;
  readonly checkCondition: boolean;

  constructor(
    readonly eventType: string,
    readonly eventParameter: string,
    condition: number,
    private readonly sink: PollSink
  ) {
    this.sku = eventType + eventParameter;
    this.conditions = [condition];
    this.checkCondition = condition > NO_CONDITION;
  }

  /** getIdByCondition: index of the counter of this condition (conditions.length when unknown). */
  idByCondition(condition: number): number {
    if (!this.checkCondition) return 0;
    let i = 0;
    while (i < this.conditions.length && this.conditions[i] !== condition) i += 1;
    return i;
  }

  get conditionCount(): number {
    return this.conditions.length;
  }
  getCondition(i = 0): number {
    return this.conditions[i];
  }
  setCondition(i: number, value: number): void {
    this.conditions[i] = value;
  }
  hasCondition(condition: number): boolean {
    return this.conditions.includes(condition);
  }
  count(i = 0): number {
    return this.counts[i] ?? 0;
  }
  setCount(n: number, i = 0): void {
    this.counts[i] = n;
  }

  /** getProgress: the best partial value seen so far overrides the counter while > 0. */
  getProgress(i: number): number {
    return this.progress > 0 ? this.progress : this.count(i);
  }

  /** needsToBeChecked (owner role only): some condition not reached yet. */
  needsToBeChecked(): boolean {
    if (!this.checkCondition) return true;
    return this.counts.some((c) => c === 0);
  }

  /** PollEvent.register: counter + 1 and persist. */
  register(i = 0): void {
    this.progress = 0;
    this.counts[i] = (this.counts[i] ?? 0) + 1;
    if (this.checkCondition) this.sink.poll("update", this.eventType, this.eventParameter, this.progressAsString());
    else this.sink.poll("add", this.eventType, this.eventParameter);
  }

  /** getProgressAsString: number of leading satisfied conditions (checkCondition) or the plain counter. */
  progressAsString(): string {
    if (!this.checkCondition) return String(this.counts[0] ?? 0);
    let i = 0;
    while (i < this.counts.length && this.counts[i] > 0) i += 1;
    return String(i);
  }

  /** PollEvent.checkCondition(value, sid): registers every not-yet-reached condition that `value` satisfies. */
  check(value: number, sid?: string): void {
    if (!this.checkCondition) return;
    for (let i = 0; i < this.conditions.length; i += 1) {
      if (this.counts[i] !== 0) continue;
      if (sid !== undefined && sid === this.progressSid) this.progress = value;
      if (value >= this.conditions[i]) this.register(i);
      else if (value > this.progress) {
        this.progress = value;
        this.progressSid = sid;
      }
    }
  }

  /** PollManager.addEvent merge (PollEvent.addEvent): append another mission's condition in definition order. */
  addCondition(condition: number, count: number): void {
    this.conditions.push(condition);
    this.counts.push(count);
  }

  /** PollEvent.build(persisted value). */
  build(value: string): void {
    const n = intOf(value, 0);
    if (this.checkCondition) {
      for (let i = 0; i < n; i += 1) this.counts[i] = 1;
    } else {
      this.counts[0] = n;
    }
  }

  needsToRegisterPersistence(): boolean {
    return (this.counts[0] ?? 0) > 0;
  }
}

export class PollManager {
  private readonly events = new Map<string, PollEvent>();
  enabled = true;
  constructor(private readonly sink: PollSink) {}

  getEvent(sku: string): PollEvent | undefined {
    return this.events.get(sku);
  }
  all(): PollEvent[] {
    return [...this.events.values()];
  }

  /** PollManager.addEvent: merge into an existing condition event, else replace. */
  addEvent(def: { eventType: string; eventParameter: string; eventCondition: number }): PollEvent {
    const sku = def.eventType + def.eventParameter;
    const existing = this.events.get(sku);
    if (existing && existing.checkCondition) {
      existing.addCondition(def.eventCondition, 0);
      return existing;
    }
    const ev = new PollEvent(def.eventType, def.eventParameter, def.eventCondition, this.sink);
    this.events.set(sku, ev);
    return ev;
  }

  /** PollManager.registerEvent (only after the tutorial; the rebuilt client always runs post-tutorial). */
  registerEvent(type: string, parameter = ""): void {
    this.events.get(type + parameter)?.register();
  }

  /** Condition events (earn, beat, checkInfluence, bonus): feed the current value. */
  checkEvent(sku: string, value: number, sid?: string): void {
    const ev = this.events.get(sku);
    if (ev && this.enabled && ev.needsToBeChecked()) ev.check(value, sid);
  }

  /** PollManager.build: apply the persisted Count chunk ("<sku>/<value>"). */
  build(counts: Record<string, string>): void {
    for (const [sku, value] of Object.entries(counts)) this.events.get(sku)?.build(value);
  }

  /** PollManager.getPersistence entries. */
  persistence(): string[] {
    return this.all().filter((e) => e.needsToRegisterPersistence()).map((e) => `${e.sku}/${e.progressAsString()}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Mission objects
// ---------------------------------------------------------------------------------------------------------------------

/** MissionObject.STATE_* */
export const STATE_LOCKED = 0;
export const STATE_UNLOCKED = 1;
export const STATE_REACHED = 2;
export const STATE_GIVEN = 3;
export type MissionState = 0 | 1 | 2 | 3;

const LIST_UP = 0;
const LIST_LOCKED = 1;
const LIST_REACHED = 2;
const LIST_GIVEN = 3;
/** LIST_UP_ENTRIES_COUNT: how many missions the panel shows at once. */
export const LIST_UP_ENTRIES_COUNT = 6;

const listPosition = (state: number): number =>
  state === STATE_LOCKED ? LIST_LOCKED : state === STATE_REACHED ? LIST_REACHED : state === STATE_GIVEN ? LIST_GIVEN : LIST_UP;

/** Boss alert on the toolbar (ToolsBar.BOSS_ALERT_*). */
export type MissionAlert = "none" | "newMission" | "missionReached";

export class MissionObject {
  state: MissionState = STATE_LOCKED;
  oldState = 0;
  newState = 0;
  isNew = false;
  /** ToolsBar.BOSS_ALERT_NEW_MISSION marker shown on the list item (setAlertID). */
  alert: MissionAlert = "none";
  unlockMissionId = 0;

  constructor(
    readonly def: MissionDef,
    private readonly mgr: MissionManager,
    initial: number = STATE_LOCKED
  ) {
    // MissionObject constructor: events are registered for every mission that has a trigger.
    if (hasTrigger(def)) {
      const ev = mgr.poll.getEvent(eventSku(def));
      if (!ev || def.eventCondition > NO_CONDITION) mgr.poll.addEvent(def);
    }
    this.changeState(initial);
    this.oldState = initial; // :56 `mOldState = param2` overrides the change recorded above: loading never re-sends.
  }

  get hasBeenReached(): boolean {
    return this.state >= STATE_REACHED;
  }

  private event(): PollEvent | undefined {
    return this.mgr.poll.getEvent(eventSku(this.def));
  }

  /** MissionObject.getProgressSoFar */
  progressSoFar(): number {
    if (!showsProgress(this.def)) return -1;
    const ev = this.event();
    return ev ? ev.getProgress(ev.idByCondition(this.def.eventCondition)) : -1;
  }
  /** denominator of getProgressAsString: amount (>= 2) else the condition. */
  progressTarget(): number {
    return this.def.eventAmount < 2 ? Math.trunc(this.def.eventCondition) : this.def.eventAmount;
  }
  /** MissionObject.getProgressAsString ("" when progress is not shown) */
  progressAsString(): string {
    return showsProgress(this.def) ? `${this.progressSoFar()}/${this.progressTarget()}` : "";
  }
  /** MissionObject.getProgressAsPercentage */
  progressAsPercentage(): number {
    if (showsProgress(this.def)) return Math.ceil((this.progressSoFar() * 100) / this.progressTarget());
    return this.hasBeenReached ? 100 : 0;
  }

  /** MissionObject.changeState (:263-297) */
  changeState(next: number): void {
    if (next !== this.state) this.mgr.addChange(this, this.state, next);
    this.state = next as MissionState;
    switch (next) {
      case STATE_LOCKED:
        if (!this.checkUnlock()) this.alert = "none";
        break;
      case STATE_UNLOCKED:
        this.isNew = true;
        this.alert = "newMission";
        break;
      case STATE_REACHED:
      case STATE_GIVEN:
        this.alert = "none";
        break;
    }
  }

  /** UnlockMissionByLevel / UnlockMissionBySku (unlock/*.as) + the "Friend" exception (:253-261). */
  private checkUnlock(): boolean {
    if (this.def.eventParameter === "Friend") return false;
    if (this.mgr.isGiveBackLocked(this.def)) return false;
    if (this.def.eventType === MISSION_EVENT.giveEmail && this.mgr.host.companyValue) return true; // company value reached the threshold
    if (this.def.unlockLevel > -1) return this.mgr.host.level() >= this.def.unlockLevel;
    if (this.def.unlockSku !== "") {
      const dep = this.mgr.getMissionBySku(this.def.unlockSku);
      return dep ? dep.hasBeenReached : false;
    }
    return true; // unlockMission == null
  }

  /** MissionObject.logicUpdate (:171-208) */
  logicUpdate(): void {
    if (this.state === STATE_LOCKED) {
      if (this.checkUnlock()) this.changeState(STATE_UNLOCKED);
    } else if (this.state === STATE_UNLOCKED && hasTrigger(this.def)) {
      let reached: boolean;
      if (this.def.eventParameter === "Friend") reached = true;
      else {
        const ev = this.event();
        reached = !!ev && ev.count(ev.idByCondition(this.def.eventCondition)) >= this.def.eventAmount;
      }
      if (reached) this.changeState(STATE_REACHED);
    }
  }

  /** MissionObject.applyReward (:140-145): delayed payment + REACHED -> GIVEN applied immediately. */
  applyReward(): void {
    this.mgr.setDelayedPayment(this.def.rewards);
    this.changeState(STATE_GIVEN);
    this.mgr.applyChange(this, this.oldState, this.newState);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// MissionObjectManager
// ---------------------------------------------------------------------------------------------------------------------

/** The gain a claim (REACHED -> GIVEN) pays: positive amounts (the original sends -delayedPayment). */
export interface RewardGain {
  coins: number;
  exp: number;
  cash: number;
}

export interface MissionHost extends PollSink {
  level(): number;
  /** Optional: current company value, used only by the give-back (giveEmail) missions' unlock rule. */
  companyValue?(): number;
  /** UDFO.updateMissions: `claim` = the DELAYED payment values (negative reward) when the new state is GIVEN. */
  sendMission(sku: number, claim?: RewardGain): void;
  /** Delayed payment pay-out: mutate the profile (coins/exp/cash) BEFORE sendMission is built (UDF securityUpdate order). */
  pay(gain: RewardGain): void;
  /** StorageManager.addItem for item rewards (local only in the original). */
  addItem(sku: string, amount: number): void;
  /** RulesFacade.npcsGetCompanyValue (beat missions). */
  npcCompanyValue(index: number): number;
}

export interface MissionPersistence {
  up: string[];
  reached: string[];
  given: string[];
  pollCounts: Record<string, string>;
}

export interface MissionManagerEvents {
  /** A mission reached its goal: show PopupReward (only when no reward popup is open, MissionObjectManager.as:195-200). */
  reached: MissionObject;
  /** A mission was unlocked (notifyChange): refresh the list / new-mission alert. */
  unlocked: MissionObject;
  /** Any list change (panel refresh). */
  change: undefined;
}

type Listener<T> = (payload: T) => void;

export class MissionManager {
  readonly poll: PollManager;
  private readonly defs: MissionDef[];
  private readonly byList: MissionObject[][] = [[], [], [], []];
  private readonly dict = new Map<string, MissionObject>();
  private changes: MissionObject[] = [];
  private missionsLocked: MissionObject[] = [];
  private needsCalcLocked = false;
  initialized = false;
  /** Set by the UI while a PopupReward is open (mRewardPopup != null). */
  rewardPopupOpen = false;
  private notifyEnabled = false;
  private delayed: RewardGain = { coins: 0, exp: 0, cash: 0 };
  private readonly listeners = new Map<string, Set<Listener<never>>>();

  constructor(
    readonly host: MissionHost,
    defs: MissionDef[]
  ) {
    this.defs = defs.map((d) => ({ ...d })); // beat conditions are resolved in place: never mutate the shared table
    this.poll = new PollManager(host);
  }

  on<K extends keyof MissionManagerEvents>(type: K, fn: Listener<MissionManagerEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }
  private emit<K extends keyof MissionManagerEvents>(type: K, payload: MissionManagerEvents[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) (fn as Listener<MissionManagerEvents[K]>)(payload);
  }

  getMissionBySku(sku: string): MissionObject | undefined {
    return this.dict.get(sku);
  }
  getMissionsAll(): MissionObject[] {
    return [...this.dict.values()];
  }
  getMissionsGivenCount(): number {
    return this.byList[LIST_GIVEN].length;
  }
  getMissionsReachedCount(): number {
    return this.byList[LIST_REACHED].length;
  }
  getMissionsAvailable(): MissionObject[] {
    return this.byList[LIST_UP];
  }

  /** MissionObjectManager.build (:557-611): persisted Reached, Given, Up first, then every other definition. */
  build(save: MissionPersistence): void {
    this.notifyEnabled = false;
    this.needsCalcLocked = true;
    const done = new Set<string>();
    const bySku = new Map(this.defs.map((d) => [d.sku, d]));
    const add = (sku: string, list: number, state: number): void => {
      const def = bySku.get(sku);
      if (!def) return;
      done.add(def.sku);
      const obj = new MissionObject(def, this, state);
      this.byList[list].push(obj);
      this.addToDictionary(obj);
    };
    for (const sku of save.reached) add(sku, LIST_REACHED, STATE_REACHED);
    for (const sku of save.given) add(sku, LIST_GIVEN, STATE_GIVEN);
    for (const sku of save.up) {
      const def = bySku.get(sku);
      if (def && this.isGiveBackLocked(def)) continue; // not yet at the unlock company value: stays LOCKED (falls into the loop below)
      add(sku, LIST_UP, STATE_UNLOCKED);
    }
    for (const def of this.defs) {
      if (done.has(def.sku)) continue;
      const obj = new MissionObject(def, this);
      this.byList[listPosition(obj.state)].push(obj);
      this.addToDictionary(obj);
    }
    // sortMissionsBySku compares the sku STRINGS (:318-330) ("1","10","2","5"), but the oracle's missions panel (hud-tour 05) lists the same
    // save as 1,2,5,10: numeric order.
    this.byList[LIST_UP].sort((a, b) => Number(a.def.sku) - Number(b.def.sku) || (a.def.sku > b.def.sku ? 1 : a.def.sku < b.def.sku ? -1 : 0));
    this.notifyEnabled = true;
    this.resolveBeatConditions();
    this.poll.build(save.pollCounts);
  }

  /** The give-back (giveEmail) missions stay locked until the company value reaches GIVE_BACK_UNLOCK_COMPANY_VALUE. */
  isGiveBackLocked(def: MissionDef): boolean {
    const value = this.host.companyValue;
    return def.eventType === MISSION_EVENT.giveEmail && value !== undefined && value.call(this.host) < GIVE_BACK_UNLOCK_COMPANY_VALUE;
  }

  /** MissionDefinition.build: `beat` conditions are NPC indexes resolved to their company value. */
  private resolveBeatConditions(): void {
    for (const d of this.defs) {
      if (d.eventType !== MISSION_EVENT.beat || d.eventCondition < 0) continue;
      const value = this.host.npcCompanyValue(d.eventCondition);
      if (Number.isFinite(value)) {
        const ev = this.poll.getEvent(eventSku(d));
        const idx = ev ? ev.idByCondition(d.eventCondition) : -1;
        d.eventCondition = value;
        if (ev && idx >= 0 && idx < ev.conditionCount) ev.setCondition(idx, value);
      }
    }
  }

  private addToDictionary(obj: MissionObject): void {
    if (!this.dict.has(obj.def.sku)) this.dict.set(obj.def.sku, obj);
  }

  // ---- change queue (changeStateMissions*) ----------------------------------------------------------------------------

  addChange(obj: MissionObject, oldState: number, newState: number): void {
    obj.oldState = oldState;
    obj.newState = newState;
    this.changes.push(obj);
  }

  /** changeStateMissionsApplyAll */
  private applyAll(): void {
    while (this.changes.length > 0) {
      const batch = this.changes;
      this.changes = [];
      for (const obj of batch) this.applyChange(obj, obj.oldState, obj.newState);
    }
  }

  /** delayedPaymentSetCoins/Exp(-amount) (RewardCoins/RewardExp.doApply); items go straight to the storage. */
  setDelayedPayment(rewards: MissionReward[]): void {
    this.delayed = { coins: 0, exp: 0, cash: 0 };
    for (const r of rewards) {
      if (r.kind === "coins") this.delayed.coins = -r.amount;
      else if (r.kind === "exp") this.delayed.exp = -r.amount;
      else this.host.addItem(r.sku, r.amount);
    }
  }

  /** changeStateMissionsApplyMission (:155-232). */
  applyChange(obj: MissionObject, oldState: number, newState: number): void {
    const from = listPosition(oldState);
    const to = listPosition(newState);
    let listChanged = false;
    if (from !== to) {
      const idx = this.byList[from].indexOf(obj);
      if (idx > -1) {
        this.byList[from].splice(idx, 1);
        listChanged = true;
        let push = true;
        if (oldState === STATE_LOCKED && (obj.def.unlockLevel > -1 || hasUnlockSku(obj.def))) {
          // param2 == LOCKED && unlockMission != null: entries beyond the visible 6 are kept sorted by sku.
          const target = this.byList[to];
          const mySku = parseInt(obj.def.sku, 10);
          if (target.length > LIST_UP_ENTRIES_COUNT) {
            let at = -1;
            for (let i = LIST_UP_ENTRIES_COUNT; i < target.length && at === -1; i += 1) {
              if (parseInt(target[i].def.sku, 10) > mySku) at = i;
            }
            push = at === -1;
            if (!push) target.splice(at, 0, obj);
          }
        }
        if (push) this.byList[to].push(obj);
      }
    }
    if (newState === STATE_REACHED || newState === STATE_UNLOCKED) {
      if (newState === STATE_REACHED) {
        if (this.initialized && !this.rewardPopupOpen) this.emit("reached", obj);
      } else {
        this.needsCalcLocked = true;
        if (this.initialized && this.notifyEnabled) this.emit("unlocked", obj);
      }
    }
    if (oldState === STATE_LOCKED || listChanged) {
      let claim: RewardGain | undefined;
      if (newState === STATE_GIVEN) {
        // Company.delayedPaymentPay: coins/exp += reward, THEN updateMissions with securityCreateObj(-delayed...).
        claim = { ...this.delayed };
        this.host.pay({ coins: 0 - claim.coins, exp: 0 - claim.exp, cash: 0 - claim.cash });
        this.delayed = { coins: 0, exp: 0, cash: 0 };
      }
      this.host.sendMission(parseInt(obj.def.sku, 10), claim);
      if (newState === STATE_REACHED) obj.applyReward();
    }
    if (listChanged) this.emit("change", undefined);
  }

  // ---- per-frame logic ---------------------------------------------------------------------------------------------------

  /** MissionObjectManager.logicUpdate (:395-423) for the owner role. */
  update(): void {
    for (const list of [LIST_UP, LIST_LOCKED]) {
      for (const obj of [...this.byList[list]]) obj.logicUpdate();
    }
    this.applyAll();
    if (this.needsCalcLocked) {
      this.calculateMissionsLocked();
      this.needsCalcLocked = false;
    }
    this.initialized = true;
  }

  /** The boss-alert state (ToolsBar.bossAlertSetMissionReachedEnabled + any unseen new mission). */
  alert(): MissionAlert {
    if (this.byList[LIST_REACHED].length > 0) return "missionReached";
    if (this.byList[LIST_UP].some((m) => m.alert === "newMission")) return "newMission";
    return "none";
  }

  /** sortMissionsLocked (:75-117), including the original's fall-through structure. */
  private compareLocked(a: MissionObject, b: MissionObject): number {
    const da = a.def;
    const db = b.def;
    const sa = hasUnlockSku(da);
    const sb = hasUnlockSku(db);
    const bySku = (): number => (da.sku > db.sku ? 1 : db.sku > da.sku ? -1 : 0);
    let r = 0;
    if (sa && !sb) r = -1;
    if (sb && !sa) r = 1;
    else if (sa && sb) {
      const ua = Number(da.unlockSku);
      const ub = Number(db.unlockSku);
      r = ua > ub ? 1 : ua < ub ? -1 : bySku();
    } else if (da.unlockLevel > db.unlockLevel) r = 1;
    else if (db.unlockLevel > da.unlockLevel) r = -1;
    else r = bySku();
    return r;
  }

  private calculateMissionsLocked(): void {
    this.missionsLocked = [...this.byList[LIST_LOCKED]].sort((a, b) => this.compareLocked(a, b));
  }

  /** getMissions (:473-540): Reached, Up, then locked previews up to 6 entries total. */
  getMissions(): MissionObject[] {
    this.applyAll();
    if (this.needsCalcLocked) {
      this.calculateMissionsLocked();
      this.needsCalcLocked = false;
    }
    const out: MissionObject[] = [...this.byList[LIST_REACHED], ...this.byList[LIST_UP]];
    const upCount = this.byList[LIST_UP].length;
    if (upCount < LIST_UP_ENTRIES_COUNT) {
      let remaining = Math.min(this.missionsLocked.length, LIST_UP_ENTRIES_COUNT - upCount);
      for (let i = 0; i < this.missionsLocked.length && remaining > 0; i += 1) {
        const m = this.missionsLocked[i];
        let ok = true;
        if (hasUnlockSku(m.def)) {
          ok = false;
          for (let j = upCount - 1; j > -1 && !ok; j -= 1) {
            if (this.byList[LIST_UP][j].def.sku === m.def.unlockSku) {
              ok = true;
              m.unlockMissionId = j;
            }
          }
        }
        if (ok) {
          out.push(m);
          remaining -= 1;
        }
      }
    }
    return out;
  }

  /** Panel opened: clears the "new" flags (MissionsBox.getItems -> removeFlagNew). */
  markSeen(list: MissionObject[]): void {
    for (const m of list) m.isNew = false;
  }

  /** MissionItem alert reset (setAlertID(-1) on destroy). */
  clearAlerts(list: MissionObject[]): void {
    for (const m of list) if (m.alert === "newMission") m.alert = "none";
  }

  /** MissionsBox.applyReward: the "Get reward" button of a REACHED mission loaded from the save. */
  claim(obj: MissionObject): void {
    if (obj.state === STATE_REACHED) obj.applyReward();
  }

  // ---- event sources -------------------------------------------------------------------------------------------------------

  /** PollManager.registerEvent */
  register(type: string, parameter = ""): void {
    this.poll.registerEvent(type, parameter);
  }

  /** PopupName.saveName: missionChangeState(STATE_REACHED) without a poll counter. */
  forceReached(obj: MissionObject): void {
    if (obj.state === STATE_UNLOCKED) obj.changeState(STATE_REACHED);
  }

  /** PersistenceLists for tests / debugging (MissionObjectManager.getPersistence). */
  persistence(): { up: string[]; reached: string[]; given: string[] } {
    const skus = (l: number): string[] => this.byList[l].map((m) => m.def.sku);
    return { up: skus(LIST_UP), reached: skus(LIST_REACHED), given: skus(LIST_GIVEN) };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Event fan-out (ItemObject.registerEvent, ItemObject.as:2787-2802)
// ---------------------------------------------------------------------------------------------------------------------

/** ItemDefinition.NAME_TYPES */
export const NAME_TYPES = ["Houses", "Commerces", "Decorations", "Wonders", "Clubs"] as const;

/** `nameType` of an item sku: derived from the rules file it comes from (kind), wonders/clubs from the sku prefix. */
export function nameTypeOf(kind: string, sku: string): string {
  if (kind === "houses") return "Houses";
  if (kind === "commerce") return "Commerces";
  if (kind === "decoration") return "Decorations";
  return sku.startsWith("club") ? "Clubs" : "Wonders";
}

/** ItemObject.registerEvent: nameType, nameType_<subtype>... and the sku. */
export function itemEventParameters(nameType: string, sku: string, subtype: string): string[] {
  const out = [nameType];
  if (subtype !== "") for (const s of subtype.split(",")) out.push(`${nameType}_${s.trim()}`);
  out.push(sku);
  return out;
}
