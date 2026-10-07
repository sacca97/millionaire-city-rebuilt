/** DCTextField behaviours: TextManager.setTextScaled (shrink-to-fit) and DCGuiUtils.setTextAndResizeBackground. */
export const MIN_FONT_SIZE = 10;
export const HORIZONTAL_MARGIN = 4;
export const VERTICAL_MARGIN = 2;

/** Largest size <= start (down to min) for which `tooBig` is false (pure core of setTextScaled). */
export function shrinkSize(start: number, min: number, tooBig: (size: number) => boolean): number {
  let size = start;
  while (size > min && tooBig(size)) size--;
  return size;
}

export interface FitOptions {
  /** Minimum font size (default 10, MIN_FONT_SIZE). */
  min?: number;
  /** Extra width margin (setTextScaled param3, default 4 = Flash gutters). */
  margin?: number;
}

/**
 * Shrink the font of a text field until its text fits the box: width (textWidth + margin <= field width, unwrapped fields)
 * and height (textHeight + 2 <= field height). `box` is the .g-text element (explicit width/height), `span` the .g-t.
 */
export function fitTextToBox(box: HTMLElement, span: HTMLElement, base: number, opts: FitOptions = {}): number {
  const min = opts.min ?? MIN_FONT_SIZE;
  const margin = opts.margin ?? HORIZONTAL_MARGIN;
  const boxW = parseFloat(box.style.width) || box.offsetWidth;
  const boxH = parseFloat(box.style.height) || box.offsetHeight;
  // a wrapped field whose text has no break opportunity is measured like a single line (word can't wrap)
  const wrap = box.classList.contains('g-wrap') && /\s/.test((span.textContent ?? '').trim());
  // Oracle: shrunk captions (e.g. the 127 px "Commerce Collections" tab) stay readable at ~13 px, so the authored letter spacing shrinks with the size.
  const ls0 = parseFloat(span.style.letterSpacing) || 0;
  if (ls0 && span.dataset.ls0 === undefined) span.dataset.ls0 = String(ls0);
  const lsBase = span.dataset.ls0 !== undefined ? Number(span.dataset.ls0) : 0;
  const measure = (size: number) => {
    span.style.fontSize = `${size}px`;
    if (lsBase) span.style.letterSpacing = `${(lsBase * size) / base}px`;
    span.style.flexShrink = '0'; // fields are flex boxes: a shrinkable item would always measure as fitting
    if (wrap) {
      span.style.width = `${Math.max(1, boxW - margin)}px`;
      return { w: span.scrollWidth - 1, h: span.offsetHeight }; // (-1: sub-pixel rounding) scrollWidth > width => an unbreakable word overflows
    }
    span.style.width = 'max-content';
    return { w: span.offsetWidth, h: span.offsetHeight };
  };
  const size = shrinkSize(base, min, (s) => {
    const m = measure(s);
    return (m.w + (wrap ? 0 : margin) > (wrap ? boxW - margin : boxW)) || m.h + VERTICAL_MARGIN > boxH;
  });
  measure(size);
  span.style.width = '100%';
  return size;
}
