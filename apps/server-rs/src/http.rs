//! Minimal Express-like request/response helpers shared by the route modules.

use crate::util::parse_query;
use axum::body::Body;
use axum::http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode};
use serde_json::{Map, Value};
use std::path::Path;
use std::time::UNIX_EPOCH;

pub type Resp = Response<Body>;

/// What a route handler sees (mirrors the parts of Express `req` the TS server uses).
pub struct Req {
    pub method: Method,
    /// `req.path` (raw, still percent-encoded, no query).
    pub path: String,
    /// `req.originalUrl`
    pub original_url: String,
    pub query: Vec<(String, String)>,
    pub headers: HeaderMap,
    /// `req.body` (`{}` when absent or not parsed).
    pub body: Value,
}

impl Req {
    pub fn is_get_or_head(&self) -> bool {
        self.method == Method::GET || self.method == Method::HEAD
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    /// `req.query[name]` first value.
    pub fn query_first(&self, name: &str) -> Option<&str> {
        self.query.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

/// Parses a request body like `express.urlencoded({extended:false})` + `express.json()` (5 MB limit applied by the caller).
pub fn parse_body(content_type: Option<&str>, bytes: &[u8]) -> Result<Value, String> {
    let ct = content_type.unwrap_or("").to_ascii_lowercase();
    if ct.starts_with("application/x-www-form-urlencoded") {
        let text = String::from_utf8_lossy(bytes);
        let mut map = Map::new();
        for (k, v) in parse_query(&text) {
            match map.get_mut(&k) {
                // qs repeats become arrays
                Some(Value::Array(a)) => a.push(Value::String(v)),
                Some(existing) => {
                    let first = existing.take();
                    *existing = Value::Array(vec![first, Value::String(v)]);
                }
                None => {
                    map.insert(k, Value::String(v));
                }
            }
        }
        return Ok(Value::Object(map));
    }
    if ct.contains("json") {
        if bytes.iter().all(|b| b.is_ascii_whitespace()) {
            return Ok(Value::Object(Map::new()));
        }
        return match serde_json::from_slice::<Value>(bytes) {
            Ok(v @ Value::Object(_)) | Ok(v @ Value::Array(_)) => Ok(v),
            _ => Err("invalid json".into()),
        };
    }
    Ok(Value::Object(Map::new()))
}

pub fn status_only(status: StatusCode) -> Resp {
    Response::builder().status(status).body(Body::empty()).unwrap()
}

/// `res.type(ct).send(body)` for string bodies (charset added for text-like types as Express does).
pub fn text(status: StatusCode, content_type: &str, body: impl Into<String>) -> Resp {
    let ct = if content_type.starts_with("text/") || content_type.contains("xml") || content_type.contains("json") {
        format!("{content_type}; charset=utf-8")
    } else {
        content_type.to_string()
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, ct)
        .body(Body::from(body.into()))
        .unwrap()
}

/// `res.json(value)`
pub fn json(status: StatusCode, value: &Value) -> Resp {
    text(status, "application/json", serde_json::to_string(value).unwrap())
}

pub fn bytes(content_type: &str, body: Vec<u8>) -> Resp {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(body))
        .unwrap()
}

pub fn with_header(mut resp: Resp, name: &'static str, value: &str) -> Resp {
    if let Ok(v) = HeaderValue::from_str(value) {
        resp.headers_mut().insert(header::HeaderName::from_static(name), v);
    }
    resp
}

/// Express' default 404 page for unmatched routes.
pub fn not_found(req: &Req) -> Resp {
    let body = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot {} {}</pre>\n</body>\n</html>\n",
        req.method,
        html_escape(req.path.as_str())
    );
    let mut r = text(StatusCode::NOT_FOUND, "text/html", body);
    r.headers_mut().insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    r.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'"),
    );
    r
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// MIME type table used by `res.sendFile` (the `mime` 1.x defaults for the extensions this project serves).
pub fn mime_for(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=UTF-8",
        "css" => "text/css; charset=UTF-8",
        "txt" => "text/plain; charset=UTF-8",
        "js" | "mjs" => "application/javascript; charset=UTF-8",
        "json" | "map" => "application/json; charset=UTF-8",
        "xml" => "application/xml",
        "swf" => "application/x-shockwave-flash",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "woff" => "application/font-woff",
        "woff2" => "font/woff2",
        "ttf" => "application/x-font-ttf",
        "flv" => "video/x-flv",
        "mp4" => "video/mp4",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn http_date(secs: i64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp(secs).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    let wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dt.weekday().number_days_from_monday() as usize];
    let mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dt.month() as usize - 1];
    format!("{wd}, {:02} {mon} {} {:02}:{:02}:{:02} GMT", dt.day(), dt.year(), dt.hour(), dt.minute(), dt.second())
}

/// `res.sendFile(path, { maxAge })`: ETag, Last-Modified, Range, 304. `cache_control` overrides the default
/// `public, max-age=<n>`; `content_type` overrides the extension lookup. Missing file -> 404 (Express forwards ENOENT as 404).
pub async fn send_file(
    req: &Req,
    path: &Path,
    cache_control: &str,
    content_type: Option<&str>,
) -> Resp {
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) if m.is_file() => m,
        _ => return status_only(StatusCode::NOT_FOUND),
    };
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let etag = format!("W/\"{:x}-{:x}\"", meta.len(), mtime_ms);
    let last_modified = http_date(mtime_ms.div_euclid(1000));
    let ctype = content_type.unwrap_or_else(|| mime_for(path)).to_string();

    let mut builder = Response::builder()
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::LAST_MODIFIED, &last_modified)
        .header(header::ETAG, &etag)
        .header(header::CONTENT_TYPE, &ctype);

    if let Some(inm) = req.header("if-none-match") {
        if inm.split(',').any(|t| t.trim() == etag || t.trim() == "*") {
            return builder.status(StatusCode::NOT_MODIFIED).body(Body::empty()).unwrap();
        }
    } else if let Some(ims) = req.header("if-modified-since") {
        if ims == last_modified {
            return builder.status(StatusCode::NOT_MODIFIED).body(Body::empty()).unwrap();
        }
    }

    let data = match tokio::fs::read(path).await {
        Ok(d) => d,
        Err(_) => return status_only(StatusCode::NOT_FOUND),
    };
    let total = data.len() as u64;
    if let Some(range) = req.header("range").and_then(|r| r.strip_prefix("bytes=")) {
        if !range.contains(',') {
            let (a, b) = range.split_once('-').unwrap_or((range, ""));
            let parsed = match (a.trim().parse::<u64>(), b.trim().parse::<u64>()) {
                (Ok(s), Ok(e)) => Some((s, e.min(total.saturating_sub(1)))),
                (Ok(s), Err(_)) if b.trim().is_empty() => Some((s, total.saturating_sub(1))),
                (Err(_), Ok(n)) if a.trim().is_empty() && n > 0 => Some((total.saturating_sub(n), total.saturating_sub(1))),
                _ => None,
            };
            match parsed {
                Some((s, e)) if s <= e && s < total => {
                    builder = builder
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_RANGE, format!("bytes {s}-{e}/{total}"));
                    return builder.body(Body::from(data[s as usize..=e as usize].to_vec())).unwrap();
                }
                _ => {
                    return Response::builder()
                        .status(StatusCode::RANGE_NOT_SATISFIABLE)
                        .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                        .body(Body::empty())
                        .unwrap();
                }
            }
        }
    }
    builder.status(StatusCode::OK).body(Body::from(data)).unwrap()
}

/// serve-static's directory redirect (`/dir` -> `/dir/`): 301 with Express' "Redirecting to" page.
pub fn redirect_to_dir(req: &Req) -> Resp {
    let (path, query) = match req.original_url.split_once('?') {
        Some((p, q)) => (p, format!("?{q}")),
        None => (req.original_url.as_str(), String::new()),
    };
    let location = format!("{path}/{query}");
    let body = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to {}</pre>\n</body>\n</html>\n",
        html_escape(&location)
    );
    let mut r = text(StatusCode::MOVED_PERMANENTLY, "text/html", body);
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=UTF-8"));
    if let Ok(v) = HeaderValue::from_str(&location) {
        h.insert(header::LOCATION, v);
    }
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'"));
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    r
}
