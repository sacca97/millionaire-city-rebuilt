//! Port of `apps/server/src/commandHandlers/upgrades.ts` (package "libs-a", see docs/rust-server-plan.md).

use crate::commands::universe::{js_str_or, DEFAULT_USER_ID};
use crate::util::{js_number_to_string, js_string_or_empty};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use time::{Date, Duration, OffsetDateTime, UtcOffset};

/// upgrades.ts:12 `VISITOR_UPGRADES_PER_DAY`
pub const VISITOR_UPGRADES_PER_DAY: usize = 5;

/// upgrades.ts:13 `NPC_UPGRADES_STATE_KEY`: the document key holding the upgrade records.
const NPC_UPGRADES_STATE_KEY: &str = "__npcUpgradeRecords";

/// upgrades.ts:4 `UpgradeRecord` (the TS object keys, in the order the TS writes them).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeRecord {
    pub owner_id: String,
    pub sid: String,
    pub visitor_ext_id: String,
    pub r#type: String,
    pub day_key: String,
}

/// upgrades.ts:15 `getStoredUpgradeRecords`: the normalised records with a non-empty sid, visitorExtId and dayKey.
pub fn get_stored_upgrade_records(document: &Value) -> Vec<UpgradeRecord> {
    let Some(entries) = document.get(NPC_UPGRADES_STATE_KEY).and_then(Value::as_array) else {
        return Vec::new();
    };
    let default_owner = js_number_to_string(DEFAULT_USER_ID);
    entries
        .iter()
        .filter(|entry| entry.is_object())
        .map(|entry| UpgradeRecord {
            owner_id: js_str_or(entry.get("ownerId"), &default_owner),
            sid: js_string_or_empty(entry.get("sid")),
            visitor_ext_id: js_string_or_empty(entry.get("visitorExtId")),
            r#type: js_str_or(entry.get("type"), "0"),
            day_key: js_string_or_empty(entry.get("dayKey")),
        })
        .filter(|record| !record.sid.is_empty() && !record.visitor_ext_id.is_empty() && !record.day_key.is_empty())
        .collect()
}

/// upgrades.ts:33 `setStoredUpgradeRecords`: replaces the document's upgrade records (objects written with the
/// `UpgradeRecord` key order).
pub fn set_stored_upgrade_records(document: &mut Value, records: &[UpgradeRecord]) {
    let entries: Vec<Value> = records
        .iter()
        .map(|r| {
            json!({
                "ownerId": r.owner_id,
                "sid": r.sid,
                "visitorExtId": r.visitor_ext_id,
                "type": r.r#type,
                "dayKey": r.day_key,
            })
        })
        .collect();
    if let Some(object) = document.as_object_mut() {
        object.insert(NPC_UPGRADES_STATE_KEY.to_string(), Value::Array(entries));
    }
}

/// upgrades.ts:37 `getLocalDayKey(dayOffset)` for an explicit clock and UTC offset: the local `YYYY-MM-DD` of
/// `now_ms` plus `day_offset` days (the TS adds days with `setDate`, which keeps the local wall-clock date arithmetic).
pub fn get_local_day_key_at(now_ms: i64, day_offset: i64, utc_offset_seconds: i32) -> String {
    let utc = OffsetDateTime::from_unix_timestamp(now_ms.div_euclid(1000)).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    let offset = UtcOffset::from_whole_seconds(utc_offset_seconds).unwrap_or(UtcOffset::UTC);
    let local: Date = utc.to_offset(offset).date();
    let day: Date = local.checked_add(Duration::days(day_offset)).unwrap_or(local);
    format!("{}-{:02}-{:02}", day.year(), day.month() as u8, day.day())
}

/// upgrades.ts:37 `getLocalDayKey(dayOffset = 0)`: uses the current time and the local time zone.
pub fn get_local_day_key(day_offset: i64) -> String {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    get_local_day_key_at(now_ms, day_offset, local_utc_offset_seconds(now_ms.div_euclid(1000)))
}

/// Local UTC offset (seconds east) at `epoch_secs` through the C library (`localtime_r`); 0 when unavailable.
fn local_utc_offset_seconds(epoch_secs: i64) -> i32 {
    #[cfg(all(unix, target_pointer_width = "64"))]
    {
        use std::ffi::c_char;
        // struct tm of glibc and macOS on 64-bit targets (tm_gmtoff is the last scalar before tm_zone).
        #[repr(C)]
        struct Tm {
            tm_sec: i32,
            tm_min: i32,
            tm_hour: i32,
            tm_mday: i32,
            tm_mon: i32,
            tm_year: i32,
            tm_wday: i32,
            tm_yday: i32,
            tm_isdst: i32,
            tm_gmtoff: i64,
            tm_zone: *const c_char,
        }
        extern "C" {
            fn localtime_r(time: *const i64, result: *mut Tm) -> *mut Tm;
        }
        // SAFETY: both pointers reference valid, live locals of the declared layout; localtime_r writes only into `tm`.
        unsafe {
            let mut tm: Tm = std::mem::zeroed();
            if localtime_r(&epoch_secs, &mut tm).is_null() {
                return 0;
            }
            tm.tm_gmtoff as i32
        }
    }
    #[cfg(not(all(unix, target_pointer_width = "64")))]
    {
        let _ = epoch_secs;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::universe::fixture::{assert_same, cases, num};

    fn record_from(value: &Value) -> UpgradeRecord {
        let text = |key: &str| value[key].as_str().unwrap().to_string();
        UpgradeRecord {
            owner_id: text("ownerId"),
            sid: text("sid"),
            visitor_ext_id: text("visitorExtId"),
            r#type: text("type"),
            day_key: text("dayKey"),
        }
    }

    fn record_value(record: &UpgradeRecord) -> Value {
        json!({
            "ownerId": record.owner_id,
            "sid": record.sid,
            "visitorExtId": record.visitor_ext_id,
            "type": record.r#type,
            "dayKey": record.day_key,
        })
    }

    #[test]
    fn visitor_upgrades_per_day_matches_ts() {
        for case in cases("VISITOR_UPGRADES_PER_DAY") {
            assert_same(&num(VISITOR_UPGRADES_PER_DAY as f64), &case.output, "VISITOR_UPGRADES_PER_DAY");
        }
    }

    #[test]
    fn get_stored_upgrade_records_matches_ts() {
        for case in cases("getStoredUpgradeRecords") {
            let args = case.input.clone();
            let out = Value::Array(get_stored_upgrade_records(&args["document"]).iter().map(record_value).collect());
            assert_same(&out, &case.output, "getStoredUpgradeRecords output");
            assert_same(&args, &case.mutated, "getStoredUpgradeRecords mutatedInput");
        }
    }

    #[test]
    fn set_stored_upgrade_records_matches_ts() {
        for case in cases("setStoredUpgradeRecords") {
            let mut args = case.input.clone();
            let records: Vec<UpgradeRecord> = args["records"].as_array().unwrap().iter().map(record_from).collect();
            set_stored_upgrade_records(args.get_mut("document").unwrap(), &records);
            assert_same(&Value::Null, &case.output, "setStoredUpgradeRecords output");
            assert_same(&args, &case.mutated, "setStoredUpgradeRecords mutatedInput");
        }
    }

    #[test]
    fn get_local_day_key_matches_ts() {
        for case in cases("getLocalDayKey") {
            let args = case.input.clone();
            let out = get_local_day_key_at(
                args["nowMs"].as_i64().unwrap(),
                args["dayOffset"].as_i64().unwrap(),
                args["utcOffsetSeconds"].as_i64().unwrap() as i32,
            );
            assert_same(&json!(out), &case.output, "getLocalDayKey output");
            assert_same(&args, &case.mutated, "getLocalDayKey mutatedInput");
        }
    }

    #[test]
    fn get_local_day_key_uses_the_local_clock() {
        let key = get_local_day_key(0);
        assert_eq!(key.len(), 10, "{key}");
        assert_eq!(key.as_bytes()[4], b'-');
        assert_eq!(key.as_bytes()[7], b'-');
        let offset = local_utc_offset_seconds(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64);
        assert!(offset.abs() <= 14 * 3600, "offset {offset}");
    }
}
