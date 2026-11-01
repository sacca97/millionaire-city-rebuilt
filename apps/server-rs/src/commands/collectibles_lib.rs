//! Port of `apps/server/src/commandHandlers/collectibles.ts` (package "libs-b", see docs/rust-server-plan.md).
//! Pure functions over the collectibles documents; the command handlers that call them live in `collectibles.rs`.
//!
//! Conventions: documents are `serde_json::Value` objects mutated in place (`projectPendingCollectiblesOnUniverse` mutates
//! the universe in place instead of also returning it); rules come from the raw 0.501 XML through `rules.rs`, loaded once
//! lazily like the TS module-level constants. Calls into the P1 libs-a module `commands::universe`:
//! `get_company_entry_by_whose`, `is_item_element`, `is_house_sku`.
//!
//! Known deviations: `String#localeCompare` (ICU) is emulated by `locale_compare` for the ASCII sku/sid alphabet (verified
//! against Node in `tests/libs_b.rs`); `Array#sort()` default order is UTF-16 code units, which `BTreeSet<String>` matches for
//! BMP text (skus are ASCII).
#![allow(dead_code)]

use crate::commands::universe::{get_company_entry_by_whose, is_house_sku, is_item_element};
use crate::rules::{load_collectible_unlock_level, load_definition_attributes, load_level_xp_thresholds};
use crate::save_tree::{create_element, find_element_child, get_element_children};
use crate::util::{js_number, js_number_to_string, js_string_or_empty, js_string_to_number};
use indexmap::{IndexMap, IndexSet};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

type Attrs = HashMap<String, String>;

/// collectibles.ts:21 `CollectiblesState` (insertion-ordered, like the JS Map/Set).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CollectiblesState {
    pub object_counts: IndexMap<String, f64>,
    pub rewards: IndexSet<String>,
    pub pending_by_sid: IndexMap<String, String>,
}

struct CollectibleDefinition {
    sku: String,
    collection: String,
    contract_groups: Vec<String>,
}

struct CollectibleGroupDefinition {
    reward_sku: String,
    reward_type: String,
}

struct CollectibleRules {
    item_contract_group_by_sku: HashMap<String, String>,
    group_definitions_by_sku: HashMap<String, CollectibleGroupDefinition>,
    plane_reward_by_group: HashMap<String, String>,
    hq_reward_by_group: HashMap<String, String>,
    collectibles_by_contract_group: HashMap<String, Vec<String>>,
    unlock_level: i64,
    level_xp_thresholds: Vec<f64>,
    contract_hours_by_sku: HashMap<String, f64>,
    raw_groups: Vec<Attrs>,
    raw_collectibles: Vec<Attrs>,
}

// ---- JS helpers ---------------------------------------------------------------------------------------------------

/// `String#trim` (JS whitespace set: Unicode White_Space without U+0085, plus U+FEFF).
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// `attrs[key]?.trim()` (None when the attribute is missing).
fn trimmed(attrs: &Attrs, key: &str) -> Option<String> {
    attrs.get(key).map(|v| js_trim(v).to_string())
}

/// `x?.trim() ?? ""`.
fn trimmed_or_empty(attrs: &Attrs, key: &str) -> String {
    trimmed(attrs, key).unwrap_or_default()
}

fn str_attr(node: &Value, key: &str) -> String {
    js_string_or_empty(node.get(key))
}

fn set_str(node: &mut Value, key: &str, value: String) {
    node.as_object_mut().expect("node must be an object").insert(key.to_string(), Value::String(value));
}

/// `String(x ?? "")` then `.trim()`.
fn trim_attr(node: &Value, key: &str) -> String {
    js_trim(&str_attr(node, key)).to_string()
}

/// Base letter of a Latin-1 accented letter (`None` for anything else).
fn latin1_base(c: char) -> Option<char> {
    const TABLE: [(&str, char); 8] = [("àáâãäåÀÁÂÃÄÅ", 'a'), ("çÇ", 'c'), ("èéêëÈÉÊË", 'e'), ("ìíîïÌÍÎÏ", 'i'), ("ñÑ", 'n'), ("òóôõöÒÓÔÕÖ", 'o'), ("ùúûüÙÚÛÜ", 'u'), ("ýÿÝ", 'y')];
    TABLE.iter().find(|(set, _)| set.contains(c)).map(|(_, b)| *b)
}

/// `String#localeCompare` for sku / sid strings (ICU root collation, multi-level): primary order is whitespace <
/// punctuation (`_ - , ; : ! ? . ' " ( ) [ ] { } @ * / \ & # % ` ^ + < = > | ~ $`) < digits < letters (case- and
/// accent-insensitive); then accents (unaccented first), then case (lowercase before uppercase). Latin-1 accents are folded;
/// other non-ASCII text falls back to code point order.
pub fn locale_compare(left: &str, right: &str) -> Ordering {
    const PUNCT: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    fn primary(c: char) -> u32 {
        let c = latin1_base(c).map_or(c, |b| if c.is_uppercase() { b.to_ascii_uppercase() } else { b });
        if c.is_whitespace() {
            1
        } else if let Some(i) = PUNCT.find(c) {
            100 + i as u32
        } else if c.is_ascii_digit() {
            1000 + (c as u32 - '0' as u32)
        } else if c.is_ascii_alphabetic() {
            2000 + (c.to_ascii_lowercase() as u32 - 'a' as u32)
        } else {
            10_000 + c.to_lowercase().next().unwrap_or(c) as u32
        }
    }
    let p = left.chars().map(primary).cmp(right.chars().map(primary));
    if p != Ordering::Equal {
        return p;
    }
    let accents = left.chars().map(|c| latin1_base(c).is_some()).cmp(right.chars().map(|c| latin1_base(c).is_some()));
    if accents != Ordering::Equal {
        return accents;
    }
    for (a, b) in left.chars().zip(right.chars()) {
        if a != b {
            // lowercase before uppercase
            let (la, lb) = (a.is_lowercase(), b.is_lowercase());
            if la != lb {
                return if la { Ordering::Less } else { Ordering::Greater };
            }
        }
    }
    Ordering::Equal
}

// ---- rules (collectibles.ts:22-62) --------------------------------------------------------------------------------

fn rules_root() -> PathBuf {
    crate::config::workspace_root().join("assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules")
}

fn item_assets_root() -> PathBuf {
    crate::config::workspace_root().join("assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Assets/items")
}

/// collectibles.ts:572 `createArchivedItemSwfSet`.
fn archived_item_swf_set(root: &Path) -> HashSet<String> {
    let Ok(rd) = std::fs::read_dir(root) else { return HashSet::new() };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_lowercase())
        .filter(|n| n.ends_with(".swf"))
        .collect()
}

/// collectibles.ts:560 `isArchivedItemSkuAvailable`.
fn is_archived_item_sku_available(sku: &str, swfs: &HashSet<String>, uses_advisor: bool) -> bool {
    if swfs.contains(&format!("{sku}.swf").to_lowercase()) {
        return true;
    }
    uses_advisor
        && swfs.contains(&format!("{sku}_Cindy.swf").to_lowercase())
        && swfs.contains(&format!("{sku}_Ronald.swf").to_lowercase())
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

/// collectibles.ts:520 `loadAvailableCollectibleGroupSkus`.
fn load_available_collectible_group_skus(
    groups_path: &Path,
    item_assets_root: &Path,
    advisor_variant_item_skus: &HashSet<String>,
) -> HashSet<String> {
    let swfs = archived_item_swf_set(item_assets_root);
    let mut out = HashSet::new();
    for d in load_definition_attributes(groups_path) {
        let (Some(group_sku), Some(reward_sku)) = (non_empty(trimmed(&d, "sku")), non_empty(trimmed(&d, "reward"))) else {
            continue;
        };
        let reward_type = trimmed(&d, "rewardType").map(|s| s.to_lowercase());
        if reward_type.as_deref() == Some("item")
            && !is_archived_item_sku_available(&reward_sku, &swfs, advisor_variant_item_skus.contains(&reward_sku))
        {
            continue;
        }
        out.insert(group_sku);
    }
    out
}

/// collectibles.ts:548 `loadAdvisorVariantItemSkus`.
fn load_advisor_variant_item_skus(path: &Path) -> HashSet<String> {
    load_definition_attributes(path)
        .into_iter()
        .filter_map(|d| non_empty(trimmed(&d, "sku")).filter(|_| d.contains_key("useAdvisor")))
        .collect()
}

/// collectibles.ts:487 `loadCollectibleRewardMapByType`.
fn load_collectible_reward_map_by_type(
    groups_path: &Path,
    rewards_path: &Path,
    available: &HashSet<String>,
    filter: &str,
) -> HashMap<String, String> {
    let mut reward_types_by_sku = HashMap::new();
    for d in load_definition_attributes(rewards_path) {
        if let (Some(sku), Some(rt)) = (non_empty(trimmed(&d, "sku")), non_empty(trimmed(&d, "rewardType").map(|s| s.to_lowercase()))) {
            reward_types_by_sku.insert(sku, rt);
        }
    }
    let mut out = HashMap::new();
    for d in load_definition_attributes(groups_path) {
        let (Some(group_sku), Some(reward_sku)) = (non_empty(trimmed(&d, "sku")), non_empty(trimmed(&d, "reward"))) else {
            continue;
        };
        if !available.contains(&group_sku) {
            continue;
        }
        let group_reward_type = trimmed(&d, "rewardType").map(|s| s.to_lowercase());
        let reward_type = reward_types_by_sku.get(&reward_sku).cloned().or(group_reward_type);
        if reward_type.as_deref() == Some(filter) {
            out.insert(group_sku, reward_sku);
        }
    }
    out
}

fn rules() -> &'static CollectibleRules {
    static R: OnceLock<CollectibleRules> = OnceLock::new();
    R.get_or_init(|| {
        let root = rules_root();
        let groups_path = root.join("collectiblesGroupsDefinitions.xml");
        let rewards_path = root.join("collectiblesRewardDefinitions.xml");
        let item_defs_path = root.join("itemDefinitions.xml");
        let advisor = load_advisor_variant_item_skus(&item_defs_path);
        let available = load_available_collectible_group_skus(&groups_path, &item_assets_root(), &advisor);

        // collectibles.ts:427 `loadItemContractGroupMap`
        let mut item_contract_group_by_sku = HashMap::new();
        for d in load_definition_attributes(&item_defs_path) {
            if let (Some(sku), Some(group)) = (non_empty(trimmed(&d, "sku")), non_empty(trimmed(&d, "contractsTypeSku"))) {
                item_contract_group_by_sku.insert(sku, group);
            }
        }

        // collectibles.ts:440 `loadCollectibleDefinitions`
        let definitions: Vec<CollectibleDefinition> = load_definition_attributes(&root.join("collectiblesDefinitions.xml"))
            .iter()
            .map(|d| CollectibleDefinition {
                sku: trimmed_or_empty(d, "sku"),
                collection: trimmed_or_empty(d, "collection"),
                contract_groups: d
                    .get("contracsGroupList")
                    .map_or("", String::as_str)
                    .split(',')
                    .map(|e| js_trim(e).to_string())
                    .filter(|e| !e.is_empty())
                    .collect(),
            })
            .filter(|d| !d.sku.is_empty() && !d.collection.is_empty() && available.contains(&d.collection) && !d.contract_groups.is_empty())
            .collect();

        // collectibles.ts:460 `loadCollectibleGroupDefinitionMap`
        let mut group_definitions_by_sku = HashMap::new();
        for d in load_definition_attributes(&groups_path) {
            let sku = trimmed_or_empty(&d, "sku");
            let reward_sku = trimmed_or_empty(&d, "reward");
            let reward_type = trimmed_or_empty(&d, "rewardType").to_lowercase();
            if sku.is_empty() || reward_sku.is_empty() || !available.contains(&sku) {
                continue;
            }
            group_definitions_by_sku.insert(sku, CollectibleGroupDefinition { reward_sku, reward_type });
        }

        // collectibles.ts:585 `groupCollectiblesByContractGroup`
        let mut collectibles_by_contract_group: HashMap<String, Vec<String>> = HashMap::new();
        for d in &definitions {
            for g in &d.contract_groups {
                collectibles_by_contract_group.entry(g.clone()).or_default().push(d.sku.clone());
            }
        }

        let mut contract_hours_by_sku = HashMap::new();
        for d in load_definition_attributes(&root.join("contracts.xml")) {
            let sku = d.get("sku").cloned().unwrap_or_else(|| "undefined".to_string());
            let hours = d.get("incomeTime").map_or(f64::NAN, |s| js_string_to_number(s));
            contract_hours_by_sku.insert(sku, hours);
        }

        CollectibleRules {
            item_contract_group_by_sku,
            group_definitions_by_sku,
            plane_reward_by_group: load_collectible_reward_map_by_type(&groups_path, &rewards_path, &available, "plane"),
            hq_reward_by_group: load_collectible_reward_map_by_type(&groups_path, &rewards_path, &available, "hq"),
            collectibles_by_contract_group,
            unlock_level: load_collectible_unlock_level(&root.join("settings.xml")),
            level_xp_thresholds: load_level_xp_thresholds(&root.join("XPTable.xml")),
            contract_hours_by_sku,
            raw_groups: load_definition_attributes(&groups_path),
            raw_collectibles: load_definition_attributes(&root.join("collectiblesDefinitions.xml")),
        }
    })
}

// ---- drop chance (collectibles.ts:60-73) --------------------------------------------------------------------------

/// collectibles.ts:65 `COLLECTIBLE_CHANCE_BY_HOURS` as `(incomeTime hours, percent)`; the Map value is `percent / 100`
/// (see `collectible_drop_chance`). CollectiblesRules.getHasCollectibleByContractSku (CollectiblesRules.java:182-187):
/// drop chance depends on the contract's incomeTime (hours -> finalResult/100; table `collectibles_chances_definitions` of
/// the original config row).
pub const COLLECTIBLE_CHANCE_BY_HOURS: [(f64, f64); 11] = [
    (0.05, 1.25),
    (0.5, 2.5),
    (1.0, 3.75),
    (2.0, 5.625),
    (4.0, 3.75),
    (8.0, 6.6667),
    (12.0, 12.0833),
    (18.0, 14.5833),
    (24.0, 20.8333),
    (48.0, 13.75),
    (72.0, 13.75),
];

/// collectibles.ts:71 `collectibleDropChance`.
pub fn collectible_drop_chance(contract_sku: &str) -> f64 {
    let hours = rules().contract_hours_by_sku.get(contract_sku).copied().unwrap_or(f64::NAN);
    COLLECTIBLE_CHANCE_BY_HOURS.iter().find(|(h, _)| *h == hours).map_or(0.0, |(_, c)| c / 100.0)
}

// ---- documents ----------------------------------------------------------------------------------------------------

/// saveDefaults/collectibles.ts `createEmptyCollectiblesDocument().collectiblesList` (children of the empty document).
fn empty_collectibles_list() -> Value {
    Value::Array(vec![
        create_element("Objects", &[("skus", "")], Vec::new()),
        create_element("Rewards", &[("skus", "")], Vec::new()),
        create_element("Pending", &[("tupla", "")], Vec::new()),
    ])
}

/// Makes sure `children` holds `<tag attr="">` with a string `attr`; true when changed (collectibles.ts:84-112).
fn ensure_attr_element(children: &mut Vec<Value>, tag: &str, attr: &str) -> bool {
    match find_element_child(children, tag) {
        None => {
            children.push(create_element(tag, &[(attr, "")], Vec::new()));
            true
        }
        Some(i) => {
            if !children[i].get(attr).map_or(false, Value::is_string) {
                set_str(&mut children[i], attr, String::new());
                true
            } else {
                false
            }
        }
    }
}

/// collectibles.ts:75 `normalizeCollectiblesDocument`.
pub fn normalize_collectibles_document(document: &mut Value) -> bool {
    let mut changed = false;
    if !document.get("collectiblesList").map_or(false, Value::is_array) {
        document.as_object_mut().expect("document must be an object").insert("collectiblesList".to_string(), empty_collectibles_list());
        changed = true;
    }
    let children = get_element_children(document, "collectiblesList");
    changed |= ensure_attr_element(children, "Objects", "skus");
    changed |= ensure_attr_element(children, "Rewards", "skus");
    changed |= ensure_attr_element(children, "Pending", "tupla");
    changed
}

/// collectibles.ts:115 `normalizeCollectiblePendingDocument`.
pub fn normalize_collectible_pending_document(document: &mut Value) -> bool {
    if document.get("collectiblePendingList").map_or(false, Value::is_array) {
        return false;
    }
    document.as_object_mut().expect("document must be an object").insert("collectiblePendingList".to_string(), Value::Array(Vec::new()));
    true
}

fn child_attr(children: &[Value], tag: &str, attr: &str) -> String {
    find_element_child(children, tag).map(|i| str_attr(&children[i], attr)).unwrap_or_default()
}

/// collectibles.ts:124 `readCollectiblesState`.
pub fn read_collectibles_state(document: &mut Value) -> CollectiblesState {
    normalize_collectibles_document(document);
    let children = get_element_children(document, "collectiblesList");
    CollectiblesState {
        object_counts: parse_sku_count_map(&child_attr(children, "Objects", "skus")),
        rewards: parse_sku_set(&child_attr(children, "Rewards", "skus")),
        pending_by_sid: parse_pending_collectible_map(&child_attr(children, "Pending", "tupla")),
    }
}

/// collectibles.ts:138 `writeCollectiblesState`.
pub fn write_collectibles_state(document: &mut Value, state: &CollectiblesState) {
    normalize_collectibles_document(document);
    let children = get_element_children(document, "collectiblesList");
    upsert_simple_attribute_element(children, "Objects", "skus", serialize_sku_count_map(&state.object_counts));
    upsert_simple_attribute_element(children, "Rewards", "skus", serialize_sku_set(&state.rewards));
    upsert_simple_attribute_element(children, "Pending", "tupla", serialize_pending_collectible_map(&state.pending_by_sid));
}

/// collectibles.ts:146 `removePendingFriendCollectible`.
pub fn remove_pending_friend_collectible(document: &mut Value, ext_id: &str, sku: &str) -> bool {
    normalize_collectible_pending_document(document);
    let children = get_element_children(document, "collectiblePendingList");
    let index = children.iter().position(|e| {
        e.get("item").map_or(false, Value::is_array) && str_attr(e, "extId") == ext_id && str_attr(e, "sku") == sku
    });
    match index {
        None => false,
        Some(i) => {
            children.remove(i);
            true
        }
    }
}

const STALE_STATE_KEYS: [&str; 5] = ["contractSku", "contractGroupSku", "savedAt", "accelerated", "doubleRent"];

/// collectibles.ts:163 `projectPendingCollectiblesOnUniverse`: mutates `universe` in place (the TS also returns it).
pub fn project_pending_collectibles_on_universe(universe: &mut Value, collectibles_document: &mut Value) {
    let pending_by_sid = read_collectibles_state(collectibles_document).pending_by_sid;
    if pending_by_sid.is_empty() {
        return;
    }
    let Some(company) = get_company_entry_by_whose(universe, "0") else { return };
    for item in get_element_children(company, "Company").iter_mut() {
        if !is_item_element(item) {
            continue;
        }
        let sid = str_attr(item, "sid");
        if !pending_by_sid.contains_key(&sid) || !is_house_sku(&str_attr(item, "sku")) {
            continue;
        }
        let state = ensure_projected_house_state(item);
        let current_mode = match state.get("mode") {
            None | Some(Value::Null) => "1".to_string(),
            Some(v) => js_string_or_empty(Some(v)),
        };
        if current_mode == "5" || current_mode == "6" {
            continue;
        }
        set_str(state, "id", "1".to_string());
        set_str(state, "mode", "14".to_string());
        set_str(state, "time", "0".to_string());
        remove_stale_keys(state);
    }
}

fn remove_stale_keys(state: &mut Value) {
    let obj = state.as_object_mut().expect("state must be an object");
    for k in STALE_STATE_KEYS {
        obj.shift_remove(k);
    }
}

/// collectibles.ts:203 `collapsePendingCollectibleState`.
pub fn collapse_pending_collectible_state(state: &mut Value) {
    set_str(state, "id", "1".to_string());
    set_str(state, "mode", "1".to_string());
    set_str(state, "time", "0".to_string());
    remove_stale_keys(state);
}

/// collectibles.ts:214 `isCollectibleAwardMutation`.
pub fn is_collectible_award_mutation(payload: &Value, state: &Value) -> bool {
    let action = str_attr(payload, "action").to_lowercase();
    (action == "new_mode" || action == "new_state") && str_attr(state, "id") == "1" && str_attr(state, "mode") == "5"
}

/// collectibles.ts:223 `isCollectibleFeatureUnlocked`.
pub fn is_collectible_feature_unlocked(profile: Option<&Value>) -> bool {
    get_profile_level(profile) >= rules().unlock_level as f64
}

/// collectibles.ts:227 `shouldAwardCollectibleDrop`: Java awards when rand <= chance; a deterministic stand-in (idempotent
/// per rent cycle) is used instead of `Math.random()`.
pub fn should_award_collectible_drop(item_entry: &Value, state: &Value) -> bool {
    let sid = trim_attr(item_entry, "sid");
    let item_sku = trim_attr(item_entry, "sku");
    let contract_sku = trim_attr(state, "contractSku");
    let saved_at = trim_attr(state, "savedAt");
    if sid.is_empty() || item_sku.is_empty() || contract_sku.is_empty() || saved_at.is_empty() {
        return false;
    }
    let cycle_key = format!("{sid}:{item_sku}:{contract_sku}:{saved_at}");
    let roll = ((stable_string_hash(&cycle_key) as i64).abs() % 100_000) as f64 / 100_000.0;
    roll <= collectible_drop_chance(&contract_sku)
}

/// collectibles.ts:242 `pickCollectibleSkuForHouse`.
pub fn pick_collectible_sku_for_house(item_sku: &str, sid: &str, state: &CollectiblesState) -> Option<String> {
    let r = rules();
    let contract_group = r.item_contract_group_by_sku.get(item_sku)?;
    let candidates = r.collectibles_by_contract_group.get(contract_group).filter(|c| !c.is_empty())?;
    let mut pending_counts: HashMap<&str, f64> = HashMap::new();
    for sku in state.pending_by_sid.values() {
        *pending_counts.entry(sku.as_str()).or_insert(0.0) += 1.0;
    }
    let count = |sku: &str| state.object_counts.get(sku).copied().unwrap_or(0.0) + pending_counts.get(sku).copied().unwrap_or(0.0);
    let mut sorted: Vec<&String> = candidates.iter().collect();
    sorted.sort_by(|left, right| {
        let (lc, rc) = (count(left), count(right));
        if lc != rc {
            return (lc - rc).partial_cmp(&0.0).unwrap_or(Ordering::Equal);
        }
        let lh = stable_string_hash(&format!("{sid}:{left}"));
        let rh = stable_string_hash(&format!("{sid}:{right}"));
        if lh != rh {
            return lh.cmp(&rh);
        }
        locale_compare(left, right)
    });
    sorted.first().map(|s| (*s).clone())
}

/// collectibles.ts:277 `resolvePlaneRewardSkuForCollectibleClaim`.
pub fn resolve_plane_reward_sku_for_collectible_claim(group_sku: &str) -> Option<String> {
    rules().plane_reward_by_group.get(group_sku).cloned()
}

/// collectibles.ts:281 `resolveHeadQuarterRewardSkuForCollectibleClaim`.
pub fn resolve_head_quarter_reward_sku_for_collectible_claim(group_sku: &str) -> Option<String> {
    rules().hq_reward_by_group.get(group_sku).cloned()
}

/// collectibles.ts:285 `resolveItemRewardCollectibleGroupFromMutation`.
pub fn resolve_item_reward_collectible_group_from_mutation(payload: &Value, item_entry: &Value) -> Option<String> {
    let group_sku = trim_attr(payload, "collectible");
    if group_sku.is_empty() {
        return None;
    }
    let group = rules().group_definitions_by_sku.get(&group_sku)?;
    if group.reward_type != "item" {
        return None;
    }
    let item_sku = trim_attr(item_entry, "sku");
    if item_sku.is_empty() || item_sku == group.reward_sku { Some(group_sku) } else { None }
}

// ---- state (de)serialisation (collectibles.ts:296-402) ---------------------------------------------------------------

/// collectibles.ts:303 `upsertSimpleAttributeElement`.
fn upsert_simple_attribute_element(children: &mut Vec<Value>, tag: &str, attr: &str, value: String) {
    match find_element_child(children, tag) {
        Some(i) => set_str(&mut children[i], attr, value),
        None => children.push(create_element(tag, &[(attr, &value)], Vec::new())),
    }
}

/// collectibles.ts:318 `parseSkuCountMap`.
pub fn parse_sku_count_map(value: &str) -> IndexMap<String, f64> {
    let mut counts = IndexMap::new();
    for part in value.split(',') {
        let t = js_trim(part);
        if t.is_empty() {
            continue;
        }
        let mut it = t.split(':');
        let sku = it.next().unwrap_or("");
        let count = match it.next() {
            None => 1.0,
            Some(c) => js_string_to_number(c),
        };
        if !sku.is_empty() && count.is_finite() && count > 0.0 {
            counts.insert(sku.to_string(), count);
        }
    }
    counts
}

/// collectibles.ts:335 `serializeSkuCountMap`.
pub fn serialize_sku_count_map(values: &IndexMap<String, f64>) -> String {
    let mut entries: Vec<(&String, f64)> = values.iter().map(|(k, v)| (k, *v)).filter(|(_, c)| c.is_finite() && *c > 0.0).collect();
    entries.sort_by(|a, b| locale_compare(a.0, b.0));
    entries
        .iter()
        .map(|(sku, count)| if *count == 1.0 { (*sku).clone() } else { format!("{sku}:{}", js_number_to_string(*count)) })
        .collect::<Vec<_>>()
        .join(",")
}

/// collectibles.ts:343 `parseSkuSet`.
pub fn parse_sku_set(value: &str) -> IndexSet<String> {
    value.split(',').map(js_trim).filter(|e| !e.is_empty()).map(String::from).collect()
}

/// collectibles.ts:352 `serializeSkuSet`: `Array#sort()` default order.
pub fn serialize_sku_set(values: &IndexSet<String>) -> String {
    let mut v: Vec<&String> = values.iter().collect();
    v.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    v.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(",")
}

/// collectibles.ts:356 `parsePendingCollectibleMap`.
pub fn parse_pending_collectible_map(value: &str) -> IndexMap<String, String> {
    let mut pending = IndexMap::new();
    for part in value.split(',') {
        let t = js_trim(part);
        if t.is_empty() {
            continue;
        }
        let Some(sep) = t.find(':') else { continue };
        let (sid, sku) = (&t[..sep], &t[sep + 1..]);
        if !sid.is_empty() && !sku.is_empty() {
            pending.insert(sid.to_string(), sku.to_string());
        }
    }
    pending
}

/// collectibles.ts:378 `serializePendingCollectibleMap`.
pub fn serialize_pending_collectible_map(values: &IndexMap<String, String>) -> String {
    let mut entries: Vec<(&String, &String)> = values.iter().collect();
    entries.sort_by(|a, b| locale_compare(a.0, b.0));
    entries.iter().map(|(sid, sku)| format!("{sid}:{sku}")).collect::<Vec<_>>().join(",")
}

/// collectibles.ts:385 `ensureProjectedHouseState`: the `<State>` child of an item, created at the front when absent.
fn ensure_projected_house_state(item: &mut Value) -> &mut Value {
    let children = get_element_children(item, "Item");
    let idx = match find_element_child(children, "State") {
        Some(i) => i,
        None => {
            children.insert(0, create_element("State", &[("id", "1"), ("mode", "1"), ("time", "0")], Vec::new()));
            0
        }
    };
    &mut children[idx]
}

/// collectibles.ts:397 `getProfileLevel` (a JS number: `Math.floor`/`Math.max` results).
fn get_profile_level(profile: Option<&Value>) -> f64 {
    let nullish = |key: &str| profile.and_then(|p| p.get(key)).filter(|v| !v.is_null());
    let explicit = match nullish("level") {
        None => 0.0, // Number("")
        Some(v) => js_number(Some(v)),
    };
    if explicit.is_finite() && explicit >= 1.0 {
        return explicit.floor();
    }
    let thresholds = &rules().level_xp_thresholds;
    let exp = match nullish("exp") {
        None => 0.0,
        Some(v) => js_number(Some(v)),
    };
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

/// collectibles.ts:419 `stableStringHash`: `hash = (hash * 31 + charCode) | 0` over UTF-16 units.
pub fn stable_string_hash(value: &str) -> i32 {
    let mut hash: i32 = 17;
    for unit in value.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(unit as i32);
    }
    hash
}

// ---- trade-in / asked (collectibles.ts:596-618) -----------------------------------------------------------------------

/// GamePlay.java:1632-1637, Settings.smCollectibleMaxUnitsPerItem (collectibles.ts:599).
pub const MAX_COLLECTIBLE_UNITS: i64 = 99;
/// UserData.MAX_GIFTS_ASKED (UserData.java:11; collectibles.ts:600).
pub const MAX_COLLECTIBLES_ASKED: usize = 5;

/// collectibles.ts:606 `getTradeInCollectibleSkus`: collectible skus a "tradeable" (tradein="1") group consumes when its
/// reward is claimed (GamePlay.java:1719-1746). Empty for non-tradeable groups.
pub fn get_trade_in_collectible_skus(group_sku: &str) -> Vec<String> {
    let r = rules();
    let group = r.raw_groups.iter().find(|e| e.get("sku").map(String::as_str) == Some(group_sku));
    if group.and_then(|g| g.get("tradein")).map(String::as_str) != Some("1") {
        return Vec::new();
    }
    r.raw_collectibles
        .iter()
        .filter(|e| e.get("collection").map(String::as_str) == Some(group_sku))
        .map(|e| e.get("sku").cloned().unwrap_or_else(|| "undefined".to_string()))
        .collect()
}

/// collectibles.ts:615 `pushAskedCollectible`: GamePlay.askForCollectibles (GamePlay.java:1387-1408): most-recent-first
/// list, de-duplicated, capped at 5.
pub fn push_asked_collectible(asked: &str, sku: &str) -> String {
    let mut list: Vec<&str> = vec![sku];
    list.extend(asked.split(',').filter(|e| !e.is_empty() && *e != sku));
    list.truncate(MAX_COLLECTIBLES_ASKED);
    list.join(",")
}

// keep serde_json::Map in scope for downstream users of the document types
#[allow(unused)]
type DocumentObject = Map<String, Value>;
