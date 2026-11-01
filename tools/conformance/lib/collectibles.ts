import fs from "node:fs";
import path from "node:path";
import type { GameClient } from "./client.js";
import { mkHq, mkItem } from "./saves.js";
import type { ServerHandle } from "./server.js";
import { REPO_ROOT } from "./util.js";

/** Collectible drop chance by contract income hours, percent (CollectiblesRules.java:182 chances table; parity.test.ts golden). */
export const CHANCE_PERCENT_BY_HOURS = new Map<number, number>([
  [0.05, 1.25], [0.5, 2.5], [1, 3.75], [2, 5.625], [4, 3.75], [8, 6.6667], [12, 12.0833], [18, 14.5833], [24, 20.8333], [48, 13.75], [72, 13.75]
]);

const CONTRACTS_XML = path.join(REPO_ROOT, "assets", "dchoc1-a.akamaihd.net", "0.501", "mcity", "Datas", "rules", "contracts.xml");

/** contract sku -> income hours (contracts.xml, the game data both servers read). */
export function contractHours(): Map<string, number> {
  const xml = fs.readFileSync(CONTRACTS_XML, "utf8");
  const map = new Map<string, number>();
  for (const tag of xml.match(/<Definition\b[^>]*\/>/g) ?? []) {
    const sku = tag.match(/\bsku="([^"]*)"/)?.[1];
    const hours = Number(tag.match(/\bincomeTime="([^"]*)"/)?.[1]);
    if (sku) map.set(sku, hours);
  }
  return map;
}

export function dropChance(contractSku: string): number {
  const hours = contractHours().get(contractSku);
  const percent = hours === undefined ? undefined : CHANCE_PERCENT_BY_HOURS.get(hours);
  return percent === undefined ? 0 : percent / 100;
}

/** The deterministic roll input the server uses per rent cycle: `${sid}:${itemSku}:${contractSku}:${savedAt}` (string hash). */
export function stableTestHash(value: string): number {
  let hash = 17;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

export function rollOf(sid: string, sku: string, contractSku: string, savedAt: string): number {
  return (Math.abs(stableTestHash(`${sid}:${sku}:${contractSku}:${savedAt}`)) % 100000) / 100000;
}

export function findCollectibleSavedAt(sid: string, sku: string, contractSku: string, shouldAward: boolean): string {
  const chance = dropChance(contractSku);
  for (let offset = 0; offset < 200000; offset += 1) {
    const savedAt = String(1_700_000_000_000 + offset);
    if ((rollOf(sid, sku, contractSku, savedAt) <= chance) === shouldAward) return savedAt;
  }
  throw new Error(`Unable to find collectible test seed for ${sid}/${sku}/${contractSku}`);
}

/** A savedAt whose roll bucket (roll * 100000) is exactly `bucket`. */
export function findSavedAtForBucket(sid: string, sku: string, contractSku: string, bucket: number): string {
  for (let offset = 0; offset < 4_000_000; offset += 1) {
    const savedAt = String(1_700_000_000_000 + offset);
    if (Math.abs(stableTestHash(`${sid}:${sku}:${contractSku}:${savedAt}`)) % 100000 === bucket) return savedAt;
  }
  throw new Error(`no savedAt for bucket ${bucket}`);
}

/**
 * Seed rent cycles (level 6 save, houses rent-running with the given savedAt), make every house rent-ready with new_mode(5)
 * in ONE request, and return the set of house sids that received a pending collectible.
 */
export async function awardedSids(
  server: ServerHandle,
  client: GameClient,
  cases: Array<{ sid: string; contractSku: string; savedAt: string }>
): Promise<Set<string>> {
  await server.seed((db) =>
    db.editUniverse(({ profile, mine }) => {
      profile.tutorialEnd = "1";
      profile.level = "6";
      mine.Company.push(mkHq("9990"));
      cases.forEach((c, i) => {
        mine.Company.push(
          mkItem(c.sid, "houses_001_001", String(20 + (i % 10) * 3), String(20 + Math.floor(i / 10) * 3), {
            id: "1", mode: "4", time: "1800000", contractSku: c.contractSku, savedAt: c.savedAt
          })
        );
      });
    })
  );
  await client.cmdList(
    cases.map((c) => ["update_item", { action: "new_mode", sid: c.sid, mode: 5, time: 0, contractSku: Number(c.contractSku) }] as [string, any])
  );
  const doc = server.doc<any>("collectiblesList");
  const pending = doc.collectiblesList.find((e: any) => Array.isArray(e.Pending));
  const tupla = String(pending?.tupla ?? "");
  const awarded = new Set<string>();
  for (const part of tupla.split(",").filter(Boolean)) awarded.add(part.split(":")[0]);
  return awarded;
}
