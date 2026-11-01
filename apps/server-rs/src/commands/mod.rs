//! `/Game` command dispatch (port of `CommandService.handleCommand`, commandHandlers.ts:161).
//!
//! Every `cmdList` command name maps to a handler through the per-package `COMMANDS` tables below. A package owns exactly
//! one module file; adding a command means adding a row to that module's `COMMANDS` table, so packages never edit the same
//! file. Commands without a row answer like the TS server answers an unknown command (`{success:"true",ignored:"1"}`)
//! and log `unported command <name>`.
#![allow(dead_code)] // stub modules are filled in by later packages

use crate::protocol::packet;
use crate::repository::SaveRepository;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// Shared libraries (packages "libs-a" / "libs-b": ports of commandHandlers/*.ts helper files)
pub mod collectibles_lib;
pub mod money;
pub mod npc_friends;
pub mod offline_lib;
pub mod plots;
pub mod state;
pub mod universe;
pub mod upgrades;

// Command packages
pub mod collectibles;
pub mod items_map;
pub mod offline;
pub mod profile_money;
pub mod reads;
pub mod world;

/// A command handler: `(service, userId, command object {_cmd,_dat,..})` -> response packets, or an error string that the
/// dispatcher turns into the TS `offlineError` response (commandHandlers.ts catch in serverApp.ts:`/Game`).
pub type Handler = fn(&CommandService, i64, &Value) -> Result<Vec<Value>, String>;

/// One row of a package table: `(cmd name, handler)`.
pub type CommandTable = &'static [(&'static str, Handler)];

pub struct CommandService {
    pub repository: Arc<SaveRepository>,
    /// UserData.mDoubleRentAvailable[0] (commandHandlers.ts:122; in-memory only).
    pub double_rent_houses_available: Mutex<HashMap<i64, bool>>,
}

impl CommandService {
    pub fn new(repository: Arc<SaveRepository>) -> Self {
        CommandService { repository, double_rent_houses_available: Mutex::new(HashMap::new()) }
    }

    pub fn sync(&self, user_id: i64) -> i64 {
        self.repository.session_sync(user_id)
    }

    fn lookup(name: &str) -> Option<Handler> {
        // Order is irrelevant: command names are unique across packages (checked by a unit test).
        for table in ALL_TABLES {
            if let Some((_, h)) = table.iter().find(|(n, _)| *n == name) {
                return Some(*h);
            }
        }
        None
    }

    /// commandHandlers.ts:161 `handleCommand`
    pub fn handle_command(&self, user_id: i64, command: &Value) -> Result<Vec<Value>, String> {
        let name = command.get("_cmd").and_then(Value::as_str).unwrap_or("");
        match Self::lookup(name) {
            Some(handler) => handler(self, user_id, command),
            None => {
                eprintln!("[game] unported command {name}");
                Ok(vec![packet(name, json!({"success": "true", "ignored": "1"}), Some(self.sync(user_id)))])
            }
        }
    }
}

pub const ALL_TABLES: &[CommandTable] = &[
    reads::COMMANDS,
    world::COMMANDS,
    profile_money::COMMANDS,
    items_map::COMMANDS,
    collectibles::COMMANDS,
    offline::COMMANDS,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_names_are_unique_across_packages() {
        let mut seen = std::collections::HashSet::new();
        for table in ALL_TABLES {
            for (name, _) in table.iter() {
                assert!(seen.insert(*name), "duplicate command {name}");
            }
        }
    }
}
