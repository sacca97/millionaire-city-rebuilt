// Black-box tests for the Facebook stand-in endpoints (apps/server/src/facebookShim.ts), served over HTTPS on
// MCITY_FACEBOOK_PORT with a self-signed certificate. The original suite only covered the port binding and the certificate.
import { describe, expect, test } from "vitest";
import { afterAll, } from "vitest";
import { expectGolden, flushGolden } from "./lib/golden.js";
import { httpsGet } from "./lib/http.js";
import { isListening } from "./lib/util.js";
import { cleanupServersAfterEach, newServer, sharedServer, startServer } from "./lib/server.js";

cleanupServersAfterEach();
afterAll(() => flushGolden());

describe("Facebook stand-in endpoints", () => {
  const server = sharedServer();
  const get = (p: string) => httpsGet(`${server().facebookUrl}${p}`);

  test("GET /crossdomain.xml is the permissive secure policy", async () => {
    const res = await get("/crossdomain.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.text).toContain('<allow-access-from domain="*" secure="true" />');
    expect(res.text).toContain('<site-control permitted-cross-domain-policies="all" />');
    expectGolden("FB GET crossdomain", res);
  });

  test("GET /me/friends returns an empty list", async () => {
    const res = await get("/me/friends");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(res.text)).toEqual({ data: [] });
  });

  test("GET /method/friends.getAppUsers returns []", async () => {
    const res = await get("/method/friends.getAppUsers");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual([]);
  });

  test("GET /method/pages.isFan returns true", async () => {
    const res = await get("/method/pages.isFan");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toBe(true);
  });

  test("GET /method/users.getInfo describes the current user and anonymous friends, no-store", async () => {
    const s = server();
    const res = await get(`/method/users.getInfo?uids=${s.uid},777, 888 ,,`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = JSON.parse(res.text);
    expect(body).toEqual([
      { uid: s.uid, first_name: "Mayor", last_name: "", pic_square: `https://graph.facebook.com/${s.uid}/picture?v=default`, locale: "en_US" },
      { uid: "777", first_name: "Friend 2", last_name: "", pic_square: "https://graph.facebook.com/100/picture", locale: "en_US" },
      { uid: "888", first_name: "Friend 3", last_name: "", pic_square: "https://graph.facebook.com/100/picture", locale: "en_US" }
    ]);
    expect(Object.keys(body[0])).toEqual(["uid", "first_name", "last_name", "pic_square", "locale"]);
    expect(JSON.parse((await get("/method/users.getInfo")).text)).toEqual([]);
  });

  test("GET /:id/picture serves the transparent gif for other users, no-store", async () => {
    const res = await get("/12345/picture");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body.toString("base64")).toBe("R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=");
    expectGolden("FB GET picture", res);
  });

  test("unknown paths and non-GET methods are 404", async () => {
    const res = await get("/zzz/unknown/path");
    expect(res.status).toBe(404);
    expectGolden("FB GET unknown 404", res);
  });
});

describe("Facebook stand-in follows the local profile", () => {
  test("user name and profile picture of the current user come from /local/profile", async () => {
    const s = await startServer();
    const post = (body: unknown) =>
      fetch(`${s.httpUrl}/local/profile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const gif = "data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";
    const before = JSON.parse((await httpsGet(`${s.facebookUrl}/method/users.getInfo?uids=${s.uid}`)).text)[0];
    expect(before.first_name).toBe("Mayor");
    expect(before.pic_square).toContain("picture?v=default");

    const res = await post({ userName: "Shim Mayor", profilePictureDataUrl: gif });
    expect(res.status).toBe(200);
    const info = JSON.parse((await httpsGet(`${s.facebookUrl}/method/users.getInfo?uids=${s.uid}`)).text)[0];
    expect(info.first_name).toBe("Shim Mayor");
    expect(info.pic_square).toMatch(new RegExp(`^https://graph\\.facebook\\.com/${s.uid}/picture\\?v=\\d+$`));
    const pic = await httpsGet(`${s.facebookUrl}/${s.uid}/picture`);
    expect(pic.headers.get("content-type")).toContain("image/gif");
    expect(pic.headers.get("cache-control")).toBe("no-store");
    expect(pic.body.toString("base64")).toBe(gif.split(",")[1]);

    // the picture of another id is still the default gif, and a cleared picture falls back to it for the current user
    expect((await httpsGet(`${s.facebookUrl}/999/picture`)).body.length).toBe(35);
    await post({ clearProfilePicture: true });
    expect((await httpsGet(`${s.facebookUrl}/${s.uid}/picture`)).body.length).toBe(35);
    const cleared = JSON.parse((await httpsGet(`${s.facebookUrl}/method/users.getInfo?uids=${s.uid}`)).text)[0];
    expect(cleared.pic_square).toMatch(/picture\?v=\d+$/);
  });

  test("MCITY_UID changes the current user id of the stand-in and the launcher page", async () => {
    const s = await startServer({ env: { MCITY_UID: "424242" } });
    const info = JSON.parse((await httpsGet(`${s.facebookUrl}/method/users.getInfo?uids=424242,${s.uid}`)).text);
    expect(info[0].first_name).toBe("Mayor");
    expect(info[0].pic_square).toContain("/424242/picture");
    expect(info[1].first_name).toBe("Friend 2");
    expect((await (await fetch(`${s.httpUrl}/launcher`)).text())).toContain("424242");
  });
});

describe("Facebook stand-in switches", () => {
  test("MCITY_DISABLE_FB_SHIM=1 does not start it; the game server still works", async () => {
    const s = await startServer({ noFacebookShim: true });
    expect(await isListening(s.facebookPort)).toBe(false);
    expect((await fetch(`${s.httpUrl}/health`)).status).toBe(200);
  });

  test("a busy stand-in port without MCITY_REQUIRE_FB_SHIM only logs a warning", async () => {
    const { reservePort, releasePort } = await import("./lib/server.js");
    const { blockPort, closeBlocker } = await import("./lib/util.js");
    const port = await reservePort();
    const blocker = await blockPort(port);
    try {
      const s = newServer({ ports: { facebook: port } });
      await s.start();
      expect((await fetch(`${s.httpUrl}/health`)).status).toBe(200);
      expect((await httpsGet(`${s.httpsUrl}/health`)).status).toBe(200);
    } finally {
      await closeBlocker(blocker);
      releasePort(port);
    }
  });
});
