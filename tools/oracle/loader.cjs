// Minimal Electron 10 loader for the ORIGINAL Flash client (Pepper Flash).
// Env: ORACLE_URL, ORACLE_CTL_PORT, ORACLE_FB_PORT, ORACLE_W/H
const path = require("path");
const http = require("http");
const { app, BrowserWindow, session } = require("electron");
const W = +process.env.ORACLE_W || 1280, H = +process.env.ORACLE_H || 800;
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("ppapi-flash-path", path.join(__dirname, "flash/libpepflashplayer.so"));
app.commandLine.appendSwitch("ppapi-flash-version", "32.0.0.303");
// default (ORACLE_FB_MAP=0 restores the old redirect): map graph/api.facebook.com to the shim at the network layer (Flash then sees no redirect, so its policy-file check passes)
if (process.env.ORACLE_FB_MAP !== "0") app.commandLine.appendSwitch("host-resolver-rules", `MAP graph.facebook.com 127.0.0.1:${process.env.ORACLE_FB_PORT}, MAP api.facebook.com 127.0.0.1:${process.env.ORACLE_FB_PORT}`);
app.on("certificate-error", (e, c, u, err, cert, cb) => { e.preventDefault(); cb(true); });
let win;
app.whenReady().then(() => {
  const fb = `https://127.0.0.1:${process.env.ORACLE_FB_PORT}`;
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    try {
      const u = new URL(d.url);
      if (process.env.ORACLE_FB_MAP === "0" && u.protocol === "https:" && ["graph.facebook.com", "api.facebook.com"].includes(u.hostname))
        return cb({ redirectURL: fb + u.pathname + u.search });
    } catch {}
    cb({});
  });
  win = new BrowserWindow({ width: W, height: H, useContentSize: true, x: 0, y: 0, frame: false, resizable: false,
    webPreferences: { plugins: true, sandbox: false, contextIsolation: true, nodeIntegration: false } });
  // offline NPC friends (Rust server): the page hook that answers "Send Investment Request"; a 404 (TS server) changes nothing
  win.webContents.on("dom-ready", () => {
    if (win.webContents.getURL().includes("/launcher")) win.webContents.executeJavaScript(`(function(){var s=document.createElement('script');s.src='/local/npc-friends.js';document.head.appendChild(s);})()`).catch(() => {});
  });
  win.webContents.on("console-message", (_e, l, m) => console.log(`[renderer:${l}] ${m}`));
  win.loadURL(process.env.ORACLE_URL);
  http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"); const q = Object.fromEntries(u.searchParams);
    try {
      if (u.pathname === "/shot") {
        const img = await win.webContents.capturePage(); res.setHeader("content-type", "image/png"); return res.end(img.toPNG());
      }
      if (u.pathname === "/mouse") { // type=click|move|down|up x y
        const wc = win.webContents, x = +q.x, y = +q.y, o = { x, y, button: "left", clickCount: 1 };
        wc.sendInputEvent({ type: "mouseMove", x, y });
        if (q.type === "click" || q.type === "down") wc.sendInputEvent({ ...o, type: "mouseDown" });
        if (q.type === "click" || q.type === "up") wc.sendInputEvent({ ...o, type: "mouseUp" });
        return res.end("ok");
      }
      if (u.pathname === "/key") { win.webContents.sendInputEvent({ type: "keyDown", keyCode: q.key }); win.webContents.sendInputEvent({ type: "char", keyCode: q.key }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: q.key }); return res.end("ok"); }
      if (u.pathname === "/eval") { return res.end(JSON.stringify(await win.webContents.executeJavaScript(q.js, true))); }
      if (u.pathname === "/quit") { res.end("bye"); return app.quit(); }
      res.statusCode = 404; res.end();
    } catch (e) { res.statusCode = 500; res.end(String(e)); }
  }).listen(+process.env.ORACLE_CTL_PORT, "127.0.0.1");
});
