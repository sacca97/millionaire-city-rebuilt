// Preload for the game server (NODE_OPTIONS=--require tools/oracle/cmdlog.cjs, MCITY_CMDLOG=<file>): appends every cmdList payload
// the client posts (passive 'data' listener; does not consume the body) so original and rewrite command payloads can be diffed.
const fs = require("node:fs"), http = require("node:http"), { EventEmitter } = require("node:events");
const file = process.env.MCITY_CMDLOG;
if (file) {
  const orig = EventEmitter.prototype.emit;
  EventEmitter.prototype.emit = function (ev, ...a) {
    if (ev === "request" && a[0] instanceof http.IncomingMessage && a[0].method === "POST") {
      const req = a[0], chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => { try { const b = Buffer.concat(chunks).toString(); if (b.includes("cmdList")) fs.appendFileSync(file, JSON.stringify({ t: Date.now(), url: req.url, body: decodeURIComponent(b.replace(/\+/g, " ")) }) + "\n"); } catch {} });
    }
    return orig.call(this, ev, ...a);
  };
}
