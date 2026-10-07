
## Assets and build

Measured on the unmodified tree vs the optimised tree (built to a scratch `--outDir`, served by the game server on a temp DB, Chromium + SwiftShader, `?skipTutorial`, 1280x800).

| | before | after |
|---|---|---|
| production build size | 537 MB (36,126 PNGs) | 277 MB (sprites 157 MB, gui 111 MB, ground 5 MB, JS+fonts 1.7 MB) |
| boot requests / bytes | 311 / 14.4 MB | 260 / 7.8 MB (ready in ~2 s; zero failed requests) |
| JS | 1.0 MB, 4 rollup dynamic/static warnings | index 0.42 MB + `pixi` vendor chunk 0.59 MB (gzip 130+173 KB, brotli 104+141 KB), no warnings |
| fonts | all unicode subsets (~50 files) | latin subsets only |

What was done (nothing in `apps/client/public` was modified; the optimised tree is a separate copy):

- `tools/optimize_assets.py` reads `public/` (run after export_all_items, export_hq, fix_old_grass, export_gui) and writes `apps/client/public-opt/` (gitignored):
  - sprites: removes clips the client cannot request (only `normal`, `normal_2`, `building`, `BarPosition`, `car`, `Effect_<i>[_top|_people]`; a clip with a `_new` twin is never loaded because `SpriteLibrary.symbol` prefers it): 333 clips; de-duplicates pixel-identical frames (16,454 referenced frames -> 9,402 files); converts to lossless WebP; rewrites `index.json`, `cars/index.json`, `_building_state/index.json`.
  - gui + `ground/background`: lossless WebP, URLs unchanged (`X.png` is answered from `X.webp`, see below). ground 8.2 -> 5.2 MB. json minified.
  - every conversion is verified in the script by decoding both files and comparing RGBA arrays (including fully transparent pixels): 15,474 files checked, 0 differences (the script aborts on any mismatch).
  - `--dry-run` reports counts without writing. `tools/prune_assets.py` is the in-place/dry-run reporter for unreachable sprite files (default dry run; prefer optimize_assets.py).
- Build switch: `MCITY_OPT=1 npx vite build` (or `npm run build:opt -w @mcity/client`) uses `public-opt`; default uses `public`. `MCITY_NO_PUBLIC=1` builds code only.
- `vite.config.ts`: latin-only `@fontsource` aliases, `pixi` manualChunks, precompressed `.br`/`.gz` for text output, dev/preview `.png -> .webp` fallback.
- Static imports now consistent (rivals.ts, flows.ts, expansion.ts, contract.ts): the dynamic imports were ineffective anyway.
- Server (`apps/server/src/clientStatic.ts`, tests in `test/clientStatic.test.ts`): `/assets/*` immutable 1 year; `/sprites /gui /ground /audio /fonts` max-age 1 day + ETag/Last-Modified; `index.html` no-cache; precompressed br/gzip for js/css/json/html (gzip on the fly, cached, if no precompressed file); `.png` under gui/ground/sprites served from `.webp` when only that exists. `/Game` and API routes are untouched and uncached.
- index.json/layout.json minification: gui json is minified in the optimised tree; per-sku splitting was not needed (precompressed json is small; boot is dominated by the ~230 gui shape/preview images, not json).

Not done: gui preview pruning (only ~15 MB, and classes can be built from computed names, so it is unsafe without a full UI coverage run); tiling the ground backdrop (single 5 MB WebP decodes fast enough).

Applying it (the user runs this when no other agent uses `apps/client/public`):

```text
python3 tools/optimize_assets.py                 # already produced public-opt; re-run after any re-export
python3 tools/apply_optimised_assets.py apply    # public -> public-bak, public-opt -> public   (restore: ... restore)
npm run build:client                             # or: MCITY_OPT=1 npx vite build without swapping
```

Re-export workflow: the export scripts still emit PNGs (fix_old_grass needs them); always finish with optimize_assets.py.

## Runtime performance with a large city (client view/ui)

Stress city: 25/25 plots, 441 items (houses, commerce, decorations, clubs), grid roads, ~50 abandoned, ~170 rent-ready, 48 under construction. Built by a throwaway vitest seeding through the real `Game` (kept out of the repo). Headless Chromium, SwiftShader, 1280x800, shared loaded machine (load avg ~11), so absolute fps is noisy; paired runs alternate before/after. Unminified builds, `view/`, `ui/extras` only; no game logic, events or commands changed.

| Scenario | Before | After |
|---|---|---|
| Idle fps (3 paired runs) | 27.6-28.2 | 30.4-30.8 |
| Zoomed in fps (paired) | 27.4-28.4 | 29.8-30.4 |
| JS per frame, idle | 4.4 ms | 1.9-2.7 ms |
| JS per frame, panning | 6.8 ms | 2.6-3.2 ms |
| JS per frame, ghost following cursor | 9.3 ms | 3.1-3.3 ms |
| DOM nodes (abandoned bubbles ~300 each) | 23.5k reported by CDP / 12.4k elements | 12.3k / 10.5k |
| Heap growth over idle soak | +14.5 MB (noisy GC) | -3 to +5 MB |
| Economy recompute for 441 items | 2.9 ms | 2.8-3.8 ms (unchanged, already change-driven) |
| Console errors | 0 | 0 |

Remaining cost is software-GL fill (about 85-94% of main thread is "(program)"). Not removable without atlases or fewer sprites (asset side).

Changes:
- `view/city.ts`: ground tiles in 8x8 chunks plus per-frame viewport culling of chunks and item views (default view draws about 183 of 445 items); `world.interactiveChildren = false` (no per-pointer-move hit-test traversal).
- `view/itemView.ts`: conservative art `bounds` for culling; `applyBar` no longer calls `Graphics.clear()` every frame while the bar is disabled.
- `view/cull.ts` (+ `cull.test.ts`): pure culling maths.
- `ui/extras/maplayer.ts`: overlay transform only written when changed, cached root size (no forced layout per frame from `visibleWorldRect`), `onMapFrame` hook.
- `ui/extras/clip.ts`, `ui/extras/bubbles.ts`: off-screen looping abandoned-house icons are hidden and stop swapping frames.

Findings, unchanged: GUI layouts are already cached (`loadGui`), the popup/economy code is change-driven. The stress save must only use skus the server serves (expired limited editions such as `houses_015_001_bavarian` are filtered from the served XML and crash `Economy.nodeOf` on boot; pre-existing robustness issue worth guarding).

Files touched (this task): `apps/client/src/view/{city,itemView,cull,cull.test}.ts`, `apps/client/src/ui/extras/{maplayer,clip,bubbles}.ts`, `docs/performance.md`.
