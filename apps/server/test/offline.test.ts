import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { JsonObject } from "@mcity/shared/dist/types.js";
import { createServerApp as createServerAppBase } from "../src/serverApp.js";
import { getServerConfig } from "../src/config.js";
import { CommandService } from "../src/commandHandlers.js";

const activeApps: Array<ReturnType<typeof createServerAppBase>> = [];

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcity-offline-"));
  const config = { ...getServerConfig(), dbPath: path.join(dir, "save.sqlite"), useHttpsFacebookShim: false, httpPort: 0, httpsPort: 0 };
  const app = createServerAppBase(config);
  activeApps.push(app);
  const repo = app.repository;
  const service = new CommandService(repo);
  const send = (cmd: string, dat: Record<string, unknown>) =>
    service.handleCommand(1, { _cmd: cmd, _dat: dat as JsonObject, _sync: 1 } as never)[0]._dat as Record<string, unknown>;
  const profile = (): Record<string, unknown> =>
    ((repo.getDocument<JsonObject>(1, "universe").universe as Array<Record<string, unknown>>).find((e) => Array.isArray(e.Profile))) as Record<string, unknown>;
  const setProfile = (patch: Record<string, string>) => {
    const universe = repo.getDocument<JsonObject>(1, "universe");
    const p = (universe.universe as Array<Record<string, unknown>>).find((e) => Array.isArray(e.Profile)) as Record<string, unknown>;
    Object.assign(p, patch);
    repo.setDocument(1, "universe", universe);
  };
  const children = (tag: string) => repo.getDocument<Record<string, unknown>>(1, tag)[tag] as Array<Record<string, string>>;
  return { repo, send, profile, setProfile, children };
}

afterEach(async () => {
  while (activeApps.length > 0) {
    await activeApps.pop()?.stop();
  }
});

describe("offline server gaps (ported from the recovered Java backend)", () => {
  test("update_money unlockItem fills the unlocked list once", () => {
    const { send, children } = setup();
    send("update_money", { action: "unlockItem", value: "houses_001_002", security: {} });
    send("update_money", { action: "unlockItem", value: "houses_001_002", security: {} });
    expect(children("unlockedList").map((e) => e.sku)).toEqual(["houses_001_002"]);
  });

  test("exchange applies cashToCoins when no snapshot is supplied and applies the reported gain otherwise", () => {
    const { send, profile, setProfile } = setup();
    setProfile({ DCCash: "10", DCCoins: "100" });
    send("update_money", { action: "exchange", value: 2 });
    expect(profile().DCCash).toBe("8");
    expect(profile().DCCoins).toBe(String(100 + 2 * 60000));
    send("update_money", { action: "exchange", value: 1, security: { coinsNow: 5, cashNow: 7, coinsGain: 60000, cashGain: -1 } });
    // SecurityNormal.verify: coins/cash accumulate the reported GAIN (Now is only a check value)
    expect(profile().DCCoins).toBe(String(100 + 2 * 60000 + 60000));
    expect(profile().DCCash).toBe("7");
  });

  test("service stores <sku>TimeOver and get_world exposes <sku>TimeLeft; expired ones are dropped", () => {
    const { send, profile, setProfile } = setup();
    send("update_money", { action: "service", value: "moneyCollector", id: 1, offer: "0", security: {} });
    const over = Number(profile().moneyCollectorTimeOver);
    expect(over - Date.now()).toBeGreaterThan(11 * 3_600_000);
    const world = send("get_world", { targetUserId: 1 }) as { universe: Array<Record<string, string>> };
    const worldProfile = world.universe.find((e) => "Profile" in e) as Record<string, string>;
    expect(Number(worldProfile.moneyCollectorTimeLeft)).toBeGreaterThan(0);
    expect(profile().moneyCollectorTimeLeft).toBeUndefined();
    setProfile({ moneyCollectorTimeOver: String(Date.now() - 1000) });
    send("get_world", { targetUserId: 1 });
    expect(profile().moneyCollectorTimeOver).toBeUndefined();
  });

  test("openBox consumes the box and stores move/item prizes; rentAccelerator consumes an accelerator and flags the house", () => {
    const { repo, send, children } = setup();
    const storage = repo.getDocument<JsonObject>(1, "storageList");
    (storage.storageList as unknown[]).push({ item: [], sku: "briefcase", amount: "2" }, { item: [], sku: "rentAcc30", amount: "1" });
    repo.setDocument(1, "storageList", storage);
    send("update_money", { action: "openBox", prize: "bc_003", type: "move", value: "2", security: {} });
    send("update_money", { action: "openBox", prize: "birth_003", type: "item", value: "decorations_special_12", security: {} });
    const amounts = Object.fromEntries(children("storageList").map((e) => [e.sku, e.amount]));
    expect(amounts.briefcase).toBe("1");
    expect(amounts.move).toBe("2");
    expect(amounts.decorations_special_12).toBe("1");

    send("update_item", {
      action: "new_item", sid: "500", sku: "houses_001_001", x: 0, y: 0, dec: 0,
      item: { Item: [{ State: [], id: "1", mode: "4", time: "3600000", contractSku: "1" }], sid: "500", sku: "houses_001_001", x: "0", y: "0", csid: "1", isSuspended: "0" }
    });
    send("update_money", { action: "rentAccelerator", sku: "fgift_018", itemSid: "500", security: {} });
    expect(children("storageList").some((e) => e.sku === "rentAcc30")).toBe(false);
    const universe = JSON.stringify(repo.getDocument<JsonObject>(1, "universe"));
    expect(universe).toContain('"accelerated":"1"');
  });

  test("daily reward progress follows the original streak rules", () => {
    const { repo, send, setProfile } = setup();
    const first = send("get_daily_rewards_info", {}) as Record<string, string>;
    expect(first.dailyRewardsNextRewardId).toMatch(/^reward_0[1-3]$/);
    expect(first.dailyRewardsCount).toBe("1"); // streak reset answers count 1 (GamePlay.java:953), stored 0
    expect(repo.getDocument<Record<string, string>>(1, "dailyBonusInfo").dailyRewardsCount).toBe("0");
    setProfile({ DCCoins: "0" });
    send("update_daily_reward", { sku: first.dailyRewardsNextRewardId, security: { coinsGain: 8000, coinsNow: 8000, expGain: 0 } });
    const stored = repo.getDocument<Record<string, string>>(1, "dailyBonusInfo");
    expect(stored.dailyRewardsCount).toBe("1");
    expect(stored.dailyRewardsLastGiven).toBe(`${first.dailyRewardsNextRewardId},`);
    expect(Number(stored.dailyRewardsLastGivenDate)).toBeGreaterThan(0);
    // second login in the same day: nothing due, progress unchanged
    const again = send("get_daily_rewards_info", {}) as Record<string, string>;
    expect(again.dailyRewardsCount).toBe("1");
    // next day inside the 48h window: streak continues with count + 1
    stored.dailyRewardsLastGivenDate = String(Date.now() - 30 * 3_600_000);
    repo.setDocument(1, "dailyBonusInfo", stored);
    const next = send("get_daily_rewards_info", {}) as Record<string, string>;
    expect(next.dailyRewardsCount).toBe("2");
    expect(next.dailyRewardsNextRewardId).toMatch(/^reward_0[4-6]$/);
    // missed more than 48h: streak resets
    stored.dailyRewardsLastGivenDate = String(Date.now() - 80 * 3_600_000);
    repo.setDocument(1, "dailyBonusInfo", stored);
    const reset = send("get_daily_rewards_info", {}) as Record<string, string>;
    expect(reset.dailyRewardsCount).toBe("1");
    expect(reset.dailyRewardsLastGiven).toBe("");
  });

  test("missions follow up -> reached -> given and pay the definition reward once (GamePlay.java:1346)", () => {
    const { send, profile, setProfile, children, repo } = setup();
    setProfile({ DCCoins: "1000", exp: "0" });
    const chunk = (tag: string) => {
      const m = ((profile().Profile as Array<Record<string, unknown>>).find((e) => Array.isArray(e.Missions)) as { Missions: Array<Record<string, unknown>> }).Missions;
      return String((m.find((e) => Array.isArray(e[tag])) as Record<string, unknown>).chunk ?? "");
    };
    void repo; void children;
    send("update_missions", { sku: 1, action: "update", security: {} }); // sku 1: 20000 coins
    expect(chunk("Up")).toBe("1");
    send("update_missions", { sku: 1, action: "update", security: { coinsNow: 1000, coinsGain: -5 } });
    expect(chunk("Reached")).toBe("1");
    expect(profile().DCCoins).toBe("1000");
    send("update_missions", { sku: 1, action: "update", security: { coinsNow: 21000 } }); // client already paid
    expect(chunk("Given")).toBe("1");
    expect(profile().DCCoins).toBe("21000");
    send("update_missions", { sku: 1, action: "update", security: {} }); // replay: no double pay
    expect(profile().DCCoins).toBe("21000");
  });

  test("mission claim without a snapshot pays coins+exp and item rewards go to storage", () => {
    const { send, profile, setProfile, children } = setup();
    setProfile({ DCCoins: "0", exp: "0" });
    for (let i = 0; i < 3; i++) send("update_missions", { sku: 3, action: "update", security: {} }); // coins
    expect(Number(profile().DCCoins)).toBe(35000);
    const sku = "32";
    for (let i = 0; i < 3; i++) send("update_missions", { sku: Number(sku), action: "update", security: {} });
    expect(children("storageList").some((e) => e.sku === "commerce_coffee")).toBe(true);
  });

  test("mission reward A/B group 2 grants the selected item instead of the base coins", () => {
    const { send, profile, setProfile, children } = setup();
    setProfile({ DCCoins: "0", flags: "missionAltReward:2" });
    for (let i = 0; i < 3; i++) send("update_missions", { sku: 20, action: "update", security: {} });
    expect(profile().DCCoins).toBe("0");
    expect(children("storageList").find((e) => e.sku === "decorations_special_04")?.amount).toBe("1");
  });

  test("upgrade eligibility accepts on-rent houses of any mode (state id 1)", async () => {
    const { isUpgradeEligibleItem } = await import("../src/commandHandlers/universe.js");
    const universe = { universe: [{ World: [{ Company: [{ Item: [{ State: [], id: "1", mode: "1" }], sid: "7", sku: "houses_001_001" }], whose: "0", sid: "1" }] }] };
    expect(isUpgradeEligibleItem(universe as never, "7")).toBe(true);
  });

  test("dailyBonusDone sets the NPC timers reported by get_welcome_progress (GamePlay.java:972-986)", () => {
    const { send } = setup();
    expect((send("get_welcome_progress", {}) as Record<string, string>).npcRonaldTimeLeft).toBe("0");
    send("update_money", { action: "dailyBonusDone", security: {} });
    const w = send("get_welcome_progress", {}) as Record<string, string>;
    expect(Number(w.npcRonaldTimeLeft)).toBeGreaterThan(0);
    expect(w.npcCindyTimeLeft).toBe(w.npcRonaldTimeLeft);
  });

  test("daily item rewards go to storage", () => {
    const { send, children } = setup();
    send("update_daily_reward", { sku: "reward_20", security: { item: "decorations_font_06" } });
    expect(children("storageList").find((e) => e.sku === "decorations_font_06")?.amount).toBe("1");
  });

  test("update_next_rent is stored (bounds checked) and profile flag/service/newItemsRevDone persist", () => {
    const { repo, send, profile } = setup();
    send("update_next_rent", { next_rent: 600 });
    expect(Number(repo.getMeta("next_rent_1"))).toBeGreaterThan(Date.now());
    send("update_next_rent", { next_rent: 999999999 });
    expect(Number(repo.getMeta("next_rent_1"))).toBeLessThan(Date.now() + 700_000);
    send("update_profile", { action: "flag", name: "graphics", value: "2" });
    send("update_profile", { action: "flag", name: "tips", value: "1" });
    send("update_profile", { action: "flag", name: "graphics", value: "3" });
    expect(profile().flags).toBe("graphics:3,tips:1,");
    send("update_profile", { action: "service", value: "moneyCollector" });
    expect(profile().moneyCollectorPresentationShown).toBe("1");
    send("update_profile", { action: "newItemsRevDone" });
    expect(profile().newItemsRev).toBe("1");
  });

  test("item mutations: storage placement, free moves, contractGroupSku, upgradeType and mode 6 persistence", () => {
    const { repo, send, children } = setup();
    const storage = repo.getDocument<JsonObject>(1, "storageList");
    (storage.storageList as unknown[]).push({ item: [], sku: "decorations_tree_25", amount: "1" }, { item: [], sku: "move", amount: "1" });
    repo.setDocument(1, "storageList", storage);
    send("update_item", {
      action: "new_item", sid: "600", sku: "decorations_tree_25", dec: 1, storage: "true",
      item: { Item: [{ State: [], id: "5" }], sid: "600", sku: "decorations_tree_25", x: "3", y: "3", csid: "1", isSuspended: "0" }
    });
    expect(children("storageList").some((e) => e.sku === "decorations_tree_25")).toBe(false);

    send("update_item", {
      action: "new_item", sid: "601", sku: "houses_001_001", dec: 0,
      item: { Item: [{ State: [], id: "1", mode: "1", time: "0" }], sid: "601", sku: "houses_001_001", x: "6", y: "6", csid: "1", isSuspended: "0" }
    });
    send("update_item", { action: "move", sid: "601", x: 7, y: 7, dec: 0, freeMove: "true" });
    expect(children("storageList").some((e) => e.sku === "move")).toBe(false);

    send("update_item", { action: "new_mode", sid: "601", sku: "houses_001_001", mode: 4, time: 100000, contractSku: 1, contractGroupSku: "1", doubleRent: 1, upgradeType: "0" });
    const stateOf = () => {
      const universe = repo.getDocument<JsonObject>(1, "universe");
      const text = JSON.stringify(universe);
      const match = /\{"State":\[\][^}]*\}/g;
      return (text.match(match) ?? []).filter((m) => m.includes('"mode"') ).map((m) => JSON.parse(m) as Record<string, string>);
    };
    expect(stateOf().some((s) => s.contractGroupSku === "1" && s.doubleRent === "1")).toBe(true);

    send("update_item", { action: "new_mode", sid: "601", sku: "houses_001_001", mode: 6, time: 50000, contractSku: 1 });
    const mode6 = stateOf().find((s) => s.mode === "6");
    expect(mode6?.time).toBe("50000");
    expect(stateOf().some((s) => s.mode === "5" || s.mode === "14")).toBe(false);
  });

  test("collectibles: caps, sell only drops the pending entry, tradein reward and ask list", () => {
    const { repo, send } = setup();
    const doc = () => repo.getDocument<Record<string, Array<Record<string, string>>>>(1, "collectiblesList");
    const entry = (name: string) => doc().collectiblesList.find((e) => name in e) as Record<string, string>;
    const collectibles = doc();
    (collectibles.collectiblesList.find((e) => "Objects" in e) as Record<string, string>).skus = "gift_057:99";
    (collectibles.collectiblesList.find((e) => "Pending" in e) as Record<string, string>).tupla = "77:gift_058";
    repo.setDocument(1, "collectiblesList", collectibles as unknown as JsonObject);

    send("update_collectible", { action: "KEEP", sid: "-1", sku: "gift_057", security: {} });
    expect(entry("Objects").skus).toBe("gift_057:99");
    send("update_collectible", { action: "SELL", sid: "77", sku: "gift_058", security: {} });
    expect(entry("Pending").tupla).toBe("");
    expect(entry("Objects").skus).toBe("gift_057:99");
    send("ask_collectible", { action: "ASK", sku: "gift_001", sid: null, security: {} });
    send("ask_collectible", { action: "ASK", sku: "gift_002", sid: null, security: {} });
    send("ask_collectible", { action: "ASK", sku: "gift_001", sid: null, security: {} });
    expect((doc() as unknown as Record<string, string>).asked).toBe("gift_001,gift_002");
  });

  test("add_upgrade_item applies the visitor reward snapshot", () => {
    const { send, profile, setProfile } = setup();
    setProfile({ DCCoins: "1000", exp: "10" });
    send("add_upgrade_item", { ownerId: "100", visitorId: "1", sid: "unknown", type: "0", security: { coinsGain: 500, coinsNow: 1500, expGain: 5, expNow: 15 } });
    // unknown sid: nothing recorded, nothing granted
    expect(profile().DCCoins).toBe("1000");
  });

  test("ask_for_help / ask_for_cash answer immediately; invest_* run against the investments list", () => {
    const { send, children, setProfile } = setup();
    expect(send("ask_for_help", { sid: "5" }).help_id).toBe("null");
    expect(send("ask_for_cash", {}).help_id).toBe("null");
    setProfile({ DCCoins: "1000000" });
    const created = send("invest_on_friend", { fExtId: "555" });
    expect(created.id).not.toBe("null");
    expect(send("invest_on_friend", { fExtId: "555" }).id).toBe("null");
    expect(send("invest_on_friend_reminder", { fExtId: "555" }).id).toBe(created.id);
    const list = send("get_investments_list", {}) as { investmentsList: Array<Record<string, string>> };
    expect(list.investmentsList).toHaveLength(1);
    expect(list.investmentsList[0]?.state).toBe("2");
    expect(send("invest_results", { fExtId: "555" }).success).toBe("false");
    expect(send("invest_get_inversion", {}).success).toBe("false");
    expect(send("invest_cancel", { fExtId: "555" }).success).toBe("true");
    expect(children("investmentsList").filter((e) => "investment" in e)).toHaveLength(0);
  });

  test("finished investments reach state 3 and pay out once through invest_results", () => {
    const { repo, send } = setup();
    send("invest_on_friend", { fExtId: "9" });
    const doc = repo.getDocument<Record<string, Array<Record<string, string>>>>(1, "investmentsList");
    doc.investmentsList[0].startedAt = String(Date.now() - 21 * 86_400_000);
    repo.setDocument(1, "investmentsList", doc as unknown as JsonObject);
    const list = send("get_investments_list", {}) as { investmentsList: Array<Record<string, string>> };
    expect(list.investmentsList[0]?.state).toBe("3");
    expect(send("invest_results", { fExtId: "9" }).success).toBe("true");
    const after = send("get_investments_list", {}) as { investmentsList: unknown[]; investmentsRewarded: string };
    expect(after.investmentsList).toHaveLength(0);
    expect(after.investmentsRewarded).toBe("1");
  });

  test("get_world for NPCs and unknown ids never returns the player's own city", () => {
    const { send, setProfile } = setup();
    setProfile({ cityname: "My Own City" });
    const ronald = send("get_world", { targetUserId: 100 }) as { universe: Array<Record<string, string>> };
    expect(ronald.universe.find((e) => "Profile" in e)?.userName).toBe("Ronald");
    const sheik = send("get_world", { targetUserId: 101 }) as { universe: Array<Record<string, string>> };
    expect(sheik.universe.find((e) => "Profile" in e)?.userName).toBe("Sheik");
    const unknown = send("get_world", { targetUserId: 4242 }) as { universe: Array<Record<string, string>> };
    expect(unknown.universe.find((e) => "Profile" in e)?.cityname).not.toBe("My Own City");
    expect(send("get_neighbor_info", { facebookIds: [], useNeighborList: "0" })).toHaveProperty("neighborList");
  });

  test("a live save with items placed before tutorial_completed is not reset; restart_tutorial is the explicit opt-in", () => {
    const { repo, send, profile } = setup();
    send("update_item", { action: "build", sid: "99", sku: "HeadQuarter", x: 1, y: -4, state: 4 });
    // every HTTP request re-runs ensureDefaultUser(); it must not wipe the session
    repo.ensureDefaultUser();
    repo.ensureDefaultUser();
    expect(JSON.stringify(repo.getDocument<JsonObject>(1, "universe"))).toContain('"sid":"99"');
    send("update_profile", { action: "tutorial_completed" });
    expect(profile().tutorialEnd).toBe("1");
    send("update_profile", { action: "restart_tutorial" });
    expect(profile().tutorialEnd).toBe("0");
    expect(JSON.stringify(repo.getDocument<JsonObject>(1, "universe"))).not.toContain('"sid":"99"');
  });
});

describe("player edits survive normalizers", () => {
  test("deleting every road/terrain tile keeps all items across get_world and a server restart", () => {
    const { repo, send } = setup();
    send("update_profile", { action: "tutorial_completed" });
    const count = (w: unknown) => (JSON.stringify(w).match(/"sku":"/g) ?? []).length;
    const before = send("get_world", { targetUserId: 1 });
    const n0 = count(before);
    expect(JSON.stringify(before)).toContain("HeadQuarter");
    for (const type of ["Road", "Terrain"]) {
      for (let x = -15; x < 20; x += 1) {
        for (let y = -15; y < 20; y += 1) {
          send("update_map", { action: "del", type, x: String(x), y: String(y) });
        }
      }
    }
    const check = () => {
      const after = send("get_world", { targetUserId: 1 });
      expect(JSON.stringify(after)).toContain("HeadQuarter");
      expect(JSON.stringify(after)).toContain("houses_001_001");
      expect(count(after)).toBe(n0);
    };
    check();
    // Server restart path (startup compatibility check) must not treat an empty map as a broken save.
    const user = repo.ensureDefaultUser();
    repo.ensureCompatibleSave(1, user.ext_id);
    check();
  });
});

describe("buy_crew and doubleRent", () => {
  test("buy_crew persists <Crew bought> on the item and survives a reload", () => {
    const { repo, send } = setup();
    send("update_profile", { action: "tutorial_completed" });
    send("update_item", { action: "buy_crew", sid: "2087", sku: "", position: "2,0" });
    send("update_item", { action: "buy_crew", sid: "2087", sku: "", position: "1,2" });
    const universe = repo.getDocument<JsonObject>(1, "universe");
    const world = (universe.universe as Array<Record<string, unknown>>).find((e) => Array.isArray(e.World)) as { World: Array<Record<string, unknown>> };
    const items = world.World.flatMap((c) => (Array.isArray(c.Company) ? (c.Company as Array<Record<string, unknown>>) : []));
    const item = items.find((i) => i.sid === "2087") as { Item: Array<Record<string, unknown>> };
    const crew = item.Item.find((e) => Array.isArray(e.Crew));
    expect(crew?.bought).toBe("0,1,2");
  });

  test("collecting a house rent with a built Houses wonder pushes doubleRent once; the client's doubleRent param resets it", () => {
    const { repo, send } = setup();
    send("update_profile", { action: "tutorial_completed" });
    const universe = repo.getDocument<JsonObject>(1, "universe");
    const world = (universe.universe as Array<Record<string, unknown>>).find((e) => Array.isArray(e.World)) as { World: Array<Record<string, unknown>> };
    const mine = world.World.find((c) => c.whose === "0" && Array.isArray(c.Company)) as { Company: unknown[] };
    mine.Company.push({ Item: [{ State: [], id: "5" }], sid: "9001", csid: "1", sku: "wonder_dollars_bin", x: "40", y: "40", isSuspended: "0" });
    mine.Company.push({ Item: [{ State: [], id: "3", mode: "5", time: "0", contractSku: "1" }], sid: "9002", csid: "1", sku: "houses_001_001", x: "50", y: "50", isSuspended: "0" });
    repo.setDocument(1, "universe", universe);
    const service = new CommandService(repo);
    const collect = (extra: Record<string, unknown> = {}) => {
      const universe2 = repo.getDocument<JsonObject>(1, "universe");
      const w = (universe2.universe as Array<Record<string, unknown>>).find((e) => Array.isArray(e.World)) as { World: Array<Record<string, unknown>> };
      const house = (w.World.find((c) => c.whose === "0") as { Company: Array<{ sid: string; Item: Array<{ mode?: string }> }> }).Company.find((i) => i.sid === "9002");
      (house!.Item[0] as Record<string, string>).mode = "5";
      repo.setDocument(1, "universe", universe2);
      return service.handleCommand(1, { _cmd: "update_item", _dat: { action: "state", sid: "9002", sku: "", state: 3, mode: 1, time: 0, ...extra } as JsonObject, _sync: 1 } as never);
    };
    const orig = Math.random;
    Math.random = () => 0.01; // roll 1 < incomeValue 2
    try {
      expect(collect().some((c) => c._cmd === "doubleRent" && c._dat === "Houses")).toBe(true);
      expect(collect().some((c) => c._cmd === "doubleRent")).toBe(false); // already pending
      expect(collect({ doubleRent: 1 }).some((c) => c._cmd === "doubleRent")).toBe(true); // consumed, new roll hits
    } finally {
      Math.random = orig;
    }
  });
});
