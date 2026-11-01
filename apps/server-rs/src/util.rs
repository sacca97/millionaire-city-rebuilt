//! Small helpers that mimic JavaScript semantics the TS server relies on.

use rand::RngCore;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// `Date.now()`
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `new Date().toISOString()`
pub fn iso_now() -> String {
    iso_from_ms(now_ms())
}

pub fn iso_from_ms(ms: i64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp_nanos(ms as i128 * 1_000_000)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        dt.year(),
        dt.month() as u8,
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second(),
        dt.millisecond()
    )
}

/// `crypto.randomBytes(n).toString("hex")`
pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    hex(&buf)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// JS number to string (`String(n)`) for the values this server meets.
pub fn js_number_to_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n == n.trunc() && n.abs() < 1e21 {
        format!("{}", n as i128)
    } else {
        format!("{n}")
    }
}

/// JS `String(value)` for a JSON value (`undefined` is modelled by `None` -> "undefined").
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => match n.as_f64() {
            Some(f) if n.is_f64() => js_number_to_string(f),
            _ => n.to_string(),
        },
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|v| if v.is_null() { String::new() } else { js_string(v) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `String(x ?? "")`
pub fn js_string_or_empty(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(v) => js_string(v),
    }
}

/// JS `Number(value)` (`undefined` -> NaN).
pub fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => {
            if *b { 1.0 } else { 0.0 }
        }
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => js_string_to_number(s),
        Some(Value::Array(a)) => match a.len() {
            0 => 0.0,
            1 => js_number(Some(&a[0])),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// JS `Number("...")`.
pub fn js_string_to_number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        return i64::from_str_radix(h, 16).map(|v| v as f64).unwrap_or(f64::NAN);
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // Rust accepts "inf"/"nan"/"infinity"; JS does not.
    if t.chars().any(|c| c.is_ascii_alphabetic() && c != 'e' && c != 'E') {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// Decode `%XX` like `decodeURIComponent` (None on malformed input).
pub fn decode_uri_component(s: &str) -> Option<String> {
    percent_encoding::percent_decode_str(s)
        .decode_utf8()
        .ok()
        .map(|c| c.into_owned())
}

/// `encodeURIComponent`
pub fn encode_uri_component(s: &str) -> String {
    const SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'!')
        .remove(b'~')
        .remove(b'*')
        .remove(b'\'')
        .remove(b'(')
        .remove(b')');
    percent_encoding::utf8_percent_encode(s, SET).to_string()
}

/// `URLSearchParams#toString` encoding (application/x-www-form-urlencoded).
pub fn form_urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'*' | b'-' | b'.' | b'_' | b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Parse `a=b&c=d` (querystring semantics: `+` is a space, bad escapes stay literal).
pub fn parse_query(raw: &str) -> Vec<(String, String)> {
    raw.split('&')
        .filter(|p| !p.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (qs_unescape(k), qs_unescape(v))
        })
        .collect()
}

fn qs_unescape(s: &str) -> String {
    let replaced = s.replace('+', " ");
    match decode_uri_component(&replaced) {
        Some(v) => v,
        None => replaced,
    }
}

/// UTF-16 code unit count/iteration helper (`String#charCodeAt`).
pub fn utf16_units(s: &str) -> impl Iterator<Item = u16> + '_ {
    s.encode_utf16()
}
