import { execFileSync } from "node:child_process";
import path from "node:path";

// No vitest import here: globalSetup uses this file.
/** Repository root (the default cwd of the server command). */
export const SERVER_DIR = path.resolve(__dirname, "../../..");

/** Conventional cargo path, used when the resolver cannot run (no cargo/node). */
function conventionalServerCmd(): string {
  return path.join(SERVER_DIR, "apps", "server-rs", "target", "release", process.platform === "win32" ? "mcity-server.exe" : "mcity-server");
}

/**
 * The Rust release binary (`make server` / `cargo build --release` in apps/server-rs), resolved through
 * `tools/server-binary.mjs` so a global CARGO_TARGET_DIR or cargo `build.target-dir` is honoured.
 */
export const DEFAULT_SERVER_CMD = ((): string => {
  try {
    const resolved = execFileSync(process.execPath, [path.join(SERVER_DIR, "tools", "server-binary.mjs")], { encoding: "utf8" }).trim();
    if (resolved) return resolved;
  } catch {
    // fall through to the conventional path; globalSetup reports the missing binary
  }
  return conventionalServerCmd();
})();
