//! Package "items-map": `update_item`, `update_map`, `update_plots`, `update_next_rent` (commandHandlers.ts:1253-1510, :514).
//!
//! The four commands are `MUTATION_COMMANDS` (commandHandlers.ts:303-354): apply, `incrementSessionSync`, answer
//! `[echo of payload, ...sideEffects]` (see `mutation_envelope`).
//!
//! Aliasing note: the TS mutates live objects of the in-memory `universe` document. Here the item entry is edited as an owned
//! value up to the point where the TS puts it into the company (`placement`), and through its `(company, item)` position in the
//! document afterwards, so every later read sees exactly what the TS sees.

use super::{CommandService, CommandTable, Handler};
use crate::commands::collectibles::{apply_reward, get_normalized_collectibles_document};
use crate::commands::collectibles_lib::{
    collapse_pending_collectible_state, is_collectible_award_mutation, is_collectible_feature_unlocked,
    pick_collectible_sku_for_house, read_collectibles_state, resolve_item_reward_collectible_group_from_mutation,
    should_award_collectible_drop, write_collectibles_state,
};
use crate::commands::money::{apply_money_security_snapshot_with_positive_delta_fallback, has_money_security_snapshot};
use crate::commands::offline_lib::{adjust_storage, rules_root};
use crate::commands::plots::{get_plot_states, unlock_next_plots};
use crate::commands::state::{
    extract_incoming_item_entry, extract_state_attributes, has_state_mutation, to_record,
};
use crate::commands::universe::{
    create_item_entry, ensure_head_quarter_decorations, ensure_state_element, get_map_entry, get_plots_entry,
    get_universe_profile, get_world_container, is_house_sku, js_str_or, non_null, DEFAULT_USER_ID,
};
use crate::commands::upgrades::{get_stored_upgrade_records, set_stored_upgrade_records};
use crate::protocol::packet;
use crate::repository::tags;
use crate::rules::load_definition_attributes;
use crate::save_tree::{
    create_element, find_element_child, get_element_children, get_or_create_element_child, has_children,
    parse_chunk_set, serialize_chunk_set,
};
use crate::util::{js_number, js_number_to_string, js_string, js_string_or_empty, js_string_to_number, now_ms};
use rand::Rng;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

type Res<T> = Result<T, String>;

/// A side-effect packet of a mutation: `(cmd, dat)`; `_sync` is filled in by the envelope.
type SideEffect = (String, Value);

// ---------------------------------------------------------------------------------------------------------------------
// shared mutation envelope
// ---------------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:303-354 `handleMutationCommand` tail: `incrementSessionSync`, then `[echo of payload, ...sideEffects]`
/// with every packet carrying the new sync.
fn mutation_envelope(
    svc: &CommandService,
    user_id: i64,
    command: &Value,
    payload: &Value,
    side_effects: Vec<SideEffect>,
) -> Res<Vec<Value>> {
    let name = command.get("_cmd").and_then(Value::as_str).unwrap_or("");
    svc.repository.increment_session_sync(user_id)?;
    let sync = svc.sync(user_id);
    let mut out = vec![packet(name, payload.clone(), Some(sync))];
    for (cmd, dat) in side_effects {
        out.push(packet(&cmd, dat, Some(sync)));
    }
    Ok(out)
}

/// `command._dat as JsonObject`: reading a property of a missing `_dat` throws in the TS (-> offlineError response).
fn payload_of(command: &Value) -> Res<&Value> {
    match command.get("_dat") {
        None | Some(Value::Null) => Err("TypeError: Cannot read properties of undefined".to_string()),
        Some(v) => Ok(v),
    }
}

/// commandHandlers.ts:313 `update_item`.
fn update_item(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    let payload = payload_of(command)?;
    let side_effects = apply_item_mutation(svc, user_id, payload)?;
    mutation_envelope(svc, user_id, command, payload, side_effects)
}

/// commandHandlers.ts:316 `update_map`.
fn update_map(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    let payload = payload_of(command)?;
    apply_map_mutation(svc, user_id, payload)?;
    mutation_envelope(svc, user_id, command, payload, Vec::new())
}

/// commandHandlers.ts:319 `update_plots`.
fn update_plots(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    let payload = payload_of(command)?;
    apply_plots_mutation(svc, user_id, payload)?;
    mutation_envelope(svc, user_id, command, payload, Vec::new())
}

/// commandHandlers.ts:334 `update_next_rent`.
fn update_next_rent(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    let payload = payload_of(command)?;
    apply_next_rent_mutation(svc, user_id, payload)?;
    mutation_envelope(svc, user_id, command, payload, Vec::new())
}

pub const COMMANDS: CommandTable = &[
    ("update_item", update_item as Handler),
    ("update_map", update_map as Handler),
    ("update_plots", update_plots as Handler),
    ("update_next_rent", update_next_rent as Handler),
];

// ---------------------------------------------------------------------------------------------------------------------
// small JS-flavoured helpers
// ---------------------------------------------------------------------------------------------------------------------

/// `String(x ?? "")`
fn s(value: Option<&Value>) -> String {
    js_string_or_empty(value)
}

/// commandHandlers.ts:1612 `nonEmptyString`: a string value with at least one character.
fn non_empty_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(v)) if !v.is_empty() => Some(v.clone()),
        _ => None,
    }
}

fn set_str(node: &mut Value, key: &str, value: String) {
    if let Some(obj) = node.as_object_mut() {
        obj.insert(key.to_string(), Value::String(value));
    }
}

/// `Math.max` (NaN wins).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// The `World` children list of the universe (the `{World: [...]}` entry's array).
fn world_list(universe: &mut Value) -> Option<&mut Vec<Value>> {
    get_world_container(universe)?.get_mut("World")?.as_array_mut()
}

/// universe.ts:114 `findItemEntry` as a position: `(index of the company in World, index of the item in its Company)`.
fn find_item_loc(universe: &mut Value, sid: &str) -> Option<(usize, usize)> {
    let world = world_list(universe)?;
    for (ci, company) in world.iter_mut().enumerate() {
        if !has_children(company, "Company") {
            continue;
        }
        let children = get_element_children(company, "Company");
        if let Some(ii) = children.iter().position(|e| has_children(e, "Item") && s(e.get("sid")) == sid) {
            return Some((ci, ii));
        }
    }
    None
}

/// universe.ts:60 `getCompanyEntryBySid` as a position (an empty sid matches nothing).
fn company_index_by_sid(universe: &mut Value, sid: &str) -> Option<usize> {
    if sid.is_empty() {
        return None;
    }
    world_list(universe)?.iter().position(|e| has_children(e, "Company") && s(e.get("sid")) == sid)
}

/// universe.ts:47 `getCompanyEntryByWhose` as a position.
fn company_index_by_whose(universe: &mut Value, whose: &str) -> Option<usize> {
    world_list(universe)?.iter().position(|e| has_children(e, "Company") && s(e.get("whose")) == whose)
}

fn company_children_mut(universe: &mut Value, ci: usize) -> &mut Vec<Value> {
    get_element_children(&mut world_list(universe).expect("world exists")[ci], "Company")
}

fn item_at_mut(universe: &mut Value, loc: (usize, usize)) -> &mut Value {
    &mut company_children_mut(universe, loc.0)[loc.1]
}

/// `findElementChild(getElementChildren(itemEntry, "Item"), "State")` as `&mut`.
fn item_state_mut(item: &mut Value) -> Option<&mut Value> {
    let children = get_element_children(item, "Item");
    let index = find_element_child(children, "State")?;
    Some(&mut children[index])
}

// ---------------------------------------------------------------------------------------------------------------------
// double rent (commandHandlers.ts:132, :1650-1675)
// ---------------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:1658 `WONDER_INCOME_MULTIPLIER_HOUSES`: wonderDefinitions.xml `incomeMultiplier` wonders targeting Houses.
fn wonder_income_multiplier_houses() -> &'static HashMap<String, f64> {
    static M: OnceLock<HashMap<String, f64>> = OnceLock::new();
    M.get_or_init(|| {
        let mut map = HashMap::new();
        for def in load_definition_attributes(&rules_root().join("wonderDefinitions.xml")) {
            if def.get("subtype").map(String::as_str) == Some("incomeMultiplier")
                && def.get("target").map(String::as_str) == Some("Houses")
            {
                let n = js_string_to_number(def.get("incomeValue").map(String::as_str).unwrap_or("0")).trunc();
                map.insert(def.get("sku").cloned().unwrap_or_default(), if n.is_nan() { 0.0 } else { n });
            }
        }
        map
    })
}

/// commandHandlers.ts:1667 `getDoubleRentHousesProbability`: sum of incomeValue of the player's fully built (State id 5)
/// incomeMultiplier wonders targeting Houses.
fn get_double_rent_houses_probability(universe: &mut Value) -> f64 {
    let mut total = 0.0;
    let wonders = wonder_income_multiplier_houses();
    let Some(world) = world_list(universe) else { return 0.0 };
    for company in world.iter_mut() {
        if !has_children(company, "Company") || s(company.get("whose")) != "0" {
            continue;
        }
        for item in get_element_children(company, "Company").iter_mut() {
            let Some(value) = wonders.get(&s(item.get("sku"))) else { continue };
            if !has_children(item, "Item") {
                continue;
            }
            let children = get_element_children(item, "Item");
            if let Some(i) = find_element_child(children, "State") {
                if s(children[i].get("id")) == "5" {
                    total += value;
                }
            }
        }
    }
    total
}

/// commandHandlers.ts:132 `rollDoubleRent` (SecurityNormal.java:466-481 + Server.java:265-278 +
/// GamePlay.initializeUserSpecialAttributes :2848-2890): when a house rent is collected (State 5 -> 1/14) the client's
/// `doubleRent` param consumes the prize; if none is pending a 0-99 roll is compared with the summed incomeValue of the
/// built incomeMultiplier wonders targeting Houses and, on a hit, `{_cmd:"doubleRent",_dat:"Houses"}` is pushed once.
fn roll_double_rent(
    svc: &CommandService,
    user_id: i64,
    universe: &mut Value,
    item_sku: &str,
    payload: &Value,
    previous_state_id: &str,
    previous_mode: &str,
) -> Option<SideEffect> {
    let new_mode = s(payload.get("mode"));
    if !is_house_sku(item_sku) || previous_state_id == "0" || previous_mode != "5" || (new_mode != "1" && new_mode != "14") {
        return None;
    }
    let mut available = svc.double_rent_houses_available.lock().unwrap_or_else(|e| e.into_inner());
    if non_null(payload.get("doubleRent")).is_some() {
        available.insert(user_id, false);
    }
    if available.get(&user_id).copied().unwrap_or(false) {
        return None;
    }
    let probability = get_double_rent_houses_probability(universe);
    let hit = (rand::thread_rng().gen::<f64>() * 100.0).floor() < probability;
    available.insert(user_id, hit);
    if hit {
        Some(("doubleRent".to_string(), Value::String("Houses".to_string())))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// item signature (commandHandlers.ts:1620-1642)
// ---------------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:1633 `getStableScalarRecord`: keys sorted, arrays / null / objects skipped, values `String()`-ed.
fn stable_scalar_record(value: &Value) -> Value {
    let mut keys: Vec<&String> = value.as_object().map(|o| o.keys().collect()).unwrap_or_default();
    keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let mut record = Map::new();
    for key in keys {
        let entry = &value[key.as_str()];
        if entry.is_array() || entry.is_null() || entry.is_object() {
            continue;
        }
        record.insert(key.clone(), Value::String(js_string(entry)));
    }
    Value::Object(record)
}

/// commandHandlers.ts:1620 `getItemMutationSignature`.
fn item_mutation_signature(item: &mut Value) -> String {
    let state = item_state_mut(item).map(|st| stable_scalar_record(st));
    let mut m = Map::new();
    for key in ["sid", "csid", "sku", "x", "y", "isSuspended"] {
        m.insert(key.to_string(), non_null(item.get(key)).cloned().unwrap_or_else(|| Value::String(String::new())));
    }
    m.insert("state".to_string(), state.unwrap_or_else(|| Value::Object(Map::new())));
    serde_json::to_string(&Value::Object(m)).unwrap_or_default()
}

// ---------------------------------------------------------------------------------------------------------------------
// collectible hooks (commandHandlers.ts:1100-1250)
// ---------------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:1171 `applyCollectibleRewardItemMutation`.
fn apply_collectible_reward_item_mutation(svc: &CommandService, user_id: i64, payload: &Value, item: &Value) -> Res<()> {
    match resolve_item_reward_collectible_group_from_mutation(payload, item) {
        Some(group_sku) => apply_reward(svc, user_id, &serde_json::json!({ "sku": group_sku })),
        None => Ok(()),
    }
}

/// commandHandlers.ts:1197 `applyCollectibleProjectionForItemMutation`: drops a collectible on a collected house rent.
fn apply_collectible_projection_for_item_mutation(
    svc: &CommandService,
    user_id: i64,
    item: &mut Value,
    payload: &Value,
) -> Res<Vec<SideEffect>> {
    let item_sku = s(item.get("sku"));
    let sid = s(item.get("sid"));
    let item_snapshot = item.clone();
    let Some(state) = item_state_mut(item) else { return Ok(Vec::new()) };
    if !is_house_sku(&item_sku) {
        return Ok(Vec::new());
    }

    let mode = s(state.get("mode"));
    if mode == "14" || mode == "15" {
        collapse_pending_collectible_state(state);
        return Ok(Vec::new());
    }

    if !is_collectible_award_mutation(payload, state) {
        return Ok(Vec::new());
    }

    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    if !is_collectible_feature_unlocked(get_universe_profile(&mut universe).map(|p| &*p)) {
        return Ok(Vec::new());
    }

    let mut collectibles_document = get_normalized_collectibles_document(svc, user_id)?;
    let mut collectible_state = read_collectibles_state(&mut collectibles_document);
    if sid.is_empty() || collectible_state.pending_by_sid.contains_key(&sid) {
        return Ok(Vec::new());
    }

    if !should_award_collectible_drop(&item_snapshot, state) {
        return Ok(Vec::new());
    }

    let Some(collectible_sku) = pick_collectible_sku_for_house(&item_sku, &sid, &collectible_state) else {
        return Ok(Vec::new());
    };

    collectible_state.pending_by_sid.insert(sid.clone(), collectible_sku.clone());
    write_collectibles_state(&mut collectibles_document, &collectible_state);
    svc.repository.set_document(user_id, tags::COLLECTIBLES, &collectibles_document)?;
    let mut dat = Map::new();
    dat.insert("action".into(), Value::String("give_collectible".into()));
    dat.insert("sid".into(), Value::String(sid));
    dat.insert("sku".into(), Value::String(collectible_sku));
    Ok(vec![("update_item".to_string(), Value::Object(dat))])
}

// ---------------------------------------------------------------------------------------------------------------------
// update_item (commandHandlers.ts:1253)
// ---------------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:1253 `applyItemMutation`.
fn apply_item_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<Vec<SideEffect>> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let action = s(payload.get("action")).to_lowercase();
    let sid = s(payload.get("sid"));
    let incoming_item = extract_incoming_item_entry(payload.get("item"));
    let security = to_record(payload.get("security"));

    if sid.is_empty() {
        return Ok(Vec::new());
    }

    apply_item_storage_effects(svc, user_id, payload, &action, incoming_item.as_ref())?;
    apply_upgrade_applied_effect(svc, user_id, payload, &sid)?;

    let existing = find_item_loc(&mut universe, &sid);
    let before_signature = match existing {
        Some(loc) => item_mutation_signature(item_at_mut(&mut universe, loc)),
        None => String::new(),
    };

    if action.contains("destroy") || action.contains("sell") || action.contains("remove") {
        if let Some((ci, ii)) = existing {
            if has_money_security_snapshot(security) {
                if let Some(profile) = get_universe_profile(&mut universe) {
                    apply_money_security_snapshot_with_positive_delta_fallback(profile, security);
                }
            }
            company_children_mut(&mut universe, ci).remove(ii);
            svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
        }
        return Ok(Vec::new());
    }

    let incoming_csid = incoming_item.as_ref().and_then(|i| non_null(i.get("csid")));
    let requested_company = match company_index_by_sid(&mut universe, &js_str_or(incoming_csid.or(payload.get("csid")), "")) {
        Some(i) => Some(i),
        None => match non_null(payload.get("whose")) {
            Some(w) => company_index_by_whose(&mut universe, &js_string(w)),
            None => None,
        },
    };
    let requested_company = match requested_company {
        Some(i) => Some(i),
        None if existing.is_none() => company_index_by_whose(&mut universe, "0"),
        None => None,
    };
    let Some(company_idx) = requested_company.or(existing.map(|(ci, _)| ci)) else {
        return Ok(Vec::new());
    };
    let company_entry = world_list(&mut universe).expect("world exists")[company_idx].clone();

    let had_incoming = incoming_item.is_some();
    let mut item = match incoming_item.clone() {
        Some(i) => i,
        None => match existing {
            Some(loc) => item_at_mut(&mut universe, loc).clone(),
            None => create_item_entry(payload, &company_entry),
        },
    };
    let should_move_companies = match existing {
        Some((ci, _)) => {
            s(world_list(&mut universe).expect("world exists")[ci].get("sid")) != s(company_entry.get("sid"))
        }
        None => false,
    };

    let payload_sku = non_empty_string(payload.get("sku"));
    let incoming_sku = non_empty_string(incoming_item.as_ref().and_then(|i| i.get("sku")));
    let existing_sku = match existing {
        Some(loc) => non_empty_string(item_at_mut(&mut universe, loc).get("sku")),
        None => None,
    };
    if let Some(v) = payload_sku.or(incoming_sku).or(existing_sku) {
        set_str(&mut item, "sku", v);
    }
    let incoming_ref = incoming_item.as_ref();
    for key in ["x", "y"] {
        if let Some(v) = non_null(payload.get(key)) {
            set_str(&mut item, key, js_string(v));
        } else if let Some(v) = incoming_ref.and_then(|i| non_null(i.get(key))) {
            set_str(&mut item, key, js_string(v));
        } else if !item.get(key).map(Value::is_string).unwrap_or(false) {
            set_str(&mut item, key, "0".to_string());
        }
    }
    if let Some(v) = non_null(payload.get("isSuspended")) {
        set_str(&mut item, "isSuspended", js_string(v));
    } else if let Some(v) = incoming_ref.and_then(|i| non_null(i.get("isSuspended"))) {
        set_str(&mut item, "isSuspended", js_string(v));
    } else if !item.get("isSuspended").map(Value::is_string).unwrap_or(false) {
        set_str(&mut item, "isSuspended", "0".to_string());
    }

    set_str(&mut item, "sid", sid.clone());
    set_str(
        &mut item,
        "csid",
        js_string(non_null(company_entry.get("sid")).or(non_null(payload.get("csid"))).unwrap_or(&Value::String("1".into()))),
    );

    let existing_state = {
        let children = get_element_children(&mut item, "Item");
        find_element_child(children, "State").is_some()
    };
    let (previous_mode, previous_state_id) = match existing {
        Some(loc) => match item_state_mut(item_at_mut(&mut universe, loc)) {
            Some(st) => (s(st.get("mode")), s(st.get("id"))),
            None => (String::new(), String::new()),
        },
        None => (String::new(), String::new()),
    };

    let is_head_quarter = item.get("sku").and_then(Value::as_str) == Some("HeadQuarter");
    {
        let item_children = get_element_children(&mut item, "Item");
        if is_head_quarter {
            ensure_state_element(item_children, &[("id", "4")]);
            ensure_head_quarter_decorations(item_children, &js_str_or(company_entry.get("whose"), "0"));
        } else if has_state_mutation(payload) {
            let mut state_attributes = extract_state_attributes(payload);
            if !state_attributes.iter().any(|(k, _)| k == "id") && !existing_state {
                state_attributes.push(("id".to_string(), "5".to_string()));
            }
            let refs: Vec<(&str, &str)> = state_attributes.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            ensure_state_element(item_children, &refs);
        } else if !existing_state {
            ensure_state_element(item_children, &[("id", "5")]);
        }
    }

    if action == "buy_crew" {
        // Persist <Crew ids bought/> on the item (ItemObject.getPersistence :2392); the original Java server has no handler.
        let item_children = get_element_children(&mut item, "Item");
        let crew = get_or_create_element_child(item_children, "Crew");
        let mut bought: Vec<String> = Vec::new();
        for entry in s(crew.get("bought")).split(',') {
            if !entry.is_empty() && !bought.iter().any(|b| b == entry) {
                bought.push(entry.to_string());
            }
        }
        for position in s(payload.get("position")).split(',') {
            let trimmed = position.trim();
            if !trimmed.is_empty() && trimmed.bytes().all(|b| b.is_ascii_digit()) && !bought.iter().any(|b| b == trimmed) {
                bought.push(trimmed.to_string());
            }
        }
        bought.sort_by(|a, b| {
            js_string_to_number(a).partial_cmp(&js_string_to_number(b)).unwrap_or(std::cmp::Ordering::Equal)
        });
        set_str(crew, "bought", bought.join(","));
        let ids = s(crew.get("ids"));
        set_str(crew, "ids", ids);
    }

    // Placement (TS: `existing.companyChildren[existing.index] = itemEntry` / splice + push / push).
    let loc: (usize, usize) = match existing {
        Some((ci, ii)) if !should_move_companies => {
            let _ = had_incoming;
            company_children_mut(&mut universe, ci)[ii] = item;
            (ci, ii)
        }
        Some((ci, ii)) => {
            company_children_mut(&mut universe, ci).remove(ii);
            let children = company_children_mut(&mut universe, company_idx);
            children.push(item);
            (company_idx, children.len() - 1)
        }
        None => {
            let children = company_children_mut(&mut universe, company_idx);
            children.push(item);
            (company_idx, children.len() - 1)
        }
    };

    let item_sku = s(item_at_mut(&mut universe, loc).get("sku"));
    let double_rent_push =
        roll_double_rent(svc, user_id, &mut universe, &item_sku, payload, &previous_state_id, &previous_mode);

    let now = now_ms();
    let state_id = item_state_mut(item_at_mut(&mut universe, loc)).map(|st| s(st.get("id")));
    if state_id.as_deref() == Some("0") {
        if let Some(st) = item_state_mut(item_at_mut(&mut universe, loc)) {
            crate::save_defaults::normalize_construction_state(&item_sku, st, now as f64);
        }
    }
    let collectible_side_effects =
        apply_collectible_projection_for_item_mutation(svc, user_id, item_at_mut(&mut universe, loc), payload)?;
    apply_collectible_reward_item_mutation(svc, user_id, payload, item_at_mut(&mut universe, loc))?;
    if is_house_sku(&s(item_at_mut(&mut universe, loc).get("sku"))) {
        let item = item_at_mut(&mut universe, loc);
        if let Some(st) = item_state_mut(item) {
            if s(st.get("id")) != "0" {
                let mode = s(st.get("mode"));
                if mode != "14" && mode != "15" {
                    crate::save_defaults::normalize_house_rent_state(get_element_children(item, "Item"), now as f64);
                }
            }
        }
    }
    if has_money_security_snapshot(security)
        && (existing.is_none()
            || action == "buy_crew"
            || before_signature != item_mutation_signature(item_at_mut(&mut universe, loc)))
    {
        if let Some(profile) = get_universe_profile(&mut universe) {
            apply_money_security_snapshot_with_positive_delta_fallback(profile, security);
        }
    }
    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
    let mut out = collectible_side_effects;
    if let Some(push) = double_rent_push {
        out.push(push);
    }
    Ok(out)
}

/// commandHandlers.ts:1403 `applyItemStorageEffects`: new_item with `storage` consumes one stored item
/// (SecurityNormal.java:206-221) and a move with `freeMove` consumes one stored "move" (SecurityNormal.java:265-290).
fn apply_item_storage_effects(
    svc: &CommandService,
    user_id: i64,
    payload: &Value,
    action: &str,
    incoming_item: Option<&Value>,
) -> Res<()> {
    let sku: Option<String> = if action == "new_item" && non_empty_string(payload.get("storage")).is_some() {
        non_empty_string(payload.get("sku")).or_else(|| non_empty_string(incoming_item.and_then(|i| i.get("sku"))))
    } else if action == "move" && non_null(payload.get("freeMove")).is_some() && s(payload.get("freeMove")) != "" {
        Some("move".to_string())
    } else {
        None
    };
    let Some(sku) = sku else { return Ok(()) };
    let mut storage = svc.repository.get_document(user_id, tags::STORAGE)?;
    if adjust_storage(&mut storage, &sku, -1.0) {
        svc.repository.set_document(user_id, tags::STORAGE, &storage)?;
    }
    Ok(())
}

/// commandHandlers.ts:1425 `applyUpgradeAppliedEffect`: new_mode with upgradeType: GamePlay.upgradeRem marks the visitor
/// upgrades of the item as applied (GamePlay.java:2487-2489, 1340-1344).
fn apply_upgrade_applied_effect(svc: &CommandService, user_id: i64, payload: &Value, sid: &str) -> Res<()> {
    if s(payload.get("action")).to_lowercase() != "new_mode" || non_null(payload.get("upgradeType")).is_none() {
        return Ok(());
    }
    let mut document = svc.repository.get_document(user_id, tags::UPGRADES)?;
    let records = get_stored_upgrade_records(&document);
    let default_owner = js_number_to_string(DEFAULT_USER_ID);
    let remaining: Vec<_> = records.iter().filter(|r| !(r.owner_id == default_owner && r.sid == sid)).cloned().collect();
    if remaining.len() != records.len() {
        set_stored_upgrade_records(&mut document, &remaining);
        svc.repository.set_document(user_id, tags::UPGRADES, &document)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// update_map / update_plots / update_next_rent
// ---------------------------------------------------------------------------------------------------------------------

/// commandHandlers.ts:1438 `applyMapMutation`.
fn apply_map_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let security = to_record(payload.get("security"));
    let tile_type = s(payload.get("type")).to_lowercase();
    let tile_key = match (non_null(payload.get("x")), non_null(payload.get("y"))) {
        (Some(x), Some(y)) => format!("{}:{}", js_string(x), js_string(y)),
        _ => String::new(),
    };
    let had_tile;
    let has_tile;
    {
        let Some(map_entry) = get_map_entry(&mut universe) else { return Ok(()) };
        if tile_key.is_empty() || (tile_type != "terrain" && tile_type != "road") {
            return Ok(());
        }

        let action = s(payload.get("action")).to_lowercase();
        let map_children = get_element_children(map_entry, "Map");
        let mut terrain_tiles = parse_chunk_set(find_element_child(map_children, "Terrain").map(|i| &map_children[i]));
        let mut road_tiles = parse_chunk_set(find_element_child(map_children, "Road").map(|i| &map_children[i]));
        let target = if tile_type == "terrain" { &mut terrain_tiles } else { &mut road_tiles };
        had_tile = target.contains(&tile_key);

        if action.contains("del") || action.contains("remove") {
            target.remove(&tile_key);
        } else {
            target.insert(tile_key.clone());
        }
        has_tile = target.contains(&tile_key);

        let mut next_children: Vec<Value> = Vec::new();
        if !terrain_tiles.is_empty() {
            next_children.push(create_element("Terrain", &[("chunk", &serialize_chunk_set(&terrain_tiles))], Vec::new()));
        }
        if !road_tiles.is_empty() {
            next_children.push(create_element("Road", &[("chunk", &serialize_chunk_set(&road_tiles))], Vec::new()));
        }
        if let Some(obj) = map_entry.as_object_mut() {
            obj.insert("Map".to_string(), Value::Array(next_children));
        }
    }

    if has_money_security_snapshot(security) && had_tile != has_tile {
        if let Some(profile) = get_universe_profile(&mut universe) {
            apply_money_security_snapshot_with_positive_delta_fallback(profile, security);
        }
    }
    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)
}

/// commandHandlers.ts:1482 `applyPlotsMutation`.
fn apply_plots_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let security = to_record(payload.get("security"));
    let join = |states: &[f64]| states.iter().map(|n| js_number_to_string(*n)).collect::<Vec<_>>().join(",");
    let before_type;
    let after_type;
    {
        let Some(plots_entry) = get_plots_entry(&mut universe) else { return Ok(()) };
        let mut states = get_plot_states(&s(plots_entry.get("type")));
        before_type = join(&states);
        let index = match non_null(payload.get("index")) {
            Some(v) => js_number(Some(v)),
            None => -1.0,
        };
        if !(index.is_finite() && index.fract() == 0.0) || index < 0.0 || index >= states.len() as f64 {
            return Ok(());
        }

        let action = s(payload.get("action")).to_lowercase();
        if action == "bought" {
            states[index as usize] = 2.0;
            unlock_next_plots(&mut states, index);
        }

        after_type = join(&states);
        set_str(plots_entry, "type", after_type.clone());
    }
    if has_money_security_snapshot(security) && before_type != after_type {
        if let Some(profile) = get_universe_profile(&mut universe) {
            apply_money_security_snapshot_with_positive_delta_fallback(profile, security);
        }
    }
    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)
}

/// commandHandlers.ts:514 `applyNextRentMutation` (GamePlay.updateNextRent, GamePlay.java:2720-2737): -1/0 stored as is,
/// 1..259200 s stored as an absolute timestamp.
fn apply_next_rent_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let seconds = js_number(payload.get("next_rent"));
    if !seconds.is_finite() || seconds < -1.0 || seconds > 259200.0 {
        return Ok(());
    }
    let value = if seconds == 0.0 || seconds == -1.0 { seconds } else { now_ms() as f64 + seconds * 1000.0 };
    svc.repository.set_meta(&format!("next_rent_{user_id}"), &js_number_to_string(value))
}
