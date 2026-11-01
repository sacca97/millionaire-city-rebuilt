//! Port of `apps/server/src/commandHandlers/offline.ts` (package "libs-b", see docs/rust-server-plan.md).
//! Pure functions over documents (services, storage, unlocked items, daily rewards, investments, missions); the command
//! handlers that call them live in `offline.rs`.
//!
//! Conventions: documents / the profile (`MutableNode`) are `serde_json::Value` objects mutated in place; TS `number` is
//! `f64` where the value can be fractional / NaN; TS `nowMs` is `now_ms: i64`; the TS `random: () => number` parameter is
//! `&mut dyn FnMut() -> f64` (call sites pass `|| rand::random::<f64>()`, TS default `Math.random`).
#![allow(dead_code)]

use crate::rules::{load_definition_attributes, load_level_xp_thresholds};
use crate::save_tree::{create_element, get_element_children};
use crate::util::{js_number, js_number_to_string, js_string_or_empty, js_string_to_number};
use chrono::{Local, NaiveDate, Offset, TimeZone};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::OnceLock;

type Attrs = HashMap<String, String>;

// ---- rules (offline.ts:20-35; loaded lazily once, like the TS module-level constants) ----------------------------------

/// `RULES_ROOT` (offline.ts:19): the raw 0.501 rules XML, never the patched copies served over HTTP.
pub fn rules_root() -> PathBuf {
    crate::config::workspace_root().join("assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules")
}

struct OfflineRules {
    service_definitions: Vec<Attrs>,
    box_prizes: HashMap<String, Attrs>,
    gift_definitions: Vec<Attrs>,
    daily_rewards: Vec<Attrs>,
    news_feeds: HashMap<String, Attrs>,
    invest_definition: Attrs,
    level_xp: Vec<f64>,
    missions: HashMap<String, Attrs>,
    settings: Attrs,
}

fn by_sku(defs: Vec<Attrs>) -> HashMap<String, Attrs> {
    // `new Map(defs.map((d) => [d.sku, d]))`: a later duplicate wins; a missing sku is the key `undefined`.
    let mut m = HashMap::new();
    for d in defs {
        m.insert(d.get("sku").cloned().unwrap_or_else(|| "undefined".to_string()), d);
    }
    m
}

fn rules() -> &'static OfflineRules {
    static R: OnceLock<OfflineRules> = OnceLock::new();
    R.get_or_init(|| {
        let root = rules_root();
        let load = |n: &str| load_definition_attributes(&root.join(n));
        OfflineRules {
            service_definitions: load("servicesDefinitions.xml"),
            box_prizes: by_sku(load("boxPrizeDefinition.xml")),
            gift_definitions: load("giftDefinitions.xml"),
            daily_rewards: load("dailyRewardsDefinitions.xml"),
            news_feeds: by_sku(load("newsFeedsDefinitions.xml")),
            invest_definition: load("investDefinitions.xml")
                .into_iter()
                .find(|d| d.get("showInABTest").map_or(true, |v| v.is_empty()))
                .unwrap_or_default(),
            level_xp: load_level_xp_thresholds(&root.join("XPTable.xml")),
            missions: by_sku(load("missionDefinitions.xml")),
            settings: load("settings.xml").into_iter().next().unwrap_or_default(),
        }
    })
}

// ---- JS helpers ---------------------------------------------------------------------------------------------------

/// `Number(x ?? default)` for an attribute of a node (a JSON null counts as missing, like `??`).
fn num_or(node: &Value, key: &str, default: &str) -> f64 {
    match node.get(key) {
        None | Some(Value::Null) => js_string_to_number(default),
        Some(v) => js_number(Some(v)),
    }
}

/// `Number(attrs[key])`: a missing attribute is NaN.
fn attr_number(attrs: &Attrs, key: &str) -> f64 {
    attrs.get(key).map_or(f64::NAN, |s| js_string_to_number(s))
}

/// `a || 0` for a number (NaN and 0 give 0).
fn or_zero(n: f64) -> f64 {
    if n.is_nan() || n == 0.0 { 0.0 } else { n }
}

/// `a || fallback` for a number.
fn or_else(n: f64, fallback: f64) -> f64 {
    if n.is_nan() || n == 0.0 { fallback } else { n }
}

/// `Math.max(a, b)`: NaN poisons (unlike `f64::max`).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else if a > b { a } else { b }
}

fn set_str(node: &mut Value, key: &str, value: String) {
    node.as_object_mut().expect("node must be an object").insert(key.to_string(), Value::String(value));
}

fn str_attr(node: &Value, key: &str) -> String {
    js_string_or_empty(node.get(key))
}

// ---- constants (offline.ts:37-42) ---------------------------------------------------------------------------------

/// Settings.smDailyRewardTime (Settings.java:26); offline.ts:37 `DAILY_REWARD_TIME_MS`.
pub const DAILY_REWARD_TIME_MS: f64 = 86_400_000.0;

/// Settings.smDailyBonusTime = dailyBonusMinTime hours (Settings.java:35); offline.ts:39 `DAILY_BONUS_TIME_MS`.
pub fn daily_bonus_time_ms() -> f64 {
    let v = rules().settings.get("dailyBonusMinTime").map_or("24", String::as_str);
    or_else(js_string_to_number(v), 24.0) * 3_600_000.0
}

/// offline.ts:40 `DAILY_BONUS_COINS` (Settings.smDailyBonusCoins).
pub fn daily_bonus_coins() -> f64 {
    let v = rules().settings.get("dailyBonus").map_or("5000", String::as_str);
    or_zero(js_string_to_number(v))
}

/// offline.ts:41 `NEW_ITEMS_REV`.
pub fn new_items_rev() -> String {
    rules().settings.get("newItemsRev").cloned().unwrap_or_else(|| "1".to_string())
}

// ---- services (ServiceDefinitions.java:15-95) ---------------------------------------------------------------------

/// offline.ts:45 `ServiceDefinition` (all JS numbers).
#[derive(Debug, Clone, PartialEq)]
pub struct ServiceDefinition {
    pub duration_ms: f64,
    pub extra_ms: f64,
    pub price_coins: f64,
    pub price_cash: f64,
    pub offer_price_coins: f64,
    pub offer_price_cash: f64,
    pub time_expired_ms: f64,
    pub max_exponent: f64,
}

/// offline.ts:57 `getServiceDefinition`: getSkuId(sku, contractId), the contractId-th definition (in file order) with this
/// sku. `contract_id` is a JS number: a negative or non-integer index finds nothing.
pub fn get_service_definition(sku: &str, contract_id: f64) -> Option<ServiceDefinition> {
    let matches: Vec<&Attrs> =
        rules().service_definitions.iter().filter(|d| d.get("sku").map(String::as_str) == Some(sku)).collect();
    if !(contract_id >= 0.0 && contract_id.fract() == 0.0 && contract_id < matches.len() as f64) {
        return None;
    }
    let def = matches[contract_id as usize];
    let n = |key: &str| {
        let v = attr_number(def, key);
        if v.is_finite() { v } else { 0.0 }
    };
    Some(ServiceDefinition {
        duration_ms: (n("timeDuration") * 3_600_000.0).trunc(),
        extra_ms: (n("timeExtra") * 60_000.0).trunc(),
        price_coins: n("priceCoins"),
        price_cash: n("priceCash"),
        offer_price_coins: n("offerPriceCoins"),
        offer_price_cash: n("offerPriceCash"),
        time_expired_ms: (n("timeExpired") * 3_600_000.0).trunc(),
        max_exponent: n("timeExpiredMax"),
    })
}

/// offline.ts:77 `applyServicePurchase`: GamePlay.updateMoney action "service" (GamePlay.java:2142-2183). Mutates the
/// profile attributes.
pub fn apply_service_purchase(profile: &mut Value, sku: &str, contract_id: f64, now_ms: i64) -> bool {
    let Some(def) = get_service_definition(sku, contract_id) else { return false };
    let now = now_ms as f64;
    set_str(profile, &format!("{sku}TimeOver"), js_number_to_string(now + def.duration_ms));
    if def.time_expired_ms > 0.0 {
        let uses_key = format!("{sku}_3UsesCount");
        let mut uses = num_or(profile, &uses_key, "0");
        uses = if uses.is_finite() { uses } else { 0.0 };
        if uses < def.max_exponent {
            uses += 1.0;
        }
        set_str(profile, &format!("{sku}_3TimeOver"), js_number_to_string(now + def.time_expired_ms));
        set_str(profile, &uses_key, js_number_to_string(uses));
    }
    true
}

/// offline.ts:100 `projectServiceTimes`: GamePlay.getWorld "Proccess Time-Services" (GamePlay.java:190-212): the client
/// reads `<sku>TimeLeft` from the profile. Expired `TimeOver` attributes are removed. Returns true if the profile changed.
pub fn project_service_times(profile: &mut Value, now_ms: i64) -> bool {
    let mut changed = false;
    let names: Vec<String> = profile.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    for name in names {
        if !name.ends_with("TimeOver") {
            continue;
        }
        let over = js_number(profile.get(&name));
        if !over.is_finite() {
            continue;
        }
        let left = js_max(0.0, over - now_ms as f64);
        let sku = &name[..name.len() - "TimeOver".len()];
        if left == 0.0 {
            profile.as_object_mut().unwrap().shift_remove(&name);
            changed = true;
        }
        set_str(profile, &format!("{sku}TimeLeft"), js_number_to_string(left));
    }
    changed
}

/// offline.ts:122 `applyServicePresentationShown`: GamePlay.updateProfile "service" (GamePlay.java:2037-2043).
pub fn apply_service_presentation_shown(profile: &mut Value, sku: &str) -> bool {
    if get_service_definition(sku, 0.0).is_none() {
        return false;
    }
    set_str(profile, &format!("{sku}PresentationShown"), "1".to_string());
    true
}

// ---- profile flags (GamePlay.java:2054-2087) ----------------------------------------------------------------------

/// offline.ts:132 `applyProfileFlag` (GamePlay.java:2054-2087).
pub fn apply_profile_flag(profile: &mut Value, name: &str, value: &str) -> bool {
    let flags = str_attr(profile, "flags");
    let mut parts: Vec<String> = flags.split(',').map(String::from).collect();
    let mut new_flags = String::new();
    let mut found = false;
    for i in 0..parts.len() {
        if parts[i].is_empty() {
            continue;
        }
        if !found && (parts[i].starts_with(&format!("{name}:")) || parts[i] == name) {
            parts[i] = format!("{name}:{value}");
            found = true;
        }
        new_flags.push_str(&parts[i]);
        new_flags.push(',');
    }
    if !found {
        // Java appends without a trailing comma (GamePlay.java:2080); keep that exact format.
        new_flags.push_str(&format!("{name}:{value}"));
    }
    if new_flags == flags {
        return false;
    }
    set_str(profile, "flags", new_flags);
    true
}

// ---- list documents -----------------------------------------------------------------------------------------------

/// offline.ts:162 `addUnlockedItem`: unlockedList `<item sku=""/>` children (GamePlay.getUnlockedItemsList :697-733;
/// UnlockedListManager.build).
pub fn add_unlocked_item(document: &mut Value, sku: &str) -> bool {
    let children = get_element_children(document, "unlockedList");
    if children.iter().any(|e| str_attr(e, "sku") == sku) {
        return false;
    }
    children.push(create_element("item", &[("sku", sku)], Vec::new()));
    true
}

/// offline.ts:172 `adjustStorage`: storageList `<item sku amount/>` children (StorageManager.build;
/// GamePlay.getStorageInfo :866-897).
pub fn adjust_storage(document: &mut Value, sku: &str, delta: f64) -> bool {
    let children = get_element_children(document, "storageList");
    let index = children.iter().position(|e| str_attr(e, "sku") == sku);
    let current = match index {
        None => 0.0,
        Some(i) => num_or(&children[i], "amount", "0"),
    };
    let next = (if current.is_finite() { current } else { 0.0 }) + delta;
    if delta < 0.0 && index.is_none() {
        return false;
    }
    if next <= 0.0 {
        if let Some(i) = index {
            children.remove(i);
            return true;
        }
        return false;
    }
    match index {
        None => children.push(create_element("item", &[("sku", sku), ("amount", &js_number_to_string(next))], Vec::new())),
        Some(i) => set_str(&mut children[i], "amount", js_number_to_string(next)),
    }
    true
}

/// offline.ts:195 `getStorageAmount`.
pub fn get_storage_amount(document: &mut Value, sku: &str) -> f64 {
    let children = get_element_children(document, "storageList");
    let amount = match children.iter().find(|e| str_attr(e, "sku") == sku) {
        None => 0.0,
        Some(e) => num_or(e, "amount", "0"),
    };
    if amount.is_finite() { amount } else { 0.0 }
}

// ---- free gifts / boxes -------------------------------------------------------------------------------------------

/// offline.ts:203 `BoxPrize` (`box`/`type`/`value` are `undefined` in TS when the attribute is missing).
#[derive(Debug, Clone, PartialEq)]
pub struct BoxPrize {
    pub sku: String,
    pub r#box: Option<String>,
    pub r#type: Option<String>,
    pub value: Option<String>,
}

/// offline.ts:205 `getBoxPrize`.
pub fn get_box_prize(prize_sku: &str) -> Option<BoxPrize> {
    rules().box_prizes.get(prize_sku).map(|def| BoxPrize {
        sku: def.get("sku").cloned().unwrap_or_default(),
        r#box: def.get("item").cloned(),
        r#type: def.get("giftType").cloned(),
        value: def.get("value").cloned(),
    })
}

/// offline.ts:214 `getAcceleratorStorage` result (`storage_sku` is `undefined` in TS when the gift has no `giftType`).
#[derive(Debug, Clone, PartialEq)]
pub struct AcceleratorStorage {
    pub storage_sku: Option<String>,
    pub percent: f64,
}

/// offline.ts:214 `getAcceleratorStorage`: FreeGiftDefinition.sku (rentAccelerator payload `sku`, e.g. fgift_018) ->
/// storage sku (its giftType, e.g. rentAcc30), following StorageManager.addItem. Returns the acceleration percent too.
pub fn get_accelerator_storage(gift_sku: &str) -> Option<AcceleratorStorage> {
    let def = rules().gift_definitions.iter().find(|d| {
        d.get("sku").map(String::as_str) == Some(gift_sku) && d.get("action").map(String::as_str) == Some("rentAccelerator")
    })?;
    let percent = attr_number(def, "value");
    Some(AcceleratorStorage {
        storage_sku: def.get("giftType").cloned(),
        percent: if percent.is_finite() { percent } else { 0.0 },
    })
}

// ---- levels / fallback money --------------------------------------------------------------------------------------

/// offline.ts:225 `levelFromExp`.
pub fn level_from_exp(exp: f64) -> f64 {
    let xp = &rules().level_xp;
    let mut level = 1.0;
    for i in 1..xp.len() {
        if exp >= xp[i] {
            level = (i + 1) as f64;
        }
    }
    level
}

/// offline.ts:235 `newsFeedReward` result.
#[derive(Debug, Clone, PartialEq)]
pub struct NewsFeedReward {
    pub exp: f64,
    pub coins: f64,
    pub cash: f64,
}

/// offline.ts:235 `newsFeedReward`. NewsFeedsDefinitions.getRewardExp/Coins/Cash (SecurityNormal.java:111-115).
pub fn news_feed_reward(sku: &str) -> NewsFeedReward {
    let def = rules().news_feeds.get(sku);
    let amount = or_zero(def.map_or(0.0, |d| js_string_to_number(d.get("rewardAmount").map_or("0", String::as_str))));
    let ty = def.and_then(|d| d.get("rewardType")).map_or("", String::as_str);
    NewsFeedReward {
        exp: if ty == "Exp" { amount } else { 0.0 },
        coins: if ty == "DCCoins" { amount } else { 0.0 },
        cash: if ty == "DCCash" { amount } else { 0.0 },
    }
}

/// offline.ts:247 `addToProfile`; `key` is one of `exp`, `DCCoins`, `DCCash`, `companyValue`.
pub fn add_to_profile(profile: &mut Value, key: &str, delta: f64) {
    if !delta.is_finite() || delta == 0.0 {
        return;
    }
    let current = num_or(profile, key, "0");
    set_str(profile, key, js_number_to_string((if current.is_finite() { current } else { 0.0 }) + delta));
}

// ---- daily rewards (GamePlay.getDailyRewardsInfo :899-957, updateDailyReward :1787-1834) --------------------------

/// offline.ts:257 `DailyRewardDefinition` (`bonus_type`/`bonus_value` are `undefined` in TS when missing).
#[derive(Debug, Clone, PartialEq)]
pub struct DailyRewardDefinition {
    pub sku: String,
    pub bonus_type: Option<String>,
    pub bonus_value: Option<String>,
    pub group: f64,
    pub chances: f64,
}

/// offline.ts:259 `getDailyRewardDefinition`.
pub fn get_daily_reward_definition(sku: &str) -> Option<DailyRewardDefinition> {
    let def = rules().daily_rewards.iter().find(|d| d.get("sku").map(String::as_str) == Some(sku))?;
    Some(DailyRewardDefinition {
        sku: sku.to_string(),
        bonus_type: def.get("bonusType").cloned(),
        bonus_value: def.get("bonusValue").cloned(),
        group: attr_number(def, "group"),
        chances: attr_number(def, "chances"),
    })
}

/// offline.ts:284 `getDailyRewardGroupByDay` (the group part of DailyRewardsRules.getRewardByDay).
pub fn get_daily_reward_group_by_day(day: f64) -> f64 {
    let d = (day - 1.0) % 5.0;
    if d > 0.0 && d < 5.0 { d + 1.0 } else { 1.0 }
}

/// offline.ts:267 `pickDailyRewardByDay`: DailyRewardsRules.getRewardByDay (DailyRewardsRules.java:46-65); the groups map is
/// identity 1..5 (original config row). Calls `random` exactly once, like the TS.
pub fn pick_daily_reward_by_day(day: f64, random: &mut dyn FnMut() -> f64) -> Option<String> {
    let d = (day - 1.0) % 5.0; // Java remainder keeps the sign, as does JS
    let group = if d > 0.0 && d < 5.0 { d + 1.0 } else { 1.0 };
    let defs: Vec<&Attrs> = rules()
        .daily_rewards
        .iter()
        .filter(|def| attr_number(def, "group") == group && def.get("date").map_or(true, |v| v.is_empty()))
        .collect();
    let max_prob: f64 = defs.iter().fold(0.0, |sum, def| sum + attr_number(def, "chances"));
    let roll = (max_prob * random()).trunc();
    let mut acc = 0.0;
    for def in defs {
        let chances = attr_number(def, "chances");
        if roll >= acc && roll < acc + chances {
            return def.get("sku").cloned();
        }
        acc += chances;
    }
    None
}

/// offline.ts:294 return type of `refreshDailyRewardsInfo`.
#[derive(Debug, Clone, PartialEq)]
pub struct DailyRewardsRefresh {
    pub changed: bool,
    pub reset: bool,
    pub answer_count: Option<String>,
}

/// offline.ts:295 `refreshDailyRewardsInfo`: get_daily_rewards_info (GamePlay.java:925-953). A reward is due once more than
/// smDailyRewardTime has passed since the stored last-given date. > 2x that => streak reset (stored count 0, history
/// cleared, answer count 1); otherwise the answer carries count + 1. Like the original (saved only on reset,
/// GamePlay.java:950), the advanced count is NOT stored here: the claim stores it (`apply_daily_reward_given`). A new
/// nextRewardId is rolled for the answered count.
pub fn refresh_daily_rewards_info(doc: &mut Value, now_ms: i64, random: &mut dyn FnMut() -> f64) -> DailyRewardsRefresh {
    let mut changed = false;
    let mut reset = false;
    let mut answer_count = None;
    let last_date = or_zero(num_or(doc, "dailyRewardsLastGivenDate", "0"));
    let diff = now_ms as f64 - last_date;
    if diff > DAILY_REWARD_TIME_MS {
        let mut count = 0.0;
        if diff > 2.0 * DAILY_REWARD_TIME_MS {
            set_str(doc, "dailyRewardsCount", "0".to_string());
            set_str(doc, "dailyRewardsLastGiven", String::new());
            reset = true;
            answer_count = Some("1".to_string()); // GamePlay.java:953
        } else {
            count = or_zero(num_or(doc, "dailyRewardsCount", "0")) + 1.0;
            answer_count = Some(js_number_to_string(count)); // GamePlay.java:934-935
        }
        set_str(doc, "dailyRewardsNextRewardId", pick_daily_reward_by_day(count, random).unwrap_or_default());
        changed = true;
    }
    DailyRewardsRefresh { changed, reset, answer_count }
}

/// offline.ts:329 `dailyRewardClaimAllowed`: the update_daily_reward gate, ported from the original's two checks:
/// - GamePlay.java:1807-1810 / SecurityNormal.java:641: no reward due (stored date not older than smDailyRewardTime) =>
///   refused. The original keeps this as an in-session flag set by get_daily_rewards_info; the stored date is the persisted
///   equivalent.
/// - SecurityNormal.java:645-655: the claimed day is count + 1 (GamePlay.java:1808); a 2x-overdue claim is day 1 (state 2).
///   The sku must belong to that day's group (DailyRewardsRules.getGroupByDay), else refused.
pub fn daily_reward_claim_allowed(doc: &Value, sku: &str, now_ms: i64) -> bool {
    let diff = now_ms as f64 - or_zero(num_or(doc, "dailyRewardsLastGivenDate", "0"));
    if !(diff > DAILY_REWARD_TIME_MS) {
        return false;
    }
    let days = if diff > 2.0 * DAILY_REWARD_TIME_MS { 1.0 } else { or_zero(num_or(doc, "dailyRewardsCount", "0")) + 1.0 };
    match get_daily_reward_definition(sku) {
        Some(def) => def.group == get_daily_reward_group_by_day(days),
        None => false,
    }
}

/// `date.setHours(0, 10, 0, 0)` in the process-local time zone, as Node does it: the instant of local 00:10 on the local
/// calendar day of `now_ms`. An ambiguous time (DST fold) takes the earlier instant; a skipped time (DST gap) is read with
/// the offset in force before the gap, like the ECMAScript spec.
fn local_midnight_plus_10_ms(now_ms: i64) -> i64 {
    let dt = match Local.timestamp_millis_opt(now_ms) {
        chrono::LocalResult::Single(d) => d,
        chrono::LocalResult::Ambiguous(a, _) => a,
        chrono::LocalResult::None => return now_ms,
    };
    let date: NaiveDate = dt.date_naive();
    let naive = date.and_hms_opt(0, 10, 0).expect("valid time");
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(d) => d.timestamp_millis(),
        chrono::LocalResult::Ambiguous(a, _) => a.timestamp_millis(),
        chrono::LocalResult::None => {
            // Gap: use the offset before the transition (the offset of the previous day's instant).
            let before = Local.from_utc_datetime(&(naive - chrono::Duration::days(1))).offset().fix().local_minus_utc();
            (naive.and_utc().timestamp() - before as i64) * 1000
        }
    }
}

/// offline.ts:340 `applyDailyRewardGiven`: update_daily_reward when the claim passes: count + 1, last-given date = local
/// 00:10 of today, history keeps the last 5 skus (GamePlay.java:1813-1821).
pub fn apply_daily_reward_given(doc: &mut Value, sku: &str, now_ms: i64) {
    set_str(doc, "dailyRewardsLastGivenDate", js_number_to_string(local_midnight_plus_10_ms(now_ms) as f64));
    let mut given = format!("{}{sku},", str_attr(doc, "dailyRewardsLastGiven"));
    if given.split(',').count() > 6 {
        let idx = given.find(',').map_or(0, |i| i + 1);
        given = given[idx..].to_string();
    }
    set_str(doc, "dailyRewardsLastGiven", given);
    let count = or_zero(num_or(doc, "dailyRewardsCount", "0")) + 1.0;
    set_str(doc, "dailyRewardsCount", js_number_to_string(count));
}

// ---- investments (GamePlay.java:610-695, 1135-1284; InvestDefinitions) ---------------------------------------------

/// offline.ts:354 `INVEST`.
#[derive(Debug, Clone, PartialEq)]
pub struct Invest {
    pub time_ms: f64,
    pub target: f64,
    pub inversion: f64,
    pub reward_coins: f64,
    pub reward_cash: f64,
}

/// offline.ts:354 `INVEST`.
pub fn invest() -> &'static Invest {
    static I: OnceLock<Invest> = OnceLock::new();
    I.get_or_init(|| {
        let d = &rules().invest_definition;
        Invest {
            time_ms: or_else(attr_number(d, "time"), 20.0) * 86_400_000.0,
            target: or_else(attr_number(d, "target"), 4_000_000.0),
            inversion: or_zero(attr_number(d, "inversion")),
            reward_coins: or_zero(attr_number(d, "rewardDCCoins")),
            reward_cash: or_zero(attr_number(d, "rewardDCCash")),
        }
    })
}

/// Offline NPC friends are rich enough to always reach the target (inferred; the original reads the real friend).
pub const OFFLINE_FRIEND_COMPANY_VALUE: f64 = 100_000_000.0;

/// offline.ts:365 `findInvestment`.
pub fn find_investment<'a>(doc: &'a mut Value, ext_id: &str) -> Option<&'a mut Value> {
    get_element_children(doc, "investmentsList")
        .iter_mut()
        .find(|e| e.get("investment").map_or(false, Value::is_array) && str_attr(e, "extId") == ext_id)
}

/// offline.ts:372 `refreshInvestments`: advance state 2 -> 3 when the investment time has elapsed
/// (getInvestmentsList :640-668) and refresh time/value.
pub fn refresh_investments(doc: &mut Value, now_ms: i64) -> bool {
    let now = now_ms as f64;
    let inv = invest();
    let mut changed = false;
    for entry in get_element_children(doc, "investmentsList").iter_mut() {
        if !entry.get("investment").map_or(false, Value::is_array) {
            continue;
        }
        let state = num_or(entry, "state", "1");
        if state == 2.0 {
            let started = match entry.get("startedAt") {
                None | Some(Value::Null) => now,
                Some(v) => or_else(js_number(Some(v)), now),
            };
            let remaining = inv.time_ms - (now - started);
            let value = num_or(entry, "value", "0");
            if remaining > 0.0 && value < inv.target {
                set_str(entry, "time", js_number_to_string(remaining.trunc()));
            } else {
                // The original samples the friend's company value now (GamePlay.java:652-668); offline friends are rich NPCs.
                set_str(entry, "state", "3".to_string());
                set_str(entry, "time", "0".to_string());
                set_str(entry, "value", js_number_to_string(js_max(value, OFFLINE_FRIEND_COMPANY_VALUE)));
                changed = true;
            }
        } else if state == 3.0 && entry.get("time") != Some(&Value::String("0".to_string())) {
            set_str(entry, "time", "0".to_string());
            changed = true;
        }
    }
    changed
}

// ---- missions (GamePlay.updateMissions :1346-1389, SecurityNormal.updateMissions :535-545) -------------------------

/// offline.ts:402 `MissionReward`.
#[derive(Debug, Clone, PartialEq)]
pub struct MissionReward {
    pub coins: f64,
    pub cash: f64,
    pub exp: f64,
    pub items: Vec<(String, f64)>,
}

/// offline.ts:409 `getMissionReward`: rewards of missionDefinitions.xml `rewardType`/`rewardAmount` ("coins;exp" / item sku),
/// as parsed by the client (MissionDefinition.parseRewards). The original only knew coins/cash (MissionDefinitions.java:30-33);
/// exp and item rewards are the 0.501 data. `None` = unknown sku (the original NPEs, i.e. SecurityFail). TS default `group = 0`.
pub fn get_mission_reward(sku: &str, group: f64) -> Option<MissionReward> {
    let def = rules().missions.get(sku)?;
    let mut out = MissionReward { coins: 0.0, cash: 0.0, exp: 0.0, items: Vec::new() };
    let suffix = if group == 1.0 || group == 2.0 { js_number_to_string(group) } else { String::new() };
    let truthy = |k: &str| def.get(k).filter(|v| !v.is_empty());
    let reward_type = if !suffix.is_empty() { truthy(&format!("rewardTypeABtest{suffix}")).or_else(|| def.get("rewardType")) } else { def.get("rewardType") };
    let reward_amount =
        if !suffix.is_empty() { truthy(&format!("rewardAmountABtest{suffix}")).or_else(|| def.get("rewardAmount")) } else { def.get("rewardAmount") };
    let types = reward_type.map_or("", String::as_str).split(';').filter(|t| !t.is_empty()).collect::<Vec<_>>();
    let amounts: Vec<&str> = reward_amount.map_or("", String::as_str).split(';').collect();
    for (i, ty) in types.iter().enumerate() {
        let n = or_zero(js_string_to_number(amounts.get(i).copied().unwrap_or("0")).trunc());
        match *ty {
            "coins" => out.coins += n,
            "cash" => out.cash += n,
            "exp" => out.exp += n,
            other => out.items.push((other.to_string(), n)),
        }
    }
    Some(out)
}

/// offline.ts:431 `stepMission`: one step of the chunk machine (GamePlay.java:1346-1370): given stays, reached->given
/// (rewarded), up->reached, else ->up. Returns `rewarded`.
pub fn step_mission(up: &mut BTreeSet<String>, reached: &mut BTreeSet<String>, given: &mut BTreeSet<String>, sku: &str) -> bool {
    if given.contains(sku) {
        return false;
    }
    if reached.remove(sku) {
        given.insert(sku.to_string());
        return true;
    }
    if up.remove(sku) {
        reached.insert(sku.to_string());
        return false;
    }
    up.insert(sku.to_string());
    false
}
