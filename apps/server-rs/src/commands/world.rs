//! Package "world": `get_world` (commandHandlers.ts:216-246 `getStartupDocument`, :204 `handleStartupCommand`,
//! `persistExpiredServices` :525, `projectServiceTimes` offline.ts:100, collectible projection collectibles.ts:163).

use super::collectibles::get_normalized_collectibles_document;
use super::collectibles_lib::{is_collectible_feature_unlocked, project_pending_collectibles_on_universe};
use super::npc_friends::{grant_npc_upgrades, visitor_upgrades_per_day};
use super::offline_lib::project_service_times;
use super::upgrades::get_local_day_key;
use super::universe::{get_universe_profile, non_null};
use super::{CommandService, CommandTable, Handler};
use crate::encoding::sanitize_universe_for_client;
use crate::protocol::packet;
use crate::repository::{tags, DEFAULT_USER_ID};
use crate::save_defaults::{create_neighbor_universe, create_visitor_neighbor_universe};
use crate::util::{js_number, now_ms};
use serde_json::Value;

/// commandHandlers.ts:525 `persistExpiredServices`: drops expired `<sku>TimeOver` profile attributes (GamePlay.java:196-205).
fn persist_expired_services(svc: &CommandService, user_id: i64, universe: &mut Value) -> Result<(), String> {
    let Some(profile) = get_universe_profile(universe) else { return Ok(()) };
    let now = now_ms() as f64;
    let mut changed = false;
    let names: Vec<String> = profile.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    for name in names {
        // Number(profile[name]) - now < 0 (NaN is never < 0)
        if name.ends_with("TimeOver") && js_number(profile.get(&name)) - now < 0.0 {
            profile.as_object_mut().unwrap().shift_remove(&name);
            changed = true;
        }
    }
    if changed {
        svc.repository.set_document(user_id, tags::UNIVERSE, universe)?;
    }
    Ok(())
}

/// commandHandlers.ts:216 `getStartupDocument` case `get_world` (GamePlay.getWorld, GamePlay.java:120-230).
fn get_world_document(svc: &CommandService, user_id: i64, command: &Value) -> Result<Value, String> {
    let mut player_universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let mut collectibles_document = get_normalized_collectibles_document(svc, user_id)?;
    let payload = command.get("_dat");
    // Number(payload.targetUserId ?? DEFAULT_USER_ID)
    let target_user_id = match payload.and_then(|p| non_null(p.get("targetUserId"))) {
        Some(v) => js_number(Some(v)),
        None => DEFAULT_USER_ID as f64,
    };
    if target_user_id.is_finite() && target_user_id != DEFAULT_USER_ID as f64 {
        // GamePlay.getWorld (GamePlay.java:120-141): another targetUserId is a read-only visit (mUniverseOwner=false).
        let boss_genre = match get_universe_profile(&mut player_universe).and_then(|p| non_null(p.get("bossGenre"))) {
            Some(v) => js_number(Some(v)),
            None => 0.0,
        };
        if let Some(neighbor) = create_neighbor_universe(target_user_id, boss_genre) {
            return Ok(neighbor);
        }
        // JS number -> SQLite integer binding: only integral ids can match a stored user row.
        if target_user_id == target_user_id.trunc() && target_user_id.abs() < 9.0e15 {
            if let Some(saved) = svc.repository.get_optional_document(target_user_id as i64, tags::UNIVERSE)? {
                return Ok(saved);
            }
        }
        // Unknown id: never hand back the local player's own world (the client would treat it as a visit).
        return Ok(create_visitor_neighbor_universe(target_user_id));
    }
    persist_expired_services(svc, user_id, &mut player_universe)?;
    // Offline friends (Rust-only, npc_friends.rs): loading the own city, the NPC friends have upgraded some of the player's houses (the Java
    // gets these rows from real visitors); the `get_upgrades_list` that follows in the same boot cmdList reports them (GamePlay.java:326-346).
    {
        let mut upgrades = svc.repository.get_document(user_id, tags::UPGRADES)?;
        if grant_npc_upgrades(&mut player_universe, &mut upgrades, &get_local_day_key(0), visitor_upgrades_per_day()) {
            svc.repository.set_document(user_id, tags::UPGRADES, &upgrades)?;
        }
    }
    if is_collectible_feature_unlocked(get_universe_profile(&mut player_universe).map(|p| &*p)) {
        project_pending_collectibles_on_universe(&mut player_universe, &mut collectibles_document);
    }
    // "Proccess Time-Services" (GamePlay.java:190-212): expose <sku>TimeLeft to the client without persisting it.
    if let Some(profile) = get_universe_profile(&mut player_universe) {
        project_service_times(profile, now_ms());
    }
    Ok(player_universe)
}

/// commandHandlers.ts:204 `handleStartupCommand` for `get_world`: `sanitizeUniverseForClient(document)`.
fn get_world(svc: &CommandService, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
    let raw = get_world_document(svc, user_id, command)?;
    Ok(vec![packet("get_world", sanitize_universe_for_client(&raw), Some(svc.sync(user_id)))])
}

pub const COMMANDS: CommandTable = &[("get_world", get_world as Handler)];
