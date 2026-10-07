/**
 * Localisation. Original texts are one string per line in Datas/Locale/<LANG>.txt, indexed by the TID_* constants
 * (TextIDs.as; generated into tids.ts). Parameters use "%U" (= param 0) / "%U<n>" placeholders; "{0xRRGGBB}..{/}" marks colour spans.
 * Ports TextManager.getText / replaceParameters / loadText / changColors from the original client.
 */
import { TID } from './tids';

export type Tid = string | number;

/** Where the server serves the original locale files (proxied by Vite). */
export const LOCALE_URL = '/mcity/0.501/Datas/Locale';

let texts: string[] = [];
let lang = 'EN';

/** Parse a locale file body: split on newline, "\n" escapes become real newlines (TextManager.loadText). */
export function parseLocale(body: string): string[] {
  return body
    .replace(/^﻿/, '')
    .split('\n')
    .map((l) => l.replace(/\r$/, '').replace(/(\\n |\\n)/g, '\n'));
}

export function setLocale(lines: string[] | string, language = 'EN'): void {
  texts = typeof lines === 'string' ? parseLocale(lines) : lines;
  lang = language;
}

export function currentLang(): string {
  return lang;
}

export async function loadLocale(language = 'EN', fetchFn: typeof fetch = fetch, base = LOCALE_URL): Promise<void> {
  let res = await fetchFn(`${base}/${language}.txt`);
  if (!res.ok && language !== 'EN') {
    language = 'EN'; // original falls back to EN on load error
    res = await fetchFn(`${base}/EN.txt`);
  }
  if (!res.ok) throw new Error(`locale ${language}: HTTP ${res.status}`);
  setLocale(await res.text(), language);
}

/** Numeric index for a TID name ('TID_BUY_FOR') or number; -1 if unknown. */
export function tidIndex(tid: Tid): number {
  if (typeof tid === 'number') return tid;
  const i = TID[tid.startsWith('TID_') ? tid : `TID_${tid}`];
  return i === undefined ? -1 : i;
}

/** TextManager.getText: raw string for a TID (empty for -1, key itself if unknown or not loaded). */
export function getText(tid: Tid): string {
  const i = tidIndex(tid);
  if (i < 0) return typeof tid === 'string' ? tid : '';
  const s = texts[i];
  return s === undefined ? (typeof tid === 'string' ? tid : '') : s;
}

function paramIndex(pos: number, s: string): number {
  let i = pos + 2;
  let digits = '';
  while (i < s.length && s[i] >= '0' && s[i] <= '9') digits += s[i++];
  return digits === '' ? -1 : parseInt(digits, 10);
}

/** TextManager.replaceParameters on a literal string. */
export function replaceParams(s: string, params: readonly unknown[]): string {
  let guard = 0;
  for (;;) {
    const at = s.indexOf('%U');
    if (at < 0 || guard++ > 64) return s;
    const idx = paramIndex(at, s);
    if (idx === -1) s = s.replace('%U', () => String(params[0] ?? ''));
    else s = s.replace(`%U${idx}`, () => String(params[idx] ?? ''));
  }
}

/** Localised text with %U parameters substituted. */
export function t(tid: Tid, params: readonly unknown[] = []): string {
  return params.length ? replaceParams(getText(tid), params) : getText(tid);
}

export interface TextSpan {
  text: string;
  /** CSS colour from a {0xRRGGBB} tag, if any. */
  color?: string;
}

/** Split "{0xRRGGBB}coloured{/} plain" into spans (TextManager.changColors). */
export function parseColorSpans(s: string): TextSpan[] {
  const out: TextSpan[] = [];
  const re = /\{0x([0-9a-fA-F]{6})\}([\s\S]*?)\{\/\}/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[2], color: `#${m[1].toLowerCase()}` });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** Strip colour tags. */
export function stripColorTags(s: string): string {
  return parseColorSpans(s)
    .map((p) => p.text)
    .join('');
}
