import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDefinitions, type ItemKind } from "@mcity/rules";
import { describe, expect, it } from "vitest";
import { checkProfileMissionEvents } from "../ui/missions/system";
import {
  MissionManager,
  STATE_GIVEN,
  STATE_LOCKED,
  STATE_REACHED,
  STATE_UNLOCKED,
  activeDefinitions,
  itemEventParameters,
  nameTypeOf,
  parseFlags,
  parseMissionDefinitions,
  parseRewards,
  rewardVariantDefinitions,
  type MissionHost,
  type RewardGain
} from "./missions";

const RULES = resolve(__dirname, "../../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/");
const read = (f: string): string => readFileSync(resolve(RULES, f), "utf8");
const ALL = parseMissionDefinitions(read("missionDefinitions.xml"));

interface Log {
  missions: Array<{ sku: number; claim?: RewardGain }>;
  polls: string[];
  paid: RewardGain[];
  items: string[];
  order: string[];
}

function makeHost(level = { v: 1 }): { host: MissionHost; log: Log } {
  const log: Log = { missions: [], polls: [], paid: [], items: [], order: [] };
  const host: MissionHost = {
    level: () => level.v,
    sendMission: (sku, claim) => {
      log.missions.push({ sku, claim });
      log.order.push(`send:${sku}${claim ? ":claim" : ""}`);
    },
    poll: (action, type, parameter, value) => log.polls.push([action, type, parameter, value ?? ""].join("|")),
    pay: (g) => {
      log.paid.push(g);
      log.order.push("pay");
    },
    addItem: (sku, amount) => log.items.push(`${sku}x${amount}`),
    npcCompanyValue: (i) => [0, 1_000_000, 50_000_000][i] ?? 0
  };
  return { host, log };
}

const EMPTY = { up: [], reached: [], given: [], pollCounts: {} };

describe("definitions", () => {
  it("parses all 318 definitions and splits the alt_missions A/B set", () => {
    expect(ALL).toHaveLength(318);
    expect(activeDefinitions(ALL, false)).toHaveLength(87);
    expect(activeDefinitions(ALL, true)).toHaveLength(231);
  });
  it("the starter Up chunk survives the default (non alt) filter", () => {
    const active = new Set(activeDefinitions(ALL, false).map((d) => d.sku));
    for (const sku of ["1", "2", "5", "10", "18", "31"]) expect(active.has(sku)).toBe(true);
  });
  it("parses rewards", () => {
    expect(parseRewards("coins;exp", "3530000;2500")).toEqual([
      { kind: "coins", amount: 3530000 },
      { kind: "exp", amount: 2500 }
    ]);
    expect(parseRewards("commerce_coffee", "1")).toEqual([{ kind: "item", amount: 1, sku: "commerce_coffee" }]);
  });
  it("selects mission reward variants from the profile A/B group", () => {
    const mission = ALL.find((d) => d.sku === "20")!;
    expect(mission.rewards).toEqual([{ kind: "coins", amount: 60000 }]);
    expect(rewardVariantDefinitions([mission], 0)[0].rewards).toEqual(mission.rewards);
    expect(rewardVariantDefinitions([mission], 1)[0].rewards).toEqual([
      { kind: "coins", amount: 105000 },
      { kind: "exp", amount: 170 }
    ]);
    expect(rewardVariantDefinitions([mission], 2)[0].rewards).toEqual([
      { kind: "item", amount: 1, sku: "decorations_special_04" }
    ]);
  });
  it("flags", () => expect(parseFlags("altMissions:1,x,y:0")).toEqual({ altMissions: 1, x: 1, y: 0 }));

  it("every event parameter resolves to an item nameType / subtype key / sku", () => {
    const files: Array<[string, ItemKind]> = [
      ["itemDefinitions.xml", "houses"],
      ["commerceDefinitions.xml", "commerce"],
      ["decorationDefinitions.xml", "decoration"],
      ["wonderDefinitions.xml", "other"],
      ["clubDefinitions.xml", "other"]
    ];
    const keys = new Set<string>();
    for (const [file] of files) for (const m of read(file).matchAll(/subsku="([^"]*)"/g)) keys.add(m[1]);
    for (const [file, kind] of files) {
      for (const d of parseDefinitions(read(file), kind)) {
        for (const p of itemEventParameters(nameTypeOf(kind, d.sku), d.sku, d.subtype)) keys.add(p);
      }
    }
    const itemTypes = new Set(["build", "buy", "sell", "collect", "collectUpgraded", "upgrade", "moveHouse", "checkInfluence", "bonus"]);
    const missing = ALL.filter((d) => itemTypes.has(d.eventType) && d.eventParameter !== "")
      .map((d) => d.eventParameter.split("%")[0])
      .filter((p) => !keys.has(p));
    // `bonus houses_001` (Pimp the House) matches no sku/subsku in the shipped item rules: those can never progress (needs influence anyway).
    expect([...new Set(missing)]).toEqual(["houses_001"]);
  });
});

describe("MissionManager state machine", () => {
  const defs = activeDefinitions(ALL, false);

  it("loading from persistence sends nothing and keeps states", () => {
    const { host, log } = makeHost({ v: 1 });
    const m = new MissionManager(host, defs);
    m.build({ up: ["1", "2"], reached: ["5"], given: ["10"], pollCounts: {} });
    expect(log.missions).toEqual([]); // build() itself never sends (MissionObject.as:56 overrides oldState)
    expect(log.polls).toEqual([]);
    m.update();
    // update() may unlock locked missions whose prerequisite is persisted as given (a LOCKED->UP send), never a claim.
    expect(log.missions.every((x) => x.claim === undefined)).toBe(true);
    expect(m.getMissionBySku("1")?.state).toBe(STATE_UNLOCKED);
    expect(m.getMissionBySku("5")?.state).toBe(STATE_REACHED);
    expect(m.getMissionBySku("10")?.state).toBe(STATE_GIVEN);
    expect(m.getMissionBySku("6")?.state).toBe(STATE_LOCKED); // level 2 required
  });

  it("unlock by level then by prerequisite sends update_missions once per transition", () => {
    const level = { v: 1 };
    const { host, log } = makeHost(level);
    const m = new MissionManager(host, defs);
    m.build({ ...EMPTY, up: ["1"] });
    m.update();
    // Everything with unlockLevel <= 1 that has no prerequisite unlocks on the first update (sku 1 was persisted: no send).
    const first = log.missions.map((x) => x.sku);
    expect(first).not.toContain(1);
    expect(first).toContain(2);
    expect(first).toContain(5);
    expect(log.missions.every((x) => x.claim === undefined)).toBe(true);
    const before = log.missions.length;
    m.update();
    expect(log.missions.length).toBe(before); // idempotent
    level.v = 2;
    m.update();
    expect(log.missions.map((x) => x.sku)).toContain(6);
  });

  it("reaching a mission: reached send, reward paid, then GIVEN send with the negative delayed claim", () => {
    const { host, log } = makeHost({ v: 1 });
    const m = new MissionManager(host, defs);
    m.build({ ...EMPTY, up: ["6"] }); // 6: build houses_001_002, 60000 coins
    m.update();
    const reached: string[] = [];
    m.on("reached", (o) => reached.push(o.def.sku));
    log.order.length = 0;
    log.missions.length = 0;
    const def = m.getMissionBySku("6")!.def;
    expect(def.eventType).toBe("build");
    m.register("build", def.eventParameter);
    m.update();
    expect(reached).toEqual(["6"]);
    expect(log.order).toEqual(["send:6", "pay", "send:6:claim"]);
    expect(log.paid).toEqual([{ coins: 60000, exp: 0, cash: 0 }]);
    // GameCommands.mission negates the claim: delayed payment = -reward -> coinsGain = +reward.
    expect(log.missions[1].claim).toEqual({ coins: -60000, exp: 0, cash: 0 });
    expect(m.getMissionBySku("6")?.state).toBe(STATE_GIVEN);
    expect(m.persistence().given).toContain("6");
    expect(log.polls).toEqual([`add|build|${def.eventParameter}|`]);
  });

  it("item and exp rewards: items go to storage, exp is paid", () => {
    const { host, log } = makeHost({ v: 2 });
    const m = new MissionManager(host, ALL.filter((d) => ["32", "132"].includes(d.sku)));
    m.build({ ...EMPTY, up: ["32"] });
    m.update();
    const d = m.getMissionBySku("32")!.def;
    expect(d.rewards[0]).toMatchObject({ kind: "item", sku: "commerce_coffee" });
    for (let i = 0; i < d.eventAmount; i += 1) m.register("collect", d.eventParameter);
    m.update();
    expect(log.items).toEqual(["commerce_coffeex1"]);
    expect(m.getMissionBySku("32")?.state).toBe(STATE_GIVEN);
  });

  it("a persisted REACHED mission is claimed with the button (applyReward)", () => {
    const { host, log } = makeHost({ v: 1 });
    const m = new MissionManager(host, defs);
    m.build({ ...EMPTY, reached: ["2"] });
    m.update();
    expect(log.missions.find((x) => x.sku === 2)).toBeUndefined();
    m.claim(m.getMissionBySku("2")!);
    const claims = log.missions.filter((x) => x.sku === 2);
    expect(claims).toHaveLength(1);
    expect(claims[0].claim?.coins).toBe(-35000);
    m.update();
    expect(log.missions.filter((x) => x.sku === 2)).toHaveLength(1); // queue duplicate is a no-op
    expect(m.getMissionsGivenCount()).toBe(1);
  });

  it("counters resume from the persisted Count chunk and progress is shown", () => {
    const { host } = makeHost({ v: 1 });
    const m = new MissionManager(host, defs);
    m.build({ ...EMPTY, up: ["32"], pollCounts: { "collectcommerce_pizza": "3" } });
    const o = m.getMissionBySku("32")!;
    expect(o.progressAsString()).toBe("3/5");
    expect(o.progressAsPercentage()).toBe(60);
  });

  it("condition events (earn): one update per reached condition, progress string = leading satisfied", () => {
    const { host, log } = makeHost({ v: 10 });
    const m = new MissionManager(host, defs);
    m.build(EMPTY);
    m.update();
    m.poll.checkEvent("earnDCCoins", 999_999);
    expect(log.polls.filter((p) => p.startsWith("update|earn|DCCoins"))).toEqual([]);
    m.poll.checkEvent("earnDCCoins", 1_000_000);
    expect(log.polls).toContain("update|earn|DCCoins|1");
    m.update();
    expect(m.getMissionBySku("43")?.state).toBe(STATE_GIVEN);
  });

  it("checks saved profile thresholds at startup, then handles a reward crossing another threshold", () => {
    const { host, log } = makeHost({ v: 20 });
    const m = new MissionManager(host, defs);
    m.build({ ...EMPTY, up: ["43", "44"] });
    checkProfileMissionEvents(m, { coins: 990_000, cash: 0, companyValue: 1_362_000 });
    m.update(); // company-value mission 44 reaches and pays 35,000 coins
    expect(m.getMissionBySku("44")?.state).toBe(STATE_GIVEN);
    checkProfileMissionEvents(m, { coins: 1_025_000, cash: 0, companyValue: 1_397_000 });
    m.update(); // the reward's profile update makes mission 43 eligible
    expect(m.getMissionBySku("43")?.state).toBe(STATE_GIVEN);
    expect(log.paid).toEqual([
      { coins: 35_000, exp: 0, cash: 0 },
      { coins: 35_000, exp: 0, cash: 0 }
    ]);
  });

  it("shared condition events preserve definition order and duplicate thresholds", () => {
    const { host, log } = makeHost({ v: 1 });
    const source = ALL.find((d) => d.eventType === "earn")!;
    const defs = [10, 3, 10].map((condition, i) => ({
      ...source,
      sku: String(i + 1),
      eventType: "earn",
      eventParameter: "test",
      eventCondition: condition,
      eventAmount: 1,
      unlockLevel: 1,
      unlockSku: ""
    }));
    const m = new MissionManager(host, defs);
    m.build(EMPTY);
    const event = m.poll.getEvent("earntest")!;
    expect(Array.from({ length: event.conditionCount }, (_, i) => event.getCondition(i))).toEqual([10, 3, 10]);
    expect(event.idByCondition(10)).toBe(0); // PollEvent.getIdByCondition returns the first match.
    m.update();
    m.poll.checkEvent("earntest", 10);
    expect(event.progressAsString()).toBe("3");
    expect(log.polls).toEqual([
      "update|earn|test|1",
      "update|earn|test|2",
      "update|earn|test|3"
    ]);
  });

  it("panel list: reached first, then up, then locked previews up to 6", () => {
    const { host } = makeHost({ v: 1 });
    const m = new MissionManager(host, defs);
    m.build({ ...EMPTY, up: ["1", "2"], reached: ["5"] });
    m.update();
    const list = m.getMissions();
    expect(list[0].def.sku).toBe("5");
    expect(list.length).toBeLessThanOrEqual(6 + 1);
    expect(list.length).toBeGreaterThanOrEqual(3);
  });

  it("beat conditions resolve to the NPC company value", () => {
    const { host } = makeHost({ v: 1 });
    const m = new MissionManager(host, ALL.filter((d) => d.eventType === "beat" && d.showInABTest === undefined));
    m.build(EMPTY);
    expect(m.getMissionBySku("56")?.def.eventCondition).toBe(50_000_000);
  });
});
