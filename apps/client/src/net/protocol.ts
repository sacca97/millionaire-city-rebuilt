// Wire protocol of the local server: POST /Game (form body), XML envelope with CDATA JSON.
// Server side: apps/server/src/serverApp.ts (/Game handler), packages/shared/src/protocol.ts.

import { signParams } from "./md5";

export interface PacketCommand<T = Record<string, unknown>> {
  _cmd: string;
  _dat: T;
  _sync?: number;
  /** Per-command counter stamped by Server.sendCommand (Server.as:306); set by CommandQueue. */
  _cnt?: number;
}

/** Body of the `data` form field for cmd=cmdList (Server.sendPacketNow, Server.as:213-271). */
export interface CmdListPacket {
  _cmdList: PacketCommand[];
  _msgCount: number;
  _sync: number;
  /** Set on a resend: _cnt of the first still-queued command, or 0 (Server.as:243-250). */
  retry?: number;
  /** Set to 1 while a pingCurrency burst is active (Server.as:264-267). */
  ping?: number;
}

export interface Envelope {
  list: PacketCommand[];
  _msgCount: number;
  _sync: number;
}

const DEFAULT_UID = "100000000000001";
export const GAME_VERSION = "0.501";
export const FLASH_VERSION = "WIN 32,0,0,0";

function getChk(value: string): number {
  let checksum = 317;
  for (let i = 0; i < value.length; i += 1) {
    checksum = (23 * checksum + value.charCodeAt(i)) | 0;
  }
  return checksum;
}

export function parseEnvelope(xml: string): Envelope {
  const chk = /<chk>(-?\d+)<\/chk>/.exec(xml)?.[1];
  const cdata = /<commands><!\[CDATA\[([\s\S]*?)\]\]><\/commands>/.exec(xml)?.[1];
  if (cdata === undefined) {
    throw new Error("Malformed server response (no commands)");
  }
  if (chk !== undefined && Number(chk) !== getChk(cdata)) {
    throw new Error("Server response checksum mismatch");
  }
  return JSON.parse(cdata) as Envelope;
}

export interface GameConnectionOptions {
  /** Prefix for /Game, e.g. "http://127.0.0.1:31803". Empty = same origin (Vite proxy). */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  uid?: string;
}

export class GameConnection {
  /** Legacy counter used only by send()/query(); CommandQueue manages its own _msgCount. */
  private msgCount = 0;
  uid: string;
  token = "";
  serverTimeOffset = 0;
  /** `_sync` of the logOK response; the original client sends this value on every packet (Server.as:673). */
  loginSync = 1;
  /** Last `_sync` seen on any response envelope (informational). */
  lastServerSync = 1;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GameConnectionOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.uid = options.uid ?? DEFAULT_UID;
  }

  /**
   * POST /Game with the same fields as ServerJava.uploadCommands (ServerJava.as:194-231):
   * uid, cmd, version, data, flash_version, sig = md5(sorted params + token + "Host4h").
   */
  private async post(cmd: string, data: string): Promise<Envelope> {
    const params: Record<string, string> = {
      uid: this.uid,
      cmd,
      version: GAME_VERSION,
      data,
      flash_version: FLASH_VERSION
    };
    const sig = signParams(params, this.token);
    const body = new URLSearchParams({ ...params, sig });
    const res = await this.fetchFn(`${this.baseUrl}/Game`, { method: "POST", body });
    if (!res.ok) {
      throw new Error(`Server error ${res.status}`);
    }
    const env = parseEnvelope(await res.text());
    if (typeof env._sync === "number") {
      this.lastServerSync = env._sync;
    }
    return env;
  }

  async login(): Promise<void> {
    const env = await this.post("login", "{}");
    const ok = env.list.find((c) => c._cmd === "logOK");
    if (!ok) {
      throw new Error("Login failed");
    }
    const dat = ok._dat as { token: string; userExtId?: string; currentServerTime?: number };
    this.token = dat.token;
    this.loginSync = typeof ok._sync === "number" ? ok._sync : env._sync;
    if (dat.currentServerTime) {
      this.serverTimeOffset = dat.currentServerTime - Date.now();
    }
  }

  /** Server-aligned current time in ms. */
  now(): number {
    return Date.now() + this.serverTimeOffset;
  }

  /** Send one fully-formed cmdList packet; resolves with the parsed response envelope. */
  sendPacket(packet: CmdListPacket): Promise<Envelope> {
    return this.post("cmdList", JSON.stringify(packet));
  }

  /** Legacy helper (main.ts): one immediate packet with auto-incremented _msgCount. */
  async send(commands: PacketCommand[]): Promise<PacketCommand[]> {
    const env = await this.sendPacket({ _cmdList: commands, _msgCount: this.msgCount, _sync: this.loginSync });
    this.msgCount += 1;
    return env.list;
  }

  async query(cmd: string, dat: Record<string, unknown> = {}): Promise<PacketCommand | undefined> {
    const res = await this.send([{ _cmd: cmd, _dat: dat }]);
    return res.find((c) => c._cmd === cmd);
  }
}
