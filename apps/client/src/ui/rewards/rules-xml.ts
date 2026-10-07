// Tiny rules-XML reader for the reward/social areas (rules live at /mcity/0.501/Datas/rules/*.xml).
import { RULES_ROOT } from '../../game/rules';

export interface XmlNode {
  tag: string;
  a: Record<string, string>;
  children: XmlNode[];
}

export function parseXml(text: string): XmlNode {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const conv = (e: Element): XmlNode => ({
    tag: e.tagName,
    a: Object.fromEntries(Array.from(e.attributes).map((x) => [x.name, x.value])),
    children: Array.from(e.children).map(conv),
  });
  return conv(doc.documentElement);
}

const cache = new Map<string, Promise<XmlNode>>();
export function loadRuleXml(file: string): Promise<XmlNode> {
  let p = cache.get(file);
  if (!p) {
    p = fetch(RULES_ROOT + file).then((r) => (r.ok ? r.text() : '<x/>')).then(parseXml);
    cache.set(file, p);
  }
  return p;
}

/** Flat list of all descendants with the given tag. */
export function findAll(n: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode) => {
    if (x.tag === tag) out.push(x);
    x.children.forEach(walk);
  };
  walk(n);
  return out;
}
