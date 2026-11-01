//! Port of `apps/server/src/commandHandlers/money.ts` (package "libs-a", see docs/rust-server-plan.md).
//!
//! `profile` is the `Profile` attribute node of the universe; `security` is the SecurityNormal snapshot object
//! (`None` = undefined). Numbers are read like JS `Number(...)` and written back as JS `String(number)`.

use crate::commands::universe::non_null;
use crate::rules;
use crate::util::{js_number, js_number_to_string, js_string_or_empty};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

/// money.ts:5 `RULES_ROOT` (the original rules XML directory, relative to the workspace root).
fn rules_root() -> PathBuf {
    crate::config::workspace_root().join("assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules")
}

/// money.ts:8 `CASH_TO_COINS` (settings.xml `cashToCoins`, loaded once; 60000 when missing).
pub fn cash_to_coins() -> i64 {
    static VALUE: OnceLock<i64> = OnceLock::new();
    *VALUE.get_or_init(|| rules::load_cash_to_coins(&rules_root().join("settings.xml")))
}

/// money.ts:7 `GOLD_PACKAGE_REWARDS` (fbcredits.xml, loaded once).
fn gold_package_rewards() -> &'static HashMap<String, rules::GoldPackageReward> {
    static VALUE: OnceLock<HashMap<String, rules::GoldPackageReward>> = OnceLock::new();
    VALUE.get_or_init(|| rules::load_gold_package_rewards(&rules_root().join("fbcredits.xml")))
}

/// JS truthiness of an optional JSON value (`!security` is false for objects and arrays).
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map_or(true, |f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `security` when it is truthy (the TS `if (!security) return`).
fn present(security: Option<&Value>) -> Option<&Value> {
    security.filter(|s| is_truthy(s))
}

/// `Number(x ?? "0")`
fn number_or_zero(value: Option<&Value>) -> f64 {
    match non_null(value) {
        Some(v) => js_number(Some(v)),
        None => 0.0,
    }
}

/// `Number(x ?? Number.NaN)`
fn number_or_nan(value: Option<&Value>) -> f64 {
    js_number(non_null(value))
}

/// `Math.max(0, x)`
fn js_max0(x: f64) -> f64 {
    if x.is_nan() || x > 0.0 { x } else { 0.0 }
}

/// `profile[key] = String(value)`
fn set_number(profile: &mut Value, key: &str, value: f64) {
    if let Some(object) = profile.as_object_mut() {
        object.insert(key.to_string(), Value::String(js_number_to_string(value)));
    }
}

/// money.ts:10 `hasMoneySecuritySnapshot`: some `*Now` / `*Gain` field is numeric.
pub fn has_money_security_snapshot(security: Option<&Value>) -> bool {
    let Some(security) = present(security) else {
        return false;
    };
    ["expNow", "coinsNow", "cashNow", "compValueNow", "expGain", "coinsGain", "cashGain", "compValueGain"]
        .iter()
        .any(|key| number_or_nan(security.get(key)).is_finite())
}

/// money.ts:20 `applyMoneySecuritySnapshot`
pub fn apply_money_security_snapshot(profile: &mut Value, security: Option<&Value>) {
    let Some(security) = present(security) else {
        return;
    };
    apply_money_security_field(profile, security, "exp", "expNow", "expGain");
    apply_money_security_field(profile, security, "DCCoins", "coinsNow", "coinsGain");
    apply_money_security_field(profile, security, "DCCash", "cashNow", "cashGain");
    apply_money_security_field(profile, security, "companyValue", "compValueNow", "compValueGain");
}

/// money.ts:31 `applyMoneySecuritySnapshotWithPositiveDeltaFallback`
pub fn apply_money_security_snapshot_with_positive_delta_fallback(profile: &mut Value, security: Option<&Value>) {
    let Some(security) = present(security) else {
        return;
    };
    apply_money_security_field_with_positive_delta_fallback(profile, security, "exp", "expNow", "expGain");
    apply_money_security_field_with_positive_delta_fallback(profile, security, "DCCoins", "coinsNow", "coinsGain");
    apply_money_security_field_with_positive_delta_fallback(profile, security, "DCCash", "cashNow", "cashGain");
    apply_money_security_field_with_positive_delta_fallback(profile, security, "companyValue", "compValueNow", "compValueGain");
}

/// money.ts:45 `applyPositiveMoneySecurityDeltas`
pub fn apply_positive_money_security_deltas(profile: &mut Value, security: Option<&Value>) {
    let Some(security) = present(security) else {
        return;
    };
    apply_positive_money_security_delta(profile, security, "exp", "expNow", "expGain");
    apply_positive_money_security_delta(profile, security, "DCCoins", "coinsNow", "coinsGain");
    apply_positive_money_security_delta(profile, security, "DCCash", "cashNow", "cashGain");
    apply_positive_money_security_delta(profile, security, "companyValue", "compValueNow", "compValueGain");
}

/// money.ts:59 `reconcilePremiumCurrencyPurchase` state argument.
#[derive(Debug, Clone, Copy)]
pub struct PremiumCurrencyState {
    pub previous_cash: f64,
    pub previous_paid_cash: f64,
    pub had_security_snapshot: bool,
}

/// money.ts:59 `reconcilePremiumCurrencyPurchase`: keeps DCCash / DCCashPaid / companyValue consistent after a gold purchase.
pub fn reconcile_premium_currency_purchase(profile: &mut Value, payload: &Value, state: PremiumCurrencyState) {
    if js_string_or_empty(payload.get("action")) != "buyGold" {
        return;
    }

    let sku = js_string_or_empty(payload.get("sku"));
    let Some(reward) = gold_package_rewards().get(sku.trim()) else {
        return;
    };

    let current_cash = number_or_zero(profile.get("DCCash"));
    let current_paid_cash = number_or_zero(profile.get("DCCashPaid"));
    let current_company_value = number_or_zero(profile.get("companyValue"));
    let gold = reward.gold as f64;
    let awarded_cash = (reward.gold + reward.free_gold) as f64;

    if !current_cash.is_finite() || !current_paid_cash.is_finite() || !current_company_value.is_finite() {
        return;
    }

    if current_cash > state.previous_cash {
        if current_paid_cash <= state.previous_paid_cash {
            set_number(profile, "DCCashPaid", state.previous_paid_cash + gold);
        }
        return;
    }

    if state.had_security_snapshot || current_paid_cash > state.previous_paid_cash {
        return;
    }

    set_number(profile, "DCCash", state.previous_cash + awarded_cash);
    set_number(profile, "DCCashPaid", state.previous_paid_cash + gold);
    set_number(profile, "companyValue", current_company_value + awarded_cash * cash_to_coins() as f64);
}

/// money.ts:102 `hasNegativeSecurityDelta`: some `*Gain` field (missing counts as 0) is negative.
pub fn has_negative_security_delta(value: Option<&Value>) -> bool {
    let Some(value) = present(value) else {
        return false;
    };
    ["expGain", "coinsGain", "cashGain", "compValueGain"].iter().any(|key| {
        let delta = number_or_zero(value.get(key));
        delta.is_finite() && delta < 0.0
    })
}

/// money.ts:113 `applyMoneySecurityField`: exp/coins/cash accumulate the reported gain (coins and cash never below 0);
/// companyValue takes the reported `Now`.
fn apply_money_security_field(profile: &mut Value, security: &Value, target_key: &str, absolute_key: &str, delta_key: &str) {
    let absolute_value = number_or_nan(security.get(absolute_key));
    let gain_value = number_or_nan(security.get(delta_key));
    // SecurityNormal.verify (java:784-787): exp/coins/cash accumulate the reported GAIN; only compValue takes the reported "Now".
    // The original client sends a stale (pre-spend) coinsNow on map/contract commands, so trusting Now would lose the spend.
    if target_key != "companyValue" && gain_value.is_finite() && number_or_zero(profile.get(target_key)).is_finite() {
        if gain_value != 0.0 {
            let next = number_or_zero(profile.get(target_key)) + gain_value;
            // Coins and gold are never negative: a spend the saved balance cannot cover (stale client, repeated command) stops at 0.
            let stored = if target_key == "DCCoins" || target_key == "DCCash" { js_max0(next) } else { next };
            set_number(profile, target_key, stored);
        }
        return;
    }

    if absolute_value.is_finite() {
        set_number(profile, target_key, absolute_value);
        return;
    }

    let delta_value = gain_value;
    if !delta_value.is_finite() || delta_value == 0.0 {
        return;
    }

    let current_value = number_or_zero(profile.get(target_key));
    if !current_value.is_finite() {
        return;
    }

    set_number(profile, target_key, current_value + delta_value);
}

/// money.ts:151 `applyMoneySecurityFieldWithPositiveDeltaFallback`
fn apply_money_security_field_with_positive_delta_fallback(
    profile: &mut Value,
    security: &Value,
    target_key: &str,
    absolute_key: &str,
    delta_key: &str,
) {
    let absolute_value = number_or_nan(security.get(absolute_key));
    let delta_value = number_or_nan(security.get(delta_key));
    let current_value = number_or_zero(profile.get(target_key));

    if !current_value.is_finite() {
        return;
    }

    // SecurityNormal.verify (java:784-787): exp/coins/cash accumulate the reported GAIN (negative ones too); the original client's
    // coinsNow/expNow are often the pre-command value, so trusting them would drop a spend (oracle sell-rival-roads, terrain buys).
    if target_key != "companyValue" && delta_value.is_finite() {
        if delta_value != 0.0 {
            set_number(profile, target_key, current_value + delta_value);
        }
        return;
    }

    // SecurityNormal.verify (java:787): user.mCompValue = compValueNow, always (the original's Now lags the last event: docs/save-parity.md).
    if target_key == "companyValue" && absolute_value.is_finite() {
        set_number(profile, target_key, absolute_value);
        return;
    }

    if delta_value.is_finite() && delta_value > 0.0 && (!absolute_value.is_finite() || absolute_value <= current_value) {
        set_number(profile, target_key, current_value + delta_value);
        return;
    }

    if absolute_value.is_finite() {
        set_number(profile, target_key, absolute_value);
        return;
    }

    if !delta_value.is_finite() || delta_value == 0.0 {
        return;
    }

    set_number(profile, target_key, current_value + delta_value);
}

/// money.ts:202 `applyPositiveMoneySecurityDelta`
fn apply_positive_money_security_delta(profile: &mut Value, security: &Value, target_key: &str, absolute_key: &str, delta_key: &str) {
    let delta_value = number_or_nan(security.get(delta_key));
    if !delta_value.is_finite() || delta_value <= 0.0 {
        return;
    }

    let current_value = number_or_zero(profile.get(target_key));
    if !current_value.is_finite() {
        return;
    }

    let absolute_value = number_or_nan(security.get(absolute_key));
    if absolute_value.is_finite() && absolute_value > current_value {
        set_number(profile, target_key, absolute_value);
        return;
    }

    set_number(profile, target_key, current_value + delta_value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::universe::fixture::{assert_same, cases, num};
    use serde_json::json;

    #[test]
    fn cash_to_coins_matches_ts() {
        for case in cases("CASH_TO_COINS") {
            assert_same(&num(cash_to_coins() as f64), &case.output, "CASH_TO_COINS");
        }
    }

    #[test]
    fn has_money_security_snapshot_matches_ts() {
        for case in cases("hasMoneySecuritySnapshot") {
            let args = case.input.clone();
            assert_same(&json!(has_money_security_snapshot(args.get("security"))), &case.output, "hasMoneySecuritySnapshot output");
            assert_same(&args, &case.mutated, "hasMoneySecuritySnapshot mutatedInput");
        }
    }

    #[test]
    fn apply_money_security_snapshot_matches_ts() {
        for case in cases("applyMoneySecuritySnapshot") {
            let mut args = case.input.clone();
            let security = args.get("security").cloned();
            apply_money_security_snapshot(args.get_mut("profile").unwrap(), security.as_ref());
            assert_same(&Value::Null, &case.output, "applyMoneySecuritySnapshot output");
            assert_same(&args, &case.mutated, "applyMoneySecuritySnapshot mutatedInput");
        }
    }

    #[test]
    fn apply_money_security_snapshot_with_positive_delta_fallback_matches_ts() {
        for case in cases("applyMoneySecuritySnapshotWithPositiveDeltaFallback") {
            let mut args = case.input.clone();
            let security = args.get("security").cloned();
            apply_money_security_snapshot_with_positive_delta_fallback(args.get_mut("profile").unwrap(), security.as_ref());
            assert_same(&Value::Null, &case.output, "applyMoneySecuritySnapshotWithPositiveDeltaFallback output");
            assert_same(&args, &case.mutated, "applyMoneySecuritySnapshotWithPositiveDeltaFallback mutatedInput");
        }
    }

    #[test]
    fn apply_positive_money_security_deltas_matches_ts() {
        for case in cases("applyPositiveMoneySecurityDeltas") {
            let mut args = case.input.clone();
            let security = args.get("security").cloned();
            apply_positive_money_security_deltas(args.get_mut("profile").unwrap(), security.as_ref());
            assert_same(&Value::Null, &case.output, "applyPositiveMoneySecurityDeltas output");
            assert_same(&args, &case.mutated, "applyPositiveMoneySecurityDeltas mutatedInput");
        }
    }

    #[test]
    fn reconcile_premium_currency_purchase_matches_ts() {
        for case in cases("reconcilePremiumCurrencyPurchase") {
            let mut args = case.input.clone();
            let payload = args["payload"].clone();
            let state = PremiumCurrencyState {
                previous_cash: args["state"]["previousCash"].as_f64().unwrap(),
                previous_paid_cash: args["state"]["previousPaidCash"].as_f64().unwrap(),
                had_security_snapshot: args["state"]["hadSecuritySnapshot"].as_bool().unwrap(),
            };
            reconcile_premium_currency_purchase(args.get_mut("profile").unwrap(), &payload, state);
            assert_same(&Value::Null, &case.output, "reconcilePremiumCurrencyPurchase output");
            assert_same(&args, &case.mutated, "reconcilePremiumCurrencyPurchase mutatedInput");
        }
    }

    #[test]
    fn has_negative_security_delta_matches_ts() {
        for case in cases("hasNegativeSecurityDelta") {
            let args = case.input.clone();
            assert_same(&json!(has_negative_security_delta(args.get("value"))), &case.output, "hasNegativeSecurityDelta output");
            assert_same(&args, &case.mutated, "hasNegativeSecurityDelta mutatedInput");
        }
    }
}
