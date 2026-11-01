//! Package "profile-money": `update_profile`, `update_money` (commandHandlers.ts:689-990, `handleMutationCommand` :303-354).

use super::universe::{find_item_entry, get_item_state_entry, get_universe_profile, js_str_or, non_null, DEFAULT_CITY_NAME};
use super::money::{
    apply_money_security_snapshot, cash_to_coins, has_money_security_snapshot, reconcile_premium_currency_purchase,
    PremiumCurrencyState,
};
use super::offline_lib::{
    add_to_profile, add_unlocked_item, adjust_storage, apply_profile_flag, apply_service_presentation_shown,
    apply_service_purchase, daily_bonus_coins, daily_bonus_time_ms, get_accelerator_storage, get_box_prize,
    get_service_definition, level_from_exp, new_items_rev,
    news_feed_reward,
};
use super::state::to_record;
use super::{CommandService, CommandTable, Handler};
use crate::encoding::{decode_ascii_codes, encode_ascii_codes, sanitize_stored_string};
use crate::protocol::packet;
use crate::repository::tags;
use crate::util::{js_number, js_number_to_string, js_string, js_string_or_empty, now_ms};
use serde_json::Value;

type Res<T> = Result<T, String>;

fn set_str(node: &mut Value, key: &str, value: String) {
    if let Some(o) = node.as_object_mut() {
        o.insert(key.to_string(), Value::String(value));
    }
}

/// `Number(x ?? default)` where default is a JS number.
fn num_or(value: Option<&Value>, default: f64) -> f64 {
    match non_null(value) {
        Some(v) => js_number(Some(v)),
        None => default,
    }
}

/// `Number(profile[key] ?? "0")`
fn profile_num(profile: &Value, key: &str) -> f64 {
    num_or(profile.get(key), 0.0)
}

/// commandHandlers.ts:303-354 `handleMutationCommand`, envelope part (apply, bump sync, echo the payload).
fn mutation_envelope(
    svc: &CommandService,
    user_id: i64,
    command: &Value,
    apply: fn(&CommandService, i64, &Value) -> Res<()>,
) -> Res<Vec<Value>> {
    let name = command.get("_cmd").and_then(Value::as_str).unwrap_or("");
    let payload = command.get("_dat").cloned().unwrap_or(Value::Null);
    apply(svc, user_id, &payload)?;
    svc.repository.increment_session_sync(user_id)?;
    Ok(vec![packet(name, payload, Some(svc.sync(user_id)))])
}

fn update_profile(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    mutation_envelope(svc, user_id, command, apply_profile_mutation)
}

fn update_money(svc: &CommandService, user_id: i64, command: &Value) -> Res<Vec<Value>> {
    mutation_envelope(svc, user_id, command, apply_money_mutation)
}

/// commandHandlers.ts:689 `applyProfileMutation`
fn apply_profile_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    if get_universe_profile(&mut universe).is_none() {
        return Ok(());
    }

    let action = js_string_or_empty(payload.get("action"));
    let value = non_null(payload.get("value"));
    // `normalizeCompletedTutorialUniverse(universe)` runs on the whole document after the profile edit.
    let mut normalize = false;

    {
        let profile = get_universe_profile(&mut universe).expect("checked above");
        match action.as_str() {
            "city_name_codes" => {
                let current = js_str_or(profile.get("cityNameCodes"), "");
                let codes = match value {
                    Some(v) => js_string(v),
                    None => current,
                };
                let city_name = sanitize_stored_string(&decode_ascii_codes(&codes));
                if !city_name.is_empty() {
                    set_str(profile, "cityname", city_name.clone());
                }
                set_str(profile, "cityNameCodes", encode_ascii_codes(&city_name));
                normalize = true;
            }
            "city_name" => {
                let src = match value {
                    Some(v) => js_string(v),
                    None => js_str_or(profile.get("cityname"), DEFAULT_CITY_NAME),
                };
                let city_name = sanitize_stored_string(&src);
                set_str(profile, "cityname", city_name.clone());
                set_str(profile, "cityNameCodes", encode_ascii_codes(&city_name));
                normalize = true;
            }
            // commandHandlers.ts:1616 `normalizeBossGenreValue`
            "boss_genre" => {
                let s = value.map(js_string).unwrap_or_else(|| "0".into());
                set_str(profile, "bossGenre", if s.trim() == "1" { "1" } else { "0" }.into());
            }
            "gameConfig" => apply_game_config_profile_mutation(svc, user_id, payload)?,
            "tutorial_completed" => {
                // GamePlay.java:1993-1998
                set_str(profile, "tutorialEnd", "1".into());
                normalize = true;
            }
            "firstMission" => {
                set_str(profile, "firstMission", js_str_or(value, "0"));
                normalize = true;
            }
            "first_invest" => set_str(profile, "firstInvest", js_str_or(value, "0")),
            "firstPartner" => set_str(profile, "firstPartner", js_str_or(value, "0")),
            "firstVisit" => set_str(profile, "firstVisit", js_str_or(value, "0")),
            "newToolRev" => set_str(profile, "newToolRev", js_str_or(value, "0")),
            "checkmail" => {
                let next = normalize_checkmail_state(profile.get("checkmail"), payload.get("value"));
                set_str(profile, "checkmail", next);
            }
            "ranking" => {
                let current = js_str_or(profile.get("ranking"), "-1");
                set_str(profile, "ranking", match value {
                    Some(v) => js_string(v),
                    None => current,
                });
            }
            "planeSku" => {
                let current = js_str_or(profile.get("planeSku"), "plain");
                set_str(profile, "planeSku", match value {
                    Some(v) => js_string(v),
                    None => current,
                });
            }
            "fourMillions" => set_str(profile, "fourMillions", js_str_or(value, "0")),
            "million_news_feed" => set_str(profile, "millionNewsFeed", js_str_or(value, "1")),
            "newItemsRev" | "newItemsRevDone" => {
                // GamePlay.java:2024-2027 (the 0.501 client sends "newItemsRevDone", Profile.as:810).
                set_str(profile, "newItemsRev", new_items_rev());
            }
            "service" => {
                // GamePlay.java:2037-2043
                apply_service_presentation_shown(profile, &js_str_or(value, ""));
            }
            "flag" => {
                // GamePlay.java:2054-2087
                apply_profile_flag(
                    profile,
                    &js_string_or_empty(payload.get("name")),
                    &js_string_or_empty(payload.get("value")),
                );
            }
            "restart_tutorial" => {
                // Not in the original; opt-in way to replay the tutorial (repository.restartTutorial).
                svc.repository.restart_tutorial(user_id)?;
                return Ok(());
            }
            _ => {}
        }
    }

    if normalize {
        crate::save_defaults::normalize_completed_tutorial_universe(&mut universe);
    }

    if let Some(user_name) = payload.get("userName").and_then(Value::as_str) {
        let profile = get_universe_profile(&mut universe).expect("checked above");
        set_str(profile, "userName", sanitize_stored_string(user_name));
    }

    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)
}

/// commandHandlers.ts:1645 `normalizeCheckmailState` / `parseCheckmailState`
fn normalize_checkmail_state(current: Option<&Value>, next: Option<&Value>) -> String {
    fn parse(value: Option<&Value>) -> f64 {
        let parsed = num_or(value, 0.0);
        if !parsed.is_finite() {
            return 0.0;
        }
        parsed.trunc().max(0.0).min(2.0)
    }
    js_number_to_string(parse(current).max(parse(next)))
}

/// commandHandlers.ts:788 `applyGameConfigProfileMutation`
fn apply_game_config_profile_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let mut config = svc.repository.get_document(user_id, tags::GAME_CONFIG)?;
    for key in ["music", "sound", "quality"] {
        if let Some(s) = payload.get(key).and_then(Value::as_str) {
            set_str(&mut config, key, s.to_string());
        }
    }
    svc.repository.set_document(user_id, tags::GAME_CONFIG, &config)
}

/// commandHandlers.ts:804 `applyMoneyMutation`
fn apply_money_mutation(svc: &CommandService, user_id: i64, payload: &Value) -> Res<()> {
    let mut universe = svc.repository.get_document(user_id, tags::UNIVERSE)?;
    let (previous_cash, previous_paid_cash) = match get_universe_profile(&mut universe) {
        None => return Ok(()),
        Some(p) => (profile_num(p, "DCCash"), profile_num(p, "DCCashPaid")),
    };
    let security = to_record(payload.get("security"));
    let action = js_string_or_empty(payload.get("action"));
    let has_snapshot = has_money_security_snapshot(security);

    {
        let profile = get_universe_profile(&mut universe).expect("checked above");
        match action.as_str() {
            "first_visit" => set_str(profile, "firstVisit", js_str_or(payload.get("value"), "1")),
            "firstPartner" => set_str(profile, "firstPartner", js_str_or(payload.get("value"), "1")),
            _ => {}
        }
    }
    apply_money_action(svc, user_id, &action, payload, &mut universe, has_snapshot)?;

    let profile = get_universe_profile(&mut universe).expect("checked above");
    if let Some(obj) = payload.as_object() {
        for (key, value) in obj {
            if value.is_null() {
                continue;
            }
            let target = match key.as_str() {
                "money" | "coins" | "DCCoins" => "DCCoins",
                "gold" | "cash" | "DCCash" => "DCCash",
                "paidCash" | "DCCashPaid" => "DCCashPaid",
                "exp" => "exp",
                "companyValue" => "companyValue",
                _ => continue,
            };
            set_str(profile, target, js_string(value));
        }
    }

    apply_money_security_snapshot(profile, security);
    reconcile_premium_currency_purchase(
        profile,
        payload,
        PremiumCurrencyState { previous_cash, previous_paid_cash, had_security_snapshot: has_snapshot },
    );

    svc.repository.set_document(user_id, tags::UNIVERSE, &universe)
}

/// commandHandlers.ts:861 `applyMoneyAction` (GamePlay.updateMoney, GamePlay.java:2089-2303; SecurityNormal.updateMoney :72-135).
fn apply_money_action(
    svc: &CommandService,
    user_id: i64,
    action: &str,
    payload: &Value,
    universe: &mut Value,
    has_snapshot: bool,
) -> Res<()> {
    let level = {
        let profile = get_universe_profile(universe).expect("profile checked by caller");
        let exp = profile_num(profile, "exp");
        level_from_exp(if exp.is_nan() { 0.0 } else { exp })
    };
    let repo = &svc.repository;
    match action {
        "exchange" => {
            // Cash -> coins at settings cashToCoins (SecurityNormal.java:84-90).
            let golds = num_or(payload.get("value"), 0.0);
            let profile = get_universe_profile(universe).expect("profile");
            if !has_snapshot && golds.is_finite() && golds > 0.0 && profile_num(profile, "DCCash") >= golds {
                add_to_profile(profile, "DCCash", -golds);
                add_to_profile(profile, "DCCoins", golds * cash_to_coins() as f64);
            }
        }
        "unlockItem" => {
            // GamePlay.java:2186-2248
            let sku = js_str_or(payload.get("value"), "");
            if !sku.is_empty() {
                let mut document = repo.get_document(user_id, tags::UNLOCKED)?;
                if add_unlocked_item(&mut document, &sku) {
                    repo.set_document(user_id, tags::UNLOCKED, &document)?;
                }
            }
        }
        "service" => {
            // GamePlay.java:2142-2183 (profile `<sku>TimeOver`, prices SecurityNormal.java:96-107).
            let sku = js_str_or(payload.get("value"), "");
            let contract_id = num_or(payload.get("id"), 0.0);
            let profile = get_universe_profile(universe).expect("profile");
            if apply_service_purchase(profile, &sku, contract_id, now_ms()) && !has_snapshot {
                if let Some(def) = get_service_definition(&sku, contract_id) {
                    let offer = num_or(payload.get("offer"), 0.0) == 1.0;
                    add_to_profile(profile, "DCCoins", -(if offer { def.offer_price_coins } else { def.price_coins }));
                    add_to_profile(profile, "DCCash", -(if offer { def.offer_price_cash } else { def.price_cash }));
                }
            }
        }
        "reward" => {
            if !has_snapshot {
                let reward = news_feed_reward(&js_str_or(payload.get("value"), ""));
                let profile = get_universe_profile(universe).expect("profile");
                add_to_profile(profile, "exp", reward.exp);
                add_to_profile(profile, "DCCoins", reward.coins);
                add_to_profile(profile, "DCCash", reward.cash);
            }
        }
        "openBox" | "briefcase" => {
            // GamePlay.updateFreeGifts :1410-1494; FreeGiftDefinitionManager.openBox :41-55.
            let prize = get_box_prize(&js_str_or(payload.get("prize"), ""));
            let mut storage = repo.get_document(user_id, tags::STORAGE)?;
            let mut storage_changed = false;
            let ty = match non_null(payload.get("type")) {
                Some(v) => js_string(v),
                None => prize.as_ref().and_then(|p| p.r#type.clone()).unwrap_or_default(),
            };
            let value = match non_null(payload.get("value")) {
                Some(v) => js_string(v),
                None => prize.as_ref().and_then(|p| p.value.clone()).unwrap_or_default(),
            };
            let num_value = {
                let n = crate::util::js_string_to_number(&value);
                if n.is_nan() || n == 0.0 { 0.0 } else { n }
            };
            if let Some(p) = &prize {
                let sku = p.r#box.clone().unwrap_or_else(|| "undefined".into());
                storage_changed = adjust_storage(&mut storage, &sku, -1.0) || storage_changed;
            }
            if ty == "move" {
                storage_changed = adjust_storage(&mut storage, "move", num_value) || storage_changed;
            } else if ty == "item" && !value.is_empty() {
                storage_changed = adjust_storage(&mut storage, &value, 1.0) || storage_changed;
            } else if !has_snapshot {
                let profile = get_universe_profile(universe).expect("profile");
                if ty == "cash" {
                    add_to_profile(profile, "DCCoins", num_value * level);
                } else if ty == "gold" {
                    add_to_profile(profile, "DCCash", num_value);
                }
            }
            if storage_changed {
                repo.set_document(user_id, tags::STORAGE, &storage)?;
            }
        }
        "rentAccelerator" => {
            // ToolRentAccelerator.as:48-58
            let accelerator = get_accelerator_storage(&js_str_or(payload.get("sku"), ""));
            if let Some(acc) = &accelerator {
                let mut storage = repo.get_document(user_id, tags::STORAGE)?;
                let sku = acc.storage_sku.clone().unwrap_or_else(|| "undefined".into());
                if adjust_storage(&mut storage, &sku, -1.0) {
                    repo.set_document(user_id, tags::STORAGE, &storage)?;
                }
            }
            apply_rent_accelerator(
                universe,
                &js_str_or(payload.get("itemSid"), ""),
                accelerator.map_or(0.0, |a| a.percent),
            );
        }
        "dailyBonusDone" => {
            // GamePlay.java:2127-2141; SecurityNormal.java:91 (coinsGain = smDailyBonusCoins * 4)
            repo.set_meta(
                &format!("daily_bonus_at_{user_id}"),
                &js_number_to_string(now_ms() as f64 + daily_bonus_time_ms()),
            )?;
            if !has_snapshot {
                let profile = get_universe_profile(universe).expect("profile");
                add_to_profile(profile, "DCCoins", daily_bonus_coins() * 4.0);
            }
        }
        _ => {}
    }
    Ok(())
}

/// commandHandlers.ts:971 `applyRentAccelerator` (StateOnRent.accelerateIncomeTime, StateOnRent.as:1817-1830).
fn apply_rent_accelerator(universe: &mut Value, sid: &str, percent: f64) {
    if sid.is_empty() {
        return;
    }
    let Some(mut found) = find_item_entry(universe, sid) else { return };
    let Some(state) = get_item_state_entry(found.item_entry()) else { return };
    let field = |k: &str| js_string_or_empty(state.get(k));
    if field("id") != "1" || field("mode") != "4" || field("accelerated") == "1" {
        return;
    }
    set_str(state, "accelerated", "1".into());
    let time = num_or(state.get("time"), 0.0);
    let contract_sku = js_string_or_empty(state.get("contractSku"));
    let max_time = contract_income_time_ms(&contract_sku);
    if time.is_finite() && max_time > 0.0 && percent > 0.0 {
        let cut = (max_time * percent / 100.0).trunc();
        set_str(state, "time", js_number_to_string((time - cut).max(0.0)));
        set_str(state, "savedAt", now_ms().to_string());
    }
}

/// saveDefaults/timers.ts:230 `getContractIncomeTimeMs`.
fn contract_income_time_ms(contract_sku: &str) -> f64 {
    crate::save_defaults::get_contract_income_time_ms(contract_sku)
}

pub const COMMANDS: CommandTable = &[
    ("update_profile", update_profile as Handler),
    ("update_money", update_money as Handler),
];
