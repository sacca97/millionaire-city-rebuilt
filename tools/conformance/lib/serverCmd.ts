import path from "node:path";

// No vitest import here: globalSetup uses this file.
/** Repository root (the default cwd of the server command). */
export const SERVER_DIR = path.resolve(__dirname, "../../..");
/** The Rust release binary (`make server` / `cargo build --release` in apps/server-rs); `.exe` on Windows. */
export const DEFAULT_SERVER_CMD = path.join(SERVER_DIR, "apps", "server-rs", "target", "release", process.platform === "win32" ? "mcity-server.exe" : "mcity-server");
