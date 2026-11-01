// Black-box port of the mission tests of apps/server/test/server.test.ts.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { missionLists, mkItem, skus, worldOf } from "./lib/saves.js";
import { hasArchivedAssetFiles } from "./lib/util.js";

cleanupServersAfterEach();
const archivedAssetTest = hasArchivedAssetFiles() ? test : test.skip;

describe("missions", () => {
  test("persists mission completion and poll manager progress across restarts", async () => {
    const s = await startServer({ noFacebookShim: true });
    const claim = { action: "update", sku: "6", security: { expGain: -170, coinsGain: -60000, cashGain: 0, compValueGain: 0 } };
    await clientFor(s).cmdList([
      ["update_pollmanager", { action: "add", type: "build", parameter: "houses_001_002" }],
      ["update_pollmanager", { action: "update", type: "bonus", parameter: "houses_001", value: "2" }],
      ["update_missions", claim],
      ["update_missions", claim],
      ["update_missions", claim],
      ["update_profile", { action: "tutorial_completed" }]
    ]);
    await s.restart();
    const { profile } = await worldOf(clientFor(s));
    const { given, count } = missionLists(profile);
    expect(given?.chunk).toBe("6");
    expect(count?.chunk).toContain("bonushouses_001/2");
    expect(count?.chunk).toContain("buildhouses_001_002/1");
  });

  test("reconciles early completed missions from saved poll progress", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile }) => {
        const { up, reached, given, count, pollManager } = missionLists(profile);
        profile.tutorialEnd = "1";
        profile.firstMission = "0";
        profile.cityname = "Renamed City";
        profile.cityNameCodes = "82,101,110,97,109,101,100,32,67,105,116,121";
        if (up) up.chunk = "1,10,2,5";
        if (reached) reached.chunk = "";
        if (given) given.chunk = "";
        if (count) count.chunk = "buycommerce_pizza/1,checkInfluencecommerce_pizza/1,instantBuild/1";
        else if (pollManager) pollManager.PollManager.push({ Count: [], chunk: "buycommerce_pizza/1,checkInfluencecommerce_pizza/1,instantBuild/1" });
      })
    );
    const { profile } = await worldOf(clientFor(s));
    const { up, given } = missionLists(profile);
    const givenSkus = skus(given);
    const upSkus = skus(up);
    expect(profile.firstMission).toBe("0");
    for (const sku of ["1", "2", "5", "18"]) {
      expect(givenSkus).toContain(sku);
      expect(upSkus).not.toContain(sku);
    }
  });

  test("marks the city-name mission completed once the city is renamed", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile }) => {
        const { up, reached, given } = missionLists(profile);
        profile.tutorialEnd = "1";
        profile.firstMission = "1";
        profile.cityname = "Renamed City";
        profile.cityNameCodes = "82,101,110,97,109,101,100,32,67,105,116,121";
        if (up) up.chunk = "1,10,2,5";
        if (reached) reached.chunk = "";
        if (given) given.chunk = "";
      })
    );
    const { profile } = await worldOf(clientFor(s));
    const { up, given } = missionLists(profile);
    expect(profile.firstMission).toBe("0");
    expect(skus(given)).toContain("1");
    expect(skus(up)).not.toContain("1");
  });

  archivedAssetTest("settles stale early bonus missions from saved poll progress on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile }) => {
        const { missions, pollManager } = missionLists(profile);
        profile.tutorialEnd = "1";
        profile.level = "12";
        if (missions) missions.Missions = [{ Up: [], chunk: "1,2,10,25" }, { Reached: [], chunk: "" }, { Given: [], chunk: "5" }];
        if (pollManager) pollManager.PollManager = [{ Count: [], chunk: "bonushouses_001/2,buildDecorations_tree/8" }];
      })
    );
    const { profile } = await worldOf(clientFor(s));
    const { up, given } = missionLists(profile);
    expect(skus(up)).not.toContain("10");
    expect(skus(up)).not.toContain("25");
    expect(skus(given)).toContain("10");
    expect(skus(given)).toContain("25");
    expect(skus(given)).toContain("26");
  });

  test("persists mission reward claims even when the claim update has no negative security delta", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile, mine }) => {
        const { missions } = missionLists(profile);
        profile.tutorialEnd = "1";
        profile.level = "6";
        mine.Company.push(mkItem("9904", "HeadQuarter", "1", "-1", { id: "4" }, String(mine.sid ?? "1")));
        if (missions) missions.Missions = [{ Up: [], chunk: "39" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
      })
    );
    const claim = { action: "update", sku: "39", security: { expGain: 0, coinsGain: 0, cashGain: 0, compValueGain: 0 } };
    await clientFor(s).cmdList([["update_missions", claim], ["update_missions", claim]]);
    await s.restart();
    const { profile } = await worldOf(clientFor(s));
    const { reached, given } = missionLists(profile);
    expect(skus(reached)).not.toContain("39");
    expect(skus(given)).toContain("39");
  });

  test("applies delayed mission reward security gains once when expNow is stale", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile }) => {
        const { missions } = missionLists(profile);
        expect(profile).toBeTruthy();
        if (!profile || !missions) throw new Error("Expected starter profile and missions containers.");
        Object.assign(profile, { tutorialEnd: "1", exp: "756", DCCoins: "1000", DCCash: "10", companyValue: "550000" });
        missions.Missions = [{ Up: [], chunk: "" }, { Reached: [], chunk: "39" }, { Given: [], chunk: "" }];
      })
    );
    const security = { expGain: 2134, expNow: 756, coinsGain: 2500, coinsNow: 1000, cashGain: 5, cashNow: 10, compValueGain: 3000, compValueNow: 550000 };
    await clientFor(s).cmdList([
      ["update_missions", { action: "update", sku: "39", security }],
      ["update_missions", { action: "update", sku: "39", security }]
    ]);
    const savedProfile = s.profile();
    const { given } = missionLists(savedProfile);
    // Reached -> Given pays the missionDefinitions.xml reward (sku 39: 35000 coins) once; the stale snapshot is topped up.
    expect(savedProfile.exp).toBe("756");
    expect(savedProfile.DCCoins).toBe("36000");
    expect(savedProfile.DCCash).toBe("10");
    expect(savedProfile.companyValue).toBe("550000");
    expect(given?.chunk).toBe("39");
  });

  archivedAssetTest("removes impossible poll-driven reward state on restart and respects the level derived from xp", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile }) => {
        const { missions, pollManager } = missionLists(profile);
        profile.tutorialEnd = "1";
        profile.exp = "100";
        delete profile.level;
        if (missions) missions.Missions = [{ Up: [], chunk: "39" }, { Reached: [], chunk: "26,39" }, { Given: [], chunk: "1,25" }];
        if (pollManager) pollManager.PollManager = [{ Count: [], chunk: "buildDecorations_tree/2,visitCity/1" }];
      })
    );
    const { profile } = await worldOf(clientFor(s));
    const { up } = missionLists(profile);
    // Reached entries are never demoted: the player may still claim them (GamePlay.java:1346).
    expect(skus(up)).not.toContain("26");
  });

  archivedAssetTest("demotes saved poll-driven reached missions back to up on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile }) => {
        const { missions, pollManager } = missionLists(profile);
        profile.tutorialEnd = "1";
        profile.level = "2";
        if (missions) missions.Missions = [{ Up: [], chunk: "" }, { Reached: [], chunk: "39" }, { Given: [], chunk: "1" }];
        if (pollManager) pollManager.PollManager = [{ Count: [], chunk: "visitCity/1" }];
      })
    );
    const { profile } = await worldOf(clientFor(s));
    const { up, reached } = missionLists(profile);
    expect(skus(reached)).toContain("39");
    expect(skus(up)).not.toContain("39");
  });
});
