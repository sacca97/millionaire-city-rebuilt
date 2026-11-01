//! Package "reads": the commands that are pure document reads (commandHandlers.ts:204-300 `handleStartupCommand` /
//! `getStartupDocument`, :161-170 ping/empty). Done.

use super::{CommandService, CommandTable, Handler};
use crate::encoding::sanitize_for_client_xml;
use crate::protocol::packet;
use crate::repository::tags;
use crate::util::{js_number, now_ms};
use serde_json::{json, Value};

/// commandHandlers.ts:161-170: `ping` / `empty` echo an empty `_dat`.
fn ping(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    let name = command.get("_cmd").and_then(Value::as_str).unwrap_or("");
    Ok(vec![packet(name, json!({}), Some(svc.sync(user_id)))])
}

/// commandHandlers.ts:204 `handleStartupCommand`: `sanitizeForClientXml(document)` answered with the session sync.
fn answer(svc: &CommandService, user_id: i64, name: &str, raw: Value) -> Result<Vec<Value>, String> {
    Ok(vec![packet(name, sanitize_for_client_xml(&raw), Some(svc.sync(user_id)))])
}

macro_rules! document_read {
    ($fn_name:ident, $cmd:literal, $tag:expr) => {
        /// commandHandlers.ts:214 `getStartupDocument` case for this command.
        fn $fn_name(svc: &CommandService, user_id: i64, _command: &Value) -> Result<Vec<Value>, String> {
            answer(svc, user_id, $cmd, svc.repository.get_document(user_id, $tag)?)
        }
    };
}

document_read!(get_customizer_info, "get_customizer_info", tags::CUSTOMIZER); // :248
document_read!(get_friends_list, "get_friends_list", tags::FRIENDS); // :250
document_read!(get_neighbor_list, "get_neighbor_list", tags::NEIGHBORS); // :252
document_read!(get_help_building_list, "get_help_building_list", tags::HELP); // :258
document_read!(get_unlocked_items_list, "get_unlocked_items_list", tags::UNLOCKED); // :262
document_read!(get_limited_edition_items_list, "get_limited_edition_items_list", tags::LIMITED_EDITION); // :264
document_read!(get_storage_list, "get_storage_list", tags::STORAGE); // :266
document_read!(get_partners_list, "get_partners_list", tags::PARTNERS); // :283
document_read!(get_game_config, "get_game_config", tags::GAME_CONFIG); // :292

/// commandHandlers.ts:254: always an empty list.
fn get_neighbor_info(svc: &CommandService, user_id: i64, _command: &Value) -> Result<Vec<Value>, String> {
    answer(svc, user_id, "get_neighbor_info", json!({ "neighborList": [] }))
}

/// commandHandlers.ts:294
fn load_success(svc: &CommandService, user_id: i64, _command: &Value) -> Result<Vec<Value>, String> {
    answer(svc, user_id, "load_success", json!({ "success": "true" }))
}

/// commandHandlers.ts:285 (GamePlay.getWelcomeProgress, GamePlay.java:972-986): both NPC timers = max(0, daily_bonus_at - now).
fn get_welcome_progress(svc: &CommandService, user_id: i64, _command: &Value) -> Result<Vec<Value>, String> {
    let at = svc
        .repository
        .get_meta(&format!("daily_bonus_at_{user_id}"))
        .map(|v| js_number(Some(&Value::String(v))))
        .filter(|n| !n.is_nan() && *n != 0.0) // `Number(x) || 0`
        .unwrap_or(0.0);
    let left = ((at - now_ms() as f64).max(0.0)) as i64;
    let left = left.to_string();
    let mut doc = svc.repository.get_document(user_id, tags::WELCOME)?;
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("npcRonaldTimeLeft".into(), Value::String(left.clone()));
        obj.insert("npcCindyTimeLeft".into(), Value::String(left));
    }
    answer(svc, user_id, "get_welcome_progress", doc)
}

pub const COMMANDS: CommandTable = &[
    ("ping", ping as Handler),
    ("empty", ping as Handler),
    ("get_customizer_info", get_customizer_info as Handler),
    ("get_friends_list", get_friends_list as Handler),
    ("get_neighbor_list", get_neighbor_list as Handler),
    ("get_neighbor_info", get_neighbor_info as Handler),
    ("get_help_building_list", get_help_building_list as Handler),
    ("get_unlocked_items_list", get_unlocked_items_list as Handler),
    ("get_limited_edition_items_list", get_limited_edition_items_list as Handler),
    ("get_storage_list", get_storage_list as Handler),
    ("get_partners_list", get_partners_list as Handler),
    ("get_welcome_progress", get_welcome_progress as Handler),
    ("get_game_config", get_game_config as Handler),
    ("load_success", load_success as Handler),
];
