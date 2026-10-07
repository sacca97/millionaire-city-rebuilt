// CommandQueue: port of the batching / sequencing state machine of the original Server class
// (decompiled/scripts/com/dchoc/dollars/server/Server.as, ServerJava.as). Driven by tick(dtMs) exactly like
// Server.logicUpdate (Server.as:364-445); no timers of its own unless start() is called.

import type { CmdListPacket, Envelope, PacketCommand } from "./protocol";

/** Anything that can POST a cmdList packet (GameConnection). */
export interface PacketTransport {
  sendPacket(packet: CmdListPacket): Promise<Envelope>;
}

// Server.as:20-38
export const CACHE_UPDATES_MIN_TIME = 2000;
export const CACHE_UPDATES_MAX_TIME = 7000;
export const MAX_CMDS_IN_ONE_PACKET = 15;
export const PACKET_RETRY_TIMEOUT = 20000;
export const PACKET_NO_RESPONSE_TIMEOUT = 2 * 60000;
export const RETRY_COUNTS_TO_PAUSE_GAMEPLAY = 2;
export const RETRY_COUNTS_TO_LOGOUT_GAMEPLAY = 3;
export const PING_UPDATES_COUNTS = 15;
export const PING_UPDATES_TIME = 15000;

export type QueueEvent =
  | { type: "response"; command: PacketCommand } // ServerEvent.onCommandResponse (Server.as:597-600)
  | { type: "giveCollectible"; dat: Record<string, unknown> } // Server.as:697-700 (REQ_GIVE_COLLECTIBLE)
  | { type: "limEdBuy"; dat: Record<string, unknown> } // Server.as:701-704 (REQ_LIM_ED_RESPONSE)
  | { type: "desync"; reason: string } // msgCount mismatch / no response -> logout (Server.as:585-592, 423-430)
  | { type: "pause" } // REQ_GAME_PLAY_PAUSE after 2 failed retries (Server.as:629-632)
  | { type: "resume" } // REQ_GAME_PLAY_RESUME (Server.as:602-606)
  | { type: "logout"; reason: string };

export interface CommandQueueOptions {
  /**
   * Which `_sync` goes in outgoing packets. The original sets mSync ONLY from the logOK response (Server.as:673) and sends it
   * unchanged forever ("login", default). "latest" follows the newest response `_sync` (the server ignores the value
   * either way: it always answers with its own session sync).
   */
  syncMode?: "login" | "latest";
}

export class CommandQueue {
  private cache: PacketCommand[] = [];
  /** mPacketCmdList: the packet currently awaiting a response (kept on failure so it can be resent). */
  private packet: CmdListPacket | null = null;
  private cmdCnt = 1; // mCMDcnt
  private messageCnt = 0; // messageCnt: advances once per completed request (Server.as:646)
  private sync = 1;
  private latestSync = 1;
  private logged = false;
  private forceSendAllNow = false;
  private retryUpload = false;
  private retriesCount = 0;
  private minTimer = 0; // mCacheUpdatesMinTimer
  private maxTimer = 0; // mCacheUpdatesMaxTimer
  private noResponseTimer = 0; // mPacketNoResponseTimer
  private pingUpdatesCount = 0;
  private pingUpdatesTimer = 0;
  private inFlight: Promise<void> | null = null;
  private readonly listeners = new Set<(e: QueueEvent) => void>();
  private interval: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;
  /** Every packet sent, for tests / debugging. */
  readonly sentPackets: CmdListPacket[] = [];

  constructor(
    private readonly transport: PacketTransport,
    private readonly options: CommandQueueOptions = {}
  ) {}

  on(listener: (e: QueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: QueueEvent): void {
    for (const l of this.listeners) {
      l(e);
    }
  }

  /** processCommand(logOK) (Server.as:665-683): mark logged in and capture the sync value. */
  markLoggedIn(sync: number): void {
    this.logged = true;
    this.sync = sync;
    this.latestSync = sync;
  }

  isLogged(): boolean {
    return this.logged;
  }

  logout(reason = "logout"): void {
    this.logged = false;
    this.emit({ type: "logout", reason });
  }

  get pendingCount(): number {
    return this.cache.length;
  }
  get currentMsgCount(): number {
    return this.messageCnt;
  }
  get serverSync(): number {
    return this.latestSync;
  }

  /** Server.sendCommand (Server.as:301-317): stamp _cnt, arm the 2s/7s cache timers, queue. */
  sendCommand(command: PacketCommand): PacketCommand {
    const queued: PacketCommand = { _cmd: command._cmd, _dat: command._dat, _cnt: this.cmdCnt++ };
    if (this.cache.length === 0 && this.minTimer === 0) {
      this.minTimer = CACHE_UPDATES_MIN_TIME;
      this.maxTimer = CACHE_UPDATES_MAX_TIME;
    } else if (this.maxTimer > 0) {
      this.minTimer = Math.max(this.minTimer, CACHE_UPDATES_MIN_TIME);
    }
    this.cache.push(queued);
    return queued;
  }

  /** Server.sendQuery (Server.as:295-299): queue + force flush on the next tick. */
  sendQuery(command: PacketCommand): PacketCommand {
    const q = this.sendCommand(command);
    this.forceSendAllNow = true;
    return q;
  }

  /** UserDataFacade.flushUniverse / applicationExit: mForceSendAllNow = true (UDFO.as:192-195, 1624-1628). */
  flush(): void {
    this.forceSendAllNow = true;
  }

  /** pingCurrency external response (Server.as:467-470): 15 pings, 15 s apart. */
  startPingBurst(): void {
    this.pingUpdatesCount = PING_UPDATES_COUNTS;
  }

  /** Server.serverIsBusy (Server.as:557-572): 2 = idle, 1 = packet in flight, 0 = commands queued. */
  serverIsBusy(): 0 | 1 | 2 {
    if (this.cache.length === 0) {
      return this.packet === null ? 2 : 1;
    }
    return 0;
  }

  /** Server.logicUpdate (Server.as:364-445), minus login retry / payments / CRM. */
  tick(dtMs: number): void {
    if (this.maxTimer > 0 && (this.maxTimer -= dtMs) <= 0) {
      this.maxTimer = 0;
    }
    if (this.minTimer > 0 && (this.minTimer -= dtMs) <= 0) {
      this.minTimer = 0;
      this.forceSendAllNow = true;
    }
    if (this.pingUpdatesCount > 0) {
      this.pingUpdatesTimer -= dtMs;
      if (this.pingUpdatesTimer <= 0) {
        this.sendCommand({ _cmd: "ping", _dat: {} });
        this.forceSendAllNow = true;
        this.pingUpdatesCount -= 1;
        this.pingUpdatesTimer = PING_UPDATES_TIME;
      }
    }
    if (this.forceSendAllNow) {
      this.forceSendAllNow = false;
      if (this.packet !== null && !this.retryUpload) {
        // A packet is still awaiting its response: postpone (Server.as:404-408).
        this.minTimer = Math.max(this.minTimer, CACHE_UPDATES_MIN_TIME);
        return;
      }
      this.sendPacketNow();
      this.minTimer = this.cache.length === 0 ? 0 : Math.max(this.minTimer, CACHE_UPDATES_MIN_TIME);
    }
    if (this.noResponseTimer > 0 && (this.noResponseTimer -= dtMs) <= 0) {
      this.noResponseTimer = 0;
      this.logged = false;
      this.emit({ type: "desync", reason: "Server not responded in a long time" });
    }
  }

  /** Server.sendPacketNow (Server.as:213-271) + ServerJava.uploadCommands. */
  private sendPacketNow(): void {
    if (!this.logged) {
      return;
    }
    if (this.cache.length === 0 && this.packet === null) {
      return; // PERMANENT_UPDATES_ENABLED = false
    }
    this.retryUpload = false;
    let list: PacketCommand[];
    if (this.packet === null) {
      this.packet = { _cmdList: [], _msgCount: 0, _sync: 0 };
      list = [];
    } else {
      list = this.packet._cmdList;
      // Resend of an unanswered packet: `retry` = _cnt of the first command still queued, or 0 (Server.as:243-250).
      this.packet.retry = this.cache.length > 0 ? this.cache[0]._cnt : 0;
    }
    let budget = MAX_CMDS_IN_ONE_PACKET;
    while (this.cache.length > 0) {
      list.push(this.cache.shift() as PacketCommand);
      if (--budget <= 0) {
        break;
      }
    }
    this.packet._cmdList = list;
    this.packet._msgCount = this.messageCnt;
    this.packet._sync = this.options.syncMode === "latest" ? this.latestSync : this.sync;
    if (this.pingUpdatesCount > 0) {
      this.packet.ping = 1;
    }
    // Snapshot for the wire / inspection; the live object keeps accumulating on retry.
    const wire: CmdListPacket = JSON.parse(JSON.stringify(this.packet));
    this.sentPackets.push(wire);
    this.noResponseTimer = PACKET_NO_RESPONSE_TIMEOUT;
    this.inFlight = this.transport.sendPacket(wire).then(
      (env) => this.downloadedCommands(env),
      () => this.downloadedCommands(null)
    );
  }

  /** Server.downloadedCommands (Server.as:574-647). `env === null` is a transport failure. */
  private downloadedCommands(env: Envelope | null): void {
    const elapsed = PACKET_NO_RESPONSE_TIMEOUT - this.noResponseTimer;
    this.noResponseTimer = 0;
    this.inFlight = null;
    if (env !== null) {
      const count = Number(env._msgCount);
      if (!(count === this.messageCnt || count < 0)) {
        this.logged = false;
        this.emit({ type: "desync", reason: `msgCount ${count} != ${this.messageCnt}` });
        return;
      }
      this.packet = null;
      if (typeof env._sync === "number") {
        this.latestSync = env._sync;
      }
      for (const command of env.list) {
        this.processCommand(command);
        this.emit({ type: "response", command });
      }
      if (this.logged && this.retriesCount >= RETRY_COUNTS_TO_PAUSE_GAMEPLAY) {
        this.emit({ type: "resume" });
      }
      this.retriesCount = 0;
    } else {
      this.retriesCount += 1;
      if (this.retriesCount === RETRY_COUNTS_TO_PAUSE_GAMEPLAY) {
        this.emit({ type: "pause" });
      } else if (this.retriesCount > RETRY_COUNTS_TO_LOGOUT_GAMEPLAY) {
        this.logged = false;
        this.emit({ type: "logout", reason: "all server requests failed" });
        return; // messageCnt NOT advanced (Server.as:640)
      }
      this.retryUpload = true;
      this.minTimer = Math.max(1, PACKET_RETRY_TIMEOUT - elapsed);
    }
    this.messageCnt += 1;
  }

  /** Server.processCommand (Server.as:661-706). */
  private processCommand(command: PacketCommand): void {
    const dat = (command._dat ?? {}) as Record<string, unknown>;
    switch (command._cmd) {
      case "logOK":
        this.markLoggedIn(typeof command._sync === "number" ? command._sync : this.sync);
        break;
      case "logKO":
      case "logOut":
        this.logged = false;
        break;
      case "update_item":
        if (dat.action === "give_collectible") {
          this.emit({ type: "giveCollectible", dat });
        }
        if (dat.action === "limEdBuy") {
          this.emit({ type: "limEdBuy", dat });
        }
        break;
      default:
        break;
    }
  }

  /** Run tick() on a wall-clock interval (the game loop would normally call tick with its frame delta). */
  start(intervalMs = 100): void {
    this.stop();
    this.lastTick = Date.now();
    this.interval = setInterval(() => {
      const now = Date.now();
      this.tick(now - this.lastTick);
      this.lastTick = now;
    }, intervalMs);
  }

  stop(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /**
   * Force-send until nothing is queued and no packet is outstanding. Resolves with all responses received meanwhile.
   * Stops (rejects) if the session is no longer logged in.
   */
  async drain(): Promise<PacketCommand[]> {
    const received: PacketCommand[] = [];
    const off = this.on((e) => {
      if (e.type === "response") {
        received.push(e.command);
      }
    });
    try {
      let guard = 0;
      while (this.cache.length > 0 || this.packet !== null) {
        if (!this.logged || guard++ > 1000) {
          throw new Error("CommandQueue.drain: session not logged in or stuck");
        }
        this.forceSendAllNow = true;
        this.tick(0);
        if (this.inFlight) {
          await this.inFlight;
        }
      }
    } finally {
      off();
    }
    return received;
  }
}
