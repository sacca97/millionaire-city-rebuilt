// Per-item timers: construction countdown -> RENT, contract countdown -> collectable (GET_RENT) -> abandoned.
// Ported from StateOnConstruction.doLogicUpdate (StateOnConstruction.as:~250), StateOnRent.doLogicUpdate
// (StateOnRent.as:1180-1262) and RulesFacade.settingsGetAbandonTime. Pure: no I/O; the Game turns transitions into commands.
import { CONSTRUCTION_MODE, RENT_MODE, STATE_ID } from "../net/commands";
import { abandonTimeMs, type GameRules } from "./rules";

/** Runtime copy of an item's <State> (time = remaining ms of the active countdown). */
export interface ItemRuntime {
  sid: string;
  sku: string;
  stateId: number;
  mode: number;
  time: number;
  contractSku?: number;
  /** Total income time of the active contract (ms); 0 when none. Commerces: the definition's incomeTime (renting cycle). */
  incomeMs: number;
  isCommerce: boolean;
  /** Clubs (ItemDefinition.isAClub): commerce behaviour (paid by the population around) but with contracts and abandonment. */
  isClub?: boolean;
  /** Wonders end construction in StateOnBuilt (CompanyMine.initItemAfterBuying :37) instead of StateOnRent. */
  isWonder?: boolean;
  /** Not connected to the HQ by road (ItemObject.suspend): the timers do not run. */
  suspended?: boolean;
}

/** Live facts of the surrounding city the simulation needs (supplied by game/economy.ts). */
export interface AdvanceEnv {
  /** ItemObject.getPopulation of a commerce/club (StateOnRent.as:1247-1290). Default 0. */
  population?: (rt: ItemRuntime) => number;
}

export type TransitionType = "constructionDone" | "rentReady" | "abandoned" | "rentRestarted";
export interface Transition {
  type: TransitionType;
  rt: ItemRuntime;
}

/**
 * Advances one item by dtMs of game time (may be large: speed-ups and offline catch-up cascade through phases).
 * Mutates `rt` and returns the transitions that occurred, in order. Transitions mirror what the original reports to
 * the server (construction end -> new_state RENT; renting end -> mode GET_RENT with the abandon time; abandon -> mode 7).
 */
export function advanceItem(rt: ItemRuntime, dtMs: number, rules: GameRules, env: AdvanceEnv = {}): Transition[] {
  const out: Transition[] = [];
  if (rt.suspended) {
    return out; // ItemObject.suspend(): no logic update while the item is cut off from the HQ
  }
  const commerceLike = rt.isCommerce || rt.isClub === true;
  let left = Math.max(0, dtMs);
  for (let guard = 0; guard < 8; guard += 1) {
    if (rt.stateId === STATE_ID.CONSTRUCTION) {
      if (rt.mode === CONSTRUCTION_MODE.PAUSED) {
        break;
      }
      if (rt.time > left) {
        rt.time -= left;
        break;
      }
      left -= rt.time;
      rt.time = 0;
      if (rt.isWonder) {
        rt.stateId = STATE_ID.BUILT; // StateOnBuilt (id 5): the wonder effects start (StateOnBuilt.enter :80-90)
        rt.mode = 0;
      } else if (rt.isCommerce) {
        // StateOnRent.doEnter (:260-270): commerces enter MODE_RENTING with the definition's income time (no contract).
        rt.stateId = STATE_ID.RENT;
        rt.mode = RENT_MODE.RENTING;
        rt.time = rt.incomeMs;
        rt.contractSku = undefined;
      } else {
        rt.stateId = STATE_ID.RENT;
        rt.mode = RENT_MODE.WAITING_FOR_CONTRACT;
        rt.contractSku = undefined;
        rt.incomeMs = 0;
      }
      out.push({ type: "constructionDone", rt });
      continue;
    }
    if (rt.stateId !== STATE_ID.RENT) {
      break;
    }
    if (rt.mode === RENT_MODE.RENTING) {
      if (rt.time > left) {
        rt.time -= left;
        break;
      }
      left -= rt.time;
      if (commerceLike && (env.population?.(rt) ?? 0) === 0) {
        // StateOnRent.as:1243-1254: no affected population -> renting restarts (setMode(MODE_RENTING,true,false): new income time).
        if (rt.incomeMs <= 0) {
          rt.time = 0;
          break;
        }
        left %= rt.incomeMs;
        rt.time = rt.incomeMs - left;
        break;
      }
      rt.mode = RENT_MODE.GET_RENT;
      // setMode(GET_RENT): only houses/clubs get an abandon countdown (StateOnRent.as:655-661); commerces wait forever.
      rt.time = rt.isCommerce ? 0 : abandonTimeMs(rules, rt.incomeMs);
      out.push({ type: "rentReady", rt });
      continue;
    }
    if (rt.mode === RENT_MODE.GET_RENT) {
      if (commerceLike && (env.population?.(rt) ?? 0) === 0) {
        // StateOnRent.as:1270-1292: the population vanished while the rent was waiting: clubs are abandoned, commerces
        // go back to renting (resetMode / setMode(MODE_RENTING)).
        if (rt.isClub) {
          rt.mode = RENT_MODE.ABANDONED;
          rt.time = 0;
          out.push({ type: "abandoned", rt });
        } else {
          rt.mode = RENT_MODE.RENTING;
          rt.time = rt.incomeMs;
          out.push({ type: "rentRestarted", rt });
        }
        break;
      }
      if (rt.isCommerce) {
        break; // StateOnRent.as:1294: commerces never get abandoned
      }
      if (rt.time > left) {
        rt.time -= left;
        break;
      }
      left -= rt.time;
      rt.time = 0;
      rt.mode = RENT_MODE.ABANDONED;
      out.push({ type: "abandoned", rt });
      continue;
    }
    break;
  }
  return out;
}
