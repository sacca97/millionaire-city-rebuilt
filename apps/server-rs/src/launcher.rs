//! Port of `apps/server/src/launcherHtml.ts`. The static HTML lives in `templates/launcher.html` (generated from the TS
//! `renderLauncherHtml` with sentinel values, so it is byte-identical; placeholders are `{{NAME}}`).

use crate::util::form_urlencode;
use serde_json::json;

const TEMPLATE: &str = include_str!("../templates/launcher.html");
const GAME_VERSION: &str = "0.501";

pub const LAUNCHER_CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'self'; connect-src 'self' https://graph.facebook.com https://api.facebook.com; frame-src 'self'; child-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

pub struct LauncherOptions {
    pub app_url: String,
    pub assets_base_url: String,
    pub server_base_url: String,
    pub user_id: String,
    pub oauth_token: String,
    pub game_token: String,
    pub facebook_app_id: String,
    pub lang: String,
    pub debug_mode: bool,
    pub climate_mode: bool,
    pub old_item_designs: bool,
    pub local_user_name: String,
    pub local_city_name: String,
    pub local_profile_picture_url: String,
}

fn escape_html(v: &str) -> String {
    v.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn escape_script_json(v: &str) -> String {
    v.replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// launcherHtml.ts:58 `renderLauncherHtml`
pub fn render_launcher_html(o: &LauncherOptions) -> String {
    let flag = |b: bool| if b { "1" } else { "0" };
    let params: Vec<(&str, String)> = vec![
        ("token", o.game_token.clone()),
        ("uid", o.user_id.clone()),
        ("env", "private".into()),
        ("fan_page_id", o.facebook_app_id.clone()),
        ("oauth_token", o.oauth_token.clone()),
        ("facebook_app_id", o.facebook_app_id.clone()),
        ("server", o.server_base_url.clone()),
        ("data", o.assets_base_url.clone()),
        ("game_version", GAME_VERSION.into()),
        ("wcrm_env", "2".into()),
        ("wcrm_user", o.user_id.clone()),
        ("wcrm_server", o.server_base_url.clone()),
        ("wcrm_visible_at", "0".into()),
        ("swf_version", "0".into()),
        ("lang", o.lang.clone()),
        ("fed_currency_id", "9".into()),
        ("fed_url", o.server_base_url.clone()),
        ("fed_game_id", "Dollar_Facebook".into()),
        ("fed_payments", "0".into()),
        ("fed_post_payment_url", format!("{}/launcher", o.app_url)),
        ("analytics_code", "null".into()),
        ("useFrictionlessFacebookCredits", "false".into()),
        ("bartUrl", o.server_base_url.clone()),
        ("allFriendsAreNeighbors", "0".into()),
        ("debugMode", flag(o.debug_mode).into()),
        ("climateMode", flag(o.climate_mode).into()),
        ("oldItemDesigns", flag(o.old_item_designs).into()),
        ("console", flag(o.debug_mode).into()),
    ];
    let flash_vars = params
        .iter()
        .map(|(k, v)| format!("{}={}", form_urlencode(k), form_urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let bootstrap = escape_script_json(
        &serde_json::to_string(&json!({
            "userName": o.local_user_name,
            "cityName": o.local_city_name,
            "profilePictureUrl": o.local_profile_picture_url,
        }))
        .unwrap(),
    );
    let user_name = escape_html(&o.local_user_name);
    let city_name = escape_html(&o.local_city_name);
    let pic_url = escape_html(&o.local_profile_picture_url);

    // Single pass so substituted values are never re-scanned.
    let mut out = String::with_capacity(TEMPLATE.len() + 1024);
    let mut rest = TEMPLATE;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        match &after[..end] {
            "APP_URL" => out.push_str(&o.app_url),
            "ASSETS" => out.push_str(&o.assets_base_url),
            "FLASHVARS" => out.push_str(&flash_vars),
            "BOOTSTRAP" => out.push_str(&bootstrap),
            "USER_NAME" => out.push_str(&user_name),
            "CITY_NAME" => out.push_str(&city_name),
            "PIC_URL" => out.push_str(&pic_url),
            other => {
                out.push_str("{{");
                out.push_str(other);
                out.push_str("}}");
            }
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}
