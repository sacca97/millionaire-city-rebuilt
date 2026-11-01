// beforeBuildCommand: builds the web client that the app bundles (apps/client/dist), with the optimised art when public-opt exists.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32", ...opts });
const opt = fs.existsSync(path.join(root, "apps/client/public-opt")) && process.env.OPT !== "0";
console.log(`[desktop] building the client (${opt ? "optimised" : "original"} assets)`);
run("npm", ["run", "build", "-w", "@mcity/shared"]);
run("npx", ["vite", "build"], { cwd: path.join(root, "apps/client"), env: { ...process.env, ...(opt ? { MCITY_OPT: "1" } : {}) } });
