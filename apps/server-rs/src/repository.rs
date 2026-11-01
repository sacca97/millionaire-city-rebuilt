//! Port of `apps/server/src/repository.ts` (`SaveRepository`). Documents are stored as JSON text exactly like the TS server.
#![allow(dead_code)] // full repository API; used by the command packages as they are ported

use crate::database::{Database, SessionRow, UserRow};
use crate::save_defaults::{self, STARTER_COMPANY_VALUE};
use crate::util::{iso_now, js_number, js_string_or_empty, random_hex};
use rusqlite::OptionalExtension;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

// packages/shared/src/constants.ts
pub const DEFAULT_USER_ID: i64 = 1;
pub const DEFAULT_USER_EXT_ID: &str = "100000000000001";
pub const DEFAULT_ADVISOR_IDS: &str = "100,101";
pub const DEFAULT_SYNC: i64 = 1;

pub mod tags {
    pub const UNIVERSE: &str = "universe";
    pub const CUSTOMIZER: &str = "crmpopups";
    pub const FRIENDS: &str = "friendList";
    pub const NEIGHBORS: &str = "neighborList";
    pub const HELP: &str = "helpList";
    pub const UPGRADES: &str = "upgradesList";
    pub const UNLOCKED: &str = "unlockedList";
    pub const LIMITED_EDITION: &str = "limEdList";
    pub const STORAGE: &str = "storageList";
    pub const COLLECTIBLES: &str = "collectiblesList";
    pub const COLLECTIBLE_PENDING: &str = "collectiblePendingList";
    pub const DAILY_BONUS: &str = "dailyBonusInfo";
    pub const PARTNERS: &str = "partnersList";
    pub const WELCOME: &str = "welcome";
    pub const INVESTMENTS: &str = "investmentsList";
    pub const GAME_CONFIG: &str = "gameConfig";
    pub const FAN: &str = "fan";
}

const SAVE_SCHEMA_VERSION: &str = "8";
const GAME_CONFIG_DEFAULTS_META_KEY: &str = "game_config_defaults_version";
const GAME_CONFIG_DEFAULTS_VERSION: &str = "1";
const CASH_TO_COINS: f64 = 60000.0;

pub type Res<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

/// Parsed save documents, `user_id -> tag -> document`. Write-through: `set_document` stores the same JSON text in SQLite as
/// before and keeps the value here; every read first compares SQLite's `PRAGMA data_version` (changes whenever another
/// connection/process commits to the file, e.g. the TS server or a manual edit) and drops the cache when it moved, so the
/// database file stays the single source of truth. Measured: docs/rust-server-performance.md.
#[derive(Default)]
struct DocCache {
    version: Option<i64>,
    docs: HashMap<i64, HashMap<String, Value>>,
}

pub struct SaveRepository {
    pub database: Arc<Database>,
    cache: Mutex<DocCache>,
    /// See repository.ts:20: the incomplete-tutorial repair only runs for the first check of this process.
    tutorial_startup_checked: AtomicBool,
}

impl SaveRepository {
    pub fn new(database: Arc<Database>) -> Self {
        SaveRepository { database, cache: Mutex::new(DocCache::default()), tutorial_startup_checked: AtomicBool::new(false) }
    }

    /// Runs a cached prepared statement that writes (`prepare_cached`: parsed once per connection).
    fn exec(&self, sql: &str, params: impl rusqlite::Params) -> Res<usize> {
        let conn = self.database.conn();
        let mut stmt = conn.prepare_cached(sql).map_err(e)?;
        stmt.execute(params).map_err(e)
    }

    /// Drops the cache when another connection committed since it was filled; call with the connection lock held.
    fn validate_cache(conn: &rusqlite::Connection, cache: &mut DocCache) {
        let version: Option<i64> = conn
            .prepare_cached("PRAGMA data_version")
            .and_then(|mut st| st.query_row([], |r| r.get(0)))
            .ok();
        if version.is_none() || cache.version != version {
            cache.docs.clear();
            cache.version = version;
        }
    }

    fn clear_cache(&self) {
        self.cache.lock().unwrap_or_else(|p| p.into_inner()).docs.clear();
    }

    /// `selectJson` + `JSON.parse` through the cache: `None` = no row, `Some(Err)` = the stored text is not valid JSON
    /// (never cached).
    fn load_doc(&self, user_id: i64, tag: &str) -> Res<Option<Result<Value, String>>> {
        let conn = self.database.conn();
        let mut cache = self.cache.lock().unwrap_or_else(|p| p.into_inner());
        Self::validate_cache(&conn, &mut cache);
        if let Some(doc) = cache.docs.get(&user_id).and_then(|m| m.get(tag)) {
            return Ok(Some(Ok(doc.clone())));
        }
        let json: Option<String> = conn
            .prepare_cached("SELECT json FROM save_documents WHERE user_id = ?1 AND tag = ?2")
            .map_err(e)?
            .query_row(rusqlite::params![user_id, tag], |r| r.get(0))
            .optional()
            .map_err(e)?;
        Ok(json.map(|json| {
            serde_json::from_str::<Value>(&json).map_err(e).map(|doc| {
                cache.docs.entry(user_id).or_default().insert(tag.to_string(), doc.clone());
                doc
            })
        }))
    }

    /// repository.ts:31 `restartTutorial`
    pub fn restart_tutorial(&self, user_id: i64) -> Res<()> {
        let user: Option<(i64, String)> = self
            .database
            .conn()
            .query_row("SELECT id, ext_id FROM users WHERE id = ?1", [user_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(e)?;
        let Some((id, ext_id)) = user else { return Ok(()) };
        let universe = self.get_document(user_id, tags::UNIVERSE)?;
        let (cash, paid) = extract_premium_currency_state(&universe);
        self.backup_and_seed_fresh_save(id, &ext_id, "restart-tutorial")?;
        if cash > 0.0 || paid > 0.0 {
            self.apply_premium_currency_carryover(user_id, cash, paid)?;
        }
        Ok(())
    }

    fn select_user(&self, id: i64) -> Res<Option<UserRow>> {
        let conn = self.database.conn();
        let mut stmt = conn.prepare_cached("SELECT id, ext_id, name, created_at FROM users WHERE id = ?1").map_err(e)?;
        stmt.query_row([id], |r| Ok(UserRow { id: r.get(0)?, ext_id: r.get(1)?, name: r.get(2)?, created_at: r.get(3)? }))
            .optional()
            .map_err(e)
    }

    /// repository.ts:45 `ensureDefaultUser`
    pub fn ensure_default_user(&self) -> Res<UserRow> {
        let now = iso_now();
        if let Some(existing) = self.select_user(DEFAULT_USER_ID)? {
            self.ensure_compatible_save(existing.id, &existing.ext_id)?;
            return Ok(existing);
        }
        self.database
            .conn()
            .execute(
                "INSERT INTO users (id, ext_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![DEFAULT_USER_ID, DEFAULT_USER_EXT_ID, "Mayor", now],
            )
            .map_err(e)?;
        let user = self.select_user(DEFAULT_USER_ID)?.ok_or("user row vanished")?;
        self.seed_fresh_save(user.id, &user.ext_id)?;
        self.tutorial_startup_checked.store(true, Ordering::SeqCst); // a brand-new save has nothing to repair
        self.set_session(user.id, &random_hex(16), DEFAULT_SYNC)?;
        Ok(user)
    }

    /// repository.ts:70 `updateDefaultUserName`
    pub fn update_default_user_name(&self, name: &str) -> Res<UserRow> {
        let mut user = self.ensure_default_user()?;
        self.database
            .conn()
            .execute("UPDATE users SET name = ?1 WHERE id = ?2", rusqlite::params![name, user.id])
            .map_err(e)?;
        user.name = name.to_string();
        Ok(user)
    }

    pub fn get_meta(&self, key: &str) -> Option<String> {
        let conn = self.database.conn();
        let mut stmt = conn.prepare_cached("SELECT value FROM meta WHERE key = ?1").ok()?;
        stmt.query_row([key], |r| r.get(0)).optional().unwrap_or(None)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Res<()> {
        self.exec(
            "INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, value, iso_now()],
        )
        .map(|_| ())
    }

    pub fn delete_meta(&self, key: &str) -> Res<()> {
        self.database.conn().execute("DELETE FROM meta WHERE key = ?1", [key]).map(|_| ()).map_err(e)
    }

    /// repository.ts:101 `seedFreshSave`
    pub fn seed_fresh_save(&self, user_id: i64, user_ext_id: &str) -> Res<()> {
        let bundle = save_defaults::create_fresh_save_bundle(user_ext_id)?;
        let now = iso_now();
        let mut conn = self.database.conn();
        // A savepoint instead of a transaction so that it also nests inside the request batch (database.rs `Batch`).
        let tx = conn.savepoint().map_err(e)?;
        self.clear_cache();
        for (tag, document) in &bundle {
            tx.prepare_cached("INSERT OR REPLACE INTO save_documents (user_id, tag, json, updated_at) VALUES (?1, ?2, ?3, ?4)")
                .map_err(e)?
                .execute(rusqlite::params![user_id, tag, serde_json::to_string(document).map_err(e)?, now])
                .map_err(e)?;
        }
        for (k, v) in [
            ("save_schema_version", SAVE_SCHEMA_VERSION),
            (GAME_CONFIG_DEFAULTS_META_KEY, GAME_CONFIG_DEFAULTS_VERSION),
        ] {
            tx.prepare_cached("INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?1, ?2, ?3)")
                .map_err(e)?
                .execute(rusqlite::params![k, v, now])
                .map_err(e)?;
        }
        tx.commit().map_err(e)
    }

    pub fn get_session(&self, user_id: i64) -> Option<SessionRow> {
        let conn = self.database.conn();
        let mut stmt = conn
            .prepare_cached("SELECT user_id, token, sync, created_at, updated_at FROM sessions WHERE user_id = ?1")
            .ok()?;
        stmt.query_row([user_id], |r| {
            Ok(SessionRow {
                user_id: r.get(0)?,
                token: r.get(1)?,
                sync: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .optional()
        .unwrap_or(None)
    }

    /// `session?.sync ?? DEFAULT_SYNC`
    pub fn session_sync(&self, user_id: i64) -> i64 {
        self.get_session(user_id).map(|s| s.sync).unwrap_or(DEFAULT_SYNC)
    }

    /// repository.ts:131 `setSession`
    pub fn set_session(&self, user_id: i64, token: &str, sync: i64) -> Res<()> {
        let now = iso_now();
        self.exec(
            "INSERT INTO sessions (user_id, token, sync, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(user_id) DO UPDATE SET
                   token = excluded.token,
                   sync = excluded.sync,
                   updated_at = excluded.updated_at",
            rusqlite::params![user_id, token, sync, now, now],
        )
        .map(|_| ())
    }

    /// repository.ts:147 `incrementSessionSync`
    pub fn increment_session_sync(&self, user_id: i64) -> Res<i64> {
        let session = self.get_session(user_id);
        let sync = session.as_ref().map(|s| s.sync).unwrap_or(DEFAULT_SYNC) + 1;
        let token = session.map(|s| s.token).unwrap_or_else(|| random_hex(16));
        self.set_session(user_id, &token, sync)?;
        Ok(sync)
    }

    /// repository.ts:154 `getDocument`: a missing document triggers a fresh seed (as in TS), then is read again.
    pub fn get_document(&self, user_id: i64, tag: &str) -> Res<Value> {
        if let Some(doc) = self.load_doc(user_id, tag)? {
            return doc;
        }
        let user = self.ensure_default_user()?;
        self.seed_fresh_save(user.id, &user.ext_id)?;
        match self.load_doc(user_id, tag)? {
            Some(doc) => doc,
            None => Err(format!("document {tag} is missing for user {user_id} even after seeding")),
        }
    }

    /// repository.ts:168 `getOptionalDocument`
    pub fn get_optional_document(&self, user_id: i64, tag: &str) -> Res<Option<Value>> {
        match self.load_doc(user_id, tag)? {
            Some(doc) => Ok(Some(doc?)),
            None => Ok(None),
        }
    }

    /// repository.ts:176 `setDocument`
    pub fn set_document(&self, user_id: i64, tag: &str, document: &Value) -> Res<()> {
        let json = serde_json::to_string(document).map_err(e)?;
        let conn = self.database.conn();
        let mut cache = self.cache.lock().unwrap_or_else(|p| p.into_inner());
        Self::validate_cache(&conn, &mut cache);
        let written = conn
            .prepare_cached("INSERT OR REPLACE INTO save_documents (user_id, tag, json, updated_at) VALUES (?1, ?2, ?3, ?4)")
            .map_err(e)?
            .execute(rusqlite::params![user_id, tag, json, iso_now()]);
        match written {
            Ok(_) => {
                cache.docs.entry(user_id).or_default().insert(tag.to_string(), document.clone());
                Ok(())
            }
            Err(err) => {
                if let Some(m) = cache.docs.get_mut(&user_id) {
                    m.remove(tag);
                }
                Err(e(err))
            }
        }
    }

    /// repository.ts:187 `ensureCompatibleSave`
    pub fn ensure_compatible_save(&self, user_id: i64, user_ext_id: &str) -> Res<()> {
        let schema_version = self.get_meta("save_schema_version");
        let defaults_version = self.get_meta(GAME_CONFIG_DEFAULTS_META_KEY);
        let universe = self.load_doc(user_id, tags::UNIVERSE)?;
        let game_config = self.load_doc(user_id, tags::GAME_CONFIG)?;

        let (Some(universe), Some(game_config)) = (universe, game_config) else {
            return self.backup_and_seed_fresh_save(user_id, user_ext_id, "missing-save-documents");
        };

        let (mut universe_doc, mut config_doc) = match (universe, game_config) {
            (Ok(u), Ok(c)) => (u, c),
            _ => return self.backup_and_seed_fresh_save(user_id, user_ext_id, "invalid-save-json"),
        };

        if is_legacy_broken_universe(&universe_doc) || is_legacy_broken_game_config(&config_doc) {
            eprintln!("[mcity] Resetting incompatible save schema to the current starter format.");
            return self.backup_and_seed_fresh_save(user_id, user_ext_id, "incompatible-save-schema");
        }

        if save_defaults::normalize_completed_tutorial_universe(&mut universe_doc) {
            self.set_document(user_id, tags::UNIVERSE, &universe_doc)?;
        }

        if defaults_version.as_deref() != Some(GAME_CONFIG_DEFAULTS_VERSION) && uses_legacy_muted_game_config(&config_doc) {
            config_doc["music"] = Value::String("1".into());
            config_doc["sound"] = Value::String("1".into());
            self.set_document(user_id, tags::GAME_CONFIG, &config_doc)?;
            self.set_meta(GAME_CONFIG_DEFAULTS_META_KEY, GAME_CONFIG_DEFAULTS_VERSION)?;
        }

        let run_tutorial_check = !self.tutorial_startup_checked.swap(true, Ordering::SeqCst);
        if run_tutorial_check && is_tutorial_incomplete(&universe_doc) {
            if should_reset_incomplete_tutorial_save(&universe_doc) {
                let (cash, paid) = extract_premium_currency_state(&universe_doc);
                self.backup_and_seed_fresh_save(user_id, user_ext_id, "incomplete-tutorial-reset")?;
                if cash > 0.0 || paid > 0.0 {
                    self.apply_premium_currency_carryover(user_id, cash, paid)?;
                }
                return Ok(());
            }
            if save_defaults::normalize_incomplete_tutorial_universe(&mut universe_doc) {
                self.set_document(user_id, tags::UNIVERSE, &universe_doc)?;
            }
        }

        if schema_version.as_deref() != Some(SAVE_SCHEMA_VERSION) {
            self.set_meta("save_schema_version", SAVE_SCHEMA_VERSION)?;
            println!(
                "[mcity] Migrated compatible save schema from {} to {}.",
                schema_version.as_deref().unwrap_or("unknown"),
                SAVE_SCHEMA_VERSION
            );
        }
        Ok(())
    }

    /// repository.ts:261 `getLoginResponse`
    pub fn get_login_response(&self, user_id: i64) -> Res<Value> {
        let session = self.get_session(user_id);
        let user = self.ensure_default_user()?;
        Ok(serde_json::json!({
            "userId": user_id,
            "userExtId": user.ext_id,
            "advisorId": DEFAULT_ADVISOR_IDS,
            "token": session.map(|s| s.token).unwrap_or_default(),
            "currentServerTime": crate::util::now_ms(),
        }))
    }

    /// repository.ts:274 `applyPremiumCurrencyCarryover`
    fn apply_premium_currency_carryover(&self, user_id: i64, cash: f64, paid_cash: f64) -> Res<()> {
        let mut universe = self.get_document(user_id, tags::UNIVERSE)?;
        let Some(profile) = get_profile_container_mut(&mut universe) else { return Ok(()) };
        let safe_cash = if cash.is_finite() { cash.max(0.0) } else { 0.0 };
        let safe_paid = if paid_cash.is_finite() { paid_cash.max(0.0) } else { 0.0 };
        profile["DCCash"] = Value::String(crate::util::js_number_to_string(safe_cash));
        profile["DCCashPaid"] = Value::String(crate::util::js_number_to_string(safe_paid));
        profile["companyValue"] = Value::String(crate::util::js_number_to_string(
            STARTER_COMPANY_VALUE as f64 + safe_cash * CASH_TO_COINS,
        ));
        self.set_document(user_id, tags::UNIVERSE, &universe)
    }

    /// repository.ts:289 `backupAndSeedFreshSave`
    fn backup_and_seed_fresh_save(&self, user_id: i64, user_ext_id: &str, reason: &str) -> Res<()> {
        let backup = self.database.create_backup(reason)?;
        eprintln!("[mcity] Backed up the existing save to {} before resetting it.", backup.display());
        self.seed_fresh_save(user_id, user_ext_id)
    }
}

fn find_entry<'a>(arr: &'a [Value], key: &str) -> Option<&'a Value> {
    arr.iter().find(|e| e.get(key).map(Value::is_array).unwrap_or(false))
}

pub fn get_profile_container(doc: &Value) -> Option<&Value> {
    find_entry(doc.get("universe")?.as_array()?, "Profile")
}

pub fn get_profile_container_mut(doc: &mut Value) -> Option<&mut Value> {
    doc.get_mut("universe")?
        .as_array_mut()?
        .iter_mut()
        .find(|e| e.get("Profile").map(Value::is_array).unwrap_or(false))
}

fn get_player_company_container(doc: &Value) -> Option<&Value> {
    let world = find_entry(doc.get("universe")?.as_array()?, "World")?;
    world
        .get("World")?
        .as_array()?
        .iter()
        .find(|e| e.get("Company").map(Value::is_array).unwrap_or(false) && js_string_or_empty(e.get("whose")) == "0")
}

/// repository.ts:296 `isLegacyBrokenUniverse`
fn is_legacy_broken_universe(document: &Value) -> bool {
    let Some(root) = document.get("universe").and_then(Value::as_array) else { return true };
    let profile_container = find_entry(root, "Profile");
    let world_container = find_entry(root, "World");
    let (Some(profile_container), Some(world_container)) = (profile_container, world_container) else {
        return true;
    };
    let profile_children: &[Value] = profile_container.get("Profile").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    let plot_type = find_entry(profile_children, "Plots")
        .and_then(|p| p.get("type"))
        .and_then(Value::as_str)
        .map(String::from);
    let plot_count = match &plot_type {
        Some(t) if !t.is_empty() => t.split(',').count(),
        _ => 0,
    };
    let world_children: &[Value] = world_container.get("World").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    let company_whose: BTreeSet<String> = world_children
        .iter()
        .filter(|e| e.get("Company").map(Value::is_array).unwrap_or(false))
        .map(|e| e.get("whose").map(|v| v.to_string()).unwrap_or_else(|| "undefined".into()))
        .collect();
    let map_container = find_entry(world_children, "Map");
    // An empty Map is a valid save (player deleted every tile), see the TS note.
    let uses_tutorial_starter_plots = plot_type.as_deref() == Some("");
    let uses_concrete_plot_state = plot_count == 25 || plot_count == 36;
    (!uses_tutorial_starter_plots && !uses_concrete_plot_state)
        || company_whose.len() < 2
        || !company_whose.contains("\"0\"")
        || !company_whose.contains("\"1\"")
        || map_container.is_none()
}

fn is_legacy_broken_game_config(doc: &Value) -> bool {
    !["music", "sound", "quality"].iter().all(|k| doc.get(*k).map(Value::is_string).unwrap_or(false))
}

fn uses_legacy_muted_game_config(doc: &Value) -> bool {
    doc.get("music").and_then(Value::as_str) == Some("0")
        && doc.get("sound").and_then(Value::as_str) == Some("0")
        && doc.get("quality").and_then(Value::as_str) == Some("1")
}

fn is_tutorial_incomplete(doc: &Value) -> bool {
    match get_profile_container(doc) {
        None => true,
        Some(p) => match p.get("tutorialEnd") {
            None | Some(Value::Null) => true, // String(undefined ?? "0") !== "1"
            Some(v) => crate::util::js_string(v) != "1",
        },
    }
}

fn should_reset_incomplete_tutorial_save(doc: &Value) -> bool {
    let Some(company) = get_player_company_container(doc) else { return true };
    company
        .get("Company")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().filter(|i| i.get("Item").map(Value::is_array).unwrap_or(false)).any(|item| {
                let sku = js_string_or_empty(item.get("sku"));
                sku == "HeadQuarter" || sku.starts_with("houses_") || sku.starts_with("commerce_")
            })
        })
        .unwrap_or(false)
}

fn extract_premium_currency_state(doc: &Value) -> (f64, f64) {
    let Some(profile) = get_profile_container(doc) else { return (0.0, 0.0) };
    let num = |k: &str| {
        let v = match profile.get(k) {
            None | Some(Value::Null) => 0.0,
            other => js_number(other),
        };
        if v.is_finite() { v } else { 0.0 }
    };
    (num("DCCash"), num("DCCashPaid"))
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use serde_json::json;

    fn repo(dir: &std::path::Path) -> SaveRepository {
        SaveRepository::new(Arc::new(Database::open(&dir.join("r.sqlite")).unwrap()))
    }

    /// The cache must never serve a document another connection/process changed (e.g. the TS server or a manual edit).
    #[test]
    fn external_writes_invalidate_the_cache() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(dir.path());
        r.ensure_default_user().unwrap();
        let before = r.get_document(DEFAULT_USER_ID, tags::GAME_CONFIG).unwrap();
        assert_eq!(r.get_document(DEFAULT_USER_ID, tags::GAME_CONFIG).unwrap(), before); // served from the cache
        let other = rusqlite::Connection::open(dir.path().join("r.sqlite")).unwrap();
        other
            .execute("UPDATE save_documents SET json = ?1 WHERE tag = ?2", rusqlite::params![r#"{"music":"7"}"#, tags::GAME_CONFIG])
            .unwrap();
        assert_eq!(r.get_document(DEFAULT_USER_ID, tags::GAME_CONFIG).unwrap(), json!({"music": "7"}));
    }

    /// Write-through: SQLite gets exactly `serde_json::to_string(doc)`, and the cached value equals what a re-parse returns.
    #[test]
    fn set_document_writes_through_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(dir.path());
        r.ensure_default_user().unwrap();
        let doc = json!({"a": [1, -2, 3.5, 1e21, 0.1, 18446744073709551615u64, null, true, "é\u{1}\"&"], "z": {"k": "v", "b": 1.0}});
        r.set_document(DEFAULT_USER_ID, tags::FAN, &doc).unwrap();
        let stored: String = r
            .database
            .conn()
            .query_row("SELECT json FROM save_documents WHERE user_id = ?1 AND tag = ?2", rusqlite::params![DEFAULT_USER_ID, tags::FAN], |x| x.get(0))
            .unwrap();
        assert_eq!(stored, serde_json::to_string(&doc).unwrap());
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), doc, "a cached value must equal its re-parse");
        assert_eq!(r.get_document(DEFAULT_USER_ID, tags::FAN).unwrap(), doc);
        // a second repository on the same file (cold cache) sees the same document
        let r2 = repo(dir.path());
        assert_eq!(r2.get_document(DEFAULT_USER_ID, tags::FAN).unwrap(), doc);
    }
}
