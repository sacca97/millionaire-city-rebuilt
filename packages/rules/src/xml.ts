/** Minimal dependency-free XML attribute parser (self-closing and open tags). */
export type Attrs = Record<string, string>;

export function parseAttributes(blob: string): Attrs {
  const out: Attrs = {};
  for (const m of blob.matchAll(/([A-Za-z0-9_:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** All `<tag ...>` / `<tag .../>` elements with that name, in document order (children included, flat). */
export function parseElements(xml: string, tag: string): Attrs[] {
  const re = new RegExp(`<${tag}\\b([^>]*?)/?>`, "g");
  return [...xml.matchAll(re)].map((m) => parseAttributes(m[1] ?? ""));
}
