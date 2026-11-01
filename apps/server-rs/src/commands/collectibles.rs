//! Package "collectibles": ask_collectible, update_collectible, get_collectibles_list, get_friends_collectible_sents_list
//! (commandHandlers.ts:990-1250, commandHandlers/collectibles.ts).

use super::collectibles_lib::*;
use super::money::{apply_money_security_snapshot_with_positive_delta_fallback, has_money_security_snapshot};
use super::universe::{get_universe_profile, set_player_head_quarter_skin};
use super::{CommandService, CommandTable, Handler};
use crate::encoding::sanitize_for_client_xml;
use crate::protocol::packet;
use crate::repository::tags;
use crate::util::js_string_or_empty;
use serde_json::Value;

type Res<T> = Result<T, String>;

/// commandHandlers.ts:990 `getNormalizedCollectiblesDocument`.
pub fn get_normalized_collectibles_document(svc: &CommandService, user_id: i64) -> Res<Value> {
    let mut document = svc.repository.get_document(user_id, tags::COLLECTIBLES)?;
    if normalize_collectibles_document(&mut document) {
        svc.repository.set_document(user_id, tags::COLLECTIBLES, &document)?;
    }
    Ok(document)
}

/// commandHandlers.ts:998 `getNormalizedCollectiblePendingDocument`.
pub fn get_normalized_collectible_pending_document(svc: &CommandService, user_id: i64) -> Res<Value> {
    let mut document = svc.repository.get_document(user_id, tags::COLLECTIBLE_PENDING)?;
    if normalize_collectible_pending_document(&mut document) {
        svc.repository.set_document(user_id, tags::COLLECTIBLE_PENDING, &document)?;
    }
    Ok(document)
}

/// commandHandlers.ts:268 (startup command, sanitised like the other document reads, :204).
fn get_collectibles_list(svc: &CommandService, user_id: i64, _command: &Value) -> Res<Vec<Value>> {
    let doc = get_normalized_collectibles_document(svc, user_id)?;
    Ok(vec![packet("get_collectibles_list", sanitize_for_client_xml(&doc), Some(svc.sync(user_id)))])
}

/// commandHandlers.ts:270.
fn get_friends_collectible_sents_list(svc: &CommandService, user_id: i64, _command: &Value) -> Res<Vec<Value>> {
    let doc = get_normalized_collectible_pending_document(svc, user_id)?;
    Ok(vec![packet("get_friends_collectible_sents_list", sanitize_for_client_xml(&doc), Some(svc.sync(user_id)))])
}

fn field(payload: &Value, key: &str) -> String {
    js_string_or_empty(payload.get(key))
}

/// `String(sid).slice(1)` (skus/sids are BMP text).
fn slice1(s: &str) -> &str {
    let mut it = s.chars();
    it.next();
    it.as_str()
}

/// commandHandlers.ts:1006 `applyCollectibleKeepMutation` (GamePlay.java:1595-1603).
fn apply_keep(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let sid = field(payload, "sid");
    let sku = field(payload, "sku");
    if sid.is_empty() || sku.is_empty() {
        return Ok(());
    }
    let mut doc = get_normalized_collectibles_document(svc, user_id)?;
    let mut state = read_collectibles_state(&mut doc);
    if sid.starts_with('f') {
        let mut pending = get_normalized_collectible_pending_document(svc, user_id)?;
        if remove_pending_friend_collectible(&mut pending, slice1(&sid), &sku) {
            svc.repository.set_document(user_id, tags::COLLECTIBLE_PENDING, &pending)?;
        }
    } else {
        state.pending_by_sid.shift_remove(&sid);
    }
    let kept = state.object_counts.get(&sku).copied().unwrap_or(0.0);
    if kept < MAX_COLLECTIBLE_UNITS as f64 {
        state.object_counts.insert(sku, kept + 1.0);
    }
    write_collectibles_state(&mut doc, &state);
    svc.repository.set_document(user_id, tags::COLLECTIBLES, &doc)
}

/// commandHandlers.ts:1048 `applyCollectibleBuyMutation` (GamePlay.java:1685-1688).
fn apply_buy(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let sku = field(payload, "sku");
    if sku.is_empty() {
        return Ok(());
    }
    let mut doc = get_normalized_collectibles_document(svc, user_id)?;
    let mut state = read_collectibles_state(&mut doc);
    let bought = state.object_counts.get(&sku).copied().unwrap_or(0.0);
    if bought >= MAX_COLLECTIBLE_UNITS as f64 {
        return Ok(());
    }
    state.object_counts.insert(sku, bought + 1.0);
    write_collectibles_state(&mut doc, &state);
    svc.repository.set_document(user_id, tags::COLLECTIBLES, &doc)
}

/// commandHandlers.ts:1068 `applyCollectibleSellMutation` (GamePlay.java:1700-1710).
fn apply_sell(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let sid = field(payload, "sid");
    let sku = field(payload, "sku");
    if sid.starts_with('f') {
        let mut pending = get_normalized_collectible_pending_document(svc, user_id)?;
        if remove_pending_friend_collectible(&mut pending, slice1(&sid), &sku) {
            svc.repository.set_document(user_id, tags::COLLECTIBLE_PENDING, &pending)?;
        }
        return Ok(());
    }
    let mut doc = get_normalized_collectibles_document(svc, user_id)?;
    let mut state = read_collectibles_state(&mut doc);
    if state.pending_by_sid.shift_remove(&sid).is_some() {
        write_collectibles_state(&mut doc, &state);
        svc.repository.set_document(user_id, tags::COLLECTIBLES, &doc)?;
    }
    Ok(())
}

/// commandHandlers.ts:1090 `applyCollectibleSendMutation` (GamePlay.java:1648-1676).
fn apply_send(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let sid = field(payload, "sid");
    let sku = field(payload, "sku");
    if sid.starts_with('v') {
        let mut doc = get_normalized_collectibles_document(svc, user_id)?;
        let mut state = read_collectibles_state(&mut doc);
        let count = state.object_counts.get(&sku).copied().unwrap_or(0.0);
        if count <= 0.0 || count.is_nan() {
            return Ok(());
        }
        if count == 1.0 {
            state.object_counts.shift_remove(&sku);
        } else {
            state.object_counts.insert(sku, count - 1.0);
        }
        write_collectibles_state(&mut doc, &state);
        return svc.repository.set_document(user_id, tags::COLLECTIBLES, &doc);
    }
    if sid.starts_with('f') || sid.is_empty() || sku.is_empty() {
        return Ok(());
    }
    apply_keep(svc, user_id, payload)
}

/// commandHandlers.ts:1121 `applyCollectibleAskMutation` (GamePlay.java:1387-1408).
fn apply_ask(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let sku = field(payload, "sku");
    if sku.is_empty() {
        return Ok(());
    }
    let mut doc = get_normalized_collectibles_document(svc, user_id)?;
    let asked = push_asked_collectible(&field(&doc, "asked"), &sku);
    doc.as_object_mut().ok_or("collectibles document is not an object")?.insert("asked".into(), Value::String(asked));
    svc.repository.set_document(user_id, tags::COLLECTIBLES, &doc)
}

/// commandHandlers.ts:1132 `applyCollectibleRewardMutation` (GamePlay.java:1719-1746).
pub fn apply_reward(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let sku = field(payload, "sku");
    if sku.is_empty() {
        return Ok(());
    }
    let mut doc = get_normalized_collectibles_document(svc, user_id)?;
    let mut state = read_collectibles_state(&mut doc);
    if !state.rewards.contains(&sku) {
        let members = get_trade_in_collectible_skus(&sku);
        if !members.is_empty() && members.iter().all(|m| state.object_counts.get(m).copied().unwrap_or(0.0) > 0.0) {
            for member in &members {
                let count = state.object_counts.get(member).copied().unwrap_or(0.0) - 1.0;
                if count <= 0.0 {
                    state.object_counts.shift_remove(member);
                } else {
                    state.object_counts.insert(member.clone(), count);
                }
            }
        }
    }
    state.rewards.insert(sku.clone());
    write_collectibles_state(&mut doc, &state);
    svc.repository.set_document(user_id, tags::COLLECTIBLES, &doc)?;

    let plane_sku = resolve_plane_reward_sku_for_collectible_claim(&sku);
    let hq_skin_sku = resolve_head_quarter_reward_sku_for_collectible_claim(&sku);
    if plane_sku.is_none() && hq_skin_sku.is_none() {
        return Ok(());
    }
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let mut changed = false;
    if let Some(plane) = &plane_sku {
        if let Some(profile) = get_universe_profile(&mut universe) {
            if field(profile, "planeSku") != *plane {
                profile["planeSku"] = Value::String(plane.clone());
                changed = true;
            }
        }
    }
    if let Some(skin) = &hq_skin_sku {
        changed = set_player_head_quarter_skin(&mut universe, skin) || changed;
    }
    if changed {
        svc.repository.set_document(user_id, tags::UNIVERSE, &universe)?;
    }
    Ok(())
}

/// commandHandlers.ts:1186 `applyCollectibleMoneySecurity`.
fn apply_money_security(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let security = payload.get("security").filter(|v| v.is_object());
    if !has_money_security_snapshot(security) {
        return Ok(());
    }
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let Some(profile) = get_universe_profile(&mut universe) else {
        return Ok(());
    };
    apply_money_security_snapshot_with_positive_delta_fallback(profile, security);
    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)
}

/// commandHandlers.ts:553 `handleCollectibleCommand` (dispatch :167).
fn handle_collectible_command(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    let name = command.get("_cmd").and_then(Value::as_str).unwrap_or("");
    let payload = match command.get("_dat") {
        Some(p) if !p.is_null() => p,
        _ => return Err("Cannot read properties of undefined (reading 'action')".into()),
    };
    let action = field(payload, "action").to_uppercase();

    if name == "ask_collectible" || action == "ASK" {
        apply_ask(svc, user_id, payload)?;
    }
    if name == "update_collectible" {
        match action.as_str() {
            "KEEP" => apply_keep(svc, user_id, payload)?,
            "BUY" => apply_buy(svc, user_id, payload)?,
            "SELL" => apply_sell(svc, user_id, payload)?,
            "GET_REWARD" => apply_reward(svc, user_id, payload)?,
            "SEND" => apply_send(svc, user_id, payload)?,
            _ => {}
        }
    }
    apply_money_security(svc, user_id, payload)?;
    svc.repository.increment_session_sync(user_id)?;
    let mut dat = payload.clone();
    if let Some(obj) = dat.as_object_mut() {
        obj.insert("success".into(), Value::String("true".into()));
    }
    Ok(vec![packet(name, dat, Some(svc.sync(user_id)))])
}

pub const COMMANDS: CommandTable = &[
    ("get_collectibles_list", get_collectibles_list as Handler),
    ("get_friends_collectible_sents_list", get_friends_collectible_sents_list as Handler),
    ("ask_collectible", handle_collectible_command as Handler),
    ("update_collectible", handle_collectible_command as Handler),
];
