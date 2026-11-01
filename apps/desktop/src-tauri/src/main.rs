// Millionaire City desktop app: a Tauri window (system web view) around our web client, with the Rust game server (mcity-server
// crate) embedded in this process. The server listens on 127.0.0.1 on a free port; the window loads the client from it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mcity_server::{config, server_app};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// The Electron build named its user-data folder after the package (`millionaire-city-app`) and kept the save in
/// `<config dir>/millionaire-city-app/data/mcity.sqlite`; the same path is used here so existing saves keep working.
/// config dir = ~/.config (Linux), ~/Library/Application Support (macOS), %APPDATA% (Windows).
const LEGACY_DIR_NAME: &str = "millionaire-city-app";

fn user_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("MCITY_USER_DATA_DIR").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    Ok(app.path().config_dir().map_err(|e| e.to_string())?.join(LEGACY_DIR_NAME))
}

/// Folder with `assets/` and `apps/client/dist/` (the layout the server expects as its workspace root).
fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut tried = Vec::new();
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("MCITY_WORKSPACE_ROOT").filter(|v| !v.is_empty()) {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("workspace"));
    }
    // development: running from the repository
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.."));
    for c in candidates {
        if c.join("assets").is_dir() {
            return Ok(c.canonicalize().unwrap_or(c));
        }
        tried.push(c.display().to_string());
    }
    Err(format!("game files not found (looked in: {})", tried.join(", ")))
}

fn log_line(dir: &Path, line: &str) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("desktop.log")) {
        let _ = writeln!(f, "{line}");
    }
}

/// Starts the embedded server on its own tokio runtime (own thread, so request handling never blocks the UI thread) and
/// returns its HTTP port plus a sender whose drop (or `send`) stops it.
fn start_server(app: &tauri::AppHandle, data_dir: &Path) -> Result<(u16, tokio::sync::oneshot::Sender<()>), String> {
    let root = workspace_root(app)?;
    config::set_workspace_root(root);
    let mut cfg = config::get_server_config();
    cfg.embedded = true;
    cfg.http_port = 0;
    cfg.launch_secret = None;
    if std::env::var_os("MCITY_DB_PATH").is_none() {
        cfg.db_path = data_dir.join("data").join("mcity.sqlite");
    }
    if let Some(parent) = cfg.db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u16, String>>();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    std::thread::Builder::new()
        .name("mcity-server".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build() {
                Ok(rt) => rt,
                Err(e) => return drop(ready_tx.send(Err(e.to_string()))),
            };
            rt.block_on(async move {
                match server_app::start(cfg).await {
                    Ok(server) => {
                        let _ = ready_tx.send(Ok(server.http_port));
                        let _ = stop_rx.await;
                        server.stop();
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;
    let port = ready_rx.recv().map_err(|_| "the server thread ended before it was ready".to_string())??;
    Ok((port, stop_tx))
}

struct ServerStop(std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>);

fn main() {
    // A single-player app: SQLite synchronous=NORMAL (docs/rust-server-performance.md). Set before any other thread exists.
    if std::env::var_os("MCITY_SQLITE_SYNCHRONOUS").is_none() {
        std::env::set_var("MCITY_SQLITE_SYNCHRONOUS", "normal");
    }
    let app = tauri::Builder::default()
        // one instance only: two apps would share one save database
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = user_data_dir(&handle)?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Millionaire City")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "about" | "blob" | "data") || url.host_str() == Some("127.0.0.1") || url.host_str() == Some("tauri.localhost"))
                .build()?;
            // no menu bar on Windows/Linux (the macOS default menu stays: it carries Cmd+Q and the copy/paste shortcuts)
            #[cfg(not(target_os = "macos"))]
            let _ = window.remove_menu();
            // the server starts while the splash page shows
            std::thread::spawn(move || match start_server(&handle, &data_dir) {
                Ok((port, stop)) => {
                    *handle.state::<ServerStop>().0.lock().unwrap() = Some(stop);
                    log_line(&data_dir, &format!("server on 127.0.0.1:{port}, save {}", data_dir.join("data").join("mcity.sqlite").display()));
                    let url: Url = format!("http://127.0.0.1:{port}/").parse().expect("valid url");
                    let _ = window.navigate(url);
                }
                Err(e) => {
                    log_line(&data_dir, &format!("start failed: {e}"));
                    let _ = window.eval(format!("showError({})", serde_json_string(&e)));
                }
            });
            Ok(())
        })
        .manage(ServerStop(std::sync::Mutex::new(None)))
        .build(tauri::generate_context!())
        .expect("failed to build the Millionaire City app");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(stop) = handle.state::<ServerStop>().0.lock().unwrap().take() {
                let _ = stop.send(());
            }
        }
    });
}

/// A JS string literal (quotes and control characters escaped) for `window.eval`.
fn serde_json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
