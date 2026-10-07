// Bundled stand-ins for the Flash-embedded fonts (offline via Vite). Side-effect import.
// Face-name -> CSS mapping lives in fontmap.ts (pure, unit-tested).
import '@fontsource/lilita-one/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';

// Original embedded fonts (DefineFont3 of Dollars.swf exported with ffdec), full Latin glyph sets.
const ORIGINAL_FACES: Array<[string, string]> = [
  ['MC Challenge Bold LET', '/fonts/ChallengeBoldLET.ttf'],
  ['MC Helvetica Rounded Bd', '/fonts/HelveticaRoundedBd.ttf'],
];
const originalLoaded =
  typeof document === 'undefined' || typeof FontFace === 'undefined'
    ? Promise.resolve()
    : Promise.all(
        ORIGINAL_FACES.map(async ([family, url]) => {
          try {
            const face = new FontFace(family, `url(${url})`);
            document.fonts.add(await face.load());
          } catch {
            /* fall back to the stand-in webfonts */
          }
        }),
      ).then(() => undefined);

/** Resolve once the stand-in webfonts are usable (so measuring/shrinking text is accurate). */
export async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await originalLoaded;
  await Promise.all(
    ["400 20px 'Lilita One'", "400 20px 'Anton'", "700 20px 'Nunito'", "800 20px 'Nunito'", "900 20px 'Nunito'"].map((f) =>
      document.fonts.load(f, 'Aa0'),
    ),
  );
  await document.fonts.ready;
}
