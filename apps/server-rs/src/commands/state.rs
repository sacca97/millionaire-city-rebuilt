//! Port of `apps/server/src/commandHandlers/state.ts` (package "libs-a", see docs/rust-server-plan.md).

use crate::commands::universe::non_null;
use crate::save_tree::{create_element, find_element_child};
use crate::util::{js_number, js_number_to_string, js_string, js_string_to_number, now_ms};
use serde_json::Value;
use std::cmp::Ordering;

/// state.ts:5 `STATE_ATTRIBUTE_KEYS`
const STATE_ATTRIBUTE_KEYS: [&str; 6] = ["mode", "time", "contractSku", "accelerated", "contractGroupSku", "doubleRent"];

/// A JS `Map<string, number>` in insertion order (state.ts `parseCountChunkSet` result).
pub type CountChunkSet = Vec<(String, f64)>;

/// state.ts:7 `hasStateMutation`: some state key is present (not null/undefined) in the payload.
pub fn has_state_mutation(payload: &Value) -> bool {
    non_null(payload.get("state")).is_some() || STATE_ATTRIBUTE_KEYS.iter().any(|key| non_null(payload.get(key)).is_some())
}

/// state.ts:11 `extractStateAttributes` with an explicit clock: `savedAt` is `now_ms` when `time > 0` (TS: `Date.now()`).
pub fn extract_state_attributes_at(payload: &Value, now_ms: i64) -> Vec<(String, String)> {
    let mut attributes = Vec::new();
    if let Some(state) = non_null(payload.get("state")) {
        attributes.push(("id".to_string(), js_string(state)));
    }
    for key in STATE_ATTRIBUTE_KEYS {
        if let Some(value) = non_null(payload.get(key)) {
            attributes.push((key.to_string(), js_string(value)));
        }
    }
    if non_null(payload.get("time")).is_some() && js_number(non_null(payload.get("time"))) > 0.0 {
        attributes.push(("savedAt".to_string(), now_ms.to_string()));
    }
    attributes
}

/// state.ts:11 `extractStateAttributes` (reads the current time).
pub fn extract_state_attributes(payload: &Value) -> Vec<(String, String)> {
    extract_state_attributes_at(payload, now_ms())
}

/// state.ts:30 `extractIncomingItemEntry`: a deep copy of `value` when it is an object with an `Item` array.
pub fn extract_incoming_item_entry(value: Option<&Value>) -> Option<Value> {
    extract_incoming_element(value, "Item")
}

/// state.ts:43 `extractIncomingElement`: a deep copy of `value` when it is an object with an array under `tag_name`.
pub fn extract_incoming_element(value: Option<&Value>, tag_name: &str) -> Option<Value> {
    let value = value.filter(|v| v.is_object())?;
    let entry = value.clone();
    if !entry.get(tag_name).map(Value::is_array).unwrap_or(false) {
        return None;
    }
    Some(entry)
}

/// state.ts:56 `parseCountChunkSet`: `chunk` attribute of `entry` as `sku/count` pairs (the last `/` splits; bad counts dropped).
pub fn parse_count_chunk_set(entry: Option<&Value>) -> CountChunkSet {
    let mut counts = CountChunkSet::new();
    let chunk = match entry.and_then(|e| e.get("chunk")).and_then(Value::as_str) {
        Some(chunk) if !chunk.is_empty() => chunk,
        _ => return counts,
    };
    for part in chunk.split(',') {
        if part.is_empty() {
            continue;
        }
        let Some(separator) = part.rfind('/') else {
            continue;
        };
        let sku = &part[..separator];
        let value = js_string_to_number(&part[separator + 1..]);
        if !sku.is_empty() && value.is_finite() {
            set_count(&mut counts, sku, value);
        }
    }
    counts
}

/// `Map#set` on a `CountChunkSet`: replaces the value in place, or appends.
fn set_count(counts: &mut CountChunkSet, sku: &str, value: f64) {
    match counts.iter_mut().find(|(key, _)| key == sku) {
        Some(entry) => entry.1 = value,
        None => counts.push((sku.to_string(), value)),
    }
}

/// state.ts:80 `upsertCountChunkElement`: sets `chunk` on the existing `tag` child, or appends `{tag: [], chunk}`.
pub fn upsert_count_chunk_element(children: &mut Vec<Value>, tag_name: &str, values: &CountChunkSet) {
    let chunk = serialize_count_chunk_set(values);
    if let Some(index) = find_element_child(children, tag_name) {
        children[index]["chunk"] = Value::String(chunk);
        return;
    }
    children.push(create_element(tag_name, &[("chunk", chunk.as_str())], Vec::new()));
}

/// state.ts:90 `toRecord`: the value when it is an object or array (JS `typeof === "object"`), else None.
pub fn to_record(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| v.is_object() || v.is_array())
}

/// state.ts:94 `serializeCountChunkSet`: entries sorted with `localeCompare`, joined as `sku/value`.
fn serialize_count_chunk_set(values: &CountChunkSet) -> String {
    let mut sorted: Vec<&(String, f64)> = values.iter().collect();
    sorted.sort_by(|left, right| locale_compare(&left.0, &right.0));
    sorted
        .iter()
        .map(|(sku, value)| format!("{sku}/{}", js_number_to_string(*value)))
        .collect::<Vec<_>>()
        .join(",")
}

/// JS `a.localeCompare(b)` (ICU root collation, as under en-US) for the ASCII keys this server writes.
/// Approximation: punctuation < digits < letters; letters compare case-insensitively first, lowercase first on ties;
/// control characters are ignored; other characters sort by code point after ASCII.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let (primary_a, tertiary_a) = collation_key(a);
    let (primary_b, tertiary_b) = collation_key(b);
    primary_a.cmp(&primary_b).then_with(|| tertiary_a.cmp(&tertiary_b))
}

/// ASCII punctuation and symbols in ICU root order (after the whitespace weights, before digits).
const PUNCTUATION_ORDER: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn collation_key(s: &str) -> (Vec<u32>, Vec<u8>) {
    let mut primary = Vec::new();
    let mut tertiary = Vec::new();
    for c in s.chars() {
        if let Some(weight) = primary_weight(c) {
            primary.push(weight);
            tertiary.push(u8::from(c.is_ascii_uppercase()));
        }
    }
    (primary, tertiary)
}

fn primary_weight(c: char) -> Option<u32> {
    match c {
        '\t' => Some(1),
        '\n' => Some(2),
        '\u{b}' => Some(3),
        '\u{c}' => Some(4),
        '\r' => Some(5),
        ' ' => Some(6),
        c if c.is_ascii_control() => None,
        c if c.is_ascii_digit() => Some(100 + (c as u32 - '0' as u32)),
        c if c.is_ascii_alphabetic() => Some(200 + (c.to_ascii_lowercase() as u32 - 'a' as u32)),
        c if c.is_ascii() => Some(10 + PUNCTUATION_ORDER.find(c).map(|i| i as u32).unwrap_or(90)),
        c => Some(1000 + c as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::universe::fixture::{assert_same, cases, num};
    use serde_json::json;

    fn pairs_value(pairs: Vec<(String, String)>) -> Value {
        Value::Object(pairs.into_iter().map(|(k, v)| (k, Value::String(v))).collect())
    }

    fn counts_value(counts: &CountChunkSet) -> Value {
        Value::Array(counts.iter().map(|(k, v)| json!([k, num(*v)])).collect())
    }

    fn counts_from(values: &Value) -> CountChunkSet {
        values
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| (pair[0].as_str().unwrap().to_string(), pair[1].as_f64().unwrap()))
            .collect()
    }

    #[test]
    fn has_state_mutation_matches_ts() {
        for case in cases("hasStateMutation") {
            let args = case.input.clone();
            assert_same(&json!(has_state_mutation(&args["payload"])), &case.output, "hasStateMutation output");
            assert_same(&args, &case.mutated, "hasStateMutation mutatedInput");
        }
    }

    #[test]
    fn extract_state_attributes_matches_ts() {
        for case in cases("extractStateAttributes") {
            let args = case.input.clone();
            let now = args["nowMs"].as_i64().unwrap();
            assert_same(&pairs_value(extract_state_attributes_at(&args["payload"], now)), &case.output, "extractStateAttributes output");
            assert_same(&args, &case.mutated, "extractStateAttributes mutatedInput");
        }
    }

    #[test]
    fn extract_incoming_item_entry_matches_ts() {
        for case in cases("extractIncomingItemEntry") {
            let args = case.input.clone();
            let out = extract_incoming_item_entry(args.get("value")).unwrap_or(Value::Null);
            assert_same(&out, &case.output, "extractIncomingItemEntry output");
            assert_same(&args, &case.mutated, "extractIncomingItemEntry mutatedInput");
        }
    }

    #[test]
    fn extract_incoming_element_matches_ts() {
        for case in cases("extractIncomingElement") {
            let args = case.input.clone();
            let tag = args["tagName"].as_str().unwrap();
            let out = extract_incoming_element(args.get("value"), tag).unwrap_or(Value::Null);
            assert_same(&out, &case.output, "extractIncomingElement output");
            assert_same(&args, &case.mutated, "extractIncomingElement mutatedInput");
        }
    }

    #[test]
    fn parse_count_chunk_set_matches_ts() {
        for case in cases("parseCountChunkSet") {
            let args = case.input.clone();
            assert_same(&counts_value(&parse_count_chunk_set(args.get("entry"))), &case.output, "parseCountChunkSet output");
            assert_same(&args, &case.mutated, "parseCountChunkSet mutatedInput");
        }
    }

    #[test]
    fn upsert_count_chunk_element_matches_ts() {
        for case in cases("upsertCountChunkElement") {
            let mut args = case.input.clone();
            let counts = counts_from(&args["values"]);
            let tag = args["tagName"].as_str().unwrap().to_string();
            upsert_count_chunk_element(args["children"].as_array_mut().unwrap(), &tag, &counts);
            assert_same(&Value::Null, &case.output, "upsertCountChunkElement output");
            assert_same(&args, &case.mutated, "upsertCountChunkElement mutatedInput");
        }
    }

    #[test]
    fn to_record_matches_ts() {
        for case in cases("toRecord") {
            let args = case.input.clone();
            let out = to_record(args.get("value")).cloned().unwrap_or(Value::Null);
            assert_same(&out, &case.output, "toRecord output");
            assert_same(&args, &case.mutated, "toRecord mutatedInput");
        }
    }
}
