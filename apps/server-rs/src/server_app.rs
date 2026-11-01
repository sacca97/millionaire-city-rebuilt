//! Port of `apps/server/src/serverApp.ts` (routing, start/stop). Express' middleware chain is reproduced in `dispatch`
//! in the same order; route matching is case-insensitive and ignores one trailing slash like Express' defaults.

use crate::assets;
use crate::client_static::ClientStatic;
use crate::commands::CommandService;
use crate::config::ServerConfig;
use crate::database::Database;
use crate::facebook_shim::{transparent_gif, FacebookShim};
use crate::game::{handle_game, GameContext};
use crate::http::{self, json, parse_body, send_file, text, with_header, Req, Resp};
const NPC_FRIENDS_JS: &str = include_str!("../templates/npc-friends.js");
use crate::launcher::{render_launcher_html, LauncherOptions, LAUNCHER_CONTENT_SECURITY_POLICY};
use crate::local_api::*;
use crate::repository::SaveRepository;
use crate::rules::{self, GoldPackageReward};
use crate::tls;
use crate::util::{decode_uri_component, hex, parse_query};
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::Router;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::net::{SocketAddr, TcpListener};
use std::sync::Arc;

const HEALTH_CHALLENGE_HEADER: &str = "x-mcity-health-challenge";
const HEALTH_PROOF_HEADER: &str = "x-mcity-health-proof";
const MCITY_MOUNT: &str = "/mcity/0.501";
const BODY_LIMIT: usize = 5 * 1024 * 1024;

pub struct AppState {
    pub config: ServerConfig,
    pub repo: Arc<SaveRepository>,
    pub commands: CommandService,
    pub gold_rewards: HashMap<String, GoldPackageReward>,
    pub cash_to_coins: f64,
    pub level_xp_thresholds: Vec<f64>,
    pub archived_item_swfs: HashSet<String>,
    pub client_static: Option<ClientStatic>,
    /// The TS server is single-threaded: every state-touching request runs to completion alone. Same here.
    pub lock: tokio::sync::Mutex<()>,
}

/// Express' default error page for body-parser failures / handler exceptions.
fn error_page(status: StatusCode, message: &str) -> Resp {
    text(status, "text/html", format!("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>{message}</pre>\n</body>\n</html>\n"))
}

async fn entry(State(state): State<Arc<AppState>>, request: Request) -> Resp {
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().to_string();
    let original_url = parts.uri.path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| path.clone());
    let query = parse_query(parts.uri.query().unwrap_or(""));
    let bytes = match axum::body::to_bytes(body, BODY_LIMIT).await {
        Ok(b) => b,
        Err(_) => return error_page(StatusCode::PAYLOAD_TOO_LARGE, "PayloadTooLargeError: request entity too large"),
    };
    let content_type = parts.headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(String::from);
    let body = match parse_body(content_type.as_deref(), &bytes) {
        Ok(b) => b,
        Err(_) => return error_page(StatusCode::BAD_REQUEST, "SyntaxError: Unexpected token in JSON"),
    };
    let req = Req { method: parts.method, path, original_url, query, headers: parts.headers, body };
    // Request logging middleware (serverApp.ts:122)
    if req.path != "/health" {
        println!("[http] {} {}", req.method, req.original_url);
    }
    dispatch(&state, &req).await
}

fn norm(path: &str) -> String {
    let lc = path.to_lowercase();
    if lc.len() > 1 { lc.trim_end_matches('/').to_string() } else { lc }
}

/// `/prefix/:param` -> the (still encoded) param when `lc_path` has exactly one more segment.
fn param_route<'a>(path: &'a str, lc_prefix: &str) -> Option<&'a str> {
    let lc = path.to_lowercase();
    let rest = lc.strip_prefix(lc_prefix)?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    if rest.is_empty() || rest.contains('/') {
        return None;
    }
    let start = lc_prefix.len();
    Some(path[start..start + rest.len()].trim_end_matches('/'))
}

async fn dispatch(state: &Arc<AppState>, req: &Req) -> Resp {
    let config = &state.config;
    let lc = norm(&req.path);
    let get = req.is_get_or_head();

    // --- /health
    if lc == "/health" && get {
        return health(state, req);
    }
    // --- /event/track (all methods)
    if lc == "/event/track" {
        return text(StatusCode::OK, "text/plain", "ok");
    }
    // --- /local/*
    match (lc.as_str(), &req.method) {
        ("/local/profile", m) if *m == Method::GET || *m == Method::HEAD => {
            let _g = state.lock.lock().await;
            return json(StatusCode::OK, &create_local_profile_response(&state.repo, config));
        }
        ("/local/profile", &Method::POST) => {
            let _g = state.lock.lock().await;
            return match update_local_profile(&state.repo, config, &req.body) {
                Ok(v) => json(StatusCode::OK, &v),
                Err(e) => json(StatusCode::BAD_REQUEST, &json!({ "ok": false, "error": e })),
            };
        }
        ("/local/resources", m) if *m == Method::GET || *m == Method::HEAD => {
            let _g = state.lock.lock().await;
            return match create_local_resources_response(&state.repo, &state.level_xp_thresholds) {
                Ok(v) => json(StatusCode::OK, &v),
                Err(e) => error_page(StatusCode::INTERNAL_SERVER_ERROR, &format!("Error: {e}")),
            };
        }
        ("/local/resources/adjust", &Method::POST) => {
            let _g = state.lock.lock().await;
            return match adjust_local_resources(&state.repo, &state.level_xp_thresholds, state.cash_to_coins, &req.body) {
                Ok(v) => json(StatusCode::OK, &v),
                Err(e) => json(StatusCode::BAD_REQUEST, &json!({ "ok": false, "error": e })),
            };
        }
        // Offline NPC friends for the original client (commands/npc_friends.rs, templates/npc-friends.js).
        ("/local/npc-friends.js", m) if *m == Method::GET || *m == Method::HEAD => {
            return with_header(text(StatusCode::OK, "application/javascript; charset=utf-8", NPC_FRIENDS_JS), "cache-control", "no-store");
        }
        ("/local/npc-invest", &Method::POST) => {
            let _g = state.lock.lock().await;
            return match crate::commands::npc_friends::npc_invest(&state.repo, crate::repository::DEFAULT_USER_ID, crate::util::now_ms()) {
                Ok(v) => json(StatusCode::OK, &v),
                Err(e) => json(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "ok": false, "error": e })),
            };
        }
        ("/local/profile-picture", m) if *m == Method::GET || *m == Method::HEAD => {
            let picture = {
                let _g = state.lock.lock().await;
                get_local_profile_picture(&state.repo, config)
            };
            return match picture {
                Some(p) => send_file(req, &p.file_path, "no-store", Some(&p.mime_type)).await,
                None => with_header(http::bytes("image/gif", transparent_gif()), "cache-control", "no-store"),
            };
        }
        _ => {}
    }
    // --- /launcher
    if lc == "/launcher" && get {
        return launcher(state, req).await;
    }
    if lc == "/client/dollars.private.swf" && get {
        return send_file(req, &config.private_client_swf_path, "public, max-age=0", None).await;
    }
    if lc == "/favicon.ico" && get {
        let icon = config.workspace_root.join("apps").join("desktop").join("assets").join("window-icon.ico");
        return send_file(req, &icon, "public, max-age=0", Some("image/x-icon")).await;
    }
    // --- /cbar static (fallthrough)
    if let Some(rel) = mount_rest(&req.path, "/cbar") {
        if let Some(r) = assets::serve_static(&config.archive_root.join("cbar"), &rel, &["htm", "html", "css", "png"], req).await {
            return r;
        }
    }
    if lc == "/crossdomain.xml" && get {
        return text(
            StatusCode::OK,
            "application/xml",
            "<!DOCTYPE cross-domain-policy SYSTEM \"http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd\">\n<cross-domain-policy>\n  <allow-access-from domain=\"*\" />\n</cross-domain-policy>",
        );
    }

    // --- /mcity/0.501 ...
    if get {
        if lc == "/mcity/0.501/datas/rules/tutorialhqpositions.xml" {
            return send_file(req, &config.tutorial_hq_positions_path, "public, max-age=0", None).await;
        }
        if let Some(raw) = param_route(&req.path, "/mcity/0.501/datas/rules/") {
            let file_name = base_name(raw);
            if let Some(xml) = assets::patched_rules_xml(config, &file_name, &state.archived_item_swfs) {
                return with_header(text(StatusCode::OK, "application/xml", xml), "cache-control", "public, max-age=3600");
            }
        }
        match lc.as_str() {
            "/mcity/0.501/datas/userdata/fan.xml" => {
                return text(StatusCode::OK, "application/xml", "<fan value=\"2\" bookmark=\"0\" />");
            }
            "/mcity/0.501/datas/userdata/giftslist.xml" => {
                return text(StatusCode::OK, "application/xml", "<giftsList />");
            }
            "/mcity/0.501/datas/userdata/checksendmail.xml" => {
                let _g = state.lock.lock().await;
                let _ = mark_vip_club_email_submitted(&state.repo);
                return text(StatusCode::OK, "application/xml", "<response><status>0</status></response>");
            }
            "/mcity/0.501/datas/userdata/checkmail.html" => {
                let _g = state.lock.lock().await;
                let v = is_vip_club_email_submitted(&state.repo).unwrap_or(false);
                return text(StatusCode::OK, "text/plain", if v { "1" } else { "0" });
            }
            "/registration/register" => {
                let _g = state.lock.lock().await;
                let _ = mark_vip_club_email_submitted(&state.repo);
                return text(StatusCode::OK, "application/xml", "<response><status>0</status></response>");
            }
            "/registration/isconfirmed" => {
                let _g = state.lock.lock().await;
                let v = is_vip_club_email_submitted(&state.repo).unwrap_or(false);
                return text(StatusCode::OK, "text/plain", if v { "1" } else { "0" });
            }
            "/mcity/0.501/datas/splash.swf" => {
                return send_file(req, &config.tutorial_splash_path, "public, max-age=0", None).await;
            }
            _ => {}
        }
    }

    if let Some(rel) = mount_rest(&req.path, MCITY_MOUNT) {
        // case-insensitive asset middleware
        if let Some(r) = assets::case_insensitive_asset(config, req, &rel).await {
            return r;
        }
        if get {
            if let Some(raw) = param_route(&req.path, "/mcity/0.501/datas/feed/") {
                if let Some(r) = assets::feed_fallback(config, req, raw).await {
                    return r;
                }
            }
            if let Some(raw) = param_route(&req.path, "/mcity/0.501/datas/assets/items/commercetypes/icons/") {
                if let Some(r) = assets::asset_fallback(
                    config, req, &["Assets", "items", "CommerceTypes", "icons"], raw, ".png", "commerce_bank.png", "commerce icon",
                ).await {
                    return r;
                }
            }
            if let Some(raw) = param_route(&req.path, "/mcity/0.501/datas/assets/missions/icons/") {
                if let Some(r) = assets::asset_fallback(
                    config, req, &["Assets", "missions", "icons"], raw, ".png", "build.png", "mission icon",
                ).await {
                    return r;
                }
            }
            if let Some(raw) = param_route(&req.path, "/mcity/0.501/datas/assets/items/commercetypes/") {
                if let Some(r) = assets::asset_fallback(
                    config, req, &["Assets", "items", "CommerceTypes"], raw, ".swf", "common.swf", "commerce type SWF",
                ).await {
                    return r;
                }
            }
        }
        if let Some(r) = assets::serve_static(&config.asset_root, &rel, assets::static_extensions(), req).await {
            return r;
        }
        return assets::missing_asset(req);
    }

    // --- built TypeScript client
    if let Some(cs) = &state.client_static {
        if let Some(r) = cs.handle(req).await {
            return r;
        }
    }

    // --- POST /Game
    if lc == "/game" && req.method == Method::POST {
        let _g = state.lock.lock().await;
        let ctx = GameContext {
            repo: &state.repo,
            commands: &state.commands,
            gold_rewards: &state.gold_rewards,
            cash_to_coins: state.cash_to_coins,
        };
        // Runs inline on the worker, like the TS server's handler: SQLite + JSON take ~0.1-0.4 ms (+ one fsync on a write).
        // Moving it to a dedicated thread, spawn_blocking or block_in_place measured slower (docs/rust-server-performance.md).
        return handle_game(&ctx, req);
    }

    http::not_found(req)
}

fn base_name(raw: &str) -> String {
    let decoded = decode_uri_component(raw).unwrap_or_else(|| raw.to_string());
    decoded.rsplit('/').next().unwrap_or("").to_string()
}

/// `app.use(prefix, ...)`: the request path below the mount (starts with `/`), if it matches (case-insensitive prefix).
fn mount_rest(path: &str, prefix: &str) -> Option<String> {
    if path.len() < prefix.len() || !path.is_char_boundary(prefix.len()) {
        return None;
    }
    if !path[..prefix.len()].eq_ignore_ascii_case(prefix) {
        return None;
    }
    let rest = &path[prefix.len()..];
    if rest.is_empty() {
        Some("/".to_string())
    } else if rest.starts_with('/') {
        Some(rest.to_string())
    } else {
        None
    }
}

/// serverApp.ts:131
fn health(state: &AppState, req: &Req) -> Resp {
    if let Some(secret) = &state.config.launch_secret {
        let challenge = req.header(HEALTH_CHALLENGE_HEADER).unwrap_or("");
        let valid = challenge.len() == 64 && challenge.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !valid {
            return json(StatusCode::BAD_REQUEST, &json!({ "ok": false }));
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac accepts any key length");
        mac.update(format!("mcity-health-v1:{challenge}").as_bytes());
        let proof = hex(&mac.finalize().into_bytes());
        return with_header(json(StatusCode::OK, &json!({ "ok": true })), HEALTH_PROOF_HEADER, &proof);
    }
    json(StatusCode::OK, &json!({ "ok": true }))
}

fn is_truthy(value: Option<&str>) -> bool {
    matches!(value.unwrap_or("").to_lowercase().as_str(), "1" | "true" | "yes")
}

/// serverApp.ts:194
async fn launcher(state: &AppState, req: &Req) -> Resp {
    let config = &state.config;
    let app_url = format!("https://127.0.0.1:{}", config.https_port);
    let env_on = |n: &str| std::env::var(n).as_deref() == Ok("1");
    let debug = is_truthy(req.query_first("debug")) || env_on("MCITY_SWF_DEBUG");
    let climate = is_truthy(req.query_first("climate")) || env_on("MCITY_USE_CLIMATE");
    let old_items = is_truthy(req.query_first("oldItems")) || env_on("MCITY_OLD_ITEM_DESIGNS");
    let profile = {
        let _g = state.lock.lock().await;
        create_local_profile_response(&state.repo, config)
    };
    let s = |k: &str| profile.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let html = render_launcher_html(&LauncherOptions {
        assets_base_url: format!("{app_url}/mcity/0.501/Datas/"),
        server_base_url: app_url.clone(),
        app_url,
        user_id: config.launcher_user_id.clone(),
        oauth_token: "local-oauth-token".into(),
        game_token: "bootstrap-token".into(),
        facebook_app_id: "315455798286".into(),
        lang: config.launcher_lang.clone(),
        debug_mode: debug,
        climate_mode: climate,
        old_item_designs: old_items,
        local_user_name: s("userName"),
        local_city_name: s("cityName"),
        local_profile_picture_url: s("profilePictureUrl"),
    });
    let mut r = text(StatusCode::OK, "text/html", html);
    let h = r.headers_mut();
    h.insert("content-security-policy", HeaderValue::from_static(LAUNCHER_CONTENT_SECURITY_POLICY));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    r
}

// ---- start / stop ------------------------------------------------------------------------------------------------------------

fn bind(port: u16) -> std::io::Result<TcpListener> {
    let l = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))?;
    l.set_nonblocking(true)?;
    Ok(l)
}

/// serverApp.ts:`ensurePrivateClientExists`
fn ensure_private_client_exists(config: &ServerConfig) -> Result<(), String> {
    if config.private_client_swf_path.exists() {
        return Ok(());
    }
    if let Some(parent) = config.private_client_swf_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&config.source_client_swf_path, &config.private_client_swf_path)
        .map(|_| ())
        .map_err(|e| format!("copy {}: {e}", config.source_client_swf_path.display()))
}

/// Node's `https` module speaks HTTP/1.1 only; so do we (no h2 ALPN) to keep client behaviour identical.
async fn http1_tls_config(pem: tls::Pem) -> Result<axum_server::tls_rustls::RustlsConfig, String> {
    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
    let certs = vec![CertificateDer::from(pem.cert_der)];
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(pem.key_der));
    let mut cfg = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| e.to_string())?;
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(axum_server::tls_rustls::RustlsConfig::from_config(Arc::new(cfg)))
}

/// A started server: the listeners are bound and serving. `stop` aborts them (the standalone binary just exits instead).
pub struct RunningServer {
    pub http_port: u16,
    /// 0 when embedded (no TLS listener).
    pub https_port: u16,
    tasks: Vec<tokio::task::JoinHandle<std::io::Result<()>>>,
}

impl RunningServer {
    pub fn stop(self) {
        for t in self.tasks {
            t.abort();
        }
    }
}

/// Standalone entry point: start, then serve until SIGTERM / SIGINT (Ctrl-C on Windows).
pub async fn run(config: ServerConfig) -> Result<(), String> {
    let server = start(config).await?;
    wait_for_shutdown().await;
    server.stop();
    Ok(())
}

/// Opens the database, binds the listeners (port 0 picks a free one) and spawns the serving tasks on the current tokio runtime.
pub async fn start(mut config: ServerConfig) -> Result<RunningServer, String> {
    let database = Arc::new(Database::open(&config.db_path)?);
    let repo = Arc::new(SaveRepository::new(database));
    let datas = config.asset_root.join("Datas").join("rules");
    let gold_rewards = rules::load_gold_package_rewards(&datas.join("fbcredits.xml"));
    let cash_to_coins = rules::load_cash_to_coins(&datas.join("settings.xml")) as f64;
    let level_xp_thresholds = rules::load_level_xp_thresholds(&datas.join("XPTable.xml"));
    let archived_item_swfs = assets::create_archived_item_swf_set(&config);
    if let Err(e) = repo.ensure_default_user() {
        eprintln!("[mcity] Could not prepare the default user: {e}");
    }
    if config.embedded {
        config.use_https_facebook_shim = false;
        config.require_https_facebook_shim = false;
    }

    let _ = rustls::crypto::ring::default_provider().install_default();
    // The two RSA-2048 key generations are independent and CPU-bound: run them on blocking threads while the rest of start-up proceeds.
    let fb_pem_task = config.use_https_facebook_shim.then(|| {
        tokio::task::spawn_blocking(|| tls::self_signed("graph.facebook.com", &["graph.facebook.com", "api.facebook.com"]))
    });
    let localhost_pem_task = (!config.embedded).then(|| tokio::task::spawn_blocking(|| tls::self_signed("localhost", &["localhost"])));
    if !config.embedded {
        ensure_private_client_exists(&config).map_err(|e| format!("Failed to start server: {e}"))?;
    }
    if config.require_https_facebook_shim && !config.use_https_facebook_shim {
        return Err("The required HTTPS Facebook shim is disabled.".into());
    }

    // Facebook stand-in
    let mut fb_server: Option<(TcpListener, axum_server::tls_rustls::RustlsConfig)> = None;
    if config.use_https_facebook_shim {
        let attempt = async {
            let pem = fb_pem_task.expect("started above").await.map_err(|e| e.to_string())??;
            let rustls_cfg = http1_tls_config(pem).await?;
            let listener = bind(config.facebook_https_port).map_err(|e| e.to_string())?;
            Ok::<_, String>((listener, rustls_cfg))
        };
        match attempt.await {
            Ok(v) => fb_server = Some(v),
            Err(e) => {
                if config.require_https_facebook_shim {
                    return Err(e);
                }
                eprintln!("[mcity] Failed to start HTTPS Facebook shim on port {}: {e}", config.facebook_https_port);
            }
        }
    }

    let http_listener = bind(config.http_port).map_err(|e| format!("HTTP listen on {}: {e}", config.http_port))?;
    config.http_port = http_listener.local_addr().map_err(|e| e.to_string())?.port();
    let https = match localhost_pem_task {
        Some(task) => {
            let listener = bind(config.https_port).map_err(|e| format!("HTTPS listen on {}: {e}", config.https_port))?;
            config.https_port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let pem = task.await.map_err(|e| e.to_string())??;
            Some((listener, http1_tls_config(pem).await?))
        }
        None => {
            config.https_port = 0;
            None
        }
    };

    let client_static = if config.client_dist_path.join("index.html").exists() {
        let root = std::path::absolute(&config.client_dist_path).unwrap_or_else(|_| config.client_dist_path.clone());
        Some(ClientStatic::new(root))
    } else {
        None
    };

    let state = Arc::new(AppState {
        commands: CommandService::new(repo.clone()),
        repo: repo.clone(),
        gold_rewards,
        cash_to_coins,
        level_xp_thresholds,
        archived_item_swfs,
        client_static,
        lock: tokio::sync::Mutex::new(()),
        config: config.clone(),
    });
    let app: Router = Router::new().fallback(entry).with_state(state);

    let mut tasks = Vec::new();
    tasks.push(tokio::spawn(axum_server::from_tcp(http_listener).serve(app.clone().into_make_service())));
    if let Some((listener, cfg)) = https {
        tasks.push(tokio::spawn(axum_server::from_tcp_rustls(listener, cfg).serve(app.into_make_service())));
    }

    let mut fb_url = None;
    if let Some((listener, cfg)) = fb_server {
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        fb_url = Some(format!("https://127.0.0.1:{port}"));
        let shim = Arc::new(FacebookShim {
            current_user_id: config.launcher_user_id.clone(),
            repo: repo.clone(),
            config: Arc::new(config.clone()),
        });
        let fb_app = Router::new().fallback(move |request: Request| {
            let shim = shim.clone();
            async move { fb_entry(shim, request).await }
        });
        tasks.push(tokio::spawn(axum_server::from_tcp_rustls(listener, cfg).serve(fb_app.into_make_service())));
    }

    println!("[mcity] HTTP server listening at http://127.0.0.1:{}", config.http_port);
    if config.https_port != 0 {
        println!("[mcity] HTTPS server listening at https://127.0.0.1:{}", config.https_port);
        println!("[mcity] Launcher available at https://127.0.0.1:{}/launcher", config.https_port);
    }
    if let Some(url) = fb_url {
        println!("[mcity] HTTPS Facebook shim listening at {url}");
    }
    Ok(RunningServer { http_port: config.http_port, https_port: config.https_port, tasks })
}

async fn fb_entry(shim: Arc<FacebookShim>, request: Request) -> Resp {
    let (parts, _body) = request.into_parts();
    let path = parts.uri.path().to_string();
    let original_url = parts.uri.path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| path.clone());
    let req = Req {
        query: parse_query(parts.uri.query().unwrap_or("")),
        method: parts.method,
        path,
        original_url,
        headers: parts.headers,
        body: Value::Null,
    };
    // The shim's own Express app does not disable x-powered-by (the main app does).
    http::with_header(shim.handle(&req).await, "x-powered-by", "Express")
}

#[cfg(unix)]
async fn wait_for_shutdown() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
    let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
    tokio::select! {
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
}

#[cfg(not(unix))]
async fn wait_for_shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}
