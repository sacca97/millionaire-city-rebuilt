// Offline NPC friends (Ronald, Cindy, Sheik); see docs/rust-server-friends.md.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { httpsGet, request } from "./lib/http.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";

cleanupServersAfterEach();

const NPC_IDS = ["100000000000101", "100000000000102", "100000000000103"];
const ORIGINAL_NPCS_EXT_ID = ["100001135295884", "100001188295998", "100001211196508"]; // FriendsManager.as:36, dropped by the client
const describeRust = describe;

async function setup(env: Record<string, string> = {}) {
  const server = await startServer({ env });
  const client = clientFor(server);
  await client.login();
  await server.seed((db) => db.editUniverse(({ profile }) => void Object.assign(profile, { tutorialEnd: "1", bossGenre: "1", exp: "6000", DCCoins: "500000" })));
  const send = (cmd: string, dat: Record<string, unknown> = {}): Promise<Record<string, any>> => client.send(cmd, dat);
  const post = (p: string) => request(`${server.httpUrl}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return { server, client, send, post };
}

const house = (sid: string, mode = "5") => ({ Item: [{ State: [], id: "1", mode }], sid, csid: "1", sku: "houses_001_001", x: String(40 + Number(sid)), y: "40", isSuspended: "0" });

describeRust("offline NPC friends (Rust server)", () => {
  test("Facebook shim: /me/friends with the client's access_token lists the three NPCs, never the original NPCS_EXT_ID; a bare probe stays empty", async () => {
    const { server } = await setup();
    const get = (p: string) => httpsGet(`${server.facebookUrl}${p}`);
    const friends = JSON.parse((await get("/me/friends?access_token=local-oauth-token")).text);
    expect(friends.data.map((f: any) => f.id)).toEqual(NPC_IDS);
    for (const id of NPC_IDS) expect(ORIGINAL_NPCS_EXT_ID).not.toContain(id);
    expect(JSON.parse((await get("/me/friends")).text)).toEqual({ data: [] });
    expect(JSON.parse((await get("/method/friends.getAppUsers?access_token=x")).text)).toEqual([]);
  });

  test("Facebook shim: users.getInfo names the NPC friends from NPCDefinitions.xml, their picture is the NPC png", async () => {
    const { server } = await setup();
    const res = await httpsGet(`${server.facebookUrl}/method/users.getInfo?uids=${NPC_IDS.join(",")},${server.uid}`);
    const info = JSON.parse(res.text);
    expect(info.map((e: any) => e.first_name)).toEqual(["Ronald", "Cindy", "Sheik", "Mayor"]);
    expect(info[2].pic_square).toBe(`https://graph.facebook.com/${NPC_IDS[2]}/picture`);
    const pic = await httpsGet(`${server.facebookUrl}/${NPC_IDS[2]}/picture`);
    expect(pic.headers.get("content-type")).toBe("image/png");
    expect(pic.body.subarray(1, 4).toString()).toBe("PNG");
  });

  test("visiting an NPC city: get_world for 100 (Cindy/Ronald) and 101 (Sheik) answers their cities, never the player's", async () => {
    const { send } = await setup();
    const cindy = (await send("get_world", { targetUserId: 100 })) as { universe: Array<Record<string, any>> };
    const sheik = (await send("get_world", { targetUserId: 101 })) as { universe: Array<Record<string, any>> };
    const name = (u: { universe: Array<Record<string, any>> }) => (u.universe.find((e) => Array.isArray(e.Profile)) as any).userName;
    expect([name(cindy), name(sheik)]).toEqual(["Cindy", "Sheik"]);
  });

  test("visitor upgrade in an NPC city (add_upgrade_item) is capped per visitor and day; MCITY_UPGRADES_PER_DAY raises the cap", async () => {
    const { send } = await setup({ MCITY_UPGRADES_PER_DAY: "7" });
    const sheik = (await send("get_world", { targetUserId: 101 })) as { universe: Array<Record<string, any>> };
    const world = sheik.universe.find((e) => Array.isArray(e.World)) as any;
    const mine = world.World.find((e: any) => Array.isArray(e.Company) && e.whose === "0");
    const renting = mine.Company.filter((i: any) => i.sku?.startsWith("houses_") && i.Item?.[0]?.id === "1").map((i: any) => i.sid);
    expect(renting.length).toBeGreaterThanOrEqual(8);
    for (const sid of renting.slice(0, 8)) await send("add_upgrade_item", { ownerId: 101, visitorId: 1, sid, type: "1" });
    const list = (await send("get_upgrades_list", { userId: 101 })) as { upgradesUniverseAvailable: string; upgradesList: Array<Record<string, string>> };
    expect(list.upgradesList).toHaveLength(7);
    expect(list.upgradesUniverseAvailable).toBe("0");
  });

  test("own city (get_world): each NPC friend upgrades up to 5 of the player's houses a day (sid order, Ronald first); collecting clears the record for the day", async () => {
    const { server, send } = await setup();
    await send("update_profile", { action: "tutorial_completed" });
    await server.seed((db) => db.editUniverse(({ mine }) => void mine.Company.push(...Array.from({ length: 12 }, (_, i) => house(String(9000 + i))))));
    await send("get_world", { targetUserId: 1 }); // the NPC friends visit when the own city loads (the boot cmdList sends get_upgrades_list right after)
    const list = (await send("get_upgrades_list", { userId: 1 })) as { upgradesList: Array<Record<string, string>> };
    // the starter save already owns one house on rent (first in document order), plus the 12 seeded
    expect(list.upgradesList).toHaveLength(13);
    expect(list.upgradesList.slice(0, 5).map((e) => e.extId)).toEqual(Array(5).fill(NPC_IDS[0]));
    expect(list.upgradesList.slice(5, 10).map((e) => e.extId)).toEqual(Array(5).fill(NPC_IDS[1]));
    expect(list.upgradesList.slice(10).map((e) => e.extId)).toEqual(Array(3).fill(NPC_IDS[2]));
    expect(list.upgradesList.slice(1).map((e) => e.sid)).toEqual(Array.from({ length: 12 }, (_, i) => String(9000 + i)));
    // the rent of 9000 is collected with the upgrade applied: the record goes away and the house is not upgraded again today
    await send("update_item", { action: "new_mode", sid: "9000", mode: 4, time: 1, upgradeType: "0", security: {} });
    await send("get_world", { targetUserId: 1 });
    const after = (await send("get_upgrades_list", { userId: 1 })) as { upgradesList: Array<Record<string, string>> };
    expect(after.upgradesList.map((e) => e.sid)).not.toContain("9000");
    expect(after.upgradesList).toHaveLength(12);
  });

  test("own city: only houses get NPC upgrades (a commerce on rent gets none)", async () => {
    const { server, send } = await setup();
    await send("update_profile", { action: "tutorial_completed" });
    await server.seed((db) => db.editUniverse(({ mine }) => void mine.Company.push({ ...house("9100"), sku: "commerce_bank" })));
    await send("get_world", { targetUserId: 1 });
    const sids = ((await send("get_upgrades_list", { userId: 1 })) as any).upgradesList.map((e: any) => e.sid);
    expect(sids).not.toContain("9100");
  });

  test("the launcher page hook is served (the launcher page itself stays byte-identical, routes.conf golden)", async () => {
    const { server } = await setup();
    const js = await request(`${server.httpUrl}/local/npc-friends.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.text).toContain("investmentRequest");
    expect(js.text).toContain("/local/npc-invest");
  });

  test("POST /local/npc-invest: the three NPC friends accept at once, once; claimed ones can be invested in again; results pay out", async () => {
    const { server, send, post } = await setup();
    const first = JSON.parse((await post("/local/npc-invest")).text);
    expect(first).toEqual({ ok: true, created: 3, extIds: NPC_IDS });
    expect(JSON.parse((await post("/local/npc-invest")).text).created).toBe(0);
    const list = (await send("get_investments_list")) as { investmentsStarted: string; investmentsList: Array<Record<string, string>> };
    expect(list.investmentsList.map((e) => [e.extId, e.state, e.userId])).toEqual(NPC_IDS.map((id) => [id, "2", "-1"]));
    expect(list.investmentsStarted).toBe("3");
    // time passes (seeded): running -> finished -> claim
    await server.seed((db) => db.editDoc("investmentsList", (doc: any) => void doc.investmentsList.forEach((e: any) => { if (e.investment) e.startedAt = String(Date.now() - 21 * 86_400_000); })));
    const done = (await send("get_investments_list")) as { investmentsList: Array<Record<string, string>> };
    expect(done.investmentsList.map((e) => e.state)).toEqual(["3", "3", "3"]);
    expect((await send("invest_results", { fExtId: NPC_IDS[0] })).success).toBe("true");
    const again = JSON.parse((await post("/local/npc-invest")).text);
    expect(again).toEqual({ ok: true, created: 1, extIds: [NPC_IDS[0]] });
    const final = (await send("get_investments_list")) as { investmentsStarted: string; investmentsRewarded: string; investmentsList: Array<Record<string, string>> };
    expect(final.investmentsList.find((e) => e.extId === NPC_IDS[0])?.state).toBe("2");
    expect(final.investmentsStarted).toBe("4");
    expect(final.investmentsRewarded).toBe("1");
  });

  test("ask_for_help (askForHelp mission trigger) answers immediately with help_id null", async () => {
    const { send } = await setup();
    expect((await send("ask_for_help", { sid: "5" })).help_id).toBe("null");
  });
});
