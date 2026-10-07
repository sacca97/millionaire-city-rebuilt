// Offline single-player ports of the original Java backend semantics (archive-recovery-2026-10-06/java/dollars/*).
// Rules data always comes from the 0.501 XML files, never from the archived SQL row.
//
// SecurityNormal.java review (decisions; the TS server keeps the trusting-client model and NEVER logs a player out):
//  1. Rent upgrade bonus (SecurityNormal.java:~455-465): upgradeOwnerExtraPercent / superUpgradeOwnerExtraPercent are applied to
//     the XP gain only; coinsGain stays the plain contract income. DECISION: not adopted as a check. The client snapshot already
//     carries the final coins/exp, and the existing positive-delta fallback applies it as sent. Nothing to port.
//  2. Rent tolerance: Java accepts coins within +/-3500 of the base contract income (coinsMargin = 3500; 500 for the tutorial
//     5->6 step, 100 for commerce). DECISION: not adopted. A mismatch in Java throws SecurityFail (forced logout); offline a
//     mismatch can only come from client-side rounding or modding of one's own save, so the snapshot is applied unchanged.
//  3. Commerce gain hard-coding (commerce_pizza = 11500, every other commerce = 400000, margin 100) on a state change:
//     DECISION: not adopted, same reason; the client computes it from its own rules and the snapshot is trusted.
//  4. Adopted: the double-rent roll (SecurityNormal.java:466-481 -> Server.java:265) lives in CommandService.rollDoubleRent
//     (houses only; commerces never roll in Java). buy_crew has no Java handler; it is persisted as <Crew bought="..">.
import path from "path";
import type { JsonObject } from "@mcity/shared/dist/types.js";
import { loadDefinitionAttributes, loadLevelXpThresholds } from "../rules.js";
import { createElement, getElementChildren } from "../saveTree.js";
import type { MutableNode } from "./universe.js";

const RULES_ROOT = path.resolve(__dirname, "../../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules");
const rule = (name: string) => path.join(RULES_ROOT, name);

type Attrs = Record<string, string>;

const SERVICE_DEFINITIONS = loadDefinitionAttributes(rule("servicesDefinitions.xml"));
const BOX_PRIZES = new Map(loadDefinitionAttributes(rule("boxPrizeDefinition.xml")).map((d) => [d.sku, d] as const));
const GIFT_DEFINITIONS = loadDefinitionAttributes(rule("giftDefinitions.xml"));
const DAILY_REWARDS = loadDefinitionAttributes(rule("dailyRewardsDefinitions.xml"));
const NEWS_FEEDS = new Map(loadDefinitionAttributes(rule("newsFeedsDefinitions.xml")).map((d) => [d.sku, d] as const));
const INVEST_DEFINITION: Attrs =
  loadDefinitionAttributes(rule("investDefinitions.xml")).find((d) => !d.showInABTest) ?? {};
const LEVEL_XP = loadLevelXpThresholds(rule("XPTable.xml"));
const MISSIONS = new Map(loadDefinitionAttributes(rule("missionDefinitions.xml")).map((d) => [d.sku, d] as const));
const SETTINGS: Attrs = loadDefinitionAttributes(rule("settings.xml"))[0] ?? {};

export const DAILY_REWARD_TIME_MS = 86_400_000; // Settings.smDailyRewardTime (Settings.java:26)
/** Settings.smDailyBonusTime = dailyBonusMinTime hours (Settings.java:35). */
export const DAILY_BONUS_TIME_MS = (Number(SETTINGS.dailyBonusMinTime ?? "24") || 24) * 3_600_000;
export const DAILY_BONUS_COINS = Number(SETTINGS.dailyBonus ?? "5000") || 0; // Settings.smDailyBonusCoins
export const NEW_ITEMS_REV = String(SETTINGS.newItemsRev ?? "1");

// ---- services (ServiceDefinitions.java:15-95) -------------------------------------------------------------------

export type ServiceDefinition = {
  durationMs: number;
  extraMs: number;
  priceCoins: number;
  priceCash: number;
  offerPriceCoins: number;
  offerPriceCash: number;
  timeExpiredMs: number;
  maxExponent: number;
};

/** getSkuId(sku, contractId): the contractId-th definition (in file order) with this sku. */
export function getServiceDefinition(sku: string, contractId: number): ServiceDefinition | undefined {
  const matches = SERVICE_DEFINITIONS.filter((d) => d.sku === sku);
  const def = matches[contractId];
  if (!def) {
    return undefined;
  }
  const n = (key: string) => (Number.isFinite(Number(def[key])) ? Number(def[key]) : 0);
  return {
    durationMs: Math.trunc(n("timeDuration") * 3_600_000),
    extraMs: Math.trunc(n("timeExtra") * 60_000),
    priceCoins: n("priceCoins"),
    priceCash: n("priceCash"),
    offerPriceCoins: n("offerPriceCoins"),
    offerPriceCash: n("offerPriceCash"),
    timeExpiredMs: Math.trunc(n("timeExpired") * 3_600_000),
    maxExponent: n("timeExpiredMax")
  };
}

/** GamePlay.updateMoney action "service" (GamePlay.java:2142-2183). Mutates the profile attributes. */
export function applyServicePurchase(profile: MutableNode, sku: string, contractId: number, nowMs: number): boolean {
  const def = getServiceDefinition(sku, contractId);
  if (!def) {
    return false;
  }
  profile[`${sku}TimeOver`] = String(nowMs + def.durationMs);
  if (def.timeExpiredMs > 0) {
    const usesKey = `${sku}_3UsesCount`;
    let uses = Number(profile[usesKey] ?? "0");
    uses = Number.isFinite(uses) ? uses : 0;
    if (uses < def.maxExponent) {
      uses += 1;
    }
    profile[`${sku}_3TimeOver`] = String(nowMs + def.timeExpiredMs);
    profile[usesKey] = String(uses);
  }
  return true;
}

/**
 * GamePlay.getWorld "Proccess Time-Services" (GamePlay.java:190-212): the client reads `<sku>TimeLeft` from the profile.
 * Expired `TimeOver` attributes are removed. Returns true if the profile changed.
 */
export function projectServiceTimes(profile: MutableNode, nowMs: number): boolean {
  let changed = false;
  for (const name of Object.keys(profile)) {
    if (!name.endsWith("TimeOver")) {
      continue;
    }
    const over = Number(profile[name]);
    if (!Number.isFinite(over)) {
      continue;
    }
    const left = Math.max(0, over - nowMs);
    const sku = name.slice(0, name.lastIndexOf("TimeOver"));
    if (left === 0) {
      delete profile[name];
      changed = true;
    }
    profile[`${sku}TimeLeft`] = String(left);
  }
  return changed;
}

/** GamePlay.updateProfile "service" (GamePlay.java:2037-2043). */
export function applyServicePresentationShown(profile: MutableNode, sku: string): boolean {
  if (!getServiceDefinition(sku, 0)) {
    return false;
  }
  profile[`${sku}PresentationShown`] = "1";
  return true;
}

// ---- profile flags (GamePlay.java:2054-2087) ---------------------------------------------------------------------

export function applyProfileFlag(profile: MutableNode, name: string, value: string): boolean {
  const flags = String(profile.flags ?? "");
  const parts = flags.split(",");
  let newFlags = "";
  let found = false;
  for (let i = 0; i < parts.length; i += 1) {
    const flag = parts[i] ?? "";
    if (flag.length === 0) {
      continue;
    }
    if (!found && (flag.startsWith(`${name}:`) || flag === name)) {
      parts[i] = `${name}:${value}`;
      found = true;
    }
    newFlags += `${parts[i]},`;
  }
  if (!found) {
    // Java appends without a trailing comma (GamePlay.java:2080); keep that exact format.
    newFlags += `${name}:${value}`;
  }
  if (newFlags === flags) {
    return false;
  }
  profile.flags = newFlags;
  return true;
}

// ---- list documents ----------------------------------------------------------------------------------------------

/** unlockedList: `<item sku=""/>` children (GamePlay.getUnlockedItemsList :697-733; UnlockedListManager.build). */
export function addUnlockedItem(document: JsonObject, sku: string): boolean {
  const children = getElementChildren(document, "unlockedList");
  if (children.some((entry) => String((entry as MutableNode).sku ?? "") === sku)) {
    return false;
  }
  children.push(createElement("item", { sku }));
  return true;
}

/** storageList: `<item sku amount/>` children (StorageManager.build; GamePlay.getStorageInfo :866-897). */
export function adjustStorage(document: JsonObject, sku: string, delta: number): boolean {
  const children = getElementChildren(document, "storageList");
  const index = children.findIndex((entry) => String((entry as MutableNode).sku ?? "") === sku);
  const current = index === -1 ? 0 : Number((children[index] as MutableNode).amount ?? "0");
  const next = (Number.isFinite(current) ? current : 0) + delta;
  if (delta < 0 && index === -1) {
    return false;
  }
  if (next <= 0) {
    if (index !== -1) {
      children.splice(index, 1);
      return true;
    }
    return false;
  }
  if (index === -1) {
    children.push(createElement("item", { sku, amount: String(next) }));
  } else {
    (children[index] as MutableNode).amount = String(next);
  }
  return true;
}

export function getStorageAmount(document: JsonObject, sku: string): number {
  const entry = getElementChildren(document, "storageList").find((e) => String((e as MutableNode).sku ?? "") === sku);
  const amount = Number((entry as MutableNode | undefined)?.amount ?? "0");
  return Number.isFinite(amount) ? amount : 0;
}

// ---- free gifts / boxes ------------------------------------------------------------------------------------------

export type BoxPrize = { sku: string; box: string; type: string; value: string };

export function getBoxPrize(prizeSku: string): BoxPrize | undefined {
  const def = BOX_PRIZES.get(prizeSku);
  return def ? { sku: def.sku, box: def.item, type: def.giftType, value: def.value } : undefined;
}

/**
 * FreeGiftDefinition.sku (rentAccelerator payload `sku`, e.g. fgift_018) -> storage sku (its giftType, e.g. rentAcc30),
 * following StorageManager.addItem (non "item" gifts are stored under their giftType). Returns the acceleration percent too.
 */
export function getAcceleratorStorage(giftSku: string): { storageSku: string; percent: number } | undefined {
  const def = GIFT_DEFINITIONS.find((d) => d.sku === giftSku && d.action === "rentAccelerator");
  if (!def) {
    return undefined;
  }
  const percent = Number(def.value);
  return { storageSku: def.giftType, percent: Number.isFinite(percent) ? percent : 0 };
}

// ---- levels / fallback money (used only when the client sent no security snapshot) -------------------------------

export function levelFromExp(exp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length; i += 1) {
    if (exp >= (LEVEL_XP[i] ?? Number.POSITIVE_INFINITY)) {
      level = i + 1;
    }
  }
  return level;
}

export function newsFeedReward(sku: string): { exp: number; coins: number; cash: number } {
  const def = NEWS_FEEDS.get(sku);
  const amount = Number(def?.rewardAmount ?? "0") || 0;
  const type = def?.rewardType ?? "";
  // NewsFeedsDefinitions.getRewardExp/Coins/Cash (SecurityNormal.java:111-115); rewardTypesDefinitions: Exp, DCCoins.
  return {
    exp: type === "Exp" ? amount : 0,
    coins: type === "DCCoins" ? amount : 0,
    cash: type === "DCCash" ? amount : 0
  };
}

export function addToProfile(profile: MutableNode, key: "exp" | "DCCoins" | "DCCash" | "companyValue", delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }
  const current = Number(profile[key] ?? "0");
  profile[key] = String((Number.isFinite(current) ? current : 0) + delta);
}

// ---- daily rewards (GamePlay.getDailyRewardsInfo :899-957, updateDailyReward :1787-1834) -------------------------

export type DailyRewardDefinition = { sku: string; bonusType: string; bonusValue: string; group: number; chances: number };

export function getDailyRewardDefinition(sku: string): DailyRewardDefinition | undefined {
  const def = DAILY_REWARDS.find((d) => d.sku === sku);
  return def
    ? { sku: def.sku, bonusType: def.bonusType, bonusValue: def.bonusValue, group: Number(def.group), chances: Number(def.chances) }
    : undefined;
}

/** DailyRewardsRules.getRewardByDay (DailyRewardsRules.java:46-65); groups map is identity 1..5 (original config row). */
export function pickDailyRewardByDay(day: number, random: () => number = Math.random): string | undefined {
  const d = (day - 1) % 5; // Java remainder keeps the sign, as does JS
  const group = d > 0 && d < 5 ? d + 1 : 1;
  const defs = DAILY_REWARDS.filter((def) => Number(def.group) === group && !def.date);
  const maxProb = defs.reduce((sum, def) => sum + Number(def.chances), 0);
  const roll = Math.trunc(maxProb * random());
  let acc = 0;
  for (const def of defs) {
    const chances = Number(def.chances);
    if (roll >= acc && roll < acc + chances) {
      return def.sku;
    }
    acc += chances;
  }
  return undefined;
}

export function getDailyRewardGroupByDay(day: number): number {
  const d = (day - 1) % 5;
  return d > 0 && d < 5 ? d + 1 : 1;
}

/**
 * get_daily_rewards_info: advances the stored progress at login. > 24h since the last given date => a reward is due;
 * > 48h => streak reset (count 0, history cleared), else count + 1. A new nextRewardId is rolled for the new count.
 */
export function refreshDailyRewardsInfo(
  doc: MutableNode,
  nowMs: number,
  random: () => number = Math.random
): { changed: boolean; reset: boolean } {
  let changed = false;
  let reset = false;
  const lastDate = Number(doc.dailyRewardsLastGivenDate ?? "0") || 0;
  const diff = nowMs - lastDate;
  if (diff > DAILY_REWARD_TIME_MS) {
    let count = 0;
    if (diff > 2 * DAILY_REWARD_TIME_MS) {
      doc.dailyRewardsCount = "0";
      doc.dailyRewardsLastGiven = "";
      reset = true;
    } else {
      count = (Number(doc.dailyRewardsCount ?? "0") || 0) + 1;
      doc.dailyRewardsCount = String(count);
    }
    doc.dailyRewardsNextRewardId = pickDailyRewardByDay(count, random) ?? "";
    changed = true;
  }
  return { changed, reset };
}

/** update_daily_reward: count + 1, last-given date = local 00:10 of today, history keeps the last 5 skus. */
export function applyDailyRewardGiven(doc: MutableNode, sku: string, nowMs: number): void {
  const date = new Date(nowMs);
  date.setHours(0, 10, 0, 0);
  doc.dailyRewardsLastGivenDate = String(date.getTime());
  let given = `${String(doc.dailyRewardsLastGiven ?? "")}${sku},`;
  if (given.split(",").length > 6) {
    given = given.slice(given.indexOf(",") + 1);
  }
  doc.dailyRewardsLastGiven = given;
  doc.dailyRewardsCount = String((Number(doc.dailyRewardsCount ?? "0") || 0) + 1);
}

// ---- investments (GamePlay.java:610-695, 1135-1284; InvestDefinitions) -------------------------------------------

export const INVEST = {
  timeMs: (Number(INVEST_DEFINITION.time) || 20) * 86_400_000,
  target: Number(INVEST_DEFINITION.target) || 4_000_000,
  inversion: Number(INVEST_DEFINITION.inversion) || 0,
  rewardCoins: Number(INVEST_DEFINITION.rewardDCCoins) || 0,
  rewardCash: Number(INVEST_DEFINITION.rewardDCCash) || 0
};

/** Offline NPC friends are rich enough to always reach the target (inferred; the original reads the real friend). */
export const OFFLINE_FRIEND_COMPANY_VALUE = 100_000_000;

export function findInvestment(doc: JsonObject, extId: string): MutableNode | undefined {
  return getElementChildren(doc, "investmentsList").find(
    (entry) => Array.isArray((entry as MutableNode).investment) && String((entry as MutableNode).extId ?? "") === extId
  ) as MutableNode | undefined;
}

/** Advance state 2 -> 3 when the investment time has elapsed (getInvestmentsList :640-668) and refresh time/value. */
export function refreshInvestments(doc: JsonObject, nowMs: number): boolean {
  let changed = false;
  for (const entry of getElementChildren(doc, "investmentsList") as MutableNode[]) {
    if (!Array.isArray(entry.investment)) {
      continue;
    }
    const state = Number(entry.state ?? "1");
    if (state === 2) {
      const started = Number(entry.startedAt ?? nowMs) || nowMs;
      const remaining = INVEST.timeMs - (nowMs - started);
      const value = Number(entry.value ?? "0");
      if (remaining > 0 && value < INVEST.target) {
        entry.time = String(Math.trunc(remaining));
      } else {
        // The original samples the friend's company value now (GamePlay.java:652-668); offline friends are rich NPCs.
        entry.state = "3";
        entry.time = "0";
        entry.value = String(Math.max(value, OFFLINE_FRIEND_COMPANY_VALUE));
        changed = true;
      }
    } else if (state === 3 && entry.time !== "0") {
      entry.time = "0";
      changed = true;
    }
  }
  return changed;
}

// ---- missions (GamePlay.updateMissions :1346-1389, SecurityNormal.updateMissions :535-545) -------------------------

export type MissionReward = { coins: number; cash: number; exp: number; items: Array<{ sku: string; amount: number }> };

/**
 * Rewards of missionDefinitions.xml `rewardType`/`rewardAmount` ("coins;exp" / item sku), as parsed by the client
 * (MissionDefinition.parseRewards). The original only knew coins/cash (MissionDefinitions.java:30-33); exp and item
 * rewards are the 0.501 data. undefined = unknown sku (the original NPEs, i.e. SecurityFail).
 */
export function getMissionReward(sku: string, group = 0): MissionReward | undefined {
  const def = MISSIONS.get(sku);
  if (!def) {
    return undefined;
  }
  const out: MissionReward = { coins: 0, cash: 0, exp: 0, items: [] };
  const suffix = group === 1 || group === 2 ? String(group) : "";
  const rewardType = suffix && def[`rewardTypeABtest${suffix}`] ? def[`rewardTypeABtest${suffix}`] : def.rewardType;
  const rewardAmount = suffix && def[`rewardAmountABtest${suffix}`] ? def[`rewardAmountABtest${suffix}`] : def.rewardAmount;
  const types = String(rewardType ?? "").split(";").filter((t) => t.length > 0);
  const amounts = String(rewardAmount ?? "").split(";");
  types.forEach((type, i) => {
    const n = Math.trunc(Number(amounts[i] ?? "0")) || 0;
    if (type === "coins") out.coins += n;
    else if (type === "cash") out.cash += n;
    else if (type === "exp") out.exp += n;
    else out.items.push({ sku: type, amount: n });
  });
  return out;
}

/** One step of the chunk machine (GamePlay.java:1346-1370): given stays, reached->given (rewarded), up->reached, else ->up. */
export function stepMission(up: Set<string>, reached: Set<string>, given: Set<string>, sku: string): { rewarded: boolean } {
  if (given.has(sku)) {
    return { rewarded: false };
  }
  if (reached.delete(sku)) {
    given.add(sku);
    return { rewarded: true };
  }
  if (up.delete(sku)) {
    reached.add(sku);
    return { rewarded: false };
  }
  up.add(sku);
  return { rewarded: false };
}
