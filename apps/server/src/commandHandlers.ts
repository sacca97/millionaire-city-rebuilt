import path from "path";
import { loadDefinitionAttributes } from "./rules.js";
import { RULES_ROOT } from "./saveDefaults/paths.js";
import {
  DEFAULT_USER_ID,
  DEFAULT_SYNC,
  MUTATION_COMMANDS,
  NOOP_COMMANDS,
  SAVE_TAGS,
  STARTUP_COMMANDS
} from "@mcity/shared";
import type { PacketCommand } from "@mcity/shared";
import type { JsonObject } from "@mcity/shared/dist/types.js";
import type { SaveRepository } from "./repository.js";
import {
  createNeighborUniverse,
  createVisitorNeighborUniverse,
  normalizeConstructionState,
  getContractIncomeTimeMs,
  normalizeHouseRentState,
  normalizeCompletedTutorialUniverse
} from "./saveDefaults.js";
import {
  createElement,
  findElementChild,
  getElementChildren,
  getOrCreateElementChild,
  parseChunkSet,
  serializeChunkSet,
  upsertChunkElement,
  upsertElementChild
} from "./saveTree.js";
import {
  collapsePendingCollectibleState,
  MAX_COLLECTIBLE_UNITS,
  getTradeInCollectibleSkus,
  isCollectibleAwardMutation,
  pushAskedCollectible,
  isCollectibleFeatureUnlocked,
  normalizeCollectiblePendingDocument,
  normalizeCollectiblesDocument,
  pickCollectibleSkuForHouse,
  projectPendingCollectiblesOnUniverse,
  readCollectiblesState,
  removePendingFriendCollectible,
  resolveHeadQuarterRewardSkuForCollectibleClaim,
  resolveItemRewardCollectibleGroupFromMutation,
  resolvePlaneRewardSkuForCollectibleClaim,
  shouldAwardCollectibleDrop,
  writeCollectiblesState
} from "./commandHandlers/collectibles.js";
import { decodeAsciiCodes, encodeAsciiCodes, sanitizeForClientXml, sanitizeStoredString, sanitizeUniverseForClient } from "./commandHandlers/encoding.js";
import {
  CASH_TO_COINS,
  applyMoneySecuritySnapshot,
  applyMoneySecuritySnapshotWithPositiveDeltaFallback,
  applyPositiveMoneySecurityDeltas,
  hasMoneySecuritySnapshot,
  hasNegativeSecurityDelta,
  reconcilePremiumCurrencyPurchase
} from "./commandHandlers/money.js";
import { getPlotStates, unlockNextPlots } from "./commandHandlers/plots.js";
import {
  extractIncomingElement,
  extractIncomingItemEntry,
  extractStateAttributes,
  hasStateMutation,
  parseCountChunkSet,
  toRecord,
  upsertCountChunkElement
} from "./commandHandlers/state.js";
import {
  DEFAULT_CITY_NAME,
  createItemEntry,
  ensureHeadQuarterDecorations,
  ensureStateElement,
  findItemEntry,
  getCompanyEntryBySid,
  getCompanyEntryByWhose,
  getMapEntry,
  getPlotsEntry,
  getUniverseProfile,
  isHouseSku,
  isUpgradeEligibleItem,
  resolveTargetOwnerId,
  resolveUpgradeOwnerId,
  setPlayerHeadQuarterSkin,
  type MutableNode
} from "./commandHandlers/universe.js";
import { getLocalDayKey, getStoredUpgradeRecords, setStoredUpgradeRecords, VISITOR_UPGRADES_PER_DAY } from "./commandHandlers/upgrades.js";
import {
  INVEST,
  OFFLINE_FRIEND_COMPANY_VALUE,
  NEW_ITEMS_REV,
  addToProfile,
  addUnlockedItem,
  adjustStorage,
  applyDailyRewardGiven,
  applyProfileFlag,
  applyServicePresentationShown,
  applyServicePurchase,
  findInvestment,
  getAcceleratorStorage,
  getBoxPrize,
  getDailyRewardDefinition,
  getServiceDefinition,
  getStorageAmount,
  levelFromExp,
  newsFeedReward,
  projectServiceTimes,
  refreshDailyRewardsInfo,
  getMissionReward,
  stepMission,
  DAILY_BONUS_TIME_MS,
  DAILY_BONUS_COINS,
  refreshInvestments
} from "./commandHandlers/offline.js";

export class CommandService {
  /** UserData.mDoubleRentAvailable[0] (houses only; in-memory like the Java session, never persisted). */
  private readonly doubleRentHousesAvailable = new Map<number, boolean>();

  constructor(private readonly repository: SaveRepository) {}

  /**
   * SecurityNormal.java:466-481 + Server.java:265-278 + GamePlay.initializeUserSpecialAttributes (:2848-2890): when a house rent is
   * collected (State 5 -> 1/14) the client's `doubleRent` param consumes the prize; if none is pending a 0-99 roll is compared
   * with the summed incomeValue of the built (state 5) incomeMultiplier wonders targeting Houses and, on a hit, the server pushes
   * {_cmd:"doubleRent",_dat:"Houses"} exactly once. Commerces never roll in the original.
   */
  private rollDoubleRent(
    userId: number,
    universe: JsonObject,
    itemEntry: MutableNode,
    payload: Record<string, unknown>,
    previousStateId: string,
    previousMode: string
  ): PacketCommand | undefined {
    const newMode = String(payload.mode ?? "");
    if (
      !isHouseSku(String(itemEntry.sku ?? "")) ||
      previousStateId === "0" ||
      previousMode !== "5" ||
      (newMode !== "1" && newMode !== "14")
    ) {
      return undefined;
    }
    if (payload.doubleRent != null) {
      this.doubleRentHousesAvailable.set(userId, false);
    }
    if (this.doubleRentHousesAvailable.get(userId)) {
      return undefined;
    }
    const probability = getDoubleRentHousesProbability(universe);
    const hit = Math.floor(Math.random() * 100) < probability;
    this.doubleRentHousesAvailable.set(userId, hit);
    return hit ? { _cmd: "doubleRent", _dat: "Houses" as never, _sync: DEFAULT_SYNC } : undefined;
  }

  handleCommand(userId: number, command: PacketCommand): PacketCommand[] {
    if (command._cmd === "ping" || command._cmd === "empty") {
      return [
        {
          _cmd: command._cmd,
          _dat: {},
          _sync: this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC
        }
      ];
    }

    if ((STARTUP_COMMANDS as readonly string[]).includes(command._cmd)) {
      return [this.handleStartupCommand(userId, command._cmd, command._dat as Record<string, unknown> | undefined)];
    }

    if ((MUTATION_COMMANDS as readonly string[]).includes(command._cmd)) {
      return this.handleMutationCommand(userId, command);
    }

    if (command._cmd === "add_upgrade_item") {
      return [this.handleUpgradeCommand(userId, command)];
    }

    if (command._cmd === "ask_collectible" || command._cmd === "update_collectible") {
      return [this.handleCollectibleCommand(userId, command)];
    }

    if ((NOOP_COMMANDS as readonly string[]).includes(command._cmd)) {
      return [this.handleNoopCommand(userId, command)];
    }

    return [
      {
        _cmd: command._cmd,
        _dat: {
          success: "true",
          ignored: "1"
        },
        _sync: this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC
      }
    ];
  }

  private handleStartupCommand(userId: number, commandName: string, payload: Record<string, unknown> = {}): PacketCommand {
    const rawData = this.getStartupDocument(userId, commandName, payload);
    const data = commandName === "get_world" ? sanitizeUniverseForClient(rawData) : sanitizeForClientXml(rawData);
    return {
      _cmd: commandName,
      _dat: data,
      _sync: this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC
    };
  }

  private getStartupDocument(userId: number, commandName: string, payload: Record<string, unknown> = {}): JsonObject {
    switch (commandName) {
      case "get_world": {
        const playerUniverse = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
        const collectiblesDocument = this.getNormalizedCollectiblesDocument(userId);
        const targetUserId = Number(payload.targetUserId ?? DEFAULT_USER_ID);
        if (Number.isFinite(targetUserId) && targetUserId !== DEFAULT_USER_ID) {
          // GamePlay.getWorld (GamePlay.java:120-141): another targetUserId is a read-only visit (mUniverseOwner=false).
          const playerProfile = getUniverseProfile(playerUniverse);
          const bossGenre = Number(playerProfile?.bossGenre ?? 0);
          const neighborUniverse = createNeighborUniverse(targetUserId, bossGenre);
          if (neighborUniverse) {
            return neighborUniverse;
          }

          const savedNeighborUniverse = this.repository.getOptionalDocument<JsonObject>(targetUserId, SAVE_TAGS.universe);
          if (savedNeighborUniverse) {
            return savedNeighborUniverse;
          }
          // Unknown id: never hand back the local player's own world (the client would treat it as a visit).
          return createVisitorNeighborUniverse(targetUserId);
        }
        this.persistExpiredServices(userId, playerUniverse);
        const projected = isCollectibleFeatureUnlocked(getUniverseProfile(playerUniverse))
          ? projectPendingCollectiblesOnUniverse(playerUniverse, collectiblesDocument)
          : playerUniverse;
        // "Proccess Time-Services" (GamePlay.java:190-212): expose <sku>TimeLeft to the client without persisting it.
        const output = JSON.parse(JSON.stringify(projected)) as JsonObject;
        const outputProfile = getUniverseProfile(output);
        if (outputProfile) {
          projectServiceTimes(outputProfile, Date.now());
        }
        return output;
      }
      case "get_customizer_info":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.customizer);
      case "get_friends_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.friends);
      case "get_neighbor_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.neighbors);
      case "get_neighbor_info":
        return {
          neighborList: []
        };
      case "get_help_building_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.help);
      case "get_upgrades_list":
        return this.buildUpgradesListDocument(userId, payload);
      case "get_unlocked_items_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.unlocked);
      case "get_limited_edition_items_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.limitedEdition);
      case "get_storage_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.storage);
      case "get_collectibles_list":
        return this.getNormalizedCollectiblesDocument(userId);
      case "get_friends_collectible_sents_list":
        return this.getNormalizedCollectiblePendingDocument(userId);
      case "get_daily_rewards_info": {
        // GamePlay.getDailyRewardsInfo (GamePlay.java:899-957)
        const dailyDocument = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.dailyBonus);
        const refresh = refreshDailyRewardsInfo(dailyDocument, Date.now());
        if (refresh.changed) {
          this.repository.setDocument(userId, SAVE_TAGS.dailyBonus, dailyDocument);
        }
        const dailyAnswer = refresh.reset ? { ...dailyDocument, dailyRewardsCount: "1" } : dailyDocument;
        // GamePlay.java:953: after a streak reset (stored 0) the answer carries count 1.
        return dailyAnswer;
      }
      case "get_partners_list":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.partners);
      case "get_welcome_progress": {
        // GamePlay.getWelcomeProgress (GamePlay.java:972-986): both NPC timers = max(0, daily_bonus_at - now).
        const left = String(Math.max(0, (Number(this.repository.getMeta(`daily_bonus_at_${userId}`)) || 0) - Date.now()));
        return { ...this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.welcome), npcRonaldTimeLeft: left, npcCindyTimeLeft: left };
      }
      case "get_investments_list":
        return this.getInvestmentsDocument(userId);
      case "get_game_config":
        return this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.gameConfig);
      case "load_success":
        return {
          success: "true"
        };
      default:
        return {};
    }
  }

  private handleMutationCommand(userId: number, command: PacketCommand): PacketCommand[] {
    const payload = command._dat as JsonObject;
    let sideEffects: PacketCommand[] = [];
    switch (command._cmd) {
      case "update_profile":
        this.applyProfileMutation(userId, payload);
        break;
      case "update_money":
        this.applyMoneyMutation(userId, payload);
        break;
      case "update_item":
        sideEffects = this.applyItemMutation(userId, payload);
        break;
      case "update_map":
        this.applyMapMutation(userId, payload);
        break;
      case "update_plots":
        this.applyPlotsMutation(userId, payload);
        break;
      case "update_missions":
        this.applyMissionsMutation(userId, payload);
        break;
      case "update_pollmanager":
        this.applyPollManagerMutation(userId, payload);
        break;
      case "update_daily_reward":
        this.applyDailyRewardMutation(userId, payload);
        break;
      case "update_next_rent":
        this.applyNextRentMutation(userId, payload);
        break;
      default:
        break;
    }

    this.repository.incrementSessionSync(userId);
    const sync = this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC;
    return [
      {
        _cmd: command._cmd,
        _dat: payload,
        _sync: sync
      },
      ...sideEffects.map((entry) => ({
        ...entry,
        _sync: sync
      }))
    ];
  }

  private handleNoopCommand(userId: number, command: PacketCommand): PacketCommand {
    const payload = (command._dat ?? {}) as Record<string, unknown>;
    let response: JsonObject = { success: "true" };

    if (command._cmd === "ask_for_help" || command._cmd === "ask_for_cash") {
      // GamePlay.helpAccelerate (GamePlay.java:1105-1133) answers {help_id}. Offline there is nobody to post to, so the
      // client gets help_id "null" (UserDataFacadeOnline.as ask_for_help/ask_for_cash -> info popup, no feed post).
      response = { help_id: "null", time_passed: "0", time_total: "0" };
    } else if (command._cmd.startsWith("invest_")) {
      response = this.handleInvestCommand(userId, command._cmd, payload);
    } else if (command._cmd === "postReward") {
      // GamePlay.rewardPost (GamePlay.java:2662-2718) returns the post counter; there is no feed offline.
      response = { postCount: 0 };
    }

    this.repository.incrementSessionSync(userId);
    return {
      _cmd: command._cmd,
      _dat: response,
      _sync: this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC
    };
  }

  /** invest_* (GamePlay.java:1135-1284) against the investments list document, with auto-accepting offline friends. */
  private handleInvestCommand(userId: number, cmd: string, payload: Record<string, unknown>): JsonObject {
    const doc = this.getInvestmentsDocument(userId);
    const children = getElementChildren(doc, "investmentsList");
    const extId = String(payload.fExtId ?? "");
    const now = Date.now();
    const profile = getUniverseProfile(this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe));
    switch (cmd) {
      case "invest_on_friend": {
        const coins = Number(profile?.DCCoins ?? "0");
        if (extId.length === 0 || findInvestment(doc, extId) || coins < INVEST.inversion) {
          return { id: "null" };
        }
        const id = String(now);
        // Original creates state 1 (waiting for the friend to accept); the offline friend accepts at once (inferred).
        children.push(
          createElement(
            "investment",
            {
              extId,
              userId: "-1",
              value: "0",
              time: String(INVEST.timeMs),
              remindTime: "0",
              state: "2",
              startedAt: String(now),
              id
            },
            []
          )
        );
        this.repository.setDocument(userId, SAVE_TAGS.investments, doc);
        return { id };
      }
      case "invest_on_friend_reminder": {
        const entry = findInvestment(doc, extId);
        if (!entry) {
          return { id: "null" };
        }
        entry.updatedAt = String(now);
        this.repository.setDocument(userId, SAVE_TAGS.investments, doc);
        return { id: String(entry.id ?? "0") };
      }
      case "invest_get_inversion":
        // Nobody can invest in the local player offline (original looks for an investor row with state 1).
        return { success: "false" };
      case "invest_cancel": {
        const entry = findInvestment(doc, extId);
        if (!entry || Number(entry.state ?? "1") >= 3) {
          return { success: "false" };
        }
        children.splice(children.indexOf(entry), 1);
        this.repository.setDocument(userId, SAVE_TAGS.investments, doc);
        return { success: "true" };
      }
      case "invest_results": {
        const entry = findInvestment(doc, extId);
        if (!entry || Number(entry.state ?? "0") !== 3) {
          return { success: "false" };
        }
        const succeeded = Number(entry.value ?? "0") >= INVEST.target;
        entry.state = succeeded ? "10" : "11";
        if (succeeded) {
          doc.investmentsRewarded = String(Number(doc.investmentsRewarded ?? "0") + 1);
        }
        this.repository.setDocument(userId, SAVE_TAGS.investments, doc);
        // Coins/cash are granted by the client (InvestDefinitionManager.giveReward) and persisted by its next snapshot.
        return { success: succeeded ? "true" : "false" };
      }
      default:
        return { success: "false" };
    }
  }

  /** get_investments_list (GamePlay.java:610-695): advance finished investments and hide state >= 10. */
  private getInvestmentsDocument(userId: number): JsonObject {
    const doc = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.investments);
    if (refreshInvestments(doc, Date.now())) {
      this.repository.setDocument(userId, SAVE_TAGS.investments, doc);
    }
    const started = doc.investmentsStarted ?? "0";
    const rewarded = doc.investmentsRewarded ?? "0";
    const visible = (getElementChildren(doc, "investmentsList") as JsonObject[]).filter(
      (entry) => Number((entry as JsonObject).state ?? "1") < 10
    );
    return { ...doc, investmentsStarted: String(started), investmentsRewarded: String(rewarded), investmentsList: visible };
  }

  private applyDailyRewardMutation(userId: number, payload: Record<string, unknown>): void {
    // GamePlay.updateDailyReward (GamePlay.java:1787-1834). The original rejects (SecurityFail) a claim when no reward is
    // due or the sku does not belong to the day's group; the offline server accepts any known sku instead.
    const sku = String(payload.sku ?? "");
    const doc = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.dailyBonus);
    applyDailyRewardGiven(doc, sku, Date.now());
    this.repository.setDocument(userId, SAVE_TAGS.dailyBonus, doc);

    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    const security = toRecord(payload.security);
    if (profile && hasMoneySecuritySnapshot(security)) {
      applyMoneySecuritySnapshotWithPositiveDeltaFallback(profile, security);
      this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
    } else if (profile) {
      const def = getDailyRewardDefinition(sku);
      const value = Number(def?.bonusValue ?? "0");
      if (def && Number.isFinite(value)) {
        addToProfile(profile, def.bonusType === "exp" ? "exp" : def.bonusType === "cash" ? "DCCash" : "DCCoins", def.bonusType === "item" ? 0 : value);
        this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
      }
    }

    // The client stores an item reward in its vault (DailyBonusManager.keepDailyBonus) and sends it as security.item.
    const item = security?.item;
    if (typeof item === "string" && item.length > 0 && item !== "null") {
      const storage = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.storage);
      adjustStorage(storage, item, 1);
      this.repository.setDocument(userId, SAVE_TAGS.storage, storage);
    }
  }

  private applyNextRentMutation(userId: number, payload: Record<string, unknown>): void {
    // GamePlay.updateNextRent (GamePlay.java:2720-2737): -1/0 stored as is, 1..259200 s stored as an absolute timestamp.
    const seconds = Number(payload.next_rent);
    if (!Number.isFinite(seconds) || seconds < -1 || seconds > 259200) {
      return;
    }
    const value = seconds === 0 || seconds === -1 ? seconds : Date.now() + seconds * 1000;
    this.repository.setMeta(`next_rent_${userId}`, String(value));
  }

  /** Drops expired `<sku>TimeOver` profile attributes (GamePlay.java:196-205). */
  private persistExpiredServices(userId: number, universe: JsonObject): void {
    const profile = getUniverseProfile(universe);
    if (!profile) {
      return;
    }
    const now = Date.now();
    let changed = false;
    for (const name of Object.keys(profile)) {
      if (name.endsWith("TimeOver") && Number(profile[name]) - now < 0) {
        delete profile[name];
        changed = true;
      }
    }
    if (changed) {
      this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
    }
  }

  private handleUpgradeCommand(userId: number, command: PacketCommand): PacketCommand {
    this.applyUpgradeCommand(userId, command._dat as Record<string, unknown>);
    this.repository.incrementSessionSync(userId);
    return {
      _cmd: command._cmd,
      _dat: command._dat as JsonObject,
      _sync: this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC
    };
  }

  private handleCollectibleCommand(userId: number, command: PacketCommand): PacketCommand {
    const payload = command._dat as Record<string, unknown>;
    const action = String(payload.action ?? "").toUpperCase();

    if (command._cmd === "ask_collectible" || action === "ASK") {
      this.applyCollectibleAskMutation(userId, payload);
    }

    if (command._cmd === "update_collectible") {
      switch (action) {
        case "KEEP":
          this.applyCollectibleKeepMutation(userId, payload);
          break;
        case "BUY":
          this.applyCollectibleBuyMutation(userId, payload);
          break;
        case "SELL":
          this.applyCollectibleSellMutation(userId, payload);
          break;
        case "GET_REWARD":
          this.applyCollectibleRewardMutation(userId, payload);
          break;
        case "SEND":
          this.applyCollectibleSendMutation(userId, payload);
          break;
        default:
          break;
      }
    }

    this.applyCollectibleMoneySecurity(userId, payload);
    this.repository.incrementSessionSync(userId);
    return {
      _cmd: command._cmd,
      _dat: {
        ...payload,
        success: "true"
      },
      _sync: this.repository.getSession(userId)?.sync ?? DEFAULT_SYNC
    };
  }

  private buildUpgradesListDocument(userId: number, payload: Record<string, unknown>): JsonObject {
    const ownerId = resolveTargetOwnerId(payload);
    const playerUniverse = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const visitorExtId = String(getUniverseProfile(playerUniverse)?.extId ?? "");
    const bossGenre = Number(getUniverseProfile(playerUniverse)?.bossGenre ?? 0);
    const targetUniverse =
      ownerId === DEFAULT_USER_ID ? playerUniverse : createNeighborUniverse(ownerId, bossGenre);

    const allRecords = getStoredUpgradeRecords(this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.upgrades));
    const todayKey = getLocalDayKey();
    const activeRecords = allRecords.filter(
      (record) =>
        record.ownerId === String(ownerId) &&
        record.dayKey === todayKey &&
        targetUniverse &&
        isUpgradeEligibleItem(targetUniverse, record.sid)
    );
    const visitorCount = activeRecords.filter((record) => record.visitorExtId === visitorExtId).length;

    return createElement(
      "upgradesList",
      {
        upgradesUniverseAvailable: String(Math.max(0, VISITOR_UPGRADES_PER_DAY - visitorCount))
      },
      activeRecords.map((record) =>
        createElement("upgrade", {
          sid: record.sid,
          extId: record.visitorExtId
        })
      )
    );
  }

  private applyUpgradeCommand(userId: number, payload: Record<string, unknown>): void {
    const sid = String(payload.sid ?? "");
    const ownerId = resolveUpgradeOwnerId(payload, sid);
    if (sid.length === 0) {
      return;
    }

    const playerUniverse = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const visitorExtId = String(getUniverseProfile(playerUniverse)?.extId ?? "");
    const bossGenre = Number(getUniverseProfile(playerUniverse)?.bossGenre ?? 0);
    const targetUniverse =
      ownerId === DEFAULT_USER_ID ? playerUniverse : createNeighborUniverse(ownerId, bossGenre);

    if (!targetUniverse || !isUpgradeEligibleItem(targetUniverse, sid)) {
      return;
    }

    const upgradesDocument = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.upgrades);
    const records = getStoredUpgradeRecords(upgradesDocument).filter((record) => record.dayKey >= getLocalDayKey(-7));
    const todayKey = getLocalDayKey();
    const existingRecord = records.some(
      (record) =>
        record.ownerId === String(ownerId) &&
        record.sid === sid &&
        record.visitorExtId === visitorExtId &&
        record.dayKey === todayKey
    );
    if (existingRecord) {
      return;
    }

    const visitorCount = records.filter(
      (record) =>
        record.ownerId === String(ownerId) &&
        record.visitorExtId === visitorExtId &&
        record.dayKey === todayKey
    ).length;
    if (visitorCount >= VISITOR_UPGRADES_PER_DAY) {
      return;
    }

    records.push({
      ownerId: String(ownerId),
      sid,
      visitorExtId,
      type: String(payload.type ?? "0"),
      dayKey: todayKey
    });

    setStoredUpgradeRecords(upgradesDocument, records);
    this.repository.setDocument(userId, SAVE_TAGS.upgrades, upgradesDocument);

    // SecurityNormal.upgradeAdd (SecurityNormal.java:691-702): the visitor earns exp/coins (security snapshot from the client).
    const security = toRecord(payload.security);
    const visitorProfile = getUniverseProfile(playerUniverse);
    if (visitorProfile && hasMoneySecuritySnapshot(security)) {
      applyPositiveMoneySecurityDeltas(visitorProfile, security);
      this.repository.setDocument(userId, SAVE_TAGS.universe, playerUniverse);
    }
  }

  private applyProfileMutation(userId: number, payload: Record<string, unknown>): void {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    if (!profile) {
      return;
    }

    const action = String(payload.action ?? "");
    const value = payload.value;

    switch (action) {
      case "city_name_codes": {
        const cityNameCodes = String(value ?? profile.cityNameCodes ?? "");
        const cityName = sanitizeStoredString(decodeAsciiCodes(cityNameCodes));
        if (cityName.length > 0) {
          profile.cityname = cityName;
        }
        profile.cityNameCodes = encodeAsciiCodes(cityName);
        normalizeCompletedTutorialUniverse(universe);
        break;
      }
      case "city_name": {
        const cityName = sanitizeStoredString(String(value ?? profile.cityname ?? DEFAULT_CITY_NAME));
        profile.cityname = cityName;
        profile.cityNameCodes = encodeAsciiCodes(cityName);
        normalizeCompletedTutorialUniverse(universe);
        break;
      }
      case "boss_genre":
        profile.bossGenre = normalizeBossGenreValue(value);
        break;
      case "gameConfig":
        this.applyGameConfigProfileMutation(userId, payload);
        break;
      case "tutorial_completed":
        // GamePlay.java:1993-1998
        profile.tutorialEnd = "1";
        normalizeCompletedTutorialUniverse(universe);
        break;
      case "firstMission":
        profile.firstMission = String(value ?? "0");
        normalizeCompletedTutorialUniverse(universe);
        break;
      case "first_invest":
        profile.firstInvest = String(value ?? "0");
        break;
      case "firstPartner":
        profile.firstPartner = String(value ?? "0");
        break;
      case "firstVisit":
        profile.firstVisit = String(value ?? "0");
        break;
      case "newToolRev":
        profile.newToolRev = String(value ?? "0");
        break;
      case "checkmail":
        profile.checkmail = normalizeCheckmailState(profile.checkmail, value);
        break;
      case "ranking":
        profile.ranking = String(value ?? profile.ranking ?? "-1");
        break;
      case "planeSku":
        profile.planeSku = String(value ?? profile.planeSku ?? "plain");
        break;
      case "fourMillions":
        profile.fourMillions = String(value ?? "0");
        break;
      case "million_news_feed":
        profile.millionNewsFeed = String(value ?? "1");
        break;
      case "newItemsRev":
      case "newItemsRevDone":
        // GamePlay.java:2024-2027 (action "newItemsRev"; the 0.501 client sends "newItemsRevDone", Profile.as:810).
        profile.newItemsRev = NEW_ITEMS_REV;
        break;
      case "service":
        // GamePlay.java:2037-2043
        applyServicePresentationShown(profile, String(value ?? ""));
        break;
      case "flag":
        // GamePlay.java:2054-2087
        applyProfileFlag(profile, String(payload.name ?? ""), String(payload.value ?? ""));
        break;
      case "restart_tutorial":
        // Not in the original (it only offers the admin task "reset_universe", Server.java externalRequest). Opt-in
        // way to replay the real tutorial: back up, then reseed a fresh save (premium currency is carried over).
        this.repository.restartTutorial(userId);
        return;
      default:
        break;
    }

    if (typeof payload.userName === "string") {
      profile.userName = sanitizeStoredString(payload.userName);
    }

    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }

  private applyGameConfigProfileMutation(userId: number, payload: Record<string, unknown>): void {
    const gameConfig = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.gameConfig);

    if (typeof payload.music === "string") {
      gameConfig.music = payload.music;
    }
    if (typeof payload.sound === "string") {
      gameConfig.sound = payload.sound;
    }
    if (typeof payload.quality === "string") {
      gameConfig.quality = payload.quality;
    }

    this.repository.setDocument(userId, SAVE_TAGS.gameConfig, gameConfig);
  }

  private applyMoneyMutation(userId: number, payload: Record<string, unknown>): void {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    if (!profile) {
      return;
    }

    const previousCash = Number(profile.DCCash ?? "0");
    const previousPaidCash = Number(profile.DCCashPaid ?? "0");
    const security = toRecord(payload.security);
    const action = String(payload.action ?? "");

    switch (action) {
      case "first_visit":
        profile.firstVisit = String(payload.value ?? "1");
        break;
      case "firstPartner":
        profile.firstPartner = String(payload.value ?? "1");
        break;
      default:
        break;
    }
    this.applyMoneyAction(userId, action, payload, universe, profile, hasMoneySecuritySnapshot(security));

    for (const [key, value] of Object.entries(payload)) {
      if (value == null) {
        continue;
      }

      if (["money", "coins", "DCCoins"].includes(key)) {
        profile.DCCoins = String(value);
      } else if (["gold", "cash", "DCCash"].includes(key)) {
        profile.DCCash = String(value);
      } else if (["paidCash", "DCCashPaid"].includes(key)) {
        profile.DCCashPaid = String(value);
      } else if (key === "exp") {
        profile.exp = String(value);
      } else if (key === "companyValue") {
        profile.companyValue = String(value);
      }
    }

    applyMoneySecuritySnapshot(profile, security);
    reconcilePremiumCurrencyPurchase(profile, payload, {
      previousCash,
      previousPaidCash,
      hadSecuritySnapshot: hasMoneySecuritySnapshot(security)
    });

    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }

  /**
   * Non-snapshot effects of update_money actions (GamePlay.updateMoney, GamePlay.java:2089-2303). The client always sends
   * the absolute security snapshot, which stays the source of truth for coins/exp/cash; when it is missing the original
   * server-computed deltas (SecurityNormal.updateMoney :72-135) are applied instead.
   */
  private applyMoneyAction(
    userId: number,
    action: string,
    payload: Record<string, unknown>,
    universe: JsonObject,
    profile: MutableNode,
    hasSnapshot: boolean
  ): void {
    const level = levelFromExp(Number(profile.exp ?? "0") || 0);
    switch (action) {
      case "exchange": {
        // Cash -> coins at settings cashToCoins (SecurityNormal.java:84-90).
        const golds = Number(payload.value ?? 0);
        if (!hasSnapshot && Number.isFinite(golds) && golds > 0 && Number(profile.DCCash ?? "0") >= golds) {
          addToProfile(profile, "DCCash", -golds);
          addToProfile(profile, "DCCoins", golds * CASH_TO_COINS);
        }
        break;
      }
      case "unlockItem": {
        // GamePlay.java:2186-2248: early_unlocked_items list; price comes from the client snapshot.
        const sku = String(payload.value ?? "");
        if (sku.length > 0) {
          const document = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.unlocked);
          if (addUnlockedItem(document, sku)) {
            this.repository.setDocument(userId, SAVE_TAGS.unlocked, document);
          }
        }
        break;
      }
      case "service": {
        // GamePlay.java:2142-2183 (profile `<sku>TimeOver`, prices SecurityNormal.java:96-107).
        const sku = String(payload.value ?? "");
        const contractId = Number(payload.id ?? 0);
        if (applyServicePurchase(profile, sku, contractId, Date.now()) && !hasSnapshot) {
          const def = getServiceDefinition(sku, contractId);
          const offer = Number(payload.offer ?? 0) === 1;
          if (def) {
            addToProfile(profile, "DCCoins", -(offer ? def.offerPriceCoins : def.priceCoins));
            addToProfile(profile, "DCCash", -(offer ? def.offerPriceCash : def.priceCash));
          }
        }
        break;
      }
      case "reward": {
        // The original marks a feed reward id as accepted (needs Facebook posts); only the grant is relevant offline.
        if (!hasSnapshot) {
          const reward = newsFeedReward(String(payload.value ?? ""));
          addToProfile(profile, "exp", reward.exp);
          addToProfile(profile, "DCCoins", reward.coins);
          addToProfile(profile, "DCCash", reward.cash);
        }
        break;
      }
      case "openBox":
      case "briefcase": {
        // Not handled by the archived server except "briefcase" (GamePlay.updateFreeGifts :1410-1494, which consumes one
        // box from storage and adds "move" prizes). openBox is the 0.501 client's generalisation (FreeGiftDefinitionManager.as:83).
        const prize = getBoxPrize(String(payload.prize ?? ""));
        const storage = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.storage);
        let storageChanged = false;
        const type = String(payload.type ?? prize?.type ?? "");
        const value = String(payload.value ?? prize?.value ?? "");
        if (prize) {
          storageChanged = adjustStorage(storage, prize.box, -1) || storageChanged;
        }
        if (type === "move") {
          storageChanged = adjustStorage(storage, "move", Number(value) || 0) || storageChanged;
        } else if (type === "item" && value.length > 0) {
          storageChanged = adjustStorage(storage, value, 1) || storageChanged;
        } else if (!hasSnapshot) {
          // FreeGiftDefinitionManager.openBox :41-55 (cash scales with level; exp percent is inferred as % of the level span).
          if (type === "cash") {
            addToProfile(profile, "DCCoins", (Number(value) || 0) * level);
          } else if (type === "gold") {
            addToProfile(profile, "DCCash", Number(value) || 0);
          }
        }
        if (storageChanged) {
          this.repository.setDocument(userId, SAVE_TAGS.storage, storage);
        }
        break;
      }
      case "rentAccelerator": {
        // ToolRentAccelerator.as:48-58: one accelerator leaves the vault and the house is flagged accelerated.
        const accelerator = getAcceleratorStorage(String(payload.sku ?? ""));
        if (accelerator) {
          const storage = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.storage);
          if (adjustStorage(storage, accelerator.storageSku, -1)) {
            this.repository.setDocument(userId, SAVE_TAGS.storage, storage);
          }
        }
        this.applyRentAccelerator(universe, String(payload.itemSid ?? ""), accelerator?.percent ?? 0);
        break;
      }
      case "dailyBonusDone": {
        // GamePlay.java:2127-2141: daily_bonus_at = now + Settings.smDailyBonusTime.
        this.repository.setMeta(`daily_bonus_at_${userId}`, String(Date.now() + DAILY_BONUS_TIME_MS));
        // SecurityNormal.java:91: coinsGain = smDailyBonusCoins * 4 (settings dailyBonus=5000 -> 20000).
        if (!hasSnapshot) addToProfile(profile, "DCCoins", DAILY_BONUS_COINS * 4);
        break;
      }
      default:
        // buyGold / buy_bundle: payments are free offline and granted by reconcilePremiumCurrencyPurchase (buyGold) or
        // by the client-side snapshot (buy_bundle, no original counterpart); dailyBonusDone/first_visit need nothing more.
        break;
    }
  }

  /** StateOnRent.accelerateIncomeTime (StateOnRent.as:1817-1830): cut `percent` of the max income time, flag accelerated. */
  private applyRentAccelerator(universe: JsonObject, sid: string, percent: number): void {
    if (sid.length === 0) {
      return;
    }
    const existing = findItemEntry(universe, sid);
    const state = existing ? findElementChild(getElementChildren(existing.itemEntry, "Item"), "State") : undefined;
    if (!state || String(state.id ?? "") !== "1" || String(state.mode ?? "") !== "4" || String(state.accelerated ?? "") === "1") {
      return;
    }
    state.accelerated = "1";
    const time = Number(state.time ?? "0");
    const contractSku = String(state.contractSku ?? "");
    const maxTime = getContractIncomeTimeMs(contractSku);
    if (Number.isFinite(time) && maxTime > 0 && percent > 0) {
      state.time = String(Math.max(0, time - Math.trunc((maxTime * percent) / 100)));
      state.savedAt = String(Date.now());
    }
  }

  private getNormalizedCollectiblesDocument(userId: number): JsonObject {
    const document = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.collectibles);
    if (normalizeCollectiblesDocument(document)) {
      this.repository.setDocument(userId, SAVE_TAGS.collectibles, document);
    }
    return document;
  }

  private getNormalizedCollectiblePendingDocument(userId: number): JsonObject {
    const document = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.collectiblePending);
    if (normalizeCollectiblePendingDocument(document)) {
      this.repository.setDocument(userId, SAVE_TAGS.collectiblePending, document);
    }
    return document;
  }

  private applyCollectibleKeepMutation(userId: number, payload: Record<string, unknown>): void {
    const sid = String(payload.sid ?? "");
    const sku = String(payload.sku ?? "");
    if (sid.length === 0 || sku.length === 0) {
      return;
    }

    const collectiblesDocument = this.getNormalizedCollectiblesDocument(userId);
    const collectibleState = readCollectiblesState(collectiblesDocument);
    let changed = false;

    if (sid.startsWith("f")) {
      const pendingDocument = this.getNormalizedCollectiblePendingDocument(userId);
      changed = removePendingFriendCollectible(pendingDocument, sid.slice(1), sku) || changed;
      if (changed) {
        this.repository.setDocument(userId, SAVE_TAGS.collectiblePending, pendingDocument);
      }
    } else if (collectibleState.pendingBySid.delete(sid)) {
      changed = true;
    }

    // KEEP/BUY refuse a 100th unit (GamePlay.java:1595-1603); the pending entry is still consumed.
    const keptUnits = collectibleState.objectCounts.get(sku) ?? 0;
    if (keptUnits < MAX_COLLECTIBLE_UNITS) {
      collectibleState.objectCounts.set(sku, keptUnits + 1);
    }
    changed = true;

    if (changed) {
      writeCollectiblesState(collectiblesDocument, collectibleState);
      this.repository.setDocument(userId, SAVE_TAGS.collectibles, collectiblesDocument);
    }
  }

  private applyCollectibleBuyMutation(userId: number, payload: Record<string, unknown>): void {
    const sku = String(payload.sku ?? "");
    if (sku.length === 0) {
      return;
    }

    const collectiblesDocument = this.getNormalizedCollectiblesDocument(userId);
    const collectibleState = readCollectiblesState(collectiblesDocument);
    const boughtUnits = collectibleState.objectCounts.get(sku) ?? 0;
    if (boughtUnits >= MAX_COLLECTIBLE_UNITS) {
      return; // GamePlay.java:1685-1688
    }
    collectibleState.objectCounts.set(sku, boughtUnits + 1);
    writeCollectiblesState(collectiblesDocument, collectibleState);
    this.repository.setDocument(userId, SAVE_TAGS.collectibles, collectiblesDocument);
  }

  /**
   * SELL (GamePlay.java:1700-1710): sells a *pending* collectible (house sid, or "f<sender>" for a friend gift), so only the
   * pending entry disappears; the coin reward arrives through the security snapshot. Owned counts are untouched.
   */
  private applyCollectibleSellMutation(userId: number, payload: Record<string, unknown>): void {
    const sid = String(payload.sid ?? "");
    const sku = String(payload.sku ?? "");
    if (sid.startsWith("f")) {
      const pendingDocument = this.getNormalizedCollectiblePendingDocument(userId);
      if (removePendingFriendCollectible(pendingDocument, sid.slice(1), sku)) {
        this.repository.setDocument(userId, SAVE_TAGS.collectiblePending, pendingDocument);
      }
      return;
    }

    const collectiblesDocument = this.getNormalizedCollectiblesDocument(userId);
    const collectibleState = readCollectiblesState(collectiblesDocument);
    if (collectibleState.pendingBySid.delete(sid)) {
      writeCollectiblesState(collectiblesDocument, collectibleState);
      this.repository.setDocument(userId, SAVE_TAGS.collectibles, collectiblesDocument);
    }
  }

  /**
   * SEND (GamePlay.java:1648-1676). From the vault ("v") the original leaves the stored counts alone; offline nobody receives
   * the gift, so the sent unit is removed from the vault (inferred). A pending sid is moved into the owned list like KEEP.
   */
  private applyCollectibleSendMutation(userId: number, payload: Record<string, unknown>): void {
    const sid = String(payload.sid ?? "");
    const sku = String(payload.sku ?? "");
    if (sid.startsWith("v")) {
      const document = this.getNormalizedCollectiblesDocument(userId);
      const state = readCollectiblesState(document);
      const count = state.objectCounts.get(sku) ?? 0;
      if (count <= 0) {
        return;
      }
      if (count === 1) {
        state.objectCounts.delete(sku);
      } else {
        state.objectCounts.set(sku, count - 1);
      }
      writeCollectiblesState(document, state);
      this.repository.setDocument(userId, SAVE_TAGS.collectibles, document);
      return;
    }
    if (sid.startsWith("f") || sid.length === 0 || sku.length === 0) {
      return;
    }
    this.applyCollectibleKeepMutation(userId, payload);
  }

  /** ASK: remember the requested collectible (UserData.mLastCollectiblesAsked); stored as `asked` on the collectibles list. */
  private applyCollectibleAskMutation(userId: number, payload: Record<string, unknown>): void {
    const sku = String(payload.sku ?? "");
    if (sku.length === 0) {
      return;
    }
    const document = this.getNormalizedCollectiblesDocument(userId);
    document.asked = pushAskedCollectible(String(document.asked ?? ""), sku);
    this.repository.setDocument(userId, SAVE_TAGS.collectibles, document);
  }

  private applyCollectibleRewardMutation(userId: number, payload: Record<string, unknown>): void {
    const sku = String(payload.sku ?? "");
    if (sku.length === 0) {
      return;
    }

    const collectiblesDocument = this.getNormalizedCollectiblesDocument(userId);
    const collectibleState = readCollectiblesState(collectiblesDocument);
    if (!collectibleState.rewards.has(sku)) {
      // Tradeable groups consume one unit of each member (GamePlay.java:1719-1746; the original throws if one is missing,
      // the offline server only consumes when the whole set is owned).
      const members = getTradeInCollectibleSkus(sku);
      if (members.length > 0 && members.every((member) => (collectibleState.objectCounts.get(member) ?? 0) > 0)) {
        for (const member of members) {
          const count = (collectibleState.objectCounts.get(member) ?? 0) - 1;
          if (count <= 0) {
            collectibleState.objectCounts.delete(member);
          } else {
            collectibleState.objectCounts.set(member, count);
          }
        }
      }
    }
    collectibleState.rewards.add(sku);
    writeCollectiblesState(collectiblesDocument, collectibleState);
    this.repository.setDocument(userId, SAVE_TAGS.collectibles, collectiblesDocument);

    const planeSku = resolvePlaneRewardSkuForCollectibleClaim(sku);
    const hqSkinSku = resolveHeadQuarterRewardSkuForCollectibleClaim(sku);
    if (!planeSku && !hqSkinSku) {
      return;
    }

    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    let changed = false;

    if (planeSku && profile && String(profile.planeSku ?? "") !== planeSku) {
      profile.planeSku = planeSku;
      changed = true;
    }

    if (hqSkinSku) {
      changed = setPlayerHeadQuarterSkin(universe, hqSkinSku) || changed;
    }

    if (changed) {
      this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
    }
  }

  private applyCollectibleRewardItemMutation(userId: number, payload: Record<string, unknown>, itemEntry: MutableNode): void {
    const groupSku = resolveItemRewardCollectibleGroupFromMutation(payload, itemEntry);
    if (!groupSku) {
      return;
    }

    this.applyCollectibleRewardMutation(userId, { sku: groupSku });
  }

  private applyCollectibleMoneySecurity(userId: number, payload: Record<string, unknown>): void {
    const security = toRecord(payload.security);
    if (!hasMoneySecuritySnapshot(security)) {
      return;
    }

    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    if (!profile) {
      return;
    }

    applyMoneySecuritySnapshotWithPositiveDeltaFallback(profile, security);
    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }

  private applyCollectibleProjectionForItemMutation(
    userId: number,
    itemEntry: MutableNode,
    payload: Record<string, unknown>
  ): PacketCommand[] {
    const state = findElementChild(getElementChildren(itemEntry, "Item"), "State");
    if (!state || !isHouseSku(String(itemEntry.sku ?? ""))) {
      return [];
    }

    const mode = String(state.mode ?? "");
    if (mode === "14" || mode === "15") {
      collapsePendingCollectibleState(state);
      return [];
    }

    if (!isCollectibleAwardMutation(payload, state)) {
      return [];
    }

    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    if (!isCollectibleFeatureUnlocked(profile)) {
      return [];
    }

    const collectiblesDocument = this.getNormalizedCollectiblesDocument(userId);
    const collectibleState = readCollectiblesState(collectiblesDocument);
    const sid = String(itemEntry.sid ?? "");
    if (sid.length === 0 || collectibleState.pendingBySid.has(sid)) {
      return [];
    }

    if (!shouldAwardCollectibleDrop(itemEntry, state)) {
      return [];
    }

    const collectibleSku = pickCollectibleSkuForHouse(String(itemEntry.sku ?? ""), sid, collectibleState);
    if (!collectibleSku) {
      return [];
    }

    collectibleState.pendingBySid.set(sid, collectibleSku);
    writeCollectiblesState(collectiblesDocument, collectibleState);
    this.repository.setDocument(userId, SAVE_TAGS.collectibles, collectiblesDocument);
    return [
      {
        _cmd: "update_item",
        _dat: {
          action: "give_collectible",
          sid,
          sku: collectibleSku
        }
      }
    ];
  }

  private applyItemMutation(userId: number, payload: Record<string, unknown>): PacketCommand[] {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    const action = String(payload.action ?? "").toLowerCase();
    const sid = String(payload.sid ?? "");
    const incomingItem = extractIncomingItemEntry(payload.item);
    const security = toRecord(payload.security);

    if (sid.length === 0) {
      return [];
    }

    this.applyItemStorageEffects(userId, payload, action, incomingItem);
    this.applyUpgradeAppliedEffect(userId, payload, sid);

    const existing = findItemEntry(universe, sid);
    const beforeSignature = existing ? getItemMutationSignature(existing.itemEntry) : "";

    if (action.includes("destroy") || action.includes("sell") || action.includes("remove")) {
      if (existing) {
        if (profile && hasMoneySecuritySnapshot(security)) {
          applyMoneySecuritySnapshotWithPositiveDeltaFallback(profile, security);
        }
        existing.companyChildren.splice(existing.index, 1);
        this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
      }
      return [];
    }

    const requestedCompanyEntry =
      getCompanyEntryBySid(universe, String(incomingItem?.csid ?? payload.csid ?? "")) ??
      (payload.whose != null ? getCompanyEntryByWhose(universe, String(payload.whose)) : undefined) ??
      (!existing ? getCompanyEntryByWhose(universe, "0") : undefined);
    const companyEntry = requestedCompanyEntry ?? existing?.companyEntry;

    if (!companyEntry) {
      return [];
    }

    const itemEntry = incomingItem ?? existing?.itemEntry ?? createItemEntry(payload, companyEntry);
    const itemChildren = getElementChildren(itemEntry, "Item");
    const shouldMoveCompanies =
      Boolean(existing) && String(existing?.companyEntry.sid ?? "") !== String(companyEntry.sid ?? "");

    const payloadSku = nonEmptyString(payload.sku);
    const incomingSku = nonEmptyString(incomingItem?.sku);
    const existingSku = nonEmptyString(existing?.itemEntry.sku);
    if (payloadSku) {
      itemEntry.sku = payloadSku;
    } else if (incomingSku) {
      itemEntry.sku = incomingSku;
    } else if (existingSku) {
      itemEntry.sku = existingSku;
    }
    if (payload.x != null) {
      itemEntry.x = String(payload.x);
    } else if (incomingItem?.x != null) {
      itemEntry.x = String(incomingItem.x);
    } else if (typeof itemEntry.x !== "string") {
      itemEntry.x = "0";
    }
    if (payload.y != null) {
      itemEntry.y = String(payload.y);
    } else if (incomingItem?.y != null) {
      itemEntry.y = String(incomingItem.y);
    } else if (typeof itemEntry.y !== "string") {
      itemEntry.y = "0";
    }
    if (payload.isSuspended != null) {
      itemEntry.isSuspended = String(payload.isSuspended);
    } else if (incomingItem?.isSuspended != null) {
      itemEntry.isSuspended = String(incomingItem.isSuspended);
    } else if (typeof itemEntry.isSuspended !== "string") {
      itemEntry.isSuspended = "0";
    }

    itemEntry.sid = sid;
    itemEntry.csid = String(companyEntry.sid ?? payload.csid ?? "1");

    const existingState = findElementChild(itemChildren, "State");
    const previousStored = existing ? findElementChild(getElementChildren(existing.itemEntry, "Item"), "State") : undefined;
    const previousMode = String(previousStored?.mode ?? "");
    const previousStateId = String(previousStored?.id ?? "");

    if (typeof itemEntry.sku === "string" && itemEntry.sku === "HeadQuarter") {
      ensureStateElement(itemChildren, { id: "4" });
      ensureHeadQuarterDecorations(itemChildren, String(companyEntry.whose ?? "0"));
    } else if (hasStateMutation(payload)) {
      const stateAttributes = extractStateAttributes(payload);
      if (stateAttributes.id == null && !existingState) {
        stateAttributes.id = "5";
      }
      ensureStateElement(itemChildren, stateAttributes);
    } else if (!existingState) {
      ensureStateElement(itemChildren, { id: "5" });
    }

    if (incomingItem && existing && !shouldMoveCompanies) {
      existing.companyChildren[existing.index] = itemEntry;
    }

    if (shouldMoveCompanies && existing) {
      existing.companyChildren.splice(existing.index, 1);
      getElementChildren(companyEntry, "Company").push(itemEntry);
    } else if (!existing) {
      getElementChildren(companyEntry, "Company").push(itemEntry);
    }

    if (action === "buy_crew") {
      // Persist <Crew ids bought/> on the item (ItemObject.getPersistence :2392); the original Java server has no handler.
      const crewEntry = getOrCreateElementChild(itemChildren, "Crew");
      const bought = new Set(String(crewEntry.bought ?? "").split(",").filter((entry) => entry.length > 0));
      for (const position of String(payload.position ?? "").split(",")) {
        if (/^\d+$/.test(position.trim())) {
          bought.add(position.trim());
        }
      }
      crewEntry.bought = Array.from(bought).sort((a, b) => Number(a) - Number(b)).join(",");
      crewEntry.ids = String(crewEntry.ids ?? "");
    }

    const doubleRentPush = this.rollDoubleRent(userId, universe, itemEntry, payload, previousStateId, previousMode);

    const itemState = findElementChild(itemChildren, "State");
    if (itemState && String(itemState.id ?? "") === "0") {
      normalizeConstructionState(String(itemEntry.sku ?? ""), itemState, Date.now());
    }
    const collectibleSideEffects = this.applyCollectibleProjectionForItemMutation(userId, itemEntry, payload);
    this.applyCollectibleRewardItemMutation(userId, payload, itemEntry);
    if (isHouseSku(String(itemEntry.sku ?? "")) && itemState && String(itemState.id ?? "") !== "0") {
      const mode = String(itemState.mode ?? "");
      if (mode !== "14" && mode !== "15") {
        normalizeHouseRentState(itemState, itemChildren, Date.now());
      }
    }
    if (
      profile &&
      hasMoneySecuritySnapshot(security) &&
      (!existing || action === "buy_crew" || beforeSignature !== getItemMutationSignature(itemEntry))
    ) {
      applyMoneySecuritySnapshotWithPositiveDeltaFallback(profile, security);
    }
    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
    return doubleRentPush ? [...collectibleSideEffects, doubleRentPush] : collectibleSideEffects;
  }

  /**
   * Vault side effects of update_item: new_item with `storage` consumes one stored item (SecurityNormal.java:206-221) and a
   * move with `freeMove` consumes one stored "move" (SecurityNormal.java:265-290).
   */
  private applyItemStorageEffects(
    userId: number,
    payload: Record<string, unknown>,
    action: string,
    incomingItem: MutableNode | undefined
  ): void {
    let sku: string | undefined;
    if (action === "new_item" && nonEmptyString(payload.storage) !== undefined) {
      sku = nonEmptyString(payload.sku) ?? nonEmptyString(incomingItem?.sku);
    } else if (action === "move" && payload.freeMove != null && String(payload.freeMove) !== "") {
      sku = "move";
    }
    if (!sku) {
      return;
    }
    const storage = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.storage);
    if (adjustStorage(storage, sku, -1)) {
      this.repository.setDocument(userId, SAVE_TAGS.storage, storage);
    }
  }

  /** new_mode with upgradeType: GamePlay.upgradeRem marks the visitor upgrades of the item as applied (GamePlay.java:2487-2489, 1340-1344). */
  private applyUpgradeAppliedEffect(userId: number, payload: Record<string, unknown>, sid: string): void {
    if (String(payload.action ?? "").toLowerCase() !== "new_mode" || payload.upgradeType == null) {
      return;
    }
    const upgradesDocument = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.upgrades);
    const records = getStoredUpgradeRecords(upgradesDocument);
    const remaining = records.filter((record) => !(record.ownerId === String(DEFAULT_USER_ID) && record.sid === sid));
    if (remaining.length !== records.length) {
      setStoredUpgradeRecords(upgradesDocument, remaining);
      this.repository.setDocument(userId, SAVE_TAGS.upgrades, upgradesDocument);
    }
  }

  private applyMapMutation(userId: number, payload: Record<string, unknown>): void {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    const mapEntry = getMapEntry(universe);
    if (!mapEntry) {
      return;
    }

    const tileType = String(payload.type ?? "").toLowerCase();
    const tileKey =
      payload.x != null && payload.y != null ? `${String(payload.x)}:${String(payload.y)}` : "";
    if (tileKey.length === 0 || (tileType !== "terrain" && tileType !== "road")) {
      return;
    }

    const action = String(payload.action ?? "").toLowerCase();
    const mapChildren = getElementChildren(mapEntry, "Map");
    const terrainTiles = parseChunkSet(findElementChild(mapChildren, "Terrain"));
    const roadTiles = parseChunkSet(findElementChild(mapChildren, "Road"));
    const targetSet = tileType === "terrain" ? terrainTiles : roadTiles;
    const hadTile = targetSet.has(tileKey);

    if (action.includes("del") || action.includes("remove")) {
      targetSet.delete(tileKey);
    } else {
      targetSet.add(tileKey);
    }

    const nextChildren: JsonObject[] = [];
    if (terrainTiles.size > 0) {
      nextChildren.push(createElement("Terrain", { chunk: serializeChunkSet(terrainTiles) }));
    }
    if (roadTiles.size > 0) {
      nextChildren.push(createElement("Road", { chunk: serializeChunkSet(roadTiles) }));
    }
    mapEntry.Map = nextChildren;

    const security = toRecord(payload.security);
    if (profile && hasMoneySecuritySnapshot(security) && hadTile !== targetSet.has(tileKey)) {
      applyMoneySecuritySnapshotWithPositiveDeltaFallback(profile, security);
    }
    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }

  private applyPlotsMutation(userId: number, payload: Record<string, unknown>): void {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    const plotsEntry = getPlotsEntry(universe);
    if (!plotsEntry) {
      return;
    }

    const states = getPlotStates(String(plotsEntry.type ?? ""));
    const beforeType = states.join(",");
    const index = Number(payload.index ?? -1);
    if (!Number.isInteger(index) || index < 0 || index >= states.length) {
      return;
    }

    const action = String(payload.action ?? "").toLowerCase();
    if (action === "bought") {
      states[index] = 2;
      unlockNextPlots(states, index);
    }

    plotsEntry.type = states.join(",");
    const security = toRecord(payload.security);
    if (profile && hasMoneySecuritySnapshot(security) && beforeType !== plotsEntry.type) {
      applyMoneySecuritySnapshotWithPositiveDeltaFallback(profile, security);
    }
    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }

  private applyMissionsMutation(userId: number, payload: Record<string, unknown>): void {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    if (!profile) {
      return;
    }

    const profileChildren = getElementChildren(profile, "Profile");
    const incomingMissions = extractIncomingElement(payload.xml, "Missions");
    if (incomingMissions) {
      upsertElementChild(profileChildren, "Missions", incomingMissions);
      this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
      return;
    }

    const sku = String(payload.sku ?? "");
    if (sku.length === 0) {
      return;
    }

    // GamePlay.updateMissions (GamePlay.java:1346-1389): not in any list -> Up -> Reached -> Given; the reward is paid
    // only on Reached -> Given (SecurityNormal.java:535-545, amounts from missionDefinitions.xml).
    const security = toRecord(payload.security);
    const missionsEntry = getOrCreateElementChild(profileChildren, "Missions");
    const missionChildren = getElementChildren(missionsEntry, "Missions");
    const up = parseChunkSet(findElementChild(missionChildren, "Up"));
    const reached = parseChunkSet(findElementChild(missionChildren, "Reached"));
    const given = parseChunkSet(findElementChild(missionChildren, "Given"));
    const missionAltReward = Number(String(profile.flags ?? "").split(",").find((flag) => flag.startsWith("missionAltReward:"))?.split(":")[1] ?? 0);
    const reward = reached.has(sku) && !given.has(sku) ? getMissionReward(sku, missionAltReward) : undefined;
    const { rewarded } = stepMission(up, reached, given, sku);

    upsertChunkElement(missionChildren, "Up", up);
    upsertChunkElement(missionChildren, "Reached", reached);
    upsertChunkElement(missionChildren, "Given", given);

    if (rewarded && reward) {
      // The client pays the reward first and then sends a snapshot of the already-paid balances (expNow/coinsNow/cashNow).
      // Never double: the final balance is max(snapshot, before + reward), so a snapshot that includes the reward wins
      // and a missing/stale one is topped up. Reload therefore neither loses nor doubles it.
      const before = { exp: Number(profile.exp ?? "0") || 0, DCCoins: Number(profile.DCCoins ?? "0") || 0, DCCash: Number(profile.DCCash ?? "0") || 0 };
      const target = { exp: before.exp + reward.exp, DCCoins: before.DCCoins + reward.coins, DCCash: before.DCCash + reward.cash };
      const now = { exp: Number(security?.expNow), DCCoins: Number(security?.coinsNow), DCCash: Number(security?.cashNow) };
      for (const key of ["exp", "DCCoins", "DCCash"] as const) {
        profile[key] = String(Number.isFinite(now[key]) ? Math.max(now[key], target[key]) : target[key]);
      }
      if (reward.items.length > 0) {
        const storage = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.storage);
        for (const item of reward.items) {
          adjustStorage(storage, item.sku, item.amount || 1);
        }
        this.repository.setDocument(userId, SAVE_TAGS.storage, storage);
      }
    }

    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }

  private applyPollManagerMutation(userId: number, payload: Record<string, unknown>): void {
    const universe = this.repository.getDocument<JsonObject>(userId, SAVE_TAGS.universe);
    const profile = getUniverseProfile(universe);
    if (!profile) {
      return;
    }

    const profileChildren = getElementChildren(profile, "Profile");
    const incomingPollManager = extractIncomingElement(payload.xml, "PollManager");
    if (incomingPollManager) {
      upsertElementChild(profileChildren, "PollManager", incomingPollManager);
      normalizeCompletedTutorialUniverse(universe);
      this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
      return;
    }

    const type = String(payload.type ?? "");
    if (type.length === 0) {
      return;
    }

    const sku = `${type}${String(payload.parameter ?? "")}`;
    const pollManagerEntry = getOrCreateElementChild(profileChildren, "PollManager");
    const pollChildren = getElementChildren(pollManagerEntry, "PollManager");
    const counts = parseCountChunkSet(findElementChild(pollChildren, "Count"));
    const action = String(payload.action ?? "").toLowerCase();

    if (action === "add") {
      counts.set(sku, (counts.get(sku) ?? 0) + 1);
    } else {
      const value = Number(payload.value ?? 0);
      if (!Number.isFinite(value)) {
        return;
      }
      counts.set(sku, value);
    }

    upsertCountChunkElement(pollChildren, "Count", counts);
    normalizeCompletedTutorialUniverse(universe);
    this.repository.setDocument(userId, SAVE_TAGS.universe, universe);
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeBossGenreValue(value: unknown): string {
  return String(value ?? "0").trim() === "1" ? "1" : "0";
}

function getItemMutationSignature(itemEntry: MutableNode): string {
  const state = findElementChild(getElementChildren(itemEntry, "Item"), "State");
  return JSON.stringify({
    sid: itemEntry.sid ?? "",
    csid: itemEntry.csid ?? "",
    sku: itemEntry.sku ?? "",
    x: itemEntry.x ?? "",
    y: itemEntry.y ?? "",
    isSuspended: itemEntry.isSuspended ?? "",
    state: state ? getStableScalarRecord(state) : {}
  });
}

function getStableScalarRecord(value: MutableNode): Record<string, string> {
  const record: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (Array.isArray(entry) || entry == null || typeof entry === "object") {
      continue;
    }
    record[key] = String(entry);
  }
  return record;
}

function normalizeCheckmailState(currentValue: unknown, nextValue: unknown): string {
  const current = parseCheckmailState(currentValue);
  const next = parseCheckmailState(nextValue);
  return String(Math.max(current, next));
}

function parseCheckmailState(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(2, Math.max(0, Math.trunc(parsed)));
}

const WONDER_INCOME_MULTIPLIER_HOUSES = new Map<string, number>(
  loadDefinitionAttributes(path.join(RULES_ROOT, "wonderDefinitions.xml"))
    .filter((def) => def.subtype === "incomeMultiplier" && def.target === "Houses")
    .map((def) => [def.sku ?? "", Math.trunc(Number(def.incomeValue ?? "0")) || 0] as [string, number])
);

/** Sum of incomeValue of the player's fully built (State id 5) incomeMultiplier wonders targeting Houses. */
function getDoubleRentHousesProbability(universe: JsonObject): number {
  let total = 0;
  const world = (universe.universe as MutableNode[] | undefined)?.find((entry) => Array.isArray(entry?.World));
  for (const company of (world?.World as MutableNode[] | undefined) ?? []) {
    if (!Array.isArray(company?.Company) || String(company.whose ?? "") !== "0") {
      continue;
    }
    for (const item of company.Company as MutableNode[]) {
      const value = WONDER_INCOME_MULTIPLIER_HOUSES.get(String(item?.sku ?? ""));
      if (value === undefined || !Array.isArray(item.Item)) {
        continue;
      }
      const state = findElementChild(item.Item as JsonObject[], "State");
      if (state && String(state.id ?? "") === "5") {
        total += value;
      }
    }
  }
  return total;
}
