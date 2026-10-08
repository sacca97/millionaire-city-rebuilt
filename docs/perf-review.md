# Client performance review (measured)

Branch `rewrite-ts-client` @ `993bffb`. Nothing in the product was changed. Companion to `docs/performance.md` (earlier optimisation round) and the static, unmeasured `docs/perf-audit.md`.

Each claim is tagged **[M]** measured, **[C]** code reading, or **[E]** estimate.

## 0. Method and caveats

- Build: `MCITY_OPT=1 npx vite build --outDir /tmp/mc-perf` (optimised WebP assets). Served by the real server (`MCITY_CLIENT_DIST=/tmp/mc-perf`, temp SQLite, own ports).
- City: no stress save existed in `/tmp`, so I seeded one into the real save document: **445 items** (HQ + ~25 houses, 14 commerce, 82 decorations skus, random placement; 11% under construction, 9% abandoned, 30% rent ready, rest renting), a **60x40 tile terrain + grid-road** map. 326 of the 445 items are animated (looping `normal` clip). Popups suppressed (daily bonus pre-set). Seed script and drivers were throwaway (deleted).
- Driver: Playwright + chromium-1208, headless, **SwiftShader software GL**, 1280x800, DPR 1, `?skipTutorial`.
  - `--enable-precise-memory-info` for heap.
  - `--disable-frame-rate-limit --disable-gpu-vsync` for the FPS tables, otherwise rAF is quantised to 30/60 Hz and hides differences.
  - rAF sampling via `page.evaluate`.
  - GL calls counted by wrapping `WebGL(2)RenderingContext.prototype.draw*/texImage2D/bufferData`.
  - Main-thread busy % and script % from CDP `Performance.getMetrics`.
  - Scene census by walking the Pixi stage.
  - Boot network via Playwright `requestfinished` + `request.sizes()` (see "surprising" below on why CDP-from-page undercounts).
- **Absolute fps are meaningless for real hardware.** The main thread is 100% busy only because it blocks on the software rasteriser (GPU process ~1000-1150% CPU across SwiftShader threads), so use the relative numbers. The JS side (about 0.4 ms/frame) is the only part that transfers 1:1 to real machines.
- Run-to-run spread on the idle baseline over 6 separate runs: 26.9-27.3 ms/frame (37.2 +/- 0.3 fps). Differences below ~1 ms are noise.

## 1. Frame time (uncapped rAF, 1280x800)

| Scenario | fps | mean ms | p95 ms | p99 ms | GL draws/frame | JS (ticker update) ms/frame | of which `renderer.render` submit ms |
|---|---|---|---|---|---|---|---|
| Idle, default view (scale 1.0, ~265 of 450 L0 containers visible) | 36.9 | 27.1 | 29.5 | 30.4 | 7 | 1.37 | 0.97 |
| Panning (drag, 5 s) | 34.2 | 29.2 | 35.3 | 45.5 | 7.1 | 1.71 | 1.26 |
| Wheel zoom (5 s, scale 0.3-3) | 30.6 | 32.6 | 48.6 | 51.7 | 4.4 | 2.14 | 1.67 |
| Zoomed out to 0.3 (all 445 items visible) | 49.6 | 20.2 | 24.3 | 29.5 | 20.1 | 2.39 | 2.04 |
| Shop popup open (map still rendering underneath) | 30.8 | 32.5 | 36.4 | n/a | 7 | n/a | n/a |
| Map only, same session as shop run | 33.2 | 30.1 | 33.3 | n/a | 7 | n/a | n/a |

Takeaways:
- **[M]** JS is a rounding error: `city.tick()` = 0.051 ms for 445 items, `game.tick` 0.009 ms, `traffic.tick` 0.005 ms (300 direct calls each). Total ticker JS (excluding Pixi render submit) is ~0.4 ms/frame; script is 5-7% of main-thread time. Frames are fill/raster bound in software GL.
- **[M]** Draw calls are already tiny (7/frame, 20 when zoomed out) because the batcher merges sprites: 6,296 sprites over 121 unique sources go into 7 batches. The scene is not draw-call bound. Multi-source batches break at 16 textures, which is why zoomed out (more distinct textures on screen) is 20.
- **[M]** Zooming OUT is cheaper than the default view (20 vs 27 ms), because the 90x60 map at 0.3 no longer fills the screen (fewer pixels), even though all 445 items are drawn. Pixel fill, not object count, is the cost driver.
- **[M]** No frame over 50 ms in any phase except zoom (max 52 ms, software GL). Zero JS-induced GC stalls observed.

### 1.1 Ablation: where do the 27 ms go (idle, software GL; `visible=false` on a layer)

| Hidden | mean ms/frame | delta |
|---|---|---|
| nothing (baseline) | 26.9 | |
| `#ui-root` (all DOM HUD) | 25.9 | -1.0 |
| backdrop sprite only | 21.3 | **-5.6** |
| ground tiles only (5,400 sprites, 1,536 visible) | 22.4 | **-4.5** |
| backdrop + tiles (whole ground) | 16.7 | **-10.2** |
| items L0 + L1 (also ground hidden) | 3.9 | -12.8 more |
| itemsTop (L1: icons) only | 29.1 | ~0 (noise) |
| traffic (2 cars) | 30.5 | ~0 (noise) |
| whole world hidden (DOM only, GL still running) | 2.5 | |
| ticker stopped (DOM + compositor only) | 12.5 | |

**[M]** Roughly 38% of the frame is the ground (a full-screen opaque backdrop PLUS tiles on top = 2 full-screen layers), ~48% is items (L0 overdraw 1.37x screen on top), the rest is DOM compositing (~10 ms with the ticker stopped, i.e. one full canvas upload per animated frame plus the HUD layers).

### 1.2 Pixel-cost scaling

| Setting | mean ms | |
|---|---|---|
| renderer resolution 1 (current in this test, DPR 1) | 27.3 | |
| renderer resolution 2 (simulated retina, `renderer.resolution=2`) | **98.2** | 3.6x |
| `tiles.cacheAsTexture(true)` (2880x1920 baked) | 29.1 (31.3 settled) | no gain, slightly worse |
| `ticker.maxFPS` 30 / 15 / 5 | renders/s 29.8 / 15.2 / 5.0 (baseline 37.4) | proportional |

`main.ts:13` passes `resolution: window.devicePixelRatio || 1` with `autoDensity`, so a 2x display does 4x the pixels. **[M, relative]**

## 2. PixiJS scene stats (idle, default camera)

| Metric | Value |
|---|---|
| Display objects total | 7,739 (2,670 visible after culling) |
| Sprites | 6,296 (1,848 visible); 5,400 ground tiles + ~450 items L0 + ~445 items L1 + backdrop + effects |
| Graphics | 449 (one per item, the unused `bar` Graphics in `top`) |
| Containers | 994 (incl. 64 ground chunks, 2 per item) |
| Render groups | 1 (root only). **No `isRenderGroup`, no `cacheAsTexture`, no `cullable`/Culler used.** (grep over `src/`, plus census `cachedAsTexture=0`) |
| Containers with `sortableChildren` | 2 (items L0, and one more) |
| Containers with filters | 1 (`ghostGlow` BlurFilter, only active while a ghost is drawn) |
| Masks | 0 |
| Culling | Manual in `view/city.ts` `tick()` (chunk `visible` toggle + `setCulled`), per frame. Pixi's own culling is off (`stage.cullable=false`) |
| Ground tiles visible / onscreen / offscreen-but-drawn | 1,536 / 1,040 / **496 (32%)**: 8x8-tile chunks are too coarse at this viewport |
| Items L0 visible / onscreen / offscreen-but-drawn | 265 / 224 / 41 (15%) |
| Items L1 (icons) visible | 46 (36 onscreen) |
| Screen overdraw (area of visible sprites / screen) | backdrop 1.0x, ground tiles 1.0x, items L0 1.37x, items L1 0.18x: **~3.5x total** |
| GL texture sources managed | 564, **51.4 MB** (RGBA8, no mipmaps) |
| ...of which `ground/background.png` | 2886x2467 = **28.5 MB (55%)** |
| ...tileset 512x256 | 0.5 MB |
| ...item frames uploaded so far | ~22 MB |
| Item frame textures loaded (all frames of all clips) | 827 unique, 3,911 clip frames + 611 effect frames, **41.2 MB if all uploaded** |
| Frames actually needed right now (lower bound) | 599 unique / 31.2 MB. Only ~28% saving, because 326/445 items loop their `normal` clip |
| Renderables updated per frame | 18 (animated texture swaps); `structureDidChange` in 1/206 frames |
| Pixi texture GC | on (`maxIdle` 3600 ticks, check every 30) |
| `textureGC` / mipmaps / `roundPixels` | defaults; not configured anywhere in `src/` [C] |

## 3. Memory

| | JS heap (MB, after forced `gc()`) |
|---|---|
| Boot (+2.5 s) | 21.4-21.8 |
| After 60 s (including pan, zoom, shop open) | 23.6 (23.9 before GC) |

**[M]** No leak signal in 60 s. Allocation churn is steady at **~5.8-6.1 MB/s (~195 KB per frame)** while idle (heap sawtooth sampling, 4 minor GCs in 8 s). Disabling `city.tick` drops it to 2.5 MB/s; stubbing `ItemView.update` to 3.8 MB/s. So the item update path allocates ~115 KB/frame (~260 B/item/frame). Heap sampling profile (self KB share): resolveVisual-style spec/object literals ~20%, the `for..of` Map iteration tuples in `tick` ~12%, `ItemView.update`/`context()` ~9%+1%, `stateProvider` result objects ~7%, plus Pixi batch-building ~13%. **Impact is only GC pressure, not frame time**: no jank observed; low priority.

GPU memory (51 MB managed now, up to ~90 MB if every loaded frame texture gets drawn): fine for desktop, relevant on low-end mobile.

## 4. Network to first interactive frame (cold, cache disabled/new context)

Ready (`window.__mcity`) at **~3.0 s** on localhost (first paint 92-120 ms is an empty page). Playwright context-level capture:

| Group | requests | bytes |
|---|---|---|
| sprites (`/sprites/**`, item frames) | **837** | **10.6 MB** (avg 12.7 KB) |
| `ground/background.png` (really WebP) | 1 | **5.18 MB** |
| gui (`/gui/**` shape images) | 135 (up to 307 in other runs) | 0.75 MB (61 files < 2 KB) |
| JS/CSS (index 105 KB br, pixi 141 KB br) | 8 | 0.33 MB |
| rules/locale/XML/tileset (`/mcity/**`) | 56 | 1.08 MB |
| fonts (2 TTF) | 2 | 0.22 MB |
| API (`/Game`) | 13 | 0.08 MB |
| **Total** | **~1,074** | **~18.2 MB** |

- **[M]** Timeline: JS done at ~0.1 s; sprites 0.13-1.85 s; gui 2.1-5.7 s (continues after ready); ready 3.0 s. Critical path is login -> defs/index -> `Game.boot` -> city sprites -> traffic -> `initUI` (gui layouts + shapes).
- **[M]** Largest transfers: `ground/background.png` 5.18 MB, `houses_050_001` normal frames ~60 KB each, `tileset.png` 170 KB, `hud/shapes/105.png` 142 KB, fonts 125 + 94 KB, `missionDefinitions.xml` 110 KB, `Locale/EN.txt` 109 KB. `/favicon.ico` was 285 KB in one capture (served by `serverApp.ts:229`, not part of the app dist).
- **[M]** Cache headers: `/assets/*` immutable 1 y (good); sprites/gui/ground/fonts `max-age=86400` + ETag; **`/mcity/**` (rules, locale, tileset: 48 requests, ~0.5-1 MB) is `max-age=0` (revalidated every load)**; `/Game` none (by design). A warm reload had 0 revalidations for sprites/gui (served from cache), so the 1-day policy works.
- **[M]** Long tasks during boot: 1-2 tasks (52 ms and 90-104 ms at ~0.2-0.4 s, i.e. script parse/eval of the 427 KB + 594 KB bundles). Nothing else over 50 ms. Boot is I/O and request-count bound, not CPU bound.
- Count caveat: a page-level CDP session sees only ~290-390 of the ~1,074 requests because Pixi decodes images in a Worker (`blob:` ImageBitmap requests, 21 observed); numbers in `docs/performance.md` ("260 requests / 7.8 MB") undercount for the same reason.

## 5. DOM / popups

| | Closed | Shop open |
|---|---|---|
| DOM elements | 2,247 | **16,688 (+14.4k)** |
| `<img>` | 444 | **3,351 (+2.9k)** |
| elements with a CSS `filter` (drop-shadow/feColorMatrix) | 128 | **2,040 (+1.9k)** |
| `will-change` (outside `popup.ts:183` tween) | 0 | 0 |
| backdrop-filter | 0 | 0 |
| CSS masks | 9 | n/a |

- **[M]** Frame cost with the shop open: 32.5 vs 30.1 ms (+8%, software GL). With the map ticker stopped (DOM/compositor only): 17.5 ms with filters, **13.4 ms with `filter:none` forced** (-23%). While the map is also rendering the filter saving is only ~1.3 ms (32.5 -> 31.2).
- **[C+M]** `ui/shop/shop.ts:221-243` `renderCards()` builds a view for EVERY card of the tab (all pages) and pages with `translateX` on an `overflow:hidden` viewport. That explains the 14k nodes. Node count, not painting, is the first-order cost (style recalc / layout stay <1% in the metrics, but memory and open latency do not).
- **[C]** `gui/popup.ts` tween sets `will-change: transform, opacity` for the open/close tween only (l.183): fine.
- **[M]** The map keeps rendering at full rate underneath modal popups (shop covers ~60% of the screen).

## 6. Ranked recommendations

Ranking is expected real-world gain weighed against effort/risk. Gains in ms are software-GL relative; on a real GPU the *fill* items shrink but keep their ordering on integrated/low-end/mobile GPUs and HiDPI screens.

| # | Recommendation | Expected gain | Effort | Risk | Where | Evidence |
|---|---|---|---|---|---|---|
| 1 | **Cap renderer resolution** (`Math.min(devicePixelRatio, 1.5)`, keep `autoDensity`) | Up to ~2x frame time on 2x displays (res 2 = 3.6x cost) | S | Low (slightly softer map on retina; UI is DOM so stays sharp) | `main.ts:13` (`app.init`) | [M] |
| 2 | **Cut redundant ground overdraw**: bake backdrop + terrain/road tiles into one RenderTexture (2880x1920) and draw one sprite; rebuild only on the `map` event (`redrawGround`). Alternatively draw the backdrop only where no tile exists. Also frees the 28.5 MB backdrop texture (22 MB baked) and lets 5,400 tile sprites + 64 chunk containers disappear | -4 to -10 ms in software GL (hiding backdrop -5.6, whole ground -10.2); fewer objects (5,400) and 5 MB less transfer if the backdrop is replaced by flat fill + baked tiles | M | Medium: ghost/terrain edit flow, `tileset` frame math, redraw cost on road edits; `cacheAsTexture` on tiles alone gave NO gain, so the win needs the backdrop layer removed, not just tiles cached | `view/city.ts` `drawGround`, `redrawGround`, `cullTiles` | [M]; baked-texture variant [E] |
| 3 | **Adaptive frame rate**: cap the ticker at 30 fps (item art is authored at 30 fps, `DEFAULT_FPS`) and drop to ~10-15 fps when idle (no pointer/wheel for >1 s, no animated item on screen, tab unfocused). Game timers already use wall-clock delta so logic is unaffected | Halves GPU/CPU work for idle sessions (renders/s 37 -> 30 -> 15 measured); battery/fan benefit on laptops | S-M | Low-Med: pan smoothness must stay 60 fps while interacting; make sure `traffic.tick(app.ticker.deltaMS)` uses real time (it does not use the wall-clock `now - last`; see surprises) | `main.ts` ticker block, `view/city.ts` ctor ticker | [M] |
| 4 | **Virtualise the shop pages**: render only the current page (+/-1) of cards, create the rest on page change | -80% popup DOM (14.4k nodes, 2.9k imgs, 1.9k filtered elements), faster open, less memory | M | Low-Med: tutorial/`searchItem`/`locateItem` paging relies on all cards existing (`shop.ts:196-310`) | `ui/shop/shop.ts` `renderCards`, `ui/shop/card.ts` | [M] + [C] |
| 5 | **Fewer, larger boot requests**: pack item frames into per-sku (or per-clip) atlases/spritesheets (WebP) and serve via `Assets.load` spritesheet JSON; preload only the frame(s) the current state needs plus the loop for animated items | 837 -> ~100-300 requests, ~1.0-1.5 s less cold boot on HTTP/1.1; fewer unique GL textures (827 -> tens) and fewer batch breaks (zoomed out had 20 draws); lazy frames alone save only ~28% since 73% items animate | L | Medium: asset pipeline (`tools/optimize_assets.py`, `index.json`), oracle parity of frame offsets | `tools/optimize_assets.py`, `view/sprites.ts`, `view/itemView.ts` `preload`/`loadLayer` | [M] request counts; speed-up [E] |
| 6 | **Cache policy for `/mcity/**`** (versioned `0.501` dir): `max-age=86400` or immutable instead of `max-age=0`; same for `ground/background` | 48 revalidation requests (0.5-1 MB) per load -> 0 on warm loads | S | Low | `apps/server/src/clientStatic.ts` / the `/mcity` static mount in `serverApp.ts` | [M] headers |
| 7 | **Shrink/replace `ground/background.png`**: 5.18 MB download (28% of boot bytes) and 28.5 MB GPU. If the backdrop is only grass + border, use a tiled 256x256 pattern (`TilingSprite`) or lossy WebP | -5 MB transfer, -28 MB VRAM; decode time off the critical path (it blocks `drawGround`) | S-M | Low-Med (visual parity: check the border/gradient content; `docs/performance.md` already judged it "decodes fast enough") | `view/city.ts:drawGround` (`/ground/background.png`) | [M] size, [E] gain |
| 8 | **Defer GUI shape/preview loading** until first use: 135-307 gui requests (0.75-1.2 MB, 61 < 2 KB) are fetched during `initUI`, and `ready` waits for it (gui finishes 2.1-5.7 s) | ~0.5-1 s off time-to-interactive; fewer requests | M | Medium: layouts are cached by `loadGui`; classes can be built from computed names (per `docs/performance.md`), so needs a UI-coverage run | `ui/index.ts` `initUI`, `gui/*` | [M] timeline, [E] gain |
| 9 | **Remove per-frame allocations in the item update path**: reuse a mutable `VisualSpec`/state object, return no object from `stateProvider` (write into the view), iterate `views.values()` over an array, skip `ItemView.update` for culled non-animated items and use a fixed context object | -115 KB/frame churn (-60%); GC pressure only, ~0.05 ms CPU | S-M | Low | `view/city.ts:tick`, `view/itemView.ts:update/context`, `view/animation.ts:resolveVisual`, `main.ts` stateProvider | [M] heap sampling |
| 10 | **Finer culling + overlay trim**: ground chunks 8x8 -> 4x4 (496 offscreen tiles = 32% drawn needlessly) and use per-item screen-space culling margins; replace per-item `Graphics` (`bar`, 449 objects, never drawn while `SHOW_CONSTRUCTION_BAR=false`) with lazy creation | ~15-20% fewer sprites submitted; 449 fewer objects; small fill gain (items off-screen are 15%) | S | Low | `view/city.ts` `CHUNK`, `view/itemView.ts` `bar` | [M] counts |

Not worth doing (measured to be neutral or already fine):
- Pixi `cullable`/Culler, `isRenderGroup` on item layers, `cacheAsTexture` on the tile container (tested: no gain, not draw-call or CPU bound).
- Throttling `traffic`/`game.tick` (0.014 ms combined).
- `will-change`/mask tuning on the popups (none in use; filters are the only measurable DOM cost, -23% DOM-only if they were removed, but that changes visuals).
- Texture GC settings (already on; no leak over 60 s).

## 7. Surprising findings

1. **CDP/page-level network capture misses most of the boot.** Pixi v8 decodes images through a Worker, so a page-level CDP session saw 290 requests / 2.6 MB while the real cold boot is ~1,074 requests / 18.2 MB. Any earlier boot figure taken that way undercounts (e.g. `docs/performance.md`, "260 requests / 7.8 MB").
2. **The map is "ground-bound", not item-bound**: hiding the backdrop alone (-5.6 ms) is worth as much as culling ~half the items. The backdrop is a 2886x2467 opaque image drawn first, then fully covered by tile sprites in the owned area; total overdraw is ~3.5x screen. `docs/performance.md` previously attributed the remaining cost to "asset side (atlases or fewer sprites)"; this measurement shows overdraw, not sprite count, is the lever (caching 5,400 tile sprites into one texture did not help).
3. **Zooming out is faster than the default view** (20 vs 27 ms) even with all 445 items drawn.
4. **GPU process CPU does not scale with frame rate** under SwiftShader (1,158% at 37 fps vs 1,046% at 15 fps) because its worker threads spin; use renders/s and frame time instead of that counter. Main thread is "100% busy" purely from blocking on the rasteriser.
5. **The shop opens 14k DOM nodes** (3,351 images, 2,040 filtered elements) for a 4x2 visible page, because every card of every page is built.
6. `traffic.tick(app.ticker.deltaMS)` in `main.ts` uses Pixi's capped (100 ms) delta while `game.tick` uses a wall-clock delta; cars slow in background tabs. Minor/accuracy only. [C]
7. Screenshots taken straight after load occasionally came back with an empty map in headless (canvas not yet presented); Pixi state was correct (445 views, 265 visible), so it is a capture artefact, not a rendering bug. [M]
8. Boot dependencies: `ready` waits for `initUI`, which waits for GUI assets that keep streaming until ~5.7 s. The first map frame exists well before that (sprites done at 1.85 s) but the app's own `window.__mcity` readiness lags.

## 8. Reproducing

Seed script, drivers and raw runs were throwaway and deleted. To repeat: build with `MCITY_OPT=1 --outDir /tmp/mc-perf`; start the server with `MCITY_CLIENT_DIST`/`MCITY_DB_PATH`/`MCITY_HTTP_PORT` set (see `tools/oracle/ours-flow.mjs`); load once to create the player; write ~440 items into the `universe` save document (`World.Company` of `whose=0`, relative coords) and Terrain/Road chunks; pre-set `dailyBonusInfo.dailyRewardsLastGivenDate` to suppress the daily popup; launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-precise-memory-info --disable-frame-rate-limit --disable-gpu-vsync`; the `__mcity` global (`city`, `game`, `traffic`) exposes everything needed (`city.app.renderer`, `city.views`, `city.tick()`).
