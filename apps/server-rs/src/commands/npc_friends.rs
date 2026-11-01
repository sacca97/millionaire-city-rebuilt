//! Offline NPC friends (Rust-only; the TS server never got this). The only friends are the NPCs of `NPCDefinitions.xml`
//! (Ronald, Cindy, Sheik, see `facebook_shim::NPC_FRIEND_IDS`). Where the original Java depends on a real friend acting, the NPC does it
//! deterministically at once. Documented in docs/rust-server-friends.md.

use super::universe::{get_company_entry_by_whose, get_universe_profile, is_house_sku, is_upgrade_eligible_item, DEFAULT_USER_ID};
use super::upgrades::{get_stored_upgrade_records, set_stored_upgrade_records, UpgradeRecord, VISITOR_UPGRADES_PER_DAY};
use crate::facebook_shim::NPC_FRIEND_IDS;
use super::offline_lib::{find_investment, invest, refresh_investments};
use crate::repository::{tags, SaveRepository};
use crate::save_tree::{create_element, get_element_children};
use crate::util::{js_number, js_number_to_string, js_string_or_empty};
use serde_json::{json, Value};

/// Upgrades one visitor may leave in one city per day (`SocialRules.upgrade_maximunOf_items`, GamePlay.getUpgradesList
/// GamePlay.java:323-346; the TS constant `VISITOR_UPGRADES_PER_DAY`). `MCITY_UPGRADES_PER_DAY` overrides it (verification runs of the
/// 50/70-upgrade missions); unset = 5.
pub fn visitor_upgrades_per_day() -> usize {
    std::env::var("MCITY_UPGRADES_PER_DAY").ok().and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(VISITOR_UPGRADES_PER_DAY)
}

/// POST /local/npc-invest (the original's "Send Investment Request", answered by the offline friends). The original asks Facebook friends
/// with an app request; when one accepts, the web server runs GamePlay.investOnFriend(accountId, friendExtId, null) (GamePlay.java:1139-1166,
/// no coin check or charge for that overload) and the friend's own client later runs invest_get_inversion (:1203-1234, state 1 -> 2,
/// `investments_started` + 1). Offline each NPC friend accepts at once: one running investment (state 2) per NPC that has none. An NPC whose
/// previous investment was claimed (state 10 / 11) can be invested in again (the claimed row is replaced), otherwise three NPCs would cap the
/// 10-investment missions. Returns `{ok, created, extIds}`.
pub fn npc_invest(repo: &SaveRepository, user_id: i64, now_ms: i64) -> Result<Value, String> {
    let mut doc = repo.get_document(user_id, tags::INVESTMENTS)?;
    refresh_investments(&mut doc, now_ms);
    let inv = invest();
    let time = js_number_to_string(inv.time_ms);
    let mut created: Vec<String> = Vec::new();
    for (i, npc) in NPC_FRIEND_IDS.iter().enumerate() {
        match find_investment(&mut doc, npc).map(|e| js_number(e.get("state")).max(0.0)) {
            Some(state) if state < 10.0 => continue,
            Some(_) => get_element_children(&mut doc, "investmentsList")
                .retain(|e| !(e.get("investment").is_some() && js_string_or_empty(e.get("extId")) == *npc)),
            None => {}
        }
        let id = (now_ms + i as i64).to_string();
        get_element_children(&mut doc, "investmentsList").push(create_element(
            "investment",
            &[
                ("extId", npc),
                ("userId", "-1"),
                ("value", "0"),
                ("time", time.as_str()),
                ("remindTime", "0"),
                ("state", "2"),
                ("startedAt", id.as_str()),
                ("id", id.as_str()),
            ],
            Vec::new(),
        ));
        created.push(npc.to_string());
    }
    if !created.is_empty() {
        let started = js_number(doc.get("investmentsStarted")).max(0.0) + created.len() as f64;
        if let Some(o) = doc.as_object_mut() {
            o.insert("investmentsStarted".into(), Value::String(js_number_to_string(started)));
        }
    }
    repo.set_document(user_id, tags::INVESTMENTS, &doc)?;
    Ok(json!({ "ok": true, "created": created.len(), "extIds": created }))
}

const LEDGER_KEY: &str = "__npcFriendUpgradeLedger";

/// sids of the player's houses that can carry an upgrade (state id 1 = on rent, any mode; not the HQ), in document order.
fn own_upgradable_house_sids(player: &mut Value) -> Vec<String> {
    let Some(company) = get_company_entry_by_whose(player, "0") else { return Vec::new() };
    let sids: Vec<String> = get_element_children(company, "Company")
        .iter()
        .filter(|e| e.get("Item").is_some() && is_house_sku(&js_string_or_empty(e.get("sku"))))
        .map(|e| js_string_or_empty(e.get("sid")))
        .filter(|s| !s.is_empty())
        .collect();
    sids.into_iter().filter(|sid| is_upgrade_eligible_item(player, sid)).collect()
}

fn ledger(document: &Value) -> Vec<(String, String, String)> {
    document
        .get(LEDGER_KEY)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|e| (js_string_or_empty(e.get("sid")), js_string_or_empty(e.get("visitorExtId")), js_string_or_empty(e.get("dayKey"))))
                .collect()
        })
        .unwrap_or_default()
}

/// The NPC friends visit the player's city: GamePlay.upgradeAdd (a friend upgrades a house, GamePlay.java:2440-2490) rows that
/// `get_upgrades_list` of the own city then reports (GamePlay.java:326-346: `help2upgrades` rows, `applied = 0`). Each NPC upgrades up to
/// `cap` of the player's houses per day, in sid order, Ronald first. A house collected today (record removed by
/// `new_mode` + `upgradeType`) is not upgraded again the same day (ledger). Returns whether `document` changed.
pub fn grant_npc_upgrades(player: &mut Value, document: &mut Value, today: &str, cap: usize) -> bool {
    let tutorial_end = get_universe_profile(player).map(|p| js_string_or_empty(p.get("tutorialEnd"))).unwrap_or_default();
    if tutorial_end != "1" {
        return false;
    }
    let own = js_number_to_string(DEFAULT_USER_ID);
    let mut records = get_stored_upgrade_records(document);
    let mut given = ledger(document);
    let houses = own_upgradable_house_sids(player);
    let mut changed = false;
    for npc in NPC_FRIEND_IDS {
        let mut count = given.iter().filter(|(_, v, d)| v == npc && d == today).count();
        while count < cap {
            let next = houses.iter().find(|sid| {
                !records.iter().any(|r| r.owner_id == own && &r.sid == *sid && r.day_key == today)
                    && !given.iter().any(|(s, _, d)| s == *sid && d == today)
            });
            let Some(sid) = next else { break };
            records.push(UpgradeRecord {
                owner_id: own.clone(),
                sid: sid.clone(),
                visitor_ext_id: npc.to_string(),
                r#type: "0".to_string(),
                day_key: today.to_string(),
            });
            given.push((sid.clone(), npc.to_string(), today.to_string()));
            count += 1;
            changed = true;
        }
    }
    if changed {
        set_stored_upgrade_records(document, &records);
        let keep: Vec<Value> = given
            .iter()
            .filter(|(_, _, d)| d.as_str() >= today)
            .map(|(s, v, d)| json!({ "sid": s, "visitorExtId": v, "dayKey": d }))
            .collect();
        if let Some(o) = document.as_object_mut() {
            o.insert(LEDGER_KEY.to_string(), Value::Array(keep));
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn player(houses: &[(&str, &str, &str)], tutorial_end: &str) -> Value {
        let items: Vec<Value> = houses
            .iter()
            .map(|(sid, sku, state)| json!({ "Item": [{ "State": [], "id": state, "mode": "4" }], "sid": sid, "csid": "1", "sku": sku, "x": "0", "y": "0" }))
            .collect();
        json!({ "universe": [ { "Profile": [], "tutorialEnd": tutorial_end }, { "World": [ { "Company": items, "whose": "0", "sid": "1" } ] } ] })
    }

    #[test]
    fn each_npc_upgrades_houses_in_sid_order_up_to_the_cap() {
        let mut p = player(&[("1", "houses_001_001", "1"), ("2", "houses_001_001", "1"), ("3", "houses_001_001", "1"), ("4", "HeadQuarter", "1")], "1");
        let mut doc = json!({});
        assert!(grant_npc_upgrades(&mut p, &mut doc, "2026-11-01", 2));
        let recs = get_stored_upgrade_records(&doc);
        let got: Vec<(String, String)> = recs.iter().map(|r| (r.sid.clone(), r.visitor_ext_id.clone())).collect();
        assert_eq!(got, vec![("1".into(), NPC_FRIEND_IDS[0].into()), ("2".into(), NPC_FRIEND_IDS[0].into()), ("3".into(), NPC_FRIEND_IDS[1].into())]);
        assert!(recs.iter().all(|r| r.owner_id == "1" && r.day_key == "2026-11-01"));
        // idempotent
        assert!(!grant_npc_upgrades(&mut p, &mut doc, "2026-11-01", 2));
    }

    #[test]
    fn collected_house_is_not_upgraded_again_the_same_day_but_is_the_next_day() {
        let mut p = player(&[("1", "houses_001_001", "1")], "1");
        let mut doc = json!({});
        grant_npc_upgrades(&mut p, &mut doc, "2026-11-01", 5);
        set_stored_upgrade_records(&mut doc, &[]); // rent collected with upgradeType: records removed
        assert!(!grant_npc_upgrades(&mut p, &mut doc, "2026-11-01", 5));
        assert!(get_stored_upgrade_records(&doc).is_empty());
        assert!(grant_npc_upgrades(&mut p, &mut doc, "2026-11-02", 5));
        assert_eq!(get_stored_upgrade_records(&doc).len(), 1);
    }

    fn repo(dir: &std::path::Path) -> SaveRepository {
        let r = SaveRepository::new(std::sync::Arc::new(crate::database::Database::open(&dir.join("t.sqlite")).unwrap()));
        r.ensure_default_user().unwrap();
        r
    }

    fn rows(doc: &mut Value) -> Vec<(String, String)> {
        get_element_children(doc, "investmentsList")
            .iter()
            .filter(|e| e.get("investment").is_some())
            .map(|e| (js_string_or_empty(e.get("extId")), js_string_or_empty(e.get("state"))))
            .collect()
    }

    #[test]
    fn npc_invest_creates_one_running_investment_per_npc_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(dir.path());
        let out = npc_invest(&r, 1, 1_000_000).unwrap();
        assert_eq!(out["created"], 3);
        let mut doc = r.get_document(1, tags::INVESTMENTS).unwrap();
        assert_eq!(rows(&mut doc), NPC_FRIEND_IDS.iter().map(|i| (i.to_string(), "2".to_string())).collect::<Vec<_>>());
        assert_eq!(doc["investmentsStarted"], "3");
        assert_eq!(npc_invest(&r, 1, 1_000_001).unwrap()["created"], 0);
    }

    #[test]
    fn npc_invest_reinvests_in_an_npc_once_its_investment_was_claimed() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(dir.path());
        npc_invest(&r, 1, 1_000_000).unwrap();
        let mut doc = r.get_document(1, tags::INVESTMENTS).unwrap();
        for e in get_element_children(&mut doc, "investmentsList").iter_mut().filter(|e| e.get("investment").is_some()) {
            if e["extId"] == NPC_FRIEND_IDS[0] {
                e["state"] = Value::String("10".into());
            }
        }
        r.set_document(1, tags::INVESTMENTS, &doc).unwrap();
        let out = npc_invest(&r, 1, 2_000_000).unwrap();
        assert_eq!(out["extIds"], json!([NPC_FRIEND_IDS[0]]));
        let mut doc = r.get_document(1, tags::INVESTMENTS).unwrap();
        assert_eq!(rows(&mut doc).len(), 3);
        assert_eq!(doc["investmentsStarted"], "4");
    }

    #[test]
    fn nothing_before_the_tutorial_ends_or_for_houses_not_on_rent() {
        let mut p = player(&[("1", "houses_001_001", "1")], "0");
        assert!(!grant_npc_upgrades(&mut p, &mut json!({}), "d", 5));
        let mut p = player(&[("1", "houses_001_001", "5")], "1");
        assert!(!grant_npc_upgrades(&mut p, &mut json!({}), "d", 5));
    }
}
