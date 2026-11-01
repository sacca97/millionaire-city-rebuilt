//! Static game assets (serverApp.ts:233-412 and 751-966): patched rules XML, case-insensitive asset lookup,
//! missing-asset fallbacks, `express.static` look-alike.

use crate::config::ServerConfig;
use crate::http::{send_file, status_only, Req, Resp};
use crate::util::decode_uri_component;
use axum::http::StatusCode;
use regex::Regex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const ITEM_RULE_FILES: [&str; 4] =
    ["commerceDefinitions.xml", "decorationDefinitions.xml", "itemDefinitions.xml", "wonderDefinitions.xml"];
const COLLECTIBLE_RULE_FILES: [&str; 3] =
    ["collectiblesDefinitions.xml", "collectiblesGroupsDefinitions.xml", "collectiblesRewardDefinitions.xml"];
const REWARD_ONLY_ITEM_SKUS: [&str; 1] = ["commerce_vip"];
const STATIC_EXTENSIONS: [&str; 7] = ["swf", "xml", "txt", "png", "jpg", "css", "js"];

pub fn data_asset_path(config: &ServerConfig, segments: &[&str]) -> PathBuf {
    let mut p = config.asset_root.join("Datas");
    for s in segments {
        p.push(s);
    }
    p
}

/// serverApp.ts:751 `createArchivedItemSwfSet`: lower-cased `.swf` names in `Datas/Assets/items`.
pub fn create_archived_item_swf_set(config: &ServerConfig) -> HashSet<String> {
    let dir = data_asset_path(config, &["Assets", "items"]);
    let Ok(rd) = std::fs::read_dir(dir) else { return HashSet::new() };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_lowercase())
        .filter(|n| n.ends_with(".swf"))
        .collect()
}

fn definition_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"<Definition\b([^>]*)/>").unwrap())
}

// ---- attribute helpers (serverApp.ts:932-966) ----------------------------------------------------------------------

/// `attributes.match(new RegExp('(?:^|\\s)NAME="([^"]*)"'))`
pub fn get_xml_attribute(attributes: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let mut from = 0;
    while let Some(rel) = attributes[from..].find(&needle) {
        let at = from + rel;
        let boundary = at == 0 || attributes[..at].chars().next_back().map(|c| c.is_whitespace()).unwrap_or(true);
        if boundary {
            let start = at + needle.len();
            let end = attributes[start..].find('"')? + start;
            return Some(attributes[start..end].to_string());
        }
        from = at + 1;
    }
    None
}

fn remove_xml_attribute(attributes: &str, name: &str) -> String {
    Regex::new(&format!(r#"\s+{name}="[^"]*""#)).unwrap().replace_all(attributes, "").into_owned()
}

fn upsert_xml_attribute(attributes: &str, name: &str, value: &str) -> String {
    let re = Regex::new(&format!(r#"(\s+){name}="[^"]*""#)).unwrap();
    if re.is_match(attributes) {
        re.replace(attributes, |c: &regex::Captures| format!("{}{name}=\"{value}\"", &c[1])).into_owned()
    } else {
        format!("{attributes} {name}=\"{value}\"")
    }
}

fn is_limited_item_definition(attributes: &str) -> bool {
    get_xml_attribute(attributes, "expireTime").map(|v| !v.is_empty()).unwrap_or(false)
        || get_xml_attribute(attributes, "releaseTime").map(|v| !v.is_empty()).unwrap_or(false)
        || get_xml_attribute(attributes, "shopTab")
            .map(|t| t.split(',').any(|x| x.trim() == "limEd"))
            .unwrap_or(false)
}

fn remove_lim_ed_shop_tab(attributes: &str) -> String {
    let Some(shop_tab) = get_xml_attribute(attributes, "shopTab").filter(|s| !s.is_empty()) else {
        return attributes.to_string();
    };
    let remaining: Vec<&str> = shop_tab.split(',').map(str::trim).filter(|t| !t.is_empty() && *t != "limEd").collect();
    if remaining.is_empty() {
        return remove_xml_attribute(attributes, "shopTab");
    }
    let re = Regex::new(r#"(\s+shopTab=")[^"]*(")"#).unwrap();
    re.replace(attributes, |c: &regex::Captures| format!("{}{}{}", &c[1], remaining.join(","), &c[2])).into_owned()
}

fn remove_limited_availability_attributes(attributes: &str) -> String {
    let mut a = attributes.to_string();
    for n in ["expireTime", "releaseTime", "unitsAmount"] {
        a = remove_xml_attribute(&a, n);
    }
    remove_lim_ed_shop_tab(&a)
}

fn is_archived_item_sku_available(sku: &str, swfs: &HashSet<String>, uses_advisor: bool) -> bool {
    if swfs.contains(&format!("{sku}.swf").to_lowercase()) {
        return true;
    }
    uses_advisor
        && swfs.contains(&format!("{sku}_Cindy.swf").to_lowercase())
        && swfs.contains(&format!("{sku}_Ronald.swf").to_lowercase())
}

// ---- patched rules XML ------------------------------------------------------------------------------------------------

/// serverApp.ts:765/801 `createAvailableItemRulesXml` / `createAvailableCollectibleRulesXml`: `None` falls through.
pub fn patched_rules_xml(config: &ServerConfig, file_name: &str, swfs: &HashSet<String>) -> Option<String> {
    create_available_item_rules_xml(config, file_name, swfs)
        .or_else(|| create_available_collectible_rules_xml(config, file_name, swfs))
}

fn create_available_item_rules_xml(config: &ServerConfig, file_name: &str, swfs: &HashSet<String>) -> Option<String> {
    if !ITEM_RULE_FILES.contains(&file_name) {
        return None;
    }
    let xml = std::fs::read_to_string(data_asset_path(config, &["rules", file_name])).ok()?;
    Some(
        definition_re()
            .replace_all(&xml, |c: &regex::Captures| {
                let tag = c[0].to_string();
                let attrs = &c[1];
                let Some(sku) = get_xml_attribute(attrs, "sku").map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
                else {
                    return tag;
                };
                let uses_advisor = get_xml_attribute(attrs, "useAdvisor").is_some();
                if !is_archived_item_sku_available(&sku, swfs, uses_advisor) {
                    return String::new();
                }
                let mut patched =
                    if is_limited_item_definition(attrs) { remove_limited_availability_attributes(attrs) } else { attrs.to_string() };
                if REWARD_ONLY_ITEM_SKUS.contains(&sku.as_str()) {
                    patched = upsert_xml_attribute(&patched, "freeGift", "1");
                }
                format!("<Definition{patched}/>")
            })
            .into_owned(),
    )
}

fn create_available_collectible_rules_xml(
    config: &ServerConfig,
    file_name: &str,
    swfs: &HashSet<String>,
) -> Option<String> {
    if !COLLECTIBLE_RULE_FILES.contains(&file_name) {
        return None;
    }
    let xml = std::fs::read_to_string(data_asset_path(config, &["rules", file_name])).ok()?;
    let (group_skus, reward_skus) = get_available_collectible_rules(config, swfs);
    Some(
        definition_re()
            .replace_all(&xml, |c: &regex::Captures| {
                let tag = c[0].to_string();
                let attrs = &c[1];
                let Some(sku) = get_xml_attribute(attrs, "sku").map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
                else {
                    return tag;
                };
                match file_name {
                    "collectiblesGroupsDefinitions.xml" => {
                        if group_skus.contains(&sku) { tag } else { String::new() }
                    }
                    "collectiblesDefinitions.xml" => {
                        let collection = get_xml_attribute(attrs, "collection").map(|s| s.trim().to_string());
                        match collection {
                            Some(col) if !col.is_empty() && group_skus.contains(&col) => tag,
                            _ => String::new(),
                        }
                    }
                    "collectiblesRewardDefinitions.xml" => {
                        if reward_skus.contains(&sku) { tag } else { String::new() }
                    }
                    _ => tag,
                }
            })
            .into_owned(),
    )
}

fn get_available_collectible_rules(config: &ServerConfig, swfs: &HashSet<String>) -> (HashSet<String>, HashSet<String>) {
    let groups_path = data_asset_path(config, &["rules", "collectiblesGroupsDefinitions.xml"]);
    let Ok(xml) = std::fs::read_to_string(groups_path) else { return (HashSet::new(), HashSet::new()) };
    let advisor_skus = get_advisor_variant_item_skus(config);
    let mut groups = HashSet::new();
    let mut rewards = HashSet::new();
    for c in definition_re().captures_iter(&xml) {
        let attrs = &c[1];
        let trimmed = |n: &str| get_xml_attribute(attrs, n).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let (Some(group), Some(reward)) = (trimmed("sku"), trimmed("reward")) else { continue };
        let reward_type = get_xml_attribute(attrs, "rewardType").map(|s| s.trim().to_lowercase());
        if reward_type.as_deref() == Some("item")
            && !is_archived_item_sku_available(&reward, swfs, advisor_skus.contains(&reward))
        {
            continue;
        }
        groups.insert(group);
        rewards.insert(reward);
    }
    (groups, rewards)
}

fn get_advisor_variant_item_skus(config: &ServerConfig) -> HashSet<String> {
    let Ok(xml) = std::fs::read_to_string(data_asset_path(config, &["rules", "itemDefinitions.xml"])) else {
        return HashSet::new();
    };
    definition_re()
        .captures_iter(&xml)
        .filter_map(|c| {
            let sku = get_xml_attribute(&c[1], "sku").map(|s| s.trim().to_string()).filter(|s| !s.is_empty())?;
            get_xml_attribute(&c[1], "useAdvisor").is_some().then_some(sku)
        })
        .collect()
}

// ---- case-insensitive asset lookup (serverApp.ts:633) ------------------------------------------------------------------

fn parse_safe_segments(request_path: &str) -> Option<Vec<String>> {
    let decoded = decode_uri_component(request_path)?;
    let segs: Vec<String> = decoded.split(['\\', '/']).filter(|s| !s.is_empty()).map(String::from).collect();
    if segs.is_empty() || segs.iter().any(|s| s == "." || s == ".." || s.contains('\0')) {
        return None;
    }
    Some(segs)
}

fn resolve_case_insensitive_file(root: &Path, request_path: &str) -> Option<PathBuf> {
    let segs = parse_safe_segments(request_path)?;
    let mut current = root.to_path_buf();
    for seg in segs {
        let exact = current.join(&seg);
        if exact.exists() {
            current = exact;
            continue;
        }
        let lower = seg.to_lowercase();
        let matched = std::fs::read_dir(&current).ok()?.filter_map(|e| e.ok()).find_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (name.to_lowercase() == lower).then_some(name)
        })?;
        current = current.join(matched);
    }
    current.is_file().then_some(current)
}

/// `createCaseInsensitiveAssetMiddleware` (`rel` is `req.path` below the `/mcity/0.501` mount).
pub async fn case_insensitive_asset(config: &ServerConfig, req: &Req, rel: &str) -> Option<Resp> {
    if !req.is_get_or_head() {
        return None;
    }
    let resolved = resolve_case_insensitive_file(&config.asset_root, rel)?;
    let exact = config.asset_root.join(rel.trim_start_matches('/'));
    if resolved != exact {
        eprintln!("[mcity] Resolved asset case mismatch: {}", req.original_url);
    }
    // Static game data (rules, locale, tilesets): cache for a day.
    Some(send_file(req, &resolved, "public, max-age=86400", None).await)
}

// ---- fallbacks ------------------------------------------------------------------------------------------------------------

fn base_name(raw_param: &str) -> String {
    let decoded = decode_uri_component(raw_param).unwrap_or_else(|| raw_param.to_string());
    decoded.rsplit(['/', '\\']).next().unwrap_or("").to_string() // path.basename on posix only splits on '/', ok for params
}

/// serverApp.ts:297 `/mcity/0.501/Datas/feed/:fileName`
pub async fn feed_fallback(config: &ServerConfig, req: &Req, raw_param: &str) -> Option<Resp> {
    let file_name = base_name(raw_param);
    let requested = data_asset_path(config, &["feed", &file_name]);
    if requested.exists() {
        return Some(send_file(req, &requested, "public, max-age=0", None).await);
    }
    let ext = Path::new(&file_name).extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e.to_lowercase()));
    let fallback_name = match ext.as_deref() {
        Some(".jpg") | Some(".jpeg") => Some("new_feed_upgrades_0.jpg"),
        Some(".png") => Some("newitemimage.png"),
        _ => None,
    }?;
    let fallback = data_asset_path(config, &["feed", fallback_name]);
    if fallback.exists() {
        eprintln!("[mcity] Missing feed asset: {}; serving {}", req.original_url, fallback_name);
        return Some(send_file(req, &fallback, "public, max-age=0", None).await);
    }
    None
}

/// serverApp.ts:327/350/373: icon / swf fallbacks. `Ok(Some)` served, `None` falls through to the next stage.
pub async fn asset_fallback(
    config: &ServerConfig,
    req: &Req,
    dir: &[&str],
    raw_param: &str,
    required_ext: &str,
    fallback_name: &str,
    what: &str,
) -> Option<Resp> {
    let file_name = base_name(raw_param);
    if !file_name.to_lowercase().ends_with(required_ext) {
        return None;
    }
    let mut segs: Vec<&str> = dir.to_vec();
    segs.push(&file_name);
    if data_asset_path(config, &segs).exists() {
        return None;
    }
    let mut fb: Vec<&str> = dir.to_vec();
    fb.push(fallback_name);
    let fallback = data_asset_path(config, &fb);
    if fallback.exists() {
        eprintln!("[mcity] Missing {what}: {}; serving {fallback_name}", req.original_url);
        return Some(send_file(req, &fallback, "public, max-age=0", None).await);
    }
    None
}

// ---- express.static look-alike ------------------------------------------------------------------------------------------------

/// `express.static(root, { fallthrough: true, extensions })`; `rel` is the path below the mount (starts with `/`).
pub async fn serve_static(root: &Path, rel: &str, extensions: &[&str], req: &Req) -> Option<Resp> {
    if !req.is_get_or_head() {
        return None;
    }
    let decoded = decode_uri_component(rel)?;
    // serve-static (send): a `..` segment is a 403 "malicious path", which `fallthrough: true` turns into next(), so the
    // request reaches the caller's missing-asset handler (404, empty body). Never serve anything for such a path.
    if decoded.contains('\0') || decoded.split(['\\', '/']).any(|s| s == "..") {
        return None;
    }
    let trimmed = decoded.trim_start_matches('/');
    let target = root.join(trimmed);
    let has_trailing_slash = decoded.ends_with('/');
    if target.is_dir() {
        let orig_path = req.original_url.split('?').next().unwrap_or("");
        if !orig_path.ends_with('/') {
            return Some(crate::http::redirect_to_dir(req));
        }
        let index = target.join("index.html");
        if index.is_file() {
            return Some(send_file(req, &index, "public, max-age=0", None).await);
        }
        return None;
    }
    if target.is_file() && !has_trailing_slash {
        return Some(send_file(req, &target, "public, max-age=0", None).await);
    }
    if !has_trailing_slash {
        for ext in extensions {
            let candidate = PathBuf::from(format!("{}.{ext}", target.display()));
            if candidate.is_file() {
                return Some(send_file(req, &candidate, "public, max-age=0", None).await);
            }
        }
    }
    None
}

pub fn static_extensions() -> &'static [&'static str] {
    &STATIC_EXTENSIONS
}

pub fn missing_asset(req: &Req) -> Resp {
    eprintln!("[mcity] Missing asset: {}", req.original_url);
    status_only(StatusCode::NOT_FOUND)
}
