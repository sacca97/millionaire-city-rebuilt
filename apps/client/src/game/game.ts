// Core-loop controller (UI-agnostic): owns the server connection, the command queue, the profile (coins/cash/exp/level/
// company value), the item model and the current tool. A HUD/shop/popup layer talks to this class only.
//
// Money model (decompiled Profile.as / StateOnRent.as / StateOnConstruction.as): every coin change also moves companyValue
// (`Profile.DCCoins` setter, Profile.as:1820); adding an item adds its definition companyValue (CompanyMine.as:46);
// demolishing a built item subtracts it (StateItemObject.as:800). Server sync is the "security" snapshot of GameCommands.
import { getIncomeValue, getIncomeXP, instantBuildPriceAt, isBuildable, requiresTerrainMine, type ItemDefinition } from "@mcity/rules";
import type { DefinitionTable, ItemDef } from "../model/definitions";
import { parseWorld, type PlacedItem, type WorldState } from "../model/save";
import {
  CONSTRUCTION_MODE,
  GameCommands,
  HIRE_CREW_MODE,
  RENT_MODE,
  STATE_ID,
  type ProfileSnapshot,
  type SecurityTracker
} from "../net/commands";
import type { GameConnection, PacketCommand } from "../net/protocol";
import { CommandQueue } from "../net/session";
import type { AudioEvent } from "../audio/events";
import { Expansions, parseExpansions, parsePlotStates } from "./expansions";
import { MAP_COLS, MAP_ROWS, relX, relY, tileX, tileY } from "./geometry";
import {
  RULES_ROOT,
  contractsForDef,
  destroyProfit,
  destroyTerrainProfit,
  levelOf,
  loadGameRules,
  movePrice,
  terrainPrice,
  xpToReach,
  type ContractInfo,
  type GameRules
} from "./rules";
import { advanceItem, type AdvanceEnv, type ItemRuntime, type Transition } from "./simulation";
import { Economy, acceleratedTime, canBeAccelerated, computeCompanyValue, expansionsValue, initialStateKind, itemTypeOf, withDoubleRent } from "./economy";
import { STATE_HIRE_CREW, crewAttrs, crewComplete, crewCompletePrice, crewSlots, parseCrewAttrs, type CrewState } from "./crew";
import { HOUSE_SKU, HQ_SKU, inferResumeStep, TutorialMachine, TUTORIAL_POSITIONS, DECORATION_SKU } from "./tutorial";
import { createTool, type Check, type Ghost, type Tool, type ToolHost, type ToolState } from "./tools";
import { GameWorld, parseLogicTiles } from "./world";

// ---------------------------------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------------------------------

export interface ProfileState {
  coins: number;
  cash: number;
  exp: number;
  level: number;
  companyValue: number;
  /** exp at the start of the current level / needed for the next one (Infinity at max level). */
  xpMin: number;
  xpMax: number;
}

/** A placed item with its live timers. `x`/`y` are SAVE-RELATIVE tiles; use tileX/tileY (absolute) for rendering/placement. */
export interface GameItem extends ItemRuntime {
  placed: PlacedItem;
  def: ItemDef;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  cols: number;
  rows: number;
  /** Clubs: the hired crew (ItemObject.mCrew). */
  crew?: CrewState;
  /** StateOnRent.mIsAccelerated: a rent accelerator was already applied to this contract. */
  accelerated?: boolean;
}

export interface ContractOption {
  /** contracts.xml sku (pass to signContract). */
  sku: number;
  name: string;
  icon: string;
  level: number;
  /** Player level >= contract level. */
  unlocked: boolean;
  affordable: boolean;
  cost: number;
  /** Coins paid per collection (def income + contract income, before influence/upgrades). */
  income: number;
  xp: number;
  timeMs: number;
}

export interface ToastEvent {
  kind: "info" | "error" | "coins" | "xp" | "levelUp";
  text: string;
}

export interface GameEvents {
  profile: ProfileState;
  "item-added": GameItem;
  "item-changed": GameItem;
  "item-removed": { sid: string; sku: string };
  levelUp: { level: number; cashReward: number };
  toast: ToastEvent;
  selection: GameItem | null;
  tool: ToolState;
  /** Ghost preview changed (null = hide). Absolute tiles. */
  ghost: Ghost | null;
  /** Terrain or roads changed (redraw the ground / refresh traffic roads). */
  map: { kind: "terrain" | "road" };
  /** Sound to play (mapped by main.ts to AudioManager.play). */
  sound: { event: AudioEvent; isDecoration?: boolean };
  /** Build refused for lack of money (ToolBuild.itemAttachedCheckPrice): the shop area opens the exchange popup. */
  "need-money": { sku: string; coins: number; cash: number };
  /** One stored item was consumed by a build from storage (StorageManager.removeItem). */
  "storage-used": { sku: string };
  /** Early unlock paid with gold (UnlockedListManager.unlockItem). */
  "item-unlocked": { sku: string };
  /** PollManager.registerEvent source (missions): build/moveHouse/collect/instantBuild/buyExpansion... (ui/missions listens). */
  poll: PollNotice;
  /** A rent was collected (StateOnRent.onIncome): per-house payments of a commerce, double-rent flag (ui/economy floating text). */
  "rent-collected": { sid: string; sku: string; coins: number; exp: number; doubled: boolean; houses: Array<{ sid: string; coins: number }> };
  /** A commerce/club affected population changed (StateOnRent.as:1348-1372 checkInfluence + <Commerces|sku> events). */
  "commerce-population": { sid: string; sku: string; nameType: string; population: number };
  /** Click on a club waiting for its crew (StateOnHireCrewOwner.doDoClick). */
  "hire-crew": { sid: string };
  /** Click on the Headquarters (StateOnHeadQuarter.doClick: PopupValue). */
  "hq-click": { sid: string };
  /** Double-rent prize pushed by the server (UserDataFacadeOnline "doubleRent"). */
  "double-rent": { kind: "Houses" | "Commerces" };
  /** A reward item (mission reward) went to the storage (StorageManager.addItem): the storage UI refreshes. */
  "storage-added": { sku: string; amount: number };
}

/** One mission-relevant occurrence (PollManager.registerEvent call site). `sku` = the item involved, `extra` = collect contract time. */
export interface PollNotice {
  type: string;
  sku?: string;
  extra?: string;
}

type Listener<T> = (payload: T) => void;

export class Emitter<E extends object> {
  private listeners = new Map<keyof E, Set<Listener<never>>>();
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => set?.delete(fn as Listener<never>);
  }
  hasListeners(type: keyof E): boolean {
    return (this.listeners.get(type)?.size ?? 0) > 0;
  }
  protected emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const fn of this.listeners.get(type) ?? []) {
      (fn as Listener<E[K]>)(payload);
    }
  }
}

export interface GameInit {
  conn: Pick<GameConnection, "now"> & { loginSync: number };
  queue: CommandQueue;
  state: WorldState;
  defs: DefinitionTable;
  rules: GameRules;
  expansions: Expansions;
  solid?: Array<[number, number]>;
  /** True when boot() persisted tutorial_completed itself because ?skipTutorial was given on a fresh save. */
  tutorialSkipped?: boolean;
  /** Fresh (tutorialEnd != 1) save: the first-session tutorial runs (ui/tutorial). */
  tutorial?: TutorialMachine;
}

/** Facts of the loaded save used to continue an interrupted tutorial (inferResumeStep). */
function resumeFacts(state: WorldState, defs: DefinitionTable): Parameters<typeof inferResumeStep>[0] {
  const P = TUTORIAL_POSITIONS;
  const terrain = new Set(state.terrain.map(([x, y]) => `${x}:${y}`));
  const roads = new Set(state.roads.map(([x, y]) => `${x}:${y}`));
  const items = state.mine?.items ?? [];
  const house = items.find((i) => i.sku === HOUSE_SKU && i.x === P.house.x && i.y === P.house.y);
  const mode = Number(house?.state.mode ?? 0) || 0;
  void defs;
  return {
    hasHq: items.some((i) => i.sku === HQ_SKU),
    plotsBought: P.addTerrain.every((t) => terrain.has(`${t.x}:${t.y}`)),
    house: house
      ? {
          construction: house.stateId === STATE_ID.CONSTRUCTION,
          waitingContract: house.stateId === STATE_ID.RENT && mode === RENT_MODE.WAITING_FOR_CONTRACT,
          renting: house.stateId === STATE_ID.RENT && (mode === RENT_MODE.RENTING || mode === RENT_MODE.GET_RENT)
        }
      : undefined,
    roadsBuilt: P.addRoad.every((t) => roads.has(`${t.x}:${t.y}`)),
    decorationPlaced: items.some((i) => i.sku === DECORATION_SKU && i.x === P.addDecoration.x && i.y === P.addDecoration.y)
  };
}

export interface BootOptions {
  conn: GameConnection;
  defs: DefinitionTable;
  fetchText: (file: string) => Promise<string>;
  /** Dev flag (?skipTutorial): complete the tutorial on the server instead of playing it. */
  skipTutorial?: boolean;
}

const num = (v: string | undefined): number => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : 0);
const NO_GAIN = { exp: 0, coins: 0, cash: 0 };

// ---------------------------------------------------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------------------------------------------------

const SELL_BAR_MS = 3000; // StateOnIA SELL_BAR_TIME, reported as the MODE_BUYING time

const GIVING_RENT_MS = 20_000;

// NotificationConstructionEnd (non-effective): Notification.enter plays Event_Contract_anim_ok (houses_info: 42 frames at 30 fps) and only its
// last frame (checkEnd) runs onAccept -> initItemAfterConstruction, i.e. the new_state goes out ~1.4 s after the item's time ran out.
const CONSTRUCTION_END_ANIM_MS = 3000;

export class Game extends Emitter<GameEvents> implements ToolHost {
  readonly world: GameWorld;
  /** Influence, commerce population, HQ connectivity, wonder attributes, double rent (game/economy.ts). */
  readonly economy: Economy;
  readonly commands: GameCommands;
  readonly queue: CommandQueue;
  readonly rules: GameRules;
  readonly defs: DefinitionTable;
  readonly expansions: Expansions;
  /** Multiplier applied to the simulation clock (debug x100). The command queue always uses real time. */
  timeScale = 1;
  readonly tutorialSkipped: boolean;
  /**
   * First-session tutorial (model/Tutorial.as). Set while the save has `tutorialEnd != 1`; the restrictions it imposes on
   * tools, taps, timers and polls are consulted below. Undefined once the tutorial is over.
   */
  tutorial: TutorialMachine | undefined;
  /** The loaded save (live: item objects are shared with the item model). */
  readonly state: WorldState;

  private coins: number;
  private cash: number;
  private exp: number;
  private level: number;
  private companyValue: number;
  private readonly itemMap = new Map<string, GameItem>();
  private nextSid: number;
  private readonly companySid: string;
  private readonly loginAt = Date.now();
  private currentTool: Tool = createTool({ kind: "select" });
  private currentGhost: Ghost | null = null;
  private selected: GameItem | null = null;
  private readonly pointer = { wx: 0, wy: 0, valid: false };

  constructor(init: GameInit) {
    super();
    this.defs = init.defs;
    this.rules = init.rules;
    this.expansions = init.expansions;
    this.queue = init.queue;
    this.tutorialSkipped = init.tutorialSkipped ?? false;
    this.tutorial = init.tutorial;
    this.state = init.state;
    const p = init.state.profile;
    this.coins = p.coins;
    this.cash = p.cash;
    this.exp = p.exp;
    this.companyValue = num(p.raw.companyValue);
    this.level = levelOf(this.rules, this.exp);
    this.companySid = init.state.mine?.sid ?? "";
    this.world = new GameWorld(init.state, init.defs, init.expansions, init.solid ?? []);
    this.commands = new GameCommands({ profile: () => this.snapshot(), millisSinceLogin: () => Date.now() - this.loginAt });
    this.commands.security.init();

    // DollarsGame.smItemSid: next sid = max existing + 1 (all companies share the sid space).
    let maxSid = 0;
    for (const c of init.state.companies) for (const it of c.items) maxSid = Math.max(maxSid, Number(it.sid) || 0);
    this.nextSid = maxSid + 1;

    this.economy = new Economy({ rules: this.rules, defs: this.defs, items: () => [...this.itemMap.values()], roads: () => this.world.roads });
    this.on("item-added", () => this.economy.invalidate());
    this.on("item-removed", () => this.economy.invalidate());
    this.on("map", () => this.economy.invalidate());
    this.on("item-changed", (it) => this.economy.noteItem(it));
    // Server-pushed prizes: {_cmd:"doubleRent", _dat:"Houses"|"Commerces"} (Server.java:265-278 -> UserDataFacadeOnline.as:1483).
    this.queue.on((e) => {
      if (e.type === "response" && e.command._cmd === "doubleRent" && typeof e.command._dat === "string") {
        this.economy.setDoubleRent(e.command._dat);
        if (e.command._dat === "Houses" || e.command._dat === "Commerces") this.emit("double-rent", { kind: e.command._dat });
      }
    });

    const now = init.conn.now();
    for (const placed of init.state.mine?.items ?? []) {
      // Saves can hold items whose definition is no longer served (e.g. expired limited editions): keep them in the save
      // untouched but do not simulate them, otherwise every consumer of item.def would crash at boot.
      if (!this.defs.has(placed.sku)) {
        console.warn(`[game] item ${placed.sid} (${placed.sku}) has no definition; not simulated`);
        continue;
      }
      const item = this.makeItem(placed);
      this.itemMap.set(item.sid, item);
    }
    // ItemObject.applyHQConnection at load (:1915-1965): items cut off from the HQ by road are suspended, reconnected ones resume.
    this.economy.invalidate();
    const cutOff = this.tutorial ? new Set<string>() : this.economy.disconnectedSids();
    for (const item of this.itemMap.values()) item.suspended = cutOff.has(item.sid);
    // Catch up with wall-clock time that elapsed while offline (server stamps State@savedAt on every mutation). Suspended items
    // did not run offline (GamePlay.java itemAddTime skips isSuspended); houses advance before commerces because the
    // population a commerce sees depends on its houses' catch-up.
    const env = this.advanceEnv();
    const bootGiving: GameItem[] = [];
    const bootTransitions: Transition[] = [];
    const order = [...this.itemMap.values()].sort((a, b) => Number(a.isCommerce || a.isClub === true) - Number(b.isCommerce || b.isClub === true));
    for (const item of order) {
      const savedAt = num(item.placed.state.savedAt);
      const wasSuspended = item.placed.suspended;
      if (item.isCommerce && item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.GIVING_RENT) {
        bootGiving.push(item); // reported after securityInit below (the original sends it at STATE_RUN_WORLD, with the recomputed baseline)
        continue;
      }
      const dt = wasSuspended ? 0 : savedAt > 0 ? Math.max(0, now - savedAt) : 0;
      // Rent-mode reports of the load-time catch-up go out at STATE_RUN_WORLD, after securityInit (their compValueNow is the recomputed
      // baseline: oracle C13 mode 5 at boot carries 2,424,000); construction completions keep their own ordering.
      if (!this.tutorial && item.stateId === STATE_ID.CONSTRUCTION && item.mode !== CONSTRUCTION_MODE.PAUSED && !(item.suspended && item.mode !== CONSTRUCTION_MODE.INIT) && item.time <= dt) {
        // The server's offline catch-up only runs the construction timer down. The end itself is a logic update of the running world
        // (StateOnConstructionOwner.doDoLogicUpdate -> NotificationConstructionEnd): it happens after securityInit/calculateCompanyValue
        // (oracle C20: new_state compValueNow 842000, building value added after it) and plays the end animation first (tick()).
        item.time = 0;
        this.syncPlaced(item);
        continue;
      }
      const transitions = advanceItem(item, dt, this.rules, env);
      this.handleTransitions(transitions.filter((t) => t.type === "constructionDone"));
      bootTransitions.push(...transitions.filter((t) => t.type !== "constructionDone"));
      this.syncPlaced(item);
    }
    this.pushSuspension(true);
    // DollarsGame.as:815 (world attached, owner): Profile.calculateCompanyValue() recomputes the company value from the items.
    this.companyValue = this.companyValueBreakdown().total;
    // UserDataFacade.securityInit runs later, at STATE_RUN_WORLD (DollarsGame.as:1582), i.e. AFTER the recompute above: the baseline is the
    // recomputed value, so the first security snapshot carries compValueGain 0 (oracle runs C31/C26/C12: ORIG 0 vs ours +152,000 before this).
    this.commands.security.init();
    this.handleTransitions(bootTransitions);
    for (const item of bootGiving) {
      this.endGivingRent(item);
      this.syncPlaced(item);
    }
    this.checkFourMillions();
    this.refreshNextRent();
  }

  /** Profile.setCompanyValue (Profile.as:776-783): the first time the company value exceeds 4,000,000 the flag is persisted (update_profile fourMillions). */
  private checkFourMillions(): void {
    const raw = this.state.profile.raw as Record<string, unknown>;
    if (this.companyValue > 4_000_000 && String(raw.fourMillions ?? "0") !== "1") {
      raw.fourMillions = "1";
      this.send(this.commands.fourMillions());
    }
  }

  /** Population/connectivity facts for advanceItem (StateOnRent.as:1243-1294). */
  private advanceEnv(): AdvanceEnv {
    return { population: (rt) => this.economy.population(rt.sid) };
  }

  /**
   * ItemObject.suspend/resume (StateOnRent.as:915-990): report the HQ-connection changes to the server (upd_suspended with the
   * remaining time) and mirror them on the item. Skipped during the tutorial (TutorialMachine owns its own gating).
   */
  /**
   * StateOnConstruction.suspend/resume (:49-53, 198-212): construction never sends upd_suspended. A never-connected site (mode INIT) is
   * silent until it connects (build XP + RESUME); a running site that loses the HQ goes PAUSED (new_mode 3) and RESUME again on reconnect.
   */
  private constructionConnection(item: GameItem, suspended: boolean, boot: boolean): void {
    if (item.mode === CONSTRUCTION_MODE.INIT) {
      if (suspended || boot) return;
      this.addExp(item.def.rules.exp);
      this.syncBaseline();
      item.mode = CONSTRUCTION_MODE.RESUME;
      this.send(this.commands.constructionMode(item.sid, item.sku, { mode: CONSTRUCTION_MODE.RESUME, time: Math.round(item.time), isSuspended: false }, { exp: item.def.rules.exp, coins: 0, cash: 0 }));
    } else if (item.mode === CONSTRUCTION_MODE.RESUME || item.mode === CONSTRUCTION_MODE.PAUSED) {
      const mode = suspended ? CONSTRUCTION_MODE.PAUSED : CONSTRUCTION_MODE.RESUME;
      if (item.mode === mode || boot) return;
      item.mode = mode;
      this.send(this.commands.constructionMode(item.sid, item.sku, { mode, time: Math.round(item.time), isSuspended: suspended }, NO_GAIN));
    }
  }

  private pushSuspension(boot = false): void {
    if (this.tutorial) return;
    const off = this.economy.disconnectedSids();
    for (const item of this.itemMap.values()) {
      const suspended = off.has(item.sid);
      if (suspended === item.suspended && suspended === item.placed.suspended) continue;
      item.suspended = suspended;
      if (suspended !== item.placed.suspended) {
        item.placed.suspended = suspended;
        // UserDataFacadeOnline.updateItem only sends in STATE_RUN_WORLD (:128): suspensions found while the world loads are NOT reported
        // (oracle: the NPC house stays isSuspended=0 in the save after the tutorial). Reconnections at load go out (SET_ITEM_CONNECTION).
        if (item.stateId === STATE_ID.CONSTRUCTION) this.constructionConnection(item, suspended, boot);
        else if (!boot || !suspended) this.send(this.commands.setSuspended(item.sid, item.sku, suspended, Math.round(item.time)));
      }
      this.economy.invalidateWonders();
      this.emit("item-changed", item);
    }
  }

  // ---- boot ----------------------------------------------------------------------------------------------------------

  /**
   * Loads everything needed from a logged-in connection. Tutorial: the server serves a tutorial-stage world until
   * `tutorial_completed` has been persisted (and resets the save if houses exist before that). The tutorial itself is not
   * implemented yet (docs/feature-inventory.md section 1), so an incomplete profile is completed here and the
   * (completed-tutorial starter) world is re-fetched.
   */
  static async boot(opts: BootOptions): Promise<Game> {
    const { conn, defs, fetchText } = opts;
    const queue = new CommandQueue(conn);
    queue.markLoggedIn(conn.loginSync);
    const [rules, expansionsXml, mapXml] = await Promise.all([
      loadGameRules(fetchText),
      fetchText("expansions.xml"),
      fetchText("universe/map.xml")
    ]);
    const loadWorld = async (): Promise<WorldState> => parseWorld(((await conn.query("get_world", { targetUserId: 1 }))?._dat ?? {}) as Record<string, unknown>);
    let state = await loadWorld();
    let tutorialSkipped = false;
    let tutorial: TutorialMachine | undefined;
    // UserDataFacade.isTutorialRequired (UserDataFacade.as:906): Profile@tutorialEnd != "1" -> the real tutorial runs (ui/tutorial).
    if (String(state.profile.raw.tutorialEnd ?? "0") !== "1") {
      if (opts.skipTutorial) {
        queue.sendCommand(new GameCommands({ profile: () => ({ exp: 0, DCCoins: 0, DCCash: 0, companyValue: 0 }), millisSinceLogin: () => 0 }).tutorialCompleted());
        await queue.drain();
        state = await loadWorld();
        tutorialSkipped = true;
      } else {
        tutorial = new TutorialMachine(inferResumeStep(resumeFacts(state, defs)));
      }
    }
    const expansionDefs = parseExpansions(expansionsXml);
    const expansions = new Expansions(expansionDefs, parsePlotStates((state.profile.raw as Record<string, string>).plots, expansionDefs));
    return new Game({ conn, queue, state, defs, rules, expansions, solid: parseLogicTiles(mapXml), tutorialSkipped, tutorial });
  }

  static fetchRules(base = RULES_ROOT): (file: string) => Promise<string> {
    return async (file) => {
      const res = await fetch(base + file);
      return res.ok ? res.text() : "";
    };
  }

  // ---- profile -------------------------------------------------------------------------------------------------------

  private snapshot(): ProfileSnapshot {
    return { exp: this.exp, DCCoins: this.coins, DCCash: this.cash, companyValue: this.companyValue };
  }

  get profile(): ProfileState {
    return {
      coins: this.coins,
      cash: this.cash,
      exp: this.exp,
      level: this.level,
      companyValue: this.companyValue,
      xpMin: this.rules.xp.find((r) => r.level === this.level)?.xpNeed ?? 0,
      xpMax: xpToReach(this.rules, this.level + 1)
    };
  }

  /**
   * StateOnIA MODE_BOUGHT -> NotificationSellingEnd.onAccept (:75-95): the buyer pays the sale price, the rival item changes company
   * (`new_mode {mode 4, csid}`), and CompanyMine.initItemAfterBuying puts it into StateOnRent (houses wait for a contract). The
   * company value gains the definition value. `price` is checked by the caller (ensureCoins).
   */
  adoptRival(rival: PlacedItem, price: number, viewDelayMs = 0): GameItem | null {
    if (this.coins < price) return null;
    const def = this.defs.get(rival.sku);
    if (!def) return null;
    this.addCoins(-price);
    const commerce = def.rules.kind === "commerce";
    const placed: PlacedItem = { ...rival, stateId: STATE_ID.RENT, state: { id: String(STATE_ID.RENT), mode: String(commerce ? RENT_MODE.RENTING : RENT_MODE.WAITING_FOR_CONTRACT), time: "0" }, suspended: false };
    const item = this.makeItem(placed);
    // Oracle (sell-rival-roads): StateOnIA reports MODE_BUYING (3, time 3000) with the price first, then MODE_BOUGHT (4, csid) when the bar ends
    // and finally the RENT new_state carrying the +company value.
    this.send(this.commands.newMode(placed.sid, placed.sku, { mode: 3, time: SELL_BAR_MS }, { exp: 0, coins: -price, cash: 0 }));
    this.syncPlaced(item);
    // StateOnIA MODE_BUYING: coins are paid at once (NotificationSellingEnd ctor), the SellBarOnHouse runs SELL_BAR_TIME (3 s), then the
    // building turns into the buyer's (MODE_BOUGHT) and the buy mission event fires (oracle compare4 hb1-hb6).
    const finish = (): void => {
      this.send(this.commands.newMode(placed.sid, placed.sku, { mode: 4, time: 0, csid: this.companySid }, NO_GAIN));
      // Oracle (sell-rival-roads): the footprint becomes the buyer's terrain too (Map.sellTerrain, NotificationSellingEnd.as:83): a 3x3
      // townhouse adds 9 x 1,000. It comes AFTER the mode-4 packet so the RENT new_state snapshot carries the gain (mission-C11-2: cvGain 9000).
      this.companyValue += this.terrainPrice * item.cols * item.rows;
      // Oracle (mission-C11-2): a bought commerce reports its income time (180000) in the RENT new_state, houses 0.
      this.send(this.commands.newState(placed.sid, placed.sku, { state: STATE_ID.RENT, mode: commerce ? RENT_MODE.RENTING : RENT_MODE.WAITING_FOR_CONTRACT, time: commerce ? item.incomeMs : 0 }));
      // CompanyMine.initItemAfterBuying (:46) adds the building value AFTER the RENT new_state snapshot (mission-C11-2: new_state cvGain 9000 = terrain only).
      this.companyValue += def.rules.companyValue;
      this.world.removeItem(rival.sid);
      this.itemMap.set(placed.sid, item);
      this.world.addItem(placed);
      this.emit("item-removed", { sid: rival.sid, sku: rival.sku }); // drop the rival view before the owner view is drawn
      this.emit("item-added", item);
      this.poll("buy", placed.sku);
      this.emitProfile();
    };
    if (viewDelayMs > 0) setTimeout(finish, viewDelayMs);
    else finish();
    this.emitProfile();
    return item;
  }

  private emitProfile(): void {
    this.checkFourMillions();
    this.emit("profile", this.profile);
  }

  /** Profile.DCCoins setter: coin changes also move the company value. */
  private addCoins(delta: number): void {
    this.coins += delta;
    this.companyValue += delta;
  }

  /** Company.exp += n; detects level-ups (Profile.levelUp, Profile.as:1485: cash reward from XPTable @DCCashLevelUp). */
  private addExp(delta: number): void {
    if (delta <= 0) {
      return;
    }
    this.exp += delta;
    const next = levelOf(this.rules, this.exp);
    while (this.level < next) {
      const reward = this.rules.levelCash[this.level - 1] ?? 0;
      this.cash += reward;
      this.companyValue += reward * this.rules.settings.cashToCoins;
      this.level += 1;
      this.emit("levelUp", { level: this.level, cashReward: reward });
      this.emit("sound", { event: "level_up" });
      this.emit("toast", { kind: "levelUp", text: `Level ${this.level}!` });
    }
  }

  // ---- items ---------------------------------------------------------------------------------------------------------

  private makeItem(placed: PlacedItem): GameItem {
    const def = this.defs.get(placed.sku);
    const contractSku = placed.state.contractSku !== undefined && placed.state.contractSku !== "" ? Number(placed.state.contractSku) : undefined;
    const contract = contractSku !== undefined ? this.rules.contracts.get(String(contractSku)) : undefined;
    const cols = def?.cols ?? 1;
    const rows = def?.rows ?? 1;
    return {
      sid: placed.sid,
      sku: placed.sku,
      stateId: placed.stateId,
      mode: Number(placed.state.mode ?? 0) || 0,
      time: Number(placed.state.time ?? 0) || 0,
      contractSku,
      // Commerces have no contract: their renting cycle is the definition's incomeTime (StateOnRent.incomeInit :1398).
      incomeMs: contract?.incomeTimeMs ?? (def?.rules.kind === "commerce" ? def.rules.incomeTimeMs : 0),
      isCommerce: def?.rules.kind === "commerce",
      isClub: def !== undefined && itemTypeOf(def.rules) === 4,
      isWonder: def !== undefined && itemTypeOf(def.rules) === 3,
      suspended: false,
      accelerated: placed.state.accelerated !== undefined && placed.state.accelerated !== "" && placed.state.accelerated !== "0",
      crew: placed.crew ? parseCrewAttrs(placed.crew.ids, placed.crew.bought) : undefined,
      placed,
      def: def as ItemDef,
      x: placed.x,
      y: placed.y,
      tileX: tileX(placed.x),
      tileY: tileY(placed.y),
      cols,
      rows
    };
  }

  /** Writes runtime fields back into the PlacedItem (so itemView.stateFromItem and re-renders stay consistent). */
  private syncPlaced(item: GameItem): void {
    const p = item.placed;
    p.stateId = item.stateId;
    p.x = item.x;
    p.y = item.y;
    p.state = { ...p.state, id: String(item.stateId), mode: String(item.mode), time: String(Math.round(item.time)) };
    if (item.contractSku !== undefined) p.state.contractSku = String(item.contractSku);
    else delete p.state.contractSku;
  }

  items(): GameItem[] {
    return [...this.itemMap.values()];
  }
  item(sid: string): GameItem | undefined {
    return this.itemMap.get(sid);
  }
  itemAtTile(tx: number, ty: number): GameItem | undefined {
    const it = this.world.itemAt(tx, ty);
    return it ? this.itemMap.get(it.sid) : undefined;
  }
  get selection(): GameItem | null {
    return this.selected;
  }
  get tool(): ToolState {
    return this.currentTool.state;
  }
  get ghost(): Ghost | null {
    return this.currentGhost;
  }

  select(sid: string | null): void {
    this.selected = sid ? (this.itemMap.get(sid) ?? null) : null;
    this.emit("selection", this.selected);
  }

  private changed(item: GameItem): void {
    this.syncPlaced(item);
    this.emit("item-changed", item);
    this.refreshNextRent();
  }

  private lastNextRent: number | undefined;
  /** Profile.mNextRentCurrentValue / mNextRentCurrentItemSid (Profile.as:945-975): what the profile last reported (even when nothing was sent). */
  private profileNextRent = { value: -2, sid: null as string | null };
  /**
   * Company.nextRentCalculate -> Profile.nextRentUpdate (Profile.as:945-975): the owner reports the soonest rent to the server
   * (update_next_rent, seconds; 0 = a rent is ready, -1 = none). Company level: only when the value changed. Profile level: while the
   * previously reported value is > 0 it only sends when a DIFFERENT item became the next one (so the same item running down to 0 sends
   * nothing); otherwise it sends when the value differs. The tutorial controller sends its own.
   */
  private refreshNextRent(): void {
    if (this.tutorial) return;
    let ready = false;
    let min = Number.POSITIVE_INFINITY;
    let minSid: string | null = null;
    for (const it of this.itemMap.values()) {
      // StateOnRent.needsToBeTrackedForRent (:1057-1060): commerces are never the "next rent"; only houses/clubs in mode RENTING count.
      if (it.stateId !== STATE_ID.RENT || it.isCommerce) continue;
      if (it.mode === RENT_MODE.GET_RENT) ready = true;
      else if (it.mode === RENT_MODE.RENTING && it.time < min) {
        min = it.time;
        minSid = it.sid;
      }
    }
    const value = ready ? 0 : Number.isFinite(min) ? Math.max(1, min) : -1;
    if (value === this.lastNextRent) return;
    this.lastNextRent = value;
    const pf = this.profileNextRent;
    // A ready rent (value 0) keeps the same "current item" (Company.nextRentCalculate only sets the value to 0); no rent at all clears it.
    const sid = ready ? pf.sid : value > 0 ? minSid : null;
    const changed = pf.value > 0 ? pf.sid === null || sid === null || sid !== pf.sid : pf.value !== value;
    pf.value = value;
    pf.sid = sid;
    if (changed) this.send(this.commands.nextRent(value > 0 ? Math.trunc(value / 1000) : value));
  }

  private send(cmd: PacketCommand | null): void {
    if (cmd) {
      this.queue.sendCommand(cmd);
    }
  }

  /**
   * Commands built from `securityCreateObj` (explicit gains) carry the STALE baseline as `*Now` (UserDataFacade.as:404-415); the
   * facade then calls securityUpdate() (UserDataFacadeOnline.as:90-95, 136-141, 244-249, 822-827) which only advances the baseline. The
   * server applies the reported GAIN (SecurityNormal.verify), so the lag is harmless there, and it is what makes the original's
   * persisted company value lag by the last event (docs/save-parity.md). Deliberately no baseline sync here.
   */
  private syncBaseline(): SecurityTracker {
    return this.commands.security;
  }

  /**
   * UI hooks (ui/popups): a hook that takes over returns true / is called instead of acting. Unset = original headless behaviour.
   * confirmSell/confirmMove mirror PopupConfirmDestroy / PopupConfirmMove; notEnoughCoins opens the exchange-gold dialog.
   */
  hooks: {
    confirmSell?: (sid: string) => void;
    confirmMove?: (sid: string, tx: number, ty: number) => void;
    notEnoughCoins?: (needed: number) => void;
    /** Click on a house showing a collectible (ui/rewards opens the found popup). */
    collectibleFound?: (sid: string) => void;
    /** Tool.itemAttachedProcessNotAbleToPlace: PopupMessage for a refused build/move placement (ui/popups). */
    placeRefused?: (sku: string) => void;
    /** A free reward item (ToolState.gift) was placed (ToolBuild.EVENT_PLACE_GIFT_ITEM). */
    giftPlaced?: (sku: string, ref?: string) => void;
  } = {};
  /** sid -> collectible sku the server awarded to that house (get_collectibles_list Pending / give_collectible); owned by ui/rewards. */
  readonly pendingCollectibles = new Map<string, string>();
  /** sid -> upgrade type (0 normal, 1 super) of my houses that visitors upgraded (ui/social loads get_upgrades_list). */
  readonly upgrades = new Map<string, number>();
  /** social.xml upgradesOwnerExtraPercentage / superUpgradesOwnerExtraPercentage. */
  upgradeExtraPercent: number[] = [10, 12];
  /** Price of the last failed coin check (feeds hooks.notEnoughCoins). */
  private shortfall = 0;
  private noCoins(price: number): Check {
    this.shortfall = price;
    return { ok: false, reason: "Not enough coins" };
  }

  /** sku of the last refused placement check (feeds hooks.placeRefused). */
  private placeSku = "";

  toast(text: string, kind: ToastEvent["kind"] = "info"): void {
    if ((text === "Cannot build here" || text === "Cannot move here") && this.hooks.placeRefused) {
      this.hooks.placeRefused(this.placeSku);
      return;
    }
    if (text === "Not enough coins" && this.hooks.notEnoughCoins) {
      this.hooks.notEnoughCoins(this.shortfall);
      return;
    }
    this.emit("toast", { kind, text });
  }

  // ---- simulation ----------------------------------------------------------------------------------------------------

  /** Per-frame update: advance the command queue (real time) and the item timers (scaled time). */
  tick(dtMs: number): void {
    this.queue.tick(dtMs);
    this.tickGivingRent(dtMs);
    const sim = dtMs * this.timeScale;
    this.pushSuspension(); // HQ road connectivity changed (road/item edits invalidate the economy model)
    const env = this.advanceEnv();
    this.tickConstructionEnd(dtMs);
    for (const item of this.itemMap.values()) {
      // Construction and rent countdowns wait for smTutorialEnd (StateOnConstruction.as:254, StateOnRent.as:1189); a finished
      // instant build (time 0) must still settle.
      if (this.tutorial?.timersFrozen && !(item.stateId === STATE_ID.CONSTRUCTION && item.time <= 0)) continue;
      if (this.constructionEndPending(item, sim)) continue;
      if (item.stateId === STATE_ID.CONSTRUCTION || (item.stateId === STATE_ID.RENT && (item.mode === RENT_MODE.RENTING || item.mode === RENT_MODE.GET_RENT))) {
        const t = advanceItem(item, sim, this.rules, env);
        if (t.length > 0) {
          this.handleTransitions(t);
          this.changed(item);
        }
      }
    }
    this.emitPopulation();
  }

  /** Set by the UI: true while a popup is open (DollarsGame.mShowPopup); World.logicUpdate and the world animations stand still then. */
  logicPaused: () => boolean = () => false;
  /** sid -> real ms left of the construction-end animation (the item stays in construction until it is over). */
  private readonly constructionEnd = new Map<string, number>();
  private tickConstructionEnd(dtMs: number): void {
    if (this.logicPaused()) return;
    for (const [sid, left] of this.constructionEnd) this.constructionEnd.set(sid, left - dtMs);
  }
  /** True while the finished construction of `item` is still waiting for / playing its end notification (the transition is held back). */
  private constructionEndPending(item: GameItem, sim: number): boolean {
    if (this.tutorial || item.stateId !== STATE_ID.CONSTRUCTION || item.mode === CONSTRUCTION_MODE.PAUSED || item.time > sim) return false;
    if (item.suspended && item.mode !== CONSTRUCTION_MODE.INIT) return false;
    if (this.logicPaused()) return true; // the notification is created by the (paused) logic update
    const left = this.constructionEnd.get(item.sid);
    if (left === undefined) {
      item.time = 0; // mTime ran out; the item waits in construction for the notification
      this.constructionEnd.set(item.sid, CONSTRUCTION_END_ANIM_MS);
      return true;
    }
    if (left > 0) return true;
    this.constructionEnd.delete(item.sid);
    return false;
  }

  /** sid -> real ms left of a commerce's GIVING_RENT animation (StateOnRent.checkEnd :1720-1732 -> setNextMode). */
  private readonly givingRent = new Map<string, number>();
  private tickGivingRent(dtMs: number): void {
    for (const [sid, left] of this.givingRent) {
      if (left > dtMs) {
        this.givingRent.set(sid, left - dtMs);
        continue;
      }
      this.givingRent.delete(sid);
      const item = this.itemMap.get(sid);
      if (item) this.endGivingRent(item);
    }
  }
  /** GIVING_RENT -> RENTING for a commerce (StateOnRent.setNextMode :1744-1760); also what a load of a saved mode 6 does (:693 setNextMode(false)). */
  private endGivingRent(item: GameItem): void {
    if (item.stateId !== STATE_ID.RENT || item.mode !== RENT_MODE.GIVING_RENT) return;
    item.mode = RENT_MODE.RENTING;
    item.time = item.incomeMs;
    this.send(this.commands.rentMode(item.sid, item.sku, { mode: RENT_MODE.RENTING, time: Math.round(item.time) }, NO_GAIN));
    this.changed(item);
  }

  private readonly lastPopulation = new Map<string, number>();
  /** StateOnRent.as:1348-1372: commerces feed the checkInfluence mission events with their population; listeners (ui/missions) get the change. */
  private emitPopulation(): void {
    for (const item of this.itemMap.values()) {
      if (!item.isCommerce || item.stateId !== STATE_ID.RENT) continue;
      const population = this.economy.population(item.sid);
      if (this.lastPopulation.get(item.sid) === population) continue;
      this.lastPopulation.set(item.sid, population);
      this.emit("commerce-population", { sid: item.sid, sku: item.sku, nameType: "Commerces", population });
    }
  }

  private addConstructionValue(item: GameItem | undefined): void {
    if (!item) return;
    this.companyValue += item.def.rules.companyValue; // CompanyMine.initItemAfterBuying (CompanyMine.as:31-44)
    this.emitProfile();
  }

  /** Sends the server notifications the original sends for each timer transition. */
  private handleTransitions(transitions: Transition[]): void {
    for (const { type, rt } of transitions) {
      const item = this.itemMap.get(rt.sid);
      switch (type) {
        case "constructionDone":
          // ItemObject.changeState sends `new_state` (with securityUpdate()) BEFORE the new state's enter() runs initItemAfterBuying
          // (CompanyMine.as:31-44) which adds the building value: the value shows up in the NEXT snapshot (oracle C15: new_state cvGain 0, cvNow 842,000).
          if (rt.isWonder) {
            // CompanyMine.initItemAfterBuying (:37): wonders enter StateOnBuilt (id 5); the effects start (StateOnBuilt.enter :80-90).
            this.send(this.commands.newState(rt.sid, rt.sku, { state: STATE_ID.BUILT, mode: 0, time: 0 }));
            this.addConstructionValue(item);
            this.economy.invalidateWonders();
          } else {
            this.send(this.commands.finishConstruction(rt.sid, rt.sku));
            this.addConstructionValue(item);
            // StateOnRent.doEnter (:260-270): commerces start renting at once and report mode 4 with the income time.
            if (rt.isCommerce) this.send(this.commands.rentMode(rt.sid, rt.sku, { mode: RENT_MODE.RENTING, time: Math.round(rt.time) }, NO_GAIN));
          }
          break;
        case "rentRestarted":
          // StateOnRent.as:1270-1292 (commerce lost its population while waiting): back to renting with a new income time.
          if (item) this.send(this.commands.rentMode(rt.sid, rt.sku, { mode: RENT_MODE.RENTING, time: Math.round(rt.time) }, NO_GAIN));
          break;
        case "rentReady":
          if (item) this.send(this.commands.rentMode(rt.sid, rt.sku, { mode: RENT_MODE.GET_RENT, time: Math.ceil(rt.time / 1000) * 1000, contractSku: rt.contractSku }, NO_GAIN));
          break;
        case "abandoned":
          if (item) this.send(this.commands.rentMode(rt.sid, rt.sku, { mode: RENT_MODE.ABANDONED, time: 0, contractSku: rt.contractSku }, NO_GAIN));
          break;
      }
    }
  }

  /** True when no command is queued or in flight (safe to reload the page). */
  isIdle(): boolean {
    return this.queue.serverIsBusy() === 2;
  }

  /** Force-send queued commands and wait for the responses. */
  async flush(): Promise<void> {
    await this.queue.drain();
  }

  // ---- build ---------------------------------------------------------------------------------------------------------

  /** ItemDefinition.requiresTerrainMine is false (decorations). */
  noPlotSku(sku: string): boolean {
    const d = this.defs.get(sku);
    return d !== undefined && this.noPlot(d.rules);
  }

  private noPlot(def: ItemDefinition): boolean {
    return !requiresTerrainMine(def);
  }

  checkBuild(sku: string, tx: number, ty: number): Check {
    const def = this.defs.get(sku);
    if (!def) return { ok: false, reason: "Unknown item" };
    const r = def.rules;
    const forced = this.tutorial?.checkBuild(sku, tx, ty);
    if (forced && !forced.ok) return forced;
    if (r.level > this.level) return { ok: false, reason: `Requires level ${r.level}` };
    if (!isBuildable(this.world, tx, ty, r, { noNeedPlot: this.noPlot(r) })) {
      this.placeSku = sku;
      return { ok: false, reason: "Cannot build here" };
    }
    if (this.coins < r.constructionCoins) return this.noCoins(r.constructionCoins);
    if (this.cash < r.constructionCash) return { ok: false, reason: "Not enough cash" };
    return { ok: true };
  }

  /** ToolBuild.startBuildingItem: pays, creates the item in construction (new_item) and grants the build XP (resume). */
  build(sku: string, tx: number, ty: number): boolean {
    const c = this.checkBuild(sku, tx, ty);
    if (!c.ok) {
      const rules = this.defs.get(sku)?.rules;
      const short = rules && c.reason?.startsWith("Not enough") && this.hasListeners("need-money");
      if (short && rules) this.emit("need-money", { sku, coins: Math.max(0, rules.constructionCoins - this.coins), cash: Math.max(0, rules.constructionCash - this.cash) });
      else if (c.reason) this.toast(c.reason, "error");
      return false;
    }
    const fromStorage = this.buildsFromStorage(sku);
    const gift = this.currentTool.state.kind === "build" && this.currentTool.state.sku === sku ? this.currentTool.state.gift : undefined;
    const def = this.defs.get(sku) as ItemDef;
    const r0 = def.rules;
    if (sku === HQ_SKU) return this.buildHeadquarters(def, tx, ty);
    // ToolBuild.mFromStorage: stored items are free (no coins/cash; the server consumes the vault entry via new_item `storage`).
    const r = fromStorage || gift ? { ...r0, constructionCoins: 0, constructionCash: 0 } : r0;
    // Role.doGetInitialItemState (Role.as:50-66): decorations are built at once, clubs wait for their crew.
    const initial = initialStateKind(r0, this.rules.crew.get(def.attrs.constructionCrew ?? "")?.jobs.length ?? 0);
    if (initial === "built" || initial === "crew") return this.buildWithoutConstruction(def, initial, tx, ty, r, fromStorage, gift);
    const sid = String(this.nextSid++);
    // Tutorial step 3 (Company.as:751): the site is not connected to the HQ yet, so construction stays suspended (new_item isSuspended=1,
    // no XP) until the two road pieces of step 4 are built (resumeTutorialConstruction).
    const deferStart = this.tutorial?.holdConstructionStart === true;
    const placed: PlacedItem = {
      sid,
      sku,
      x: relX(tx),
      y: relY(ty),
      stateId: STATE_ID.CONSTRUCTION,
      state: { id: "0", mode: String(CONSTRUCTION_MODE.INIT), time: String(r.constructionTimeMs) },
      suspended: deferStart
    };
    this.addCoins(-r.constructionCoins);
    this.cash -= r.constructionCash;
    // No company value while under construction (StateOnConstruction.hasCompanyValue :223 = false; oracle build-house: placing a 30,000 house
    // moves the HUD company value 762,000 -> 732,000). It is added by initItemAfterBuying when the construction ends (handleTransitions).
    const item = this.makeItem(placed);
    item.mode = CONSTRUCTION_MODE.INIT;
    item.time = r.constructionTimeMs;
    this.itemMap.set(sid, item);
    this.world.addItem(placed);
    // new_item carries the securityUpdate() snapshot (build cost + company value) ...
    this.send(
      this.commands.newItem({
        sid, csid: this.companySid, sku, type: this.itemTypeId(sku), x: placed.x, y: placed.y, state: { id: STATE_ID.CONSTRUCTION, mode: CONSTRUCTION_MODE.INIT, time: r.constructionTimeMs }, dec: 0,
        isSuspended: true, // oracle: a new construction site is always reported suspended; the resume below (XP + RESUME, isSuspended 0) follows at once when it is road-connected
        ...(fromStorage ? { extra: { key: "storage", value: "true" } } : gift?.extra ? { extra: gift.extra } : {})
      })
    );
    if (gift) this.hooks.giftPlaced?.(sku, gift.ref);
    if (fromStorage) this.emit("storage-used", { sku });
    // ... then StateOnConstruction.resume: exp += def.exp and setMode(RESUME) (StateOnConstruction.as:198-210), but only when the site is
    // HQ-connected (Map.placeItem -> searchHQConnection -> ItemObject.applyHQConnection :1937); a disconnected site stays INIT and silent
    // (StateOnConstruction.setMode :162), oracle mission-C06-9.
    this.economy.invalidate();
    if (!deferStart && !this.economy.isConnected(sid)) {
      item.suspended = true;
      placed.suspended = true;
      this.syncBaseline();
    } else if (deferStart) {
      item.suspended = true;
      this.syncBaseline();
    } else {
      this.addExp(r.exp);
      this.syncBaseline();
      item.mode = CONSTRUCTION_MODE.RESUME;
      this.send(this.commands.constructionMode(sid, sku, { mode: CONSTRUCTION_MODE.RESUME, time: r.constructionTimeMs, isSuspended: false }, { exp: r.exp, coins: 0, cash: 0 }));
    }
    this.syncPlaced(item);
    this.emit("item-added", item);
    this.emit("sound", { event: "build_placed" });
    this.poll("build", sku); // ToolBuild.as:243
    this.emitProfile();
    return true;
  }

  /**
   * Items that skip the construction timer: decorations (StateOnBuilt.enter :80-97: pay, +exp, company value) and clubs
   * (StateOnHireCrew.enter/resume :86-91,64-77: state 7 INIT -> exp -> HIRING; the value is added when the crew is complete).
   */
  private buildWithoutConstruction(
    def: ItemDef,
    kind: "built" | "crew",
    tx: number,
    ty: number,
    r: ItemDefinition,
    fromStorage: boolean,
    gift: { extra?: { key: string; value: unknown }; ref?: string } | undefined
  ): boolean {
    const sku = def.sku;
    const sid = String(this.nextSid++);
    const built = kind === "built";
    const placed: PlacedItem = {
      sid,
      sku,
      x: relX(tx),
      y: relY(ty),
      stateId: built ? STATE_ID.BUILT : STATE_HIRE_CREW,
      state: built ? { id: String(STATE_ID.BUILT) } : { id: String(STATE_HIRE_CREW), mode: String(HIRE_CREW_MODE.INIT) },
      suspended: false,
      ...(built ? {} : { crew: { ids: "", bought: "" } })
    };
    this.addCoins(-r.constructionCoins);
    this.cash -= r.constructionCash;
    if (built) this.companyValue += r.companyValue; // initItemAfterConstruction (CompanyMine.as:46)
    const item = this.makeItem(placed);
    item.mode = built ? 0 : HIRE_CREW_MODE.INIT;
    this.itemMap.set(sid, item);
    this.world.addItem(placed);
    if (built) this.addExp(r.exp);
    this.send(
      this.commands.newItem({
        sid, csid: this.companySid, sku, type: this.itemTypeId(sku), x: placed.x, y: placed.y,
        state: built ? { id: STATE_ID.BUILT } : { id: STATE_HIRE_CREW, mode: HIRE_CREW_MODE.INIT },
        ...(built ? {} : { crew: { ids: "", bought: "" } }),
        dec: built ? 1 : 0,
        ...(fromStorage ? { extra: { key: "storage", value: "true" } } : gift?.extra ? { extra: gift.extra } : {})
      })
    );
    if (built) this.destroyTerrainUnder(r, tx, ty); // Map.placeItem: decorations on owned terrain remove it (after new_item, before the poll)
    if (!built) {
      this.addExp(r.exp);
      this.syncBaseline();
      item.mode = HIRE_CREW_MODE.HIRING;
      this.send(this.commands.hireCrewMode(sid, sku, { mode: HIRE_CREW_MODE.HIRING, isSuspended: false }, { exp: r.exp, coins: 0, cash: 0 }));
    } else {
      this.syncBaseline();
    }
    if (gift) this.hooks.giftPlaced?.(sku, gift.ref);
    if (fromStorage) this.emit("storage-used", { sku });
    this.syncPlaced(item);
    this.emit("item-added", item);
    this.emit("sound", { event: "build_placed", isDecoration: built });
    this.poll("build", sku);
    this.emitProfile();
    return true;
  }

  /**
   * The Headquarters (tutorial step 1) is created directly in StateOnHeadQuarter (id 4): no construction, cost or timers
   * (ToolBuild.startBuildingItem + ItemObject initial state for HQs); server `new_item` stores State id 4.
   */
  private buildHeadquarters(def: ItemDef, tx: number, ty: number): boolean {
    const sid = String(this.nextSid++);
    const placed: PlacedItem = { sid, sku: def.sku, x: relX(tx), y: relY(ty), stateId: STATE_ID.HEADQUARTER, state: { id: String(STATE_ID.HEADQUARTER), mode: "0", time: "0" }, suspended: false };
    const item = this.makeItem(placed);
    this.itemMap.set(sid, item);
    this.world.addItem(placed);
    this.send(this.commands.newItem({ sid, csid: this.companySid, sku: def.sku, type: 0, x: placed.x, y: placed.y, state: { id: STATE_ID.HEADQUARTER }, hqDecorations: true, dec: 0 }));
    this.syncBaseline();
    this.syncPlaced(item);
    this.emit("item-added", item);
    this.emit("sound", { event: "build_placed" });
    this.emitProfile();
    return true;
  }

  /** SKUs unlocked early with gold (get_unlocked_items_list); filled by ui/shop. */
  readonly unlockedSkus = new Set<string>();

  private buildsFromStorage(sku: string): boolean {
    const t = this.currentTool.state;
    return t.kind === "build" && t.sku === sku && t.fromStorage === true;
  }

  /** Offline gold purchase (PopupGold.as:405 -> update_money buyGold; the server awards gold+freeGold from fbcredits.xml). */
  buyGoldPackage(sku: string, gold: number): void {
    this.cash += gold;
    this.companyValue += gold * this.rules.settings.cashToCoins;
    this.send(this.commands.buyGold(sku));
    this.emitProfile();
  }

  /** UnlockedListManager.unlockItem: pay `gold` (getUnlockPrice(false)) and mark the item unlocked, then update_money "unlockItem". */
  unlockItem(sku: string, gold: number): boolean {
    if (gold < 0 || this.cash < gold) return false;
    this.cash -= gold;
    this.companyValue -= gold * this.rules.settings.cashToCoins;
    this.unlockedSkus.add(sku);
    this.send(this.commands.unlockItem(sku));
    this.emit("item-unlocked", { sku });
    this.emitProfile();
    return true;
  }

  /**
   * FreeGiftDefinitionManager.openBox: apply a box prize (cash = value x level coins, exp = value % of the level span, gold,
   * move/item go to the storage which the server updates) and send update_money "openBox".
   */
  applyBoxPrize(p: { sku: string; type: string; value: string }): { coins: number; exp: number; cash: number } {
    const v = Number(p.value) || 0;
    const out = { coins: 0, exp: 0, cash: 0 };
    if (p.type === "cash") out.coins = v * this.level;
    else if (p.type === "gold") out.cash = v;
    else if (p.type === "exp") out.exp = Math.trunc(((xpToReach(this.rules, this.level + 1) - (this.rules.xp.find((r) => r.level === this.level)?.xpNeed ?? 0)) * v) / 100);
    if (out.coins) this.addCoins(out.coins);
    if (out.cash) {
      this.cash += out.cash;
      this.companyValue += out.cash * this.rules.settings.cashToCoins;
    }
    if (out.exp) this.addExp(out.exp);
    this.syncBaseline();
    this.send(this.commands.openBox(p.sku, p.type, p.value));
    this.emitProfile();
    return out;
  }

  /** Debug/UI helper: nearest spot to (nearTx, nearTy) inside owned plots where `sku` fits, buying missing terrain tiles. */
  findSpot(sku: string, nearTx = MAP_COLS / 2, nearTy = MAP_ROWS / 2): { x: number; y: number } | null {
    const def = this.defs.get(sku);
    if (!def) return null;
    const r = def.rules;
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = 0; y + r.baseRows <= MAP_ROWS; y += 1) {
      for (let x = 0; x + r.baseCols <= MAP_COLS; x += 1) {
        // Footprint must be free of items/roads/solids and inside owned plots (terrain is bought on demand).
        let free = true;
        for (let dx = 0; dx < r.baseCols && free; dx += 1) {
          for (let dy = 0; dy < r.baseRows && free; dy += 1) {
            const t = this.world.tile(x + dx, y + dy);
            free = !!t && t.occupiedBy === null && !t.road && !t.solid && this.world.inAreaMine(x + dx, y + dy);
          }
        }
        if (!free) continue;
        const d = Math.hypot(x - nearTx, y - nearTy);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /** Debug helper: place `sku` at the nearest free owned spot (buys terrain as needed). */
  autoBuild(sku: string): GameItem | null {
    const def = this.defs.get(sku);
    const spot = def ? this.findSpot(sku) : null;
    if (!def || !spot) {
      this.toast("No free spot", "error");
      return null;
    }
    if (requiresTerrainMine(def.rules)) {
      for (let dx = 0; dx < def.rules.baseCols; dx += 1) {
        for (let dy = 0; dy < def.rules.baseRows; dy += 1) {
          if (!this.world.tile(spot.x + dx, spot.y + dy)?.terrain && !this.buyTerrain(spot.x + dx, spot.y + dy)) return null;
        }
      }
    }
    return this.build(sku, spot.x, spot.y) ? ([...this.itemMap.values()].pop() ?? null) : null;
  }

  // ---- move / sell ---------------------------------------------------------------------------------------------------

  checkMove(sid: string, tx: number, ty: number): Check {
    const item = this.itemMap.get(sid);
    if (!item) return { ok: false, reason: "No item" };
    if (!isBuildable(this.world, tx, ty, item.def.rules, { noNeedPlot: this.noPlot(item.def.rules), movingSid: sid })) {
      this.placeSku = item.sku;
      return { ok: false, reason: "Cannot move here" };
    }
    if (!this.moveRented && !this.hooks.confirmMove && this.coins < this.movePrice(item)) return this.noCoins(this.movePrice(item));
    return { ok: true };
  }

  movePrice(item: GameItem): number {
    return movePrice(this.rules, this.level, item.def.rules);
  }

  /** Move entered from the vault "move" item (ToolMove.mUsingFreeMove): confirmation popup instead of the pay popup. */
  moveFree = false;
  /** Crane operator rented (service "move", Profile.servicesContract): moves are free until this wall-clock time. */
  private moveRentedUntil = 0;
  /** servicesDefinitions.xml sku="move": priceCash 10, timeDuration 24 h. */
  readonly moveRentPrice = 10;

  get moveRented(): boolean {
    return Date.now() < this.moveRentedUntil;
  }

  /** PopupPayMove.onRent -> Profile.servicesContract("move"): gold paid, `update_money service`, moves free for 24 h. */
  rentMove(): boolean {
    if (this.cash < this.moveRentPrice) return false;
    this.cash -= this.moveRentPrice;
    this.companyValue -= this.moveRentPrice * this.rules.settings.cashToCoins;
    this.moveRentedUntil = Date.now() + 24 * 3600_000;
    this.send(this.commands.service("move", 0, "0"));
    this.emitProfile();
    return true;
  }

  startMove(sid: string): void {
    if (!this.itemMap.has(sid)) return;
    this.setTool({ kind: "move", sid });
    // ItemObject.startMoving -> suspend() (StateOnRent.as:913-923): upd_suspended 1 while the item is carried.
    const item = this.itemMap.get(sid)!;
    if (item.stateId === STATE_ID.RENT && !item.suspended) {
      this.movingSuspended = sid;
      this.send(this.commands.setSuspended(sid, item.sku, true, Math.round(item.time)));
    }
  }

  /** Sid whose move pick sent upd_suspended 1 (resumed by endMoving: on drop or when the move tool is left). */
  private movingSuspended: string | null = null;
  private resumeMoving(): void {
    const sid = this.movingSuspended;
    this.movingSuspended = null;
    const item = sid ? this.itemMap.get(sid) : undefined;
    if (item) this.send(this.commands.setSuspended(item.sid, item.sku, false, Math.round(item.time)));
  }

  /** ItemDefinition.getFormatId: decorations use the short format (1) with Config.OPT_USE_SHORT_FORMAT (oracle: dec 1 on new_item/move). */
  private formatIdOf(sku: string): number {
    return this.defs.get(sku)?.rules.kind === "decoration" ? 1 : 0;
  }

  /**
   * Map.placeItem (Map.as:1514-1527): tiles of the footprint that are owned terrain are destroyed when the item does not require
   * owned terrain (decorations): destroyTile -> destroyTileApplyEconomy (company value -= terrain price, coins += destroy profit) and
   * `update_map del Terrain` per tile. Oracle order: new_item, del Terrain x N, pollmanager build (move: del Terrain before `move`).
   */
  private destroyTerrainUnder(def: ItemDefinition, tx: number, ty: number): void {
    if (requiresTerrainMine(def)) return;
    for (let dx = 0; dx < def.baseCols; dx += 1) {
      for (let dy = 0; dy < def.baseRows; dy += 1) {
        if (this.world.tile(tx + dx, ty + dy)?.terrain) this.removeTerrain(tx + dx, ty + dy);
      }
    }
  }

  moveItem(sid: string, tx: number, ty: number, confirmed = false): boolean {
    const c = this.checkMove(sid, tx, ty);
    const item = this.itemMap.get(sid);
    if (!c.ok || !item) {
      if (c.reason) this.toast(c.reason, "error");
      return false;
    }
    if (!confirmed && !this.moveRented && this.hooks.confirmMove) {
      this.hooks.confirmMove(sid, tx, ty);
      return true;
    }
    const cost = this.moveRented ? 0 : this.movePrice(item);
    // The balance never goes below zero: every paid action checks the price first (the free-move confirm popup used to skip this).
    if (cost > this.coins) {
      this.noCoins(cost);
      this.toast("Not enough coins", "error");
      this.hooks.notEnoughCoins?.(cost);
      return false;
    }
    // Map.placeItem destroys owned terrain under a non-terrain item (decorations) BEFORE the move cost is paid and sent
    // (oracle C30: update_map del Terrain +1000, then update_item move -400; doing it after consumed the -400 into the baseline).
    this.destroyTerrainUnder(item.def.rules, tx, ty);
    this.addCoins(-cost);
    this.world.removeItem(sid); // footprint is derived from the (still old) placed.x/y
    item.x = relX(tx);
    item.y = relY(ty);
    item.tileX = tx;
    item.tileY = ty;
    this.syncPlaced(item);
    this.world.addItem(item.placed);
    this.resumeMoving(); // ItemObject.move -> endMoving() -> resume() precedes the move call (oracle: upd_suspended 0 then move)
    this.send(this.commands.move(sid, item.x, item.y, this.formatIdOf(item.sku)));
    this.emit("item-changed", item);
    this.emit("sound", { event: "item_moved" });
    this.poll("moveHouse", item.sku); // ToolMove.as:263
    this.emitProfile();
    return true;
  }

  isDestroyable(item: GameItem): boolean {
    return item.stateId !== STATE_ID.HEADQUARTER && item.sku !== "HeadQuarter";
  }

  /** Coins refunded by selling (settingsGetDestroyItemProfit). */
  sellPrice(item: GameItem): number {
    return destroyProfit(this.rules, item.def.rules);
  }

  /** ToolDestroy on an item (StateItemObject.demolish, StateItemObject.as:783-814; the 3 s demolition bar is skipped). */
  sellItem(sid: string): boolean {
    const item = this.itemMap.get(sid);
    if (!item || !this.isDestroyable(item)) {
      return false;
    }
    const profit = this.sellPrice(item);
    this.addCoins(profit);
    if (item.stateId !== STATE_ID.CONSTRUCTION) {
      // StateItemObject.demolish (:803): ItemObject.getCompanyValue = def value + signed contract cost.
      const contractCost = item.contractSku !== undefined ? this.rules.contracts.get(String(item.contractSku))?.costCoins ?? 0 : 0;
      this.companyValue -= item.def.rules.companyValue + contractCost; // construction state has no company value (StateOnConstruction.as:223)
    }
    this.world.removeItem(sid);
    this.itemMap.delete(sid);
    if (this.selected?.sid === sid) this.select(null);
    this.send(this.commands.destroy(sid, this.formatIdOf(item.sku)));
    this.emit("item-removed", { sid, sku: item.sku });
    this.refreshNextRent();
    this.emit("sound", { event: "item_demolished", isDecoration: item.def.rules.kind === "decoration" });
    if (profit > 0) this.toast(`+${profit} coins`, "coins");
    this.emitProfile();
    return true;
  }

  // ---- contracts / rent ----------------------------------------------------------------------------------------------

  contractOptions(sid: string): ContractOption[] {
    const item = this.itemMap.get(sid);
    if (!item) return [];
    return contractsForDef(this.rules, item.def.rules).map((c) => this.option(item, c));
  }

  private option(item: GameItem, c: ContractInfo): ContractOption {
    return {
      sku: Number(c.sku),
      name: c.name,
      icon: c.icon,
      level: c.level,
      unlocked: this.level >= c.level,
      affordable: this.coins >= c.costCoins,
      cost: c.costCoins,
      // Houses include the influence of the surrounding decorations/wonders (ItemObject.getIncomeValue :369); clubs the population.
      income: item.isClub
        ? this.economy.commerceInfoIncome(item, c)
        : getIncomeValue({ def: item.def.rules, contract: c, influenceValue: this.economy.influencePercent(item.sid) }),
      xp: getIncomeXP(item.def.rules, c),
      timeMs: c.incomeTimeMs
    };
  }

  /** StateOnRent MODE_SIGNING_CONTRACT (StateOnRent.as:551-566): pay the contract cost, start the rent countdown. */
  signContract(sid: string, contractSku: number | string): boolean {
    const item = this.itemMap.get(sid);
    if (!item || item.stateId !== STATE_ID.RENT || item.mode !== RENT_MODE.WAITING_FOR_CONTRACT) {
      return false;
    }
    const c = contractsForDef(this.rules, item.def.rules).find((x) => x.sku === String(contractSku));
    if (!c) return false;
    if (this.level < c.level) {
      this.toast(`Requires level ${c.level}`, "error");
      return false;
    }
    if (this.coins < c.costCoins) {
      this.shortfall = c.costCoins;
      this.toast("Not enough coins", "error");
      return false;
    }
    const incomeMs = this.tutorial?.incomeTimeMs(c.incomeTimeMs) ?? c.incomeTimeMs; // StateOnRent.incomeInit (:1398)
    this.addCoins(-c.costCoins);
    this.companyValue += c.costCoins; // Profile.companyValue += contract cost (StateOnRent.as:567)
    item.mode = RENT_MODE.RENTING;
    item.time = incomeMs;
    item.incomeMs = incomeMs;
    item.contractSku = Number(c.sku);
    this.syncBaseline();
    this.send(
      this.commands.signContract(sid, item.sku, { contractSku: Number(c.sku), incomeTimeMs: incomeMs, contractGroupSku: item.def.rules.contractsTypeSku, tutorialEnd: !this.tutorial?.active }, { exp: 0, coins: -c.costCoins, cash: 0 })
    );
    this.changed(item);
    this.emit("sound", { event: "contract_signed" });
    this.emitProfile();
    return true;
  }

  /** Tutorial step 8 (StateOnRent.setBehaviorTutorial: enableContract + MODE_GET_RENT): the rent is ready to collect right now. */
  forceRentReady(sid: string): boolean {
    const item = this.itemMap.get(sid);
    if (!item || item.stateId !== STATE_ID.RENT || item.mode === RENT_MODE.GET_RENT) return false;
    item.mode = RENT_MODE.GET_RENT;
    item.time = 0;
    this.send(this.commands.rentMode(sid, item.sku, { mode: RENT_MODE.GET_RENT, time: 3_600_000, contractSku: item.contractSku }, NO_GAIN)); // oracle: GET_RENT is reported with time 3,600,000
    this.changed(item);
    return true;
  }

  /** Cancel an active contract: refund cancelContractProfitPercentage of its cost (StateOnRent.as:453-470). */
  cancelContract(sid: string): boolean {
    const item = this.itemMap.get(sid);
    const c = item?.contractSku !== undefined ? this.rules.contracts.get(String(item.contractSku)) : undefined;
    if (!item || !c || item.stateId !== STATE_ID.RENT || (item.mode !== RENT_MODE.RENTING && item.mode !== RENT_MODE.ABANDONED && item.mode !== RENT_MODE.GET_RENT)) {
      return false;
    }
    const refund = Math.trunc((c.costCoins * this.rules.settings.cancelContractProfitPercentage) / 100);
    this.addCoins(refund);
    item.mode = RENT_MODE.WAITING_FOR_CONTRACT;
    item.time = 0;
    item.incomeMs = 0;
    item.contractSku = undefined;
    this.syncBaseline();
    this.send(this.commands.cancelContract(sid, item.sku, { exp: 0, coins: refund, cash: 0 }));
    this.changed(item);
    this.emitProfile();
    return true;
  }

  /** Click on an abandoned house: free reset back to "waiting for contract" (MODE_RESETING_ABANDONED is UI-only). */
  resetAbandoned(sid: string): boolean {
    const item = this.itemMap.get(sid);
    if (!item || item.stateId !== STATE_ID.RENT || item.mode !== RENT_MODE.ABANDONED) {
      return false;
    }
    item.mode = RENT_MODE.WAITING_FOR_CONTRACT;
    item.time = 0;
    item.incomeMs = 0;
    item.contractSku = undefined;
    this.syncBaseline();
    this.send(this.commands.rentMode(sid, item.sku, { mode: RENT_MODE.WAITING_FOR_CONTRACT, time: 0 }, NO_GAIN));
    this.changed(item);
    return true;
  }

  /**
   * StateOnRent.onIncome/giveIncome (:877-897,1455-1490): pays the rent. Houses/clubs return to WAITING_FOR_CONTRACT, commerces
   * restart renting (checkIfCollectible :2017). Commerces pay once per affected house (population * income), every payment
   * doubled while the server-granted double-rent prize is active (giveDCCoins :1592).
   */
  collectRent(sid: string): { coins: number; exp: number } | null {
    const item = this.itemMap.get(sid);
    // ItemObject.suspend (:915): an item cut off from the HQ by road is inert (no mouse over / income) until it is reconnected.
    if (!item || item.stateId !== STATE_ID.RENT || item.mode !== RENT_MODE.GET_RENT || item.suspended) {
      return null;
    }
    const contract = item.contractSku !== undefined ? this.rules.contracts.get(String(item.contractSku)) : undefined;
    const nameType = item.isCommerce ? "Commerces" : item.isClub ? "Clubs" : "Houses";
    const doubled = this.economy.isDoubleRent(nameType);
    const multiplier = this.rules.settings.incomeMultiplier || 2;
    // Visitor upgrades (get_upgrades_list, ui/social): the next collection pays +upgradesOwnerExtraPercentage (ItemObject.as:358) and the
    // GET_RENT -> GIVING_RENT report carries upgradeType (StateOnRent.as:785); the server then marks the upgrade applied.
    const upType = this.upgrades.get(sid);
    const upPct = upType !== undefined ? this.upgradeExtraPercent[upType] ?? this.upgradeExtraPercent[0] : undefined;
    let coins: number;
    let xp: number;
    let perHouse: Array<{ sid: string; coins: number }> = [];
    if (item.isCommerce || item.isClub) {
      const pay = this.economy.commercePayout(item, contract);
      perHouse = pay.perHouse.map((h) => ({ sid: h.sid, coins: withDoubleRent(h.coins, multiplier, doubled) }));
      coins = perHouse.reduce((n, h) => n + h.coins, 0);
      xp = pay.xp;
    } else {
      const base = getIncomeValue({ def: item.def.rules, contract, upgradeExtraPercentage: upPct, influenceValue: this.economy.influencePercent(sid) });
      coins = withDoubleRent(base, multiplier, doubled);
      // ItemObject.incomeXP (:767): the upgrade percentage also applies to the experience.
      const baseXp = getIncomeXP(item.def.rules, contract);
      xp = upPct !== undefined ? baseXp + Math.trunc((upPct * baseXp) / 100) : baseXp;
    }
    this.upgrades.delete(sid);
    this.addCoins(coins);
    this.addExp(xp);
    const sku = item.sku;
    const pending = this.pendingCollectibles.has(sid);
    // StateOnRent.as:806-809 / checkIfCollectible (:2015): a pending drop goes to COLLECTIBLE (14); else WAITING_FOR_CONTRACT
    // (houses/clubs) or a new renting cycle (commerces).
    const nextMode = pending ? RENT_MODE.COLLECTIBLE : item.isCommerce ? RENT_MODE.RENTING : RENT_MODE.WAITING_FOR_CONTRACT;
    // StateOnRent.as:770: the report carries the persisted State time, i.e. the remaining abandon countdown (oracle: 3,591,766 after ~8 s).
    const abandonLeftMs = Math.round(Math.max(0, item.time));
    // Commerce: StateOnRent.as:684-695 MODE_GIVING_RENT waits for the ICON_RENT_COLLECT animation (checkEnd) before setNextMode; the
    // oracle persists mode 6 / time 0 for 10+ s after the collect (mode 4 is only sent later), so the return to RENTING is deferred.
    const deferNext = item.isCommerce && nextMode === RENT_MODE.RENTING;
    item.mode = deferNext ? RENT_MODE.GIVING_RENT : nextMode;
    item.time = deferNext ? 0 : nextMode === RENT_MODE.RENTING ? item.incomeMs : 0;
    if (deferNext) this.givingRent.set(sid, GIVING_RENT_MS);
    if (!item.isCommerce) item.incomeMs = 0;
    // The contract cost counted in the company value while the contract ran (signContract, StateOnRent.as:567) leaves with it: the oracle's
    // collect reports compValueGain = rent - contract cost (357 - 90 = 267 in the tutorial).
    if (!item.isCommerce && contract) this.companyValue -= contract.costCoins;
    item.contractSku = undefined;
    item.accelerated = false;
    this.syncBaseline();
    const gained = { exp: xp, coins, cash: 0 };
    if (item.isCommerce) {
      // Commerce: GET_RENT -> GIVING_RENT (6) carries the gain (and doubleRent), then the next mode (SecurityNormal.java:362-400).
      this.send(this.commands.collectRent(sid, sku, { time: 0, collectible: false, ...(doubled ? { doubleRent: true } : {}) }, gained));
      if (!deferNext) this.send(this.commands.rentMode(sid, sku, { mode: nextMode, time: Math.round(item.time) }, NO_GAIN));
    } else {
      this.send(
        this.commands.rentMode(
          sid,
          sku,
          { mode: nextMode, time: abandonLeftMs, ...(upType !== undefined ? { upgradeType: String(upType) } : {}), ...(doubled ? { doubleRent: true } : {}) },
          gained
        )
      );
    }
    if (doubled) this.economy.clearDoubleRent(); // UserDataFacadeOnline.as:143-147
    this.changed(item);
    this.emit("sound", { event: "collect_rent" });
    // StateOnRent.giveIncome (:1471-1484): collect <nameType>%<contract time sku> + nameType + sku.
    this.poll("collect", sku, contract ? String(contract.incomeTimeMs / 3_600_000) : undefined);
    this.emit("rent-collected", { sid, sku, coins, exp: xp, doubled, houses: perHouse });
    // No toast: the original only shows the floating PointsAnimation texts (ui/economy/fx.ts).
    this.emitProfile();
    return { coins, exp: xp };
  }

  collectAll(): { coins: number; exp: number; count: number } {
    const total = { coins: 0, exp: 0, count: 0 };
    for (const item of this.items()) {
      const r = this.collectRent(item.sid);
      if (r) {
        total.coins += r.coins;
        total.exp += r.exp;
        total.count += 1;
      }
    }
    return total;
  }

  // ---- economy: accelerators, crew, company value -----------------------------------------------------------------------

  /** ToolRentAccelerator target check (StateOnRent.canBeAccelerated :237 + ItemObject.canBeAccelerated :1424). */
  canAccelerate(sid: string): boolean {
    const it = this.itemMap.get(sid);
    return !!it && !it.suspended && canBeAccelerated(it);
  }

  /**
   * ToolRentAccelerator.doReportMouseUp (:44-62): StateOnRent.accelerateIncomeTime (the remaining rent time drops by `percent`% of
   * the contract time), the stored accelerator is consumed and `update_money rentAccelerator {sku,itemSid}` is sent.
   * `giftSku` is the giftDefinitions.xml sku (fgift_NNN, action rentAccelerator, value = percent) the server expects; `storageSku`
   * is the storage entry it is kept under (its giftType, e.g. rentAcc30).
   */
  accelerate(sid: string, giftSku: string, percent: number, storageSku = giftSku): boolean {
    const it = this.itemMap.get(sid);
    if (!it || !this.canAccelerate(sid) || percent <= 0) return false;
    it.time = acceleratedTime(it.time, it.incomeMs, percent);
    it.accelerated = true;
    it.placed.state = { ...it.placed.state, accelerated: "1" };
    this.send(this.commands.rentAccelerator(giftSku, sid));
    this.emit("storage-used", { sku: storageSku }); // StorageManager.removeItem: stored under the gift type (e.g. rentAcc30)
    this.emit("sound", { event: "collect_rent" });
    this.changed(it);
    return true;
  }

  /** Crew definition of a club (ItemDefinition.constructionCrewSku -> crewMechanicsDefinition.xml). */
  crewDefinition(sid: string): import("./crew").CrewDefinition | undefined {
    const it = this.itemMap.get(sid);
    return it ? this.rules.crew.get(it.def.attrs.constructionCrew ?? "") : undefined;
  }

  /**
   * PopupHireCrew.onBuy / CrewItemContent.buyCrew (:100-112, 215-232): pay `goldPrice` gold per empty slot (`slots` = indices, default all
   * empty ones), mark them bought and send `update_item buy_crew {position}`.
   */
  buyCrew(sid: string, slots?: number[]): boolean {
    const it = this.itemMap.get(sid);
    const def = this.crewDefinition(sid);
    if (!it || !def || it.stateId !== STATE_HIRE_CREW) return false;
    const crew = (it.crew ??= { invited: [], paid: [] });
    const empty = crewSlots(def, crew).filter((sl) => sl.status === "free").map((sl) => sl.index);
    const want = (slots ?? empty).filter((i) => empty.includes(i));
    if (want.length === 0) return false;
    const price = want.length * def.goldPrice;
    if (this.cash < price) {
      this.emit("need-money", { sku: it.sku, coins: 0, cash: price - this.cash });
      return false;
    }
    this.cash -= price;
    this.companyValue -= price * this.rules.settings.cashToCoins; // Profile.DCCash setter moves the company value
    crew.paid.push(...want);
    it.placed.crew = crewAttrs(crew);
    this.send(this.commands.buyCrew(sid, want.join(",")));
    this.changed(it);
    this.emitProfile();
    return true;
  }

  /**
   * PopupHireCrew.onComplete -> NotificationConstructionEnd.onAccept -> CompanyMine.initItemAfterBuying (:31-44): once the crew is
   * complete the club becomes a StateOnRent item (waiting for a contract) and its value is added to the company value.
   */
  completeCrew(sid: string): boolean {
    const it = this.itemMap.get(sid);
    const def = this.crewDefinition(sid);
    if (!it || !def || it.stateId !== STATE_HIRE_CREW || !crewComplete(def, it.crew ?? { invited: [], paid: [] })) return false;
    it.stateId = STATE_ID.RENT;
    it.mode = RENT_MODE.WAITING_FOR_CONTRACT;
    it.time = 0;
    this.companyValue += it.def.rules.companyValue;
    this.send(this.commands.finishConstruction(sid, it.sku));
    this.syncBaseline();
    this.changed(it);
    this.emit("sound", { event: "build_placed" });
    this.emitProfile();
    return true;
  }

  /** Gold still needed to fill the empty crew slots (PopupHireCrew.setCompletePrice). */
  crewPrice(sid: string): number {
    const it = this.itemMap.get(sid);
    const def = this.crewDefinition(sid);
    return it && def ? crewCompletePrice(def, it.crew ?? { invited: [], paid: [] }) : 0;
  }

  /**
   * Company.getCompanyValue (:636) from the live model (PopupValue rows: coins, gold, buildings, terrain). The running
   * `profile.companyValue` is tracked incrementally from the server snapshot; this is the recomputation used to audit it.
   */
  companyValueBreakdown(): ReturnType<typeof computeCompanyValue> {
    const sellable = this.items().filter((i) => i.stateId !== STATE_ID.CONSTRUCTION && i.stateId !== STATE_HIRE_CREW && i.stateId !== STATE_ID.SELLING && i.stateId !== STATE_ID.DEMOLITION);
    return computeCompanyValue({
      coins: this.coins,
      cash: this.cash,
      cashToCoins: this.rules.settings.cashToCoins,
      items: sellable.map((i) => ({
        companyValue: i.def.rules.companyValue,
        contractCost: i.contractSku !== undefined ? this.rules.contracts.get(String(i.contractSku))?.costCoins ?? 0 : 0
      })),
      terrainTiles: this.world.terrain.size,
      terrainPrice: terrainPrice(this.rules, this.level),
      expansions: expansionsValue(this.rules.expansionCash, this.expansionCount, this.rules.settings.cashToCoins)
    });
  }

  // ---- map tiles -----------------------------------------------------------------------------------------------------

  get terrainPrice(): number {
    return terrainPrice(this.rules, this.level);
  }

  checkTerrain(tx: number, ty: number): Check {
    const forced = this.tutorial?.checkTerrain(tx, ty);
    if (forced && !forced.ok) return forced;
    const t = this.world.tile(tx, ty);
    if (!t) return { ok: false, reason: "Out of map" };
    if (!this.world.inAreaMine(tx, ty)) return { ok: false, reason: "Buy this area first" };
    if (t.terrain) return { ok: false, reason: "Already yours" };
    if (t.occupiedBy !== null || t.road || t.solid) return { ok: false, reason: "Tile is busy" };
    if (this.coins < this.terrainPrice) return this.noCoins(this.terrainPrice);
    return { ok: true };
  }

  /** Map.buyTerrain / setTileTerrain: coins -= terrainPrice, update_map add Terrain. */
  buyTerrain(tx: number, ty: number): boolean {
    const c = this.checkTerrain(tx, ty);
    if (!c.ok) {
      if (c.reason) this.toast(c.reason, "error");
      return false;
    }
    const price = this.terrainPrice;
    this.addCoins(-price);
    this.companyValue += price; // the tile counts as company value (see destroyTileApplyEconomy, Map.as:1688)
    this.world.addTerrain(tx, ty);
    this.syncBaseline();
    this.send(this.commands.addTerrain(relX(tx), relY(ty), price));
    this.emit("map", { kind: "terrain" });
    this.emitProfile();
    return true;
  }

  checkRoad(tx: number, ty: number): Check {
    const forced = this.tutorial?.checkRoad(tx, ty);
    if (forced && !forced.ok) return forced;
    const t = this.world.tile(tx, ty);
    if (!t) return { ok: false, reason: "Out of map" };
    if (!this.world.inAreaMine(tx, ty)) return { ok: false, reason: "Buy this area first" };
    if (t.road) return { ok: false, reason: "Already a road" };
    if (t.occupiedBy !== null || t.solid) return { ok: false, reason: "Tile is busy" };
    return { ok: true };
  }

  /** Map.roadTileBuild: a road on owned terrain first destroys the terrain (with its refund), then update_map add Road. */
  buildRoad(tx: number, ty: number): boolean {
    const c = this.checkRoad(tx, ty);
    if (!c.ok) {
      if (c.reason) this.toast(c.reason, "error");
      return false;
    }
    if (this.world.tile(tx, ty)?.terrain) {
      this.removeTerrain(tx, ty);
    }
    this.world.setRoad(tx, ty, true);
    this.send(this.commands.addRoad(relX(tx), relY(ty)));
    this.emit("map", { kind: "road" });
    this.emitProfile();
    return true;
  }

  /** Map.destroyTile + destroyTileApplyEconomy (Map.as:2862, 1688). */
  private removeTerrain(tx: number, ty: number): void {
    const price = this.terrainPrice;
    const profit = destroyTerrainProfit(this.rules, price);
    this.companyValue -= price;
    this.addCoins(profit);
    this.world.removeTerrain(tx, ty);
    this.syncBaseline();
    this.send(this.commands.delTerrain(relX(tx), relY(ty), profit));
    this.emit("map", { kind: "terrain" });
  }

  checkDestroy(tx: number, ty: number): Check {
    const item = this.itemAtTile(tx, ty);
    if (item) return this.isDestroyable(item) ? { ok: true } : { ok: false, reason: "Cannot be sold" };
    const t = this.world.tile(tx, ty);
    if (t && this.world.inAreaMine(tx, ty) && (t.road || t.terrain)) return { ok: true };
    return { ok: false };
  }

  /** ToolDestroy.doReportMouseUp: item -> sell; else road -> remove; else own terrain -> remove (refund). */
  destroyAt(tx: number, ty: number): boolean {
    const item = this.itemAtTile(tx, ty);
    if (item) {
      if (this.hooks.confirmSell && this.isDestroyable(item)) {
        this.hooks.confirmSell(item.sid);
        return true;
      }
      return this.sellItem(item.sid);
    }
    const t = this.world.tile(tx, ty);
    if (!t || !this.world.inAreaMine(tx, ty)) return false;
    if (t.road) {
      this.world.setRoad(tx, ty, false);
      this.send(this.commands.delRoad(relX(tx), relY(ty)));
      this.emit("map", { kind: "road" });
      this.emitProfile();
      return true;
    }
    if (t.terrain) {
      this.removeTerrain(tx, ty);
      this.emitProfile();
      return true;
    }
    return false;
  }

  // ---- tools / pointer -----------------------------------------------------------------------------------------------

  setTool(state: ToolState): void {
    if (this.tutorial && !this.tutorial.allowTool(state)) return; // tutorial: only the tool of the current step
    if (this.movingSuspended && !(state.kind === "move" && state.sid === this.movingSuspended)) this.resumeMoving();
    this.currentTool = createTool(state);
    this.emit("tool", this.currentTool.state);
    this.refreshGhost();
  }

  /** Pointer moved over the map (WORLD pixels, i.e. already divided by the camera). */
  pointerMove(wx: number, wy: number): void {
    this.pointer.wx = wx;
    this.pointer.wy = wy;
    this.pointer.valid = true;
    this.refreshGhost();
  }

  pointerLeave(): void {
    this.pointer.valid = false;
    this.refreshGhost();
  }

  /** A click that was not a camera drag. */
  pointerClick(wx: number, wy: number): void {
    this.pointer.wx = wx;
    this.pointer.wy = wy;
    this.pointer.valid = true;
    if (this.tutorial && !this.tutorial.allowMapClick()) return; // smMap.disable()
    this.currentTool.click(this, wx, wy);
    this.refreshGhost();
  }

  private refreshGhost(): void {
    const g = this.pointer.valid ? this.currentTool.ghost(this, this.pointer.wx, this.pointer.wy) : null;
    this.currentGhost = g;
    this.emit("ghost", g);
  }

  // ToolHost helpers
  footprintOf(sku: string): { cols: number; rows: number } | undefined {
    const d = this.defs.get(sku);
    return d ? { cols: d.cols, rows: d.rows } : undefined;
  }
  footprintOfItem(sid: string): { cols: number; rows: number; sku: string } | undefined {
    const i = this.itemMap.get(sid);
    return i ? { cols: i.cols, rows: i.rows, sku: i.sku } : undefined;
  }
  snapBuild(sku: string, tx: number, ty: number): { x: number; y: number } {
    return this.tutorial?.snapBuild(sku, tx, ty) ?? { x: tx, y: ty };
  }
  /** ItemDefinition.type (TYPE_HOUSES_ID 0, COMMERCES 1, DECORATIONS 2, WONDERS 3, CLUBS 4): new_item carries it (ItemObject.as:2379). */
  itemTypeId(sku: string): number {
    const d = this.defs.get(sku);
    switch (d?.rules.kind) {
      case "commerce": return 1;
      case "decoration": return 2;
      case "other": return /^clubs?_/.test(sku) ? 4 : /^bundle/.test(sku) ? 5 : 3;
      default: return 0;
    }
  }
  isDecorationSku(sku: string): boolean {
    return this.defs.get(sku)?.rules.kind === "decoration";
  }

  // ---- popups support (ui/popups): instant build, gold exchange, plot purchase ------------------------------------------

  /** RulesFacade.getInstantBuildPrice (RulesFacade.as:331): Profile.getTimePrice(timeMs) * instantBuildFactor, int-cast. */
  instantBuildPrice(item: GameItem): number {
    const timePrice = this.rules.xp[this.level - 1]?.timePrice ?? 0;
    return instantBuildPriceAt(timePrice, Math.max(0, item.time), item.def.rules.instantBuildFactor);
  }

  /** StateOnConstructionOwner.instantBuildCash (:240-251): pay coins, MODE_INSTANT_BUILD, time = 0 (the tick finishes it). */
  instantBuild(sid: string): boolean {
    const item = this.itemMap.get(sid);
    if (!item || item.stateId !== STATE_ID.CONSTRUCTION || item.time <= 0) return false;
    const price = this.instantBuildPrice(item);
    if (this.coins < price) return false;
    this.addCoins(-price);
    // StateOnConstructionOwner.instantBuildCash: setMode(INSTANT_BUILD) runs BEFORE mTime = 0, so new_mode carries the remaining time (oracle log).
    const remaining = Math.round(item.time);
    item.mode = CONSTRUCTION_MODE.INSTANT_BUILD;
    item.time = 0;
    this.syncBaseline();
    this.send(this.commands.constructionMode(sid, item.sku, { mode: CONSTRUCTION_MODE.INSTANT_BUILD, time: remaining, isSuspended: false }, { exp: 0, coins: -price, cash: 0 }));
    this.poll("instantBuild"); // StateOnConstructionOwner.as:231/249
    this.changed(item);
    this.emitProfile();
    return true;
  }

  /**
   * Tutorial step 1: in the same packet as the HQ new_item the original sends `new_mode {mode:1 (IA WAIT), time:0}` for the NPC rival
   * house (oracle command log; the server turns it into the item's tutorial-stage state).
   */
  tutorialRivalWait(): void {
    for (const c of this.state.companies) {
      if (c === this.state.mine) continue;
      for (const it of c.items) if (it.sku === "houses_001_002") this.send(this.commands.iaMode(it.sid, it.sku, { mode: 1, time: 0 }, NO_GAIN));
    }
  }

  /** StateOnConstruction.setBehaviorTutorial(step 5): mTime -= 100 (the oracle then charges $468 for the 599,900 ms left). */
  tutorialShaveConstruction(sid: string): void {
    const item = this.itemMap.get(sid);
    if (item && item.stateId === STATE_ID.CONSTRUCTION) item.time = Math.max(0, item.time - 100);
  }

  /** Tutorial: the HQ-connecting roads are done, the held Bungalow site resumes (build XP + RESUME, like the normal placement path). */
  resumeTutorialConstruction(sid: string): void {
    const item = this.itemMap.get(sid);
    if (!item || item.stateId !== STATE_ID.CONSTRUCTION || !item.suspended) return;
    const r = item.def.rules;
    item.suspended = false;
    item.placed.suspended = false;
    this.addExp(r.exp);
    this.syncBaseline();
    item.mode = CONSTRUCTION_MODE.RESUME;
    this.send(this.commands.constructionMode(sid, item.sku, { mode: CONSTRUCTION_MODE.RESUME, time: item.time, isSuspended: false }, { exp: r.exp, coins: 0, cash: 0 }));
    this.syncPlaced(item);
    this.changed(item);
    this.emitProfile();
  }

  /** PopupConfirm.onExangeGold: gold -> coins at cashToCoins, then update_money "exchange" (Profile.exchangeDone). */
  exchangeGold(gold: number): boolean {
    if (gold <= 0 || this.cash < gold) return false;
    const k = this.rules.settings.cashToCoins;
    this.cash -= gold;
    this.companyValue -= gold * k;
    this.addCoins(gold * k);
    this.send(this.commands.exchange(gold));
    this.emitProfile();
    return true;
  }

  /** Number of bought expansion plots (Profile.mExpansionsMineCount: owned plots beyond the initial ones). */
  get expansionCount(): number {
    return this.expansions.defs.filter((d, i) => d.unlockedOrder > 0 && this.expansions.states[i] === 2).length;
  }

  /** Map.buyPlot (Map.as:1340-1390): own the plot, unlock the next order (server unlockNextPlots), spend coins or gold. */
  buyPlot(plot: number, pay: { coins?: number; cash?: number }): boolean {
    const ex = this.expansions;
    if (ex.states[plot] !== 1) return false;
    const coins = pay.coins ?? 0;
    const cash = pay.cash ?? 0;
    if (this.coins < coins || this.cash < cash) return false;
    if (coins) this.addCoins(-coins);
    if (cash) {
      this.cash -= cash;
      this.companyValue -= cash * this.rules.settings.cashToCoins;
    }
    ex.states[plot] = 2;
    const order = ex.defs[plot].unlockedOrder;
    if (ex.defs.every((d, i) => d.unlockedOrder !== order || ex.states[i] === 2)) {
      ex.defs.forEach((d, i) => {
        if (d.unlockedOrder === order + 1 && ex.states[i] === 0) ex.states[i] = 1;
      });
    }
    // Map.buyPlot (Map.as:1346-1393): updatePlots is sent with the snapshot of the spent coins, and only then Profile.calculateCompanyValue()
    // recomputes the value (adding the plot's expansion value, e.g. +1,740,000 in oracle C12), which the NEXT command's snapshot reports as
    // compValueGain. The mission commands triggered by the buyExpansion event come after (the original updates missions on a later frame), so the
    // event is registered after the plots command: registering it first lets update_missions consume the coin gain (server then misses the -4,000,000).
    this.send(this.commands.buyPlot(plot));
    this.companyValue = this.companyValueBreakdown().total;
    this.poll("buyExpansion"); // Map.as:1760
    this.emit("map", { kind: "terrain" });
    this.emitProfile();
    return true;
  }

  /** ToolSelect click: select the item under the cursor; ready rent is collected, abandoned houses are reset. */
  /** Set by ui/hud: a multifunction tool (move / collector / contract signator) owns the next map click (ToolsBar.setMultiTool), so ToolSelect must not act. */
  multiToolActive: () => boolean = () => false;

  activateTile(tx: number, ty: number): void {
    if (this.multiToolActive()) return;
    if (this.tutorial && !this.tutorial.allowTile(tx, ty)) return; // only the Bungalow reacts (StateOnRent.as:1062)
    const item = this.itemAtTile(tx, ty);
    this.select(item?.sid ?? null);
    if (!item) return;
    if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.GET_RENT) {
      this.collectRent(item.sid);
    } else if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.ABANDONED) {
      this.resetAbandoned(item.sid);
    } else if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.COLLECTIBLE) {
      this.hooks.collectibleFound?.(item.sid); // StateOnRent MODE_COLLECTIBLE click -> PopupCollectibleFound (ui/rewards)
    } else if (item.stateId === STATE_HIRE_CREW && item.mode === HIRE_CREW_MODE.HIRING && !item.suspended) {
      this.emit("hire-crew", { sid: item.sid }); // StateOnHireCrewOwner.doDoClick (:34-41): PopupHireCrew when connected to the HQ
    } else if (item.stateId === STATE_ID.HEADQUARTER && !this.tutorial) {
      this.emit("hq-click", { sid: item.sid }); // StateOnHeadQuarter.doClick (:60-68): PopupValue
    }
  }

  // ---- reward / generic hooks for UI areas (ui/rewards, ui/social) ---------------------------------------------------

  /**
   * CollectibleManager.keepCollectibleTask/sell: the pending drop was handled; the house returns to WAITING_FOR_CONTRACT
   * (GIVING_COLLECTIBLE -> WAITING is reported with the next new_mode).
   */
  collectibleGotten(sid: string): void {
    this.pendingCollectibles.delete(sid);
    const item = this.itemMap.get(sid);
    if (!item || item.mode !== RENT_MODE.COLLECTIBLE) return;
    // StateOnRent.as:1306: after the pending drop commerces return to renting, houses/clubs to waiting for a contract.
    const next = item.isCommerce ? RENT_MODE.RENTING : RENT_MODE.WAITING_FOR_CONTRACT;
    item.mode = next;
    item.time = item.isCommerce ? item.incomeMs : 0;
    this.syncBaseline();
    this.send(this.commands.rentMode(sid, item.sku, { mode: next, time: Math.round(item.time) }, NO_GAIN));
    this.changed(item);
  }

  /** Play a game sound through the audio mapper (main.ts wires "sound" -> AudioManager). */
  emitSound(event: AudioEvent): void {
    this.emit("sound", { event });
  }

  /** Announce a mission-relevant occurrence (PollManager.registerEvent call sites); other areas call this for investment/visit... */
  poll(type: string, sku?: string, extra?: string): void {
    if (this.tutorial && !this.tutorial.pollsEnabled) return; // PollManager.registerEvent: only after smTutorialEnd (PollManager.as:115)
    this.emit("poll", { type, sku, extra });
  }

  /** StorageManager.addItem for reward items: the storage area listens to "storage-added". */
  addStorageItem(sku: string, amount: number): void {
    this.emit("storage-added", { sku, amount });
  }

  /** Queue a prebuilt command (UI areas build them through `game.commands`). */
  sendCommand(cmd: PacketCommand | null): void {
    this.send(cmd);
  }

  /**
   * Apply an already-decided reward/cost to the profile (Company.exp/DCCoins/DCCash setters). Coins and gold also move the
   * company value (Profile.DCCoins setter); exp may level up. Returns false (and changes nothing) if a negative delta is unaffordable.
   * The caller then builds the matching command (the security snapshot is taken from the live profile afterwards).
   */
  applyGain(g: { exp?: number; coins?: number; cash?: number }): boolean {
    const { exp = 0, coins = 0, cash = 0 } = g;
    if (this.coins + coins < 0 || this.cash + cash < 0) return false;
    this.addCoins(coins);
    if (cash) {
      this.cash += cash;
      this.companyValue += cash * this.rules.settings.cashToCoins;
    }
    this.addExp(exp);
    this.emitProfile();
    return true;
  }
}
