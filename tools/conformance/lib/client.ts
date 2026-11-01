import crypto from "node:crypto";
import type { ServerHandle } from "./server.js";

export interface PacketCommand {
  _cmd: string;
  _dat?: any;
  _sync?: number;
  [key: string]: any;
}

export interface ParsedEnvelope {
  xml: string;
  service: string | undefined;
  callId: string | undefined;
  responseCode: string | undefined;
  chk: number;
  chkValid: boolean;
  /** the raw `commands` JSON string */
  commandsJson: string;
  list: PacketCommand[];
  msgCount: number;
  sync: number;
}

/** chk of the wire protocol (packages/shared/src/protocol.ts getChk). */
export function getChk(value: string): number {
  let checksum = 317;
  for (let index = 0; index < value.length; index += 1) {
    checksum = (23 * checksum + value.charCodeAt(index)) | 0;
  }
  return checksum;
}

export function parseEnvelope(xml: string): ParsedEnvelope {
  const match = xml.match(/<commands><!\[CDATA\[(.*)\]\]><\/commands>/s) ?? xml.match(/<commands>(.*)<\/commands>/s);
  if (!match) throw new Error(`Could not extract command payload from response: ${xml}`);
  const payload = JSON.parse(match[1]);
  const chk = Number(xml.match(/<chk>(-?\d+)<\/chk>/)?.[1]);
  return {
    xml,
    service: xml.match(/<Response service="([^"]*)"/)?.[1],
    callId: xml.match(/call_id="([^"]*)"/)?.[1],
    responseCode: xml.match(/<response_code>([^<]*)<\/response_code>/)?.[1],
    chk,
    chkValid: chk === getChk(match[1]),
    commandsJson: match[1],
    list: payload.list as PacketCommand[],
    msgCount: payload._msgCount,
    sync: payload._sync
  };
}

export function extractCommands(xml: string): PacketCommand[] {
  return parseEnvelope(xml).list;
}

/** Request signature: md5 of the sorted `key=value&...` form fields + session token + "Host4h". */
export function signPayload(payload: Record<string, string>, token: string): string {
  const serialized = Object.entries(payload)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("md5").update(`${serialized}${token}Host4h`).digest("hex");
}

export type CmdSpec = [cmd: string, dat?: any] | PacketCommand;

/** The player's `/Game` client: login, signed cmdList requests, parsed responses. */
export class GameClient {
  token = "";

  constructor(readonly server: ServerHandle) {}

  /** POST /Game with raw form fields; returns the response body. */
  async postForm(form: Record<string, string>): Promise<string> {
    const response = await fetch(`${this.server.httpUrl}/Game`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form)
    });
    return await response.text();
  }

  /** `cmd=login`: stores the session token and returns the parsed logOK envelope. */
  async login(): Promise<ParsedEnvelope> {
    const xml = await this.postForm({
      uid: this.server.uid,
      cmd: "login",
      version: "0.501",
      data: "{}",
      flash_version: "WIN 32,0,0,0"
    });
    const env = parseEnvelope(xml);
    this.token = String(env.list[0]?._dat?.token ?? "");
    return env;
  }

  /** Signed `cmdList` request with several commands. Logs in first if there is no token yet. */
  async cmdList(commands: CmdSpec[], options: { msgCount?: number; sync?: number; sign?: boolean } = {}): Promise<ParsedEnvelope> {
    if (!this.token) await this.login();
    const _cmdList = commands.map((spec, index) =>
      Array.isArray(spec) ? { _cmd: spec[0], _dat: spec[1] ?? {}, _cnt: index + 1 } : { _cnt: index + 1, ...spec }
    );
    const data = JSON.stringify({ _cmdList, _msgCount: options.msgCount ?? 0, _sync: options.sync ?? 1 });
    const form: Record<string, string> = {
      uid: this.server.uid,
      cmd: "cmdList",
      version: "0.501",
      data,
      flash_version: "WIN 32,0,0,0"
    };
    if (options.sign !== false) form.sig = signPayload(form, this.token);
    return parseEnvelope(await this.postForm(form));
  }

  /** All response commands of one request. */
  async sendAll(cmd: string, dat: any = {}): Promise<PacketCommand[]> {
    return (await this.cmdList([[cmd, dat]])).list;
  }

  /** One command, returns the `_dat` of the first response command (what CommandService.handleCommand(...)[0]._dat was). */
  async send(cmd: string, dat: any = {}): Promise<any> {
    const list = await this.sendAll(cmd, dat);
    return list[0]?._dat;
  }

  /** get_world for a user id; returns the `universe` array of the answer. */
  async world(targetUserId: number | string = 1): Promise<any[]> {
    return (await this.send("get_world", { targetUserId })).universe;
  }
}

/** Convenience: new client for a server. */
export function clientFor(server: ServerHandle): GameClient {
  return new GameClient(server);
}
