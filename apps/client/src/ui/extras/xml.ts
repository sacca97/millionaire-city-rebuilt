// DOM-free reader for the flat `<Definition a="b" .../>` rules files (usable in unit tests).
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

/** Attributes of every <Definition> element, in file order. */
export function definitions(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of xml.matchAll(/<Definition\b([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const at of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) a[at[1]] = at[2].replace(/&\w+;/g, (e) => ENT[e] ?? e);
    out.push(a);
  }
  return out;
}
