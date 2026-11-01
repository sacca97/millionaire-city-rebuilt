import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll } from "vitest";
import { SaveDb, universeCtx, type UniverseCtx } from "./db.js";

import { DEFAULT_SERVER_CMD, SERVER_DIR } from "./serverCmd.js";
export { DEFAULT_SERVER_CMD, SERVER_DIR };
export const PORT_RANGE = { min: 32200, max: 32399 };
export const DEFAULT_UID = "100000000000001";

/** Env vars the server reads; anything else MCITY_* from the caller's shell is removed so runs are reproducible. */
const SERVER_ENV_KEYS = [
  "MCITY_HTTP_PORT", "MCITY_HTTPS_PORT", "MCITY_FACEBOOK_PORT", "MCITY_DB_PATH", "MCITY_UID", "MCITY_LANG",
  "MCITY_DISABLE_FB_SHIM", "MCITY_REQUIRE_FB_SHIM", "MCITY_LAUNCH_SECRET", "MCITY_CLIENT_DIST",
  "MCITY_SWF_DEBUG", "MCITY_USE_CLIMATE", "MCITY_OLD_ITEM_DESIGNS"
];

export interface StartOptions {
  /** Extra env for the server (overrides the harness defaults). */
  env?: Record<string, string>;
  /** Do not enable the Facebook stand-in (sets MCITY_DISABLE_FB_SHIM=1). */
  noFacebookShim?: boolean;
  /** Directory served as the built client (MCITY_CLIENT_DIST). Default: a non-existent dir, so no client is served. */
  clientDist?: string;
  /** Use already reserved ports instead of picking free ones (for "port is busy" tests). */
  ports?: Partial<{ http: number; https: number; facebook: number }>;
  /** Do not wait for /health and do not fail when the process exits: used for "server must fail to start" tests. */
  expectStartFailure?: boolean;
}

const activeGroups = new Set<number>();
const activeDirs = new Set<string>();
const heldLocks = new Set<string>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Last resort when the test process itself dies: kill exactly the process groups this process started.
  process.on("exit", () => {
    for (const pid of activeGroups) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    }
    for (const dir of activeDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    for (const lock of heldLocks) {
      try { fs.rmdirSync(lock); } catch { /* ignore */ }
    }
  });
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

/** Reserve a free port in 32200-32399. A lock directory makes the reservation atomic across vitest worker processes. */
export async function reservePort(): Promise<number> {
  const span = PORT_RANGE.max - PORT_RANGE.min + 1;
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const port = PORT_RANGE.min + Math.floor(Math.random() * span);
    const lock = path.join(os.tmpdir(), `conf-port-${port}`);
    try {
      fs.mkdirSync(lock);
    } catch {
      continue;
    }
    if (await canBind(port)) {
      heldLocks.add(lock);
      installExitHook();
      return port;
    }
    fs.rmdirSync(lock);
  }
  throw new Error("no free port in 32200-32399");
}

export function releasePort(port: number): void {
  const lock = path.join(os.tmpdir(), `conf-port-${port}`);
  heldLocks.delete(lock);
  try { fs.rmdirSync(lock); } catch { /* ignore */ }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One server-under-test: a child process (own process group) from MCITY_SERVER_CMD on its own free ports and temp DB.
 * The database file is the only state channel: use `readDb` / `seed` / `restartWith`, never the server's internals.
 */
export class ServerHandle {
  readonly dir: string;
  readonly dbPath: string;
  readonly uid = DEFAULT_UID;
  httpPort = 0;
  httpsPort = 0;
  facebookPort = 0;
  child?: ChildProcess;
  exitCode?: number | null;
  exited?: Promise<number | null>;
  private logPath: string;
  private cleaned = false;
  private reserved: number[] = [];

  constructor(private readonly options: StartOptions = {}) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "conf-"));
    this.dbPath = path.join(this.dir, "save.sqlite");
    this.logPath = path.join(this.dir, "server.log");
    activeDirs.add(this.dir);
    installExitHook();
  }

  get httpUrl(): string { return `http://127.0.0.1:${this.httpPort}`; }
  get httpsUrl(): string { return `https://127.0.0.1:${this.httpsPort}`; }
  get facebookUrl(): string { return `https://127.0.0.1:${this.facebookPort}`; }
  get running(): boolean { return Boolean(this.child) && this.exitCode === undefined; }

  async start(): Promise<void> {
    if (this.running) throw new Error("server already running");
    const o = this.options;
    const pick = async (given: number | undefined): Promise<number> => {
      if (given) return given;
      const port = await reservePort();
      this.reserved.push(port);
      return port;
    };
    if (!this.httpPort) this.httpPort = await pick(o.ports?.http);
    if (!this.httpsPort) this.httpsPort = await pick(o.ports?.https);
    if (!this.facebookPort) this.facebookPort = await pick(o.ports?.facebook);

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of SERVER_ENV_KEYS) delete env[key];
    Object.assign(env, {
      MCITY_HTTP_PORT: String(this.httpPort),
      MCITY_HTTPS_PORT: String(this.httpsPort),
      MCITY_FACEBOOK_PORT: String(this.facebookPort),
      MCITY_DB_PATH: this.dbPath,
      MCITY_CLIENT_DIST: o.clientDist ?? path.join(this.dir, "no-client-dist")
    });
    if (o.noFacebookShim) env.MCITY_DISABLE_FB_SHIM = "1";
    Object.assign(env, o.env ?? {});

    const cmd = process.env.MCITY_SERVER_CMD || `"${DEFAULT_SERVER_CMD}"`;
    const logFd = fs.openSync(this.logPath, "a");
    // `exec` so the shell does not linger; detached = own process group, killed as a whole in stop().
    const child = spawn("sh", ["-c", `exec ${cmd}`], {
      cwd: process.env.MCITY_SERVER_CWD || SERVER_DIR,
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd]
    });
    fs.closeSync(logFd);
    this.child = child;
    this.exitCode = undefined;
    const pid = child.pid!;
    activeGroups.add(pid);
    this.exited = new Promise<number | null>((resolve) => {
      child.once("exit", (code, signal) => {
        this.exitCode = code ?? (signal ? 128 : 0);
        resolve(code);
      });
      child.once("error", () => {
        this.exitCode = -1;
        resolve(-1);
      });
    });

    if (o.expectStartFailure) return;
    await this.waitHealthy(60_000);
  }

  private async waitHealthy(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitCode !== undefined) {
        throw new Error(`server exited early (code ${this.exitCode}). Log:\n${this.logTail()}`);
      }
      try {
        const res = await fetch(`${this.httpUrl}/health`, { signal: AbortSignal.timeout(1500) });
        if (res.status === 200 || res.status === 400) {
          await res.arrayBuffer();
          return;
        }
      } catch {
        /* not up yet */
      }
      await sleep(40);
    }
    throw new Error(`server not healthy after ${timeoutMs}ms. Log:\n${this.logTail()}`);
  }

  logTail(lines = 40): string {
    try {
      return fs.readFileSync(this.logPath, "utf8").split("\n").slice(-lines).join("\n");
    } catch {
      return "(no log)";
    }
  }

  /** SIGTERM the whole process group (the servers shut down gracefully), SIGKILL after a grace period. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const pid = child.pid!;
    if (this.exitCode === undefined) {
      try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
      const result = await Promise.race([this.exited, sleep(4000).then(() => "timeout" as const)]);
      if (result === "timeout") {
        try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
        await this.exited;
      }
    }
    // Reap anything the shell/npx left behind in the group.
    try { process.kill(-pid, "SIGKILL"); } catch { /* nothing left */ }
    activeGroups.delete(pid);
    this.child = undefined;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Open the save database read-only (safe while the server runs: SQLite WAL). */
  readDb<T>(fn: (db: SaveDb) => T): T {
    const db = new SaveDb(this.dbPath, true);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  /** Convenience: one stored document (parsed JSON). */
  doc<T = any>(tag: string): T {
    return this.readDb((db) => db.doc<T>(tag)) as T;
  }

  meta(key: string): string | undefined {
    return this.readDb((db) => db.meta(key));
  }

  /** The stored universe with handles: `.profile`, `.mine`, `.rival`, `.worldContainer`. */
  ctx(): UniverseCtx {
    return universeCtx(this.doc("universe"));
  }

  /** The stored Profile container (DCCoins, DCCash, exp, tutorialEnd, flags, ...). */
  profile(): any {
    return this.ctx().profile;
  }

  /**
   * Write state. Documented pattern: STOP the server, write through the SQLite file, START it again, so a server that
   * caches documents in memory (the Rust one may) sees the seeded state. Set CONF_LIVE_SEED=1 to write while the
   * server runs (faster; only valid for servers that read the database on every request, like the TS server).
   */
  async seed(fn: (db: SaveDb) => void): Promise<void> {
    if (process.env.CONF_LIVE_SEED === "1") {
      this.writeDb(fn);
      return;
    }
    await this.restartWith(fn);
  }

  /** Always stop -> write -> start. Use when the test is about what the server does at startup (migration, normalizers). */
  async restartWith(fn?: (db: SaveDb) => void): Promise<void> {
    await this.stop();
    if (fn) this.writeDb(fn);
    await this.start();
  }

  private writeDb(fn: (db: SaveDb) => void): void {
    const db = new SaveDb(this.dbPath, false);
    try {
      fn(db);
    } finally {
      db.close();
    }
  }

  /** Stop the server and delete the temp dir and port reservations. Idempotent. */
  async cleanup(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    try {
      await this.stop();
    } finally {
      for (const port of this.reserved) releasePort(port);
      activeDirs.delete(this.dir);
      fs.rmSync(this.dir, { recursive: true, force: true });
    }
  }
}

const registry: ServerHandle[] = [];

/** Start a fresh server (fresh DB). Registered for automatic cleanup after each test, pass or fail. */
export async function startServer(options: StartOptions = {}): Promise<ServerHandle> {
  const handle = new ServerHandle(options);
  registry.push(handle);
  try {
    await handle.start();
  } catch (error) {
    await handle.cleanup();
    throw error;
  }
  return handle;
}

/** Create a handle without starting it (tests that start it themselves, e.g. with expectStartFailure). */
export function newServer(options: StartOptions = {}): ServerHandle {
  const handle = new ServerHandle(options);
  registry.push(handle);
  return handle;
}

/** Call once per test file at top level: tears down every server started by the file's tests after each test. */
export function cleanupServersAfterEach(): void {
  afterEach(async () => {
    while (registry.length > 0) {
      await registry.pop()!.cleanup();
    }
  });
}

/**
 * One server for all tests of a file (beforeAll/afterAll). Use it when the tests do not interfere with each other.
 * Returns a getter; call it inside tests.
 */
export function sharedServer(options: StartOptions | (() => StartOptions | Promise<StartOptions>) = {}): () => ServerHandle {
  let handle: ServerHandle | undefined;
  beforeAll(async () => {
    const opts = typeof options === "function" ? await options() : options;
    handle = new ServerHandle(opts);
    try {
      await handle.start();
    } catch (error) {
      await handle.cleanup();
      throw error;
    }
  });
  afterAll(async () => {
    await handle?.cleanup();
  });
  return () => {
    if (!handle) throw new Error("shared server not started");
    return handle;
  };
}
