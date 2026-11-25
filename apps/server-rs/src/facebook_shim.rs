//! Port of `apps/server/src/facebookShim.ts`: a tiny HTTPS Facebook Graph/REST stand-in (self-signed cert).

use crate::assets::data_asset_path;
use crate::config::ServerConfig;
use crate::http::{json, send_file, text, Req, Resp};
use crate::local_api::{get_local_profile, get_local_profile_picture, get_local_profile_picture_version};
use crate::repository::SaveRepository;
use crate::rules::load_definition_attributes;
use crate::util::{decode_uri_component, encode_uri_component};
use axum::http::{header, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;

/// Facebook-style ids of the three offline friends (the NPCs of `NPCDefinitions.xml`, in file order: Ronald, Cindy, Sheik). They are
/// NOT the ids in the original's `FriendsManager.NPCS_EXT_ID` (:36): `FriendsManager.load` (:468-481) drops those from the friend
/// list, and the original client can only invest in a friend (`UserDataFacadeOnline.requestTask` TASK_INVEST :632-640 ->
/// `FriendsManager.getFriendByID`) that is in `mAllFriends`.
pub const NPC_FRIEND_IDS: [&str; 3] = ["100000000000101", "100000000000102", "100000000000103"];
const NPC_FRIEND_FALLBACK_NAMES: [&str; 3] = ["Ronald", "Cindy", "Sheik"];

const TRANSPARENT_GIF_B64: &str = "R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";

pub struct FacebookShim {
    pub current_user_id: String,
    pub repo: Arc<SaveRepository>,
    pub config: Arc<ServerConfig>,
    pub lock: Arc<tokio::sync::Mutex<()>>,
}

pub fn transparent_gif() -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(TRANSPARENT_GIF_B64).unwrap()
}

impl FacebookShim {
    /// facebookShim.ts:31-103 (all routes; anything else is Express' default 404).
    pub async fn handle(&self, req: &Req) -> Resp {
        println!("[fbshim] {} {}", req.method, req.original_url);
        if !req.is_get_or_head() {
            return crate::http::not_found(req);
        }
        let lc = req.path.to_lowercase();
        let lc = if lc.len() > 1 { lc.trim_end_matches('/').to_string() } else { lc };
        match lc.as_str() {
            "/crossdomain.xml" => text(
                StatusCode::OK,
                "application/xml",
                "<!DOCTYPE cross-domain-policy SYSTEM \"http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd\">\n<cross-domain-policy>\n  <site-control permitted-cross-domain-policies=\"all\" />\n  <allow-access-from domain=\"*\" secure=\"true\" />\n</cross-domain-policy>",
            ),
            // The original client always sends `access_token` (SocialFacebook.getFriendList :394); a bare probe keeps the legacy empty list.
            "/me/friends" if req.query.iter().any(|(k, _)| k == "access_token") => {
                let data: Vec<Value> = NPC_FRIEND_IDS.iter().map(|id| json!({ "id": id })).collect();
                json(StatusCode::OK, &json!({ "data": data }))
            }
            "/me/friends" => json(StatusCode::OK, &json!({ "data": [] })),
            "/method/friends.getappusers" => json(StatusCode::OK, &json!([])),
            "/method/users.getinfo" => self.users_get_info(req),
            "/method/pages.isfan" => json(StatusCode::OK, &Value::Bool(true)),
            _ => {
                // `/:id/picture` (one segment id)
                let segs: Vec<&str> = req.path.trim_matches('/').split('/').collect();
                if segs.len() == 2 && segs[1].eq_ignore_ascii_case("picture") && !segs[0].is_empty() {
                    let id = decode_uri_component(segs[0]).unwrap_or_else(|| segs[0].to_string());
                    return self.picture(req, &id).await;
                }
                crate::http::not_found(req)
            }
        }
    }

    fn users_get_info(&self, req: &Req) -> Resp {
        // String(req.query.uids ?? "") (repeated keys join with ",")
        let raw: Vec<&str> = req.query.iter().filter(|(k, _)| k == "uids").map(|(_, v)| v.as_str()).collect();
        let uids: Vec<String> = raw
            .join(",")
            .split(',')
            .map(|u| u.trim().to_string())
            .filter(|u| !u.is_empty())
            .collect();
        let version = encode_uri_component(&get_local_profile_picture_version(&self.repo, &self.config));
        let list: Vec<Value> = uids
            .iter()
            .enumerate()
            .map(|(index, uid)| {
                let current = *uid == self.current_user_id;
                let npc = (!current).then(|| self.npc_friend_name(uid)).flatten();
                json!({
                    "uid": uid,
                    "first_name": if current { get_local_profile(&self.repo).user_name } else if let Some(name) = &npc { name.clone() } else { format!("Friend {}", index + 1) },
                    "last_name": "",
                    "pic_square": if current {
                        format!("https://graph.facebook.com/{}/picture?v={}", self.current_user_id, version)
                    } else if npc.is_some() {
                        format!("https://graph.facebook.com/{uid}/picture")
                    } else {
                        "https://graph.facebook.com/100/picture".to_string()
                    },
                    "locale": "en_US",
                })
            })
            .collect();
        let mut r = json(StatusCode::OK, &Value::Array(list));
        r.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
        r
    }

    /// Name of the NPC friend with this Facebook-style id (`NPCDefinitions.xml` `Definition name`, file order).
    fn npc_friend_name(&self, uid: &str) -> Option<String> {
        let index = NPC_FRIEND_IDS.iter().position(|id| *id == uid)?;
        let defs = load_definition_attributes(&data_asset_path(&self.config, &["rules", "NPCDefinitions.xml"]));
        Some(defs.get(index).and_then(|d| d.get("name").cloned()).unwrap_or_else(|| NPC_FRIEND_FALLBACK_NAMES[index].to_string()))
    }

    async fn picture(&self, req: &Req, id: &str) -> Resp {
        if let Some(name) = self.npc_friend_name(id) {
            let file = data_asset_path(&self.config, &["Assets", "npcs", &format!("{name}.png")]);
            if file.is_file() {
                return send_file(req, &file, "no-store", Some("image/png")).await;
            }
        }
        if id == self.current_user_id {
            if let Some(pic) = get_local_profile_picture(&self.repo, &self.config) {
                return send_file(req, &pic.file_path, "no-store", Some(&pic.mime_type)).await;
            }
        }
        let mut r = crate::http::bytes("image/gif", transparent_gif());
        r.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::get_server_config;
    use crate::database::Database;
    use axum::http::Method;

    fn shim(dir: &std::path::Path) -> FacebookShim {
        let config = Arc::new(get_server_config());
        let repo = Arc::new(SaveRepository::new(Arc::new(Database::open(&dir.join("t.sqlite")).unwrap())));
        FacebookShim { current_user_id: "100000000000001".into(), repo, config, lock: Default::default() }
    }

    fn get(path: &str, query: &[(&str, &str)]) -> Req {
        Req {
            method: Method::GET,
            path: path.into(),
            original_url: path.into(),
            query: query.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            headers: Default::default(),
            body: Value::Null,
        }
    }

    async fn body_json(r: Resp) -> Value {
        let bytes = http_body_util::BodyExt::collect(r.into_body()).await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn me_friends_with_token_lists_the_three_npcs_and_without_stays_empty() {
        let dir = tempfile::tempdir().unwrap();
        let s = shim(dir.path());
        let with = body_json(s.handle(&get("/me/friends", &[("access_token", "local-oauth-token")])).await).await;
        let ids: Vec<&str> = with["data"].as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert_eq!(ids, NPC_FRIEND_IDS);
        assert_eq!(body_json(s.handle(&get("/me/friends", &[])).await).await, json!({ "data": [] }));
        // never one of the original's NPCS_EXT_ID (FriendsManager.as:36), which the client drops from its friend list
        assert!(!ids.iter().any(|i| ["100001135295884", "100001188295998", "100001211196508"].contains(i)));
    }

    #[tokio::test]
    async fn users_get_info_names_the_npc_friends_from_npc_definitions() {
        let dir = tempfile::tempdir().unwrap();
        let s = shim(dir.path());
        let uids = format!("{},{}", NPC_FRIEND_IDS.join(","), "100000000000001");
        let list = body_json(s.handle(&get("/method/users.getinfo", &[("uids", uids.as_str())])).await).await;
        let names: Vec<&str> = list.as_array().unwrap().iter().map(|e| e["first_name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Ronald", "Cindy", "Sheik", "Mayor"]);
        assert_eq!(list[1]["pic_square"], format!("https://graph.facebook.com/{}/picture", NPC_FRIEND_IDS[1]));
    }

    #[tokio::test]
    async fn npc_friend_picture_is_the_npc_png() {
        let dir = tempfile::tempdir().unwrap();
        let s = shim(dir.path());
        let r = s.handle(&get(&format!("/{}/picture", NPC_FRIEND_IDS[0]), &[])).await;
        assert_eq!(r.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
    }
}
