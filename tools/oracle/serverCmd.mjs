// Game server for the harness: the Rust binary, started behind cmdlog-proxy.cjs (which keeps the cmds.jsonl log). Default
// apps/server-rs/target/release/mcity-server, else the debug build; MCITY_ORACLE_SERVER_CMD=<path to a binary> overrides.
// Inner (real) server ports: MCITY_ORACLE_INNER_BASE,
// default 31863 when the public base is 31853, 31853 when it is 31863, else base+10.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "../..");
const exe = process.platform === "win32" ? "mcity-server.exe" : "mcity-server";
const targetBin = (profile) => path.join(root, "apps/server-rs/target", profile, exe);
export const serverCmd = process.env.MCITY_ORACLE_SERVER_CMD || (fs.existsSync(targetBin("release")) ? targetBin("release") : targetBin("debug"));
if (!fs.existsSync(serverCmd)) throw new Error(`server binary not found: ${serverCmd}. Run \`make server\` or set MCITY_ORACLE_SERVER_CMD.`);
// returns [{cmd,args,opts,log}] to spawn (proxy first). env: the vars the server gets (MCITY_DB_PATH, MCITY_CMDLOG, ...).
export function rustServerSpecs({ pubBase, dbPath, cmdlog, tmp }) {
  const inner = Number(process.env.MCITY_ORACLE_INNER_BASE ?? (pubBase === 31853 ? 31863 : pubBase === 31863 ? 31853 : pubBase + 10));
  const env = { ...process.env, MCITY_DB_PATH: dbPath, MCITY_WORKSPACE_ROOT: root, MCITY_HTTP_PORT: inner, MCITY_HTTPS_PORT: inner + 1, MCITY_FACEBOOK_PORT: inner + 2 };
  return [
    { cmd: process.execPath, args: [path.join(here, "cmdlog-proxy.cjs"), String(pubBase), String(inner), path.join(tmp, "proxy-cert")], opts: { cwd: root, env: { ...process.env, MCITY_CMDLOG: cmdlog } }, log: "proxy.log" },
    { cmd: serverCmd, args: [], opts: { cwd: root, env }, log: "server.log" },
  ];
}
