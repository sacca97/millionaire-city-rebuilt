// Client-side command layer: typed builders that emit EXACTLY the payloads the original Flash client sent.
//
// Citations are relative to decompiled/scripts/com/dchoc/dollars/ (gitignored reference):
//   UDFO = model/userdata/UserDataFacadeOnline.as   UDF = model/userdata/UserDataFacade.as
// "Server:" lines name the handler in apps/server/src/commandHandlers.ts (CommandService) that consumes the command.
// "MISMATCH:" lines flag fields the server ignores / mis-handles (apps/server is intentionally not edited).
//
// Builders return PacketCommand without `_cnt`; CommandQueue (session.ts) stamps `_cnt` (Server.sendCommand, Server.as:306).
// Preconditions the original enforced before calling the facade (caller's responsibility here):
//   updateItem/updateMap/updatePlots: current universe role == owner AND game state == RUN_WORLD (UDFO:127,175,815)
//   updateItem additionally skipped while UserDataFacade.smSecurityIgnore (set during ItemObject.changeState, ItemObject.as:1132)
//   updateMoney/updateMissions/updatePollManager/updateNextRent: game state == RUN_WORLD (UDFO:1714,1226,1603,774)
//   updateProfile: role == owner (UDFO:367)

import type { PacketCommand } from "./protocol";

// ---------------------------------------------------------------------------------------------------------------------
// Security snapshot (UDF.securityUpdate/securityInit/securityCreateObj)
// ---------------------------------------------------------------------------------------------------------------------

export interface Security {
  expGain: number;
  coinsGain: number;
  cashGain: number;
  compValueGain: number;
  expNow: number;
  coinsNow: number;
  cashNow: number;
  compValueNow: number;
  /** Only the daily-reward flow adds this (DailyBonusManager.as:92). */
  item?: string | null;
}

export interface ProfileSnapshot {
  exp: number;
  DCCoins: number;
  DCCash: number;
  companyValue: number;
}

export interface CommandContext {
  /** Live profile values (DollarsGame.getProfile()). */
  profile(): ProfileSnapshot;
  /** UserDataFacade.timerGetTimeSinceLogin(): ms since the login timer was set (UDF.as:658, 857). */
  millisSinceLogin(): number;
}

/**
 * Port of the static baseline kept by UserDataFacade (smExp/smDcCoins/smDcCash/smCompValue/smLastCompValueGain).
 * - init(): securityInit (UDF.as:385) - called once when the world starts (DollarsGame.as:1582).
 * - update(): securityUpdate (UDF.as:357) - returns gain = current - baseline, now = current, and ADVANCES the baseline.
 * - create(): securityCreateObj (UDF.as:404) - gains given by the caller, "now" = the (stale) baseline, no advance.
 */
/** RulesFacade.sigGetTotal() of the 0.501 rules, as sent by the original (oracle: load_success {sig:395581429}); GamePlay/Server.java compares it with Config.rulesHashcode. */
export const RULES_SIG = 395581429;

export class SecurityTracker {
  private exp = 0;
  private coins = 0;
  private cash = 0;
  private compValue = 0;
  /** UserDataFacade.smLastCompValueGain is an uninitialised static Number (NaN) until the first securityUpdate(): it serialises as null (oracle C15 `new_mode 5`). */
  private lastCompValueGain = Number.NaN;

  constructor(private readonly profile: () => ProfileSnapshot) {}

  init(): void {
    const p = this.profile();
    this.exp = p.exp;
    this.coins = p.DCCoins;
    this.cash = p.DCCash;
    this.compValue = p.companyValue;
  }

  update(): Security {
    const p = this.profile();
    const expGain = (p.exp - this.exp) | 0; // AS3 `var:int`
    const coinsGain = (p.DCCoins - this.coins) | 0;
    const cashGain = (Math.trunc(p.DCCash) - this.cash) | 0;
    const compValueGain = p.companyValue - this.compValue;
    this.lastCompValueGain = compValueGain;
    this.exp = p.exp;
    this.coins = p.DCCoins;
    this.cash = Math.trunc(p.DCCash);
    this.compValue = p.companyValue;
    return {
      expGain,
      coinsGain,
      cashGain,
      compValueGain,
      expNow: this.exp,
      coinsNow: this.coins,
      cashNow: this.cash,
      compValueNow: this.compValue
    };
  }

  create(expGain: number, coinsGain: number, cashGain: number): Security {
    return {
      expGain,
      coinsGain,
      cashGain,
      compValueGain: this.lastCompValueGain,
      expNow: this.exp,
      coinsNow: this.coins,
      cashNow: this.cash,
      compValueNow: this.compValue
    };
  }
}

/** Gains accumulated by a state object (mGainedExp/mGainedDCCoins/mGainedDCCash) fed to securityCreateObj. */
export interface Gained {
  exp: number;
  coins: number;
  cash: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Item tree = Server.XMLToObject(getPersistence()) (Server.as:103-211, ItemObject.getPersistence ItemObject.as:2367-2396)
// ---------------------------------------------------------------------------------------------------------------------

export interface TreeNode {
  [key: string]: string | TreeNode[];
}

export interface ItemStateAttrs {
  id: number | string;
  mode?: number | string;
  time?: number | string;
  contractSku?: number | string;
  accelerated?: number | string;
  [extra: string]: number | string | undefined;
}

export interface ItemTreeOptions {
  sid: string;
  csid: string;
  sku: string;
  /** ItemDefinition.type; the original emits it (ItemObject.as:2379). */
  type?: string | number;
  x: number;
  y: number;
  isSuspended?: boolean;
  state: ItemStateAttrs;
  /** ItemObject.mCrew -> <Crew ids bought/> (ItemObject.as:2392). */
  crew?: { ids: string; bought: string };
  /** HQ only: the <Decorations currentSku shadowRows type><Decoration/></Decorations> child the original persists first (oracle new_item). */
  hqDecorations?: boolean;
}

/**
 * {sid,csid,sku,type,x,y,isSuspended, Item:[{id,mode,time,..., State:[]}]}: attribute values are strings (AS3 XML
 * attributes), every element carries an array named after itself holding its children (empty for leaves).
 */
export function itemTree(o: ItemTreeOptions): TreeNode {
  const stateNode: TreeNode = {};
  for (const [k, v] of Object.entries(o.state)) {
    if (v !== undefined) {
      stateNode[k] = String(v);
    }
  }
  stateNode.State = [];
  const children: TreeNode[] = [stateNode];
  if (o.hqDecorations) {
    children.unshift({ Decorations: [{ currentSku: "HeadQuarter_01", shadowRows: "0", type: "0", Decoration: [] }] } as unknown as TreeNode);
  }
  if (o.crew) {
    children.push({ ids: o.crew.ids, bought: o.crew.bought, Crew: [] });
  }
  const node: TreeNode = { sid: o.sid, csid: o.csid, sku: o.sku };
  if (o.type !== undefined) {
    node.type = String(o.type);
  }
  node.x = String(o.x);
  node.y = String(o.y);
  node.isSuspended = o.isSuspended ? "1" : "0";
  node.Item = children;
  return node;
}

// ---------------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------------

/** StateItemObject.as:28-40 */
export const STATE_ID = {
  CONSTRUCTION: 0,
  RENT: 1,
  SELLING: 2,
  IA: 3,
  HEADQUARTER: 4,
  BUILT: 5,
  DEMOLITION: 6
} as const;

/** StateOnRent.as:66-90 (modes the server stores verbatim in State@mode). */
export const RENT_MODE = {
  NONE: 0,
  WAITING_FOR_CONTRACT: 1,
  SIGNING_CONTRACT: 2,
  CANCELING_CONTRACT: 3,
  RENTING: 4,
  GET_RENT: 5,
  GIVING_RENT: 6,
  ABANDONED: 7,
  RESETING_ABANDONED: 8,
  WAITING_FOR_TURN_TO_SIGN_CONTRACT: 9,
  POSTPONING_SET_MODE: 10,
  COLLECTIBLE: 14,
  GIVING_COLLECTIBLE: 15
} as const;
/** StateOnRent.as:92: modes that are UI-only and never sent to the server. */
export const RENT_UI_MODES: readonly number[] = [0, 3, 9, 8, 10];

/** StateOnConstruction.as:20-28 */
export const CONSTRUCTION_MODE = { NONE: 0, INIT: 1, RESUME: 2, PAUSED: 3, INSTANT_BUILD: 4 } as const;
/** StateOnIA.as:36-44 */
export const IA_MODE = { NONE: 0, WAIT: 1, IN_SALE: 2, BUYING: 3, BOUGHT: 4 } as const;
/** StateOnHireCrew.as:16-20 */
export const HIRE_CREW_MODE = { NONE: 0, INIT: 1, HIRING: 2 } as const;

/** UDFO.load (UDFO.as:1635-1710): the get_* sequence sent on world load, in order. */
export const LOAD_COMMANDS = [
  "get_world", // {targetUserId}
  "get_customizer_info",
  "get_friends_list",
  "get_neighbor_list",
  "get_help_building_list",
  "get_upgrades_list",
  "get_unlocked_items_list",
  "get_limited_edition_items_list",
  "get_storage_list",
  "get_collectibles_list",
  "get_friends_collectible_sents_list",
  "get_daily_rewards_info",
  "get_partners_list", // only if Config.USE_SUPERUPGRADES
  "get_welcome_progress",
  "get_investments_list",
  "get_game_config"
] as const;

type Dat = Record<string, unknown>;

function cmd(_cmd: string, _dat: Dat): PacketCommand {
  return { _cmd, _dat };
}

// ---------------------------------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------------------------------

export class GameCommands {
  readonly security: SecurityTracker;

  constructor(
    private readonly ctx: CommandContext,
    security?: SecurityTracker,
    /** Map.mSid (Map.as:1746, <Map sid=...>); the server ignores it. */
    private readonly mapSid = "1"
  ) {
    this.security = security ?? new SecurityTracker(ctx.profile);
  }

  /** `explicit != null` -> securityUpdate() is still called (advances baseline, return discarded) then explicit is used. */
  private resolveSecurity(explicit?: Security | null): Security {
    const fresh = this.security.update();
    return explicit ?? fresh;
  }

  private sec(g: Gained): Security {
    return this.security.create(g.exp, g.coins, g.cash);
  }

  // ---- update_item -------------------------------------------------------------------------------------------------

  /**
   * UserDataFacadeOnline.updateItem (UDFO.as:107-161). Final payload key order:
   * ...params, action, sid, sku, security, [doubleRent already in params], millis.
   * `sku` is `param4.@sku` of the persistence XML: callers that pass no XML (move/destroy/buy_crew) send sku "".
   * Server: CommandService.applyItemMutation (commandHandlers.ts:767-908).
   */
  updateItem(sid: string, action: string, params: Dat, opts: { sku?: string; security?: Security | null } = {}): PacketCommand {
    const dat: Dat = { ...params };
    dat.action = action;
    dat.sid = sid;
    dat.sku = opts.sku ?? "";
    dat.security = this.resolveSecurity(opts.security);
    dat.millis = this.ctx.millisSinceLogin();
    return cmd("update_item", dat);
  }

  /**
   * "new_item": ItemObject.changeState when the item has no previous state (ItemObject.as:1143-1164).
   * params {item: XMLToObject(persistence), dec: formatId, [offer], [extraCmd key]}; security null -> securityUpdate().
   * Server: creates/replaces the Item in the company chosen by item.csid; sku/x/y from payload or item; construction
   * state (id 0) is normalised via normalizeConstructionState; money snapshot applied only if the item signature changed.
   * RESOLVED: `storage:"true"` (extra key) now consumes one vault item (SecurityNormal.java:206-221); dec/offer/freeGift carry no persistent state in the original either (costs arrive via the security snapshot).
   */
  newItem(o: ItemTreeOptions & { dec: string | number; offer?: string; extra?: { key: string; value: unknown } }): PacketCommand {
    const params: Dat = { item: itemTree(o), dec: o.dec };
    if (o.offer !== undefined) {
      params.offer = o.offer;
    }
    if (o.extra) {
      params[o.extra.key] = o.extra.value;
    }
    return this.updateItem(o.sid, "new_item", params, { sku: o.sku });
  }

  /**
   * "new_state": ItemObject.changeState to a different state of an existing item (ItemObject.as:1172-1184).
   * params {state: stateId, mode, time}; skipped by the original when entering DEMOLITION (state 6).
   * Server: hasStateMutation -> State@id/mode/time (+savedAt when time>0). Finishing construction = new_state to RENT.
   */
  newState(sid: string, sku: string, p: { state: number; mode: number; time: number }, security?: Security | null): PacketCommand {
    return this.updateItem(sid, "new_state", { state: p.state, mode: p.mode, time: p.time }, { sku, security });
  }

  /** Construction finished -> state RENT, mode WAITING_FOR_CONTRACT, time 0 (ItemObject.as:1180, test fixtures). */
  finishConstruction(sid: string, sku: string): PacketCommand {
    return this.newState(sid, sku, { state: STATE_ID.RENT, mode: RENT_MODE.WAITING_FOR_CONTRACT, time: 0 });
  }

  /**
   * "new_mode" generic (state-specific wrappers below). Server: State@mode/time/contractSku/accelerated updated; the
   * Item's isSuspended and csid (e.g. IA purchase -> move to own company) honoured.
   */
  newMode(sid: string, sku: string, params: Dat, gained: Gained): PacketCommand {
    return this.updateItem(sid, "new_mode", params, { sku, security: this.sec(gained) });
  }

  /** StateOnConstruction.setMode (StateOnConstruction.as:166-178): {mode,time,isSuspended,[freeGift:true]}. */
  constructionMode(
    sid: string,
    sku: string,
    p: { mode: number; time: number; isSuspended: boolean; freeGift?: boolean },
    gained: Gained
  ): PacketCommand {
    const params: Dat = { mode: p.mode, time: p.time, isSuspended: p.isSuspended ? 1 : 0 };
    if (p.freeGift) {
      params.freeGift = true;
    }
    return this.newMode(sid, sku, params, gained);
  }

  /**
   * StateOnRent mode change (StateOnRent.as:768-826): {mode, time, [contractSku], [upgradeType], [doubleRent:1]}.
   * UI modes (RENT_UI_MODES) are never sent; callers get `null` for them.
   * Server: stores mode/time/contractSku; house rent timing via normalizeHouseRentState (savedAt = Date.now()).
   * RESOLVED: contractGroupSku/doubleRent are stored on State (dropped again when the house returns to mode 1); upgradeType marks the visitor upgrades of that sid as applied (GamePlay.java:2487). Mode 6 (GIVING_RENT) now persists as sent.
   */
  rentMode(
    sid: string,
    sku: string,
    p: { mode: number; time: number; contractSku?: number; upgradeType?: string; doubleRent?: boolean; contractGroupSku?: string },
    gained: Gained
  ): PacketCommand | null {
    if (RENT_UI_MODES.includes(p.mode)) {
      return null;
    }
    const params: Dat = { mode: p.mode, time: p.time };
    if (p.contractSku !== undefined) {
      params.contractSku = p.contractSku;
    }
    if (p.upgradeType !== undefined) {
      params.upgradeType = p.upgradeType;
    }
    if (p.doubleRent) {
      params.doubleRent = 1;
    }
    if (p.contractGroupSku !== undefined) {
      params.contractGroupSku = p.contractGroupSku;
    }
    return this.newMode(sid, sku, params, gained);
  }

  /**
   * Sign a contract after the tutorial: WAITING_FOR_CONTRACT -> SIGNING_CONTRACT is reported as mode RENTING with
   * time = contract income time and contractGroupSku (StateOnRent.as:795-801). During the tutorial the raw SIGNING mode is sent.
   */
  signContract(
    sid: string,
    sku: string,
    p: { contractSku: number; incomeTimeMs: number; contractGroupSku: string; tutorialEnd: boolean },
    gained: Gained
  ): PacketCommand {
    const params: Dat = p.tutorialEnd
      ? { mode: RENT_MODE.RENTING, time: p.incomeTimeMs, contractSku: p.contractSku, contractGroupSku: p.contractGroupSku }
      : { mode: RENT_MODE.SIGNING_CONTRACT, time: p.incomeTimeMs, contractSku: p.contractSku };
    return this.newMode(sid, sku, params, gained);
  }

  /**
   * Cancel a contract: CANCELING_CONTRACT (3) is a UI mode (never sent); when the cancel timer finishes the item returns
   * to WAITING_FOR_CONTRACT (StateOnRent.as:453-470, 905). The refund (cancel profit) is accumulated into `gained.coins`.
   */
  cancelContract(sid: string, sku: string, gained: Gained): PacketCommand {
    return this.newMode(sid, sku, { mode: RENT_MODE.WAITING_FOR_CONTRACT, time: 0 }, gained);
  }

  /**
   * Collect rent: player clicks a GET_RENT item -> GIVING_RENT (StateOnRent.as:806-809). For houses the mode becomes
   * COLLECTIBLE (14) when checkIfCollectible() says so. `gained` = rent coins/exp. Commerces additionally report the
   * following WAITING_FOR_CONTRACT (1) transition via rentMode(); houses do not (StateOnRent.as:810-816).
   */
  collectRent(sid: string, sku: string, p: { time: number; contractSku?: number; collectible?: boolean; doubleRent?: boolean }, gained: Gained): PacketCommand {
    const mode = p.collectible ? RENT_MODE.COLLECTIBLE : RENT_MODE.GIVING_RENT;
    const params: Dat = { mode, time: p.time };
    if (p.contractSku !== undefined) {
      params.contractSku = p.contractSku;
    }
    if (p.doubleRent) {
      params.doubleRent = 1;
    }
    return this.newMode(sid, sku, params, gained);
  }

  /** StateOnIA.setMode (StateOnIA.as:150-159): {mode,time,[csid when BOUGHT]}. */
  iaMode(sid: string, sku: string, p: { mode: number; time: number; csid?: string }, gained: Gained): PacketCommand {
    const params: Dat = { mode: p.mode, time: p.time };
    if (p.mode === IA_MODE.BOUGHT && p.csid !== undefined) {
      params.csid = p.csid;
    }
    return this.newMode(sid, sku, params, gained);
  }

  /** StateOnHireCrew.setMode (StateOnHireCrew.as:43-51). */
  hireCrewMode(sid: string, sku: string, p: { mode: number; isSuspended: boolean; freeGift?: boolean }, gained: Gained): PacketCommand {
    const params: Dat = { mode: p.mode, isSuspended: p.isSuspended ? 1 : 0 };
    if (p.freeGift) {
      params.freeGift = true;
    }
    return this.newMode(sid, sku, params, gained);
  }

  /**
   * "move": ItemObject.move (ItemObject.as:2944-2953) {x, y, dec, [freeMove:"true"]}; sku "" (no XML passed).
   * Server: x/y rewritten on the existing Item.
   */
  move(sid: string, x: number, y: number, dec: string | number, freeMove = false): PacketCommand {
    const params: Dat = { x, y, dec };
    if (freeMove) {
      params.freeMove = "true";
    }
    return this.updateItem(sid, "move", params);
  }

  /**
   * "destroy" (sell/demolish): ItemObject.destroy(true) (ItemObject.as:3122) {dec}; sku "".
   * Server: action containing destroy/sell/remove deletes the Item and applies the money snapshot.
   * Demolition refund/cost shows up as coinsGain in the securityUpdate() snapshot.
   */
  destroy(sid: string, dec: string | number): PacketCommand {
    return this.updateItem(sid, "destroy", { dec });
  }

  /** "upd_suspended": StateOnRent.suspend/resume (StateOnRent.as:920, 985) {isSuspended: 0|1, time}; XML passed -> sku. */
  setSuspended(sid: string, sku: string, suspended: boolean, time: number): PacketCommand {
    return this.updateItem(sid, "upd_suspended", { isSuspended: suspended ? 1 : 0, time }, { sku });
  }

  /**
   * "buy_crew": PopupHireCrew.as:190 / CrewItemContent.as:118 {sku: count, position: "i,j,.."}.
   * The facade overwrites `sku` with the XML sku ("" here), so the count never reaches the wire (same as original).
   * NOTE: the original Java server has no buy_crew handler either (not in Server.java dispatch); behaviour unchanged.
   */
  buyCrew(sid: string, positions: string): PacketCommand {
    return this.updateItem(sid, "buy_crew", { position: positions });
  }

  // ---- update_map --------------------------------------------------------------------------------------------------

  /**
   * UserDataFacadeOnline.updateMap (UDFO.as:813-831): {type, x, y, sid(map), action, security}.
   * Server: applyMapMutation (commandHandlers.ts:910-946) - type Terrain|Road (case-insensitive), action containing
   * del/remove deletes the tile else adds it; money snapshot applied only if the tile set changed.
   */
  private mapCmd(action: "add" | "del", type: "Terrain" | "Road", x: number, y: number, security: Security | null): PacketCommand {
    // Map.as:774-777 / 2899-2903 send del coordinates as strings (substring of "x:y"); add uses ints (Map.as:1813-1816).
    const dat: Dat = { type, x: action === "del" ? String(x) : x, y: action === "del" ? String(y) : y };
    dat.sid = this.mapSid;
    dat.action = action;
    dat.security = this.resolveSecurity(security);
    return cmd("update_map", dat);
  }

  /** Buy a terrain tile: security = create(0, -terrainPrice, 0) unless free (Map.as:1919-1936, 1817). */
  addTerrain(x: number, y: number, terrainPrice: number, free = false): PacketCommand {
    return this.mapCmd("add", "Terrain", x, y, this.security.create(0, free ? 0 : -terrainPrice, 0));
  }

  /** Remove terrain: security = create(0, destroyProfit, 0) (Map.as:1932-1936, 2899-2903). */
  delTerrain(x: number, y: number, destroyProfit: number): PacketCommand {
    return this.mapCmd("del", "Terrain", x, y, this.security.create(0, destroyProfit, 0));
  }

  /** Build road: securityCreateObj returns null for Road -> securityUpdate() (Map.as:2301-2311). Road cost = coinsGain. */
  addRoad(x: number, y: number): PacketCommand {
    return this.mapCmd("add", "Road", x, y, null);
  }

  /** Destroy road (Map.as:774-778): securityCreateObj("del","Road") is null -> securityUpdate(). */
  delRoad(x: number, y: number): PacketCommand {
    return this.mapCmd("del", "Road", x, y, null);
  }

  // ---- update_plots (expansion) ------------------------------------------------------------------------------------

  /**
   * Map.buyPlot (Map.as:1383-1387): {index, boughtWithFB, action:"bought", security: securityUpdate()}.
   * Server: applyPlotsMutation - plot[index]=2 and unlockNextPlots; money snapshot applied only if plots string changed.
   */
  buyPlot(index: number, boughtWithFB = false): PacketCommand {
    const dat: Dat = { index, boughtWithFB, action: "bought", security: this.security.update() };
    return cmd("update_plots", dat);
  }

  // ---- update_money ------------------------------------------------------------------------------------------------

  /**
   * UDFO.updateMoney (UDFO.as:1712-1721): {...params, action, security: securityUpdate()}. Server: applyMoneyMutation
   * writes the security snapshot ABSOLUTE values (coinsNow etc.) over the profile; only first_visit/firstPartner/buyGold
   * have extra handling. RESOLVED: unlockItem -> unlockedList, service -> profile <sku>TimeOver (+<sku>TimeLeft in get_world), openBox/rentAccelerator -> storageList (+State@accelerated), exchange/reward fall back to server-computed deltas when no snapshot is sent; buy_bundle is snapshot-only (no original counterpart).
   */
  money(action: string, params: Dat = {}): PacketCommand {
    return cmd("update_money", { ...params, action, security: this.security.update() });
  }
  exchange(value: number): PacketCommand { return this.money("exchange", { value }); } // Profile.as:456
  unlockItem(sku: string): PacketCommand { return this.money("unlockItem", { value: sku }); } // UnlockedListManager.as:70
  service(sku: string, id: string | number, offer: "0" | "1"): PacketCommand { return this.money("service", { value: sku, id, offer }); } // Profile.as:1891
  reward(newsFeedSku: string): PacketCommand { return this.money("reward", { value: newsFeedSku }); } // NewsFeedRewardPresentation.as:102
  buyGold(sku: string): PacketCommand { return this.money("buyGold", { sku }); } // PopupGold.as:405
  buyBundle(sku: string): PacketCommand { return this.money("buy_bundle", { sku }); } // PopupConfirmBundle.as:100
  dailyBonusDone(): PacketCommand { return this.money("dailyBonusDone", {}); } // DollarsGame.as:918
  openBox(prize: string, type: string, value: string): PacketCommand { return this.money("openBox", { prize, type, value }); } // FreeGiftDefinitionManager.as:83 (StoredItem.ACTION_OPENBOX)
  rentAccelerator(sku: string, itemSid: string): PacketCommand { return this.money("rentAccelerator", { sku, itemSid }); } // ToolRentAccelerator.as:54 (StoredItem.ACTION_RENT_ACCELERATOR)
  firstVisitMoney(): PacketCommand { return this.money("first_visit", { value: 1 }); } // Profile.as:791
  firstPartnerMoney(): PacketCommand { return this.money("firstPartner", { value: 1 }); } // Profile.as:1921

  // ---- update_profile ----------------------------------------------------------------------------------------------

  /** UDFO.updateProfile (UDFO.as:365-386): {...params, action}. No security. Server: applyProfileMutation. */
  profile(action: string, params: Dat = {}): PacketCommand {
    return cmd("update_profile", { ...params, action });
  }
  /** action city_name is rewritten to city_name_codes with value = "c1,c2,...," (trailing comma) (UDFO.as:370-374, Profile.as:1723). */
  cityName(name: string): PacketCommand {
    let codes = "";
    for (let i = 0; i < name.length; i += 1) {
      codes += `${name.charCodeAt(i)},`;
    }
    return this.profile("city_name_codes", { value: codes });
  }
  bossGenre(value: 0 | 1): PacketCommand { return this.profile("boss_genre", { value }); } // Profile.as:399
  newToolRev(value: number): PacketCommand { return this.profile("newToolRev", { value }); } // Profile.as:472
  firstMission(value: 0 | 1): PacketCommand { return this.profile("firstMission", { value }); } // Profile.as:514,1528
  tutorialCompleted(): PacketCommand { return this.profile("tutorial_completed", {}); } // Profile.as:713
  /** RESOLVED: stored as profile newItemsRev. */
  newItemsRevDone(): PacketCommand { return this.profile("newItemsRevDone", {}); } // Profile.as:810
  checkmail(value: number): PacketCommand { return this.profile("checkmail", { value }); } // Profile.as:1746
  ranking(value: number): PacketCommand { return this.profile("ranking", { value }); } // Profile.as:1933
  planeSku(value: string): PacketCommand { return this.profile("planeSku", { value }); } // Profile.as:2033
  /** RESOLVED: flag -> Profile@flags ("name:value," list, GamePlay.java:2054), service -> <sku>PresentationShown. */
  flag(name: string, value: number): PacketCommand { return this.profile("flag", { name, value }); } // Profile.as:2092
  profileService(value: string): PacketCommand { return this.profile("service", { value }); } // Profile.as:2213
  millionNewsFeed(): PacketCommand { return this.profile("million_news_feed", {}); } // Profile.as:2114
  firstInvest(): PacketCommand { return this.profile("first_invest", { value: 1 }); } // Profile.as:2149
  fourMillions(): PacketCommand { return this.profile("fourMillions", { value: 1 }); } // Profile.as:2168

  /** UDFO.updateNextRent (UDFO.as:772-780): {next_rent: seconds, action:"update_next_rent"}. RESOLVED: stored (meta next_rent_<user>), bounds -1..259200 as in GamePlay.java:2720. */
  nextRent(seconds: number): PacketCommand {
    return cmd("update_next_rent", { next_rent: Math.trunc(seconds), action: "update_next_rent" });
  }

  // ---- update_daily_reward -----------------------------------------------------------------------------------------

  /**
   * UDFO.updateRewards (UDFO.as:239-252) from DailyBonusManager.keepDailyBonus (DailyBonusManager.as:91-93):
   * {sku, security: create(exp,coins,cash) + item}. RESOLVED: server ports GamePlay.updateDailyReward: count+1, lastGiven history, lastGivenDate = local 00:10, item reward -> storage, snapshot applied; get_daily_rewards_info rolls the next reward/streak.
   */
  dailyReward(sku: string, gained: Gained, item: string | null = null): PacketCommand {
    // DailyBonusManager.as:91 builds the object from the stale baseline FIRST; the facade's securityUpdate() (UDFO.as:239-252) only advances it after.
    const security = this.sec(gained);
    security.item = item;
    this.security.update();
    return cmd("update_daily_reward", { sku, security });
  }

  // ---- update_missions ---------------------------------------------------------------------------------------------

  /**
   * UDFO.updateMissions (UDFO.as:1224-1249) from MissionObjectManager (MissionObjectManager.as:277-287):
   * {sku: int, action:"update", security}. Security is create(-delayedExp,-delayedCoins,-delayedCash) ONLY when the new state
   * is GIVEN (reward claimed; pass `claim`), else securityUpdate().
   * Server: applyMissionsMutation infers the transition: first call -> Reached; later call with reached or a negative
   * gain -> Given (+ positive deltas applied). NOT CHANGED: the original Java chunk logic (up -> reached -> given, GamePlay.java:1346) differs from the TS server's first-call=reached inference.
   */
  mission(sku: number, claim?: Gained): PacketCommand {
    const security = claim ? this.sec({ exp: -claim.exp, coins: -claim.coins, cash: -claim.cash }) : null;
    return cmd("update_missions", { sku, action: "update", security: this.resolveSecurity(security) });
  }

  // ---- update_pollmanager ------------------------------------------------------------------------------------------

  /**
   * PollEvent.register (PollEvent.as:102-120): conditional event -> action "update" with value (progress string), else
   * action "add". Payload {type, parameter, [value], action}. Server: counts[type+parameter] += 1 for add, = value for update.
   */
  poll(action: "add", type: string, parameter: string): PacketCommand;
  poll(action: "update", type: string, parameter: string, value: string): PacketCommand;
  poll(action: "add" | "update", type: string, parameter: string, value?: string): PacketCommand {
    const dat: Dat = { type, parameter };
    if (action === "update") {
      dat.value = value;
    }
    dat.action = action;
    return cmd("update_pollmanager", dat);
  }

  // ---- upgrades ----------------------------------------------------------------------------------------------------

  /**
   * add_upgrade_item (UDFO.as:496-501, StateOnRentVisitor.as:39-44): {ownerId, visitorId, sid, type, security}.
   * Server: handleUpgradeCommand records one visitor upgrade per (owner,sid,visitor,day), max VISITOR_UPGRADES_PER_DAY.
   * RESOLVED: positive visitor deltas of the snapshot are applied.
   */
  addUpgradeItem(p: { ownerId: string; visitorId: string; sid: string; type: string | number }): PacketCommand {
    return cmd("add_upgrade_item", { ...p, security: this.security.update() });
  }

  // ---- collectibles ------------------------------------------------------------------------------------------------

  /**
   * UDFO.updateCollectible (UDFO.as:81-105): {sku, sid, action, receiver, security, ...extra}. action ASK uses cmd
   * ask_collectible, everything else update_collectible. Server: handleCollectibleCommand.
   * Callers: KEEP (CollectibleManager.as:151, sid=item sid or "f<senderExtId>"), SELL (PopupCollectibleConfirmSell.as:108),
   * BUY (PopupCollectibleBuyAsk.as:144, sid "-1", security create(0,0,-cashCost)), SEND (PopupSendCollectible.as:549,
   * PopupCollectibleBuyAsk.as:206, receiver=friend extId, sid "v"), GET_REWARD (PopupCollectibleManager.as:115),
   * ASK (PopupCollectibleBuyAsk.as:191, sid null, security securityUpdate()).
   * RESOLVED: ASK keeps a most-recent-first list of 5 (collectiblesList@asked); SELL only drops the pending entry; KEEP/BUY cap at 99 units; tradein groups consume one unit per member on GET_REWARD.
   */
  collectible(
    action: "KEEP" | "BUY" | "SELL" | "SEND" | "GET_REWARD" | "ASK",
    p: { sid: string | null; sku: string; receiver?: string | null; gained?: Gained }
  ): PacketCommand {
    const security = p.gained ? this.sec(p.gained) : null;
    const dat: Dat = {
      sku: p.sku,
      sid: p.sid,
      action,
      receiver: p.receiver ?? null,
      security: this.resolveSecurity(security)
    };
    return cmd(action === "ASK" ? "ask_collectible" : "update_collectible", dat);
  }

  // ---- queries / misc ----------------------------------------------------------------------------------------------

  /** get_* style read command. */
  query(name: string, dat: Dat = {}): PacketCommand {
    return cmd(name, dat);
  }
  getWorld(targetUserId: number | string): PacketCommand { return cmd("get_world", { targetUserId }); } // UDFO.as:410-412, 1641-1643
  getUpgradesList(userId?: number | string): PacketCommand { return cmd("get_upgrades_list", userId === undefined ? {} : { userId }); } // UDFO.as:465
  /** UDFO.as:703-709: {chk:1} only if a response checksum mismatched. */
  loadSuccess(chkFailed = false): PacketCommand { return cmd("load_success", chkFailed ? { chk: 1, sig: RULES_SIG } : { sig: RULES_SIG }); }
  ping(): PacketCommand { return cmd("ping", {}); } // Server.as:386, 465
  postReward(sku: string): PacketCommand { return cmd("postReward", { sku }); } // UDFO.as:608
  askForHelp(sid: string): PacketCommand { return cmd("ask_for_help", { sid }); } // UDFO.as:472
  askForCash(): PacketCommand { return cmd("ask_for_cash", { sid: 0 }); } // UDFO.as:476
  /** The 16 get_* commands of the load sequence (UDFO.as:1635-1710). */
  loadSequence(targetUserId: number | string, opts: { partners?: boolean } = {}): PacketCommand[] {
    return LOAD_COMMANDS.filter((c) => c !== "get_partners_list" || opts.partners).map((c) =>
      c === "get_world" ? this.getWorld(targetUserId) : cmd(c, {})
    );
  }
}
