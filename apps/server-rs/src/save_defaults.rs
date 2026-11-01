//! Port of `apps/server/src/saveDefaults.ts` and `saveDefaults/*.ts` (fixed save data, NPC universes, timer and tutorial
//! normalisation). Pure data is embedded from `apps/server-rs/data/*.json` (exported by `scripts/exportDefaults.ts`); the
//! logic is ported by hand.
#![allow(dead_code)]

use crate::commands::universe::{is_item_element, non_null};
use crate::rules::{load_level_xp_thresholds, parse_xml_attributes};
use crate::save_tree::{
    create_element, find_element_child, get_element_children, get_or_create_element_child, leaf_element, parse_chunk_set,
    upsert_chunk_element,
};
use crate::util::{js_number, js_number_to_string, js_string_to_number};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::OnceLock;

// ---- saveDefaults/constants.ts ----------------------------------------------------------------------------------------

pub const DEFAULT_CITY_NAME: &str = "Chocolate Fields";
pub const DEFAULT_CITY_NAME_CODES: &str = "67,104,111,99,111,108,97,116,101,32,70,105,101,108,100,115";
pub const DEFAULT_ABANDON_MINUTES: f64 = 60.0;
pub const DEFAULT_ABANDON_TIME_PERCENTAGE: f64 = 100.0;
pub const STARTER_WORLD_SID: &str = "1";
pub const STARTER_COMPANY_MINE_SID: &str = "1";
pub const STARTER_COMPANY_RIVAL_SID: &str = "2";
pub const STARTER_COIN_BALANCE: i64 = 380_000;
pub const STARTER_COMPANY_VALUE: i64 = 720_000;
pub const NPC_PRIMARY_USER_ID: f64 = 100.0;
pub const NPC_SHEIK_USER_ID: f64 = 101.0;
const DEFAULT_ADVISOR_IDS: &str = "100,101";
const DEFAULT_LANG: &str = "en_US";

const CONSTANTS_JSON: &str = include_str!("../data/constants.json");
const STARTER_JSON: &str = include_str!("../data/starter.json");
const RONALD_JSON: &str = include_str!("../data/ronaldLayout.json");
const SHEIK_JSON: &str = include_str!("../data/sheikLayout.json");

fn constants() -> &'static Value {
    static C: OnceLock<Value> = OnceLock::new();
    C.get_or_init(|| serde_json::from_str(CONSTANTS_JSON).expect("data/constants.json"))
}

fn const_str(name: &str, key: &str) -> String {
    constants()[name][key].as_str().unwrap_or("").to_string()
}

fn const_strings(name: &str) -> Vec<String> {
    constants()[name].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

// ---- JS helpers -------------------------------------------------------------------------------------------------------

/// `String(entry[key] ?? "")`
fn sv(node: &Value, key: &str) -> String {
    match non_null(node.get(key)) {
        Some(v) => crate::util::js_string(v),
        None => String::new(),
    }
}

/// `String(node[key] ?? default)`
fn sv_or(node: &Value, key: &str, default: &str) -> String {
    match non_null(node.get(key)) {
        Some(v) => crate::util::js_string(v),
        None => default.to_string(),
    }
}

fn set_s(node: &mut Value, key: &str, value: impl Into<String>) {
    node.as_object_mut().expect("node must be an object").insert(key.to_string(), Value::String(value.into()));
}

/// `Math.round` for the values used here.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn num_str(n: f64) -> String {
    js_number_to_string(n)
}

fn clone_vec(v: &mut Vec<Value>) -> Vec<Value> {
    std::mem::take(v)
}

// ---- saveDefaults/geometry.ts ------------------------------------------------------------------------------------------

/// geometry.ts:1 `createRectChunk`
pub fn create_rect_chunk(start_x: i64, start_y: i64, width: i64, height: i64) -> Vec<String> {
    let mut tiles = Vec::new();
    for y in start_y..start_y + height {
        for x in start_x..start_x + width {
            tiles.push(format!("{x}:{y}"));
        }
    }
    tiles
}

/// geometry.ts:11 `createHorizontalChunk`
pub fn create_horizontal_chunk(start_x: i64, end_x: i64, y: i64) -> Vec<String> {
    (start_x..=end_x).map(|x| format!("{x}:{y}")).collect()
}

/// geometry.ts:19 `createVerticalChunk`
pub fn create_vertical_chunk(x: i64, start_y: i64, end_y: i64) -> Vec<String> {
    (start_y..=end_y).map(|y| format!("{x}:{y}")).collect()
}

// ---- saveDefaults/items.ts ---------------------------------------------------------------------------------------------

/// items.ts:6 `createCompanyElement`
pub fn create_company_element(attributes: &[(&str, &str)], children: Vec<Value>) -> Value {
    create_element("Company", attributes, children)
}

/// items.ts:10 `createRivalSaleItem`
pub fn create_rival_sale_item(sid: &str, sku: &str, x: &str, y: &str) -> Value {
    create_element(
        "Item",
        &[("sid", sid), ("csid", STARTER_COMPANY_RIVAL_SID), ("sku", sku), ("x", x), ("y", y), ("isSuspended", "0")],
        vec![leaf_element("State", &[("id", "3"), ("mode", "2"), ("time", "0")])],
    )
}

/// items.ts:26 `createBuiltItem`
pub fn create_built_item(sid: &str, csid: &str, sku: &str, x: &str, y: &str) -> Value {
    create_element(
        "Item",
        &[("sid", sid), ("csid", csid), ("sku", sku), ("x", x), ("y", y), ("isSuspended", "0")],
        vec![leaf_element("State", &[("id", "5")])],
    )
}

/// items.ts:41 `createWaitingContractHouseItem`
pub fn create_waiting_contract_house_item(sid: &str, csid: &str, sku: &str, x: &str, y: &str) -> Value {
    create_element(
        "Item",
        &[("sid", sid), ("csid", csid), ("sku", sku), ("x", x), ("y", y), ("isSuspended", "0")],
        vec![leaf_element("State", &[("id", "1"), ("mode", "1"), ("time", "0")])],
    )
}

/// items.ts:56 `createRentingIncomeItem` (defaults `contractSku = "1"`, `time = "1800000"`).
pub fn create_renting_income_item(
    sid: &str,
    csid: &str,
    sku: &str,
    x: &str,
    y: &str,
    contract_sku: &str,
    time: &str,
) -> Value {
    create_element(
        "Item",
        &[("sid", sid), ("csid", csid), ("sku", sku), ("x", x), ("y", y), ("isSuspended", "0")],
        vec![leaf_element("State", &[("id", "1"), ("mode", "4"), ("time", time), ("contractSku", contract_sku)])],
    )
}

/// items.ts:76 `createHeadQuarterItem`
pub fn create_head_quarter_item(sid: &str, csid: &str, x: &str, y: &str, current_sku: &str) -> Value {
    create_element(
        "Item",
        &[("sid", sid), ("csid", csid), ("sku", "HeadQuarter"), ("x", x), ("y", y), ("isSuspended", "0")],
        vec![leaf_element("State", &[("id", "4")]), create_head_quarter_decorations(current_sku)],
    )
}

/// items.ts:96 `createHeadQuarterDecorations`
pub fn create_head_quarter_decorations(current_sku: &str) -> Value {
    let shadow = if current_sku == "HeadQuarter_01" { "0" } else { "1" };
    create_element(
        "Decorations",
        &[],
        vec![create_element(
            "Decoration",
            &[("type", "0"), ("currentSku", current_sku), ("shadowRows", shadow)],
            ["HeadQuarter_01", "HeadQuarter_02", "HeadQuarter_03", "HeadQuarter_04"]
                .iter()
                .map(|s| leaf_element("sku", &[("id", s)]))
                .collect(),
        )],
    )
}

/// items.ts:107 `isHouseSku`
pub fn is_house_sku(sku: &str) -> bool {
    sku.starts_with("houses_")
}

/// items.ts:111 `getNextItemSid`: max numeric `sid` over the items, plus one.
pub fn get_next_item_sid(items: &[Value]) -> f64 {
    let mut max_sid = 0.0;
    for item in items {
        let sid = js_string_to_number(&match non_null(item.get("sid")) {
            Some(v) => crate::util::js_string(v),
            None => "0".to_string(),
        });
        if sid.is_finite() && sid > max_sid {
            max_sid = sid;
        }
    }
    max_sid + 1.0
}

// ---- saveDefaults/starterDecorations.ts + starter.ts -------------------------------------------------------------------

/// starter.ts:60 `createFreshSaveBundle(userExtId)`: `(tag, document)` pairs in `Object.entries` order:
/// universe, crmpopups, friendList, neighborList, helpList, upgradesList, unlockedList, limEdList, storageList,
/// collectiblesList, collectiblePendingList, dailyBonusInfo, partnersList, welcome, investmentsList, gameConfig, fan.
/// The bundle (incl. the starter decoration table of starterDecorations.ts, terrain/road chunks, the rival sale items and the
/// empty collectible documents) is the TS output for the default ext id, embedded from `data/starter.json`; only the profile
/// `extId` (the sole argument-dependent value, starter.ts:130) is substituted.
pub fn create_fresh_save_bundle(user_ext_id: &str) -> Result<Vec<(String, Value)>, String> {
    let parsed: Value = serde_json::from_str(STARTER_JSON).map_err(|e| format!("data/starter.json: {e}"))?;
    let Value::Object(mut root) = parsed else { return Err("data/starter.json: not an object".into()) };
    let Some(Value::Object(bundle)) = root.remove("createFreshSaveBundle") else {
        return Err("data/starter.json: missing createFreshSaveBundle".into());
    };
    let mut out: Vec<(String, Value)> = bundle.into_iter().collect();
    for (tag, doc) in out.iter_mut() {
        if tag == "universe" {
            let profile = doc
                .get_mut("universe")
                .and_then(Value::as_array_mut)
                .and_then(|a| a.iter_mut().find(|e| e.get("Profile").map_or(false, Value::is_array)))
                .ok_or("starter universe has no Profile")?;
            set_s(profile, "extId", user_ext_id);
        }
    }
    Ok(out)
}

// ---- saveDefaults/neighbors.ts -----------------------------------------------------------------------------------------

/// neighbors.ts:34 `createNeighborUniverse`
pub fn create_neighbor_universe(target_user_id: f64, boss_genre: f64) -> Option<Value> {
    if target_user_id == NPC_PRIMARY_USER_ID {
        return Some(create_advisor_neighbor_universe(boss_genre));
    }
    if target_user_id == NPC_SHEIK_USER_ID {
        return Some(create_sheik_neighbor_universe());
    }
    None
}

/// neighbors.ts:51 `createVisitorNeighborUniverse`: offline stand-in for a real player's city (GamePlay.getWorld with
/// another targetUserId, GamePlay.java:120-230): an empty tutorial-finished town with the HQ only.
pub fn create_visitor_neighbor_universe(target_user_id: f64) -> Value {
    let id = num_str(target_user_id);
    create_npc_universe_document(NpcOptions {
        user_id: id.clone(),
        ext_id: format!("visitor-{id}"),
        user_name: "Neighbor".into(),
        city_name: "Neighbor City".into(),
        company_value: "1000000".into(),
        plane_sku: None,
        plots_type: None,
        terrain_tiles: Vec::new(),
        road_tiles: Vec::new(),
        items: vec![create_head_quarter_item("1", STARTER_COMPANY_MINE_SID, "-1", "-3", "HeadQuarter_01")],
    })
}

fn layout() -> &'static (Value, Value) {
    static L: OnceLock<(Value, Value)> = OnceLock::new();
    L.get_or_init(|| {
        (
            serde_json::from_str(RONALD_JSON).expect("data/ronaldLayout.json"),
            serde_json::from_str(SHEIK_JSON).expect("data/sheikLayout.json"),
        )
    })
}

/// neighbors.ts:68 `createAdvisorNeighborUniverse`
fn create_advisor_neighbor_universe(boss_genre: f64) -> Value {
    let is_cindy = boss_genre == 1.0;
    let ronald = &layout().0;
    let hq_skin = if is_cindy { "HeadQuarter_03" } else { "HeadQuarter_02" };
    create_npc_universe_document(NpcOptions {
        user_id: num_str(NPC_PRIMARY_USER_ID),
        ext_id: if is_cindy { "npc-cindy" } else { "npc-ronald" }.into(),
        user_name: if is_cindy { "Cindy" } else { "Ronald" }.into(),
        city_name: "Chocolate Fields".into(),
        company_value: if is_cindy { "115000000" } else { "100000000" }.into(),
        plane_sku: Some("plane_03".into()),
        plots_type: Some(ronald["RONALD_PLOTS_TYPE"].as_str().unwrap_or("").to_string()),
        terrain_tiles: expand_tile_ranges(&ronald["RONALD_TERRAIN_RANGES"]),
        road_tiles: expand_tile_ranges(&ronald["RONALD_ROAD_RANGES"]),
        items: ronald["RONALD_LAYOUT_ITEMS"]
            .as_array()
            .map(|a| a.iter().map(|it| create_captured_layout_item(it, hq_skin)).collect())
            .unwrap_or_default(),
    })
}

/// neighbors.ts:87 `createSheikNeighborUniverse`
fn create_sheik_neighbor_universe() -> Value {
    let sheik = &layout().1;
    create_npc_universe_document(NpcOptions {
        user_id: num_str(NPC_SHEIK_USER_ID),
        ext_id: "npc-sheik".into(),
        user_name: "Sheik".into(),
        city_name: "Sheik's City".into(),
        company_value: "900000000".into(),
        plane_sku: Some("plane_04".into()),
        plots_type: Some(sheik["SHEIK_PLOTS_TYPE"].as_str().unwrap_or("").to_string()),
        terrain_tiles: expand_tile_ranges(&sheik["SHEIK_TERRAIN_RANGES"]),
        road_tiles: expand_tile_ranges(&sheik["SHEIK_ROAD_RANGES"]),
        items: sheik["SHEIK_LAYOUT_ITEMS"]
            .as_array()
            .map(|a| a.iter().map(|it| create_captured_layout_item(it, "HeadQuarter_04")).collect())
            .unwrap_or_default(),
    })
}

/// neighbors.ts:103 `createCapturedLayoutItem`: `[sid, sku, x, y, type, state, savedAt?]`.
fn create_captured_layout_item(layout_item: &Value, hq_skin: &str) -> Value {
    let f = |i: usize| layout_item.get(i).and_then(Value::as_str).unwrap_or("");
    let (sid, sku, x, y, ty, state, saved_at) = (f(0), f(1), f(2), f(3), f(4), f(5), f(6));
    if state == "hq" {
        return create_head_quarter_item(sid, STARTER_COMPANY_MINE_SID, x, y, hq_skin);
    }
    let mut attributes: Vec<(&str, &str)> =
        vec![("sid", sid), ("csid", STARTER_COMPANY_MINE_SID), ("sku", sku), ("x", x), ("y", y), ("isSuspended", "0")];
    if !ty.is_empty() {
        attributes.push(("type", ty));
    }
    let state_attrs: Vec<(&str, &str)> = match state {
        "built" => vec![("id", "5")],
        "waiting" => vec![("id", "1"), ("mode", "1"), ("time", "0")],
        _ => {
            let mut s = vec![("id", "1"), ("mode", "4"), ("time", "180000")];
            if !saved_at.is_empty() {
                s.push(("savedAt", saved_at));
            }
            s
        }
    };
    create_element("Item", &attributes, vec![leaf_element("State", &state_attrs)])
}

/// neighbors.ts:131 `expandTileRanges`: `[y, startX, endX]` rows.
fn expand_tile_ranges(ranges: &Value) -> Vec<String> {
    let mut tiles = Vec::new();
    for row in ranges.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let n = |i: usize| row.get(i).and_then(Value::as_i64).unwrap_or(0);
        let (y, start_x, end_x) = (n(0), n(1), n(2));
        for x in start_x..=end_x {
            tiles.push(format!("{x}:{y}"));
        }
    }
    tiles
}

struct NpcOptions {
    user_id: String,
    ext_id: String,
    user_name: String,
    city_name: String,
    company_value: String,
    plane_sku: Option<String>,
    plots_type: Option<String>,
    terrain_tiles: Vec<String>,
    road_tiles: Vec<String>,
    items: Vec<Value>,
}

/// `Array.from(new Set(tiles)).join(",")`
fn dedupe_join(tiles: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    tiles.iter().filter(|t| seen.insert(t.as_str())).cloned().collect::<Vec<_>>().join(",")
}

/// neighbors.ts:151 `createNpcUniverseDocument`
fn create_npc_universe_document(o: NpcOptions) -> Value {
    let ascii_codes = o.city_name.encode_utf16().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
    let profile = json!({
        "Profile": [
            {"Missions": []},
            {"PollManager": []},
            leaf_element("Plots", &[("type", o.plots_type.as_deref().unwrap_or(""))]),
        ],
        "exp": "135629",
        "DCCoins": o.company_value,
        "DCCash": "0",
        "DCCashPaid": "0",
        "cityname": o.city_name,
        "cityNameCodes": ascii_codes,
        "tutorialEnd": "1",
        "companyValue": o.company_value,
        "ranking": "1",
        "firstInvest": "0",
        "firstVisit": "0",
        "firstPartner": "0",
        "firstMission": "0",
        "newToolRev": "0",
        "checkmail": "0",
        "fourMillions": "1",
        "planeSku": o.plane_sku.as_deref().unwrap_or("plain"),
        "flags": "",
        "investmentInMeTimeLeft": "-1",
        "investmentInMeUserId": "-1",
        "investmentInMeExtId": "-1",
        "userName": o.user_name,
        "profileId": o.user_id,
        "extId": o.ext_id,
        "advisorId": DEFAULT_ADVISOR_IDS,
        "lang": DEFAULT_LANG,
    });
    let mine = create_company_element(
        &[
            ("sid", STARTER_COMPANY_MINE_SID),
            ("wsid", STARTER_WORLD_SID),
            ("whose", "0"),
            ("HQLevel", "3"),
            ("exp", "0"),
            ("DCCoins", &o.company_value),
            ("workers", "12"),
        ],
        o.items,
    );
    let rival = create_company_element(
        &[
            ("sid", STARTER_COMPANY_RIVAL_SID),
            ("wsid", STARTER_WORLD_SID),
            ("whose", "1"),
            ("HQLevel", "0"),
            ("exp", "0"),
            ("DCCoins", "0"),
            ("workers", "0"),
        ],
        Vec::new(),
    );
    let map = json!({
        "Map": [
            create_element("Terrain", &[("chunk", &dedupe_join(&o.terrain_tiles))], Vec::new()),
            create_element("Road", &[("chunk", &dedupe_join(&o.road_tiles))], Vec::new()),
        ],
        "sid": STARTER_WORLD_SID,
        "wsid": STARTER_WORLD_SID,
    });
    json!({"universe": [profile, {"World": [mine, rival, map], "sid": STARTER_WORLD_SID}]})
}

// ---- saveDefaults/timers.ts --------------------------------------------------------------------------------------------

struct TimerRules {
    contract_income_time_by_sku: HashMap<String, f64>,
    abandon_min_time_ms: f64,
    abandon_time_percentage: f64,
}

fn timer_rules() -> &'static TimerRules {
    static R: OnceLock<TimerRules> = OnceLock::new();
    R.get_or_init(|| {
        let root = crate::commands::offline_lib::rules_root();
        let (min_time_ms, pct) = load_abandon_timing_settings(&root.join("settings.xml"));
        TimerRules {
            contract_income_time_by_sku: load_contract_income_time_by_sku(&root.join("contracts.xml")),
            abandon_min_time_ms: min_time_ms,
            abandon_time_percentage: pct,
        }
    })
}

/// timers.ts:262 `loadContractIncomeTimeBySku`
fn load_contract_income_time_by_sku(path: &std::path::Path) -> HashMap<String, f64> {
    let mut durations = HashMap::new();
    let Ok(xml) = std::fs::read_to_string(path) else { return durations };
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r#"<Definition\s+sku="([^"]+)"[^>]*incomeTime="([^"]+)""#).unwrap());
    for m in re.captures_iter(&xml) {
        let sku = m[1].trim().to_string();
        let hours = js_string_to_number(&m[2]);
        if sku.is_empty() || !hours.is_finite() || hours <= 0.0 {
            continue;
        }
        durations.insert(sku, js_round(hours * 60.0 * 60.0 * 1000.0));
    }
    durations
}

/// timers.ts:240 `loadAbandonTimingSettings`: `(minTimeMs, percentage)`.
fn load_abandon_timing_settings(path: &std::path::Path) -> (f64, f64) {
    let Ok(xml) = std::fs::read_to_string(path) else {
        return (DEFAULT_ABANDON_MINUTES * 60.0 * 1000.0, DEFAULT_ABANDON_TIME_PERCENTAGE);
    };
    static A: OnceLock<Regex> = OnceLock::new();
    static B: OnceLock<Regex> = OnceLock::new();
    let a = A.get_or_init(|| Regex::new(r#"abandonMinTime="([^"]+)""#).unwrap());
    let b = B.get_or_init(|| Regex::new(r#"abandonTimePercentage="([^"]+)""#).unwrap());
    let minutes = a.captures(&xml).map_or(DEFAULT_ABANDON_MINUTES, |c| js_string_to_number(&c[1]));
    let pct = b.captures(&xml).map_or(DEFAULT_ABANDON_TIME_PERCENTAGE, |c| js_string_to_number(&c[1]));
    (
        if minutes.is_finite() && minutes > 0.0 { js_round(minutes * 60.0 * 1000.0) } else { DEFAULT_ABANDON_MINUTES * 60.0 * 1000.0 },
        if pct.is_finite() && pct >= 0.0 { pct } else { DEFAULT_ABANDON_TIME_PERCENTAGE },
    )
}

/// timers.ts:228 `getContractIncomeTimeMs`
pub fn get_contract_income_time_ms(contract_sku: &str) -> f64 {
    timer_rules().contract_income_time_by_sku.get(contract_sku).copied().unwrap_or(0.0)
}

/// timers.ts:232 `getAbandonTimeMs`
fn get_abandon_time_ms(contract_sku: &str, fallback_time_ms: f64) -> f64 {
    let r = timer_rules();
    let income = r.contract_income_time_by_sku.get(contract_sku).copied().unwrap_or(0.0);
    // Math.max(0, fallbackTimeMs) (timers.ts:236): NaN propagates like JS, so a non-numeric time stays NaN.
    let base = if income > 0.0 { income } else if fallback_time_ms.is_nan() { f64::NAN } else { fallback_time_ms.max(0.0) };
    let calculated = js_round(base * r.abandon_time_percentage / 100.0);
    // Math.max(calculatedMs, ABANDON_MIN_TIME_MS) (NaN propagates like JS)
    if calculated.is_nan() || r.abandon_min_time_ms.is_nan() { f64::NAN } else { calculated.max(r.abandon_min_time_ms) }
}

const STALE_KEYS: [&str; 5] = ["contractSku", "contractGroupSku", "savedAt", "accelerated", "doubleRent"];

/// `Number(state[key] ?? "0")`
fn num_or0(state: &Value, key: &str) -> f64 {
    match non_null(state.get(key)) {
        Some(v) => js_number(Some(v)),
        None => 0.0,
    }
}

/// timers.ts:19 `normalizeHouseRentState(state, itemChildren, nowMs)`. The TS receives the already-found `State` child;
/// every call site passes `findElementChild(itemChildren, "State")`, so it is looked up here.
pub fn normalize_house_rent_state(item_children: &mut Vec<Value>, now_ms: f64) -> bool {
    let Some(idx) = find_element_child(item_children, "State") else {
        item_children.insert(0, leaf_element("State", &[("id", "1"), ("mode", "1"), ("time", "0")]));
        return true;
    };
    let state = &mut item_children[idx];
    let mut changed = false;
    if sv(state, "id") != "1" {
        set_s(state, "id", "1");
        changed = true;
    }

    if sv(state, "mode") == "1" {
        if sv(state, "time") != "0" {
            set_s(state, "time", "0");
            changed = true;
        }
        for k in STALE_KEYS {
            if state.as_object_mut().unwrap().shift_remove(k).is_some() {
                changed = true;
            }
        }
        return changed;
    }

    // Mode 6 = GIVING_RENT (SecurityNormal.ST_RENT_MODE_GIVING_RENT, StateOnRent.as:806-816); GamePlay.updateItem stores
    // mode/time verbatim (GamePlay.java:2465-2470).
    if sv(state, "mode") == "6" {
        return changed;
    }

    let contract_sku = sv(state, "contractSku").trim().to_string();
    if !contract_sku.is_empty() {
        let mut normalized_mode = sv(state, "mode");
        if normalized_mode == "14" || normalized_mode == "15" {
            set_s(state, "mode", "1");
            set_s(state, "time", "0");
            for k in STALE_KEYS {
                state.as_object_mut().unwrap().shift_remove(k);
            }
            return true;
        }
        let abandon_duration_ms = get_abandon_time_ms(&contract_sku, num_or0(state, "time"));
        if !matches!(normalized_mode.as_str(), "4" | "5" | "6" | "14" | "15" | "7") {
            set_s(state, "mode", "4");
            normalized_mode = "4".into();
            changed = true;
        }
        let time_missing = match state.get("time") {
            None | Some(Value::Null) => true,
            Some(v) => crate::util::js_string(v).is_empty(),
        };
        if time_missing {
            set_s(state, "time", "0");
            changed = true;
        }
        let current_time = num_or0(state, "time");
        let saved_at = num_or0(state, "savedAt");
        let now_s = num_str(now_ms);
        if normalized_mode == "4" && current_time.is_finite() && current_time > 0.0 {
            if saved_at.is_finite() && saved_at > 0.0 {
                let elapsed = (now_ms - saved_at).max(0.0);
                if elapsed >= current_time {
                    let overdue_elapsed = elapsed - current_time;
                    if overdue_elapsed >= abandon_duration_ms {
                        if sv(state, "mode") != "7" {
                            set_s(state, "mode", "7");
                            changed = true;
                        }
                        if sv(state, "time") != "0" {
                            set_s(state, "time", "0");
                            changed = true;
                        }
                    } else {
                        let remaining = (abandon_duration_ms - overdue_elapsed).max(0.0);
                        if sv(state, "mode") != "5" {
                            set_s(state, "mode", "5");
                            changed = true;
                        }
                        if sv(state, "time") != num_str(remaining) {
                            set_s(state, "time", num_str(remaining));
                            changed = true;
                        }
                        if sv(state, "savedAt") != now_s {
                            set_s(state, "savedAt", now_s.clone());
                            changed = true;
                        }
                    }
                } else {
                    let next_time = current_time - elapsed;
                    if sv(state, "time") != num_str(next_time) {
                        set_s(state, "time", num_str(next_time));
                        changed = true;
                    }
                    if sv(state, "savedAt") != now_s {
                        set_s(state, "savedAt", now_s.clone());
                        changed = true;
                    }
                }
            } else {
                set_s(state, "savedAt", now_s.clone());
                changed = true;
            }
        } else if normalized_mode == "5" || normalized_mode == "6" {
            if current_time.is_finite() && current_time > 0.0 {
                if saved_at.is_finite() && saved_at > 0.0 {
                    let elapsed = (now_ms - saved_at).max(0.0);
                    let next_time = (current_time - elapsed).max(0.0);
                    if next_time == 0.0 {
                        if sv(state, "mode") != "7" {
                            set_s(state, "mode", "7");
                            changed = true;
                        }
                        if sv(state, "time") != "0" {
                            set_s(state, "time", "0");
                            changed = true;
                        }
                    } else {
                        if normalized_mode == "6" && sv(state, "mode") != "5" {
                            set_s(state, "mode", "5");
                            changed = true;
                        }
                        if sv(state, "time") != num_str(next_time) {
                            set_s(state, "time", num_str(next_time));
                            changed = true;
                        }
                        if sv(state, "savedAt") != now_s {
                            set_s(state, "savedAt", now_s.clone());
                            changed = true;
                        }
                    }
                } else {
                    set_s(state, "savedAt", now_s.clone());
                    changed = true;
                }
            } else {
                if sv(state, "mode") != "5" {
                    set_s(state, "mode", "5");
                    changed = true;
                }
                if sv(state, "time") != num_str(abandon_duration_ms) {
                    set_s(state, "time", num_str(abandon_duration_ms));
                    changed = true;
                }
                if sv(state, "savedAt") != now_s {
                    set_s(state, "savedAt", now_s.clone());
                    changed = true;
                }
            }
        } else if normalized_mode == "7" && sv(state, "time") != "0" {
            set_s(state, "time", "0");
            changed = true;
        }
        return changed;
    }

    if sv(state, "mode") != "1" {
        set_s(state, "mode", "1");
        changed = true;
    }
    if sv(state, "time") != "0" {
        set_s(state, "time", "0");
        changed = true;
    }
    if state.as_object_mut().unwrap().shift_remove("accelerated").is_some() {
        changed = true;
    }
    changed
}

/// timers.ts:178 `normalizeConstructionState`
pub fn normalize_construction_state(_item_sku: &str, state: &mut Value, now_ms: f64) -> bool {
    let current_time = num_or0(state, "time");
    let saved_at = num_or0(state, "savedAt");
    let has_valid_saved_at = saved_at.is_finite() && saved_at > 0.0;
    if !current_time.is_finite() || current_time <= 0.0 {
        if sv(state, "time") != "0" {
            set_s(state, "time", "0");
            return true;
        }
        return false;
    }
    if !has_valid_saved_at {
        set_s(state, "savedAt", num_str(now_ms));
        return true;
    }
    let elapsed = (now_ms - saved_at).max(0.0);
    let next_time = (current_time - elapsed).max(0.0);
    let mut changed = false;
    if next_time != current_time {
        set_s(state, "time", num_str(next_time));
        changed = true;
    }
    if sv(state, "savedAt") != num_str(now_ms) {
        set_s(state, "savedAt", num_str(now_ms));
        changed = true;
    }
    changed
}

// ---- saveDefaults/tutorial.ts ------------------------------------------------------------------------------------------

struct PollMissionRule {
    sku: String,
    unlock_sku: String,
    unlock_level: f64,
    event_sku: String,
    event_amount: f64,
    condition_index: i64,
    show_in_ab_test: bool,
}

/// tutorial.ts:661 `loadPollMissionRules`
fn load_poll_mission_rules(path: &std::path::Path) -> Vec<PollMissionRule> {
    let Ok(xml) = std::fs::read_to_string(path) else { return Vec::new() };
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"<Definition\b([^>]*)/>").unwrap());
    let mut rules = Vec::new();
    let mut condition_index_by_event_sku: HashMap<String, i64> = HashMap::new();
    for m in re.captures_iter(&xml) {
        let a = parse_xml_attributes(&m[1]);
        let get = |k: &str| a.get(k).map(|s| s.trim().to_string()).unwrap_or_default();
        let sku = get("sku");
        let event_type = get("type");
        let event_parameter = get("parameter");
        let event_amount = js_string_to_number(a.get("amount").map_or("0", String::as_str));
        if sku.is_empty() || event_type.is_empty() || !event_amount.is_finite() || event_amount <= 0.0 {
            continue;
        }
        let event_sku = format!("{event_type}{event_parameter}");
        let has_condition = a.get("condition").map_or(false, |c| !c.trim().is_empty());
        let mut condition_index = -1;
        if has_condition {
            condition_index = *condition_index_by_event_sku.get(&event_sku).unwrap_or(&0);
            condition_index_by_event_sku.insert(event_sku.clone(), condition_index + 1);
        }
        rules.push(PollMissionRule {
            sku,
            unlock_sku: get("unlockSku"),
            unlock_level: js_string_to_number(a.get("unlockLevel").map_or("0", String::as_str)),
            event_sku,
            event_amount,
            condition_index,
            show_in_ab_test: a.contains_key("showInABtest"),
        });
    }
    rules
}

fn poll_mission_rules() -> &'static Vec<PollMissionRule> {
    static R: OnceLock<Vec<PollMissionRule>> = OnceLock::new();
    R.get_or_init(|| load_poll_mission_rules(&crate::commands::offline_lib::rules_root().join("missionDefinitions.xml")))
}

fn level_xp_thresholds() -> &'static Vec<f64> {
    static R: OnceLock<Vec<f64>> = OnceLock::new();
    R.get_or_init(|| load_level_xp_thresholds(&crate::commands::offline_lib::rules_root().join("XPTable.xml")))
}

fn find_top<'a>(doc: &'a mut Value, key: &str) -> Option<&'a mut Value> {
    doc.get_mut("universe")?.as_array_mut()?.iter_mut().find(|e| e.get(key).map_or(false, Value::is_array))
}

fn get_profile_element(doc: &mut Value) -> Option<&mut Value> {
    find_top(doc, "Profile")
}

fn world_children(doc: &mut Value) -> Option<&mut Vec<Value>> {
    let world = find_top(doc, "World")?;
    Some(get_element_children(world, "World"))
}

fn get_company_element<'a>(doc: &'a mut Value, whose: &str) -> Option<&'a mut Value> {
    world_children(doc)?.iter_mut().find(|e| e.get("Company").map_or(false, Value::is_array) && sv(e, "whose") == whose)
}

fn get_map_element(doc: &mut Value) -> Option<&mut Value> {
    world_children(doc)?.iter_mut().find(|e| e.get("Map").map_or(false, Value::is_array))
}

/// tutorial.ts:297 `parseCountChunkMap`
fn parse_count_chunk_map(entry: Option<&Value>) -> HashMap<String, f64> {
    let mut counts = HashMap::new();
    let Some(chunk) = entry.and_then(|e| e.get("chunk")).and_then(Value::as_str) else { return counts };
    for part in chunk.split(',') {
        if part.is_empty() {
            continue;
        }
        let Some(sep) = part.rfind('/') else { continue };
        let key = &part[..sep];
        let value = js_string_to_number(&part[sep + 1..]);
        if !key.is_empty() && value.is_finite() {
            counts.insert(key.to_string(), value);
        }
    }
    counts
}

/// tutorial.ts:319 `markMissionAsGiven`
fn mark_mission_as_given(sku: &str, up: &mut BTreeSet<String>, reached: &mut BTreeSet<String>, given: &mut BTreeSet<String>) -> bool {
    let already_given = given.contains(sku);
    let removed_from_up = up.remove(sku);
    let removed_from_reached = reached.remove(sku);
    if !already_given {
        given.insert(sku.to_string());
    }
    !already_given || removed_from_up || removed_from_reached
}

/// The three mission chunk sets of `Profile > Missions` plus the poll-manager counters.
struct MissionSets {
    up: BTreeSet<String>,
    reached: BTreeSet<String>,
    given: BTreeSet<String>,
}

fn read_mission_sets(profile: &mut Value) -> MissionSets {
    let profile_children = get_element_children(profile, "Profile");
    let missions_entry = get_or_create_element_child(profile_children, "Missions");
    let mission_children = get_element_children(missions_entry, "Missions");
    let pick = |tag: &str| {
        let e = find_element_child(mission_children, tag).map(|i| &mission_children[i]);
        parse_chunk_set(e)
    };
    MissionSets { up: pick("Up"), reached: pick("Reached"), given: pick("Given") }
}

fn write_mission_sets(profile: &mut Value, sets: &MissionSets) {
    let profile_children = get_element_children(profile, "Profile");
    let missions_entry = get_or_create_element_child(profile_children, "Missions");
    let mission_children = get_element_children(missions_entry, "Missions");
    upsert_chunk_element(mission_children, "Up", &sets.up);
    upsert_chunk_element(mission_children, "Reached", &sets.reached);
    upsert_chunk_element(mission_children, "Given", &sets.given);
}

/// tutorial.ts:332 `ensureCompletedTutorialMissionState`
fn ensure_completed_tutorial_mission_state(profile: &mut Value) -> bool {
    let mut sets = read_mission_sets(profile);
    let mut changed = false;

    let counts;
    {
        let profile_children = get_element_children(profile, "Profile");
        let poll_entry = get_or_create_element_child(profile_children, "PollManager");
        let poll_children = get_element_children(poll_entry, "PollManager");
        let idx = match find_element_child(poll_children, "Count") {
            Some(i) => i,
            None => {
                poll_children.push(create_element("Count", &[("chunk", "")], Vec::new()));
                changed = true;
                poll_children.len() - 1
            }
        };
        counts = parse_count_chunk_map(Some(&poll_children[idx]));
    }

    if let Some(city) = profile.get("cityname").and_then(Value::as_str) {
        if !city.trim().is_empty() && city != DEFAULT_CITY_NAME {
            changed = mark_mission_as_given("1", &mut sets.up, &mut sets.reached, &mut sets.given) || changed;
        }
    }

    for rule in constants()["COMPLETED_MISSION_POLL_RULES"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let count_key = rule["countKey"].as_str().unwrap_or("");
        let min_count = rule["minCount"].as_f64().unwrap_or(0.0);
        if counts.get(count_key).copied().unwrap_or(0.0) >= min_count {
            let sku = rule["sku"].as_str().unwrap_or("").to_string();
            changed = mark_mission_as_given(&sku, &mut sets.up, &mut sets.reached, &mut sets.given) || changed;
        }
    }

    let first_mission = match non_null(profile.get("firstMission")) {
        Some(v) => crate::util::js_string(v),
        None => "0".into(),
    };
    if sets.given.contains("1") && first_mission != "0" {
        set_s(profile, "firstMission", "0");
        changed = true;
    }
    let first_mission = match non_null(profile.get("firstMission")) {
        Some(v) => crate::util::js_string(v),
        None => "0".into(),
    };
    if sets.given.is_empty() && first_mission != "1" {
        set_s(profile, "firstMission", "1");
        changed = true;
    }

    write_mission_sets(profile, &sets);
    changed
}

/// tutorial.ts:450 `isMissionUnlockSatisfied`
fn is_mission_unlock_satisfied(rule: &PollMissionRule, reached: &BTreeSet<String>, given: &BTreeSet<String>, level: f64) -> bool {
    if !rule.unlock_sku.is_empty() && !reached.contains(&rule.unlock_sku) && !given.contains(&rule.unlock_sku) {
        return false;
    }
    if rule.unlock_level > 0.0 && level.is_finite() && level > 0.0 && level < rule.unlock_level {
        return false;
    }
    true
}

/// tutorial.ts:460 `getProfileLevel`
fn get_profile_level(profile: &Value) -> f64 {
    let explicit = match non_null(profile.get("level")) {
        Some(v) => js_number(Some(v)),
        None => 0.0, // Number("")
    };
    if explicit.is_finite() && explicit >= 1.0 {
        return explicit.floor();
    }
    let exp = num_or0(profile, "exp");
    let thresholds = level_xp_thresholds();
    if !exp.is_finite() || exp < 0.0 || thresholds.is_empty() {
        return 1.0;
    }
    let mut level = 0usize;
    while level < thresholds.len() {
        if exp < thresholds[level] {
            return (level as f64).max(1.0);
        }
        level += 1;
    }
    (thresholds.len() as f64).max(1.0)
}

/// tutorial.ts:481 `isPollMissionSatisfied`
fn is_poll_mission_satisfied(rule: &PollMissionRule, counts: &HashMap<String, f64>) -> bool {
    let progress = counts.get(&rule.event_sku).copied().unwrap_or(0.0);
    if !progress.is_finite() || progress <= 0.0 {
        return false;
    }
    if rule.condition_index >= 0 {
        return progress > rule.condition_index as f64;
    }
    progress >= rule.event_amount
}

/// tutorial.ts:379 `settleStaleTutorialPollMissions`
fn settle_stale_tutorial_poll_missions(profile: &mut Value) -> bool {
    let mut sets = read_mission_sets(profile);
    let counts = {
        let profile_children = get_element_children(profile, "Profile");
        let poll_entry = get_or_create_element_child(profile_children, "PollManager");
        let poll_children = get_element_children(poll_entry, "PollManager");
        let e = find_element_child(poll_children, "Count").map(|i| &poll_children[i]);
        parse_count_chunk_map(e)
    };
    let level = get_profile_level(profile);
    let stale = const_strings("STALE_TUTORIAL_POLL_MISSION_SKUS");

    let mut changed = false;
    let mut made_progress = true;
    while made_progress {
        made_progress = false;
        for rule in poll_mission_rules() {
            if !stale.contains(&rule.sku) || rule.show_in_ab_test || sets.given.contains(&rule.sku) {
                continue;
            }
            if !is_mission_unlock_satisfied(rule, &sets.reached, &sets.given, level) {
                continue;
            }
            if !is_poll_mission_satisfied(rule, &counts) {
                continue;
            }
            if mark_mission_as_given(&rule.sku, &mut sets.up, &mut sets.reached, &mut sets.given) {
                changed = true;
                made_progress = true;
            }
        }
    }
    if changed {
        write_mission_sets(profile, &sets);
    }
    changed
}

/// tutorial.ts:495 `normalizeBossGenre`
fn normalize_boss_genre(profile: &mut Value) -> bool {
    let value = sv(profile, "bossGenre");
    let value = value.trim();
    if value == "0" || value == "1" {
        return false;
    }
    set_s(profile, "bossGenre", "0");
    true
}

/// tutorial.ts:505 `ensureTutorialItem`
fn ensure_tutorial_item(items: &mut Vec<Value>, company_sid: &str, sku: &str, x: &str, y: &str) -> bool {
    let existing = items.iter().position(|e| is_item_element(e) && sv(e, "sku") == sku);
    let Some(existing) = existing else {
        let next_sid = num_str(get_next_item_sid(items));
        if sku == "HeadQuarter" {
            items.push(create_head_quarter_item(&next_sid, company_sid, x, y, "HeadQuarter_01"));
        } else if is_house_sku(sku) {
            items.push(create_waiting_contract_house_item(&next_sid, company_sid, sku, x, y));
        } else {
            items.push(create_built_item(&next_sid, company_sid, sku, x, y));
        }
        return true;
    };
    let existing = &mut items[existing];

    let mut changed = false;
    if sv(existing, "x") != x {
        set_s(existing, "x", x);
        changed = true;
    }
    if sv(existing, "y") != y {
        set_s(existing, "y", y);
        changed = true;
    }
    if sv(existing, "csid") != company_sid {
        set_s(existing, "csid", company_sid);
        changed = true;
    }
    if sv(existing, "isSuspended") != "0" {
        set_s(existing, "isSuspended", "0");
        changed = true;
    }

    let item_children = get_element_children(existing, "Item");
    let state_idx = find_element_child(item_children, "State");
    if sku == "HeadQuarter" {
        if state_idx.map_or(true, |i| sv(&item_children[i], "id") != "4") {
            match state_idx {
                Some(i) => set_s(&mut item_children[i], "id", "4"),
                None => item_children.insert(0, leaf_element("State", &[("id", "4")])),
            }
            changed = true;
        }
        if find_element_child(item_children, "Decorations").is_none() {
            item_children.push(create_head_quarter_decorations("HeadQuarter_01"));
            changed = true;
        }
    } else if is_house_sku(sku) {
        changed = normalize_house_rent_state(item_children, js_now()) || changed;
    } else if state_idx.map_or(true, |i| sv(&item_children[i], "id") != "5") {
        match state_idx {
            Some(i) => set_s(&mut item_children[i], "id", "5"),
            None => item_children.insert(0, leaf_element("State", &[("id", "5")])),
        }
        changed = true;
    }
    changed
}

fn js_now() -> f64 {
    crate::util::now_ms() as f64
}

/// tutorial.ts:576 `normalizeTimedItemStates`
fn normalize_timed_item_states(items: &mut [Value], now_ms: f64) -> bool {
    let mut changed = false;
    for item in items.iter_mut() {
        if !is_item_element(item) {
            continue;
        }
        let sku = sv(item, "sku");
        let item_children = get_element_children(item, "Item");
        let Some(si) = find_element_child(item_children, "State") else { continue };
        let state_id = sv(&item_children[si], "id");
        if is_house_sku(&sku) && state_id != "0" {
            changed = normalize_house_rent_state(item_children, now_ms) || changed;
        }
        // the state object may have been replaced/inserted at index 0 by the call above only when it was absent (not here)
        if sv(&item_children[si], "id") == "0" {
            changed = normalize_construction_state(&sku, &mut item_children[si], now_ms) || changed;
        }
    }
    changed
}

/// tutorial.ts:601 `repairLegacyTutorialBungalowDuplicate`
fn repair_legacy_tutorial_bungalow_duplicate(items: &mut Vec<Value>, now_ms: f64) -> bool {
    let hx = const_str("TUTORIAL_COMPLETED_HOUSE_TILE", "x");
    let hy = const_str("TUTORIAL_COMPLETED_HOUSE_TILE", "y");
    let tutorial_house = items
        .iter()
        .position(|e| is_item_element(e) && sv(e, "sku") == "houses_001_001" && sv(e, "x") == hx && sv(e, "y") == hy);
    let ghost = items
        .iter()
        .position(|e| is_item_element(e) && sv(e, "sku") == "houses_001_001" && sv(e, "x") == "0" && sv(e, "y") == "0");
    let (Some(th), Some(gi)) = (tutorial_house, ghost) else { return false };
    if th == gi {
        return false;
    }

    let legacy_state: Option<Value> = {
        let kids = get_element_children(&mut items[gi], "Item");
        find_element_child(kids, "State").map(|i| kids[i].clone())
    };
    if let Some(legacy_state) = legacy_state {
        let tutorial_children = get_element_children(&mut items[th], "Item");
        let tutorial_state = find_element_child(tutorial_children, "State").map(|i| &tutorial_children[i]);
        if get_house_state_priority(Some(&legacy_state)) > get_house_state_priority(tutorial_state) {
            match find_element_child(tutorial_children, "State") {
                None => tutorial_children.insert(0, legacy_state),
                Some(i) => tutorial_children[i] = legacy_state,
            }
        }
    }

    // The ghost house is removed, so the function always reports a change; the rent normalisation still runs for its
    // side effects on the tutorial house (its own flag is already covered by the `true` below).
    items.remove(gi);
    let th = if gi < th { th - 1 } else { th };
    let kids = get_element_children(&mut items[th], "Item");
    normalize_house_rent_state(kids, now_ms);
    true
}

/// tutorial.ts:652 `getHouseStatePriority`
fn get_house_state_priority(state: Option<&Value>) -> i32 {
    let Some(state) = state else { return 0 };
    let contract_sku = sv(state, "contractSku").trim().to_string();
    let mode = sv(state, "mode");
    let time = num_or0(state, "time");
    if !contract_sku.is_empty() && mode == "4" && time.is_finite() && time > 0.0 {
        return 5;
    }
    if !contract_sku.is_empty() && matches!(mode.as_str(), "5" | "6" | "14" | "15" | "7") {
        return 4;
    }
    if sv(state, "id") == "1" && mode == "1" {
        return 2;
    }
    if sv(state, "id") == "1" {
        return 1;
    }
    0
}

/// tutorial.ts:637 `migrateBoughtRivalItemsToMine`
fn migrate_bought_rival_items_to_mine(rival_items: &mut Vec<Value>, mine_items: &mut Vec<Value>, mine_company_sid: &str) -> bool {
    let mut changed = false;
    let mut index = rival_items.len();
    while index > 0 {
        index -= 1;
        if !is_item_element(&rival_items[index]) {
            continue;
        }
        let kids = get_element_children(&mut rival_items[index], "Item");
        let Some(si) = find_element_child(kids, "State") else { continue };
        if sv(&kids[si], "id") != "1" {
            continue;
        }
        let mut item = rival_items.remove(index);
        set_s(&mut item, "csid", mine_company_sid);
        mine_items.push(item);
        changed = true;
    }
    changed
}

/// tutorial.ts:62 `normalizeCompletedTutorialUniverse(document, nowMs = Date.now())`: returns true when the document changed.
pub fn normalize_completed_tutorial_universe(universe: &mut Value) -> bool {
    normalize_completed_tutorial_universe_at(universe, js_now())
}

pub fn normalize_completed_tutorial_universe_at(doc: &mut Value, now_ms: f64) -> bool {
    {
        let has_profile = find_top(doc, "Profile").is_some();
        let has_mine = get_company_element(doc, "0").is_some();
        let has_map = get_map_element(doc).is_some();
        if !has_profile || !has_mine || !has_map {
            return false;
        }
        let profile = get_profile_element(doc).unwrap();
        if sv_or(profile, "tutorialEnd", "0") != "1" {
            return false;
        }
    }

    let mine_sid = {
        let mine = get_company_element(doc, "0").unwrap();
        match non_null(mine.get("sid")) {
            Some(v) => crate::util::js_string(v),
            None => STARTER_COMPANY_MINE_SID.to_string(),
        }
    };
    let mut mine_items = clone_vec(get_element_children(get_company_element(doc, "0").unwrap(), "Company"));
    let mut rival_items = match get_company_element(doc, "1") {
        Some(rival) => clone_vec(get_element_children(rival, "Company")),
        None => Vec::new(),
    };
    let had_rival = get_company_element(doc, "1").is_some();

    let (mut terrain_tiles, mut road_tiles) = {
        let map = get_map_element(doc).unwrap();
        let map_children = get_element_children(map, "Map");
        let t = find_element_child(map_children, "Terrain").map(|i| &map_children[i]);
        let r = find_element_child(map_children, "Road").map(|i| &map_children[i]);
        (parse_chunk_set(t), parse_chunk_set(r))
    };

    let has_head_quarter = mine_items.iter().any(|e| is_item_element(e) && sv(e, "sku") == "HeadQuarter");
    let needs_starter_cash_repair = {
        let profile = get_profile_element(doc).unwrap();
        let cash = sv(profile, "DCCash");
        let value = match non_null(profile.get("companyValue")) {
            Some(v) => js_number(Some(v)),
            None => 0.0,
        };
        cash == "50" && value < 1_000_000.0
    };
    let needs_tutorial_repair = !has_head_quarter;

    let mut changed = false;
    {
        let profile = get_profile_element(doc).unwrap();
        changed = normalize_boss_genre(profile) || changed;
        changed = ensure_completed_tutorial_mission_state(profile) || changed;
        changed = settle_stale_tutorial_poll_missions(profile) || changed;
    }
    changed = migrate_bought_rival_items_to_mine(&mut rival_items, &mut mine_items, &mine_sid) || changed;
    changed = repair_legacy_tutorial_bungalow_duplicate(&mut mine_items, now_ms) || changed;
    changed = normalize_timed_item_states(&mut mine_items, now_ms) || changed;

    if needs_starter_cash_repair {
        set_s(get_profile_element(doc).unwrap(), "DCCash", "0");
        changed = true;
    }

    if needs_tutorial_repair {
        let hq = (const_str("TUTORIAL_COMPLETED_HQ_TILE", "x"), const_str("TUTORIAL_COMPLETED_HQ_TILE", "y"));
        let house = (const_str("TUTORIAL_COMPLETED_HOUSE_TILE", "x"), const_str("TUTORIAL_COMPLETED_HOUSE_TILE", "y"));
        let tree = (const_str("TUTORIAL_COMPLETED_TREE_TILE", "x"), const_str("TUTORIAL_COMPLETED_TREE_TILE", "y"));
        changed = ensure_tutorial_item(&mut mine_items, &mine_sid, "HeadQuarter", &hq.0, &hq.1) || changed;
        changed = ensure_tutorial_item(&mut mine_items, &mine_sid, "houses_001_001", &house.0, &house.1) || changed;
        changed = ensure_tutorial_item(&mut mine_items, &mine_sid, "decorations_tree_01", &tree.0, &tree.1) || changed;
        for tile in const_strings("TUTORIAL_COMPLETED_TERRAIN_TILES") {
            if terrain_tiles.insert(tile) {
                changed = true;
            }
        }
        for tile in const_strings("TUTORIAL_COMPLETED_ROAD_TILES") {
            if road_tiles.insert(tile) {
                changed = true;
            }
        }
    }

    // put the items back
    *get_element_children(get_company_element(doc, "0").unwrap(), "Company") = mine_items;
    if had_rival {
        *get_element_children(get_company_element(doc, "1").unwrap(), "Company") = rival_items;
    }

    if !needs_tutorial_repair {
        return changed;
    }
    let map = get_map_element(doc).unwrap();
    let map_children = get_element_children(map, "Map");
    upsert_chunk_element(map_children, "Terrain", &terrain_tiles);
    upsert_chunk_element(map_children, "Road", &road_tiles);
    changed
}

/// tutorial.ts:135 `normalizeIncompleteTutorialUniverse`: returns true when the document changed (no-op if the tutorial ended).
pub fn normalize_incomplete_tutorial_universe(doc: &mut Value) -> bool {
    {
        let has_map = get_map_element(doc).is_some();
        let Some(profile) = get_profile_element(doc) else { return false };
        if !has_map || sv_or(profile, "tutorialEnd", "0") == "1" {
            return false;
        }
    }
    let (mut terrain_tiles, mut road_tiles) = {
        let map = get_map_element(doc).unwrap();
        let map_children = get_element_children(map, "Map");
        let t = find_element_child(map_children, "Terrain").map(|i| &map_children[i]);
        let r = find_element_child(map_children, "Road").map(|i| &map_children[i]);
        (parse_chunk_set(t), parse_chunk_set(r))
    };
    let mut changed = false;

    if let Some(mine) = get_company_element(doc, "0") {
        let tx = const_str("TUTORIAL_COMPLETED_TREE_TILE", "x");
        let ty = const_str("TUTORIAL_COMPLETED_TREE_TILE", "y");
        let mine_items = get_element_children(mine, "Company");
        let mut index = mine_items.len();
        while index > 0 {
            index -= 1;
            let item = &mine_items[index];
            if is_item_element(item) && sv(item, "sku") == "decorations_tree_01" && sv(item, "x") == tx && sv(item, "y") == ty {
                mine_items.remove(index);
                changed = true;
            }
        }
    }

    for tile in const_strings("TUTORIAL_COMPLETED_TERRAIN_TILES") {
        changed = terrain_tiles.remove(&tile) || changed;
    }
    for tile in const_strings("TUTORIAL_COMPLETED_ROAD_TILES") {
        changed = road_tiles.remove(&tile) || changed;
    }

    if changed {
        let map = get_map_element(doc).unwrap();
        let map_children = get_element_children(map, "Map");
        upsert_chunk_element(map_children, "Terrain", &terrain_tiles);
        upsert_chunk_element(map_children, "Road", &road_tiles);
    }
    changed
}

#[allow(dead_code)]
fn unused(_: &Map<String, Value>) {}

/// Adapter with the `&dyn Fn(i64, i64) -> Option<Value>` shape that `commands::universe::resolve_upgrade_owner_id` takes:
/// pass `&save_defaults::create_neighbor_universe_i64`.
pub fn create_neighbor_universe_i64(target_user_id: i64, boss_genre: i64) -> Option<Value> {
    create_neighbor_universe(target_user_id as f64, boss_genre as f64)
}
