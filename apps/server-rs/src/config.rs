//! Port of `apps/server/src/config.ts` (same env vars and defaults).

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub workspace_root: PathBuf,
    pub archive_root: PathBuf,
    pub asset_root: PathBuf,
    pub source_client_swf_path: PathBuf,
    pub private_client_swf_path: PathBuf,
    pub tutorial_hq_positions_path: PathBuf,
    pub tutorial_splash_path: PathBuf,
    pub http_port: u16,
    pub https_port: u16,
    pub facebook_https_port: u16,
    pub db_path: PathBuf,
    pub launcher_user_id: String,
    pub launcher_lang: String,
    pub use_https_facebook_shim: bool,
    pub require_https_facebook_shim: bool,
    pub launch_secret: Option<String>,
    /// Built TypeScript client (apps/client/dist); served at / when present.
    pub client_dist_path: PathBuf,
    /// Embedded in the desktop app: no HTTPS listener, no Facebook shim and no private Flash client copy (the web client needs none of them).
    pub embedded: bool,
}

static WORKSPACE_ROOT_OVERRIDE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// For an embedding host (the desktop app): fixes the workspace root for this process (first call wins), instead of the env var.
pub fn set_workspace_root(root: PathBuf) {
    let _ = WORKSPACE_ROOT_OVERRIDE.set(root);
}

/// The TS server derives the workspace root from its own source location. Here: `MCITY_WORKSPACE_ROOT`, else the
/// repository root two levels above this crate when it contains `assets/`, else the current directory.
pub fn workspace_root() -> PathBuf {
    if let Some(root) = WORKSPACE_ROOT_OVERRIDE.get() {
        return root.clone();
    }
    if let Ok(v) = std::env::var("MCITY_WORKSPACE_ROOT") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    let from_manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    if from_manifest.join("assets").is_dir() {
        return from_manifest.canonicalize().unwrap_or(from_manifest);
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn env_port(name: &str, default: &str) -> u16 {
    // JS: Number(process.env.X ?? default); a bad value gives NaN which fails at listen.
    let raw = std::env::var(name).unwrap_or_else(|_| default.to_string());
    raw.trim().parse::<u16>().unwrap_or_else(|_| {
        eprintln!("[mcity] Invalid value for {name}: {raw:?}");
        std::process::exit(1);
    })
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

pub fn get_server_config() -> ServerConfig {
    let workspace_root = workspace_root();
    let archive_root = workspace_root.join("assets");
    let asset_root = archive_root.join("dchoc1-a.akamaihd.net").join("0.501").join("mcity");
    let data_root = asset_root.join("Datas");
    let db_path = std::env::var("MCITY_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root.join("generated").join("data").join("mcity.sqlite"));
    ServerConfig {
        source_client_swf_path: data_root.join("Dollars.swf"),
        private_client_swf_path: workspace_root.join("generated").join("client").join("Dollars.private.swf"),
        tutorial_hq_positions_path: workspace_root.join("assets").join("recreations").join("TutorialHQPositions.xml"),
        tutorial_splash_path: workspace_root.join("apps").join("server-rs").join("assets").join("splash.swf"),
        http_port: env_port("MCITY_HTTP_PORT", "31803"),
        https_port: env_port("MCITY_HTTPS_PORT", "31804"),
        facebook_https_port: env_port("MCITY_FACEBOOK_PORT", "443"),
        db_path,
        launcher_user_id: std::env::var("MCITY_UID").unwrap_or_else(|_| "100000000000001".into()),
        launcher_lang: std::env::var("MCITY_LANG").unwrap_or_else(|_| "en_US".into()),
        use_https_facebook_shim: std::env::var("MCITY_DISABLE_FB_SHIM").as_deref() != Ok("1"),
        require_https_facebook_shim: std::env::var("MCITY_REQUIRE_FB_SHIM").as_deref() == Ok("1"),
        launch_secret: env_nonempty("MCITY_LAUNCH_SECRET"),
        client_dist_path: std::env::var("MCITY_CLIENT_DIST")
            .map(PathBuf::from)
            .unwrap_or_else(|_| workspace_root.join("apps").join("client").join("dist")),
        embedded: false,
        archive_root,
        asset_root,
        workspace_root,
    }
}
