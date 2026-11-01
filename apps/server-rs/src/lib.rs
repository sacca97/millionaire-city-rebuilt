//! Millionaire City offline server as a library: `src/main.rs` is the standalone binary, the Tauri desktop app (apps/desktop)
//! embeds the same code through `server_app::start`.

pub mod assets;
pub mod client_static;
pub mod commands;
#[cfg(test)]
pub mod compat_tests;
pub mod config;
pub mod database;
pub mod encoding;
pub mod facebook_shim;
pub mod game;
pub mod http;
pub mod launcher;
pub mod local_api;
pub mod protocol;
pub mod repository;
pub mod rules;
pub mod save_defaults;
pub mod save_tree;
pub mod server_app;
pub mod tls;
pub mod util;
