//! Differential test for `commands/offline_lib.rs` and `commands/collectibles_lib.rs` (package libs-b).
//! Replays `tests/fixtures/libs-b.jsonl`, produced by `tests/fixtures/libs-b.ts` running the TS library functions
//! (recorded once from the former TS server; static now), and asserts identical outputs and in-place mutations
//! (compared as serialized JSON, so key insertion order counts).
//!
//! The server is a binary crate, so the modules under test are compiled into this test crate through `#[path]`; the shared
//! layers they use (`config`, `rules`, `save_tree`, `util`) are included the same way, `commands::universe` is a small stand-in.
#![allow(dead_code, unused_imports)]

#[path = "../src/config.rs"]
mod config;
#[path = "../src/rules.rs"]
mod rules;
#[path = "../src/save_tree.rs"]
mod save_tree;
#[path = "../src/util.rs"]
mod util;

#[path = "../src/commands/collectibles_lib.rs"]
pub mod collectibles_lib;
#[path = "../src/commands/offline_lib.rs"]
pub mod offline_lib;

/// Test-only stand-in for the three `commands::universe` helpers the libraries call (the real module drags in the repository
/// and the fresh-save defaults, which would couple this test to unrelated packages). Same semantics as `universe.ts`
/// `getCompanyEntryByWhose`, `isItemElement`, `isHouseSku`; the real ones are covered by their own tests.
pub mod universe {
    use serde_json::Value;

    pub fn get_company_entry_by_whose<'a>(universe: &'a mut Value, whose: &str) -> Option<&'a mut Value> {
        let world = universe.get_mut("universe")?.as_array_mut()?.iter_mut().find(|e| e.get("World").map_or(false, Value::is_array))?;
        world.get_mut("World")?.as_array_mut()?.iter_mut().find(|e| {
            e.get("Company").map_or(false, Value::is_array) && crate::util::js_string_or_empty(e.get("whose")) == whose
        })
    }

    pub fn is_item_element(entry: &Value) -> bool {
        entry.get("Item").map_or(false, Value::is_array)
    }

    pub fn is_house_sku(sku: &str) -> bool {
        sku.starts_with("houses_") || sku == "house_001"
    }
}

/// The libraries address each other as `crate::commands::<module>`; mirror that namespace.
mod commands {
    pub use crate::{collectibles_lib, offline_lib, universe};
}

use commands::collectibles_lib as c;
use commands::offline_lib as o;
use indexmap::{IndexMap, IndexSet};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

/// JS number -> JSON (what `JSON.stringify` prints: NaN/Infinity are null, integral values have no fraction).
fn n(f: f64) -> Value {
    if !f.is_finite() {
        Value::Null
    } else if f == f.trunc() && f.abs() < 1e15 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}

fn opt_s(s: Option<String>) -> Value {
    s.map_or(Value::Null, Value::String)
}

/// Canonical form for comparison: integral floats become integers.
fn canon(v: &Value) -> Value {
    match v {
        Value::Number(x) => n(x.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(canon).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), canon(v))).collect()),
        other => other.clone(),
    }
}

/// A numeric argument: a JSON number or the strings "NaN" / "Infinity" / "-Infinity".
fn num(v: &Value) -> f64 {
    match v {
        Value::String(s) => match s.as_str() {
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            other => other.parse().unwrap(),
        },
        other => other.as_f64().expect("numeric argument"),
    }
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

fn ms(v: &Value) -> i64 {
    v.as_i64().expect("integer ms")
}

fn str_set(v: &Value) -> BTreeSet<String> {
    v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

fn set_json(set: &BTreeSet<String>) -> Value {
    Value::Array(set.iter().map(|x| Value::String(x.clone())).collect())
}

fn mk_state(v: &Value) -> c::CollectiblesState {
    let pairs = |key: &str| v[key].as_array().unwrap().clone();
    c::CollectiblesState {
        object_counts: pairs("objectCounts").iter().map(|p| (p[0].as_str().unwrap().to_string(), p[1].as_f64().unwrap())).collect::<IndexMap<_, _>>(),
        rewards: pairs("rewards").iter().map(|p| p.as_str().unwrap().to_string()).collect::<IndexSet<_>>(),
        pending_by_sid: pairs("pendingBySid").iter().map(|p| (p[0].as_str().unwrap().to_string(), p[1].as_str().unwrap().to_string())).collect::<IndexMap<_, _>>(),
    }
}

fn service_def_json(d: Option<o::ServiceDefinition>) -> Value {
    match d {
        None => Value::Null,
        Some(d) => json!({
            "durationMs": n(d.duration_ms), "extraMs": n(d.extra_ms), "priceCoins": n(d.price_coins), "priceCash": n(d.price_cash),
            "offerPriceCoins": n(d.offer_price_coins), "offerPriceCash": n(d.offer_price_cash),
            "timeExpiredMs": n(d.time_expired_ms), "maxExponent": n(d.max_exponent)
        }),
    }
}

/// Insert `key` only when the value is present (`undefined` properties vanish in `JSON.stringify`).
fn obj(entries: Vec<(&str, Option<Value>)>) -> Value {
    let mut m = Map::new();
    for (k, v) in entries {
        if let Some(v) = v {
            m.insert(k.to_string(), v);
        }
    }
    Value::Object(m)
}

fn run(name: &str, args: &mut Vec<Value>, randoms: &[f64]) -> Value {
    let mut idx = 0usize;
    let mut random = || {
        let r = randoms[idx % randoms.len()];
        idx += 1;
        r
    };
    match name {
        "constants" => {
            let i = o::invest();
            json!({
                "DAILY_REWARD_TIME_MS": n(o::DAILY_REWARD_TIME_MS), "DAILY_BONUS_TIME_MS": n(o::daily_bonus_time_ms()),
                "DAILY_BONUS_COINS": n(o::daily_bonus_coins()), "NEW_ITEMS_REV": o::new_items_rev(),
                "OFFLINE_FRIEND_COMPANY_VALUE": n(o::OFFLINE_FRIEND_COMPANY_VALUE),
                "INVEST": { "timeMs": n(i.time_ms), "target": n(i.target), "inversion": n(i.inversion), "rewardCoins": n(i.reward_coins), "rewardCash": n(i.reward_cash) }
            })
        }
        "getServiceDefinition" => service_def_json(o::get_service_definition(s(&args[0]), num(&args[1]))),
        "applyServicePurchase" => {
            let (a0, rest) = args.split_first_mut().unwrap();
            Value::Bool(o::apply_service_purchase(a0, s(&rest[0]), num(&rest[1]), ms(&rest[2])))
        }
        "projectServiceTimes" => {
            let now = ms(&args[1]);
            Value::Bool(o::project_service_times(&mut args[0], now))
        }
        "applyServicePresentationShown" => {
            let sku = s(&args[1]).to_string();
            Value::Bool(o::apply_service_presentation_shown(&mut args[0], &sku))
        }
        "applyProfileFlag" => {
            let (name, value) = (s(&args[1]).to_string(), s(&args[2]).to_string());
            Value::Bool(o::apply_profile_flag(&mut args[0], &name, &value))
        }
        "addUnlockedItem" => {
            let sku = s(&args[1]).to_string();
            Value::Bool(o::add_unlocked_item(&mut args[0], &sku))
        }
        "adjustStorage" => {
            let (sku, delta) = (s(&args[1]).to_string(), num(&args[2]));
            Value::Bool(o::adjust_storage(&mut args[0], &sku, delta))
        }
        "getStorageAmount" => {
            let sku = s(&args[1]).to_string();
            n(o::get_storage_amount(&mut args[0], &sku))
        }
        "getBoxPrize" => match o::get_box_prize(s(&args[0])) {
            None => Value::Null,
            Some(b) => obj(vec![("sku", Some(b.sku.into())), ("box", b.r#box.map(Value::String)), ("type", b.r#type.map(Value::String)), ("value", b.value.map(Value::String))]),
        },
        "getAcceleratorStorage" => match o::get_accelerator_storage(s(&args[0])) {
            None => Value::Null,
            Some(a) => obj(vec![("storageSku", a.storage_sku.map(Value::String)), ("percent", Some(n(a.percent)))]),
        },
        "levelFromExp" => n(o::level_from_exp(num(&args[0]))),
        "newsFeedReward" => {
            let r = o::news_feed_reward(s(&args[0]));
            json!({"exp": n(r.exp), "coins": n(r.coins), "cash": n(r.cash)})
        }
        "addToProfile" => {
            let (key, delta) = (s(&args[1]).to_string(), num(&args[2]));
            o::add_to_profile(&mut args[0], &key, delta);
            Value::Null
        }
        "getDailyRewardDefinition" => match o::get_daily_reward_definition(s(&args[0])) {
            None => Value::Null,
            Some(d) => obj(vec![
                ("sku", Some(d.sku.into())), ("bonusType", d.bonus_type.map(Value::String)), ("bonusValue", d.bonus_value.map(Value::String)),
                ("group", Some(n(d.group))), ("chances", Some(n(d.chances))),
            ]),
        },
        "getDailyRewardGroupByDay" => n(o::get_daily_reward_group_by_day(num(&args[0]))),
        "pickDailyRewardByDay" => opt_s(o::pick_daily_reward_by_day(num(&args[0]), &mut random)),
        "refreshDailyRewardsInfo" => {
            let now = ms(&args[1]);
            let r = o::refresh_daily_rewards_info(&mut args[0], now, &mut random);
            obj(vec![("changed", Some(r.changed.into())), ("reset", Some(r.reset.into())), ("answerCount", r.answer_count.map(Value::String))])
        }
        "dailyRewardClaimAllowed" => Value::Bool(o::daily_reward_claim_allowed(&args[0], s(&args[1]), ms(&args[2]))),
        "applyDailyRewardGiven" => {
            let (sku, now) = (s(&args[1]).to_string(), ms(&args[2]));
            o::apply_daily_reward_given(&mut args[0], &sku, now);
            Value::Null
        }
        "findInvestment" => {
            let ext = s(&args[1]).to_string();
            o::find_investment(&mut args[0], &ext).map_or(Value::Null, |v| v.clone())
        }
        "refreshInvestments" => {
            let now = ms(&args[1]);
            Value::Bool(o::refresh_investments(&mut args[0], now))
        }
        "getMissionReward" => match o::get_mission_reward(s(&args[0]), num(&args[1])) {
            None => Value::Null,
            Some(r) => json!({
                "coins": n(r.coins), "cash": n(r.cash), "exp": n(r.exp),
                "items": r.items.iter().map(|(sku, amount)| json!({"sku": sku, "amount": n(*amount)})).collect::<Vec<_>>()
            }),
        },
        "stepMission" => {
            let (mut up, mut reached, mut given) = (str_set(&args[0]), str_set(&args[1]), str_set(&args[2]));
            let rewarded = o::step_mission(&mut up, &mut reached, &mut given, s(&args[3]));
            args[0] = set_json(&up);
            args[1] = set_json(&reached);
            args[2] = set_json(&given);
            json!({ "rewarded": rewarded })
        }

        // ---- collectibles ----
        "collectibleDropChance" => n(c::collectible_drop_chance(s(&args[0]))),
        "normalizeCollectiblesDocument" => Value::Bool(c::normalize_collectibles_document(&mut args[0])),
        "normalizeCollectiblePendingDocument" => Value::Bool(c::normalize_collectible_pending_document(&mut args[0])),
        "readCollectiblesState" => {
            let st = c::read_collectibles_state(&mut args[0]);
            json!({
                "objectCounts": st.object_counts.iter().map(|(k, v)| json!([k, n(*v)])).collect::<Vec<_>>(),
                "rewards": st.rewards.iter().collect::<Vec<_>>(),
                "pendingBySid": st.pending_by_sid.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>()
            })
        }
        "writeCollectiblesState" => {
            let st = mk_state(&args[1]);
            c::write_collectibles_state(&mut args[0], &st);
            Value::Null
        }
        "removePendingFriendCollectible" => {
            let (ext, sku) = (s(&args[1]).to_string(), s(&args[2]).to_string());
            Value::Bool(c::remove_pending_friend_collectible(&mut args[0], &ext, &sku))
        }
        "projectPendingCollectiblesOnUniverse" => {
            let (u, rest) = args.split_first_mut().unwrap();
            c::project_pending_collectibles_on_universe(u, &mut rest[0]);
            Value::Null
        }
        "collapsePendingCollectibleState" => {
            c::collapse_pending_collectible_state(&mut args[0]);
            Value::Null
        }
        "isCollectibleAwardMutation" => Value::Bool(c::is_collectible_award_mutation(&args[0], &args[1])),
        "isCollectibleFeatureUnlocked" => {
            let p = if args[0].is_null() { None } else { Some(&args[0]) };
            Value::Bool(c::is_collectible_feature_unlocked(p))
        }
        "shouldAwardCollectibleDrop" => Value::Bool(c::should_award_collectible_drop(&args[0], &args[1])),
        "pickCollectibleSkuForHouse" => opt_s(c::pick_collectible_sku_for_house(s(&args[0]), s(&args[1]), &mk_state(&args[2]))),
        "resolvePlaneRewardSkuForCollectibleClaim" => opt_s(c::resolve_plane_reward_sku_for_collectible_claim(s(&args[0]))),
        "resolveHeadQuarterRewardSkuForCollectibleClaim" => opt_s(c::resolve_head_quarter_reward_sku_for_collectible_claim(s(&args[0]))),
        "getTradeInCollectibleSkus" => json!(c::get_trade_in_collectible_skus(s(&args[0]))),
        "resolveItemRewardCollectibleGroupFromMutation" => {
            opt_s(c::resolve_item_reward_collectible_group_from_mutation(&args[0], &args[1]))
        }
        "pushAskedCollectible" => Value::String(c::push_asked_collectible(s(&args[0]), s(&args[1]))),
        "localeCompare" => Value::from(match c::locale_compare(s(&args[0]), s(&args[1])) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }),
        other => panic!("unknown fixture function {other}"),
    }
}

#[test]
fn replays_ts_fixtures() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/libs-b.jsonl");
    let text = std::fs::read_to_string(path).expect("tests/fixtures/libs-b.jsonl missing");
    let lines: Vec<Value> = text.lines().filter(|l| !l.is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect();
    assert!(!lines.is_empty());
    // The fixture pins the time zone it was generated in; local-time behaviour (setHours(0,10,0,0)) must match. Set it before
    // any chrono call (this crate has a single test, so there is no race with other threads).
    let tz = lines[0]["tz"].as_str().expect("tz").to_string();
    std::env::set_var("TZ", &tz);

    let mut failures = Vec::new();
    let mut per_fn: std::collections::BTreeMap<String, usize> = Default::default();
    for line in &lines {
        let name = line["fn"].as_str().unwrap();
        let mut args = line["input"]["args"].as_array().unwrap().clone();
        let randoms: Vec<f64> = line["input"]["randoms"].as_array().unwrap().iter().map(|r| r.as_f64().unwrap()).collect();
        let output = run(name, &mut args, &randoms);
        let got = (canon(&output).to_string(), canon(&Value::Array(args)).to_string());
        let want = (canon(&line["output"]).to_string(), canon(&line["mutatedInput"]).to_string());
        *per_fn.entry(name.to_string()).or_default() += 1;
        if got != want {
            failures.push(format!("{name} input={}\n  want output={} mutated={}\n  got  output={} mutated={}", line["input"]["args"], want.0, want.1, got.0, got.1));
        }
    }
    eprintln!("replayed {} cases over {} functions", lines.len(), per_fn.len());
    for (f, k) in &per_fn {
        assert!(*k >= 5 || f == "constants", "{f} has only {k} cases");
    }
    if !failures.is_empty() {
        let shown: Vec<_> = failures.iter().take(15).cloned().collect();
        panic!("{} of {} cases differ:\n{}", failures.len(), lines.len(), shown.join("\n"));
    }
}
