//! Port of `apps/server/src/clientStatic.ts`: static serving of the built TS client (`apps/client/dist`).

use crate::http::{mime_for, send_file, Req, Resp};
use crate::util::decode_uri_component;
use axum::body::Body;
use axum::http::{header, Response, StatusCode};
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

const TEXT_TYPES: [&str; 8] = [".js", ".mjs", ".css", ".json", ".html", ".svg", ".txt", ".xml"];
const ONE_DAY: u64 = 86400;

pub struct ClientStatic {
    root: PathBuf,
    gz_cache: Mutex<HashMap<PathBuf, (i64, Arc<Vec<u8>>)>>,
}

/// clientStatic.ts:88 `cacheControl`
fn cache_control(rel: &str) -> String {
    if rel.starts_with("/assets/") {
        "public, max-age=31536000, immutable".into()
    } else if rel == "/index.html" || rel == "/" {
        "no-cache".into()
    } else {
        format!("public, max-age={ONE_DAY}")
    }
}

fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn accepts(accept: &str, token: &str) -> bool {
    accept.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|t| t == token)
}

impl ClientStatic {
    pub fn new(root: PathBuf) -> Self {
        ClientStatic { root, gz_cache: Mutex::new(HashMap::new()) }
    }

    /// webpFallback + compressed + express.static, in that order. `None` falls through.
    pub async fn handle(&self, req: &Req) -> Option<Resp> {
        if !req.is_get_or_head() {
            return None;
        }
        // 1. webpFallback: X.png under gui/ground/sprites answers from X.webp when only the optimised file exists
        let mut path = req.path.clone();
        let lower = path.to_lowercase();
        if lower.ends_with(".png")
            && ["/gui/", "/ground/", "/sprites/"].iter().any(|p| path.starts_with(p))
        {
            if let Some(rel) = decode_uri_component(&path) {
                let abs = self.root.join(rel.trim_start_matches('/'));
                let webp = PathBuf::from(format!("{}.webp", &abs.to_string_lossy()[..abs.to_string_lossy().len() - 4]));
                if abs.starts_with(&self.root) && !abs.exists() && webp.exists() {
                    path = format!("{}.webp", &path[..path.len() - 4]);
                }
            }
        }
        // 2. precompressed / on-the-fly gzip for text types
        if let Some(r) = self.compressed(req, &path) {
            return Some(r);
        }
        // 3. express.static
        self.files(req, &path).await
    }

    fn compressed(&self, req: &Req, path: &str) -> Option<Resp> {
        let rel = decode_uri_component(if path == "/" { "/index.html" } else { path })?;
        let ext = Path::new(&rel).extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
        if !TEXT_TYPES.contains(&ext.as_str()) {
            return None;
        }
        let abs = self.root.join(rel.trim_start_matches('/'));
        if !abs.starts_with(&self.root) {
            return None;
        }
        let accept = req.header("accept-encoding").unwrap_or("");
        let br = PathBuf::from(format!("{}.br", abs.display()));
        let gz = PathBuf::from(format!("{}.gz", abs.display()));
        let (enc, body): (&str, Arc<Vec<u8>>) = if accepts(accept, "br") && br.exists() {
            ("br", Arc::new(std::fs::read(&br).ok()?))
        } else if accepts(accept, "gzip") && gz.exists() {
            ("gzip", Arc::new(std::fs::read(&gz).ok()?))
        } else if accepts(accept, "gzip") && abs.is_file() {
            let mt = mtime_ms(&abs);
            let mut cache = self.gz_cache.lock().unwrap_or_else(|p| p.into_inner());
            match cache.get(&abs) {
                Some((m, b)) if *m == mt => ("gzip", b.clone()),
                _ => {
                    let raw = std::fs::read(&abs).ok()?;
                    let mut e = GzEncoder::new(Vec::new(), Compression::default());
                    e.write_all(&raw).ok()?;
                    let b = Arc::new(e.finish().ok()?);
                    cache.insert(abs.clone(), (mt, b.clone()));
                    ("gzip", b)
                }
            }
        } else {
            return None;
        };
        let meta = std::fs::metadata(&abs).ok()?;
        let etag = format!("W/\"{:x}-{:x}-{}\"", meta.len(), mtime_ms(&abs), enc);
        let ctype = mime_for(&abs).replace("UTF-8", "utf-8");
        let mut b = Response::builder()
            .header(header::VARY, "Accept-Encoding")
            .header(header::ETAG, &etag)
            .header(header::CONTENT_ENCODING, enc)
            .header(header::CONTENT_TYPE, ctype)
            .header(header::CACHE_CONTROL, cache_control(&rel));
        if req.header("if-none-match") == Some(etag.as_str()) {
            return Some(b.status(StatusCode::NOT_MODIFIED).body(Body::empty()).unwrap());
        }
        b = b.header(header::CONTENT_LENGTH, body.len());
        Some(b.status(StatusCode::OK).body(Body::from((*body).clone())).unwrap())
    }

    async fn files(&self, req: &Req, path: &str) -> Option<Resp> {
        let rel = decode_uri_component(path)?;
        if rel.split('/').any(|s| s == "..") {
            return None;
        }
        let mut target = self.root.join(rel.trim_start_matches('/'));
        let mut rel_for_cache = rel.clone();
        if target.is_dir() {
            if !req.original_url.split('?').next().unwrap_or("").ends_with('/') {
                return Some(crate::http::redirect_to_dir(req));
            }
            target = target.join("index.html");
            rel_for_cache = format!("{}index.html", if rel.ends_with('/') { rel.clone() } else { format!("{rel}/") });
        }
        if !target.is_file() {
            return None;
        }
        Some(send_file(req, &target, &cache_control(&rel_for_cache), None).await)
    }
}
