import type { GameClient } from "./client.js";
import { stateOf, universeCtx } from "./db.js";

/** A save item as stored in the universe document: `Item: [{ State: [], id, mode, time, ... }]` + position attributes. */
export function mkItem(sid: string, sku: string, x: string, y: string, state: Record<string, string>, csid = "1"): any {
  return { Item: [{ State: [], ...state }], sid, csid, sku, x, y, isSuspended: "0" };
}

/** The headquarters entry used by most seeded "completed tutorial" saves. */
export function mkHq(sid: string): any {
  return mkItem(sid, "HeadQuarter", "-1", "-3", { id: "4" });
}

/** get_world over HTTP, returned with handles (profile = the Profile container, mine/rival companies, map). */
export async function worldOf(c: GameClient, targetUserId: number | string = 1) {
  const universe = await c.world(targetUserId);
  const ctx = universeCtx({ universe });
  return { universe, ...ctx };
}

export function itemBySid(company: any, sid: string): any {
  return company?.Company.find((i: any) => i.sid === sid);
}

export { stateOf };

/** The `new_item` update_item payload used by the client (the tutorial and the shop). */
export function newItemCmd(sid: string, sku: string, x: string, y: string, state: Record<string, string>, extra: Record<string, unknown> = {}): [string, any] {
  return [
    "update_item",
    { action: "new_item", sid, sku, item: { Item: [{ State: [], ...state }], sid, csid: "1", sku, x, y, isSuspended: "0" }, ...extra }
  ];
}

/** Missions / PollManager lists of a Profile container. `up`, `reached`, `given` are `{ chunk }` nodes; `count` may be undefined. */
export function missionLists(profile: any): { missions: any; pollManager: any; up: any; reached: any; given: any; count: any } {
  const missions = profile.Profile.find((e: any) => Array.isArray(e.Missions));
  const pollManager = profile.Profile.find((e: any) => Array.isArray(e.PollManager));
  return {
    missions,
    pollManager,
    up: missions?.Missions.find((e: any) => Array.isArray(e.Up)),
    reached: missions?.Missions.find((e: any) => Array.isArray(e.Reached)),
    given: missions?.Missions.find((e: any) => Array.isArray(e.Given)),
    count: pollManager?.PollManager.find((e: any) => Array.isArray(e.Count))
  };
}

export const skus = (node: { chunk?: string } | undefined): string[] => (node?.chunk ?? "").split(",").filter(Boolean);
