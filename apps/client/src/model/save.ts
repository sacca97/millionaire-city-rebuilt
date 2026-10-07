// Parses the legacy "XML-as-JSON" save documents (get_world) into typed state.
// Document shape: {tagName: [children...], attr: "string"}; see apps/server/src/saveDefaults.

type Node = Record<string, unknown>;

export interface PlacedItem {
  sid: string;
  sku: string;
  /** Tile coordinates relative to map centre, as stored in the save. */
  x: number;
  y: number;
  stateId: number;
  /** Raw State attributes (mode, time, ...). */
  state: Record<string, string>;
  suspended: boolean;
  /** `<Crew ids bought/>` child of clubs (ItemObject.as:1367-1390). */
  crew?: { ids: string; bought: string };
  /** HQ skin sku from `<Decorations><Decoration type="0" currentSku/>` (ItemDecoration.TYPE_SKIN_ID). */
  skin?: string;
}

export interface Company {
  sid: string;
  whose: number;
  coins: number;
  items: PlacedItem[];
}

export interface Profile {
  cityName: string;
  userName: string;
  exp: number;
  coins: number;
  cash: number;
  raw: Record<string, string>;
  /** Profile > Missions > Up/Reached/Given chunks (MissionObjectManager.setPersistence/build). */
  missions: { up: string[]; reached: string[]; given: string[] };
  /** Profile > PollManager > Count chunk: "<eventSku>/<value>" entries (PollManager.build). */
  pollCounts: Record<string, string>;
}

export interface WorldState {
  profile: Profile;
  mine?: Company;
  companies: Company[];
  /** Relative tile coordinates. */
  terrain: Array<[number, number]>;
  roads: Array<[number, number]>;
}

interface El {
  tag: string;
  children: El[];
  attrs: Record<string, string>;
}

/** {Tag: [children...], attr: "v"} -> El. The tag is the key whose value is an array. */
function toEl(node: Node): El {
  let tag = "";
  let kids: unknown[] = [];
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v)) {
      tag = k;
      kids = v;
    } else if (typeof v === "string") {
      attrs[k] = v;
    }
  }
  return { tag, children: kids.map((c) => toEl(c as Node)), attrs };
}

export function parseChunk(chunk: string | undefined): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!chunk) {
    return out;
  }
  for (const part of chunk.split(",")) {
    const m = /^(?:-?\d+:)?(-?\d+):(-?\d+)$/.exec(part.trim());
    if (m) {
      out.push([Number(m[1]), Number(m[2])]);
    }
  }
  return out;
}

export function parseWorld(getWorldDat: Node): WorldState {
  const universe = ((getWorldDat.universe as Node[] | undefined) ?? []).map(toEl);
  const profileEl = universe.find((e) => e.tag === "Profile");
  const raw = profileEl?.attrs ?? {};
  const profile: Profile = {
    cityName: raw.cityname ?? "My City",
    userName: raw.userName ?? "Mayor",
    exp: Number(raw.exp ?? 0),
    coins: Number(raw.DCCoins ?? 0),
    cash: Number(raw.DCCash ?? 0),
    raw,
    missions: parseMissionLists(profileEl),
    pollCounts: parsePollCounts(profileEl)
  };
  const companies: Company[] = [];
  const terrain: Array<[number, number]> = [];
  const roads: Array<[number, number]> = [];
  for (const world of universe.filter((e) => e.tag === "World")) {
    for (const child of world.children) {
      if (child.tag === "Company") {
        companies.push({
          sid: child.attrs.sid ?? "",
          whose: Number(child.attrs.whose ?? 0),
          coins: Number(child.attrs.DCCoins ?? 0),
          items: child.children.filter((e) => e.tag === "Item").map(parseItem)
        });
      } else if (child.tag === "Map") {
        for (const layer of child.children) {
          const cells = parseChunk(layer.attrs.chunk);
          if (layer.tag === "Terrain") {
            terrain.push(...cells);
          } else if (layer.tag === "Road") {
            roads.push(...cells);
          }
        }
      }
    }
  }
  return { profile, companies, mine: companies.find((c) => c.whose === 0), terrain, roads };
}

const chunkList = (chunk: string | undefined): string[] => (chunk ?? "").split(",").map((v) => v.trim()).filter((v) => v !== "");

function parseMissionLists(profile: El | undefined): Profile["missions"] {
  const missions = profile?.children.find((c) => c.tag === "Missions");
  const list = (tag: string): string[] => chunkList(missions?.children.find((c) => c.tag === tag)?.attrs.chunk);
  return { up: list("Up"), reached: list("Reached"), given: list("Given") };
}

function parsePollCounts(profile: El | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const poll = profile?.children.find((c) => c.tag === "PollManager");
  for (const count of poll?.children.filter((c) => c.tag === "Count") ?? []) {
    for (const entry of chunkList(count.attrs.chunk)) {
      const i = entry.lastIndexOf("/");
      if (i > 0) out[entry.slice(0, i)] = entry.slice(i + 1);
    }
  }
  return out;
}

function skinOf(el: El): string | undefined {
  const d = el.children.find((c) => c.tag === "Decorations")?.children.find((c) => c.tag === "Decoration" && (c.attrs.type ?? "0") === "0");
  return d?.attrs.currentSku || undefined;
}

function parseItem(el: El): PlacedItem {
  const state = el.children.find((c) => c.tag === "State");
  const a = el.attrs;
  return {
    sid: a.sid ?? "",
    sku: a.sku ?? "",
    x: Number(a.x ?? 0),
    y: Number(a.y ?? 0),
    stateId: Number(state?.attrs.id ?? 0),
    state: state?.attrs ?? {},
    suspended: a.isSuspended === "1",
    ...(skinOf(el) ? { skin: skinOf(el) } : {}),
    ...(el.children.some((c) => c.tag === "Crew") ? { crew: { ids: el.children.find((c) => c.tag === "Crew")?.attrs.ids ?? "", bought: el.children.find((c) => c.tag === "Crew")?.attrs.bought ?? "" } } : {})
  };
}
