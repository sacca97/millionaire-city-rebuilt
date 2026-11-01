import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SERVER_CMD } from "./serverCmd.js";

/** Remove port locks / temp dirs that a crashed earlier run left behind (older than 15 minutes). */
export default function setup(): () => void {
  if (!process.env.MCITY_SERVER_CMD && !fs.existsSync(DEFAULT_SERVER_CMD)) {
    throw new Error(`server binary not found: ${DEFAULT_SERVER_CMD}. Run \`make server\` (cargo build --release in apps/server-rs) or set MCITY_SERVER_CMD.`);
  }
  const tmp = os.tmpdir();
  const now = Date.now();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith("conf-")) continue;
    const full = path.join(tmp, name);
    try {
      if (now - fs.statSync(full).mtimeMs > 15 * 60_000) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return () => undefined;
}
