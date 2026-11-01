// Black-box tests for every HTTP route of apps/server/src/serverApp.ts (status, content-type, cache headers, and the sha256 of
// the body against fixtures/routes.golden.json, recorded from the original TS server, now owned by this suite). Original tests covered only some of them.
import { afterAll, describe, expect, test } from "vitest";
import { clientFor, extractCommands, parseEnvelope } from "./lib/client.js";
import { expectGolden, flushGolden } from "./lib/golden.js";
import { request, sha256 } from "./lib/http.js";
import { cleanupServersAfterEach, sharedServer, startServer } from "./lib/server.js";

cleanupServersAfterEach();
afterAll(() => flushGolden());

const D = "/mcity/0.501/Datas";

describe("static and fixed routes (shared server)", () => {
  const server = sharedServer({ noFacebookShim: true });
  // the page embeds the HTTPS port (a different one on every run): replace it wherever it appears
  const normalizeLauncher = (body: string) => body.split(String(server().httpsPort)).join("PORT");

  const getRoutes: Array<[name: string, path: string, extra?: Record<string, string>]> = [
    ["health", "/health"],
    ["event-track-get", "/event/track"],
    ["local-profile", "/local/profile"],
    ["local-resources", "/local/resources"],
    ["local-profile-picture-default", "/local/profile-picture"],
    ["private-swf", "/client/Dollars.private.swf"],
    ["favicon", "/favicon.ico"],
    ["crossdomain", "/crossdomain.xml"],
    ["tutorial-hq-positions", `${D}/rules/TutorialHQPositions.xml`],
    ["rules-itemDefinitions", `${D}/rules/itemDefinitions.xml`],
    ["rules-commerceDefinitions", `${D}/rules/commerceDefinitions.xml`],
    ["rules-decorationDefinitions", `${D}/rules/decorationDefinitions.xml`],
    ["rules-wonderDefinitions", `${D}/rules/wonderDefinitions.xml`],
    ["rules-collectiblesDefinitions", `${D}/rules/collectiblesDefinitions.xml`],
    ["rules-collectiblesGroupsDefinitions", `${D}/rules/collectiblesGroupsDefinitions.xml`],
    ["rules-collectiblesRewardDefinitions", `${D}/rules/collectiblesRewardDefinitions.xml`],
    ["rules-missionDefinitions", `${D}/rules/missionDefinitions.xml`],
    ["rules-settings", `${D}/rules/settings.xml`],
    ["rules-XPTable", `${D}/rules/XPTable.xml`],
    ["rules-dailyRewards", `${D}/rules/dailyRewardsDefinitions.xml`],
    ["rules-contracts", `${D}/rules/contracts.xml`],
    ["userdata-fan", `${D}/userData/fan.xml`],
    ["userdata-giftsList", `${D}/userData/giftsList.xml`],
    ["splash", `${D}/splash.swf`],
    ["dollars-swf", `${D}/Dollars.swf`],
    ["locale-en", `${D}/Locale/EN.txt`],
    ["locale-en-lowercase-path", "/mcity/0.501/datas/locale/en.txt"],
    ["extension-less-asset", `${D}/rules/settings`],
    ["feed-missing-jpg", `${D}/feed/zzz_missing.jpg`],
    ["feed-missing-jpeg", `${D}/feed/zzz_missing.jpeg`],
    ["feed-missing-png", `${D}/feed/zzz_missing.png`],
    ["feed-missing-gif-404", `${D}/feed/zzz_missing.gif`],
    ["feed-existing", `${D}/feed/new_feed_upgrades_0.jpg`],
    ["commerce-icon-missing", `${D}/Assets/items/CommerceTypes/icons/zzz_missing.png`],
    ["commerce-icon-existing", `${D}/Assets/items/CommerceTypes/icons/commerce_bank.png`],
    ["commerce-icon-missing-non-png-404", `${D}/Assets/items/CommerceTypes/icons/zzz_missing.gif`],
    ["mission-icon-missing", `${D}/Assets/missions/icons/zzz_missing.png`],
    ["mission-icon-existing", `${D}/Assets/missions/icons/build.png`],
    ["commerce-swf-missing", `${D}/Assets/items/CommerceTypes/zzz_missing.swf`],
    ["commerce-swf-existing", `${D}/Assets/items/CommerceTypes/common.swf`],
    ["asset-missing-404", `${D}/zzz_missing.txt`],
    ["asset-directory-404", `${D}/rules/`],
    ["asset-traversal-404", `/mcity/0.501/..%2f..%2fpackage.json`],
    ["asset-traversal-dotdot-404", `/mcity/0.501/Datas/../../../package.json`],
    ["cbar-htm", "/cbar/cbar.htm"],
    ["cbar-extension-htm", "/cbar/cbar"],
    ["cbar-css", "/cbar/new_cbar.css"],
    ["cbar-missing-404", "/cbar/zzz_missing.png"],
    ["unknown-route-404", "/nothing-here"],
    ["root-404-without-client", "/"],
    ["game-get-404", "/Game"]
  ];

  test.each(getRoutes)("GET %s", async (name, path) => {
    const res = await request(`${server().httpUrl}${path}`);
    expectGolden(`GET ${name}`, res);
  });

  test("content types and cache headers that matter to clients", async () => {
    const h = (p: string) => request(`${server().httpUrl}${p}`);
    expect((await h("/health")).headers.get("content-type")).toContain("application/json");
    expect((await h("/event/track")).text).toBe("ok");
    expect((await h("/crossdomain.xml")).headers.get("content-type")).toContain("application/xml");
    expect((await h("/crossdomain.xml")).text).toContain('<allow-access-from domain="*" />');
    const rules = await h(`${D}/rules/itemDefinitions.xml`);
    expect(rules.headers.get("content-type")).toContain("application/xml");
    expect(rules.headers.get("cache-control")).toBe("public, max-age=3600");
    const swf = await h(`${D}/Dollars.swf`);
    expect(swf.headers.get("content-type")).toBe("application/x-shockwave-flash");
    expect(swf.headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await h("/local/profile-picture")).headers.get("cache-control")).toBe("no-store");
    expect((await h("/favicon.ico")).headers.get("content-type")).toContain("image/x-icon");
    expect((await h(`${D}/zzz_missing.txt`)).status).toBe(404);
    expect((await h(`${D}/zzz_missing.txt`)).text).toBe("");
  });

  test("the private client SWF is a copy of the archived Dollars.swf", async () => {
    const [priv, orig] = await Promise.all([request(`${server().httpUrl}/client/Dollars.private.swf`), request(`${server().httpUrl}${D}/Dollars.swf`)]);
    expect(priv.status).toBe(200);
    expect(sha256(priv.body)).toBe(sha256(orig.body));
  });

  test("HEAD requests of static files and health", async () => {
    expect((await request(`${server().httpUrl}/health`, { method: "HEAD" })).status).toBe(200);
    const head = await request(`${server().httpUrl}${D}/Dollars.swf`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
  });

  test.each([
    ["launcher", "/launcher"],
    ["launcher-debug", "/launcher?debug=1"],
    ["launcher-climate", "/launcher?climate=true"],
    ["launcher-oldItems", "/launcher?oldItems=yes"],
    ["launcher-all", "/launcher?debug=true&climate=1&oldItems=1"],
    ["launcher-falsy", "/launcher?debug=0&climate=no&oldItems=false"]
  ])("GET %s (port-normalized body hash)", async (name, path) => {
    const res = await request(`${server().httpUrl}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expectGolden(`GET ${name}`, res, normalizeLauncher);
  });

  test("launcher flags change the page", async () => {
    const plain = (await request(`${server().httpUrl}/launcher`)).text;
    const debug = (await request(`${server().httpUrl}/launcher?debug=1`)).text;
    const climate = (await request(`${server().httpUrl}/launcher?climate=true`)).text;
    const old = (await request(`${server().httpUrl}/launcher?oldItems=yes`)).text;
    expect(plain).toContain("climateMode=0");
    expect(climate).toContain("climateMode=1");
    expect(old).toContain("oldItemDesigns=1");
    expect(debug).not.toBe(plain);
    expect(plain).toContain(`https://127.0.0.1:${server().httpsPort}`);
  });

  test("POST /event/track and other methods answer ok", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await request(`${server().httpUrl}/event/track`, { method });
      expect(res.status).toBe(200);
      expect(res.text).toBe("ok");
      expect(res.headers.get("content-type")).toContain("text/plain");
    }
  });

  test("the HTTPS listener serves the same app", async () => {
    const { httpsGet } = await import("./lib/http.js");
    const res = await httpsGet(`${server().httpsUrl}/health`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true });
    const launcher = await httpsGet(`${server().httpsUrl}/launcher`);
    expect(launcher.status).toBe(200);
  });
});

describe("VIP club and registration routes", () => {
  test("every registration alias marks the club as submitted; confirmation reads 0/1; routes have fixed bodies", async () => {
    const aliases: Array<[string, string]> = [
      [`${D}/userData/checkSendMail.xml`, `${D}/userData/checkMail.html`],
      ["/registration/register", "/registration/isconfirmed"],
      ["/registration/register/", "/registration/isconfirmed/"]
    ];
    for (const [submit, confirm] of aliases) {
      const fresh = await startServer({ noFacebookShim: true });
      const f = (p: string) => request(`${fresh.httpUrl}${p}`);
      const before = await f(confirm);
      expect(before.text).toBe("0");
      expect(before.headers.get("content-type")).toContain("text/plain");
      const res = await f(submit);
      expectGolden(`GET vip-submit ${submit}`, res);
      expect(res.text).toBe("<response><status>0</status></response>");
      expect(res.headers.get("content-type")).toContain("application/xml");
      expect((await f(confirm)).text).toBe("1");
      expect(fresh.profile().checkmail).toBe("1");
    }
  });

  test("an already confirmed club (checkmail = 2) is never downgraded by a new submission", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) => db.editUniverse(({ profile }) => void (profile.checkmail = "2")));
    await request(`${s.httpUrl}/registration/register`);
    expect(s.profile().checkmail).toBe("2");
    expect((await request(`${s.httpUrl}/registration/isconfirmed`)).text).toBe("1");
  });
});

describe("/local/profile and /local/resources", () => {
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };

  test("profile name and city are sanitized (control chars, whitespace, length 32, defaults)", async () => {
    const s = await startServer({ noFacebookShim: true });
    const r1 = await post(`${s.httpUrl}/local/profile`, { userName: "  Big \t\n  Mayor\u0001  ", cityName: "x".repeat(50) });
    expect(r1.status).toBe(200);
    expect(r1.body.userName).toBe("Big Mayor");
    expect(r1.body.cityName).toBe("x".repeat(32));
    expect(s.profile().cityNameCodes.split(",")).toHaveLength(32);
    const r2 = await post(`${s.httpUrl}/local/profile`, { userName: "   ", cityName: "" });
    expect(r2.body.userName).toBe("Mayor");
    expect(r2.body.cityName).toBe("Chocolate Fields");
    // fields that are not sent keep their value
    const r3 = await post(`${s.httpUrl}/local/profile`, { userName: "Only Name" });
    expect(r3.body).toMatchObject({ userName: "Only Name", cityName: "Chocolate Fields" });
    expect(r3.body.profilePictureUrl).toMatch(/^\/local\/profile-picture\?v=/);
  });

  test("profile picture validation errors (400 with the exact messages) and picture lifecycle", async () => {
    const s = await startServer({ noFacebookShim: true });
    const url = `${s.httpUrl}/local/profile`;
    const bad = async (profilePictureDataUrl: string) => post(url, { profilePictureDataUrl });
    const notImage = await bad("not-an-image");
    expect(notImage).toEqual({ status: 400, body: { ok: false, error: "Profile picture must be a PNG, JPEG, GIF, or WebP image." } });
    const wrongMagic = await bad("data:image/png;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=");
    expect(wrongMagic).toEqual({ status: 400, body: { ok: false, error: "Profile picture data does not match its image type." } });
    const tooBig = await bad(`data:image/gif;base64,${Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(2 * 1024 * 1024 + 1)]).toString("base64")}`);
    expect(tooBig).toEqual({ status: 400, body: { ok: false, error: "Profile picture must be between 1 byte and 2 MB." } });
    const svg = await bad("data:image/svg+xml;base64,PHN2Zy8+");
    expect(svg.status).toBe(400);

    const gif = "data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";
    const ok = await post(url, { profilePictureDataUrl: gif });
    expect(ok.body.hasProfilePicture).toBe(true);
    const v1 = ok.body.profilePictureUrl as string;
    const pic = await request(`${s.httpUrl}/local/profile-picture`);
    expect(pic.headers.get("content-type")).toContain("image/gif");
    expect(pic.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(gif.split(",")[1], "base64").equals(pic.body)).toBe(true);
    // PNG replaces it and changes the version
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]);
    await new Promise((r) => setTimeout(r, 5));
    const ok2 = await post(url, { profilePictureDataUrl: `data:image/png;base64,${png.toString("base64")}` });
    expect(ok2.body.profilePictureUrl).not.toBe(v1);
    expect((await request(`${s.httpUrl}/local/profile-picture`)).headers.get("content-type")).toContain("image/png");
    // clearing wins over an upload sent in the same request
    const cleared = await post(url, { clearProfilePicture: "true", profilePictureDataUrl: gif });
    expect(cleared.body.hasProfilePicture).toBe(false);
    const after = await request(`${s.httpUrl}/local/profile-picture`);
    expect(after.headers.get("content-type")).toContain("image/gif");
    expect(after.body.length).toBe(35); // the transparent 1x1 gif
  });

  test("/local/resources/adjust validation errors and clamping", async () => {
    const s = await startServer({ noFacebookShim: true });
    const adjust = (body: unknown) => post(`${s.httpUrl}/local/resources/adjust`, body);
    expect(await adjust({ resource: "bananas", delta: 5 })).toEqual({ status: 400, body: { ok: false, error: "Resource must be money, gold, or xp." } });
    expect(await adjust({ resource: "money", delta: 0 })).toEqual({ status: 400, body: { ok: false, error: "Adjustment must be a non-zero whole number." } });
    expect(await adjust({ resource: "money", delta: 1.5 })).toEqual({ status: 400, body: { ok: false, error: "Adjustment must be a non-zero whole number." } });
    expect(await adjust({ resource: "money", delta: "abc" })).toEqual({ status: 400, body: { ok: false, error: "Adjustment must be a non-zero whole number." } });
    expect(await adjust({ resource: "money", delta: 1_000_000_000 })).toEqual({ status: 400, body: { ok: false, error: "Adjustment must be between -999999999 and 999999999." } });
    expect(await adjust({})).toMatchObject({ status: 400 });
    // string numbers are accepted; resource is trimmed and case-insensitive
    const ok = await adjust({ resource: " MONEY ", delta: "100" });
    expect(ok.status).toBe(200);
    expect(ok.body.money).toBe(380100);
    // money cannot go below 0
    const floor = await adjust({ resource: "money", delta: -999_999_999 });
    expect(floor.body.money).toBe(0);
    // xp raises the explicit level, a negative adjustment lowers it again
    const up = await adjust({ resource: "xp", delta: 9100 });
    expect(up.body).toMatchObject({ xp: 9100, level: 11 });
    const down = await adjust({ resource: "xp", delta: -9000 });
    expect(down.body).toMatchObject({ xp: 100, level: 1 });
    const form = await fetch(`${s.httpUrl}/local/resources/adjust`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "resource=gold&delta=5"
    });
    expect(form.status).toBe(200);
    expect(((await form.json()) as any).gold).toBe(5);
  });

  test("GET /local/resources reports the stored numbers", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) => db.editUniverse(({ profile }) => Object.assign(profile, { DCCoins: "12.9", DCCash: "7", DCCashPaid: "3", exp: "1010", companyValue: "99", level: "2" })));
    const res = (await (await fetch(`${s.httpUrl}/local/resources`)).json()) as any;
    expect(res).toMatchObject({ ok: true, money: 12, gold: 7, paidGold: 3, xp: 1010, level: 3, minXp: 1010, maxXp: 1580, companyValue: 99 });
  });
});

describe("POST /Game protocol", () => {
  test("login: logOK envelope, fresh token each time, chk, sync", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    const before = Date.now();
    const env = await c.login();
    expect(env.service).toBe("Command");
    expect(env.callId).toBe("login");
    expect(env.responseCode).toBe("0");
    expect(env.chkValid).toBe(true);
    expect(env.msgCount).toBe(-1);
    expect(env.sync).toBe(1);
    expect(env.list).toHaveLength(1);
    const cmd = env.list[0];
    expect(Object.keys(cmd)).toEqual(["_cmd", "_dat", "_sync"]);
    expect(cmd._sync).toBe(1);
    expect(Object.keys(cmd._dat)).toEqual(["userId", "userExtId", "advisorId", "token", "currentServerTime"]);
    expect(cmd._dat.userId).toBe(1);
    expect(cmd._dat.userExtId).toBe(s.uid);
    expect(cmd._dat.advisorId).toBe("100,101");
    expect(cmd._dat.token).toMatch(/^[0-9a-f]{32}$/);
    expect(cmd._dat.currentServerTime).toBeGreaterThanOrEqual(before);
    expect(cmd._dat.currentServerTime).toBeLessThanOrEqual(Date.now());
    expect(s.readDb((db) => db.session())).toMatchObject({ user_id: 1, token: cmd._dat.token, sync: 1 });
    const second = await c.login();
    expect(second.list[0]._dat.token).not.toBe(cmd._dat.token);
    expect(s.readDb((db) => db.session()?.token)).toBe(second.list[0]._dat.token);
    expect(env.xml.startsWith('<Response service="Command" call_id="login">\n  <response_code>0</response_code>\n  <data>\n    <chk>')).toBe(true);
    expect(env.xml).toContain("<commands><![CDATA[{");
    expect(env.xml.endsWith("]]></commands>\n  </data>\n</Response>")).toBe(true);
  });

  test("a uid mismatch is accepted (private server), the response content type is XML", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    const res = await fetch(`${s.httpUrl}/Game`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ uid: "someone-else", cmd: "cmdList", data: JSON.stringify({ _cmdList: [{ _cmd: "get_game_config", _dat: {} }], _msgCount: 3 }) })
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const env = parseEnvelope(await res.text());
    expect(env.callId).toBe("cmdList");
    expect(env.msgCount).toBe(3);
    expect(env.list[0]._cmd).toBe("get_game_config");
    void c;
  });

  test("unsupported roots, empty commands, bad JSON, bad message counts, malformed entries", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    const post = async (form: Record<string, string>) => parseEnvelope(await c.postForm(form));
    // cmd other than cmdList/login/payments
    const foo = await post({ uid: s.uid, cmd: "foo", data: "{}" });
    expect(foo.callId).toBe("cmdList");
    expect(foo.msgCount).toBe(-1);
    expect(foo.list).toEqual([{ _cmd: "foo", _dat: { success: "true", ignored: "1", unsupportedRoot: "1" } }]);
    const noCmd = await post({ uid: s.uid, data: "{}" });
    expect(noCmd.list).toEqual([{ _cmd: "noop", _dat: { success: "true", ignored: "1", unsupportedRoot: "1" } }]);
    // invalid data JSON => no commands
    const bad = await post({ uid: s.uid, cmd: "cmdList", data: "{not json" });
    expect(bad.list).toEqual([]);
    expect(bad.msgCount).toBe(-1);
    expect(bad.chkValid).toBe(true);
    // entries without a string _cmd are dropped
    const malformed = await post({ uid: s.uid, cmd: "cmdList", data: JSON.stringify({ _cmdList: [{ _cmd: 5 }, "x", null, { _cmd: "ping" }] }) });
    expect(malformed.list).toEqual([{ _cmd: "ping", _dat: {}, _sync: 1 }]);
    // _msgCount is echoed; a non-numeric one becomes -1
    const echo = await post({ uid: s.uid, cmd: "cmdList", data: JSON.stringify({ _cmdList: [{ _cmd: "ping" }], _msgCount: 7 }) });
    expect(echo.msgCount).toBe(7);
    const str = await post({ uid: s.uid, cmd: "cmdList", data: JSON.stringify({ _cmdList: [{ _cmd: "ping" }], _msgCount: "abc" }) });
    expect(str.msgCount).toBe(-1);
    const numStr = await post({ uid: s.uid, cmd: "cmdList", data: JSON.stringify({ _cmdList: [{ _cmd: "ping" }], _msgCount: "12" }) });
    expect(numStr.msgCount).toBe(12);
    const none = await post({ uid: s.uid, cmd: "cmdList", data: JSON.stringify({ _cmdList: [{ _cmd: "ping" }] }) });
    expect(none.msgCount).toBe(-1);
  });

  test("ping/empty/unknown commands and handler failures answer per command", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    const res = await c.cmdList([
      ["zzz_unknown", { a: 1 }],
      ["ping"],
      ["empty"],
      { _cmd: "update_item" } // no _dat: the handler throws, the server answers offlineError
    ]);
    expect(res.list[0]).toEqual({ _cmd: "zzz_unknown", _dat: { success: "true", ignored: "1" }, _sync: 1 });
    expect(res.list[1]).toEqual({ _cmd: "ping", _dat: {}, _sync: 1 });
    expect(res.list[2]).toEqual({ _cmd: "empty", _dat: {}, _sync: 1 });
    expect(res.list[3]).toEqual({ _cmd: "update_item", _dat: { success: "false", ignored: "1", offlineError: "1" }, _sync: 1 });
    expect(res.chkValid).toBe(true);
  });

  test("a JSON request body is accepted like a form body", async () => {
    const s = await startServer({ noFacebookShim: true });
    const res = await fetch(`${s.httpUrl}/Game`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uid: "x", cmd: "foo" }) });
    expect(res.status).toBe(200);
    expect(extractCommands(await res.text())[0]._cmd).toBe("foo");
  });

  test("payments: free purchase, gold packages award gold and bump the session sync", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.login();
    const pay = async (data: unknown) => parseEnvelope(await c.postForm({ uid: s.uid, cmd: "payments", version: "0.501", data: typeof data === "string" ? data : JSON.stringify(data) }));
    const other = await pay({ type: "buytool", sku: "signator_1", price: 1 });
    expect(other.msgCount).toBe(-1);
    expect(other.sync).toBe(1);
    expect(other.list).toEqual([{ _cmd: "payments", _dat: { success: "1", unavailableOffline: "1", privateServerFreePurchase: "1", awardedGold: "0" } }]);
    const garbage = await pay("zzz");
    expect(garbage.list[0]._dat.awardedGold).toBe("0");
    const unknownSku = await pay({ type: "gold", sku: "no_such_package" });
    expect(unknownSku.list[0]._dat.awardedGold).toBe("0");
    expect(unknownSku.sync).toBe(1);
    const before = s.profile();
    const gold = await pay({ type: " Gold ", sku: "1" });
    const awarded = Number(gold.list[0]._dat.awardedGold);
    expect(awarded).toBeGreaterThan(0);
    expect(gold.sync).toBe(2);
    const after = s.profile();
    expect(Number(after.DCCash)).toBe(Number(before.DCCash) + awarded);
    expect(Number(after.companyValue)).toBe(Number(before.companyValue) + awarded * 60000);
    expect(Number(after.DCCashPaid)).toBeGreaterThan(Number(before.DCCashPaid ?? 0));
    // later command answers carry the bumped sync
    expect((await c.cmdList([["ping"]])).sync).toBe(2);
  });
});
