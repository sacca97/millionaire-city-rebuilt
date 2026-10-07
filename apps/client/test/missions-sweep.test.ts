// Synthetic sweep: drives EVERY mission definition (318: 87 default + 231 alt) through the state machine with synthetic events and
// asserts the transitions, commands, reward payment (three reward groups), no double payment and reload behaviour.
// Evidence level: OUR implementation only. It does not prove the original behaves the same (that is the oracle's job, per mechanism
// class: see docs/missions-classes.md). It catches data/parsing/threshold errors on all rows in seconds.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MissionManager,
  NO_CONDITION,
  STATE_GIVEN,
  STATE_UNLOCKED,
  activeDefinitions,
  parseMissionDefinitions,
  parseRewards,
  rewardVariantDefinitions,
  eventSku,
  type MissionDef,
  type MissionHost,
  type MissionReward,
  type RewardGain
} from "../src/game/missions";

const XML = resolve(__dirname, "../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/missionDefinitions.xml");
const ALL = parseMissionDefinitions(readFileSync(XML, "utf8"));

interface Log {
  sends: Array<{ sku: number; claim?: RewardGain }>;
  paid: RewardGain[];
  items: string[];
}

function makeHost(): { host: MissionHost; log: Log } {
  const log: Log = { sends: [], paid: [], items: [] };
  const host: MissionHost = {
    level: () => 1000,
    sendMission: (sku, claim) => log.sends.push({ sku, claim }),
    poll: () => undefined,
    pay: (g) => log.paid.push(g),
    addItem: (sku, amount) => log.items.push(`${sku}x${amount}`),
    npcCompanyValue: () => 1_000_000
  };
  return { host, log };
}

/** Reward the data says for a group (independent of rewardVariantDefinitions): group 1 -> ABtest1, group 2 -> ABtest2 (else base). */
function expectedRewards(d: MissionDef, group: number): MissionReward[] {
  if (group === 1 && d.rewardTypeABTest1) return parseRewards(d.rewardTypeABTest1, d.rewardAmountABTest1 ?? "");
  if (group === 2 && d.rewardTypeABTest2) return parseRewards(d.rewardTypeABTest2, d.rewardAmountABTest2 ?? "");
  return parseRewards(d.rewardType, d.rewardAmount);
}

function sums(r: MissionReward[]): { coins: number; exp: number; items: string[] } {
  return {
    coins: r.filter((x) => x.kind === "coins").reduce((a, x) => a + x.amount, 0),
    exp: r.filter((x) => x.kind === "exp").reduce((a, x) => a + x.amount, 0),
    items: r.filter((x) => x.kind === "item").map((x) => `${(x as { sku: string }).sku}x${x.amount}`)
  };
}

/** Feed the events a mission needs, the way the game would (counter events: `amount` registrations; condition events: a big value). */
function drive(m: MissionManager, d: MissionDef): void {
  if (d.eventParameter === "Friend") return; // reached on update (MissionObject.logicUpdate :171)
  if (d.eventCondition > NO_CONDITION || d.eventType === "beat") {
    m.poll.checkEvent(eventSku(d), 1e12);
  } else {
    for (let i = 0; i < Math.max(1, d.eventAmount); i += 1) m.register(d.eventType, d.eventParameter);
  }
  m.update();
  m.update();
}

describe("synthetic sweep over all mission definitions", () => {
  const sets: Array<[string, boolean]> = [["default", false], ["alt", true]];
  for (const [setName, alt] of sets) {
    const base = activeDefinitions(ALL, alt);
    describe(`${setName} set (${base.length})`, () => {
      for (const group of [0, 1, 2]) {
        const defs = rewardVariantDefinitions(base, group);
        for (const d of defs) {
          // Missions without a trigger can never progress by events (known data quirk); they are listed, not driven.
          const driven = d.eventAmount > 0 && d.eventType !== "informative";
          const title = `${d.sku} ${d.eventType} ${d.eventParameter || "-"} g${group}`;
          it(driven ? title : `${title} (no trigger: not drivable)`, () => {
            const { host, log } = makeHost();
            // Isolated: only this mission is loaded, so shared counters/chains cannot pay other missions inside the assertions.
            // Multi-mission interaction (chains, shared earn thresholds) is covered by the full-set test below.
            const m = new MissionManager(host, [d]);
            m.build({ up: [d.sku], reached: [], given: [], pollCounts: {} });
            m.update();
            const obj = m.getMissionBySku(d.sku)!;
            expect(obj.state, "mission starts unlocked from the Up list").toBe(STATE_UNLOCKED);
            if (!driven) return;
            log.sends.length = 0;
            drive(m, d);
            // The sweep only claims what OUR machine does: reached send, pay, given send with the negative delayed claim.
            const mine = log.sends.filter((x) => x.sku === Number(d.sku));
            expect(mine.length, `sends for ${d.sku}`).toBe(2);
            expect(mine[0].claim, "first send is the REACHED update").toBeUndefined();
            const exp = sums(expectedRewards(ALL.find((x) => x.sku === d.sku)!, group));
            // Item-only rewards pay no coins; coins/exp are sent as negative delayed payment.
            expect(0 - (mine[1].claim?.coins ?? 0) + 0, "claim coins").toBe(exp.coins);
            expect(0 - (mine[1].claim?.exp ?? 0) + 0, "claim exp").toBe(exp.exp);
            expect(log.items.sort(), "item rewards").toEqual(exp.items.sort());
            expect(obj.state).toBe(STATE_GIVEN);
            // No double payment on further updates / repeated events.
            const sendsBefore = log.sends.length;
            m.update();
            expect(log.sends.length).toBe(sendsBefore);
            // Reload: persisted lists restore GIVEN and send nothing.
            const saved = m.persistence();
            const counts: Record<string, string> = {};
            for (const e of m.poll.persistence()) {
              const [k, v] = e.split("/");
              counts[k] = v;
            }
            const { host: host2, log: log2 } = makeHost();
            const m2 = new MissionManager(host2, [d]);
            m2.build({ ...saved, pollCounts: counts });
            m2.update();
            expect(m2.getMissionBySku(d.sku)?.state, "state after reload").toBe(STATE_GIVEN);
            expect(log2.sends.filter((x) => x.sku === Number(d.sku) && x.claim !== undefined)).toEqual([]);
          });
        }
      }
    });
  }
});

describe("full-set run: chains and shared counters", () => {
  for (const [setName, alt] of [["default", false], ["alt", true]] as Array<[string, boolean]>) {
    it(`${setName}: every drivable mission ends GIVEN exactly once, reload keeps it`, () => {
      const defs = activeDefinitions(ALL, alt);
      const { host, log } = makeHost();
      const m = new MissionManager(host, defs);
      m.build({ up: [], reached: [], given: [], pollCounts: {} });
      m.update();
      for (let pass = 0; pass < 40; pass += 1) {
        let progressed = false;
        for (const o of m.getMissionsAll()) {
          if (o.state !== STATE_UNLOCKED) continue;
          const before = m.getMissionsGivenCount();
          drive(m, o.def);
          if (m.getMissionsGivenCount() !== before) progressed = true;
        }
        m.update();
        if (!progressed) break;
      }
      // Missions that cannot be completed by synthetic events alone: not drivable (no trigger) or locked behind them.
      const notGiven = m.getMissionsAll().filter((o) => o.state !== STATE_GIVEN).map((o) => o.def.sku).sort((a, b) => Number(a) - Number(b));
      const claims = log.sends.filter((x) => x.claim !== undefined);
      const claimedSkus = claims.map((x) => x.sku);
      expect(new Set(claimedSkus).size, "each mission is claimed once").toBe(claimedSkus.length);
      expect(claimedSkus.length + notGiven.length).toBe(defs.length);
      // Snapshot of the missions that stay open; any change here must be explained (data quirk, missing emitter or logic change).
      expect(notGiven).toMatchSnapshot();
      const saved = m.persistence();
      const { host: h2, log: l2 } = makeHost();
      const m2 = new MissionManager(h2, defs);
      m2.build({ ...saved, pollCounts: {} });
      m2.update();
      expect(l2.sends.filter((x) => x.claim !== undefined)).toEqual([]);
      expect(m2.getMissionsGivenCount()).toBe(m.getMissionsGivenCount());
    });
  }
});
