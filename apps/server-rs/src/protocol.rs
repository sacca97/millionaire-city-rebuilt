//! Port of `packages/shared/src/protocol.ts`: the `/Game` response envelope and request command-list decoding.

use crate::repository::DEFAULT_SYNC;
use crate::util::utf16_units;
use serde_json::{json, Map, Value};

/// A packet command is a JSON object `{ _cmd, _dat, _sync? }`; key order matters (it is serialised as built).
pub fn packet(cmd: &str, dat: Value, sync: Option<i64>) -> Value {
    let mut m = Map::new();
    m.insert("_cmd".into(), Value::String(cmd.into()));
    m.insert("_dat".into(), dat);
    if let Some(s) = sync {
        m.insert("_sync".into(), json!(s));
    }
    Value::Object(m)
}

/// protocol.ts:3 `buildLoginEnvelope` (call_id "login").
pub fn build_login_envelope(command: Value) -> String {
    let sync = command.get("_sync").cloned().unwrap_or(json!(DEFAULT_SYNC));
    let commands = serde_json::to_string(&json!({ "list": [command], "_msgCount": -1, "_sync": sync })).unwrap();
    build_envelope("login", &commands)
}

/// protocol.ts:19 `buildCommandEnvelope`
pub fn build_command_envelope(commands: Vec<Value>, msg_count: &Value, sync: i64) -> String {
    let mut payload = Map::new();
    payload.insert("list".into(), Value::Array(commands));
    payload.insert("_msgCount".into(), msg_count.clone());
    payload.insert("_sync".into(), json!(sync));
    let serialized = serde_json::to_string(&Value::Object(payload)).unwrap();
    build_envelope("cmdList", &serialized)
}

fn build_envelope(call_id: &str, commands: &str) -> String {
    [
        format!("<Response service=\"Command\" call_id=\"{call_id}\">"),
        "  <response_code>0</response_code>".to_string(),
        "  <data>".to_string(),
        format!("    <chk>{}</chk>", get_chk(commands)),
        format!("    <commands><![CDATA[{commands}]]></commands>"),
        "  </data>".to_string(),
        "</Response>".to_string(),
    ]
    .join("\n")
}

/// protocol.ts:63 `getChk`: `checksum = (23 * checksum + charCodeAt) | 0` over UTF-16 code units, starting at 317.
pub fn get_chk(value: &str) -> i32 {
    let mut checksum: i32 = 317;
    for unit in utf16_units(value) {
        checksum = checksum.wrapping_mul(23).wrapping_add(unit as i32);
    }
    checksum
}

/// protocol.ts:53 `normalizeIncomingCommandList`: `_cmdList` entries that are objects with a string `_cmd`.
pub fn normalize_incoming_command_list(raw: &Value) -> Vec<Value> {
    match raw.get("_cmdList").and_then(Value::as_array) {
        Some(list) => list
            .iter()
            .filter(|v| v.get("_cmd").map(Value::is_string).unwrap_or(false))
            .cloned()
            .collect(),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chk_matches_the_ts_algorithm() {
        // getChk("") = 317; getChk("a") = 23*317+97 = 7388
        assert_eq!(get_chk(""), 317);
        assert_eq!(get_chk("a"), 7388);
        // non-BMP characters count as two UTF-16 code units, like charCodeAt
        assert_eq!(get_chk("\u{1F600}"), (23i32 * 317 + 0xD83D).wrapping_mul(23).wrapping_add(0xDE00));
    }

    #[test]
    fn envelope_shape() {
        let xml = build_command_envelope(vec![packet("ping", json!({}), Some(1))], &json!(-1), 1);
        assert!(xml.starts_with("<Response service=\"Command\" call_id=\"cmdList\">\n  <response_code>0</response_code>\n  <data>\n    <chk>"));
        assert!(xml.contains("<commands><![CDATA[{\"list\":[{\"_cmd\":\"ping\",\"_dat\":{},\"_sync\":1}],\"_msgCount\":-1,\"_sync\":1}]]></commands>"));
    }
}
