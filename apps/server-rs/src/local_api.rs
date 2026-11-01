//! Local-profile / local-resources helpers of `serverApp.ts` (lines 1089-1432): `/local/*` routes, VIP-club e-mail flag,
//! profile picture storage.

use crate::config::ServerConfig;
use crate::encoding::encode_ascii_codes;
use crate::repository::{get_profile_container, get_profile_container_mut, tags, Res, SaveRepository};
use crate::save_defaults::DEFAULT_CITY_NAME;
use crate::util::{js_number, js_string_or_empty, now_ms};
use regex::Regex;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

const LOCAL_PROFILE_NAME_MAX_LENGTH: usize = 32;
const LOCAL_CITY_NAME_MAX_LENGTH: usize = 32;
const LOCAL_PROFILE_PICTURE_FILE_NAME: &str = "profile-picture";
const LOCAL_PROFILE_PICTURE_MAX_BYTES: usize = 2 * 1024 * 1024;
const LOCAL_RESOURCE_ADJUSTMENT_MAX: f64 = 999_999_999.0;
const MIME_META_KEY: &str = "local_profile_picture_mime";
const VERSION_META_KEY: &str = "local_profile_picture_version";
pub const PICTURE_MIME_TYPES: [&str; 4] = ["image/gif", "image/jpeg", "image/png", "image/webp"];

pub struct Picture {
    pub file_path: PathBuf,
    pub mime_type: String,
}

pub struct LocalProfile {
    pub user_name: String,
    pub city_name: String,
}

// ---- profile -----------------------------------------------------------------------------------------------------

/// serverApp.ts:1089 `createLocalProfileResponse`
pub fn create_local_profile_response(repo: &SaveRepository, config: &ServerConfig) -> Value {
    let picture = get_local_profile_picture(repo, config);
    let profile = get_local_profile(repo);
    json!({
        "ok": true,
        "userName": profile.user_name,
        "cityName": profile.city_name,
        "hasProfilePicture": picture.is_some(),
        "profilePictureUrl": format!("/local/profile-picture?v={}", get_local_profile_picture_version(repo, config)),
    })
}

/// serverApp.ts:1101 `updateLocalProfile` (errors become the 400 `{ok:false,error}` answer).
pub fn update_local_profile(repo: &SaveRepository, config: &ServerConfig, payload: &Value) -> Res<Value> {
    let user = repo.ensure_default_user()?;
    let current = get_local_profile(repo);
    let user_name = match payload.get("userName") {
        None => current.user_name.clone(),
        Some(v) => sanitize_name(&js_string_or_empty(Some(v)), LOCAL_PROFILE_NAME_MAX_LENGTH, "Mayor"),
    };
    let city_name = match payload.get("cityName") {
        None => current.city_name.clone(),
        Some(v) => sanitize_name(&js_string_or_empty(Some(v)), LOCAL_CITY_NAME_MAX_LENGTH, DEFAULT_CITY_NAME),
    };
    let clear = matches!(payload.get("clearProfilePicture"), Some(Value::Bool(true)))
        || payload.get("clearProfilePicture").and_then(Value::as_str) == Some("true");
    let upload = match payload.get("profilePictureDataUrl").and_then(Value::as_str) {
        Some(s) if !clear && !s.trim().is_empty() => Some(parse_local_profile_picture(s)?),
        _ => None,
    };

    repo.update_default_user_name(&user_name)?;
    let mut universe = repo.get_document(user.id, tags::UNIVERSE)?;
    if let Some(profile) = get_profile_container_mut(&mut universe) {
        profile["userName"] = Value::String(user_name.clone());
        profile["cityname"] = Value::String(city_name.clone());
        profile["cityNameCodes"] = Value::String(encode_ascii_codes(&city_name));
        repo.set_document(user.id, tags::UNIVERSE, &universe)?;
    }

    if clear {
        clear_local_profile_picture(repo, config)?;
    } else if let Some((mime, bytes)) = upload {
        save_local_profile_picture(repo, config, &mime, &bytes)?;
    }
    Ok(create_local_profile_response(repo, config))
}

/// serverApp.ts:1140 `getLocalProfile`
pub fn get_local_profile(repo: &SaveRepository) -> LocalProfile {
    let user = match repo.ensure_default_user() {
        Ok(u) => u,
        Err(_) => {
            return LocalProfile { user_name: "Mayor".into(), city_name: DEFAULT_CITY_NAME.into() };
        }
    };
    match repo.get_document(user.id, tags::UNIVERSE) {
        Ok(universe) => {
            let profile = get_profile_container(&universe);
            let name_src = match profile.and_then(|p| p.get("userName")) {
                None | Some(Value::Null) => user.name.clone(),
                Some(v) => js_string_or_empty(Some(v)),
            };
            let city_src = match profile.and_then(|p| p.get("cityname")) {
                None | Some(Value::Null) => DEFAULT_CITY_NAME.to_string(),
                Some(v) => js_string_or_empty(Some(v)),
            };
            LocalProfile {
                user_name: sanitize_name(&name_src, LOCAL_PROFILE_NAME_MAX_LENGTH, "Mayor"),
                city_name: sanitize_name(&city_src, LOCAL_CITY_NAME_MAX_LENGTH, DEFAULT_CITY_NAME),
            }
        }
        Err(_) => LocalProfile {
            user_name: sanitize_name(&user.name, LOCAL_PROFILE_NAME_MAX_LENGTH, "Mayor"),
            city_name: DEFAULT_CITY_NAME.into(),
        },
    }
}

/// serverApp.ts:1156/1165 `sanitizeLocalProfileName` / `sanitizeLocalCityName`
fn sanitize_name(value: &str, max_units: usize, fallback: &str) -> String {
    let no_ctrl: String = value.chars().filter(|c| !(*c as u32 <= 0x1F || *c as u32 == 0x7F)).collect();
    let mut collapsed = String::new();
    let mut in_ws = false;
    for c in no_ctrl.chars() {
        if c.is_whitespace() || c == '\u{FEFF}' {
            if !in_ws {
                collapsed.push(' ');
            }
            in_ws = true;
        } else {
            collapsed.push(c);
            in_ws = false;
        }
    }
    let trimmed = collapsed.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
    // slice(0, n) counts UTF-16 code units
    let mut out = String::new();
    let mut units = 0;
    for c in trimmed.chars() {
        units += c.len_utf16();
        if units > max_units {
            break;
        }
        out.push(c);
    }
    if out.is_empty() { fallback.to_string() } else { out }
}

// ---- resources ---------------------------------------------------------------------------------------------------

fn read_whole_number(value: Option<&Value>, fallback: f64) -> f64 {
    let parsed = match value {
        None | Some(Value::Null) => fallback,
        other => js_number(other),
    };
    if !parsed.is_finite() { fallback } else { parsed.floor().max(0.0) }
}

fn clamp_whole_number(v: f64) -> f64 {
    if !v.is_finite() { 0.0 } else { v.floor().max(0.0) }
}

fn level_from_xp(exp: f64, thresholds: &[f64]) -> f64 {
    if !exp.is_finite() || exp < 0.0 || thresholds.is_empty() {
        return 1.0;
    }
    let mut level = 0usize;
    while level < thresholds.len() {
        if exp < thresholds[level] {
            return (level as f64).max(1.0);
        }
        level += 1;
    }
    (thresholds.len() as f64).max(1.0)
}

fn level_xp_bounds(level: f64, thresholds: &[f64]) -> (f64, f64) {
    if thresholds.is_empty() {
        return (0.0, 0.0);
    }
    let normalized = level.floor().max(1.0) as usize;
    let min_xp = thresholds[(normalized - 1).min(thresholds.len() - 1)];
    let max_xp = thresholds[normalized.min(thresholds.len() - 1)];
    let min_c = clamp_whole_number(min_xp);
    (min_c, clamp_whole_number(max_xp).max(min_c))
}

/// serverApp.ts:1174 `createLocalResourcesResponse`
pub fn create_local_resources_response(repo: &SaveRepository, thresholds: &[f64]) -> Res<Value> {
    let user = repo.ensure_default_user()?;
    let universe = repo.get_document(user.id, tags::UNIVERSE)?;
    let profile = get_profile_container(&universe).ok_or("Player profile is missing from the save.")?;
    let xp = read_whole_number(profile.get("exp"), 0.0);
    let explicit_level = read_whole_number(profile.get("level"), 0.0);
    let level = explicit_level.max(level_from_xp(xp, thresholds));
    let (min_xp, max_xp) = level_xp_bounds(level, thresholds);
    let n = |k: &str| json!(read_whole_number(profile.get(k), 0.0) as i64);
    Ok(json!({
        "ok": true,
        "money": n("DCCoins"),
        "gold": n("DCCash"),
        "paidGold": n("DCCashPaid"),
        "xp": xp as i64,
        "level": level as i64,
        "minXp": min_xp as i64,
        "maxXp": max_xp as i64,
        "companyValue": n("companyValue"),
    }))
}

fn num_str(v: f64) -> Value {
    Value::String(crate::util::js_number_to_string(v))
}

/// serverApp.ts:1193 `adjustLocalResources`
pub fn adjust_local_resources(repo: &SaveRepository, thresholds: &[f64], cash_to_coins: f64, payload: &Value) -> Res<Value> {
    let resource = js_string_or_empty(payload.get("resource")).trim().to_lowercase();
    let delta = js_number(payload.get("delta"));
    if !delta.is_finite() || delta != delta.trunc() || delta == 0.0 {
        return Err("Adjustment must be a non-zero whole number.".into());
    }
    if delta.abs() > LOCAL_RESOURCE_ADJUSTMENT_MAX {
        return Err(format!(
            "Adjustment must be between -{} and {}.",
            LOCAL_RESOURCE_ADJUSTMENT_MAX as i64, LOCAL_RESOURCE_ADJUSTMENT_MAX as i64
        ));
    }
    if !["money", "gold", "xp"].contains(&resource.as_str()) {
        return Err("Resource must be money, gold, or xp.".into());
    }

    let user = repo.ensure_default_user()?;
    let mut universe = repo.get_document(user.id, tags::UNIVERSE)?;
    let profile = get_profile_container_mut(&mut universe).ok_or("Player profile is missing from the save.")?;
    let whole = |p: &Value, k: &str| read_whole_number(p.get(k), 0.0);

    match resource.as_str() {
        "money" => {
            let previous = whole(profile, "DCCoins");
            let money = clamp_whole_number(previous + delta);
            profile["DCCoins"] = num_str(money);
            profile["companyValue"] = num_str(clamp_whole_number(whole(profile, "companyValue") + money - previous));
        }
        "gold" => {
            let previous = whole(profile, "DCCash");
            let gold = clamp_whole_number(previous + delta);
            let paid = clamp_whole_number(whole(profile, "DCCashPaid") + delta);
            profile["DCCash"] = num_str(gold);
            profile["DCCashPaid"] = num_str(paid.min(gold));
            profile["companyValue"] =
                num_str(clamp_whole_number(whole(profile, "companyValue") + (gold - previous) * cash_to_coins));
        }
        _ => {
            let xp = clamp_whole_number(whole(profile, "exp") + delta);
            let level = level_from_xp(xp, thresholds);
            let explicit = whole(profile, "level");
            profile["exp"] = num_str(xp);
            profile["level"] = num_str(if delta < 0.0 { level } else { explicit.max(level) });
        }
    }
    repo.set_document(user.id, tags::UNIVERSE, &universe)?;
    create_local_resources_response(repo, thresholds)
}

// ---- profile picture -----------------------------------------------------------------------------------------------

fn picture_path(config: &ServerConfig) -> PathBuf {
    config.db_path.parent().map(PathBuf::from).unwrap_or_default().join(LOCAL_PROFILE_PICTURE_FILE_NAME)
}

fn parse_local_profile_picture(data_url: &str) -> Res<(String, Vec<u8>)> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| {
        Regex::new(r"(?is)^data:(image/(?:gif|jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$").unwrap()
    });
    let invalid = || "Profile picture must be a PNG, JPEG, GIF, or WebP image.".to_string();
    let caps = re.captures(data_url.trim()).ok_or_else(invalid)?;
    let mime = caps[1].to_lowercase();
    if !PICTURE_MIME_TYPES.contains(&mime.as_str()) {
        return Err(invalid());
    }
    use base64::Engine;
    let cleaned: String = caps[2].chars().filter(|c| !c.is_whitespace()).collect();
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new().with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent),
    );
    let bytes = engine.decode(cleaned.trim_end_matches('=')).unwrap_or_default();
    if bytes.is_empty() || bytes.len() > LOCAL_PROFILE_PICTURE_MAX_BYTES {
        return Err("Profile picture must be between 1 byte and 2 MB.".into());
    }
    if !image_magic_matches(&bytes, &mime) {
        return Err("Profile picture data does not match its image type.".into());
    }
    Ok((mime, bytes))
}

fn image_magic_matches(b: &[u8], mime: &str) -> bool {
    match mime {
        "image/png" => b.len() >= 8 && b[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        "image/jpeg" => b.len() >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff,
        "image/gif" => b.len() >= 6 && (&b[..6] == b"GIF87a" || &b[..6] == b"GIF89a"),
        "image/webp" => b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP",
        _ => false,
    }
}

fn save_local_profile_picture(repo: &SaveRepository, config: &ServerConfig, mime: &str, bytes: &[u8]) -> Res<()> {
    let path = picture_path(config);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    repo.set_meta(MIME_META_KEY, mime)?;
    repo.set_meta(VERSION_META_KEY, &now_ms().to_string())
}

fn clear_local_profile_picture(repo: &SaveRepository, config: &ServerConfig) -> Res<()> {
    let path = picture_path(config);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    repo.delete_meta(MIME_META_KEY)?;
    repo.set_meta(VERSION_META_KEY, &now_ms().to_string())
}

/// serverApp.ts:1352 `getLocalProfilePicture`
pub fn get_local_profile_picture(repo: &SaveRepository, config: &ServerConfig) -> Option<Picture> {
    let path = picture_path(config);
    let mime = repo.get_meta(MIME_META_KEY)?;
    if !PICTURE_MIME_TYPES.contains(&mime.as_str()) || !path.exists() {
        return None;
    }
    Some(Picture { file_path: path, mime_type: mime })
}

/// serverApp.ts:1366 `getLocalProfilePictureVersion`
pub fn get_local_profile_picture_version(repo: &SaveRepository, config: &ServerConfig) -> String {
    if let Some(v) = repo.get_meta(VERSION_META_KEY).filter(|v| !v.is_empty()) {
        return v;
    }
    let path = picture_path(config);
    match std::fs::metadata(&path).and_then(|m| m.modified()) {
        Ok(t) => t
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis().to_string())
            .unwrap_or_else(|_| "default".into()),
        Err(_) => "default".into(),
    }
}

// ---- VIP club e-mail flag -------------------------------------------------------------------------------------------

/// serverApp.ts:1403 `markVipClubEmailSubmitted`
pub fn mark_vip_club_email_submitted(repo: &SaveRepository) -> Res<()> {
    let user = repo.ensure_default_user()?;
    let mut universe = repo.get_document(user.id, tags::UNIVERSE)?;
    let Some(profile) = get_profile_container_mut(&mut universe) else { return Ok(()) };
    if js_string_or_empty(profile.get("checkmail")) == "2" {
        return Ok(());
    }
    profile["checkmail"] = Value::String("1".into());
    repo.set_document(user.id, tags::UNIVERSE, &universe)
}

/// serverApp.ts:1415 `isVipClubEmailSubmitted`
pub fn is_vip_club_email_submitted(repo: &SaveRepository) -> Res<bool> {
    let user = repo.ensure_default_user()?;
    let universe = repo.get_document(user.id, tags::UNIVERSE)?;
    let v = match get_profile_container(&universe).and_then(|p| p.get("checkmail")) {
        None | Some(Value::Null) => "0".to_string(),
        Some(v) => crate::util::js_string(v),
    };
    Ok(v != "0")
}

