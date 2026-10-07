// Item definitions from the original rules XML (served by the local server).
// Interim loader: replaced by @mcity/rules once that package is wired in.

import { parseDefinitions, type ItemDefinition, type ItemKind } from "@mcity/rules";

const RULES = "/mcity/0.501/Datas/rules/";
const FILES: Array<[string, ItemKind]> = [
  ["itemDefinitions.xml", "houses"],
  ["commerceDefinitions.xml", "commerce"],
  ["decorationDefinitions.xml", "decoration"],
  ["wonderDefinitions.xml", "other"],
  ["clubDefinitions.xml", "other"]
];

export interface ItemDef {
  sku: string;
  cols: number;
  rows: number;
  /** All XML attributes, raw. */
  attrs: Record<string, string>;
  /** Typed rules definition (@mcity/rules). */
  rules: ItemDefinition;
}

export type DefinitionTable = Map<string, ItemDef>;

export async function loadDefinitions(): Promise<DefinitionTable> {
  const table: DefinitionTable = new Map();
  await Promise.all(
    FILES.map(async ([file, kind]) => {
      const res = await fetch(RULES + file);
      if (!res.ok) {
        return;
      }
      const text = await res.text();
      const typed = new Map(parseDefinitions(text, kind).map((d) => [d.sku, d]));
      const doc = new DOMParser().parseFromString(text, "text/xml");
      for (const el of Array.from(doc.getElementsByTagName("Definition"))) {
        const sku = el.getAttribute("sku");
        if (!sku) {
          continue;
        }
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) {
          attrs[a.name] = a.value;
        }
        table.set(sku, {
          sku,
          cols: Number(attrs.baseCols ?? 1),
          rows: Number(attrs.baseRows ?? 1),
          attrs,
          rules: typed.get(sku)!
        });
      }
    })
  );
  return table;
}
