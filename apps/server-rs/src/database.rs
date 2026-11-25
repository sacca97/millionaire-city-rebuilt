//! Port of `apps/server/src/database.ts`: identical schema (a DB file works with both servers).
#![allow(dead_code)] // full repository API; used by the command packages as they are ported

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone)]
pub struct UserRow {
    pub id: i64,
    pub ext_id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionRow {
    pub user_id: i64,
    pub token: String,
    pub sync: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub struct Database {
    conn: Mutex<Connection>,
    pub db_path: PathBuf,
    /// A [`Batch`] transaction is open.
    in_batch: AtomicBool,
    /// Bumped whenever a request's writes were rolled back; caches of what was written must be dropped.
    pub rollbacks: AtomicU64,
}

/// One SQLite transaction around everything a request writes (`BEGIN IMMEDIATE` .. `COMMIT` on drop). Without it every
/// `set_document` / `set_session` is its own autocommit transaction and, with `synchronous=FULL` (the SQLite default the TS
/// server also runs with), its own fsync: a command that saves 3 documents + the session cost 4 fsyncs (13 ms on an NVMe).
/// The batch always COMMITs (never rolls back), so a failing command keeps the writes made before it, exactly as before; the
/// HTTP response is only sent after the commit, so durability at request granularity is unchanged.
pub struct Batch<'a> {
    db: &'a Database,
    /// False for a nested batch (or when BEGIN failed): only the outermost one commits.
    owner: bool,
}

impl Drop for Batch<'_> {
    fn drop(&mut self) {
        if self.owner {
            self.db.in_batch.store(false, Ordering::SeqCst);
            let conn = self.db.conn();
            // A failed COMMIT leaves the transaction open; every later BEGIN would then fail and nothing would ever commit
            // again. Retry briefly (SQLITE_BUSY from another process), then roll back so the next request starts clean, and
            // bump `rollbacks` so the document cache (which already holds the rolled-back values) is dropped.
            let mut last = None;
            for attempt in 0..5 {
                match conn.execute_batch("COMMIT") {
                    Ok(()) => return,
                    Err(e) => {
                        last = Some(e);
                        if conn.is_autocommit() {
                            break; // SQLite already ended the transaction itself
                        }
                        std::thread::sleep(std::time::Duration::from_millis(20 << attempt));
                    }
                }
            }
            eprintln!("[mcity] commit failed, request writes rolled back: {}", last.map(|e| e.to_string()).unwrap_or_default());
            if !conn.is_autocommit() {
                if let Err(e) = conn.execute_batch("ROLLBACK") {
                    eprintln!("[mcity] rollback failed: {e}");
                }
            }
            self.db.rollbacks.fetch_add(1, Ordering::SeqCst);
        }
    }
}

const SCHEMA: &str = "
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        ext_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        user_id INTEGER PRIMARY KEY,
        token TEXT NOT NULL,
        sync INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS save_documents (
        user_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, tag),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ";

fn absolutize(p: &Path) -> PathBuf {
    // path.resolve(): absolute + normalised (no symlink resolution).
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

impl Database {
    pub fn open(db_path: &Path) -> Result<Database, String> {
        let db_path = absolutize(db_path);
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let conn = Connection::open(&db_path).map_err(|e| format!("open {}: {e}", db_path.display()))?;
        // better-sqlite3 `pragma("journal_mode = WAL")`
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))
            .map_err(|e| e.to_string())?;
        // Optional, off by default (the TS server runs with SQLite's default FULL): `MCITY_SQLITE_SYNCHRONOUS=normal` skips the
        // per-commit fsync of the WAL (still corruption-free; an OS crash or power cut can lose the last few commits).
        if std::env::var("MCITY_SQLITE_SYNCHRONOUS").map(|v| v.eq_ignore_ascii_case("normal")).unwrap_or(false) {
            conn.execute_batch("PRAGMA synchronous = NORMAL").map_err(|e| e.to_string())?;
        }
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(Database { conn: Mutex::new(conn), db_path, in_batch: AtomicBool::new(false), rollbacks: AtomicU64::new(0) })
    }

    /// Starts the request transaction (a no-op guard when one is already open); see [`Batch`].
    pub fn begin_batch(&self) -> Batch<'_> {
        if self.in_batch.load(Ordering::SeqCst) {
            return Batch { db: self, owner: false };
        }
        match self.conn().execute_batch("BEGIN IMMEDIATE") {
            Ok(()) => {
                self.in_batch.store(true, Ordering::SeqCst);
                Batch { db: self, owner: true }
            }
            Err(e) => {
                // No transaction: every statement autocommits as before.
                eprintln!("[mcity] begin failed: {e}");
                Batch { db: self, owner: false }
            }
        }
    }

    pub fn in_batch(&self) -> bool {
        self.in_batch.load(Ordering::SeqCst)
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// `createBackup(reason)` (database.ts:62): `VACUUM INTO backups/<base>-<timestamp>-<reason>[-n].sqlite`.
    pub fn create_backup(&self, reason: &str) -> Result<PathBuf, String> {
        let dir = self.db_path.parent().unwrap_or(Path::new(".")).join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let base = self
            .db_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let timestamp: String = crate::util::iso_now().chars().filter(|c| c.is_ascii_digit()).collect();
        let mut safe = String::new();
        let mut last_dash = false;
        for ch in reason.chars() {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                safe.push(ch);
                last_dash = false;
            } else if !last_dash {
                safe.push('-');
                last_dash = true;
            }
        }
        let safe = safe.trim_matches('-').to_string();
        let safe = if safe.is_empty() { "backup".to_string() } else { safe };
        let stem = format!("{base}-{timestamp}-{safe}");
        let mut path = dir.join(format!("{stem}.sqlite"));
        let mut suffix = 1;
        while path.exists() {
            path = dir.join(format!("{stem}-{suffix}.sqlite"));
            suffix += 1;
        }
        // VACUUM cannot run inside a transaction: commit the request's writes so far, back up, reopen the transaction.
        let in_batch = self.in_batch();
        if in_batch {
            self.conn().execute_batch("COMMIT").map_err(|e| e.to_string())?;
        }
        let result = self.conn().execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()]).map_err(|e| e.to_string());
        if in_batch {
            self.conn().execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        }
        result?;
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count_users(path: &Path) -> i64 {
        Connection::open(path).unwrap().query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn failed_commit_rolls_back_so_later_requests_commit() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("f.sqlite")).unwrap();
        db.conn().execute_batch("PRAGMA foreign_keys = ON").unwrap();
        {
            let _b = db.begin_batch();
            // A deferred foreign-key violation makes COMMIT itself fail and leaves the transaction open.
            db.conn().execute_batch("PRAGMA defer_foreign_keys = ON").unwrap();
            db.conn()
                .execute("INSERT INTO sessions (user_id, token, sync, created_at, updated_at) VALUES (9, 't', 1, 'a', 'a')", [])
                .unwrap();
        }
        assert!(db.conn().is_autocommit(), "the failed transaction must not stay open");
        assert_eq!(db.rollbacks.load(Ordering::SeqCst), 1);
        {
            let _b = db.begin_batch();
            assert!(db.in_batch(), "the next request gets its own transaction");
            db.conn().execute("INSERT INTO users (id, ext_id, name, created_at) VALUES (1, 'a', 'n', 't')", []).unwrap();
        }
        assert_eq!(count_users(&db.db_path), 1);
    }

    #[test]
    fn batch_commits_once_when_dropped_and_nests() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("b.sqlite")).unwrap();
        {
            let _outer = db.begin_batch();
            let _inner = db.begin_batch(); // joins the open transaction
            db.conn().execute("INSERT INTO users (id, ext_id, name, created_at) VALUES (1, 'a', 'n', 't')", []).unwrap();
            assert_eq!(count_users(&db.db_path), 0, "not visible to other connections before the commit");
            drop(_inner);
            assert!(db.in_batch(), "the inner guard must not commit");
            assert_eq!(count_users(&db.db_path), 0);
        }
        assert!(!db.in_batch());
        assert_eq!(count_users(&db.db_path), 1);
    }

    #[test]
    fn backup_inside_a_batch_includes_earlier_writes_and_keeps_the_batch_open() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("b.sqlite")).unwrap();
        let _batch = db.begin_batch();
        db.conn().execute("INSERT INTO users (id, ext_id, name, created_at) VALUES (1, 'a', 'n', 't')", []).unwrap();
        let backup = db.create_backup("test").unwrap();
        assert_eq!(count_users(&backup), 1);
        db.conn().execute("INSERT INTO users (id, ext_id, name, created_at) VALUES (2, 'b', 'n', 't')", []).unwrap();
        drop(_batch);
        assert_eq!(count_users(&db.db_path), 2);
    }
}
