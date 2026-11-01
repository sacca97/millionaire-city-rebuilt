import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../fixtures/golden.json"), "utf8")) as {
  starterDecorationSkus: string[];
  starterDecorationValue: number;
  ronaldLayoutItemCount: number;
  ronaldPlotsType: string;
};

/** Listen on a free-range port ourselves (a "port is busy" blocker). */
export async function blockPort(port: number): Promise<net.Server> {
  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, "127.0.0.1", () => resolve());
  });
  return blocker;
}

export function closeBlocker(blocker: net.Server): Promise<void> {
  return new Promise((resolve) => blocker.close(() => resolve()));
}

/** True when something accepts TCP connections on host:port. */
export function isListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

/** Roads occupied by an NPC world's map (as in the original helper). */
export function extractRoadTiles(worldEntry: { World: Array<Record<string, unknown>> }): Set<string> {
  const mapEntry = worldEntry.World.find((entry) => Array.isArray(entry.Map)) as { Map: Array<Record<string, unknown>> } | undefined;
  const roadEntry = mapEntry?.Map.find((entry) => Array.isArray(entry.Road)) as { chunk?: string } | undefined;
  return new Set((roadEntry?.chunk ?? "").split(",").filter(Boolean));
}

export function getItemsOverlappingRoads(items: Array<Record<string, unknown>>, roadTiles: Set<string>): string[] {
  const overlaps: string[] = [];
  for (const item of items) {
    const sku = String(item.sku ?? "");
    const footprint = getFootprintForSku(sku);
    if (!footprint) continue;
    const startX = Number(item.x ?? 0);
    const startY = Number(item.y ?? 0);
    let isOverlapping = false;
    for (let y = startY; y < startY + footprint.height && !isOverlapping; y += 1) {
      for (let x = startX; x < startX + footprint.width; x += 1) {
        if (roadTiles.has(`${x}:${y}`)) {
          overlaps.push(`${sku}@${startX}:${startY}`);
          isOverlapping = true;
          break;
        }
      }
    }
  }
  return overlaps;
}

function getFootprintForSku(sku: string): { width: number; height: number } | undefined {
  switch (sku) {
    case "HeadQuarter": return { width: 4, height: 3 };
    case "commerce_pizza":
    case "houses_002_001":
    case "houses_002_002": return { width: 3, height: 3 };
    case "houses_001_002":
    case "decorations_font_02": return { width: 2, height: 2 };
    case "decorations_tree_05": return { width: 2, height: 1 };
    default: return undefined;
  }
}

import os from "node:os";
export const REPO_ROOT = path.resolve(__dirname, "../../..");
const DATAS = path.join(REPO_ROOT, "assets", "dchoc1-a.akamaihd.net", "0.501", "mcity", "Datas");

/** Same availability check as apps/server/test/server.test.ts hasArchivedAssetFiles(): the archived game data in assets/. */
export function hasArchivedAssetFiles(): boolean {
  const required = [
    "rules/itemDefinitions.xml", "rules/commerceDefinitions.xml", "rules/decorationDefinitions.xml", "rules/wonderDefinitions.xml",
    "rules/missionDefinitions.xml", "rules/XPTable.xml", "rules/fbcredits.xml", "rules/collectiblesDefinitions.xml",
    "rules/collectiblesGroupsDefinitions.xml", "rules/collectiblesRewardDefinitions.xml", "feed/new_feed_upgrades_0.jpg",
    "Assets/items/CommerceTypes/icons/commerce_bank.png"
  ];
  return required.every((f) => fs.existsSync(path.join(DATAS, f)));
}
void os;
