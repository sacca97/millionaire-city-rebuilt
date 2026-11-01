//! `POST /Game` (serverApp.ts:414 `app.post("/Game")`) and the offline payment (`applyOfflinePayment`).

use crate::commands::CommandService;
use crate::http::{status_only, text, Req, Resp};
use crate::protocol::{build_command_envelope, build_login_envelope, normalize_incoming_command_list, packet};
use crate::repository::{get_profile_container_mut, tags, Res, SaveRepository, DEFAULT_SYNC};
use crate::rules::GoldPackageReward;
use crate::util::{js_number, js_number_to_string, js_string, js_string_or_empty, random_hex};
use axum::http::StatusCode;
use md5_hash::md5_hex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

mod md5_hash {
    use md5::{Digest, Md5};
    pub fn md5_hex(s: &str) -> String {
        crate::util::hex(&Md5::digest(s.as_bytes()))
    }
}

pub struct GameContext<'a> {
    pub repo: &'a SaveRepository,
    pub commands: &'a CommandService,
    pub gold_rewards: &'a HashMap<String, GoldPackageReward>,
    pub cash_to_coins: f64,
}

/// `safeJsonParse(String(req.body.data ?? "{}"), {})`
fn parse_data(body: &Value) -> Value {
    let raw = match body.get("data") {
        None | Some(Value::Null) => "{}".to_string(),
        Some(v) => js_string(v),
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
}

fn xml(body: String) -> Resp {
    text(StatusCode::OK, "application/xml", body)
}

/// serverApp.ts:976 `isSignatureValid`
fn is_signature_valid(body: &Value, session_token: &str) -> bool {
    if session_token.is_empty() {
        return true;
    }
    let provided = js_string_or_empty(body.get("sig"));
    if provided.is_empty() {
        return false;
    }
    let mut params: Vec<(String, String)> = match body.as_object() {
        Some(o) => o.iter().filter(|(k, _)| *k != "sig").map(|(k, v)| (k.clone(), js_string_or_empty(Some(v)))).collect(),
        None => Vec::new(),
    };
    // localeCompare(..., { sensitivity: "base" }) approximated by case-insensitive comparison (stable)
    params.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    let serialized = params.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let expected = md5_hex(&format!("{serialized}{session_token}Host4h"));
    expected == provided || provided == "pass"
}

fn msg_count_value(payload: &Value) -> Value {
    let raw = payload.get("_msgCount");
    let n = match raw {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        None | Some(Value::Null) => -1.0,
        other => js_number(other),
    };
    let n = if n.is_finite() {
        n
    } else {
        eprintln!("[game] Invalid message count for cmdList, defaulting to -1: {}", js_string_or_empty(raw));
        -1.0
    };
    if n == n.trunc() && n.abs() < 9e15 { json!(n as i64) } else { json!(n) }
}

pub fn handle_game(ctx: &GameContext, req: &Req) -> Resp {
    // One SQLite transaction (= one fsync) for everything this request writes; committed when the response is built.
    let _batch = ctx.repo.database.begin_batch();
    let user = match ctx.repo.ensure_default_user() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[game] {e}");
            return text(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", "Internal Server Error");
        }
    };
    let uid = js_string_or_empty(req.body.get("uid"));
    let cmd = js_string_or_empty(req.body.get("cmd"));
    if uid != user.ext_id && uid != user.id.to_string() {
        eprintln!(
            "[game] Ignoring uid mismatch for private server session: received={uid} expected={}/{}",
            user.ext_id, user.id
        );
    }

    if cmd == "login" {
        let token = random_hex(16);
        if let Err(e) = ctx.repo.set_session(user.id, &token, DEFAULT_SYNC) {
            eprintln!("[game] {e}");
            return status_only(StatusCode::INTERNAL_SERVER_ERROR);
        }
        println!("[game] login accepted");
        let dat = match ctx.repo.get_login_response(user.id) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[game] {e}");
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };
        return xml(build_login_envelope(packet("logOK", dat, Some(DEFAULT_SYNC))));
    }

    if cmd == "payments" {
        let payment = parse_data(&req.body);
        let awarded = apply_offline_payment(ctx.repo, user.id, &payment, ctx.gold_rewards, ctx.cash_to_coins).unwrap_or(0);
        let sync = if awarded > 0 {
            ctx.repo.increment_session_sync(user.id).unwrap_or(DEFAULT_SYNC)
        } else {
            ctx.repo.session_sync(user.id)
        };
        let command = packet(
            "payments",
            json!({
                "success": "1",
                "unavailableOffline": "1",
                "privateServerFreePurchase": "1",
                "awardedGold": awarded.to_string(),
            }),
            None,
        );
        return xml(build_command_envelope(vec![command], &json!(-1), sync));
    }

    let token = ctx.repo.get_session(user.id).map(|s| s.token).unwrap_or_default();
    if !is_signature_valid(&req.body, &token) {
        eprintln!("[game] Ignoring signature mismatch for cmd={cmd}.");
    }

    if cmd != "cmdList" {
        let name = if cmd.is_empty() { "noop".to_string() } else { cmd.clone() };
        let command = packet(&name, json!({ "success": "true", "ignored": "1", "unsupportedRoot": "1" }), None);
        return xml(build_command_envelope(vec![command], &json!(-1), ctx.repo.session_sync(user.id)));
    }

    let payload = parse_data(&req.body);
    let packet_commands = normalize_incoming_command_list(&payload);
    println!(
        "[game] cmdList {}",
        packet_commands
            .iter()
            .map(|c| c.get("_cmd").and_then(Value::as_str).unwrap_or(""))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let msg_count = msg_count_value(&payload);

    let mut responses: Vec<Value> = Vec::new();
    for entry in &packet_commands {
        let name = entry.get("_cmd").and_then(Value::as_str).unwrap_or("").to_string();
        let outcome = catch_unwind(AssertUnwindSafe(|| ctx.commands.handle_command(user.id, entry)));
        match outcome {
            Ok(Ok(mut list)) => responses.append(&mut list),
            failure => {
                let why = match failure {
                    Ok(Err(e)) => e,
                    Err(_) => "handler panicked".to_string(),
                    Ok(Ok(_)) => unreachable!(),
                };
                eprintln!("[game] Command handler failed for {name}: {why}");
                responses.push(packet(
                    &name,
                    json!({ "success": "false", "ignored": "1", "offlineError": "1" }),
                    Some(ctx.repo.session_sync(user.id)),
                ));
            }
        }
    }
    xml(build_command_envelope(responses, &msg_count, ctx.repo.session_sync(user.id)))
}

/// serverApp.ts:1042 `applyOfflinePayment`: returns the awarded gold.
fn apply_offline_payment(
    repo: &SaveRepository,
    user_id: i64,
    payload: &Value,
    rewards: &HashMap<String, GoldPackageReward>,
    cash_to_coins: f64,
) -> Res<i64> {
    if js_string_or_empty(payload.get("type")).trim().to_lowercase() != "gold" {
        return Ok(0);
    }
    let sku = js_string_or_empty(payload.get("sku")).trim().to_string();
    let Some(reward) = rewards.get(&sku) else { return Ok(0) };
    let awarded = reward.gold + reward.free_gold;
    if awarded <= 0 {
        return Ok(0);
    }
    let mut universe = repo.get_document(user_id, tags::UNIVERSE)?;
    if !universe.get("universe").map(Value::is_array).unwrap_or(false) {
        return Ok(0);
    }
    let Some(profile) = get_profile_container_mut(&mut universe) else { return Ok(0) };
    let num = |p: &Value, k: &str| {
        let v = match p.get(k) {
            None | Some(Value::Null) => 0.0,
            o => js_number(o),
        };
        if v.is_finite() { v } else { 0.0 }
    };
    let gold = num(profile, "DCCash");
    let paid = num(profile, "DCCashPaid");
    let value = num(profile, "companyValue");
    profile["DCCash"] = Value::String(js_number_to_string(gold + awarded as f64));
    profile["DCCashPaid"] = Value::String(js_number_to_string(paid + reward.gold as f64));
    profile["companyValue"] = Value::String(js_number_to_string(value + awarded as f64 * cash_to_coins));
    repo.set_document(user_id, tags::UNIVERSE, &universe)?;
    Ok(awarded)
}
