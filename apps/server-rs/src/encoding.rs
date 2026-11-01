//! Port of `apps/server/src/commandHandlers/encoding.ts`.
#![allow(dead_code)] // some helpers are used only by later packages

use serde_json::{Map, Value};

/// encoding.ts:4 `decodeAsciiCodes`
pub fn decode_ascii_codes(value: &str) -> String {
    value
        .split(',')
        .filter(|p| !p.is_empty())
        .filter_map(|p| parse_int_prefix(p))
        .filter(|c| *c > 0)
        .filter_map(|c| char::from_u32((c as u32) & 0xFFFF))
        .collect()
}

/// JS `Number.parseInt(s, 10)`: optional sign + leading digits, anything after is ignored.
fn parse_int_prefix(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let v: i64 = digits.parse().ok()?;
    Some(if neg { -v } else { v })
}

/// encoding.ts:17 `encodeAsciiCodes`: first UTF-16 unit of every code point, comma separated.
pub fn encode_ascii_codes(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            let mut buf = [0u16; 2];
            c.encode_utf16(&mut buf)[0].to_string()
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn find_profile_mut(universe: &mut Value) -> Option<&mut Value> {
    universe
        .get_mut("universe")?
        .as_array_mut()?
        .iter_mut()
        .find(|e| e.get("Profile").map(Value::is_array).unwrap_or(false))
}

/// encoding.ts:24 `sanitizeUniverseForClient`
pub fn sanitize_universe_for_client(value: &Value) -> Value {
    if !value.is_object() {
        return sanitize_for_client_xml(value);
    }
    let mut sanitized = sanitize_for_client_xml(value);
    let Some(profile) = find_profile_mut(&mut sanitized) else {
        return sanitized;
    };
    let Some(profile) = profile.as_object_mut() else {
        return sanitized;
    };
    let codes = crate::util::js_string_or_empty(profile.get("cityNameCodes"));
    let normalized = sanitize_stored_string(&decode_ascii_codes(&unescape_xml_attribute_value(&codes)));
    if !normalized.is_empty() {
        profile.insert("cityname".into(), Value::String(escape_xml_attribute_value(&normalized)));
        profile.insert(
            "cityNameCodes".into(),
            Value::String(escape_xml_attribute_value(&encode_ascii_codes(&normalized))),
        );
    } else if let Some(Value::String(city)) = profile.get("cityname") {
        let fallback = sanitize_stored_string(&unescape_xml_attribute_value(city));
        let escaped = escape_xml_attribute_value(&fallback);
        let codes = escape_xml_attribute_value(&encode_ascii_codes(&fallback));
        profile.insert("cityname".into(), Value::String(escaped));
        profile.insert("cityNameCodes".into(), Value::String(codes));
    }
    if let Some(Value::String(name)) = profile.get("userName") {
        let v = escape_xml_attribute_value(&sanitize_stored_string(&unescape_xml_attribute_value(name)));
        profile.insert("userName".into(), Value::String(v));
    }
    sanitized
}

/// encoding.ts:50 `sanitizeForClientXml`: strings lose control characters and get XML-attribute escaped, recursively.
pub fn sanitize_for_client_xml(value: &Value) -> Value {
    match value {
        Value::Array(a) => Value::Array(a.iter().map(sanitize_for_client_xml).collect()),
        Value::Object(o) => {
            let mut out = Map::new();
            for (k, v) in o {
                out.insert(k.clone(), sanitize_for_client_xml(v));
            }
            Value::Object(out)
        }
        Value::String(s) => Value::String(escape_xml_attribute_value(&sanitize_stored_string(s))),
        other => other.clone(),
    }
}

/// encoding.ts:69 `sanitizeStoredString`: removes `[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`.
pub fn sanitize_stored_string(value: &str) -> String {
    let is_stripped = |c: char| {
        let u = c as u32;
        (u <= 0x08) || u == 0x0B || u == 0x0C || (0x0E..=0x1F).contains(&u) || u == 0x7F
    };
    if !value.chars().any(is_stripped) {
        return value.to_string();
    }
    value.chars().filter(|c| !is_stripped(*c)).collect()
}

/// `&` `"` `<` `>` `'` -> entities, in one pass (the chained `replace` calls it replaces allocated five strings per call;
/// escaping `&` first and the others after is the same as escaping each character once).
pub fn escape_xml_attribute_value(value: &str) -> String {
    if !value.bytes().any(|b| matches!(b, b'&' | b'"' | b'<' | b'>' | b'\'')) {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len() + 16);
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

pub fn unescape_xml_attribute_value(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}
