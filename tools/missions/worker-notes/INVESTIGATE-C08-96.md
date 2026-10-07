# INVESTIGATE C08-96: why the original re-sends update_missions for 97..103

Read-only investigation. No code edited, no oracle run.

## Facts from the logs

- Original cmds (tools/oracle/out/flow-mission-C08-96/cmds.jsonl), after the claim of 96 and the reload:
  `update_missions {"action":"update","sku":97,"security":{...}}` ... for sku 97, 98, 99, 100, 101, 102, 103 (7 commands, one per sku, `_cnt` 23..29 of the second session). Nothing for 104+.
- Body shape: `action` is always `"update"` and `sku` is the only mission field. The `security` object is the balance snapshot (`expGain 0`, `coinsNow 476000`, `compValueNow 852000`, `expNow 6300`). No `state`, no list, no `xml` (the XML path only runs under DEBUG_XML, UDFO.as:1224-1250).
- The pre-reload dump `completed.saves.json` has Up = 104..119,255,266,267,280..315,89..95 (no 97..103). The post-reload `final.saves.json` has 97,98,99,100..103 in Up. Ours (/tmp/ours-h2-C08-96) has 97..103 in Up in both dumps.
- Correction to the framing: `completed` is taken 3.5 s after the claim, before the reload (flow mission-C08-96.mjs:17). The re-send happens after the reload (cmds.jsonl t=1791411813100). So the re-send is a symptom of the state the reload loads. It cannot be the cause of the `completed` difference.

## Why the original re-sends (client mechanism)

1. The server's chunks for 97..103 are absent on reload, so `MissionObjectManager.build()` (MissionObjectManager.as:667-742) does not place them in Up/Reached/Given. Line 723 creates them with the default state, `MissionObject(def)` = STATE_LOCKED, and puts them in the LOCKED list.
2. Each frame, `logicUpdate` (MissionObjectManager.as:408-436) runs `MissionObject.logicUpdate` over the UP and LOCKED lists (lines 413-423). MissionObject.as:215-220: LOCKED and `checkUnlock()` true -> `changeState(STATE_UNLOCKED)`.
3. `checkUnlock()` is the unlock class. The unlock for 97..103 is by LEVEL, not by sku 96: missionDefinitions.xml gives unlockLevel 2 (97, 98), 3 (99..101), 4 (102, 103). Unlock classes: UnlockMissionManager.as:45-51, UnlockMissionByLevel.as:12-16. The player is above those levels, so the check is true.
4. `changeState` records the change (MissionObject.as:269-273, `changeStateMissionsAddChange(this, 0, 1)`). `changeStateMissionsApplyAll` runs (MissionObjectManager.as:343-351, called at line 425). `changeStateMissionsApplyMission(m, LOCKED, UNLOCKED)` (lines 196-293):
   - lines 212-256: moves the entry LOCKED list -> UP list (the sorted insert for entries past the first 6 at lines 226-251).
   - line 277: `if (param2 == LOCKED || _loc6_)` is true.
   - line 287: `UserDataFacade.getInstance().updateMissions("update", {"sku": sku}, getPersistence(), null)`.
5. `UserDataFacadeOnline.updateMissions` (UserDataFacadeOnline.as:1224-1248) sets `action`, adds `security` from `securityUpdate()`, and sends `update_missions`. The send is gated on `DollarsGame.smInstance.mState == STATE_RUN_WORLD` (line 1225).
6. The 104+ entries were already in the Up chunk on reload, so they load as STATE_UNLOCKED (MissionObjectManager.as:699-702, 701). Their constructor overwrites `mOldState` (MissionObject.as:71-72), so no transition and no send.

Server side (apps/server/src/commandHandlers/offline.ts:410-421, commandHandlers.ts:1492-1530; original GamePlay.java:1346-1389): `update` with a sku toggles it: given stays; reached -> given (reward); up -> reached; otherwise added to Up. So each re-sent sku is simply added back to Up, appended at the end (dump order 97,98,99 at the end, then 100..103 at the front after the string sort in saveTree.ts:71-73).

## Our equivalent (already the same rule)

- `apps/client/src/game/missions.ts` `MissionObject.checkUnlock` (line ~424-436) and `logicUpdate` (~440-451): the same LOCKED -> UNLOCKED transition by level.
- `MissionManager.build` (~557-585): the same default LOCKED placement for missions not in the save.
- `MissionManager.update` (~692-700): iterates UP and LOCKED, then `applyAll`.
- `MissionManager.applyChange` (~640-684): the same list move, and at line ~674 `if (oldState === STATE_LOCKED || listChanged)` calls `host.sendMission(sku, claim)`.
- `apps/client/src/ui/missions/system.ts:80-83` `sendMission` -> `game.commands.mission(sku, claim)` (`apps/client/src/net/commands.ts:590-601`). Unlike the original (UDFO.as:1225), it is NOT gated on the RUN_WORLD state.

So ours would re-send identically if it reached the same reload state. We do not re-send because our persisted Up already contains 97..103 (`completed` and `final` both show them).

## Root cause (what is established vs not)

Established: the re-send is the normal LOCKED -> UNLOCKED path on load for level-gated missions missing from the saved chunks. The original's saved chunks lacked 97..103 before the reload, and ours had them.

Not established from static reading: why the original's server state lacked 97..103 at `completed`, since the first-session `update_missions` for 97..103 are identical in both runs (orig t=741911..749954, ours t=935752..937768). Both sent them, the server adds them to Up (offline.ts:418-421), and nothing in the mission handler removes them (no `xml` path, no 96 chain for these skus). Plausible causes, to be checked:
- (a) A write of the universe document from another handler that holds a stale copy (a race between concurrent requests). Check the server's getDocument/setDocument ordering for update_map / update_item / get_* handlers during the 2 s send batches.
- (b) Original sends dropped during a non-RUN_WORLD window (UDFO.as:1225). Less likely, since the wire log shows the sends went out.

## Proposed change

No change to missions.ts or system.ts is justified yet. Our mission rules already match the original's re-send path. Do not add a re-send, because that would make ours diverge from the original's normal behaviour.

Next steps before any edit:
1. Instrument the server (or read `repository` writes) to log the Missions chunks after each `update_missions` and after each other universe write, in both runs. This finds which write drops 97..103 in the original.
2. If the cause is (b), add the same RUN_WORLD gate to `sendMission` in `apps/client/src/ui/missions/system.ts:80` (mirror UDFO.as:1225). Note this is a behaviour change for the load-time transitions and needs a full oracle check.
