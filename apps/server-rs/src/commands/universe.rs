//! Port of `apps/server/src/commandHandlers/universe.ts` (package "libs-a", see docs/rust-server-plan.md).
//!
//! `MutableNode` is a document node (`serde_json::Value`, normally an object). Lookups return references into the document,
//! like the TS returns live references; mutation happens in place.

use crate::repository::DEFAULT_USER_ID as DEFAULT_USER_ID_I64;
use crate::save_tree::{create_element, find_element_child, get_element_children, has_children};
use crate::util::{js_number, js_string, js_string_or_empty};
use serde_json::Value;
use std::collections::HashSet;

/// universe.ts:8 `DEFAULT_CITY_NAME` (same value as `save_defaults::DEFAULT_CITY_NAME`).
pub const DEFAULT_CITY_NAME: &str = crate::save_defaults::DEFAULT_CITY_NAME;

/// universe.ts:4 `MutableNode` (a JSON object node of the save tree).
pub type MutableNode = Value;

/// universe.ts:9 `HQ_SKINS` (not exported by the TS; shared here because the HQ helpers need it).
pub const HQ_SKINS: [&str; 4] = ["HeadQuarter_01", "HeadQuarter_02", "HeadQuarter_03", "HeadQuarter_04"];

/// `DEFAULT_USER_ID` from `@mcity/shared` (JS number).
pub const DEFAULT_USER_ID: f64 = DEFAULT_USER_ID_I64 as f64;

/// JS `x ?? y` on an optional JSON value: `None` (undefined) and `null` are both absent.
pub fn non_null(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

/// `String(x ?? default)`
pub fn js_str_or(value: Option<&Value>, default: &str) -> String {
    match non_null(value) {
        Some(v) => js_string(v),
        None => default.to_string(),
    }
}

/// `Array.isArray(entry)`-style search: first list entry (object) that has an array under `tag`.
fn find_with_array<'a>(list: &'a mut [Value], tag: &str) -> Option<&'a mut Value> {
    list.iter_mut().find(|e| has_children(e, tag))
}

/// universe.ts:11 `getUniverseProfile`: the `{Profile: [...]}` entry of the `universe` array.
pub fn get_universe_profile(universe: &mut Value) -> Option<&mut Value> {
    find_with_array(universe.get_mut("universe")?.as_array_mut()?, "Profile")
}

/// universe.ts:23 `getPlotsEntry`: the `{Plots: [...]}` entry inside the profile.
pub fn get_plots_entry(universe: &mut Value) -> Option<&mut Value> {
    let profile = get_universe_profile(universe)?;
    find_with_array(profile.get_mut("Profile")?.as_array_mut()?, "Plots")
}

/// universe.ts:35 `getWorldContainer`: the `{World: [...]}` entry of the `universe` array.
pub fn get_world_container(universe: &mut Value) -> Option<&mut Value> {
    find_with_array(universe.get_mut("universe")?.as_array_mut()?, "World")
}

/// universe.ts:47 `getCompanyEntryByWhose`: the `{Company: [...]}` world entry whose `whose` attribute equals `whose`.
pub fn get_company_entry_by_whose<'a>(universe: &'a mut Value, whose: &str) -> Option<&'a mut Value> {
    let world = get_world_container(universe)?;
    world
        .get_mut("World")?
        .as_array_mut()?
        .iter_mut()
        .find(|e| has_children(e, "Company") && js_string_or_empty(e.get("whose")) == whose)
}

/// universe.ts:60 `getCompanyEntryBySid`: the `{Company: [...]}` world entry whose `sid` equals `sid` (empty sid: none).
pub fn get_company_entry_by_sid<'a>(universe: &'a mut Value, sid: &str) -> Option<&'a mut Value> {
    if sid.is_empty() {
        return None;
    }
    let world = get_world_container(universe)?;
    world
        .get_mut("World")?
        .as_array_mut()?
        .iter_mut()
        .find(|e| has_children(e, "Company") && js_string_or_empty(e.get("sid")) == sid)
}

/// universe.ts:77 `getMapEntry`: the `{Map: [...]}` world entry.
pub fn get_map_entry(universe: &mut Value) -> Option<&mut Value> {
    let world = get_world_container(universe)?;
    find_with_array(world.get_mut("World")?.as_array_mut()?, "Map")
}

/// universe.ts:89 `resolveTargetOwnerId`: `Number(payload[key] ?? targetUserId ?? ownerId ?? DEFAULT)`, NaN -> DEFAULT.
pub fn resolve_target_owner_id(payload: &Value, preferred_key: &str) -> f64 {
    let raw = non_null(payload.get(preferred_key))
        .or(non_null(payload.get("targetUserId")))
        .or(non_null(payload.get("ownerId")));
    let owner_id = match raw {
        Some(v) => js_number(Some(v)),
        None => DEFAULT_USER_ID,
    };
    if owner_id.is_finite() { owner_id } else { DEFAULT_USER_ID }
}

/// universe.ts:95 `resolveUpgradeOwnerId`. `create_neighbor_universe(id, bossGenre)` stands for the TS
/// `createNeighborUniverse` (saveDefaults/neighbors.ts:36, called with `(100, 0)` and `(101, 0)`).
pub fn resolve_upgrade_owner_id(
    payload: &Value,
    sid: &str,
    create_neighbor_universe: &dyn Fn(i64, i64) -> Option<Value>,
) -> f64 {
    let preferred_owner_id = resolve_target_owner_id(payload, "ownerId");
    if preferred_owner_id != DEFAULT_USER_ID || sid.is_empty() {
        return preferred_owner_id;
    }

    if let Some(mut advisor_universe) = create_neighbor_universe(100, 0) {
        if find_item_entry(&mut advisor_universe, sid).is_some() {
            return 100.0;
        }
    }

    if let Some(mut sheik_universe) = create_neighbor_universe(101, 0) {
        if find_item_entry(&mut sheik_universe, sid).is_some() {
            return 101.0;
        }
    }

    preferred_owner_id
}

/// universe.ts:114 result: the company entry holding the item and the item's index in its `Company` children.
pub struct ItemMatch<'a> {
    pub company_entry: &'a mut Value,
    pub index: usize,
}

impl<'a> ItemMatch<'a> {
    /// `companyChildren` of the TS result (the live `Company` array of the company entry).
    pub fn company_children(&mut self) -> &mut Vec<Value> {
        get_element_children(&mut *self.company_entry, "Company")
    }

    /// `itemEntry` of the TS result (`companyChildren[index]`).
    pub fn item_entry(&mut self) -> &mut Value {
        let index = self.index;
        &mut self.company_children()[index]
    }
}

/// universe.ts:114 `findItemEntry`: the first item with `sid` across all company entries, in document order.
pub fn find_item_entry<'a>(universe: &'a mut Value, sid: &str) -> Option<ItemMatch<'a>> {
    let world = get_world_container(universe)?;
    let list = world.get_mut("World")?.as_array_mut()?;
    for company_entry in list.iter_mut() {
        if !has_children(company_entry, "Company") {
            continue;
        }
        let index = get_element_children(&mut *company_entry, "Company")
            .iter()
            .position(|entry| has_children(entry, "Item") && js_string_or_empty(entry.get("sid")) == sid);
        if let Some(index) = index {
            return Some(ItemMatch { company_entry, index });
        }
    }
    None
}

/// universe.ts:149 `getItemStateEntry`: the `State` child of an item (the `Item` array is created when missing, like TS).
pub fn get_item_state_entry(item_entry: &mut Value) -> Option<&mut Value> {
    let children = get_element_children(item_entry, "Item");
    let index = find_element_child(children, "State")?;
    Some(&mut children[index])
}

/// universe.ts:154 `isUpgradeEligibleItem` (GamePlay.upgradeAdd / SecurityNormal.upgradeAdd): state id "1" and not an HQ.
pub fn is_upgrade_eligible_item(universe: &mut Value, sid: &str) -> bool {
    let Some(mut item_match) = find_item_entry(universe, sid) else {
        return false;
    };
    let item = item_match.item_entry();
    let sku = js_string_or_empty(item.get("sku"));
    let state = get_item_state_entry(item);
    let state_id = js_string_or_empty(state.as_deref().and_then(|s| s.get("id")));
    sku != "HeadQuarter" && state_id == "1"
}

/// universe.ts:165 `createItemEntry`: a new `Item` element for a payload, inheriting `csid` from the company.
pub fn create_item_entry(payload: &Value, company_entry: &Value) -> Value {
    let sku = js_string_or_empty(payload.get("sku"));
    let whose = js_str_or(company_entry.get("whose"), "0");
    let mut item_children = Vec::new();

    if sku == "HeadQuarter" {
        item_children.push(create_element("State", &[("id", "4")], Vec::new()));
        let skin = if whose == "1" { "HeadQuarter_02" } else { "HeadQuarter_01" };
        item_children.push(create_head_quarter_decorations(skin));
    } else {
        let state = js_str_or(payload.get("state"), "5");
        item_children.push(create_element("State", &[("id", state.as_str())], Vec::new()));
    }

    let csid = match non_null(company_entry.get("sid")).or(non_null(payload.get("csid"))) {
        Some(v) => js_string(v),
        None => "1".to_string(),
    };
    let sid = js_string_or_empty(payload.get("sid"));
    let x = js_str_or(payload.get("x"), "0");
    let y = js_str_or(payload.get("y"), "0");
    let is_suspended = js_str_or(payload.get("isSuspended"), "0");

    create_element(
        "Item",
        &[
            ("sid", sid.as_str()),
            ("csid", csid.as_str()),
            ("sku", sku.as_str()),
            ("x", x.as_str()),
            ("y", y.as_str()),
            ("isSuspended", is_suspended.as_str()),
        ],
        item_children,
    )
}

/// universe.ts:191 `ensureStateElement`: sets `attributes` on the existing `State` child (Object.assign), or inserts
/// a new `State` element at the front.
pub fn ensure_state_element(children: &mut Vec<Value>, attributes: &[(&str, &str)]) {
    if let Some(index) = find_element_child(children, "State") {
        let obj = children[index].as_object_mut().expect("State element is an object");
        for (key, value) in attributes {
            obj.insert((*key).to_string(), Value::String((*value).to_string()));
        }
        return;
    }
    children.insert(0, create_element("State", attributes, Vec::new()));
}

/// universe.ts:201 `ensureHeadQuarterDecorations`: makes sure a `Decorations` child with a valid skin exists.
pub fn ensure_head_quarter_decorations(children: &mut Vec<Value>, whose: &str) {
    let default_sku = if whose == "1" { "HeadQuarter_02" } else { "HeadQuarter_01" };
    if let Some(index) = find_element_child(children, "Decorations") {
        let existing = &mut children[index];
        let decorations = get_element_children(existing, "Decorations");
        if let Some(decoration_index) = find_element_child(decorations, "Decoration") {
            let decoration = &mut decorations[decoration_index];
            let current_sku = js_string_or_empty(decoration.get("currentSku"));
            if !HQ_SKINS.contains(&current_sku.as_str()) {
                decoration["currentSku"] = Value::String(default_sku.to_string());
            }
            let current_sku = js_string_or_empty(decoration.get("currentSku"));
            let shadow_rows = if current_sku == "HeadQuarter_01" { "0" } else { "1" };
            decoration["shadowRows"] = Value::String(shadow_rows.to_string());
            ensure_head_quarter_skin_sku_children(decoration);
            return;
        }
    }

    children.push(create_head_quarter_decorations(default_sku));
}

/// universe.ts:220 `createHeadQuarterDecorations`: `{Decorations: [{Decoration: [sku...], type, currentSku, shadowRows}]}`.
pub fn create_head_quarter_decorations(current_sku: &str) -> Value {
    let shadow_rows = if current_sku == "HeadQuarter_01" { "0" } else { "1" };
    let skins: Vec<Value> = HQ_SKINS.iter().map(|sku| create_element("sku", &[("id", sku)], Vec::new())).collect();
    let decoration = create_element(
        "Decoration",
        &[("type", "0"), ("currentSku", current_sku), ("shadowRows", shadow_rows)],
        skins,
    );
    create_element("Decorations", &[], vec![decoration])
}

/// universe.ts:234 `setPlayerHeadQuarterSkin`: true when the player's HQ skin changed.
pub fn set_player_head_quarter_skin(universe: &mut Value, skin_sku: &str) -> bool {
    if !HQ_SKINS.contains(&skin_sku) {
        return false;
    }

    let Some(company) = get_company_entry_by_whose(universe, "0") else {
        return false;
    };
    let company_children = get_element_children(company, "Company");
    let Some(hq_index) = company_children
        .iter()
        .position(|entry| has_children(entry, "Item") && js_string_or_empty(entry.get("sku")) == "HeadQuarter")
    else {
        return false;
    };

    let hq = &mut company_children[hq_index];
    let item_children = get_element_children(hq, "Item");
    ensure_head_quarter_decorations(item_children, "0");
    let Some(decorations_index) = find_element_child(item_children, "Decorations") else {
        return false;
    };
    let decorations = &mut item_children[decorations_index];
    let decoration_children = get_element_children(decorations, "Decorations");
    let Some(decoration_index) = find_element_child(decoration_children, "Decoration") else {
        return false;
    };
    let decoration = &mut decoration_children[decoration_index];

    if js_string_or_empty(decoration.get("currentSku")) == skin_sku {
        ensure_head_quarter_skin_sku_children(decoration);
        return false;
    }

    decoration["currentSku"] = Value::String(skin_sku.to_string());
    let shadow_rows = if skin_sku == "HeadQuarter_01" { "0" } else { "1" };
    decoration["shadowRows"] = Value::String(shadow_rows.to_string());
    ensure_head_quarter_skin_sku_children(decoration);
    true
}

/// universe.ts:274 `isItemElement`
pub fn is_item_element(entry: &Value) -> bool {
    has_children(entry, "Item")
}

/// universe.ts:278 `isHouseSku`
pub fn is_house_sku(sku: &str) -> bool {
    sku.starts_with("houses_") || sku == "house_001"
}

/// universe.ts:282 `ensureHeadQuarterSkinSkuChildren` (private in the TS): adds one `sku` child per missing HQ skin.
fn ensure_head_quarter_skin_sku_children(decoration: &mut Value) {
    let children = get_element_children(decoration, "Decoration");
    let existing: HashSet<String> = children
        .iter()
        .filter(|entry| has_children(entry, "sku"))
        .map(|entry| js_string_or_empty(entry.get("id")))
        .collect();
    for sku in HQ_SKINS {
        if !existing.contains(sku) {
            children.push(create_element("sku", &[("id", sku)], Vec::new()));
        }
    }
}

/// Replay support for the differential fixture `tests/fixtures/libs-a.jsonl` (generated by `tests/fixtures/libs-a.ts`).
#[cfg(test)]
pub(crate) mod fixture {
    use crate::util::js_number_to_string;
    use serde_json::Value;

    const JSONL: &str = include_str!("../../tests/fixtures/libs-a.jsonl");

    /// One fixture line: `input` (the arguments by name), `output`, and `mutated` (the arguments after the call).
    pub struct Case {
        pub input: Value,
        pub output: Value,
        pub mutated: Value,
    }

    /// Every fixture case of function `func`, in file order.
    pub fn cases(func: &str) -> Vec<Case> {
        let found: Vec<Case> = JSONL
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str::<Value>(line).expect("fixture line is JSON"))
            .filter(|line| line["fn"] == func)
            .map(|line| Case {
                input: line["input"].clone(),
                output: line["output"].clone(),
                mutated: line["mutatedInput"].clone(),
            })
            .collect();
        assert!(!found.is_empty(), "no fixture cases for {func}");
        found
    }

    /// The fixture's canonical form: numbers become `"#<JS String(n)>"`.
    pub fn canon(value: &Value) -> Value {
        match value {
            Value::Number(n) => num(n.as_f64().unwrap_or(f64::NAN)),
            Value::Array(items) => Value::Array(items.iter().map(canon).collect()),
            Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), canon(v))).collect()),
            other => other.clone(),
        }
    }

    /// A JS number in canonical form.
    pub fn num(x: f64) -> Value {
        Value::String(format!("#{}", js_number_to_string(x)))
    }

    /// Asserts identical canonical JSON text, key order included.
    pub fn assert_same(actual: &Value, expected: &Value, what: &str) {
        assert_eq!(
            serde_json::to_string(&canon(actual)).unwrap(),
            serde_json::to_string(&canon(expected)).unwrap(),
            "{what}"
        );
    }

    /// Clones an optional mutable node into a JSON value (`undefined` -> null).
    pub fn opt_value(value: Option<&mut Value>) -> Value {
        value.map(|v| v.clone()).unwrap_or(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::{assert_same, cases, num, opt_value};
    use super::*;
    use serde_json::json;

    fn neighbour_lookup() -> impl Fn(i64, i64) -> Option<Value> {
        let docs: Vec<(i64, i64, Value)> = cases("createNeighborUniverse")
            .into_iter()
            .map(|c| (c.input["targetUserId"].as_i64().unwrap(), c.input["bossGenre"].as_i64().unwrap(), c.output))
            .collect();
        move |id, genre| docs.iter().find(|(i, g, _)| *i == id && *g == genre).map(|(_, _, doc)| doc.clone())
    }

    /// Every exported function of the five TS modules has at least five differential cases (constants: one each).
    #[test]
    fn every_exported_function_has_at_least_five_cases() {
        let functions = [
            "getUniverseProfile", "getPlotsEntry", "getWorldContainer", "getCompanyEntryByWhose", "getCompanyEntryBySid",
            "getMapEntry", "resolveTargetOwnerId", "resolveUpgradeOwnerId", "findItemEntry", "getItemStateEntry",
            "isUpgradeEligibleItem", "createItemEntry", "ensureStateElement", "ensureHeadQuarterDecorations",
            "createHeadQuarterDecorations", "setPlayerHeadQuarterSkin", "isItemElement", "isHouseSku", "hasStateMutation",
            "extractStateAttributes", "extractIncomingItemEntry", "extractIncomingElement", "parseCountChunkSet",
            "upsertCountChunkElement", "toRecord", "getPlotStates", "unlockNextPlots", "getStoredUpgradeRecords",
            "setStoredUpgradeRecords", "getLocalDayKey", "hasMoneySecuritySnapshot", "applyMoneySecuritySnapshot",
            "applyMoneySecuritySnapshotWithPositiveDeltaFallback", "applyPositiveMoneySecurityDeltas",
            "reconcilePremiumCurrencyPurchase", "hasNegativeSecurityDelta",
        ];
        for function in functions {
            assert!(cases(function).len() >= 5, "{function} has fewer than five cases");
        }
        for constant in ["DEFAULT_CITY_NAME", "VISITOR_UPGRADES_PER_DAY", "CASH_TO_COINS"] {
            assert_eq!(cases(constant).len(), 1, "{constant}");
        }
    }

    #[test]
    fn default_city_name_matches_ts() {
        for case in cases("DEFAULT_CITY_NAME") {
            assert_same(&json!(DEFAULT_CITY_NAME), &case.output, "DEFAULT_CITY_NAME");
        }
    }

    #[test]
    fn get_universe_profile_matches_ts() {
        for case in cases("getUniverseProfile") {
            let mut args = case.input.clone();
            let out = opt_value(get_universe_profile(args.get_mut("universe").unwrap()));
            assert_same(&out, &case.output, "getUniverseProfile output");
            assert_same(&args, &case.mutated, "getUniverseProfile mutatedInput");
        }
    }

    #[test]
    fn get_plots_entry_matches_ts() {
        for case in cases("getPlotsEntry") {
            let mut args = case.input.clone();
            let out = opt_value(get_plots_entry(args.get_mut("universe").unwrap()));
            assert_same(&out, &case.output, "getPlotsEntry output");
            assert_same(&args, &case.mutated, "getPlotsEntry mutatedInput");
        }
    }

    #[test]
    fn get_world_container_matches_ts() {
        for case in cases("getWorldContainer") {
            let mut args = case.input.clone();
            let out = opt_value(get_world_container(args.get_mut("universe").unwrap()));
            assert_same(&out, &case.output, "getWorldContainer output");
            assert_same(&args, &case.mutated, "getWorldContainer mutatedInput");
        }
    }

    #[test]
    fn get_company_entry_by_whose_matches_ts() {
        for case in cases("getCompanyEntryByWhose") {
            let mut args = case.input.clone();
            let whose = args["whose"].as_str().unwrap().to_string();
            let out = opt_value(get_company_entry_by_whose(args.get_mut("universe").unwrap(), &whose));
            assert_same(&out, &case.output, "getCompanyEntryByWhose output");
            assert_same(&args, &case.mutated, "getCompanyEntryByWhose mutatedInput");
        }
    }

    #[test]
    fn get_company_entry_by_sid_matches_ts() {
        for case in cases("getCompanyEntryBySid") {
            let mut args = case.input.clone();
            let sid = args["sid"].as_str().unwrap().to_string();
            let out = opt_value(get_company_entry_by_sid(args.get_mut("universe").unwrap(), &sid));
            assert_same(&out, &case.output, "getCompanyEntryBySid output");
            assert_same(&args, &case.mutated, "getCompanyEntryBySid mutatedInput");
        }
    }

    #[test]
    fn get_map_entry_matches_ts() {
        for case in cases("getMapEntry") {
            let mut args = case.input.clone();
            let out = opt_value(get_map_entry(args.get_mut("universe").unwrap()));
            assert_same(&out, &case.output, "getMapEntry output");
            assert_same(&args, &case.mutated, "getMapEntry mutatedInput");
        }
    }

    #[test]
    fn resolve_target_owner_id_matches_ts() {
        for case in cases("resolveTargetOwnerId") {
            let args = case.input.clone();
            let key = args["preferredKey"].as_str().unwrap();
            assert_same(&num(resolve_target_owner_id(&args["payload"], key)), &case.output, "resolveTargetOwnerId output");
            assert_same(&args, &case.mutated, "resolveTargetOwnerId mutatedInput");
        }
    }

    #[test]
    fn resolve_upgrade_owner_id_matches_ts() {
        let lookup = neighbour_lookup();
        for case in cases("resolveUpgradeOwnerId") {
            let args = case.input.clone();
            let sid = args["sid"].as_str().unwrap();
            assert_same(&num(resolve_upgrade_owner_id(&args["payload"], sid, &lookup)), &case.output, "resolveUpgradeOwnerId output");
            assert_same(&args, &case.mutated, "resolveUpgradeOwnerId mutatedInput");
        }
    }

    #[test]
    fn find_item_entry_matches_ts() {
        for case in cases("findItemEntry") {
            let mut args = case.input.clone();
            let sid = args["sid"].as_str().unwrap().to_string();
            let out = match find_item_entry(args.get_mut("universe").unwrap(), &sid) {
                None => Value::Null,
                Some(mut found) => {
                    let item = found.item_entry().clone();
                    json!({"index": found.index, "companyEntry": found.company_entry.clone(), "itemEntry": item})
                }
            };
            assert_same(&out, &case.output, "findItemEntry output");
            assert_same(&args, &case.mutated, "findItemEntry mutatedInput");
        }
    }

    #[test]
    fn get_item_state_entry_matches_ts() {
        for case in cases("getItemStateEntry") {
            let mut args = case.input.clone();
            let out = opt_value(get_item_state_entry(args.get_mut("item").unwrap()));
            assert_same(&out, &case.output, "getItemStateEntry output");
            assert_same(&args, &case.mutated, "getItemStateEntry mutatedInput");
        }
    }

    #[test]
    fn is_upgrade_eligible_item_matches_ts() {
        for case in cases("isUpgradeEligibleItem") {
            let mut args = case.input.clone();
            let sid = args["sid"].as_str().unwrap().to_string();
            let out = is_upgrade_eligible_item(args.get_mut("universe").unwrap(), &sid);
            assert_same(&json!(out), &case.output, "isUpgradeEligibleItem output");
            assert_same(&args, &case.mutated, "isUpgradeEligibleItem mutatedInput");
        }
    }

    #[test]
    fn create_item_entry_matches_ts() {
        for case in cases("createItemEntry") {
            let args = case.input.clone();
            let out = create_item_entry(&args["payload"], &args["companyEntry"]);
            assert_same(&out, &case.output, "createItemEntry output");
            assert_same(&args, &case.mutated, "createItemEntry mutatedInput");
        }
    }

    #[test]
    fn ensure_state_element_matches_ts() {
        for case in cases("ensureStateElement") {
            let mut args = case.input.clone();
            let attributes: Vec<(String, String)> = args["attributes"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string()))
                .collect();
            let refs: Vec<(&str, &str)> = attributes.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            ensure_state_element(args["children"].as_array_mut().unwrap(), &refs);
            assert_same(&Value::Null, &case.output, "ensureStateElement output");
            assert_same(&args, &case.mutated, "ensureStateElement mutatedInput");
        }
    }

    #[test]
    fn ensure_head_quarter_decorations_matches_ts() {
        for case in cases("ensureHeadQuarterDecorations") {
            let mut args = case.input.clone();
            let whose = args["whose"].as_str().unwrap().to_string();
            ensure_head_quarter_decorations(args["children"].as_array_mut().unwrap(), &whose);
            assert_same(&Value::Null, &case.output, "ensureHeadQuarterDecorations output");
            assert_same(&args, &case.mutated, "ensureHeadQuarterDecorations mutatedInput");
        }
    }

    #[test]
    fn create_head_quarter_decorations_matches_ts() {
        for case in cases("createHeadQuarterDecorations") {
            let args = case.input.clone();
            let out = create_head_quarter_decorations(args["currentSku"].as_str().unwrap());
            assert_same(&out, &case.output, "createHeadQuarterDecorations output");
            assert_same(&args, &case.mutated, "createHeadQuarterDecorations mutatedInput");
        }
    }

    #[test]
    fn set_player_head_quarter_skin_matches_ts() {
        for case in cases("setPlayerHeadQuarterSkin") {
            let mut args = case.input.clone();
            let skin = args["skinSku"].as_str().unwrap().to_string();
            let changed = set_player_head_quarter_skin(args.get_mut("universe").unwrap(), &skin);
            assert_same(&json!(changed), &case.output, "setPlayerHeadQuarterSkin output");
            assert_same(&args, &case.mutated, "setPlayerHeadQuarterSkin mutatedInput");
        }
    }

    #[test]
    fn is_item_element_matches_ts() {
        for case in cases("isItemElement") {
            let args = case.input.clone();
            assert_same(&json!(is_item_element(&args["entry"])), &case.output, "isItemElement output");
        }
    }

    #[test]
    fn is_house_sku_matches_ts() {
        for case in cases("isHouseSku") {
            let args = case.input.clone();
            assert_same(&json!(is_house_sku(args["sku"].as_str().unwrap())), &case.output, "isHouseSku output");
        }
    }
}
