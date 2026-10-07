import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import express from "express";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClientStatic } from "../src/clientStatic.js";

const PORT = 31943;
const big = JSON.stringify({ a: "x".repeat(2000) });
let server: Server;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mcity-static-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.mkdirSync(path.join(root, "gui/x"), { recursive: true });
  fs.mkdirSync(path.join(root, "sprites"));
  fs.writeFileSync(path.join(root, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(root, "assets/app-abc.js"), "console.log(1);".repeat(100));
  fs.writeFileSync(path.join(root, "assets/app-abc.js.gz"), zlib.gzipSync("console.log(1);".repeat(100)));
  fs.writeFileSync(path.join(root, "assets/app-abc.js.br"), zlib.brotliCompressSync("console.log(1);".repeat(100)));
  fs.writeFileSync(path.join(root, "sprites/index.json"), big);
  fs.writeFileSync(path.join(root, "gui/x/1.webp"), Buffer.from("RIFFxxxxWEBP"));
  const app = express();
  app.use(createClientStatic(root));
  await new Promise<void>((r) => (server = app.listen(PORT, "127.0.0.1", r)));
});
afterAll(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});
const get = (p: string, h: Record<string, string> = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: h });

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
