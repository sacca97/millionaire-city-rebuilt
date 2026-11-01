import { request, definitionTags, xmlAttr } from "./http.js";
import type { ServerHandle } from "./server.js";

export interface DailyRewardDef { sku: string; bonusType: string; bonusValue: string; group: number; chances: number; date?: string }

/** dailyRewardsDefinitions.xml as served by the server (the rule data the server itself uses). */
export async function dailyRewardDefs(server: ServerHandle): Promise<DailyRewardDef[]> {
  const res = await request(`${server.httpUrl}/mcity/0.501/Datas/rules/dailyRewardsDefinitions.xml`);
  return definitionTags(res.text).map((tag) => ({
    sku: xmlAttr(tag, "sku")!,
    bonusType: xmlAttr(tag, "bonusType")!,
    bonusValue: xmlAttr(tag, "bonusValue")!,
    group: Number(xmlAttr(tag, "group")),
    chances: Number(xmlAttr(tag, "chances")),
    date: xmlAttr(tag, "date")
  }));
}

export function rewardDef(defs: DailyRewardDef[], sku: string): DailyRewardDef | undefined {
  return defs.find((d) => d.sku === sku);
}

/** First undated reward sku of a group. */
export function rewardSkuOfGroup(defs: DailyRewardDef[], group: number): string {
  const def = defs.find((d) => d.group === group && !d.date);
  if (!def) throw new Error(`no reward in group ${group}`);
  return def.sku;
}

/** Profile fields a daily reward grants. */
export function rewardGainField(def: DailyRewardDef | undefined): { value: number; field: string } {
  return { value: Number(def?.bonusValue), field: def?.bonusType === "exp" ? "exp" : def?.bonusType === "cash" ? "DCCash" : "DCCoins" };
}
