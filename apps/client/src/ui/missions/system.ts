// Binds the pure mission model (game/missions.ts) to the live Game: loads definitions + persisted state, turns Game
// "poll"/"profile" events into PollManager registrations (the call sites of PollManager.registerEvent / PollEvent.checkCondition
// in the original), sends update_missions / update_pollmanager through GameCommands and pays rewards.
import type { Game } from "../../game/game";
import {
  MISSION_EVENT,
  MissionManager,
  activeDefinitions,
  eventSku,
  itemEventParameters,
  nameTypeOf,
  parseFlags,
  parseMissionDefinitions,
  rewardVariantDefinitions,
  type MissionAlert,
  type MissionDef,
  type MissionHost,
  type MissionObject,
  type RewardGain
} from "../../game/missions";
import type { DefinitionTable } from "../../model/definitions";
import { uiBus } from "../bus";

const RULES = "/mcity/0.501/Datas/rules/";

/** Profile.eventsBuild (Profile.as:1074) checks stored earn/beat values after PollManager is loaded. */
export function checkProfileMissionEvents(
  manager: Pick<MissionManager, "poll">,
  profile: Pick<Game["profile"], "coins" | "cash" | "companyValue">
): void {
  manager.poll.checkEvent(MISSION_EVENT.earn + "DCCoins", profile.coins);
  manager.poll.checkEvent(MISSION_EVENT.earn + "DCCash", profile.cash);
  manager.poll.checkEvent(MISSION_EVENT.earn + "companyValue", profile.companyValue);
  manager.poll.checkEvent(MISSION_EVENT.beat, profile.companyValue);
}

/** RulesFacade.npcsGetCompanyValue source: NPCDefinitions.xml in document order. */
export function parseNpcCompanyValues(xml: string): number[] {
  return [...xml.matchAll(/<Definition\b[^>]*\bcompanyValue="([^"]*)"/g)].map((m) => Number(m[1]));
}

export interface MissionSystemOptions {
  defs: MissionDef[];
  npcValues: number[];
}

export async function loadMissionRules(): Promise<MissionSystemOptions> {
  const get = async (f: string): Promise<string> => {
    const r = await fetch(RULES + f);
    return r.ok ? r.text() : "";
  };
  const [missions, npcs] = await Promise.all([get("missionDefinitions.xml"), get("NPCDefinitions.xml")]);
  return { defs: parseMissionDefinitions(missions), npcValues: parseNpcCompanyValues(npcs) };
}

export class MissionSystem {
  readonly manager: MissionManager;
  /** True while a PopupReward is showing (MissionObjectManager.mRewardPopup != null). */
  private visiting = false;
  private updating = false;
  private updatePending = false;
  private lastAlert: MissionAlert = "none";
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly tableDefs: DefinitionTable;

  constructor(
    private readonly game: Game,
    opts: MissionSystemOptions
  ) {
    this.tableDefs = game.defs;
    const raw = game.state.profile.raw;
    const flags = parseFlags(raw.flags);
    const defs = activeDefinitions(rewardVariantDefinitions(opts.defs, flags.missionAltReward ?? 0), flags.altMissions === 1);
    const host: MissionHost = {
      level: () => game.profile.level,
      sendMission: (sku, claim) => {
        // MissionObjectManager.as:283 builds the claim object from the stale baseline; the facade then advances it (UDFO.as:1232-1237): no pre-sync.
        game.sendCommand(game.commands.mission(sku, claim));
      },
      poll: (action, type, parameter, value) => {
        game.sendCommand(action === "add" ? game.commands.poll("add", type, parameter) : game.commands.poll("update", type, parameter, value ?? "0"));
      },
      pay: (g: RewardGain) => void game.applyGain({ coins: g.coins, exp: g.exp, cash: g.cash }),
      addItem: (sku, amount) => game.addStorageItem(sku, amount),
      npcCompanyValue: (i) => opts.npcValues[i] ?? Number.NaN
    };
    this.manager = new MissionManager(host, defs);
    const save = game.state.profile;
    this.manager.build({ ...save.missions, pollCounts: save.pollCounts });
    this.wire();
    checkProfileMissionEvents(this.manager, game.profile);
    this.update();
    this.timer = setInterval(() => this.update(), 1000);
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public: register an occurrence (PollManager.registerEvent) from any UI area (investment, visits, upgrades, ...). */
  register(type: string, parameter = ""): void {
    this.manager.register(type, parameter);
    this.update();
  }

  update(): void {
    if (this.visiting) return; // MissionObject.needsToBeChecked: visitor role is not checked
    if (this.updating) {
      this.updatePending = true;
      return;
    }
    this.updating = true;
    try {
      do {
        this.updatePending = false;
        this.manager.update();
        this.pushAlert();
      } while (this.updatePending && !this.visiting);
    } finally {
      this.updating = false;
    }
  }

  /** Toolbar boss alert (new mission / mission reached) through the UI bus. */
  pushAlert(): void {
    const a = this.manager.alert();
    if (a !== this.lastAlert) {
      this.lastAlert = a;
      uiBus.emit("missionAlert", { kind: a });
    }
  }

  get firstMission(): boolean {
    return this.game.state.profile.raw.firstMission !== "0";
  }

  private wire(): void {
    const { game, manager } = this;
    // ItemObject.registerEvent fan-out / StateOnRent.giveIncome / plain PollManager.registerEvent.
    game.on("poll", ({ type, sku, extra }) => {
      if (sku === undefined) {
        manager.register(type);
      } else {
        const d = this.tableDefs.get(sku);
        const nameType = nameTypeOf(d?.rules.kind ?? "other", sku);
        if (type === MISSION_EVENT.collect) {
          if (extra !== undefined) manager.register(type, `${nameType}%${extra}`);
          manager.register(type, nameType);
          manager.register(type, sku);
        } else {
          for (const p of itemEventParameters(nameType, sku, d?.rules.subtype ?? "")) manager.register(type, p);
        }
      }
      this.update();
    });
    // StateOnRent.as:1348-1372: an owned commerce reports its population to the checkInfluence<nameType> and checkInfluence<sku> events.
    game.on("commerce-population", ({ sid, sku, nameType, population }) => {
      if (this.visiting) return;
      manager.poll.checkEvent(MISSION_EVENT.checkInfluence + nameType, population, sid);
      manager.poll.checkEvent(MISSION_EVENT.checkInfluence + sku, population, sid);
      this.update();
    });
    // Profile.eventCheck (Profile.as:746-760): earn<DCCoins|DCCash|companyValue> and beat (company value).
    game.on("profile", (p) => {
      if (!this.visiting) {
        checkProfileMissionEvents(manager, p);
      }
      this.update();
    });
    // ItemObject.checkInfluenceEvent (:2859): every owned item reports its influence value to the "bonus<sku>" event ("Pimp the House"
    // missions); original call sites: attributes changed, state enter, mouse-over refresh. Polled once a second here.
    window.setInterval(() => {
      if (this.visiting || game.tutorial) return;
      for (const it of game.items()) {
        const v = game.economy.influencePercent(it.sid);
        manager.poll.checkEvent(MISSION_EVENT.bonus + it.sku, v, it.sid);
        const parts = it.sku.split("_"); // ItemDefinition.as:504-508: subsku = <part0>_<part1>
        if (it.sku.startsWith("houses_") && parts.length > 1) manager.poll.checkEvent(MISSION_EVENT.bonus + parts[0] + "_" + parts[1], v, it.sid);
      }
      this.update();
    }, 1000);
    uiBus.on("visitStarted", ({ userId }) => {
      // DollarsGame.as:1612-1626 (visitor role after the world loaded): visitRonald/visitFriend + visitCity.
      this.visiting = true;
      const npc = userId === "100" || userId === "101";
      manager.register(npc ? MISSION_EVENT.visitRonald : MISSION_EVENT.visitFriend);
      manager.register(MISSION_EVENT.visitCity);
    });
    uiBus.on("visitEnded", () => {
      this.visiting = false;
      this.update();
    });
  }

  /** Mission objects of a given event sku (debug / tests). */
  missionsOf(type: string, parameter = ""): MissionObject[] {
    return this.manager.getMissionsAll().filter((m) => eventSku(m.def) === type + parameter);
  }
}
