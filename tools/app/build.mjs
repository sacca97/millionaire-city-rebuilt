// Stages the desktop bundle in tools/app/stage and optionally packs it with electron-builder (--pack).
// Run on the OS and CPU architecture you are building for (better-sqlite3 and the Node runtime are platform specific).
//   cd tools/app && npm ci && node build.mjs --pack [electron-builder args, e.g. --mac --arm64]
// Every argument except --pack is passed on to electron-builder.
import { execFileSync } from "node:child_process";
import os from "node:os";
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
const passthrough = process.argv.slice(2).filter((a) => a !== "--pack");
const targetArch = passthrough.includes("--arm64") ? "arm64" : passthrough.includes("--x64") ? "x64" : process.arch;
if (targetArch !== process.arch) {
  throw new Error(`building for ${targetArch} on a ${process.arch} machine is not supported (native module and Node runtime are per architecture): build on a matching machine`);
}
const nodeDir = path.join(stage, "runtime", "node");
fs.mkdirSync(nodeDir, { recursive: true });
const nodeExe = process.platform === "win32" ? "node.exe" : "node";
const nodeDst = path.join(nodeDir, nodeExe);
if (process.platform === "darwin") {
  // Homebrew's node is a thin launcher around libnode.dylib and crashes when copied alone: use the official standalone binary of the same version.
  const v = process.versions.node;
  const name = `node-v${v}-darwin-${process.arch}`;
  const cache = path.join(here, ".cache");
  fs.mkdirSync(cache, { recursive: true });
  const tgz = path.join(cache, `${name}.tar.gz`);
  if (!fs.existsSync(tgz)) {
    console.log(`[app] downloading ${name}`);
    run("curl", ["-fL", "--retry", "3", "-o", tgz, `https://nodejs.org/dist/v${v}/${name}.tar.gz`], { shell: false });
  }
  run("tar", ["-xzf", tgz, "-C", nodeDir, "--strip-components=2", `${name}/bin/node`], { shell: false });
} else {
  fs.copyFileSync(process.execPath, nodeDst);
}
if (process.platform !== "win32") fs.chmodSync(nodeDst, 0o755);

// 5. the staged runtime must run, match the target architecture and open SQLite (the failure otherwise shows up only at first launch)
const probe = [
  "const Db=require('better-sqlite3');",
  "const r=new Db(':memory:').prepare('select 1 as ok').get();",
  "if(r.ok!==1) throw new Error('sqlite probe failed');",
  "console.log(process.arch+' '+process.version+' sqlite ok');"
].join("");
const probeOut = execFileSync(nodeDst, ["-e", probe], { cwd: stage, encoding: "utf8", env: { ...process.env, NODE_PATH: path.join(stage, "node_modules") } }).trim();
if (!probeOut.startsWith(targetArch)) throw new Error(`staged Node runtime is ${probeOut}, expected ${targetArch}`);
console.log(`[app] runtime check: ${probeOut} (${os.platform()})`);
fs.copyFileSync(path.join(here, "main.cjs"), path.join(stage, "main.cjs"));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, main: "main.cjs", author: pkg.author }, null, 2));
console.log(`[app] staged in ${stage}`);

if (process.argv.includes("--pack")) run("npx", ["electron-builder", "--publish", "never", ...passthrough], { cwd: here });
