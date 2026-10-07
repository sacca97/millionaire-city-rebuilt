# GUI assets (original SWF art -> PNG + JSON layouts)

Generate with `python3 tools/export_gui.py [--only hud,shop] [--jobs 4]`. Output goes to
`apps/client/public/gui/<name>/` (gitignored, ~113 MB for the whole set, ~2 min with 4 workers).
Needs java, FFDec (`generated/tools/ffdec-26.0.0`), `rsvg-convert`, PIL. No SVG renderer inside Pixi is needed:
shapes are rasterised once to PNG.

## Output per SWF

- `layout.json`: `classes` (SymbolClass name -> symbol id), `symbols` (id -> shape | text | sprite),
  `root` (main timeline), `fonts`, `stage` rect, `frameRate`.
- `shapes/<id>.png`: each DefineShape (gradients/bitmaps included). The PNG's top-left is the shape's `bounds` min.
- `sprites/<Class>/<n>.png`: FFDec composite of each exported class frame (1-based), top-left = sprite `bounds` min.
  Handy as a fallback or for static art (item icons, collectable images) where you do not need the children.
- `apps/client/public/gui/index.json`: swf name -> source path.

Sprite `frames` hold the full simulated display list per frame (`0` = same as previous). Each placement:
`d` depth, `ref` symbol id, `n` instance name, `m` matrix `[a b c d tx ty]` in pixels (Flash order),
`ct` colour transform `{mult,add}`, `f` filters (dropshadow/glow/colormatrix, raw FFDec params), `clip` (mask until depth),
`bm` blend mode, `vis:false`. Frame `labels` map to 0-based frame indexes; sprites with `UpState/OverState/DownState`
labels are flagged `button:true` (the original buttons are labelled MovieClips, not DefineButton; none were found).
Text symbols carry font, size, colour, align, default text, html, wrap flags, letterSpacing, leading.

Reader: `apps/client/src/gui/layout.ts` (`loadLayout`, `instantiate(layout, 'popup_confirm', {baseUrl})`,
`instantiateRoot`, `findByName`, `walk`, `classPreview`). Throwaway demo: `apps/client/gui-test.html`
(`src/gui/test-page.ts`, DOM renderer).

## Catalogue (SWF -> classes / screen)

Paths are relative to `assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/`.

| name | SWF | contents |
|---|---|---|
| hud | Assets/hud/hud.swf | 225 classes: HUD bars (Bar_building/contract/demolition), friends bar + hud_friend_box*, button_gifts, featured_box, callbox, advisor_shop_*, ~100 gift/collection icons (gift_NNN, coll_gift_NNN), decorations, houses icons |
| Dollars | Dollars.swf | 56 classes: main client library (loading, misc popups); 3 classes are font containers |
| shop | popups/shop/shop.swf | shop_box (+_crew/_locked/_promoted/_wonder), tooltip, tooltip_element |
| popup_standard | popups/popup_standard.swf | popup frame, text_normal, text_title |
| popup_confirm / popup_confirm_buy / popup_instant_build / exchange_fbc / crew_mechanics | popups/... | confirm dialogs, buy confirm, "Instant build", FB-credit exchange, crew box |
| buttons | popups/buttons.swf | 12 buttons: close, positive/neutral/negative/gold, fc/cash/gold icon variants, arrows (labelled up/over/down) |
| collectables | Assets/GUI/collectables.swf | collections screen (218 classes, includes collectable art) |
| contracts | Assets/GUI/contracts.swf | contract popup |
| Dailybonus | Assets/GUI/Dailybonus.swf | daily bonus |
| expansions | Assets/GUI/expansions.swf | expansion confirm/for-sale popups, box_cash/gold/fbc, buy buttons |
| houses_info | Assets/GUI/houses_info.swf | house info panels (138 classes) |
| investment | Assets/GUI/investment.swf | investment popups (start/accept/results/friends) |
| Missions / missions_layout | Assets/GUI/Missions.swf, Assets/missions/missions_layout.swf | missions list/popup, mission tooltip/new/progress badges |
| beat_2, bonus_houses_001(_001), build_Decorations_tree, checkInfluence_commerce_pizza | Assets/missions/*.swf | one `image` class (102x102 mission icon) each |
| Storage | Assets/GUI/Storage.swf | storage popup, storage_box |
| newspaper / magazine_cover | newspaper.swf, magazine_cover.swf | journal popups |
| plain | plain.swf | plane/banner animations |

Not converted (already PNG): `Assets/npcs/*.png`, `Assets/missions/icons/*.png`. Items/terrain use the existing item exporter.
Use the decompiled `getSWFClass` calls (`decompiled/scripts/com/dchoc/dollars/popups`, `containers`) to map screens to classes.

## Fonts

Embedded (DefineFont3): `Challenge Bold LET` (titles, buttons, numbers; almost everywhere),
`Helvetica Rounded LT Std Bold` (+ `Condensed`, `Black`), `Arial`, `Arial Black`, `Chaparral Pro` (newspaper only).
The font files are not extractable usably (glyph outlines only). Stand-ins: Challenge Bold LET ~ a bold condensed display face
(Impact / "Anton" / "Bebas Neue" webfont); Helvetica Rounded Bold ~ "Arial Rounded MT Bold" / "Nunito" 800; Arial/Arial Black are system fonts.
Layout JSON stores the original face name so a CSS mapping table can swap in webfonts. Text sizes are the original px sizes;
expect small metric differences until a matching webfont is bundled.

## Known gaps

- Fonts as above (no glyph rendering from the SWF; static `DefineText` only gives bounds).
- Filters (drop shadow/glow/colour-matrix) are exported as data, but the shape PNGs are unfiltered; the reader does not apply them.
- Masks: `clip` depth is exported, no renderer implements it yet. 9-slice (`scale9Grid`) is not exported (popup frames are fixed-size art).
- Morph shapes (tweens, many in collectables/houses_info) appear as `morph` placeholders (bounds only).
- Button/animation timeline scripts (AS3) are not read: frame 0 shows everything the first frame places, including items the code toggles
  (progress bars, "Time Left", magenta placeholder squares where code swaps in buttons/images).
- Colour transforms are exported (`ct`); the reader only derives `alpha` from them.

## UI toolkit (apps/client/src/gui)

`fonts.ts`/`fontmap.ts` (Challenge Bold LET -> Lilita One oblique; HelveticaRounded* -> Nunito 800/900; Arial -> system), `i18n.ts` + `tids.ts`
(`tools/gen_tids.py`; texts from `Datas/Locale/EN.txt`, served at `/mcity/0.501/Datas/Locale`), `format.ts` (TextManager number/time formats),
`widget.ts`/`button.ts`/`popup.ts`/`popups.ts`/`progress.ts`/`scroll.ts`/`tooltip.ts`, `effects.ts` (filters, colour transforms, clip masks).
Gallery: `apps/client/gallery.html` (`?open=confirm|trade|instant|exchange|standard`).

### archive-recovery-2026-10-06 findings
- Localization CSVs (`localization/cdn/Locale/textos/*.csv`, keyed by TID name, 1931 rows) are an OLDER text revision (1928-TID client; 365 TIDs of the
  2106 used by 0.501 are absent, 347 texts differ). The repo's EN.txt covers all 2106 TIDs with no gaps, so it is the only runtime source; the CSVs
  are only useful for other languages (columns ES/FR/IT/DE/...), keyed by TID name, if non-EN locales are ever needed.
- `recovered-xfl` holds only item FLAs (`Assets/items/*`) plus `Assets/GUI/Missions` (127 LIBRARY xml files). No `scaleGrid`/9-slice settings anywhere,
  face names are `ChallengeBoldLetPlain` / `HelveticaRoundedLTStd-Bd` (same two fonts, no font outlines), text fields (`DOMDynamicText`) carry
  the same name/size data as the SWF exports. Nothing there improves fidelity beyond the existing exports; not used.
