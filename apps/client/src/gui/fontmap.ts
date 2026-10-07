/**
 * Maps the face names found in layout.json text symbols (the Flash-embedded fonts) to CSS stand-ins.
 * Pure module (no CSS imports) so it can be unit tested; the webfonts are bundled by fonts.ts.
 *
 * Challenge Bold LET is a slanted bold display sans. Compared visually against the FFDec renders of the
 * button captions: Lilita One + synthetic oblique is the closest in width and weight (Anton/Bebas are too narrow/upright).
 * Helvetica Rounded LT Std (Bd/Blk/BdCn) -> Nunito 800/900 (rounded sans).
 */
export interface FontSpec {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** Letter-spacing adjustment factor in em (negative = tighter), for condensed faces. */
  tracking?: number;
}

// The two embedded faces are extracted from the original SWFs (ffdec -export font -> public/fonts/*.ttf, see fonts.ts); the stand-ins
// stay as fallbacks while the files load. Challenge Bold LET is already slanted, so no synthetic oblique and no tracking tweak.
const CHALLENGE: FontSpec = { family: "'MC Challenge Bold LET', 'Lilita One', 'Impact', sans-serif", weight: 400, style: 'normal' };
const HELV_BOLD: FontSpec = { family: "'MC Helvetica Rounded Bd', 'Nunito', 'Arial Rounded MT Bold', Arial, sans-serif", weight: 400, style: 'normal' };

export function normalizeFace(face: string | undefined): string {
  return (face ?? '').replace(/\0/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Resolve a layout.json font face (+ bold/italic flags) to a CSS font spec. */
export function fontSpecFor(face: string | undefined, bold?: boolean, italic?: boolean): FontSpec {
  const f = normalizeFace(face);
  if (f.startsWith('challenge')) return { ...CHALLENGE };
  if (f.startsWith('helveticarounded') || f.startsWith('helvetica rounded')) {
    if (/\b(blk|black)\b/.test(f)) return { ...HELV_BOLD };
    if (/(bdcn|condensed)/.test(f)) return { ...HELV_BOLD };
    return { ...HELV_BOLD };
  }
  if (f === 'arial black') return { family: "'Arial Black', 'Arial', sans-serif", weight: 900, style: 'normal' };
  if (f === 'arial' || f === '' || f.startsWith('arial')) {
    return { family: "Arial, 'Liberation Sans', Helvetica, sans-serif", weight: bold ? 700 : 400, style: italic ? 'italic' : 'normal' };
  }
  if (f.startsWith('chaparral')) {
    return { family: "'Chaparral Pro', Georgia, 'Times New Roman', serif", weight: bold ? 700 : 400, style: italic ? 'italic' : 'normal' };
  }
  return { family: "'Nunito', Arial, sans-serif", weight: bold ? 800 : 700, style: italic ? 'italic' : 'normal' };
}

/** CSS declarations for a font spec at a pixel size. */
export function fontCss(spec: FontSpec, sizePx: number): string {
  return (
    `font-family:${spec.family};font-weight:${spec.weight};font-style:${spec.style};font-size:${sizePx}px;` +
    (spec.tracking ? `letter-spacing:${spec.tracking}em;` : '')
  );
}
