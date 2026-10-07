// Node-side loaders for tests: rules XML from the repo assets instead of fetch().
import fs from "node:fs";
import path from "node:path";
import { parseDefinitions, parseElements, type ItemKind } from "@mcity/rules";
import type { DefinitionTable } from "../src/model/definitions";

export const RULES_DIR = path.resolve(__dirname, "../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules");

export const fetchText = async (file: string): Promise<string> => {
  const p = path.join(RULES_DIR, file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

export function loadDefsSync(): DefinitionTable {
  const files: Array<[string, ItemKind]> = [
    ["itemDefinitions.xml", "houses"],
    ["commerceDefinitions.xml", "commerce"],
    ["decorationDefinitions.xml", "decoration"],
    ["wonderDefinitions.xml", "other"],
    ["clubDefinitions.xml", "other"]
  ];
  const table: DefinitionTable = new Map();
  for (const [file, kind] of files) {
    const text = fs.readFileSync(path.join(RULES_DIR, file), "utf8");
    const typed = new Map(parseDefinitions(text, kind).map((d) => [d.sku, d]));
    for (const attrs of parseElements(text, "Definition")) {
      if (attrs.sku) {
        table.set(attrs.sku, { sku: attrs.sku, cols: Number(attrs.baseCols ?? 1), rows: Number(attrs.baseRows ?? 1), attrs, rules: typed.get(attrs.sku)! });
      }
    }
  }
  return table;
}
