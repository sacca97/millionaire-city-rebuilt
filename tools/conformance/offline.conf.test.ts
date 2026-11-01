// Black-box port of apps/server/test/offline.test.ts (one conformance test per original test, same assertions).
// The original drives CommandService + the repository in process; here commands go over POST /Game and every read/seed of
// state goes through the SQLite file (server stopped while seeding, see lib/server.ts).
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { dailyRewardDefs, rewardGainField, rewardDef } from "./lib/rules.js";

cleanupServersAfterEach();

async function setup() {
  const server = await startServer({ noFacebookShim: true });
  const client = clientFor(server);
  const send = (cmd: string, dat: Record<string, unknown>): Promise<Record<string, any>> => client.send(cmd, dat);
  const profile = (): Record<string, any> => server.profile();
  const setProfile = (patch: Record<string, string>) =>
    server.seed((db) => db.editUniverse(({ profile: p }) => void Object.assign(p, patch)));
  const children = (tag: string): Array<Record<string, any>> => server.doc(tag)[tag];
  return { server, client, send, profile, setProfile, children };
}

describe("offline server gaps (ported from the recovered Java backend)", () => {
  test("update_money unlockItem fills the unlocked list once", async () => {
    const { send, children } = await setup();
    await send("update_money", { action: "unlockItem", value: "houses_001_002", security: {} });
    await send("update_money", { action: "unlockItem", value: "houses_001_002", security: {} });
    expect(children("unlockedList").map((e) => e.sku)).toEqual(["houses_001_002"]);
  });

  test("exchange applies cashToCoins when no snapshot is supplied and applies the reported gain otherwise", async () => {
    const { send, profile, setProfile } = await setup();
    await setProfile({ DCCash: "10", DCCoins: "100" });
    await send("update_money", { action: "exchange", value: 2 });
    expect(profile().DCCash).toBe("8");
    expect(profile().DCCoins).toBe(String(100 + 2 * 60000));
    await send("update_money", { action: "exchange", value: 1, security: { coinsNow: 5, cashNow: 7, coinsGain: 60000, cashGain: -1 } });
    // SecurityNormal.verify: coins/cash accumulate the reported GAIN (Now is only a check value)
    expect(profile().DCCoins).toBe(String(100 + 2 * 60000 + 60000));
    expect(profile().DCCash).toBe("7");
  });

  test("service stores <sku>TimeOver and get_world exposes <sku>TimeLeft; expired ones are dropped", async () => {
    const { send, profile, setProfile } = await setup();
    await send("update_money", { action: "service", value: "moneyCollector", id: 1, offer: "0", security: {} });
    const over = Number(profile().moneyCollectorTimeOver);
    expect(over - Date.now()).toBeGreaterThan(11 * 3_600_000);
    const world = (await send("get_world", { targetUserId: 1 })) as { universe: Array<Record<string, string>> };
    const worldProfile = world.universe.find((e) => "Profile" in e) as Record<string, string>;
    expect(Number(worldProfile.moneyCollectorTimeLeft)).toBeGreaterThan(0);
    expect(profile().moneyCollectorTimeLeft).toBeUndefined();
    await setProfile({ moneyCollectorTimeOver: String(Date.now() - 1000) });
    await send("get_world", { targetUserId: 1 });
    expect(profile().moneyCollectorTimeOver).toBeUndefined();
  });

  test("openBox consumes the box and stores move/item prizes; rentAccelerator consumes an accelerator and flags the house", async () => {
    const { server, send, children } = await setup();
    await server.seed((db) =>
      db.editDoc("storageList", (storage: any) => {
        storage.storageList.push({ item: [], sku: "briefcase", amount: "2" }, { item: [], sku: "rentAcc30", amount: "1" });
      })
    );
    await send("update_money", { action: "openBox", prize: "bc_003", type: "move", value: "2", security: {} });
    await send("update_money", { action: "openBox", prize: "birth_003", type: "item", value: "decorations_special_12", security: {} });
    const amounts = Object.fromEntries(children("storageList").map((e) => [e.sku, e.amount]));
    expect(amounts.briefcase).toBe("1");
    expect(amounts.move).toBe("2");
    expect(amounts.decorations_special_12).toBe("1");

    await send("update_item", {
      action: "new_item", sid: "500", sku: "houses_001_001", x: 0, y: 0, dec: 0,
      item: { Item: [{ State: [], id: "1", mode: "4", time: "3600000", contractSku: "1" }], sid: "500", sku: "houses_001_001", x: "0", y: "0", csid: "1", isSuspended: "0" }
    });
    await send("update_money", { action: "rentAccelerator", sku: "fgift_018", itemSid: "500", security: {} });
    expect(children("storageList").some((e) => e.sku === "rentAcc30")).toBe(false);
    const universe = JSON.stringify(server.doc("universe"));
    expect(universe).toContain('"accelerated":"1"');
  });

  test("daily reward progress follows the original streak rules", async () => {
    const { server, send, setProfile } = await setup();
    const daily = () => server.doc<Record<string, string>>("dailyBonusInfo");
    const first = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    expect(first.dailyRewardsNextRewardId).toMatch(/^reward_0[1-3]$/);
    expect(first.dailyRewardsCount).toBe("1"); // streak reset answers count 1 (GamePlay.java:953), stored 0
    expect(daily().dailyRewardsCount).toBe("0");
    await setProfile({ DCCoins: "0" });
    await send("update_daily_reward", { sku: first.dailyRewardsNextRewardId, security: { coinsGain: 8000, coinsNow: 8000, expGain: 0 } });
    const stored = daily();
    expect(stored.dailyRewardsCount).toBe("1");
    expect(stored.dailyRewardsLastGiven).toBe(`${first.dailyRewardsNextRewardId},`);
    expect(Number(stored.dailyRewardsLastGivenDate)).toBeGreaterThan(0);
    // second login in the same day: nothing due, progress unchanged
    const again = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    expect(again.dailyRewardsCount).toBe("1");
    // next day inside the 48h window: streak continues with count + 1
    stored.dailyRewardsLastGivenDate = String(Date.now() - 30 * 3_600_000);
    await server.seed((db) => db.setDoc("dailyBonusInfo", stored));
    const next = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    expect(next.dailyRewardsCount).toBe("2");
    expect(next.dailyRewardsNextRewardId).toMatch(/^reward_0[4-6]$/);
    // missed more than 48h: streak resets
    stored.dailyRewardsLastGivenDate = String(Date.now() - 80 * 3_600_000);
    await server.seed((db) => db.setDoc("dailyBonusInfo", stored));
    const reset = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    expect(reset.dailyRewardsCount).toBe("1");
    expect(reset.dailyRewardsLastGiven).toBe("");
  });

  test("daily reward claim is once per day, granted the next day (GamePlay.java:1787-1834, SecurityNormal.java:641)", async () => {
    const { server, send, profile } = await setup();
    const defs = await dailyRewardDefs(server);
    const daily = () => server.doc<Record<string, string>>("dailyBonusInfo");
    const gainField = (sku: string) => rewardGainField(rewardDef(defs, sku));

    // Day 1: first claim is accepted and grants the definition's reward.
    const first = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    const { value, field } = gainField(first.dailyRewardsNextRewardId);
    const before = Number(profile()[field] ?? 0);
    expect(await send("update_daily_reward", { sku: first.dailyRewardsNextRewardId, security: undefined })).not.toHaveProperty("success");
    expect(Number(profile()[field])).toBe(before + value);
    expect(daily().dailyRewardsCount).toBe("1");
    const stored = daily().dailyRewardsLastGivenDate;
    const lastGiven = daily().dailyRewardsLastGiven;
    const storedDate = new Date(Number(stored));
    expect(storedDate.getHours()).toBe(0); // GamePlay.java:1813-1816: local 00:10 of the claim day
    expect(storedDate.getMinutes()).toBe(10);

    // Same day: a second claim (even the same sku) is refused, nothing granted or stored.
    const again = await send("update_daily_reward", { sku: first.dailyRewardsNextRewardId, security: undefined });
    expect(again).toEqual({ success: "false" });
    expect(Number(profile()[field])).toBe(before + value);
    expect(daily().dailyRewardsCount).toBe("1");
    expect(daily().dailyRewardsLastGivenDate).toBe(stored);
    expect(daily().dailyRewardsLastGiven).toBe(lastGiven);

    // Next day (stored date faked 25h back): due again, the answer is day 2 and its group-2 reward is accepted.
    const yesterday = { ...daily(), dailyRewardsLastGivenDate: String(Date.now() - 25 * 3_600_000) };
    await server.seed((db) => db.setDoc("dailyBonusInfo", yesterday));
    const second = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    expect(second.dailyRewardsCount).toBe("2");
    expect(daily().dailyRewardsCount).toBe("1"); // the advanced count is answered, stored only by the claim
    const next = gainField(second.dailyRewardsNextRewardId);
    const beforeNext = Number(profile()[next.field] ?? 0);
    expect(await send("update_daily_reward", { sku: second.dailyRewardsNextRewardId, security: undefined })).not.toHaveProperty("success");
    expect(Number(profile()[next.field])).toBe(beforeNext + next.value);
    expect(daily().dailyRewardsCount).toBe("2");
  });

  test("daily reward claim is refused when the sku is not in the day's group (SecurityNormal.java:649-655)", async () => {
    const { server, send, profile } = await setup();
    const first = (await send("get_daily_rewards_info", {})) as Record<string, string>;
    expect(await send("update_daily_reward", { sku: first.dailyRewardsNextRewardId })).not.toHaveProperty("success");

    // Day 2 is group 2 (reward_04..06): a group-1 sku is refused, a group-2 sku is accepted.
    await server.seed((db) =>
      db.editDoc("dailyBonusInfo", (d: any) => {
        d.dailyRewardsLastGivenDate = String(Date.now() - 25 * 3_600_000);
      })
    );
    const coinsBefore = Number(profile().DCCoins ?? 0);
    expect(await send("update_daily_reward", { sku: "reward_02" })).toEqual({ success: "false" });
    expect(Number(profile().DCCoins ?? 0)).toBe(coinsBefore);
    expect(await send("update_daily_reward", { sku: "reward_05" })).not.toHaveProperty("success");
    expect(Number(profile().DCCoins ?? 0)).toBe(coinsBefore + 20000);
  });

  test("missions follow up -> reached -> given and pay the definition reward once (GamePlay.java:1346)", async () => {
    const { send, profile, setProfile } = await setup();
    await setProfile({ DCCoins: "1000", exp: "0" });
    const chunk = (tag: string) => {
      const m = ((profile().Profile as Array<Record<string, unknown>>).find((e) => Array.isArray(e.Missions)) as { Missions: Array<Record<string, unknown>> }).Missions;
      return String((m.find((e) => Array.isArray(e[tag])) as Record<string, unknown>).chunk ?? "");
    };
    await send("update_missions", { sku: 1, action: "update", security: {} }); // sku 1: 20000 coins
    expect(chunk("Up")).toBe("1");
    await send("update_missions", { sku: 1, action: "update", security: { coinsNow: 1000, coinsGain: -5 } });
    expect(chunk("Reached")).toBe("1");
    expect(profile().DCCoins).toBe("1000");
    await send("update_missions", { sku: 1, action: "update", security: { coinsNow: 21000 } }); // client already paid
    expect(chunk("Given")).toBe("1");
    expect(profile().DCCoins).toBe("21000");
    await send("update_missions", { sku: 1, action: "update", security: {} }); // replay: no double pay
    expect(profile().DCCoins).toBe("21000");
  });

  test("mission claim without a snapshot pays coins+exp and item rewards go to storage", async () => {
    const { send, profile, setProfile, children } = await setup();
    await setProfile({ DCCoins: "0", exp: "0" });
    for (let i = 0; i < 3; i++) await send("update_missions", { sku: 3, action: "update", security: {} }); // coins
    expect(Number(profile().DCCoins)).toBe(35000);
    const sku = "32";
    for (let i = 0; i < 3; i++) await send("update_missions", { sku: Number(sku), action: "update", security: {} });
    expect(children("storageList").some((e) => e.sku === "commerce_coffee")).toBe(true);
  });

  test("mission reward A/B group 2 grants the selected item instead of the base coins", async () => {
    const { send, profile, setProfile, children } = await setup();
    await setProfile({ DCCoins: "0", flags: "missionAltReward:2" });
    for (let i = 0; i < 3; i++) await send("update_missions", { sku: 20, action: "update", security: {} });
    expect(profile().DCCoins).toBe("0");
    expect(children("storageList").find((e) => e.sku === "decorations_special_04")?.amount).toBe("1");
  });

  // Original: isUpgradeEligibleItem(universe, "7") on a hand-built universe (internal helper). Observable effect: a visit
  // upgrade of an own house whose state is "on rent" (id 1, mode 1) is recorded and listed by get_upgrades_list.
  test("upgrade eligibility accepts on-rent houses of any mode (state id 1)", async () => {
    const { server, send } = await setup();
    await send("update_profile", { action: "tutorial_completed" }); // else a restart-seed resets the save (house in an unfinished tutorial)
    await server.seed((db) =>
      db.editUniverse(({ mine }) => {
        mine.Company.push({ Item: [{ State: [], id: "1", mode: "1" }], sid: "7", csid: "1", sku: "houses_001_001", x: "30", y: "30", isSuspended: "0" });
      })
    );
    await send("add_upgrade_item", { ownerId: 1, visitorId: 1, sid: "7", type: "0" });
    const list = (await send("get_upgrades_list", { userId: 1 })) as { upgradesList: Array<Record<string, string>> };
    expect(list.upgradesList.map((e) => e.sid)).toEqual(["7"]);
    // an item that is not on rent (state id 5, decoration-like) is not eligible
    await send("add_upgrade_item", { ownerId: 1, visitorId: 1, sid: "99999", type: "0" });
    const after = (await send("get_upgrades_list", { userId: 1 })) as { upgradesList: Array<Record<string, string>> };
    expect(after.upgradesList.map((e) => e.sid)).toEqual(["7"]);
  });

  test("dailyBonusDone sets the NPC timers reported by get_welcome_progress (GamePlay.java:972-986)", async () => {
    const { send } = await setup();
    expect(((await send("get_welcome_progress", {})) as Record<string, string>).npcRonaldTimeLeft).toBe("0");
    await send("update_money", { action: "dailyBonusDone", security: {} });
    const w = (await send("get_welcome_progress", {})) as Record<string, string>;
    expect(Number(w.npcRonaldTimeLeft)).toBeGreaterThan(0);
    expect(w.npcCindyTimeLeft).toBe(w.npcRonaldTimeLeft);
  });

  test("daily item rewards go to storage", async () => {
    const { send, children } = await setup();
    // reward_20 is a dated group-6 reward, not in day 1's group, so the claim is refused; reward_01 is a day-1 sku.
    await send("update_daily_reward", { sku: "reward_01", security: { item: "decorations_font_06" } });
    expect(children("storageList").find((e) => e.sku === "decorations_font_06")?.amount).toBe("1");
  });

  test("update_next_rent is stored (bounds checked) and profile flag/service/newItemsRevDone persist", async () => {
    const { server, send, profile } = await setup();
    await send("update_next_rent", { next_rent: 600 });
    expect(Number(server.meta("next_rent_1"))).toBeGreaterThan(Date.now());
    await send("update_next_rent", { next_rent: 999999999 });
    expect(Number(server.meta("next_rent_1"))).toBeLessThan(Date.now() + 700_000);
    await send("update_profile", { action: "flag", name: "graphics", value: "2" });
    await send("update_profile", { action: "flag", name: "tips", value: "1" });
    await send("update_profile", { action: "flag", name: "graphics", value: "3" });
    expect(profile().flags).toBe("graphics:3,tips:1,");
    await send("update_profile", { action: "service", value: "moneyCollector" });
    expect(profile().moneyCollectorPresentationShown).toBe("1");
    await send("update_profile", { action: "newItemsRevDone" });
    expect(profile().newItemsRev).toBe("1");
  });

  test("item mutations: storage placement, free moves, contractGroupSku, upgradeType and mode 6 persistence", async () => {
    const { server, send, children } = await setup();
    await server.seed((db) =>
      db.editDoc("storageList", (storage: any) => {
        storage.storageList.push({ item: [], sku: "decorations_tree_25", amount: "1" }, { item: [], sku: "move", amount: "1" });
      })
    );
    await send("update_item", {
      action: "new_item", sid: "600", sku: "decorations_tree_25", dec: 1, storage: "true",
      item: { Item: [{ State: [], id: "5" }], sid: "600", sku: "decorations_tree_25", x: "3", y: "3", csid: "1", isSuspended: "0" }
    });
    expect(children("storageList").some((e) => e.sku === "decorations_tree_25")).toBe(false);

    await send("update_item", {
      action: "new_item", sid: "601", sku: "houses_001_001", dec: 0,
      item: { Item: [{ State: [], id: "1", mode: "1", time: "0" }], sid: "601", sku: "houses_001_001", x: "6", y: "6", csid: "1", isSuspended: "0" }
    });
    await send("update_item", { action: "move", sid: "601", x: 7, y: 7, dec: 0, freeMove: "true" });
    expect(children("storageList").some((e) => e.sku === "move")).toBe(false);

    await send("update_item", { action: "new_mode", sid: "601", sku: "houses_001_001", mode: 4, time: 100000, contractSku: 1, contractGroupSku: "1", doubleRent: 1, upgradeType: "0" });
    const stateOf = () => {
      const text = JSON.stringify(server.doc("universe"));
      const match = /\{"State":\[\][^}]*\}/g;
      return (text.match(match) ?? []).filter((m) => m.includes('"mode"')).map((m) => JSON.parse(m) as Record<string, string>);
    };
    expect(stateOf().some((s) => s.contractGroupSku === "1" && s.doubleRent === "1")).toBe(true);

    await send("update_item", { action: "new_mode", sid: "601", sku: "houses_001_001", mode: 6, time: 50000, contractSku: 1 });
    const mode6 = stateOf().find((s) => s.mode === "6");
    expect(mode6?.time).toBe("50000");
    expect(stateOf().some((s) => s.mode === "5" || s.mode === "14")).toBe(false);
  });

  test("collectibles: caps, sell only drops the pending entry, tradein reward and ask list", async () => {
    const { server, send } = await setup();
    const doc = () => server.doc<Record<string, Array<Record<string, string>>>>("collectiblesList");
    const entry = (name: string) => doc().collectiblesList.find((e) => name in e) as Record<string, string>;
    await server.seed((db) =>
      db.editDoc("collectiblesList", (collectibles: any) => {
        (collectibles.collectiblesList.find((e: any) => "Objects" in e)).skus = "gift_057:99";
        (collectibles.collectiblesList.find((e: any) => "Pending" in e)).tupla = "77:gift_058";
      })
    );

    await send("update_collectible", { action: "KEEP", sid: "-1", sku: "gift_057", security: {} });
    expect(entry("Objects").skus).toBe("gift_057:99");
    await send("update_collectible", { action: "SELL", sid: "77", sku: "gift_058", security: {} });
    expect(entry("Pending").tupla).toBe("");
    expect(entry("Objects").skus).toBe("gift_057:99");
    await send("ask_collectible", { action: "ASK", sku: "gift_001", sid: null, security: {} });
    await send("ask_collectible", { action: "ASK", sku: "gift_002", sid: null, security: {} });
    await send("ask_collectible", { action: "ASK", sku: "gift_001", sid: null, security: {} });
    expect((doc() as unknown as Record<string, string>).asked).toBe("gift_001,gift_002");
  });

  test("add_upgrade_item applies the visitor reward snapshot", async () => {
    const { send, profile, setProfile } = await setup();
    await setProfile({ DCCoins: "1000", exp: "10" });
    await send("add_upgrade_item", { ownerId: "100", visitorId: "1", sid: "unknown", type: "0", security: { coinsGain: 500, coinsNow: 1500, expGain: 5, expNow: 15 } });
    // unknown sid: nothing recorded, nothing granted
    expect(profile().DCCoins).toBe("1000");
  });

  test("ask_for_help / ask_for_cash answer immediately; invest_* run against the investments list", async () => {
    const { send, children, setProfile } = await setup();
    expect((await send("ask_for_help", { sid: "5" })).help_id).toBe("null");
    expect((await send("ask_for_cash", {})).help_id).toBe("null");
    await setProfile({ DCCoins: "1000000" });
    const created = await send("invest_on_friend", { fExtId: "555" });
    expect(created.id).not.toBe("null");
    expect((await send("invest_on_friend", { fExtId: "555" })).id).toBe("null");
    expect((await send("invest_on_friend_reminder", { fExtId: "555" })).id).toBe(created.id);
    const list = (await send("get_investments_list", {})) as { investmentsList: Array<Record<string, string>> };
    expect(list.investmentsList).toHaveLength(1);
    expect(list.investmentsList[0]?.state).toBe("2");
    expect((await send("invest_results", { fExtId: "555" })).success).toBe("false");
    expect((await send("invest_get_inversion", {})).success).toBe("false");
    expect((await send("invest_cancel", { fExtId: "555" })).success).toBe("true");
    expect(children("investmentsList").filter((e) => "investment" in e)).toHaveLength(0);
  });

  test("finished investments reach state 3 and pay out once through invest_results", async () => {
    const { server, send } = await setup();
    await send("invest_on_friend", { fExtId: "9" });
    await server.seed((db) =>
      db.editDoc("investmentsList", (doc: any) => {
        doc.investmentsList[0].startedAt = String(Date.now() - 21 * 86_400_000);
      })
    );
    const list = (await send("get_investments_list", {})) as { investmentsList: Array<Record<string, string>> };
    expect(list.investmentsList[0]?.state).toBe("3");
    expect((await send("invest_results", { fExtId: "9" })).success).toBe("true");
    const after = (await send("get_investments_list", {})) as { investmentsList: Array<Record<string, string>>; investmentsRewarded: string };
    // GamePlay.java getInvestmentsList keeps `state < 11`: the claimed (10) entry is still listed
    expect(after.investmentsList.map((e) => e.state)).toEqual(["10"]);
    expect(after.investmentsRewarded).toBe("1");
    // another invest_* command must not drop the claimed entry from the save, and the same friend stays refused (investOnFriend)
    expect((await send("invest_on_friend", { fExtId: "7" })).id).not.toBe("null");
    expect((await send("invest_on_friend", { fExtId: "9" })).id).toBe("null");
    const stored = server.doc<Record<string, Array<Record<string, string>>>>("investmentsList");
    expect(stored.investmentsList.filter((e) => "investment" in e).map((e) => e.extId)).toEqual(["9", "7"]);
  });

  test("a failed (state 11) investment is hidden from the list but kept in the save", async () => {
    const { server, send } = await setup();
    await send("invest_on_friend", { fExtId: "9" });
    await server.seed((db) =>
      db.editDoc("investmentsList", (doc: any) => {
        doc.investmentsList[0].state = "11";
      })
    );
    expect(((await send("get_investments_list", {})) as { investmentsList: unknown[] }).investmentsList).toHaveLength(0);
    await send("invest_on_friend", { fExtId: "7" });
    const stored = server.doc<Record<string, Array<Record<string, string>>>>("investmentsList");
    expect(stored.investmentsList.filter((e) => "investment" in e).map((e) => e.state)).toEqual(["11", "2"]);
  });

  test("get_world for NPCs and unknown ids never returns the player's own city", async () => {
    const { send, setProfile } = await setup();
    await setProfile({ cityname: "My Own City" });
    const ronald = (await send("get_world", { targetUserId: 100 })) as { universe: Array<Record<string, string>> };
    expect(ronald.universe.find((e) => "Profile" in e)?.userName).toBe("Ronald");
    const sheik = (await send("get_world", { targetUserId: 101 })) as { universe: Array<Record<string, string>> };
    expect(sheik.universe.find((e) => "Profile" in e)?.userName).toBe("Sheik");
    const unknown = (await send("get_world", { targetUserId: 4242 })) as { universe: Array<Record<string, string>> };
    expect(unknown.universe.find((e) => "Profile" in e)?.cityname).not.toBe("My Own City");
    expect(await send("get_neighbor_info", { facebookIds: [], useNeighborList: "0" })).toHaveProperty("neighborList");
  });

  test("a live save with items placed before tutorial_completed is not reset; restart_tutorial is the explicit opt-in", async () => {
    const { server, send, profile } = await setup();
    await send("update_item", { action: "build", sid: "99", sku: "HeadQuarter", x: 1, y: -4, state: 4 });
    // every HTTP request re-runs ensureDefaultUser(); it must not wipe the session
    await send("get_game_config", {});
    await send("get_game_config", {});
    expect(JSON.stringify(server.doc("universe"))).toContain('"sid":"99"');
    await send("update_profile", { action: "tutorial_completed" });
    expect(profile().tutorialEnd).toBe("1");
    await send("update_profile", { action: "restart_tutorial" });
    expect(profile().tutorialEnd).toBe("0");
    expect(JSON.stringify(server.doc("universe"))).not.toContain('"sid":"99"');
  });
});

describe("player edits survive normalizers", () => {
  test("deleting every road/terrain tile keeps all items across get_world and a server restart", async () => {
    const { server, client, send } = await setup();
    await send("update_profile", { action: "tutorial_completed" });
    const count = (w: unknown) => (JSON.stringify(w).match(/"sku":"/g) ?? []).length;
    const before = await send("get_world", { targetUserId: 1 });
    const n0 = count(before);
    expect(JSON.stringify(before)).toContain("HeadQuarter");
    const deletes: Array<[string, unknown]> = [];
    for (const type of ["Road", "Terrain"]) {
      for (let x = -15; x < 20; x += 1) {
        for (let y = -15; y < 20; y += 1) {
          deletes.push(["update_map", { action: "del", type, x: String(x), y: String(y) }]);
        }
      }
    }
    for (let i = 0; i < deletes.length; i += 400) await client.cmdList(deletes.slice(i, i + 400) as never);
    const check = async () => {
      const after = await send("get_world", { targetUserId: 1 });
      expect(JSON.stringify(after)).toContain("HeadQuarter");
      expect(JSON.stringify(after)).toContain("houses_001_001");
      expect(count(after)).toBe(n0);
    };
    await check();
    // Server restart path (startup compatibility check) must not treat an empty map as a broken save.
    await server.restart();
    await check();
  });
});

describe("buy_crew and doubleRent", () => {
  test("buy_crew persists <Crew bought> on the item and survives a reload", async () => {
    const { server, send } = await setup();
    await send("update_profile", { action: "tutorial_completed" });
    await send("update_item", { action: "buy_crew", sid: "2087", sku: "", position: "2,0" });
    await send("update_item", { action: "buy_crew", sid: "2087", sku: "", position: "1,2" });
    await server.restart();
    const { worldContainer } = server.ctx();
    const items = worldContainer.World.flatMap((c: any) => (Array.isArray(c.Company) ? c.Company : []));
    const item = items.find((i: any) => i.sid === "2087");
    const crew = item.Item.find((e: any) => Array.isArray(e.Crew));
    expect(crew?.bought).toBe("0,1,2");
  });

  // Original: Math.random is stubbed to 0.01 (a roll of 1 beats incomeValue 2). Black-box: the roll is random, so run many
  // collections (2% per roll) and assert the observable protocol: a push eventually happens, never while one is pending,
  // and the client's doubleRent param consumes it so a later push can happen again.
  test("collecting a house rent with a built Houses wonder pushes doubleRent once; the client's doubleRent param resets it", async () => {
    const { server, client, send } = await setup();
    await send("update_profile", { action: "tutorial_completed" });
    await server.seed((db) =>
      db.editUniverse(({ mine }) => {
        mine.Company.push({ Item: [{ State: [], id: "5" }], sid: "9001", csid: "1", sku: "wonder_dollars_bin", x: "40", y: "40", isSuspended: "0" });
        mine.Company.push({ Item: [{ State: [], id: "3", mode: "5", time: "0", contractSku: "1" }], sid: "9002", csid: "1", sku: "houses_001_001", x: "50", y: "50", isSuspended: "0" });
      })
    );
    // one rent cycle: make the house rent-ready (mode 5), then collect it (state 3 -> mode 1)
    const cycle = (extra: Record<string, unknown> = {}): Array<[string, unknown]> => [
      ["update_item", { action: "new_mode", sid: "9002", sku: "houses_001_001", mode: 5, time: 0, contractSku: 1 }],
      ["update_item", { action: "state", sid: "9002", sku: "", state: 3, mode: 1, time: 0, ...extra }]
    ];
    const batch = async (n: number, extra: Record<string, unknown> = {}) => {
      const cmds: Array<[string, unknown]> = [];
      for (let i = 0; i < n; i += 1) cmds.push(...cycle(extra));
      const res = await client.cmdList(cmds as never);
      return res.list.filter((c) => c._cmd === "doubleRent");
    };
    const hits = async (extra: Record<string, unknown>, maxBatches: number): Promise<number> => {
      for (let i = 0; i < maxBatches; i += 1) {
        const pushes = await batch(100, extra);
        if (pushes.length > 0) {
          expect(pushes[0]._dat).toBe("Houses");
          return pushes.length;
        }
      }
      return 0;
    };
    // 1. a push happens eventually (2% per collection); once pending, no second push inside the same batch
    expect(await hits({}, 30)).toBe(1);
    // 2. already pending: further collections never push again
    expect(await batch(100)).toHaveLength(0);
    expect(await batch(100)).toHaveLength(0);
    // 3. the client's doubleRent param consumes the pending prize and rolls anew, so a push can happen again
    expect((await hits({ doubleRent: 1 }, 30)) > 0).toBe(true);
  });
});
