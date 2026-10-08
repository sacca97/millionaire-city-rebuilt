// Electron shell: starts the bundled game server with the bundled Node runtime (so better-sqlite3 needs no Electron ABI rebuild)
// and shows the game in a window. Save data lives in the OS user-data folder.
const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

let server = null;
let win = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function nodePath() {
  const exe = process.platform === "win32" ? "node.exe" : "node";
  return path.join(__dirname, "runtime", "node", exe);
}

function waitReady(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => (Date.now() - start > timeoutMs ? reject(new Error("server did not start")) : setTimeout(tick, 300)));
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

async function start() {
  const port = await freePort();
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = fs.openSync(path.join(app.getPath("userData"), "server.log"), "a");
  server = spawn(nodePath(), [path.join(__dirname, "apps", "server", "dist", "main.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      MCITY_HTTP_PORT: String(port),
      MCITY_HTTPS_PORT: String(await freePort()),
      MCITY_DISABLE_FB_SHIM: "1",
      MCITY_DB_PATH: process.env.MCITY_DB_PATH || path.join(dataDir, "mcity.sqlite")
    },
    stdio: ["ignore", logFile, logFile],
    windowsHide: true
  });
  server.on("exit", (code, signal) => {
    const how = code !== null ? `code ${code}` : `signal ${signal}`;
    if (!app.isQuitting) dialog.showErrorBox("Millionaire City", `The game server stopped (${how}). See server.log in ${app.getPath("userData")}.`);
    app.quit();
  });
  await waitReady(port, 60000);
  win = new BrowserWindow({ width: 1280, height: 800, backgroundColor: "#87ceeb", autoHideMenuBar: true, title: "Millionaire City", webPreferences: { contextIsolation: true } });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.on("before-quit", () => {
  app.isQuitting = true;
  if (server && !server.killed) server.kill();
});
app.on("window-all-closed", () => app.quit());
app.whenReady().then(() => start().catch((e) => { dialog.showErrorBox("Millionaire City", String(e && e.message || e)); app.quit(); }));
