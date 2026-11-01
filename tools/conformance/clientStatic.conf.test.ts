// Black-box port of apps/server/test/clientStatic.test.ts: the server is started with MCITY_CLIENT_DIST pointing at a
// temp directory with the same fixture files, instead of mounting createClientStatic() on a test express app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { sharedServer } from "./lib/server.js";

const big = JSON.stringify({ a: "x".repeat(2000) });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "conf-static-"));
fs.mkdirSync(path.join(root, "assets"));
fs.mkdirSync(path.join(root, "gui/x"), { recursive: true });
fs.mkdirSync(path.join(root, "sprites"));
fs.writeFileSync(path.join(root, "index.html"), "<html></html>");
fs.writeFileSync(path.join(root, "assets/app-abc.js"), "console.log(1);".repeat(100));
fs.writeFileSync(path.join(root, "assets/app-abc.js.gz"), zlib.gzipSync("console.log(1);".repeat(100)));
fs.writeFileSync(path.join(root, "assets/app-abc.js.br"), zlib.brotliCompressSync("console.log(1);".repeat(100)));
fs.writeFileSync(path.join(root, "sprites/index.json"), big);
fs.writeFileSync(path.join(root, "gui/x/1.webp"), Buffer.from("RIFFxxxxWEBP"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const server = sharedServer({ clientDist: root, noFacebookShim: true });
const get = (p: string, h: Record<string, string> = {}) => fetch(`${server().httpUrl}${p}`, { headers: h });

describe("client static serving", () => {
  test("hashed assets are immutable and precompressed (br preferred)", async () => {
    const r = await get("/assets/app-abc.js", { "accept-encoding": "br, gzip" });
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("content-encoding")).toBe("br");
    expect(r.headers.get("vary")).toContain("Accept-Encoding");
    expect(await r.text()).toBe("console.log(1);".repeat(100));
  });
  test("json without precompressed file is gzipped on the fly, with ETag and 304", async () => {
    const r = await get("/sprites/index.json", { "accept-encoding": "gzip" });
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
    const etag = r.headers.get("etag")!;
    expect(await r.text()).toBe(big);
    const r2 = await get("/sprites/index.json", { "accept-encoding": "gzip", "if-none-match": etag });
    expect(r2.status).toBe(304);
  });
  test("identity when the client does not accept compression; index.html no-cache", async () => {
    const r = await get("/index.html", { "accept-encoding": "identity" });
    expect(r.headers.get("content-encoding")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("no-cache");
  });
  test("png URL is answered from the webp sibling", async () => {
    const r = await get("/gui/x/1.png");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
  });
});
