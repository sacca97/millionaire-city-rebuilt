// Starts the real game server (the Rust binary of apps/server-rs) on free ports with a given SQLite file, for the integration tests.
// Binary: MCITY_SERVER_BIN, else apps/server-rs/target/release/mcity-server, else target/debug (build it with `make server`).
// The server caches documents in memory: write to the database file only while it is stopped (setDocument).
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(__dirname, "../../..");
const EXE = process.platform === "win32" ? "mcity-server.exe" : "mcity-server";
export const DEFAULT_UID = "100000000000001";

function serverBinary(): string {
  const candidates = [process.env.MCITY_SERVER_BIN, path.join(ROOT, "apps/server-rs/target/release", EXE), path.join(ROOT, "apps/server-rs/target/debug", EXE)];
  const found = candidates.find((c): c is string => Boolean(c) && fs.existsSync(c as string));
  if (!found) throw new Error("server binary not found: run `make server` (cargo build --release in apps/server-rs) or set MCITY_SERVER_BIN");
  return found;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TestServer {
  readonly uid = DEFAULT_UID;
  baseUrl = "";
  private child?: ChildProcess;
  private exited?: Promise<void>;
  private log = "";

  constructor(readonly dbPath: string) {}

  async start(): Promise<void> {
    const [http, https, fb] = [await freePort(), await freePort(), await freePort()];
    this.baseUrl = `http://127.0.0.1:${http}`;
    const env = { ...process.env, MCITY_DB_PATH: this.dbPath, MCITY_HTTP_PORT: String(http), MCITY_HTTPS_PORT: String(https), MCITY_FACEBOOK_PORT: String(fb), MCITY_DISABLE_FB_SHIM: "1" };
    const child = spawn(serverBinary(), [], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    child.stdout?.on("data", (d) => { this.log = (this.log + d).slice(-4000); });
    child.stderr?.on("data", (d) => { this.log = (this.log + d).slice(-4000); });
    let early = false;
    this.exited = new Promise<void>((resolve) => child.once("exit", () => { early = true; resolve(); }));
    for (let i = 0; i < 600; i++) {
      if (early) throw new Error(`server exited early:\n${this.log}`);
      try {
        const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
        await res.arrayBuffer();
        if (res.status === 200 || res.status === 400) return;
      } catch { /* not up yet */ }
      await sleep(50);
    }
    throw new Error(`server not healthy:\n${this.log}`);
  }

  /** SIGTERM (graceful: pending writes are flushed), SIGKILL after 5 s. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await this.exited;
    clearTimeout(timer);
  }

  /** One stored document of the player (read-only connection, safe while the server runs). */
  getDocument<T = Record<string, unknown>>(tag: string, userId = 1): T {
    const db = new Database(this.dbPath, { readonly: true });
    try {
      const row = db.prepare("select json from save_documents where user_id = ? and tag = ?").get(userId, tag) as { json: string } | undefined;
      return JSON.parse(row!.json) as T;
    } finally {
      db.close();
    }
  }
}

/** Replace a stored document. Only valid while no server runs on that file. */
export function setDocument(dbPath: string, tag: string, doc: unknown, userId = 1): void {
  const db = new Database(dbPath);
  try {
    db.prepare("update save_documents set json = ?, updated_at = ? where user_id = ? and tag = ?").run(JSON.stringify(doc), new Date().toISOString(), userId, tag);
  } finally {
    db.close();
  }
}

export async function startTestServer(dbPath: string): Promise<TestServer> {
  const server = new TestServer(dbPath);
  try {
    await server.start();
  } catch (e) {
    await server.stop();
    throw e;
  }
  return server;
}
