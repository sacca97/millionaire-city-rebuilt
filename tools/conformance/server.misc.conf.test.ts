// Black-box port of the remaining non-collectible tests of apps/server/test/server.test.ts: archived asset serving, VIP club
// endpoints, signature handling, payments, launcher page, local profile / resources settings.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { extractDefinitionTag, findDefinitionTag, request } from "./lib/http.js";
import { cleanupServersAfterEach, sharedServer, startServer } from "./lib/server.js";
import { worldOf } from "./lib/saves.js";
import { hasArchivedAssetFiles, REPO_ROOT } from "./lib/util.js";

cleanupServersAfterEach();
const archivedAssetTest = hasArchivedAssetFiles() ? test : test.skip;
const DATAS = "/mcity/0.501/Datas";

// Read-only HTTP tests share one server.
describe("archived assets and static routes (shared server)", () => {
  const server = sharedServer({ noFacebookShim: true });
  const get = (p: string) => fetch(`${server().httpUrl}${p}`);

  archivedAssetTest("serves placeholder feed art for missing mission images", async () => {
    const response = await get(`${DATAS}/feed/mission_build.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/jpeg");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  archivedAssetTest("serves archived assets with case-insensitive path matching", async () => {
    const response = await get("/mcity/0.501/datas/locale/en.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("Millionaire City");
  });

  // Original reads Datas/Locale/EN.txt from disk; the same bytes are what the server must serve.
  archivedAssetTest("keeps locale text assets LF-only for Flash text parsing", async () => {
    const localeText = await (await get(`${DATAS}/Locale/EN.txt`)).text();
    const localeLines = localeText.split("\n");
    expect(localeText).not.toContain("\r\n");
    expect(localeLines[48]).toBe(",");
    expect(localeLines[49]).toBe(".");
    expect(localeLines[795]).toBe("$");
  });

  test("does not serve item SWF fallbacks for missing main item assets", async () => {
    const response = await get(`${DATAS}/Assets/items/houses_definitely_missing.swf`);
    expect(response.status).toBe(404);
    for (const requested of ["houses_015_002.swf", "houses_012_003.swf", "decorations_statue_03.swf", "decorations_shop_01.swf", "decorations_halloween_03.swf"]) {
      const missingResponse = await get(`${DATAS}/Assets/items/${requested}`);
      expect(missingResponse.status).toBe(404);
    }
  });

  archivedAssetTest("serves only archived item definitions and makes archived limited-time items permanent", async () => {
    const rules = async (name: string) => (await get(`${DATAS}/rules/${name}`)).text();
    const itemDefinitions = await rules("itemDefinitions.xml");
    const commerceDefinitions = await rules("commerceDefinitions.xml");
    const decorationDefinitions = await rules("decorationDefinitions.xml");
    const wonderDefinitions = await rules("wonderDefinitions.xml");
    const missionDefinitions = await rules("missionDefinitions.xml");
    const archivedLimitedHouse = extractDefinitionTag(itemDefinitions, "houses_014_001");
    const vipClub = extractDefinitionTag(commerceDefinitions, "commerce_vip");
    const vipMission = extractDefinitionTag(missionDefinitions, "64");
    const archivedLimEdWonder = extractDefinitionTag(wonderDefinitions, "wonder_buda");
    const advisorVariantRewardHouse = extractDefinitionTag(itemDefinitions, "houses_037_001");
    expect(archivedLimitedHouse).not.toContain("expireTime=");
    expect(vipClub).not.toContain("expireTime=");
    expect(vipClub).toContain('freeGift="1"');
    expect(vipMission).toContain('rewardType="commerce_vip"');
    expect(advisorVariantRewardHouse).toContain('useAdvisor="1"');
    expect(findDefinitionTag(itemDefinitions, "houses_015_001")).toBeUndefined();
    expect(findDefinitionTag(commerceDefinitions, "commerce_bollywood")).toBeUndefined();
    expect(findDefinitionTag(decorationDefinitions, "decorations_halloween_03")).toBeUndefined();
    expect(findDefinitionTag(wonderDefinitions, "wonder_dracula_castle")).toBeUndefined();
    expect(archivedLimEdWonder).not.toContain('shopTab="limEd"');
    expect(archivedLimEdWonder).not.toContain("releaseTime=");
    expect(archivedLimEdWonder).not.toContain("unitsAmount=");
  });

  archivedAssetTest("keeps collectible collections with advisor-variant item rewards", async () => {
    const rules = async (name: string) => (await get(`${DATAS}/rules/${name}`)).text();
    const groupDefinitions = await rules("collectiblesGroupsDefinitions.xml");
    const collectibleDefinitions = await rules("collectiblesDefinitions.xml");
    const rewardDefinitions = await rules("collectiblesRewardDefinitions.xml");
    expect(extractDefinitionTag(groupDefinitions, "15")).toContain('reward="houses_037_001"');
    expect(extractDefinitionTag(collectibleDefinitions, "gift_057")).toContain('collection="15"');
    expect(extractDefinitionTag(rewardDefinitions, "houses_037_001")).toContain('useAdvisor="1"');
    expect(extractDefinitionTag(groupDefinitions, "7")).toContain('reward="decorations_christmas_07"');
    expect(extractDefinitionTag(collectibleDefinitions, "gift_025")).toContain('collection="7"');
    expect(extractDefinitionTag(rewardDefinitions, "decorations_christmas_07")).toContain('rewardType="item"');
  });

  // Original compares with the size of commerce_bank.png on disk; the same file is served by its own URL.
  archivedAssetTest("serves the bank commerce icon for missing commerce icons", async () => {
    const response = await get(`${DATAS}/Assets/items/CommerceTypes/icons/commerce_definitely_missing.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    const buffer = await response.arrayBuffer();
    const bank = await (await get(`${DATAS}/Assets/items/CommerceTypes/icons/commerce_bank.png`)).arrayBuffer();
    expect(buffer.byteLength).toBe(bank.byteLength);
    expect(Buffer.from(buffer).equals(Buffer.from(bank))).toBe(true);
  });

  test("serves an empty generated gifts list for client startup", async () => {
    const response = await get(`${DATAS}/userData/giftsList.xml`);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(await response.text()).toBe("<giftsList />");
  });

  // Original: renderLauncherHtml() called directly. Here the same strings are asserted on GET /launcher.
  describe("launcher page", () => {
    test("launcher keeps the normal gold HUD mode while exposing purchase success callbacks", async () => {
      const html = await (await get("/launcher")).text();
      expect(html).toContain("useFrictionlessFacebookCredits=false");
      expect(html).toContain("climateMode=0");
      expect(html).toContain("oldItemDesigns=0");
      expect(html).toContain("fbcreditsCurrentBalance:0:0");
      expect(html).toContain("messageResponseFacebookCredits:1");
      expect(html).toContain("var thumbnailSize = 50;");
      expect(html).toContain("localProfileUpdate");
      expect(html).toContain("INITIAL_LOCAL_PROFILE");
      expect(html).toContain("local_city_name");
      expect(html).toContain("Saved. Game profile updated.");
      expect(html).toContain("localStatsUpdate");
      expect(html).toContain("companyValue");
      expect(html).toContain("Saved. Game totals updated.");
      expect(html).toContain("mcity.localProfileSettingsVisible");
      expect(html).toContain("setLocalProfileSettingsVisible");
    });

    test("launcher renders the original social panel shells without custom offline content", async () => {
      const html = await (await get("/launcher")).text();
      expect(html).toContain('id="nb_tabs"');
      expect(html).toContain('id="dcsw_tabs"');
      expect(html).toContain('class="gifts_close"');
      expect(html).toContain('class="nb_close"');
      expect(html).toContain('class="dcsw_close"');
      expect(html).toContain("You don't have any messages at the moment.");
      expect(html).toContain("or choose a gift below!");
      expect(html).toContain('<span id="username"></span> and some other friends');
      expect(html).toContain('id="fgift_008"');
      expect(html).toContain('id="fgift_033"');
      expect(html).toContain("fgift_033_locked.png");
      expect(html).toContain("fgift_030_locked.png");
      expect(html).toContain('id="fgift_003"');
      expect(html.match(/class="gift-block"/g)).toHaveLength(26);
      expect(html).not.toContain("neighbors_back_button");
      expect(html).not.toContain("messages_back_button");
      expect(html).not.toContain("panel_notice");
      expect(html).not.toContain("offline_row");
      expect(html).not.toContain("freeGiftButton panel_button");
      expect(html).not.toContain("curtain.style.height = document.documentElement.scrollHeight");
      expect(html).not.toContain("The original tab shell is preserved");
      expect(html).not.toContain("This panel originally hosted");
    });

    test("launcher blocks external URL opens and omits obsolete plugin download metadata", async () => {
      const html = await (await get("/launcher")).text();
      expect(html).toContain('if (task === "openURL")');
      expect(html).toContain('privateServerUnavailable("External links")');
      expect(html).not.toContain("window.open(");
      expect(html).not.toContain("openUrlPayload");
      expect(html).not.toContain("pluginspage");
      expect(html).not.toContain("www.macromedia.com/go/getflashplayer");
    });

    test("launcher response sends restrictive browser security headers", async () => {
      const response = await get("/launcher");
      const contentSecurityPolicy = response.headers.get("content-security-policy");
      expect(response.status).toBe(200);
      expect(contentSecurityPolicy).toContain("default-src 'self'");
      expect(contentSecurityPolicy).toContain("object-src 'self'");
      expect(contentSecurityPolicy).toContain("connect-src 'self' https://graph.facebook.com https://api.facebook.com");
      expect(contentSecurityPolicy).toContain("base-uri 'none'");
      expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  // Not a server behaviour: the original asserts the patched client source in the repo. Kept verbatim (same file on both servers).
  test("client local resource updates resynchronize the security baseline", () => {
    const patchSource = fs.readFileSync(
      path.join(REPO_ROOT, "client-patch-sources", "scripts", "com", "dchoc", "dollars", "server", "Server.as"),
      "utf8"
    );
    expect(patchSource.replace(/\r\n/g, "\n")).toContain("_loc2_.update();\n         UserDataFacade.securityInit();");
  });
});

describe("VIP club, signatures, payments", () => {
  test("accepts local VIP Club email registration and exposes confirmation", async () => {
    const s = await startServer({ noFacebookShim: true });
    const before = await fetch(`${s.httpUrl}${DATAS}/userData/checkMail.html`);
    expect(await before.text()).toBe("0");
    const submit = await fetch(`${s.httpUrl}${DATAS}/userData/checkSendMail.xml?email=mayor%40example.com`);
    expect(await submit.text()).toContain("<status>0</status>");
    const after = await fetch(`${s.httpUrl}${DATAS}/userData/checkMail.html`);
    expect(await after.text()).toBe("1");
  });

  test("accepts WCRM VIP Club registration and exposes WCRM confirmation", async () => {
    const s = await startServer({ noFacebookShim: true });
    const before = await fetch(`${s.httpUrl}/registration/isconfirmed/?fb_user_id=123`);
    expect(await before.text()).toBe("0");
    const submit = await fetch(`${s.httpUrl}/registration/register/?fb_user_id=123&email=mayor%40example.com&project_id=7`);
    expect(await submit.text()).toContain("<status>0</status>");
    const after = await fetch(`${s.httpUrl}/registration/isconfirmed/?fb_user_id=123`);
    expect(await after.text()).toBe("1");
  });

  test("accepts invalid signatures in offline mode", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.login();
    const data = JSON.stringify({ _cmdList: [{ _cmd: "get_world", _dat: { targetUserId: 1 }, _cnt: 1 }], _msgCount: 0, _sync: 1 });
    const payload = await c.postForm({ uid: s.uid, cmd: "cmdList", version: "0.501", data, flash_version: "WIN 32,0,0,0", sig: "bad-signature" });
    const response = (await import("./lib/client.js")).extractCommands(payload)[0];
    expect(response._cmd).toBe("get_world");
    expect(response._dat.universe).toBeTruthy();
  });

  test("sanitizes startup XML-backed values before sending them to the client", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile }) => {
        profile.cityname = 'Mayor "Test"\u0000';
        profile.userName = 'The "Boss"\u0000';
        profile.cityNameCodes = "77,97,121,111,114,32,34,84,101,115,116,34,0,";
        profile.tutorialEnd = "1";
      })
    );
    const world = await clientFor(s).world(1);
    const returnedProfile = world[0];
    expect(returnedProfile.cityname).toBe("Mayor &quot;Test&quot;");
    expect(returnedProfile.userName).toBe("The &quot;Boss&quot;");
    expect(returnedProfile.cityNameCodes).toBe("77,97,121,111,114,32,34,84,101,115,116,34");
    expect(returnedProfile.cityname.includes("\u0000")).toBe(false);
    expect(returnedProfile.userName.includes("\u0000")).toBe(false);
  });

  test("returns free-purchase success for frictionless payments", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.login();
    const { signPayload, extractCommands } = await import("./lib/client.js");
    const paymentRequest = {
      uid: s.uid,
      cmd: "payments",
      version: "0.501",
      data: JSON.stringify({ type: "buytool", sku: "signator_1", price: 1 }),
      flash_version: "WIN 32,0,0,0"
    };
    const paymentPayload = await c.postForm({ ...paymentRequest, sig: signPayload(paymentRequest, c.token) });
    const paymentCommands = extractCommands(paymentPayload);
    expect(paymentCommands).toHaveLength(1);
    expect(paymentCommands[0]._cmd).toBe("payments");
    expect(paymentCommands[0]._dat.success).toBe("1");
    expect(paymentCommands[0]._dat.privateServerFreePurchase).toBe("1");
    expect(paymentCommands[0]._dat.awardedGold).toBe("0");
  });

  archivedAssetTest("persists purchased gold across restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    const res = await c.cmdList([
      [
        "update_money",
        {
          action: "buyGold",
          sku: "3",
          security: { expGain: 0, coinsGain: 0, cashGain: 115, compValueGain: 6_900_000, expNow: 0, coinsNow: 380_000, cashNow: 115, compValueNow: 7_620_000 }
        }
      ]
    ]);
    expect(res.list).toHaveLength(1);
    expect(res.list[0]._cmd).toBe("update_money");
    await s.restart();
    const { profile } = await worldOf(clientFor(s));
    expect(profile.DCCash).toBe("115");
    expect(profile.DCCashPaid).toBe("100");
    expect(profile.companyValue).toBe("7620000");
  });

  test("persists first friend visit prompt dismissal across restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    const res = await clientFor(s).cmdList([
      ["update_profile", { action: "tutorial_completed" }],
      ["update_money", { action: "first_visit", value: 1 }]
    ]);
    expect(res.list).toHaveLength(2);
    expect(res.list[1]._cmd).toBe("update_money");
    await s.restart();
    const { profile } = await worldOf(clientFor(s));
    expect(profile.firstVisit).toBe("1");
  });
});

describe("local profile and resources", () => {
  const json = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    return { status: res.status, body: (await res.json()) as any };
  };
  const post = (url: string, body: unknown) =>
    json(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("saves local profile name and picture settings", async () => {
    const s = await startServer({ noFacebookShim: true });
    const base = s.httpUrl;
    const initial = await json(`${base}/local/profile`);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ ok: true, userName: "Mayor", cityName: "Chocolate Fields", hasProfilePicture: false });

    const invalidSave = await post(`${base}/local/profile`, {
      userName: "Partially Saved Mayor",
      cityName: "Partially Saved City",
      profilePictureDataUrl: "not-an-image"
    });
    expect(invalidSave.status).toBe(400);
    expect((await json(`${base}/local/profile`)).body).toMatchObject({ userName: "Mayor", cityName: "Chocolate Fields", hasProfilePicture: false });

    const pictureDataUrl = "data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";
    const save = await post(`${base}/local/profile`, { userName: "Test Mayor", cityName: "Test Town", profilePictureDataUrl: pictureDataUrl });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ ok: true, userName: "Test Mayor", cityName: "Test Town", hasProfilePicture: true });

    const profile = s.profile();
    expect(profile.userName).toBe("Test Mayor");
    expect(profile.cityname).toBe("Test Town");
    expect(profile.cityNameCodes).toBe("84,101,115,116,32,84,111,119,110");
    expect(s.readDb((db) => db.user()?.name)).toBe("Test Mayor");
    const picture = await fetch(`${base}/local/profile-picture`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toContain("image/gif");
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(0);

    await s.restart();
    const restartedProfile = await json(`${s.httpUrl}/local/profile`);
    expect(restartedProfile.status).toBe(200);
    expect(restartedProfile.body).toMatchObject({ ok: true, userName: "Test Mayor", cityName: "Test Town", hasProfilePicture: true });
    const restartedPicture = await fetch(`${s.httpUrl}/local/profile-picture`);
    expect(restartedPicture.status).toBe(200);
    expect(restartedPicture.headers.get("content-type")).toContain("image/gif");
    expect((await restartedPicture.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const clear = await post(`${s.httpUrl}/local/profile`, { userName: "Test Mayor", cityName: "Test Town", clearProfilePicture: true });
    expect(clear.status).toBe(200);
    expect(clear.body).toMatchObject({ ok: true, userName: "Test Mayor", cityName: "Test Town", hasProfilePicture: false });
  });

  test("adjusts local money, gold, and xp settings", async () => {
    const s = await startServer({ noFacebookShim: true });
    const base = s.httpUrl;
    const cashToCoins = 60000; // settings.xml smCashToCoins (pinned in parity.conf.test.ts)
    const initial = await json(`${base}/local/resources`);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ ok: true, money: 380000, gold: 0, xp: 0, minXp: 0, maxXp: 470, companyValue: 720000 });

    const adjust = (resource: string, delta: number) => post(`${base}/local/resources/adjust`, { resource, delta });
    const addMoney = await adjust("money", 250);
    expect(addMoney.status).toBe(200);
    expect(addMoney.body).toMatchObject({ money: 380250, companyValue: 720250 });
    const removeMoney = await adjust("money", -1000);
    expect(removeMoney.status).toBe(200);
    expect(removeMoney.body).toMatchObject({ money: 379250, companyValue: 719250 });
    const addGold = await adjust("gold", 75);
    expect(addGold.status).toBe(200);
    expect(addGold.body).toMatchObject({ gold: 75, paidGold: 75, companyValue: 719250 + 75 * cashToCoins });
    const removeGold = await adjust("gold", -100);
    expect(removeGold.status).toBe(200);
    expect(removeGold.body).toMatchObject({ gold: 0, paidGold: 0, companyValue: 719250 });
    const addXp = await adjust("xp", 1000);
    expect(addXp.status).toBe(200);
    expect(addXp.body.xp).toBe(1000);
    expect(Number(addXp.body.level)).toBeGreaterThanOrEqual(1);
    expect(Number(addXp.body.maxXp)).toBeGreaterThan(Number(addXp.body.minXp));
    const removeXp = await adjust("xp", -2000);
    expect(removeXp.status).toBe(200);
    expect(removeXp.body).toMatchObject({ xp: 0, level: 1 });

    const profile = s.profile();
    expect(profile.DCCoins).toBe("379250");
    expect(profile.DCCash).toBe("0");
    expect(profile.DCCashPaid).toBe("0");
    expect(profile.companyValue).toBe("719250");
    expect(profile.exp).toBe("0");
    expect(profile.level).toBe("1");
  });
});

void request;
