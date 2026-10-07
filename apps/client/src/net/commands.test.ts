import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GameCommands, itemTree, RENT_MODE, STATE_ID, type ProfileSnapshot } from "./commands";
import { md5, signParams } from "./md5";
import type { CmdListPacket, Envelope, PacketCommand } from "./protocol";
import { CommandQueue, MAX_CMDS_IN_ONE_PACKET, CACHE_UPDATES_MIN_TIME } from "./session";

function makeCommands(p: Partial<ProfileSnapshot> = {}) {
  const profile: ProfileSnapshot = { exp: 100, DCCoins: 5000, DCCash: 10, companyValue: 20000, ...p };
  let millis = 1234;
  const gc = new GameCommands({ profile: () => profile, millisSinceLogin: () => millis });
  gc.security.init();
  return { gc, profile, setMillis: (m: number) => (millis = m) };
}

describe("md5 / signature", () => {
  it("matches node crypto", () => {
    for (const s of ["", "a", "abc", "message digest", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000), "héllo ✓"]) {
      expect(md5(s)).toBe(createHash("md5").update(s).digest("hex"));
    }
  });
  it("signs like serverApp.isSignatureValid", () => {
    const params = { uid: "1", cmd: "cmdList", version: "0.501", data: '{"a":1}', flash_version: "WIN 32,0,0,0" };
    const expected = createHash("md5")
      .update(`cmd=cmdList&data={"a":1}&flash_version=WIN 32,0,0,0&uid=1&version=0.501tokHost4h`)
      .digest("hex");
    expect(signParams({ ...params, sig: "ignored" }, "tok")).toBe(expected);
  });
});

describe("security snapshot", () => {
  it("update() reports deltas since the last snapshot and advances the baseline", () => {
    const { gc, profile } = makeCommands();
    profile.DCCoins -= 300;
    profile.exp += 7;
    profile.companyValue += 300;
    const s1 = gc.security.update();
    expect(s1).toMatchObject({ coinsGain: -300, expGain: 7, cashGain: 0, compValueGain: 300, coinsNow: 4700, expNow: 107 });
    const s2 = gc.security.update();
    expect(s2).toMatchObject({ coinsGain: 0, expGain: 0, coinsNow: 4700 });
  });
  it("create() uses supplied gains and the stale baseline as *Now", () => {
    const { gc, profile } = makeCommands();
    profile.DCCoins += 999;
    const s = gc.security.create(1, 2, 3);
    expect(s).toMatchObject({ expGain: 1, coinsGain: 2, cashGain: 3, coinsNow: 5000 });
  });
});

describe("builders", () => {
  it("update_item carries action,sid,sku,security,millis after params", () => {
    const { gc } = makeCommands();
    const c = gc.move("12", 3, -4, "dec1", true);
    expect(c._cmd).toBe("update_item");
    expect(Object.keys(c._dat)).toEqual(["x", "y", "dec", "freeMove", "action", "sid", "sku", "security", "millis"]);
    expect(c._dat).toMatchObject({ action: "move", sid: "12", sku: "", freeMove: "true", millis: 1234 });
  });
  it("new_item embeds the XMLToObject-style tree", () => {
    const { gc } = makeCommands();
    const c = gc.newItem({ sid: "5", csid: "1", sku: "houses_001_001", x: 2, y: 3, state: { id: 0, mode: 1, time: 1000 }, dec: "f1" });
    expect(c._dat.item).toEqual({
      sid: "5", csid: "1", sku: "houses_001_001", x: "2", y: "3", isSuspended: "0",
      Item: [{ id: "0", mode: "1", time: "1000", State: [] }]
    });
    expect(c._dat.sku).toBe("houses_001_001");
  });
  it("map del sends string coordinates, add sends ints; roads use securityUpdate", () => {
    const { gc, profile } = makeCommands();
    profile.DCCoins -= 50;
    const road = gc.addRoad(1, 2);
    expect(road._dat).toMatchObject({ type: "Road", x: 1, y: 2, action: "add", sid: "1" });
    expect((road._dat.security as { coinsGain: number }).coinsGain).toBe(-50);
    expect(gc.delRoad(1, 2)._dat).toMatchObject({ x: "1", y: "2", action: "del" });
    expect((gc.addTerrain(0, 0, 400)._dat.security as { coinsGain: number }).coinsGain).toBe(-400);
  });
  it("cityName uses ascii codes with trailing comma", () => {
    expect(makeCommands().gc.cityName("Ab")._dat).toEqual({ value: "65,98,", action: "city_name_codes" });
  });
  it("rent UI modes are never emitted", () => {
    const { gc } = makeCommands();
    const g = { exp: 0, coins: 0, cash: 0 };
    expect(gc.rentMode("1", "s", { mode: RENT_MODE.CANCELING_CONTRACT, time: 0 }, g)).toBeNull();
    expect(gc.rentMode("1", "s", { mode: RENT_MODE.RENTING, time: 5 }, g)?._dat).toMatchObject({ mode: 4, time: 5 });
  });
  it("itemTree/new_state/finishConstruction shape", () => {
    const { gc } = makeCommands();
    expect(itemTree({ sid: "1", csid: "1", sku: "a", x: 0, y: 0, state: { id: 1 } }).Item).toEqual([{ id: "1", State: [] }]);
    expect(gc.finishConstruction("9", "k")._dat).toMatchObject({ action: "new_state", state: STATE_ID.RENT, mode: 1, time: 0 });
  });
  it("mission claim sends negative gains", () => {
    const { gc } = makeCommands();
    expect((gc.mission(7, { exp: 10, coins: 100, cash: 0 })._dat.security as { coinsGain: number }).coinsGain).toBe(-100);
  });
});

class FakeTransport {
  packets: CmdListPacket[] = [];
  failNext = 0;
  async sendPacket(packet: CmdListPacket): Promise<Envelope> {
    this.packets.push(JSON.parse(JSON.stringify(packet)));
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("net");
    }
    return { list: packet._cmdList.map((c) => ({ _cmd: c._cmd, _dat: c._dat })), _msgCount: packet._msgCount, _sync: 9 };
  }
}
const cmd = (n: string): PacketCommand => ({ _cmd: n, _dat: {} });

describe("CommandQueue", () => {
  it("batches, stamps _cnt, waits 2s, caps 15 per packet and advances _msgCount", async () => {
    const t = new FakeTransport();
    const q = new CommandQueue(t);
    q.markLoggedIn(3);
    for (let i = 0; i < 20; i += 1) q.sendCommand(cmd(`c${i}`));
    q.tick(CACHE_UPDATES_MIN_TIME - 1);
    expect(t.packets).toHaveLength(0);
    q.tick(1);
    expect(t.packets).toHaveLength(1);
    expect(t.packets[0]._cmdList).toHaveLength(MAX_CMDS_IN_ONE_PACKET);
    expect(t.packets[0]._cmdList.map((c) => c._cnt)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(t.packets[0]).toMatchObject({ _msgCount: 0, _sync: 3 });
    await q.drain();
    expect(t.packets).toHaveLength(2);
    expect(t.packets[1]._cmdList).toHaveLength(5);
    expect(t.packets[1]._msgCount).toBe(1);
    expect(q.serverIsBusy()).toBe(2);
    expect(q.serverSync).toBe(9);
  });
  it("does not send while a packet is in flight; sendQuery forces", async () => {
    const t = new FakeTransport();
    const q = new CommandQueue(t);
    q.markLoggedIn(1);
    q.sendQuery(cmd("get_world"));
    q.tick(0);
    q.sendQuery(cmd("load_success"));
    q.tick(0);
    expect(t.packets).toHaveLength(1);
    await q.drain();
    expect(t.packets).toHaveLength(2);
  });
  it("retries a failed packet with `retry` set and keeps the same _msgCount until answered", async () => {
    const t = new FakeTransport();
    const q = new CommandQueue(t);
    q.markLoggedIn(1);
    q.sendCommand(cmd("a"));
    t.failNext = 1;
    q.flush();
    q.tick(0);
    await new Promise((r) => setTimeout(r, 0));
    q.sendCommand(cmd("b"));
    await q.drain();
    expect(t.packets).toHaveLength(2);
    expect(t.packets[0]._msgCount).toBe(0);
    expect(t.packets[1]._msgCount).toBe(1); // messageCnt advances after a failure too (Server.as:646)
    expect(t.packets[1].retry).toBe(2);
    expect(t.packets[1]._cmdList.map((c) => c._cmd)).toEqual(["a", "b"]);
  });
  it("emits desync on msgCount mismatch", async () => {
    const q = new CommandQueue({ sendPacket: async (p) => ({ list: [], _msgCount: p._msgCount + 5, _sync: 1 }) });
    q.markLoggedIn(1);
    const events: string[] = [];
    q.on((e) => events.push(e.type));
    q.sendQuery(cmd("x"));
    q.tick(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toContain("desync");
    expect(q.isLogged()).toBe(false);
  });
});
