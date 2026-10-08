// Electron downloads its runtime in its own install script; that step is skipped by `npm ci --ignore-scripts`, blocked networks and
// some CI caches. Run it here when the binary is missing so `npm start` / packaging fail with a clear message instead of "not installed".
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const dir = path.join(__dirname, "node_modules", "electron");
if (!fs.existsSync(dir)) {
  console.error("electron is not installed: run `npm ci` in tools/app first");
  process.exit(1);
}
if (!fs.existsSync(path.join(dir, "path.txt")) || !fs.existsSync(path.join(dir, "dist"))) {
  console.log("[app] downloading the Electron runtime");
  const r = spawnSync(process.execPath, [path.join(dir, "install.js")], { stdio: "inherit", cwd: dir });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
