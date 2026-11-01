//! Port of `apps/server/src/saveTree.ts`: helpers over the "XML as JSON" document tree
//! (an element is `{ "<Tag>": [children...], ...attributes }`).
#![allow(dead_code)] // used by the command packages as they are ported

use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub type Node = Map<String, Value>;

/// saveTree.ts:3
pub fn leaf_element(name: &str, attributes: &[(&str, &str)]) -> Value {
    create_element(name, attributes, Vec::new())
}

/// saveTree.ts:10
pub fn create_element(name: &str, attributes: &[(&str, &str)], children: Vec<Value>) -> Value {
    let mut m = Map::new();
    m.insert(name.to_string(), Value::Array(children));
    for (k, v) in attributes {
        m.insert((*k).to_string(), Value::String((*v).to_string()));
    }
    Value::Object(m)
}

/// `Array.isArray(entry[tag])`
pub fn has_children(entry: &Value, tag: &str) -> bool {
    entry.get(tag).map(Value::is_array).unwrap_or(false)
}

/// saveTree.ts:17 `getElementChildren`: the children array of `entry[tag]` (created empty when absent or not an array).
pub fn get_element_children<'a>(entry: &'a mut Value, tag: &str) -> &'a mut Vec<Value> {
    let obj = entry.as_object_mut().expect("element must be an object");
    if !obj.get(tag).map(Value::is_array).unwrap_or(false) {
        obj.insert(tag.to_string(), Value::Array(Vec::new()));
    }
    obj.get_mut(tag).and_then(Value::as_array_mut).expect("just inserted")
}

/// saveTree.ts:27 `findElementChild` (index form, so callers can borrow mutably afterwards).
pub fn find_element_child(children: &[Value], tag: &str) -> Option<usize> {
    children.iter().position(|e| has_children(e, tag))
}

/// saveTree.ts:34 `getOrCreateElementChild`
pub fn get_or_create_element_child<'a>(children: &'a mut Vec<Value>, tag: &str) -> &'a mut Value {
    let idx = match find_element_child(children, tag) {
        Some(i) => i,
        None => {
            children.push(create_element(tag, &[], Vec::new()));
            children.len() - 1
        }
    };
    &mut children[idx]
}

/// saveTree.ts:45 `upsertElementChild`
pub fn upsert_element_child(children: &mut Vec<Value>, tag: &str, entry: Value) {
    match find_element_child(children, tag) {
        Some(i) => children[i] = entry,
        None => children.push(entry),
    }
}

/// saveTree.ts:57 `parseChunkSet`
pub fn parse_chunk_set(entry: Option<&Value>) -> BTreeSet<String> {
    match entry.and_then(|e| e.get("chunk")).and_then(Value::as_str) {
        Some(chunk) if !chunk.is_empty() => chunk.split(',').filter(|p| !p.is_empty()).map(String::from).collect(),
        _ => BTreeSet::new(),
    }
}

/// saveTree.ts:65 `serializeChunkSet`. NOTE: JS `Array#sort()` orders by UTF-16 code units, which equals `BTreeSet<String>`
/// (byte-wise) order for the ASCII chunk keys ("x:y") used here.
pub fn serialize_chunk_set(values: &BTreeSet<String>) -> String {
    values.iter().cloned().collect::<Vec<_>>().join(",")
}

/// saveTree.ts:69 `upsertChunkElement`
pub fn upsert_chunk_element(children: &mut Vec<Value>, tag: &str, values: &BTreeSet<String>) {
    if let Some(i) = find_element_child(children, tag) {
        children[i]["chunk"] = Value::String(serialize_chunk_set(values));
        return;
    }
    children.push(create_element(tag, &[("chunk", &serialize_chunk_set(values))], Vec::new()));
}
