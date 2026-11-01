# Offline NPC friends (Rust server)

User decision (final): the game never runs on Facebook. The only friends are the three NPCs of `NPCDefinitions.xml` (Ronald, Cindy, Sheik): no
real players, no generated friends. This is the Rust server only (`apps/server-rs`); the TS server never got it and has been deleted.
Conformance: `tools/conformance/friends.conf.test.ts` (runs by default in `make conformance`).

## 1. What the original client needs (all cited from `decompiled/scripts/com/dchoc/dollars/`)

**Root cause of the empty friends bar offline: the Facebook redirect, not the server.** The harness and the desktop app redirected
`graph.facebook.com` / `api.facebook.com` to the local shim with a `webRequest` redirect. Flash fetches `/crossdomain.xml` (the shim logged two
hits) and then never sends `/me/friends`: the policy file of a redirected request is not accepted for the host Flash asked for. The friends bar
therefore stayed a spinner on the TS server too. Fix: map the hosts at the network layer (`--host-resolver-rules="MAP graph.facebook.com
127.0.0.1:<shim port>, MAP api.facebook.com ..."`), so Flash sees no redirect: `tools/oracle/loader.cjs` (default, `ORACLE_FB_MAP=0` restores the
old behaviour) and `apps/desktop/src/main.ts` (switch + the request handler lets the hosts through instead of redirecting; **not run here**,
there is no desktop run in this environment).

Boot sequence of the original (`model/userdata/UserDataFacadeOnline.as`, `Config.CLIENT_USE_FACEBOOK_API = true`, Config.as:17):

| step | call | where |
|---|---|---|
| 1 | GET `https://graph.facebook.com/me/friends?access_token=` -> `{data:[{id}]}` | `SocialFacebook.getFriendList` :392-402, `getFriendListComplete` :113-137; `load()` :1649-1655 |
| 2 | GET `https://api.facebook.com/method/friends.getAppUsers?format=json&access_token=` -> JSON array of ids | `SocialFacebook.getAppFriendList` :186-201; `load()` :1658-1664 |
| 3 | when both arrived: GET `/method/users.getInfo?uids=<friends,me>&fields=first_name,last_name,pic_square,locale` | `updateLoadingState` :264-285, `SocialFacebook.getUserInfoSlot` :318-330 |
| 4 | command `get_neighbor_info {facebookIds: appFriends, useNeighborList}` -> `{neighborList:[...]}` | :285-288 (answer stored :1282-1284) |
| 5 | `setFile(friendList)` + `setFile(neighborList)` -> `FriendsManager.reload()` -> the bar | :358-361 |

`FriendsManager.load` (FriendsManager.as:468-516) builds `mAllFriends` from the friend list but **drops** the three ids of `NPCS_EXT_ID` (:36, :439-447),
builds `mNeighbors` only from `neighborList` entries that match a friend, adds the player, then `npcsLoad` (:171-211) appends the NPC neighbors
(user ids `mNPCSArray` = 100, 100, 101; advisor only for the player's boss genre, `RulesFacade.npcsIsMyAdvisor`; exp / company value / name /
picture from `NPCDefinitions.xml`). So the bar's NPC boxes need no server data except step 1-5 completing with empty lists.

Features and what they need:

| feature | client | server |
|---|---|---|
| visit a city | click a box -> `get_world {targetUserId}` and `get_upgrades_list {userId}` (DollarsGame.as:1545-1553); entering the world as visitor registers `visitFriend` (or `visitRonald` when owner == `mNPCSArray[0]` = 100), `visitPartner` if `NeighborObject.isPartner()` and always `visitCity` (DollarsGame.as:1612-1626). `isPartner = (mIsPartner || isAdvisor()) && USE_SUPERUPGRADES` (NeighborObject.as:112-115, FriendObject.as:121), and `isAdvisor = isNPC` for **all** NPCs (FriendObject.as:94-97), so every NPC visit counts for visitPartner. | Java `GamePlay.getWorld` (GamePlay.java:120-141): another `targetUserId` is a read-only visit. Rust: `commands/world.rs` + `save_defaults::create_neighbor_universe` (NPC 100 = Cindy/Ronald by boss genre, 101 = Sheik; layouts captured from the original: `data/ronaldLayout.json`, `data/sheikLayout.json`; unknown ids get an empty "Neighbor City" with a HQ only). |
| upgrade a friend's house | `StateOnRentVisitor.doDoClick` (:30-45): `add_upgrade_item {ownerId, visitorId, sid, type, security}`; mission event `upgrade` through `ItemObject.registerEvent`; `UpgradesManager.upgradeItem` counts the 5 daily upgrades down | Java `upgradeAdd` (GamePlay.java:1286+): `help2upgrades` rows; Rust `offline.rs apply_upgrade_command` (cap per owner, visitor and day, `visitor_upgrades_per_day()`). |
| collectUpgraded | `StateOnRent.onIncome` (:1478-1481): collecting the rent of a house whose state has `upgradeGetEnabled()`; the flag comes from `UpgradesManager.isItemUpgraded(sid)` = the `get_upgrades_list` of the **own** city (StateItemObject.as:690-701) | Java `getUpgradesList` own branch (GamePlay.java:323-346). Offline there is nobody to upgrade the player's houses: see 2. |
| investment | Config.`INVESTMENT_REQUEST_ENABLED = true` (Config.as:91): "Send Investment Request" (`PopupInvest.onGetFriends` :365-370) does **not** send `invest_on_friend` (`InvestManager.investInFriend` :282-295 skips it); it calls `TASK_INVESTMENT_REQUEST` -> `externalTaskRequest("fbRequest", {action:"investmentRequest"})` (UserDataFacadeOnline.as:496-500) -> the web page opens an `apprequests` dialog for `investOnFriend` (`assets/mcity.digitalchocolate.com/dollar/dollar.htm:627-636`) and the request acceptance creates the row server-side. The `investment` / `investmentDone` mission events fire when a finished investment is **claimed** (`PopupInvestSuccess` :99-100, `PopupInvestFail` :82), after `invest_results`. | Java `investOnFriend(accountId, extId, null)` (GamePlay.java:1139-1166), `investGetInversion` (:1203-1234), `investResults` (:1262-1284). |
| beat | `Profile.eventCheck` (Profile.as:746-760): company value compared with `eventCondition` = `npcsGetCompanyValue(condition)` (MissionDefinition.as:397-400; missions 56/183: condition 2 = Sheik, $900,000,000) | none (pure client; seed company value). |
| askForHelp | `StateOnConstructionOwner.onAskHelp` (:366-382): `ask_for_help {sid}`, registers `askForHelp` at once; answer `help_id == "null"` shows `TID_A4H_REQUEST` (UserDataFacadeOnline.as:1286-1315) | `commandHandlers.ts:356` / Rust `noop` answer `{help_id:"null"}`. |

## 2. What the Rust server serves now

* **Facebook shim** (`src/facebook_shim.rs`): `/me/friends?access_token=...` returns the 3 NPCs with ids `100000000000101/102/103`
  (`NPC_FRIEND_IDS`), `users.getInfo` gives their `first_name` from `NPCDefinitions.xml` and `pic_square` `https://graph.facebook.com/<id>/picture`,
  which the shim serves as the NPC png (`Assets/npcs/<Name>.png`). They are deliberately **not** the original `NPCS_EXT_ID` (the client would
  drop those) so `FriendsManager.getFriendByID` finds them: investment rows and the portfolio need that. A request without `access_token`
  (a bare probe, the existing conformance test) still answers `{data:[]}`. `friends.getAppUsers` stays `[]`, so the NPCs are friends, not
  neighbors (the bar's NPC boxes come from `npcsLoad`).
* **Own-city upgrades by the NPCs** (`src/commands/npc_friends.rs`, run when the own city loads (`get_world`, `world.rs`; the boot cmdList sends `get_upgrades_list` right after and reports them; kept out of `get_upgrades_list` itself so the existing conformance test on its output stays valid)): once the
  tutorial is over, each NPC upgrades up to 5 (`visitor_upgrades_per_day()`, env `MCITY_UPGRADES_PER_DAY`, default 5, also the cap of the
  player's own upgrades per NPC city) of the player's houses (state id 1 = on rent, any mode; HQ and commerce excluded) per day, in document
  order, Ronald first. Rows are the existing `__npcUpgradeRecords` (owner "1", visitor = NPC id). Collecting the rent (`new_mode` +
  `upgradeType`, `applyUpgradeAppliedEffect`) removes the row; a ledger (`__npcFriendUpgradeLedger`, same document) keeps the house from being
  upgraded again the same day. Unclaimed rows disappear with the day (as `get_upgrades_list` already filters by day).
* **Investments** (`npc_friends::npc_invest`, `POST /local/npc-invest`, hook `templates/npc-friends.js` served at `GET /local/npc-friends.js`):
  the page hook replaces `launchFacebookRequest` for `investmentRequest`: the NPC friends **accept at once** (Java: the friend accepts the
  app request, `invest_get_inversion`, state 1 -> 2): one running investment (state 2, `userId` -1, 20 days) per NPC without an unclaimed
  row, `investmentsStarted` + created, no coin charge (the Java web path has none, :1139-1166); then the page reloads the game so the
  portfolio shows them. An NPC whose investment was claimed (state 10 / 11) can be invested in again (the claimed row is replaced), else three
  NPCs would cap the 10-investment missions. When the 20 days are over the existing `refresh_investments` finishes them (state 3, always a
  success: NPC company value 100M >= the 4M target) and `invest_results` pays out.
  The hook is **not** in `launcher.html` (the launcher page stays byte-identical to the TS server's, conformance golden); the desktop app
  (`dom-ready` in `apps/desktop/src/main.ts`) and the oracle loader inject `<script src="/local/npc-friends.js">`. A TS-served page answers 404 and
  nothing changes.
* Unchanged and already complete: NPC cities (`get_world`), `add_upgrade_item`, `get_upgrades_list` of NPC cities, `ask_for_help` /
  `ask_for_cash` (`help_id:"null"`), `invest_*` commands (used by the TS client), `get_neighbor_info` (`neighborList: []`).

### NPC behaviour choices (each depends on a real player in the Java)

1. Investment request: accepted immediately and in full by all 3 NPCs; instant state 2; claim after 20 days is always a success.
2. Investing again in an NPC after its claim is allowed (Java refuses any friend with a row forever).
3. Upgrades of the player's houses: 5 per NPC per day, deterministic order, type 0 (normal; the client decides the super type itself).
4. `askForHelp`: no NPC helps (no acceleration, `help_id:"null"`, informational popup); the mission event fires client-side regardless.
5. Partner / neighbor requests (`partnerRequest`, `neighborRequest`) are not offered: the page still answers "unavailable".
6. Facebook friends are only the NPCs; `friends.getAppUsers` is empty.

## 3. How to reach each deferred class

Original client (harness: `MCITY_ORACLE_SERVER_CMD=<mcity-server> MCITY_ORACLE_PORT_BASE=<free base> FLOW=<name> node tools/oracle/run.mjs flow`;
interactive: `node tools/oracle/run.mjs hold-friends`, see `tools/oracle/scenarios/hold-friends.mjs`; stage coords, popups need 2 clicks):

| class | original | our client |
|---|---|---|
| C35 visitCity (39, 97) | friends bar Cindy (613,547) / Sheik (688,547), dismiss "Friend Upgrade", Home (365,447): `flows/mission-C35-39.mjs` (run: 39 Given) | click a friends-bar box (`ui/hud/friends.ts` -> `visit`), `visitStarted` registers visitCity |
| C36 visitPartner (65, 132...) | same visits, every NPC visit counts (40 needed: `VISITS=40 FLOW=mission-C36-65`) | `ui/missions/system.ts` now registers visitPartner for users 100/101 (was missing) |
| C32/C33/C34 upgrade | visit Sheik (his 129 waiting houses become renting for the visitor) or Cindy/Ronald (52 houses); click a house: `add_upgrade_item`, "x5" -> "x4". Cap 5 per owner and day (10/day for the two cities): set `MCITY_UPGRADES_PER_DAY=100` on the server for the 50-70 upgrade missions. Houses per sku: Sheik `houses_005_002` x10, `houses_008_001` x14, `houses_002_002` x4; Cindy `houses_005_002` x3, `houses_008_001` x3, `houses_002_002` x2 (`data/*Layout.json`) | same via the visit UI |
| C21/C22 collectUpgraded | own houses on rent get an NPC upgrade on the next load (`get_upgrades_list` own); make the rent ready (mode 5) and collect: `collectUpgraded` fires per collect; 15 houses per day (`MCITY_UPGRADES_PER_DAY` raises it) | `game.upgrades` from the same list |
| C27 investment | invest toolbar icon (247,455) -> "Send Investment Request" (375,433) -> page reload -> Investment Portfolio (515,554); to claim seed `startedAt` 21 days back (`flows/mission-C27-66.mjs` does) and press "Results" (503,182), close "Well Done" (569,170) | `invest_on_friend` (ui/social/invest.ts) |
| C28 investmentDone | same claims (success only counts) | same |
| C02 beat | seed `companyValue >= 900000000` (+ exp for level 25/31); no server work | `checkProfileMissionEvents` |
| C01 askForHelp | build something, click the "Please!" bubble on the construction (StateOnConstructionOwner.onAskHelp) | **not built**: the TS client has no ask-for-help UI |

Screenshots: `friends-smoke` writes `tools/oracle/out/flow-friends-smoke/` (friends bar, Sheik's city, upgrade, mission completed, invest window,
portfolio); `hold-friends` with `HOLD_INVEST_DONE=1` shows the claimable investments. Our client against the Rust server:
`tools/oracle/flows/friends-ours-probe.mjs` (run through `ours-flow.mjs`, header has the command).

## 4. Gaps left (not built)

* Our client has no ask-for-help UI (construction "Please!" bubble, `StateOnConstructionOwner.onAskHelp`): C01 is only reachable in the original.
* No NPC help for construction (`get_help_building_list` stays empty), no partner / neighbor requests (page answers "unavailable").
* Mission-scale runs need time or cap overrides: 20-day investments (seed `startedAt`), 5 upgrades per city and day (`MCITY_UPGRADES_PER_DAY`).
* `apps/desktop` changes (host mapping, page hook) typecheck but were not run in an Electron desktop session; the oracle loader uses the same mechanism.
