import fs from "fs";
import path from "path";
import zlib from "zlib";
import express from "express";

const TEXT_TYPES = new Set([".js", ".mjs", ".css", ".json", ".html", ".svg", ".txt", ".xml"]);
const ONE_DAY = 86400;

/**
 * Static serving for the built client (apps/client/dist):
 *  - text/json: precompressed `.br`/`.gz` siblings (written by the vite build), else gzip on the fly (cached in memory)
 *  - `/assets/*` (hashed file names): immutable, 1 year
 *  - `/sprites /gui /ground /audio /fonts`: max-age=1 day + ETag/Last-Modified (express.static)
 *  - index.html: no-cache
 *  - `X.png` under gui/ground/sprites answers from `X.webp` when only the optimised file exists
 * `/Game` and the API routes are registered elsewhere and never pass through here.
 */
export function createClientStatic(root: string): express.RequestHandler[] {
  const gzCache = new Map<string, { mtime: number; body: Buffer }>();

  const webpFallback: express.RequestHandler = (req, _res, next) => {
    if ((req.method === "GET" || req.method === "HEAD") && req.path.endsWith(".png") && /^\/(gui|ground|sprites)\//.test(req.path)) {
      const rel = decodeURIComponent(req.path);
      const abs = path.join(root, rel);
      if (abs.startsWith(root) && !fs.existsSync(abs) && fs.existsSync(abs.slice(0, -4) + ".webp")) {
        req.url = req.url.replace(/\.png(\?|$)/, ".webp$1");
      }
    }
    next();
  };

  const compressed: express.RequestHandler = (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const rel = decodeURIComponent(req.path === "/" ? "/index.html" : req.path);
    const ext = path.extname(rel);
    if (!TEXT_TYPES.has(ext)) return next();
    const abs = path.join(root, rel);
    if (!abs.startsWith(root)) return next();
    const accept = String(req.headers["accept-encoding"] ?? "");
    let enc: "br" | "gzip" | undefined;
    let file: string | undefined;
    if (/\bbr\b/.test(accept) && fs.existsSync(abs + ".br")) { enc = "br"; file = abs + ".br"; }
    else if (/\bgzip\b/.test(accept) && fs.existsSync(abs + ".gz")) { enc = "gzip"; file = abs + ".gz"; }
    let body: Buffer | undefined;
    try {
      if (file) {
        body = fs.readFileSync(file);
      } else if (/\bgzip\b/.test(accept) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const mtime = fs.statSync(abs).mtimeMs;
        let c = gzCache.get(abs);
        if (!c || c.mtime !== mtime) {
          c = { mtime, body: zlib.gzipSync(fs.readFileSync(abs)) };
          gzCache.set(abs, c);
        }
        enc = "gzip";
        body = c.body;
      }
    } catch {
      return next();
    }
    if (!enc || !body) return next();
    const st = fs.statSync(file ? abs : abs);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("ETag", etag);
    res.setHeader("Content-Encoding", enc);
    res.type(ext);
    res.setHeader("Cache-Control", cacheControl(rel));
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Length", String(body.length));
    res.end(req.method === "HEAD" ? undefined : body);
  };

  const files = express.static(root, {
    index: "index.html",
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      res.setHeader("Cache-Control", cacheControl("/" + path.relative(root, filePath).split(path.sep).join("/")));
    }
  });
  return [webpFallback, compressed, files];
}

function cacheControl(rel: string): string {
  if (rel.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (rel === "/index.html" || rel === "/") return "no-cache";
  return `public, max-age=${ONE_DAY}`;
}
