//! Port of `apps/server/src/rules.ts`: tiny regex readers over the original rules XML files.
#![allow(dead_code)] // loadConstructionTimeBySku / loadCollectibleUnlockLevel are used by later packages

use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

pub struct GoldPackageReward {
    pub gold: i64,
    pub free_gold: i64,
}

fn attr_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"([A-Za-z0-9_]+)="([^"]*)""#).unwrap())
}

/// rules.ts:8 `parseXmlAttributes`
pub fn parse_xml_attributes(blob: &str) -> HashMap<String, String> {
    attr_re().captures_iter(blob).map(|c| (c[1].to_string(), c[2].to_string())).collect()
}

/// rules.ts:16 `loadDefinitionAttributes`: every self-closing `<Definition .../>`.
pub fn load_definition_attributes(path: &Path) -> Vec<HashMap<String, String>> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"<Definition\b([^>]*)/>").unwrap());
    let Ok(xml) = std::fs::read_to_string(path) else { return Vec::new() };
    re.captures_iter(&xml).map(|c| parse_xml_attributes(&c[1])).collect()
}

/// JS `Number(str)` then `Number.isFinite`.
fn num(s: Option<&String>, default: &str) -> Option<f64> {
    let v = crate::util::js_string_to_number(s.map(String::as_str).unwrap_or(default));
    v.is_finite().then_some(v)
}

/// rules.ts:26 `loadCashToCoins`
pub fn load_cash_to_coins(path: &Path) -> i64 {
    let defs = load_definition_attributes(path);
    match num(defs.first().and_then(|d| d.get("cashToCoins")), "60000") {
        Some(v) if v > 0.0 => v.floor() as i64,
        _ => 60000,
    }
}

/// rules.ts:32 `loadCollectibleUnlockLevel`
pub fn load_collectible_unlock_level(path: &Path) -> i64 {
    let defs = load_definition_attributes(path);
    match num(defs.first().and_then(|d| d.get("collectibleUnlockLevel")), "6") {
        Some(v) if v >= 1.0 => v.floor() as i64,
        _ => 6,
    }
}

/// rules.ts:38 `loadConstructionTimeBySku`: sku -> milliseconds.
pub fn load_construction_time_by_sku(path: &Path) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    for d in load_definition_attributes(path) {
        let sku = d.get("sku").map(|s| s.trim().to_string()).unwrap_or_default();
        let minutes = num(d.get("constructionTime"), "0");
        match minutes {
            Some(m) if !sku.is_empty() && m > 0.0 => {
                out.insert(sku, (m * 60.0 * 1000.0).round() as i64);
            }
            _ => {}
        }
    }
    out
}

/// rules.ts:50 `loadGoldPackageRewards`
pub fn load_gold_package_rewards(path: &Path) -> HashMap<String, GoldPackageReward> {
    let mut out = HashMap::new();
    for d in load_definition_attributes(path) {
        let item_id = d.get("item_id").map(|s| s.trim().to_string()).unwrap_or_default();
        let gold = num(d.get("gold"), "0");
        let free = num(d.get("freeGold"), "0");
        if let (false, Some(g), Some(f)) = (item_id.is_empty(), gold, free) {
            out.insert(
                item_id,
                GoldPackageReward { gold: g.max(0.0).floor() as i64, free_gold: f.max(0.0).floor() as i64 },
            );
        }
    }
    out
}

/// rules.ts:67 `loadLevelXpThresholds`
pub fn load_level_xp_thresholds(path: &Path) -> Vec<f64> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"<level\b([^>]*)/>").unwrap());
    let Ok(xml) = std::fs::read_to_string(path) else { return vec![0.0] };
    let thresholds: Vec<f64> = re
        .captures_iter(&xml)
        .filter_map(|c| {
            let attrs = parse_xml_attributes(&c[1]);
            let v = crate::util::js_string_to_number(attrs.get("xpneed").map(String::as_str).unwrap_or(""));
            v.is_finite().then_some(v)
        })
        .collect();
    if thresholds.is_empty() { vec![0.0] } else { thresholds }
}
