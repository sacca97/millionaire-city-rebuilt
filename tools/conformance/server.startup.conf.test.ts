// Black-box port of the startup / listener / TLS / login tests at the top of apps/server/test/server.test.ts.
import crypto from "node:crypto";
import { describe, expect, test } from "vitest";
import { clientFor, signPayload, extractCommands } from "./lib/client.js";
import { httpsGet, request } from "./lib/http.js";
import { cleanupServersAfterEach, newServer, reservePort, releasePort, startServer } from "./lib/server.js";
import { blockPort, closeBlocker, golden, isListening } from "./lib/util.js";

cleanupServersAfterEach();

describe("Millionaire City server: startup", () => {
  test("migrates compatible older save schemas without resetting player data", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) => {
      db.editUniverse(({ profile }) => {
        profile.userName = "Preserved Mayor";
      });
      db.setMeta("save_schema_version", "7");
    });
    // the migration runs at startup (before any request)
    expect(s.meta("save_schema_version")).toBe("8");
    expect(s.profile().userName).toBe("Preserved Mayor");
    const migrated = clientFor(s);
    const universe = await migrated.world(1);
    expect(universe.find((e: any) => Array.isArray(e.Profile)).userName).toBe("Preserved Mayor");
  });

  test("rolls back the HTTP listener when HTTPS startup fails", async () => {
    const blockedPort = await reservePort();
    const blocker = await blockPort(blockedPort);
    try {
      const s = newServer({ noFacebookShim: true, ports: { https: blockedPort }, expectStartFailure: true });
      await s.start();
      const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r("timeout"), 15_000))]);
      expect(code).not.toBe("timeout");
      expect(code).not.toBe(0);
      expect(await isListening(s.httpPort)).toBe(false);
    } finally {
      await closeBlocker(blocker);
      releasePort(blockedPort);
    }
  });

  test("requires a launch-secret proof for authenticated health checks", async () => {
    const launchSecret = "test-launch-secret";
    const challenge = "a".repeat(64);
    const s = await startServer({ noFacebookShim: true, env: { MCITY_LAUNCH_SECRET: launchSecret } });

    const unauthenticatedResponse = await fetch(`${s.httpUrl}/health`);
    expect(unauthenticatedResponse.status).toBe(400);

    const response = await fetch(`${s.httpUrl}/health`, { headers: { "x-mcity-health-challenge": challenge } });
    const expectedProof = crypto.createHmac("sha256", launchSecret).update(`mcity-health-v1:${challenge}`).digest("hex");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-mcity-health-proof")).toBe(expectedProof);
  });

  test("fails closed when the required Facebook shim port is unavailable", async () => {
    const blockedPort = await reservePort();
    const blocker = await blockPort(blockedPort);
    try {
      const s = newServer({ ports: { facebook: blockedPort }, env: { MCITY_REQUIRE_FB_SHIM: "1" }, expectStartFailure: true });
      await s.start();
      const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r("timeout"), 15_000))]);
      expect(code).not.toBe("timeout");
      expect(code).not.toBe(0);
      expect(await isListening(s.httpPort)).toBe(false);
      expect(await isListening(s.httpsPort)).toBe(false);
    } finally {
      await closeBlocker(blocker);
      releasePort(blockedPort);
    }
  });

  test("binds the Facebook shim only to the loopback interface", async () => {
    const s = await startServer();
    expect(await isListening(s.facebookPort, "127.0.0.1")).toBe(true);
    // 127.0.0.2 is also loopback on Linux: a socket bound to 127.0.0.1 only must refuse it (so would 0.0.0.0 accept it)
    expect(await isListening(s.facebookPort, "127.0.0.2")).toBe(false);
  });

  test("uses macOS-compatible certificates for both local HTTPS servers", async () => {
    const s = await startServer({ env: { MCITY_REQUIRE_FB_SHIM: "1" } });
    const certificates = (await Promise.all([httpsGet(`${s.httpsUrl}/health`), httpsGet(`${s.facebookUrl}/me`)])).map((r) => r.cert);

    for (const certificate of certificates) {
      const lifetimeMs = Date.parse(certificate.validTo) - Date.parse(certificate.validFrom);
      expect(lifetimeMs).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
      expect(certificate.checkIP("127.0.0.1")).toBe("127.0.0.1");
      expect(certificate.keyUsage).toContain("1.3.6.1.5.5.7.3.1");
      expect(certificate.publicKey.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
    }

    expect(certificates[0].checkHost("localhost")).toBe("localhost");
    expect(certificates[1].checkHost("graph.facebook.com")).toBe("graph.facebook.com");
    expect(certificates[1].checkHost("api.facebook.com")).toBe("api.facebook.com");
  });

  test("returns logOK and startup documents", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    const login = await c.login();
    const loginCommands = login.list;
    expect(loginCommands[0]._cmd).toBe("logOK");
    expect(loginCommands[0]._dat.userExtId).toBe(s.uid);
    expect(loginCommands[0]._dat.advisorId).toBe("100,101");

    const token = String(loginCommands[0]._dat.token);
    const startupData = JSON.stringify({
      _cmdList: [
        { _cmd: "get_world", _dat: { targetUserId: 1 }, _cnt: 1 },
        { _cmd: "get_game_config", _dat: {}, _cnt: 2 }
      ],
      _msgCount: 0,
      _sync: 1
    });
    const form: Record<string, string> = { uid: s.uid, cmd: "cmdList", version: "0.501", data: startupData, flash_version: "WIN 32,0,0,0" };
    const startupPayload = await c.postForm({ ...form, sig: signPayload(form, token) });

    const startupCommands = extractCommands(startupPayload);
    expect(startupCommands.map((entry) => entry._cmd)).toEqual(["get_world", "get_game_config"]);
    expect(startupCommands[0]._dat.universe).toBeTruthy();
    const universeRoot = startupCommands[0]._dat.universe as Array<Record<string, any>>;
    const worldContainer = universeRoot.find((entry) => Array.isArray(entry.World)) as { World: Array<Record<string, any>> } | undefined;
    const profileContainer = universeRoot.find((entry) => Array.isArray(entry.Profile)) as { Profile: Array<Record<string, any>>; [k: string]: any } | undefined;
    expect(worldContainer).toBeTruthy();
    expect(profileContainer).toBeTruthy();
    const companies = worldContainer?.World.filter((entry) => Array.isArray(entry.Company)) ?? [];
    expect(companies).toHaveLength(2);
    expect(companies.map((entry) => entry.whose)).toEqual(["0", "1"]);
    const mineCompany = companies.find((entry) => entry.whose === "0");
    const mineItems = mineCompany?.Company.filter((entry: any) => Array.isArray(entry.Item)) ?? [];
    const plots = profileContainer?.Profile.find((entry) => Array.isArray(entry.Plots)) as { type: string } | undefined;
    expect(plots?.type).toBe("");
    expect(profileContainer?.tutorialEnd).toBe("0");
    expect(profileContainer?.bossGenre).toBe("0");
    expect(profileContainer?.exp).toBe("0");
    expect(profileContainer?.DCCoins).toBe("380000");
    expect(profileContainer?.DCCash).toBe("0");
    expect(profileContainer?.companyValue).toBe("720000");
    expect(mineCompany?.DCCoins).toBe("380000");
    const rivalCompany = companies.find((entry) => entry.whose === "1");
    const rivalItems = rivalCompany?.Company.filter((entry: any) => Array.isArray(entry.Item)) ?? [];
    expect(rivalItems.map((entry: any) => entry.sku)).toEqual(["commerce_pizza", "houses_002_001", "houses_002_002", "houses_001_002"]);
    expect(mineItems.map((entry: any) => entry.sku)).toEqual(golden.starterDecorationSkus);
    expect(mineItems.every((entry: any) => entry.Item.some((state: { id?: string }) => state.id === "5"))).toBe(true);
    expect(rivalItems.every((entry: any) => entry.Item.some((state: { id?: string }) => state.id === "3"))).toBe(true);
    const mapContainer = worldContainer?.World.find((entry) => Array.isArray(entry.Map)) as { Map: Array<Record<string, unknown>> } | undefined;
    const terrainChunk = mapContainer?.Map.find((entry) => Array.isArray(entry.Terrain)) as { chunk?: string } | undefined;
    const roadChunk = mapContainer?.Map.find((entry) => Array.isArray(entry.Road)) as { chunk?: string } | undefined;
    const terrainTiles = new Set(String(terrainChunk?.chunk ?? "").split(",").filter(Boolean));
    const roadTiles = new Set(String(roadChunk?.chunk ?? "").split(",").filter(Boolean));
    expect(terrainTiles.size).toBe(41);
    expect([...terrainTiles].filter((tile) => roadTiles.has(tile))).toEqual([]);
    expect(["0:1", "1:1", "0:2", "1:2", "0:3", "1:3"].filter((tile) => terrainTiles.has(tile))).toEqual([]);
    expect(terrainTiles.has("10:-2")).toBe(false);
    expect(380_000 + golden.starterDecorationValue + terrainTiles.size * 1_000).toBe(720_000);
    expect(terrainTiles.has("-1:-3")).toBe(true);
    expect(terrainTiles.has("2:-1")).toBe(true);
    expect(terrainTiles.has("-7:-2")).toBe(true);
    expect(terrainTiles.has("-13:1")).toBe(true);
    expect(terrainTiles.has("-12:2")).toBe(true);
    expect(terrainTiles.has("-4:1")).toBe(true);
    expect(terrainTiles.has("-2:3")).toBe(true);
    expect(terrainTiles.has("9:-3")).toBe(true);
    expect(terrainTiles.has("11:-1")).toBe(true);
    expect(terrainTiles.has("4:2")).toBe(true);
    expect(terrainTiles.has("4:3")).toBe(true);
    expect(roadTiles.has("-7:0")).toBe(true);
    expect(roadTiles.has("11:0")).toBe(true);
    expect(roadTiles.has("-1:4")).toBe(true);
    expect(roadTiles.has("2:4")).toBe(true);
    expect(startupCommands[1]._dat.gameConfig).toEqual([]);
    expect(startupCommands[1]._dat.music).toBe("1");
    expect(startupCommands[1]._dat.sound).toBe("1");
  });
});

void request;
