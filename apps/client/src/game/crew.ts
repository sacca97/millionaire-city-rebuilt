// Crew mechanics (clubs): rules/crewMechanicsDefinition.xml, ItemObject crew bookkeeping and the hire flow.
// Sources: crewMechanics/CrewMechanicsManager.as, GUI/hireCrew/PopupHireCrew.as + CrewItemContent.as, StateOnHireCrew.as,
// ItemObject.as (mCrew :1367-1390, getCrewBought/getCrewHired, updateCrew :2905), Role.doGetInitialItemState (Role.as:50).
import { parseElements } from "@mcity/rules";

/** StateItemObject.STATE_ON_HIRE_CREW (the club waits for its crew; StateOnHireCrew.as). */
export const STATE_HIRE_CREW = 7;

export interface CrewDefinition {
  sku: string;
  /** TIDs of the job of each slot (CrewMechanicsManager.getJobsTIDs). */
  jobs: string[];
  workerTid: string;
  fbcPrice: number;
  goldPrice: number;
}

export function parseCrewDefinitions(xml: string): Map<string, CrewDefinition> {
  const out = new Map<string, CrewDefinition>();
  for (const a of parseElements(xml, "Definition")) {
    const sku = a.sku ?? "";
    if (!sku) continue;
    out.set(sku, {
      sku,
      jobs: (a.jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      workerTid: a.workerTID ?? "",
      fbcPrice: Math.trunc(Number(a.FBCprice) || 0),
      goldPrice: Math.trunc(Number(a.goldPrice) || 0)
    });
  }
  return out;
}

/** ItemObject.mCrew: friends that accepted (CREW_INVITED) and the slots bought with gold (CREW_PAID). */
export interface CrewState {
  invited: string[];
  paid: number[];
}

/** `<Crew ids="a,b" bought="0,2"/>` attributes -> CrewState (ItemObject.as:1367-1390). */
export function parseCrewAttrs(ids: string | undefined, bought: string | undefined): CrewState {
  const split = (s: string | undefined): string[] => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return { invited: split(ids), paid: split(bought).map(Number).filter((n) => Number.isFinite(n)) };
}

/** ItemObject.getPersistence `<Crew ids bought/>` (ItemObject.as:2392). */
export const crewAttrs = (c: CrewState): { ids: string; bought: string } => ({ ids: c.invited.join(","), bought: c.paid.join(",") });

export type SlotStatus = "free" | "bought" | "hired";

export interface CrewSlot {
  index: number;
  status: SlotStatus;
  jobTid: string;
  /** Friend id when hired. */
  friend?: string;
}

/** PopupHireCrew constructor (:51-83): bought slots by index, then hired friends fill the next slots in order, the rest are free. */
export function crewSlots(def: CrewDefinition, c: CrewState): CrewSlot[] {
  const slots: CrewSlot[] = [];
  let hired = 0;
  for (let i = 0; i < def.jobs.length; i += 1) {
    const jobTid = def.jobs[i];
    if (c.paid.includes(i)) slots.push({ index: i, status: "bought", jobTid });
    else if (hired < c.invited.length) slots.push({ index: i, status: "hired", jobTid, friend: c.invited[hired++] });
    else slots.push({ index: i, status: "free", jobTid });
  }
  return slots;
}

export const crewFilled = (def: CrewDefinition, c: CrewState): number => Math.min(def.jobs.length, c.paid.length + c.invited.length);
export const crewComplete = (def: CrewDefinition, c: CrewState): boolean => crewFilled(def, c) >= def.jobs.length;
/** PopupHireCrew.setCompletePrice (:150): empty slots * single price. */
export const crewCompletePrice = (def: CrewDefinition, c: CrewState): number => (def.jobs.length - crewFilled(def, c)) * def.goldPrice;
/** ItemObject.updateCrew caption "<filled>/<total>". */
export const crewCaption = (def: CrewDefinition, c: CrewState): string => `${c.paid.length + c.invited.length}/${def.jobs.length}`;
