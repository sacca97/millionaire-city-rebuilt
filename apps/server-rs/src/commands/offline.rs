//! Package "offline-features": missions, poll manager, daily rewards, investments, upgrades, no-op commands
//! (commandHandlers.ts:260-290 reads, :303-376 envelopes, :380-690 handlers, :1511-1590 missions / poll manager,
//! commandHandlers/offline.ts through `offline_lib.rs`).

use super::money::{apply_money_security_snapshot_with_positive_delta_fallback, apply_positive_money_security_deltas, has_money_security_snapshot};
use super::offline_lib::{
    add_to_profile, adjust_storage, apply_daily_reward_given, daily_reward_claim_allowed, find_investment, get_daily_reward_definition,
    get_mission_reward, invest, refresh_daily_rewards_info, refresh_investments, step_mission,
};
use super::state::{extract_incoming_element, parse_count_chunk_set, to_record, upsert_count_chunk_element, CountChunkSet};
use super::universe::{
    get_universe_profile, is_upgrade_eligible_item, js_str_or, non_null, resolve_target_owner_id, resolve_upgrade_owner_id, DEFAULT_USER_ID,
};
use super::npc_friends::visitor_upgrades_per_day;
use super::upgrades::{get_local_day_key, get_stored_upgrade_records, set_stored_upgrade_records, UpgradeRecord};
use super::{CommandService, CommandTable, Handler};
use crate::encoding::sanitize_for_client_xml;
use crate::protocol::packet;
use crate::repository::tags;
use crate::save_defaults::normalize_completed_tutorial_universe;
use crate::save_tree::{
    create_element, find_element_child, get_element_children, get_or_create_element_child, parse_chunk_set, upsert_chunk_element,
    upsert_element_child,
};
use crate::util::{js_number, js_number_to_string, js_string_or_empty, js_string_to_number, now_ms};
use serde_json::{json, Map, Value};

/// `createNeighborUniverse(targetUserId, bossGenre)` (saveDefaults/neighbors.ts:36).
fn create_neighbor_universe(id: i64, boss_genre: i64) -> Option<Value> {
    crate::save_defaults::create_neighbor_universe(id as f64, boss_genre as f64)
}

fn payload_of(command: &Value) -> Value {
    non_null(command.get("_dat")).cloned().unwrap_or_else(|| json!({}))
}

fn cmd_name(command: &Value) -> &str {
    command.get("_cmd").and_then(Value::as_str).unwrap_or("")
}

/// `Number(x ?? default)`
fn num_default(value: Option<&Value>, default: &str) -> f64 {
    match non_null(value) {
        Some(v) => js_number(Some(v)),
        None => js_string_to_number(default),
    }
}

/// `Number(x ?? "0") || 0`
fn num_or_zero(value: Option<&Value>) -> f64 {
    let n = num_default(value, "0");
    if n.is_nan() { 0.0 } else { n }
}

fn set_key(node: &mut Value, key: &str, value: String) {
    if let Some(o) = node.as_object_mut() {
        o.insert(key.to_string(), Value::String(value));
    }
}

fn answer_sanitized(svc: &CommandService, user_id: i64, name: &str, raw: Value) -> Result<Vec<Value>, String> {
    Ok(vec![packet(name, sanitize_for_client_xml(&raw), Some(svc.sync(user_id)))])
}

// ---- reads ------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:260 -> `buildUpgradesListDocument` :595 (GamePlay upgrades list for the visited city).
fn get_upgrades_list(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    let payload = payload_of(command);
    let owner_id = resolve_target_owner_id(&payload, "userId");
    let mut player = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let (visitor_ext_id, boss_genre) = match get_universe_profile(&mut player) {
        Some(p) => (js_string_or_empty(p.get("extId")), num_default(p.get("bossGenre"), "0")),
        None => (String::new(), 0.0),
    };
    let mut neighbor = None;
    if owner_id != DEFAULT_USER_ID && owner_id.fract() == 0.0 {
        neighbor = create_neighbor_universe(owner_id as i64, boss_genre as i64);
    }
    let all = get_stored_upgrade_records(&svc.repository.get_document(user_id, tags::UPGRADES)?);
    let today = get_local_day_key(0);
    let owner_key = js_number_to_string(owner_id);
    let mut active: Vec<UpgradeRecord> = Vec::new();
    for record in all {
        if record.owner_id != owner_key || record.day_key != today {
            continue;
        }
        let target: Option<&mut Value> = if owner_id == DEFAULT_USER_ID { Some(&mut player) } else { neighbor.as_mut() };
        if target.map_or(false, |u| is_upgrade_eligible_item(u, &record.sid)) {
            active.push(record);
        }
    }
    let visitor_count = active.iter().filter(|r| r.visitor_ext_id == visitor_ext_id).count();
    let available = visitor_upgrades_per_day().saturating_sub(visitor_count);
    let children: Vec<Value> = active
        .iter()
        .map(|r| create_element("upgrade", &[("sid", r.sid.as_str()), ("extId", r.visitor_ext_id.as_str())], Vec::new()))
        .collect();
    let doc = create_element("upgradesList", &[("upgradesUniverseAvailable", available.to_string().as_str())], children);
    answer_sanitized(svc, user_id, "get_upgrades_list", doc)
}

/// commandHandlers.ts:272 (GamePlay.getDailyRewardsInfo :899-957): the daily document after `refreshDailyRewardsInfo`;
/// after a refresh the answer carries `answerCount` (stored only on reset, GamePlay.java:950/953).
fn get_daily_rewards_info(svc: &CommandService, user_id: i64, _command: &Value) -> Result<Vec<Value>, String> {
    let mut doc = svc.repository.get_document(user_id, tags::DAILY_BONUS)?;
    let refresh = refresh_daily_rewards_info(&mut doc, now_ms(), &mut || rand::random::<f64>());
    if refresh.changed {
        svc.repository.set_document(user_id, tags::DAILY_BONUS, &doc)?;
    }
    if let Some(count) = refresh.answer_count {
        set_key(&mut doc, "dailyRewardsCount", count);
    }
    answer_sanitized(svc, user_id, "get_daily_rewards_info", doc)
}

/// The stored investments document with finished investments advanced (state 2 -> 3) and saved (commandHandlers.ts:455).
fn load_investments_document(svc: &CommandService, user_id: i64) -> Result<Value, String> {
    let mut doc = svc.repository.get_document(user_id, tags::INVESTMENTS)?;
    if refresh_investments(&mut doc, now_ms()) {
        svc.repository.set_document(user_id, tags::INVESTMENTS, &doc)?;
    }
    Ok(doc)
}

/// commandHandlers.ts:290 -> `getInvestmentsDocument` :465 (GamePlay.java:610-695): view with `state < 11`.
fn get_investments_list(svc: &CommandService, user_id: i64, _command: &Value) -> Result<Vec<Value>, String> {
    let mut doc = load_investments_document(svc, user_id)?;
    let started = js_str_or(doc.get("investmentsStarted"), "0");
    let rewarded = js_str_or(doc.get("investmentsRewarded"), "0");
    let visible: Vec<Value> =
        get_element_children(&mut doc, "investmentsList").iter().filter(|e| num_default(e.get("state"), "1") < 11.0).cloned().collect();
    let mut view: Map<String, Value> = doc.as_object().cloned().unwrap_or_default();
    view.insert("investmentsStarted".into(), Value::String(started));
    view.insert("investmentsRewarded".into(), Value::String(rewarded));
    view.insert("investmentsList".into(), Value::Array(visible));
    answer_sanitized(svc, user_id, "get_investments_list", Value::Object(view))
}

// ---- add_upgrade_item ---------------------------------------------------------------------------------------------------

/// commandHandlers.ts:543 `handleUpgradeCommand` (:163 dispatch).
fn add_upgrade_item(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    let payload = payload_of(command);
    apply_upgrade_command(svc, user_id, &payload)?;
    svc.repository.increment_session_sync(user_id)?;
    Ok(vec![packet(cmd_name(command), command.get("_dat").cloned().unwrap_or(Value::Null), Some(svc.sync(user_id)))])
}

/// commandHandlers.ts:628 `applyUpgradeCommand`.
fn apply_upgrade_command(svc: &CommandService, user_id: i64, payload: &Value) -> Result<(), String> {
    let sid = js_str_or(payload.get("sid"), "");
    let owner_id = resolve_upgrade_owner_id(payload, &sid, &|id, boss| create_neighbor_universe(id, boss));
    if sid.is_empty() {
        return Ok(());
    }
    let mut player = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let (visitor_ext_id, boss_genre) = match get_universe_profile(&mut player) {
        Some(p) => (js_string_or_empty(p.get("extId")), num_default(p.get("bossGenre"), "0")),
        None => (String::new(), 0.0),
    };
    let eligible = if owner_id == DEFAULT_USER_ID {
        is_upgrade_eligible_item(&mut player, &sid)
    } else if owner_id.fract() == 0.0 {
        create_neighbor_universe(owner_id as i64, boss_genre as i64).map_or(false, |mut u| is_upgrade_eligible_item(&mut u, &sid))
    } else {
        false
    };
    if !eligible {
        return Ok(());
    }

    let mut upgrades_document = svc.repository.get_document(user_id, tags::UPGRADES)?;
    let min_day = get_local_day_key(-7);
    let mut records: Vec<UpgradeRecord> =
        get_stored_upgrade_records(&upgrades_document).into_iter().filter(|r| r.day_key >= min_day).collect();
    let today = get_local_day_key(0);
    let owner_key = js_number_to_string(owner_id);
    if records.iter().any(|r| r.owner_id == owner_key && r.sid == sid && r.visitor_ext_id == visitor_ext_id && r.day_key == today) {
        return Ok(());
    }
    let visitor_count =
        records.iter().filter(|r| r.owner_id == owner_key && r.visitor_ext_id == visitor_ext_id && r.day_key == today).count();
    if visitor_count >= visitor_upgrades_per_day() {
        return Ok(());
    }
    records.push(UpgradeRecord {
        owner_id: owner_key,
        sid,
        visitor_ext_id,
        r#type: js_str_or(payload.get("type"), "0"),
        day_key: today,
    });
    set_stored_upgrade_records(&mut upgrades_document, &records);
    svc.repository.set_document(user_id, tags::UPGRADES, &upgrades_document)?;

    // SecurityNormal.upgradeAdd (SecurityNormal.java:691-702)
    let security = to_record(payload.get("security"));
    if has_money_security_snapshot(security) {
        if let Some(profile) = get_universe_profile(&mut player) {
            apply_positive_money_security_deltas(profile, security);
            svc.repository.set_document(user_id, tags::UNIVERSE, &player)?;
        }
    }
    Ok(())
}

// ---- mutation envelope (commandHandlers.ts:303-354 `handleMutationCommand`) -------------------------------------------------

/// `apply` returns false for a refused claim (answered `{success:"false"}` without a sync bump).
fn mutation(
    svc: &CommandService,
    user_id: i64,
    command: &Value,
    apply: fn(&CommandService, i64, &Value) -> Result<bool, String>,
) -> Result<Vec<Value>, String> {
    let name = cmd_name(command);
    let payload = command.get("_dat").cloned().unwrap_or(Value::Null);
    if !apply(svc, user_id, &payload)? {
        return Ok(vec![packet(name, json!({"success": "false"}), Some(svc.sync(user_id)))]);
    }
    svc.repository.increment_session_sync(user_id)?;
    Ok(vec![packet(name, payload, Some(svc.sync(user_id)))])
}

fn update_missions(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    mutation(svc, user_id, command, |s, u, p| apply_missions_mutation(s, u, p).map(|_| true))
}
fn update_pollmanager(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    mutation(svc, user_id, command, |s, u, p| apply_poll_manager_mutation(s, u, p).map(|_| true))
}
fn update_daily_reward(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    mutation(svc, user_id, command, apply_daily_reward_mutation)
}

/// commandHandlers.ts:476 `applyDailyRewardMutation` (GamePlay.updateDailyReward :1787-1834). False when refused.
fn apply_daily_reward_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Result<bool, String> {
    let sku = js_str_or(payload.get("sku"), "");
    let mut doc = svc.repository.get_document(user_id, tags::DAILY_BONUS)?;
    if !daily_reward_claim_allowed(&doc, &sku, now_ms()) {
        return Ok(false);
    }
    apply_daily_reward_given(&mut doc, &sku, now_ms());
    svc.repository.set_document(user_id, tags::DAILY_BONUS, &doc)?;

    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let security = to_record(payload.get("security"));
    if let Some(profile) = get_universe_profile(&mut universe) {
        if has_money_security_snapshot(security) {
            apply_money_security_snapshot_with_positive_delta_fallback(profile, security);
            svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
        } else if let Some(def) = get_daily_reward_definition(&sku) {
            let value = js_number(Some(&Value::String(def.bonus_value.clone().unwrap_or_else(|| "0".into()))));
            if value.is_finite() {
                let key = match def.bonus_type.as_deref() {
                    Some("exp") => "exp",
                    Some("cash") => "DCCash",
                    _ => "DCCoins",
                };
                add_to_profile(profile, key, if def.bonus_type.as_deref() == Some("item") { 0.0 } else { value });
                svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
            }
        }
    }

    if let Some(item) = security.and_then(|s| s.get("item")).and_then(Value::as_str) {
        if !item.is_empty() && item != "null" {
            let mut storage = svc.repository.get_document(user_id, tags::STORAGE)?;
            adjust_storage(&mut storage, item, 1.0);
            svc.repository.set_document(user_id, tags::STORAGE, &storage)?;
        }
    }
    Ok(true)
}

/// commandHandlers.ts:1511 `applyMissionsMutation` (GamePlay.updateMissions :1346-1389, SecurityNormal.java:535-545).
fn apply_missions_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Result<(), String> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let Some(profile) = get_universe_profile(&mut universe) else {
        return Ok(());
    };
    if let Some(incoming) = extract_incoming_element(payload.get("xml"), "Missions") {
        upsert_element_child(get_element_children(profile, "Profile"), "Missions", incoming);
        svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
        return Ok(());
    }
    let sku = js_str_or(payload.get("sku"), "");
    if sku.is_empty() {
        return Ok(());
    }
    let security = to_record(payload.get("security"));
    let flags = js_str_or(profile.get("flags"), "");
    let alt_reward = flags
        .split(',')
        .find(|f| f.starts_with("missionAltReward:"))
        .map(|f| f.split(':').nth(1).map(js_string_to_number).unwrap_or(f64::NAN))
        .unwrap_or(0.0);

    let (rewarded, reward) = {
        let profile_children = get_element_children(profile, "Profile");
        let missions_entry = get_or_create_element_child(profile_children, "Missions");
        let mission_children = get_element_children(missions_entry, "Missions");
        let pick = |tag: &str, ch: &Vec<Value>| parse_chunk_set(find_element_child(ch, tag).map(|i| &ch[i]));
        let mut up = pick("Up", mission_children);
        let mut reached = pick("Reached", mission_children);
        let mut given = pick("Given", mission_children);
        let reward = if reached.contains(&sku) && !given.contains(&sku) { get_mission_reward(&sku, alt_reward) } else { None };
        let rewarded = step_mission(&mut up, &mut reached, &mut given, &sku);
        upsert_chunk_element(mission_children, "Up", &up);
        upsert_chunk_element(mission_children, "Reached", &reached);
        upsert_chunk_element(mission_children, "Given", &given);
        (rewarded, reward)
    };

    if let (true, Some(reward)) = (rewarded, reward) {
        let before = [num_or_zero(profile.get("exp")), num_or_zero(profile.get("DCCoins")), num_or_zero(profile.get("DCCash"))];
        let target = [before[0] + reward.exp, before[1] + reward.coins, before[2] + reward.cash];
        let snap = |k: &str| js_number(security.and_then(|s| s.get(k)));
        let now = [snap("expNow"), snap("coinsNow"), snap("cashNow")];
        for (i, key) in ["exp", "DCCoins", "DCCash"].iter().enumerate() {
            let v = if now[i].is_finite() { now[i].max(target[i]) } else { target[i] };
            set_key(profile, key, js_number_to_string(v));
        }
        if !reward.items.is_empty() {
            let mut storage = svc.repository.get_document(user_id, tags::STORAGE)?;
            for (item_sku, amount) in &reward.items {
                adjust_storage(&mut storage, item_sku, if *amount == 0.0 { 1.0 } else { *amount });
            }
            svc.repository.set_document(user_id, tags::STORAGE, &storage)?;
        }
    }
    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
    Ok(())
}

/// commandHandlers.ts:1569 `applyPollManagerMutation`.
fn apply_poll_manager_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Result<(), String> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let Some(profile) = get_universe_profile(&mut universe) else {
        return Ok(());
    };
    if let Some(incoming) = extract_incoming_element(payload.get("xml"), "PollManager") {
        upsert_element_child(get_element_children(profile, "Profile"), "PollManager", incoming);
        normalize_completed_tutorial_universe(&mut universe);
        svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
        return Ok(());
    }
    let ty = js_str_or(payload.get("type"), "");
    if ty.is_empty() {
        return Ok(());
    }
    let sku = format!("{ty}{}", js_str_or(payload.get("parameter"), ""));
    {
        let profile_children = get_element_children(profile, "Profile");
        let entry = get_or_create_element_child(profile_children, "PollManager");
        let poll_children = get_element_children(entry, "PollManager");
        let mut counts: CountChunkSet = parse_count_chunk_set(find_element_child(poll_children, "Count").map(|i| &poll_children[i]));
        let action = js_str_or(payload.get("action"), "").to_lowercase();
        let new_value = if action == "add" {
            counts.iter().find(|(k, _)| *k == sku).map_or(0.0, |(_, v)| *v) + 1.0
        } else {
            let value = num_default(payload.get("value"), "0");
            if !value.is_finite() {
                return Ok(());
            }
            value
        };
        match counts.iter_mut().find(|(k, _)| *k == sku) {
            Some(e) => e.1 = new_value,
            None => counts.push((sku, new_value)),
        }
        upsert_count_chunk_element(poll_children, "Count", &counts);
    }
    normalize_completed_tutorial_universe(&mut universe);
    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
    Ok(())
}

// ---- no-op commands (commandHandlers.ts:356 `handleNoopCommand`) ----------------------------------------------------------

fn noop(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    let name = cmd_name(command);
    let payload = payload_of(command);
    let response = if name == "ask_for_help" || name == "ask_for_cash" {
        // GamePlay.helpAccelerate (GamePlay.java:1105-1133)
        json!({"help_id": "null", "time_passed": "0", "time_total": "0"})
    } else if name.starts_with("invest_") {
        handle_invest_command(svc, user_id, name, &payload)?
    } else if name == "postReward" {
        // GamePlay.rewardPost (GamePlay.java:2662-2718)
        json!({"postCount": 0})
    } else {
        json!({"success": "true"})
    };
    svc.repository.increment_session_sync(user_id)?;
    Ok(vec![packet(name, response, Some(svc.sync(user_id)))])
}

/// commandHandlers.ts:380 `handleInvestCommand` (GamePlay.java:1135-1284) on the STORED investments document.
fn handle_invest_command(svc: &CommandService, user_id: i64, cmd: &str, payload: &Value) -> Result<Value, String> {
    let mut doc = load_investments_document(svc, user_id)?;
    let ext_id = js_str_or(payload.get("fExtId"), "");
    let now = now_ms();
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let coins = match get_universe_profile(&mut universe) {
        Some(p) => num_default(p.get("DCCoins"), "0"),
        None => 0.0,
    };
    let inv = invest();
    match cmd {
        "invest_on_friend" => {
            if ext_id.is_empty() || find_investment(&mut doc, &ext_id).is_some() || coins < inv.inversion {
                return Ok(json!({"id": "null"}));
            }
            let id = now.to_string();
            let time = js_number_to_string(inv.time_ms);
            get_element_children(&mut doc, "investmentsList").push(create_element(
                "investment",
                &[
                    ("extId", ext_id.as_str()),
                    ("userId", "-1"),
                    ("value", "0"),
                    ("time", time.as_str()),
                    ("remindTime", "0"),
                    ("state", "2"),
                    ("startedAt", id.as_str()),
                    ("id", id.as_str()),
                ],
                Vec::new(),
            ));
            svc.repository.set_document(user_id, tags::INVESTMENTS, &doc)?;
            Ok(json!({"id": id}))
        }
        "invest_on_friend_reminder" => {
            let Some(entry) = find_investment(&mut doc, &ext_id) else {
                return Ok(json!({"id": "null"}));
            };
            set_key(entry, "updatedAt", now.to_string());
            let id = js_str_or(entry.get("id"), "0");
            svc.repository.set_document(user_id, tags::INVESTMENTS, &doc)?;
            Ok(json!({"id": id}))
        }
        "invest_get_inversion" => Ok(json!({"success": "false"})),
        "invest_cancel" => {
            let children = get_element_children(&mut doc, "investmentsList");
            let index = children
                .iter()
                .position(|e| e.get("investment").map_or(false, Value::is_array) && js_string_or_empty(e.get("extId")) == ext_id);
            match index {
                Some(i) if num_default(children[i].get("state"), "1") < 3.0 => {
                    children.remove(i);
                    svc.repository.set_document(user_id, tags::INVESTMENTS, &doc)?;
                    Ok(json!({"success": "true"}))
                }
                _ => Ok(json!({"success": "false"})),
            }
        }
        "invest_results" => {
            let Some(entry) = find_investment(&mut doc, &ext_id) else {
                return Ok(json!({"success": "false"}));
            };
            if num_default(entry.get("state"), "0") != 3.0 {
                return Ok(json!({"success": "false"}));
            }
            let succeeded = num_default(entry.get("value"), "0") >= inv.target;
            set_key(entry, "state", if succeeded { "10" } else { "11" }.to_string());
            if succeeded {
                let n = num_default(doc.get("investmentsRewarded"), "0") + 1.0;
                set_key(&mut doc, "investmentsRewarded", js_number_to_string(n));
            }
            svc.repository.set_document(user_id, tags::INVESTMENTS, &doc)?;
            Ok(json!({"success": if succeeded { "true" } else { "false" }}))
        }
        _ => Ok(json!({"success": "false"})),
    }
}

pub const COMMANDS: CommandTable = &[
    ("get_upgrades_list", get_upgrades_list as Handler),
    ("add_upgrade_item", add_upgrade_item as Handler),
    ("get_daily_rewards_info", get_daily_rewards_info as Handler),
    ("update_daily_reward", update_daily_reward as Handler),
    ("get_investments_list", get_investments_list as Handler),
    ("update_missions", update_missions as Handler),
    ("update_pollmanager", update_pollmanager as Handler),
    ("ask_for_help", noop as Handler),
    ("ask_for_cash", noop as Handler),
    ("postReward", noop as Handler),
    ("invest_on_friend", noop as Handler),
    ("invest_on_friend_reminder", noop as Handler),
    ("invest_get_inversion", noop as Handler),
    ("invest_cancel", noop as Handler),
    ("invest_results", noop as Handler),
];
