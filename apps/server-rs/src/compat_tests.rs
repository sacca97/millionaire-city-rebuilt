//! A database file written by the former TS server must be readable (and writable) by the Rust server.
//! `tests/fixtures/ts-created.sqlite` was produced by the TS server's own repository code (`ensureDefaultUser` on a fresh file) in the
//! last commit that contained `apps/server`; it is static now.

use crate::database::Database;
use crate::repository::{tags, SaveRepository};
use serde_json::Value;
use std::sync::Arc;

const TS_TOKEN: &str = "e8a3e5f6299568e31a59e0ba7302cc4b";
const TS_SYNC: i64 = 1;
const TS_EXT_ID: &str = "100000000000001";

#[test]
fn reads_and_writes_a_database_created_by_the_ts_server() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("ts.sqlite");
    std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ts-created.sqlite"), &db_path).unwrap();

    // the exact JSON text the TS server stored for the universe document
    let raw = rusqlite::Connection::open(&db_path).unwrap();
    let ts_universe_text: String = raw
        .query_row("SELECT json FROM save_documents WHERE user_id = 1 AND tag = ?1", [tags::UNIVERSE], |r| r.get(0))
        .unwrap();
    drop(raw);

    let repo = SaveRepository::new(Arc::new(Database::open(&db_path).unwrap()));
    // ensureDefaultUser must accept the TS-seeded save untouched (no backup/reseed)
    let user = repo.ensure_default_user().unwrap();
    assert_eq!(user.ext_id, TS_EXT_ID);
    let session = repo.get_session(user.id).unwrap();
    assert_eq!(session.token, TS_TOKEN);
    assert_eq!(session.sync, TS_SYNC);
    assert!(!dir.path().join("backups").exists(), "a compatible TS save must not be reset");

    // document round trip: Rust parse + re-serialise reproduces the exact TS JSON text (key order preserved)
    let universe = repo.get_document(user.id, tags::UNIVERSE).unwrap();
    assert_eq!(serde_json::to_string(&universe).unwrap(), ts_universe_text);
    assert_eq!(repo.get_document(user.id, tags::FRIENDS).unwrap(), serde_json::json!({"friendsList": []}));

    // Rust writes: the stored text is plain JSON.stringify-style (compact, no escaping of non-ASCII)
    let doc = serde_json::json!({"friendsList": [{"friend": [], "extId": "42", "name": "Zoë \"Z\" <&>"}]});
    repo.set_document(user.id, tags::FRIENDS, &doc).unwrap();
    let raw = rusqlite::Connection::open(&db_path).unwrap();
    let stored: String = raw
        .query_row("SELECT json FROM save_documents WHERE user_id = 1 AND tag = ?1", [tags::FRIENDS], |r| r.get(0))
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), doc);
    assert_eq!(stored, r#"{"friendsList":[{"friend":[],"extId":"42","name":"Zoë \"Z\" <&>"}]}"#);
}
