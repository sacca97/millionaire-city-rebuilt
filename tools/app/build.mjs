// Stages the desktop bundle in tools/app/stage and optionally packs it with electron-builder (--pack).
// Run on the OS you are building for (better-sqlite3 and the Node runtime are platform specific).
//   cd tools/app && npm install && node build.mjs --pack
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const stage = path.join(here, "stage");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32", ...opts });
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true });

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 1. client (optimised assets when public-opt exists)
const opt = fs.existsSync(path.join(root, "apps/client/public-opt"));
console.log(`[app] building client (${opt ? "optimised" : "original"} assets)`);
run("npm", ["run", "build", "-w", "@mcity/shared"]);
run("npx", ["vite", "build", "--outDir", path.join(stage, "apps/client/dist")], { cwd: path.join(root, "apps/client"), env: { ...process.env, ...(opt ? { MCITY_OPT: "1" } : {}) } });

// 2. server bundle (everything inlined except the native module)
console.log("[app] bundling server");
run("npx", ["esbuild", "apps/server/src/main.ts", "--bundle", "--platform=node", "--target=node20", "--external:better-sqlite3", `--outfile=${path.join(stage, "apps/server/dist/main.js")}`, "--log-level=warning"]);
copy(path.join(root, "apps/server/assets"), path.join(stage, "apps/server/assets"));
copy(path.join(root, "assets"), path.join(stage, "assets"));

// 3. native module and its runtime dependencies
for (const mod of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  const src = path.join(root, "node_modules", mod);
  const dst = path.join(stage, "node_modules", mod);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (["deps", "src", "build"].includes(f)) continue;
    copy(path.join(src, f), path.join(dst, f));
  }
  if (mod === "better-sqlite3") copy(path.join(src, "build/Release/better_sqlite3.node"), path.join(dst, "build/Release/better_sqlite3.node"));
}

// 4. Node runtime (same ABI as the .node file above) and the Electron shell
const nodeDir = path.join(stage, "runtime", "node");
fs.mkdirSync(nodeDir, { recursive: true });
const nodeExe = process.platform === "win32" ? "node.exe" : "node";
fs.copyFileSync(process.execPath, path.join(nodeDir, nodeExe));
if (process.platform !== "win32") fs.chmodSync(path.join(nodeDir, nodeExe), 0o755);
fs.copyFileSync(path.join(here, "main.cjs"), path.join(stage, "main.cjs"));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, main: "main.cjs", author: pkg.author }, null, 2));
console.log(`[app] staged in ${stage}`);

if (process.argv.includes("--pack")) run("npx", ["electron-builder", "--publish", "never"], { cwd: here });
