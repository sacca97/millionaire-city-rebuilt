// Opt-in helper for MCITY_ORACLE_SERVER_CMD runs (the Rust server has no cmdlog hook): a transparent proxy in front of it that appends every
// cmdList POST to MCITY_CMDLOG (the format of the old cmdlog.cjs preload). usage: node cmdlog-proxy.cjs <pubBase> <innerBase> <hostsCertDir>
// public ports pubBase(http), +1(https), +2(facebook shim https) forward to innerBase, +1, +2 on 127.0.0.1 (https inner is not verified).
const http = require("node:http"), https = require("node:https"), fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const [pub, inner, dir] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const file = process.env.MCITY_CMDLOG;
fs.mkdirSync(dir, { recursive: true });
const key = path.join(dir, "k.pem"), crt = path.join(dir, "c.pem");
cp.execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,DNS:*.facebook.com,DNS:facebook.com,IP:127.0.0.1"], { stdio: "ignore" });
const tls = { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
const handler = (innerPort, secure) => (req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (file && req.method === "POST") { try { const b = body.toString(); if (b.includes("cmdList")) fs.appendFileSync(file, JSON.stringify({ t: Date.now(), url: req.url, body: decodeURIComponent(b.replace(/\+/g, " ")) }) + "\n"); } catch {} }
    // the server writes its own (inner) ports into launcher pages / redirects: map them back to the public ones so the client stays on the proxy
    const fix = (t) => { for (const k of [2, 1, 0]) for (const c of [":", "%3A", "%3a", "\\u003a"]) t = t.split(c + (inner + k)).join(c + (pub + k)); return t; };
    const headers = { ...req.headers }; delete headers["accept-encoding"];
    const up = (secure ? https : http).request({ host: "127.0.0.1", port: innerPort, path: req.url, method: req.method, headers, rejectUnauthorized: false }, (r) => {
      const h = { ...r.headers }; if (h.location) h.location = fix(h.location);
      if (/text|json|xml|javascript/.test(String(h["content-type"] ?? ""))) {
        const parts = []; r.on("data", (c) => parts.push(c));
        r.on("end", () => { const out = Buffer.from(fix(Buffer.concat(parts).toString("utf8"))); h["content-length"] = String(out.length); res.writeHead(r.statusCode, h); res.end(out); });
      } else { res.writeHead(r.statusCode, h); r.pipe(res); }
    });
    up.on("error", (e) => { res.statusCode = 502; res.end(String(e)); });
    up.end(body);
  });
};
http.createServer(handler(inner, false)).listen(pub);
https.createServer(tls, handler(inner + 1, true)).listen(pub + 1);
https.createServer(tls, handler(inner + 2, true)).listen(pub + 2);
