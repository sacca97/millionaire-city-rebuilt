# Performance / memory / lag audit (read-only, static)

Scope: `apps/client` (PixiJS v8 + DOM UI), `apps/server`. Static review only. No oracle or browser run, so no profiler numbers. Every "impact" below is a reasoning-based estimate and is labelled as such. Line refs are against branch `rewrite-ts-client` at `993bffb`.

"Safe" means: can be applied without changing game behaviour (render-only or pure caching), assuming the existing tests and the oracle-parity suite still pass.

Measured facts used below:
- `apps/client/dist` = 277 MB, 15,653 files (15,517 `.webp`). JS: `assets/index-*.js` 427 KB (105 KB br), `assets/pixi-*.js` 594 KB (141 KB br). No sourcemaps are emitted (no `sourcemap` key in `vite.config.ts`).
- `public/sprites/index.json` 941 KB (dist copy 862 KB). 283 skus, 14,132 frames in total. Largest clips: `houses_013_001/Effect_1` has 1,475 frames, `decorations_special_07/Effect_0_top` 910, `decorations_special_07/normal` 710, `decorations_pond_0x/normal` 600.
- GUI layouts: `gui/collectables/layout.json` 2.0 MB, `gui/hud/layout.json` 504 KB, `gui/houses_info/layout.json` 477 KB. The `layout.json` files in dist are precompressed.
- Map: 90 x 60 tiles, TILE 32 (`game/geometry.ts`).

---

## 1. Pixi view (`apps/client/src/view/*`)

### 1.1 [HIGH] Every item eagerly loads and holds ALL frames of all its clips, with no atlas and no unloading
Evidence:
- `itemView.ts` `ItemView.preload()` (l.167-201) loads `normal`, `normal_2`, `building` and then every `Effect_N`, `_top` and `_people` layer. Each layer calls `loadLayer()` (l.155-165), which does `Promise.all(sym.frames.map(f => lib.texture(f)))`. That fetches and decodes every frame of the clip.
- `SpriteLibrary.texture()` (`sprites.ts:34-39`) goes through `Assets.load` with a never-evicting `Map`. There is no `Assets.unload` or `texture.destroy` anywhere in `view/`.
- Each frame is its own WebP, hence its own GPU texture source. A 600-frame pond is 600 textures. A house with a 1,475-frame effect is 1,475 more.
- `effects` loop (l.183-194) awaits layers serially, so item creation is a chain of sequential awaits per item.
- Many distinct textures also break Pixi's batcher: the batch flushes whenever the texture count in a batch exceeds the GPU unit limit.
Impact (estimate): the largest memory driver (decoded RGBA for every frame of every owned sku, for the whole session) and the largest boot-time cost (thousands of requests and decodes). It is also the biggest threat to a long session.
Fix, in rising effort:
a) (low effort, safe) Do not load frames of a clip until the clip is actually shown, and for looping clips only load once the item first becomes visible (`setCulled(false)`). Load `normal` frame 0 first.
b) (low, safe) Skip loading `Effect_*` layers entirely while `renderOptions.animations === false` (quality LOW). `applyEffects` already hides them.
c) (med effort, safe) Run the existing export step (`tools/optimize_assets.py` and the `export-sprites` script) to emit one atlas per clip, via Pixi `Spritesheet` JSON or by hand-built `Texture` frames on one `TextureSource` (`ItemAssets.iconFrames` already does this for the icon sheets). Frames of one clip then share one GPU texture and one request. Change `SpriteIndex` to `{atlas, rects[]}`.
d) (med, safe) Add LRU `texture.destroy(true)` and `Assets.unload` for clips of removed or sold items (`CityView.removeItem`) when no other view uses that sku (refcount per sku in `SpriteLibrary`).
Safe: yes (render only). Frame selection logic (`loopFrameIndex`) is untouched.

### 1.2 [HIGH] `CityView.tick` runs the full update pipeline for every item every frame, including culled and static ones
Evidence: `city.ts:tick` (l.222-239) loops over all views each frame. Per item it:
1. calls `stateProvider(sid)`, which in `main.ts:32-35` allocates a fresh `{stateId, mode, time, incomeMs}` object per item per frame;
2. calls `view.update`, which allocates a `VisualSpec` and a `context()` object (`itemView.ts:240-249, 268-278`; `resolveVisual` in `animation.ts` returns new objects);
3. runs `applyMain`, `applyEffects`, `applyIcon` and `applyBar`;
4. only afterwards computes the cull test (`bounds` getter plus `intersects`).
Culling therefore saves GPU work but not the CPU work. A non-animated, non-RENTING item (static art, e.g. built decorations or houses in WAITING) cannot change between frames.
Impact (estimate): O(N) allocations and branching at 60 fps. For a few hundred items this is maybe 1-3 ms per frame on a mid-range laptop and constant GC pressure. It does not scale well for big cities.
Fix:
- (low, safe) Cull first, then update only visible items. On `setCulled(false)` force one `update`.
- (low, safe) In `ItemView.update` keep a `lastKey` (stateId, mode, `Math.floor` of the countdown bucket that drives `rentingFrame`, `loopFrameIndex`, `iconFrame`) and return early when the visible frame is unchanged. Items with `isAnimated=false` and no icon only need re-evaluation on state change (`item-changed`).
- (low, safe) Reuse a per-view scratch `ItemStateInput` in `stateProvider` instead of allocating. Make `resolveVisual` return frozen constants for the common cases.
- (med, safe) Only iterate animated or timed views: keep `animated: Set<ItemView>` and update the rest on `item-changed`.

### 1.3 [MED] Per-item empty `Graphics` and an always-hidden icon `Sprite`
Evidence: `itemView.ts:124` `private bar = new Graphics()` is created for every item and added to `top` (l.145). `SHOW_CONSTRUCTION_BAR = false` (l.105), so it is never drawn.
Impact (estimate): hundreds of useless `GraphicsContext` plus display objects and render-instruction nodes.
Fix: (low, safe) create `bar` lazily, only when `SHOW_CONSTRUCTION_BAR` is true. Likewise add `icon` to `top` only when `spec.icon` is first set.

### 1.4 [MED] Whole-ground rebuild on every `map` event
Evidence: `main.ts:57-60` calls `city.redrawGround(game.world)` on every road or terrain event. `city.ts:redrawGround` (l.108-155) runs `computeTileIndices` over all 5,400 tiles. It then destroys every tile `Sprite` and chunk `Container` and recreates up to 5,400 `Sprite`s. `main.ts:37` also builds a new `Set(game.world.roads)` per event for the traffic sim.
Impact (estimate): a drag-built road of 20 tiles triggers 20 full rebuilds (thousands of allocations each, plus GC and an upload-free but heavy scene-graph rebuild).
Fix:
- (low, safe) Coalesce: mark dirty and rebuild once per frame (`requestAnimationFrame` or in `tick`).
- (med, safe) Rebuild only the changed tile and its 8 neighbours (autotile indices depend on neighbours): keep `Sprite[]` by index and just swap `texture`.
- (med, safe) Replace 5,400 sprites with a `TilingSprite` or one baked `RenderTexture` per chunk, redrawn on change.
Also `drawGround` re-loads and re-adds the backdrop (`city.ts:93`) on every `render`. This is one-off, so ignore.

### 1.5 [MED] Traffic: per-frame sort flag, per-frame closure and promise allocations, texture-per-rotation
Evidence: `traffic.ts:tick`:
- l.94 sets `container.sortableChildren = true` every frame while every car's `zIndex = a.y` changes every frame (l.82). That triggers a re-sort of all cars every frame.
- l.84-91: whenever the rotation frame changes (cars turn through up to 360 frames), it creates a `Promise` plus a closure per car, calls `loader.texture(...)`, and keeps a `frameOf` Map entry. Textures are one-per-angle WebPs (`sprites/cars`, 360 frames per clip).
- `this.cars.symbol(a.def.sku, "car")` does string concat plus two map lookups per car per frame (`sprites.ts:symbol`).
- `traffic.tick(app.ticker.deltaMS)` is not culled: all agents are simulated and positioned even when offscreen (sim culling would change behaviour, but view culling is safe).
Fix:
- (low, safe) Set `sortableChildren = true` once in the constructor. Sort only every N frames or when `Math.floor(y/8)` changes.
- (low, safe) Cache `sym` on the sprite or agent. Pre-resolve rotation textures into an array (`Texture[]` per sku) after the first load, so `sp.texture = tex[frame]` is synchronous with no promise.
- (low, safe) `sp.visible = false` for cars outside the view rect (reuse `worldViewRect`).
- (med) Quantise rotation to 8 or 16 views per car instead of 360 textures if the visual diff is acceptable. Not "safe" visually, needs an oracle compare.

### 1.6 [LOW-MED] Ghost: BlurFilter and Graphics redrawn on every pointer move
Evidence: `city.ts:55` gives `ghostGlow` a `BlurFilter({strength: 5})`. `setGhost` (l.263-310) is called from `game.refreshGhost` on every `pointermove` (`game.ts:1725-1728`). It calls `gfx.clear()` and re-fills both the footprint rect and the line loops each time. `showGhostView` is async but cheap once the view exists.
Impact (estimate): the blur pass only costs while building or moving (a filter on a Graphics allocates a filter texture the size of its bounds). It is low in steady state, but it can stutter while dragging a big footprint.
Fix: (low, safe) skip `setGhost` work when the ghost `(x, y, valid, sku)` equals the previous one (pointer moves within the same tile are the common case). Optionally replace the blur glow by a second wider low-alpha stroke (visual change, not strictly "safe").

### 1.7 [LOW] Ground culling is chunk-level but items view-cull creates a `Rect` every frame
`worldViewRect` (`cull.ts`) allocates one object per frame, which is negligible. Items use `items.sortableChildren = true` (`city.ts:49`). In Pixi v8 the sort only runs when `zIndex` changes or a child is added or removed, so it is not per frame. The only repeated cost is `addItem` bursts (boot with 200+ items: one sort per add if each add occurs in a different microtask).

### 1.8 [LOW] Event and hit-testing
Already handled well: `world.interactiveChildren = false` (`city.ts:51`) and a stage `hitArea`. No Pixi `Text` objects (grep: none); all text is DOM.

---

## 2. Asset loading (textures, layouts, fetches)

### 2.1 [HIGH] Same as 1.1: 15.5k small WebPs means thousands of HTTP requests and no atlas
Evidence: `find dist -type f` gives 15,517 `.webp`, 277 MB. `sprites.ts:texture` fetches one file per frame. Cache policy for `/sprites` etc. is `max-age=86400` (`server/clientStatic.ts:cacheControl`). That is fine for repeat visits but cold start is request-bound (HTTP/1.1 on Express gives 6 parallel connections per origin).
Fix: atlases (see 1.1c), HTTP/2 or keep-alive is already there via Node, plus `Cache-Control: immutable` with content-hashed URLs, or at least a longer `max-age` (e.g. 7 days) for frames, which never change within a build.

### 2.2 [MED] `/mcity/0.501/*` assets served without cache headers and with per-request `existsSync` walks
Evidence: `serverApp.ts:633-655` `createCaseInsensitiveAssetMiddleware`. For every GET it calls `resolveCaseInsensitiveFile`, whose first branch is `fs.existsSync(exactPath)` per path segment (l.669-670). `directoryCache` is only used for the case-mismatch fallback. Then `res.sendFile` with default options: no `maxAge`, so the browser revalidates (conditional GET/304) on every load. Client requests through this path include `tileset.png` (`city.ts:111`), icon sheets (`itemView.ts:76`), all `rules/*.xml` (up to ~109 KB each, sent uncompressed: `app.get("/mcity/0.501/Datas/rules/:fileName")` at l.252) and `Assets/missions/icons`, `CommerceTypes`.
Fix: (low, safe) a) cache resolved paths in a `Map<string,string>` (assets are immutable at runtime). b) `sendFile(..., {maxAge: "1d", immutable: true})` or set `Cache-Control` for `/mcity/0.501`. c) put `compression()` (or the same br/gz precompute as `clientStatic`) in front of XML routes. XML compresses ~8:1.

### 2.3 [MED] Layout JSON loaded and parsed per swf, never released; big files
Evidence: `gui/widget.ts:15-22` `loadGui` caches `Promise<GuiLayout>` forever. `collectables/layout.json` is 2 MB (parsed object graph probably 10+ MB). `hud/layout.json` 504 KB and `houses_info` 477 KB are needed at boot. `loadLayout` is `fetch + res.json()` (`layout.ts:128-132`).
Fix: (low, safe) lazy-load the big ones only when the popup opens (already happens for most via `Widget.create`; check `collectables` is not preloaded at boot). Optionally `layoutCache.delete(key)` for rarely used swfs after the last popup closes (trade memory for re-parse). (med) minify layout JSON keys at export.

### 2.4 [LOW] Duplicate fetches
- `fetch('/sprites/index.json')` is done by `view/sprites.ts:20` (`SpriteLibrary.load`) and again by `ui/shop/icons.ts:19` (`indexPromise`). The same 941 KB JSON is parsed twice. Fix: (low, safe) share the library's parsed index, or expose `SpriteLibrary.index`.
- `fetch` for rules XML: `game/game.ts:451`, `ui/missions/system.ts:50`, `ui/rewards/rules-xml.ts:24` (cached), `ui/shop/data.ts:49`, `ui/extras/newsfeed.ts:61`, `ui/hud/friends.ts:145` (`NPCDefinitions.xml`), plus per-file one-offs. Several are not cached through a shared promise map. Fix: route all through one cached `fetchText(url)` (`ui/rewards/rules-xml.ts` pattern). Safe.
- `ItemAssets.genericBuilding` calls `Assets.load` per item (cached by Pixi, so only a lookup).
- `ui/tutorial/arrows.ts:49` preloads 30 PNG frames with `new Image()` up front even when the tutorial is skipped. Fix: lazy (low, safe).

### 2.5 [LOW] `<img>` elements for GUI textures
`gui/dom.ts:84-91` creates an `<img src=...>` per texture node with no `decoding="async"` and no `loading`. Large widgets (shop, hud) create hundreds of imgs, each a browser-side decode. Fix: add `i.decoding = 'async'` (low, safe).

---

## 3. DOM UI, timers, listeners, simulation loop

### 3.1 [HIGH] Many independent `requestAnimationFrame` loops and per-frame DOM style writes
Evidence (always running, even when nothing changes):
- `ui/economy/map-layer.ts:17-21` one rAF that runs every registered `onFrame` callback: `NoRoadIcons.update`, `InfluenceView.position`, `CrewIcons.update`, plus per-icon follow callbacks (`noroad.ts:80`, `fx.ts:44/63`).
- `ui/extras/maplayer.ts:26-38` a second always-on rAF (`follow`) plus `visibleWorldRect`.
- `ui/social/owner-upgrades.ts:16-36` a third always-on rAF that iterates `game.upgrades` and writes a `style.transform` per star every frame, even when the camera is still.
- `ui/hud/hud.ts:116-131` a fourth always-on rAF for number tweens.
- `hud/actions.ts follow()` one more while an item is selected; `ui/extras/noterain.ts`; `ui/tutorial/arrows.ts`; each `ClipPlayer.play` (`extras/clip.ts:83`) has its own rAF.
Concrete per-frame waste:
- `noroad.ts:update` allocates `this.known = new Set(off)` every frame (l.51), loops `disconnectedSids()` and calls `placePoint` (string template plus style write) per icon every frame.
- `crew.ts:update` calls `game.items()`, which spreads the whole Map into a new array (`game.ts:590-592`), every frame (l.166-171).
- `MapLayer.placePoint` writes `style.transform` unconditionally every frame.
Fix: (low, safe)
- Merge into a single scheduler: one rAF, run map-follow callbacks only when `(world.x, world.y, scale)` changed or an `item-changed` / `item-added` / `item-removed` fired (version counter). Keep last transform string per element and skip unchanged writes.
- Convert `owner-upgrades.ts` into `onFrame` callback of `MapLayer` with the same dirty check.
- Add `Game.forEachItem(cb)` or a cached `items()` array invalidated on add/remove, and use it in per-frame code.
Impact (estimate): a few hundred microseconds per frame today, but it also keeps the compositor busy: every `style.transform` write forces style recalculation even if unchanged. It matters most on idle (laptop battery, thermal throttling).

### 3.2 [HIGH] Polling timers that recompute over all items
- `ui/missions/system.ts:134` `setInterval(update, 1000)` and `:225` `setInterval(..., 1000)` calling `checkBonus` (l.137-145): for every item, `economy.influencePercent(sid)` plus `poll.checkEvent` (two events for houses, with `sku.split("_")` allocation). N items x per second.
- `ui/extras/bubbles.ts:112` `setInterval(scan, 250)`: iterates all items, allocates a `Snap` per item (4 times per second), and `snaps` bookkeeping.
- `ui/extras/rivals.ts:84` `setInterval(recompute, 700)`: builds nodes and runs `disconnectedItems` (full BFS road flood-fill) and `flatMap`s all companies' items. The result only changes when roads or rival items change.
- `ui/missions/iconlayer.ts:299` `setInterval(tick, 200)`: per mission heuristic.
- `ui/hud/infobox.ts:69` 250 ms refresh; `ui/hud/util.ts:91` 250 ms per live tooltip.
- `ui/extras/journal.ts:80` 2 s.
- `debug/panel.ts:78` `setInterval(..., 500)` runs even if the panel is hidden (cheap check, but installed in production: `main.ts:98`).
Fix: (med effort, mostly safe)
- Drive `checkBonus` and `bubbles.scan` from `item-changed` / `item-added` / `item-removed` / economy `invalidate` events. Mission parity depends on exact timing, so keep a 1 s throttle on the existing trigger and do not drop the poll without re-running the mission-parity scripts. Safe variant: skip the whole `checkBonus` loop when `economy` has not been invalidated and no item state changed since last time (version counter).
- `rivals.recompute`: recompute on `map` events and on company item changes only (low, safe: it is a pure function of `roads` and rival items).
- Install the debug panel only under `import.meta.env.DEV` or a `?debug` flag (low, safe).

### 3.3 [MED] `Game.tick` per-frame work
Evidence `game/game.ts:718-745`:
- `pushSuspension()` (l.393-410) loops over all items every frame and calls `economy.disconnectedSids()`, which triggers `refresh()` and an O(N) rebuild only when dirty. The loop is O(N) per frame regardless.
- `for (const item of itemMap.values())` over every item per frame; only RENT/CONSTRUCTION items do work.
- `emitPopulation()` (l.788-797) loops every commerce each frame and calls `economy.population(sid)`, which does `refresh()` plus `commercePopulation` (iterates the influence index and calls `isAffecting` per covered house) per commerce per frame. That is C commerces x H covered houses per frame.
- `economy.ts:invalidate()` is cheap, but it marks the whole layout dirty. Triggered on every `item-added`, `item-removed`, `map` event (`game.ts:284-286`), and `noteItem` on `item-changed` sets `wondersDirty`. `pushSuspension` emits `item-changed` per toggled item, which sets `wondersDirty` again. On a road-drag each tile causes a complete rebuild at next read: `refresh()` creates a `Map`, maps all items to nodes, `buildInfluenceIndex(nodes)` (pairwise-ish) and `disconnectedItems` (BFS), once per frame at most because reads are lazy. That is fine, but with `Game.tick` reading `population()` every frame it is effectively rebuilt every frame during a drag.
Fix:
- (low, safe) Memoise `population(sid)` per economy "epoch": increment `epoch` in `invalidate()`, `invalidateWonders()` and whenever any item's `stateId`/`mode` changes in a way that changes `isAffecting`; cache `Map<sid, {epoch, value}>`. `emitPopulation` then costs O(C) cheap lookups.
- (low, safe) Skip `pushSuspension()` unless `economy` layout version changed since the last call.
- (med, safe) Maintain `activeItems: Set<GameItem>` (items in CONSTRUCTION or RENT RENTING/GET_RENT) and iterate only that in `tick` (update on `changed()` and add/remove).
- (low, safe) `items()` returns a copy of the Map values each call. It is called in `main.ts:40` (`owned` per commerce spawn), `bubbles`, `crew`, `system.ts` and more. Add a cached array or a `count(sku)` index.

### 3.4 [MED] DOM widget cost: absolutely positioned div tree, CSS filters and masks
Evidence:
- `gui/dom.ts:build` creates one `div.g-n` per node with `transform`, plus an `<img>` per texture, plus separate `g-state` holders for all four button states (up/over/down/disabled), with only `up` displayed (l.97-108). A popup with 30 buttons therefore carries about 120 state subtrees.
- `gui/effects.ts:filtersToCss` emits stacked `drop-shadow()` (up to 4 repeats per Flash "strength", `shadowRepeats`, l.41-45), and CSS `mask-image` groups (l.164-192). Each filtered element forces its own compositing layer and an offscreen blur pass on every repaint.
- `ui/economy/fx.ts:36` builds 4 stacked `drop-shadow(0 0 0.7px)` per floating income text; `ui/extras/rivals.ts:170` likewise.
- `ClipPlayer` (`ui/extras/clip.ts`) instantiates one full `Widget` per animation frame (lazily) and toggles `display`. The comment in `bubbles.ts:109` says the looping "abandoned" icon is "a few hundred DOM nodes animated at the clip rate". Each abandoned house adds one such player with its own rAF (`clip.ts:83`).
Fix:
- (low, safe) Build button state subtrees lazily (create `over/down/disabled` on first use) in `gui/dom.ts:build` and `button.ts`. This cuts DOM size and image decodes by about 3/4 for button-heavy popups.
- (low, safe) Add `will-change: transform` only on animated holders; `contain: layout paint style` on popup roots, `MapLayer` and widget roots so reflow does not propagate.
- (med, safe) Bubble and clip loops: share one rAF for all `ClipPlayer`s (a `ClipScheduler`) and pause any culled or hidden one (already `setCulled`). Cap simultaneous looping abandoned bubbles (e.g. visible only).
- (med, visual risk) Replace per-element `filter:drop-shadow` on text with `text-shadow` or a pre-baked outline where the output is identical, e.g. the "hard outline" glow (distance 0, strength > 1). Needs a screenshot diff, so not strictly safe.

### 3.5 [MED] Popups: no cleanup of widget trees and global listeners
- `gui/popup.ts:41` adds a `window keydown` handler in `mount` (remove-then-add, so no leak).
- `ui/economy/accelerator.ts:47-68`, `ui/hud/index.ts:58-65`, `ui/hud/cursor.ts:82-83`, `ui/extras/rivals.ts:126`, `ui/tutorial/popup.ts:45`, `ui/missions/iconlayer.ts:86`, `ui/popups/expansion.ts:128` add `window` listeners at mount time with no removal path. They are singletons mounted once, so this is not a growth leak. But `ui/popups/expansion.ts:128` (pointermove) is added inside what looks like a per-open path; verify it is registered once.
- `ui/tutorial/popup.ts:45` adds a `window resize` listener in the constructor. If a tutorial popup is constructed per step, listeners accumulate. Verify (not confirmed).
- `ui/extras/scale.ts:15`, `ui/hud/options.ts:92` are singletons. OK.
- `Shop` builds the full popup (`Widget.create('hud','shop')`) on each open, and renders cards for the whole tab (all pages) as DOM (`shop.ts:renderCards`, l.226-245), not virtualised. A tab with 40 cards creates 40 widgets, which is moderate (pages slide via `translateX`). `game.on('profile', refresh)` re-checks the signature on each profile change while open (cheap).
Fix: (low, safe) cache the shop `Widget` instance between opens, or at least pre-render only the current page plus one neighbour. (low) Make sure `ui/tutorial/popup.ts` registers `resize` once or unregisters on destroy.

### 3.6 [LOW] `PointerTracker.update` and `InfluenceView.recompute` on every `item-changed`
`hud/cursor.ts:84-86` schedules a `setTimeout(update, 30)` per `item-changed`, `item-added` and `item-removed`. Boot (hundreds of `item-added`) schedules hundreds of timeouts, each doing `ctx.city.pointerToTile` plus `itemAtTile`. `InfluenceView` (`ui/economy/influence.ts:93-96`) recomputes and rebuilds DOM on each of those same events. Fix: debounce to one per frame (low, safe).

### 3.7 [LOW] `innerHTML` use
Only small static fragments (`ui/economy/crew.ts:40`, `owner-upgrades.ts:27`, `extras/gold.ts:28,34`, debug panel `panel.ts:69`). The debug panel rebuilds an `innerHTML` string every 500 ms, but only while visible. Not a concern.

---

## 4. Network / server

### 4.1 [MED] No batching of sqlite writes; one autocommit per document; full-document JSON round trip per command
Evidence:
- `database.ts:25` sets `journal_mode = WAL` but not `synchronous`. The default is FULL, so each autocommit INSERT issues an fsync on commit. `repository.ts:setDocument` (l.176-185) is a standalone `prepare(...).run(...)`: one transaction and one fsync per call. Only `saveBundle` (l.103-120) uses `db.transaction`.
- `serverApp.ts:/Game` (l.414-505) handles `cmdList` with `packetCommands.flatMap(handleCommand)` and no wrapping transaction. A packet of 10 mutating commands (the client batches 2 s / 7 s windows, so packets can be large) does 10+ `getDocument` (SELECT + full `JSON.parse` of the whole `universe` document) and 10+ `setDocument` (full `JSON.stringify` + REPLACE of the whole universe, which for a big city is hundreds of KB). Examples: `commandHandlers.ts:471-520`, `:671-766`, `:786-834`.
- `prepare()` is called inline for every query (`repository.ts` throughout), so statements are recompiled each call. better-sqlite3 does not cache statements automatically.
- `console.log` per cmdList (`serverApp.ts:458`) is minor.
Fix:
- (low, safe) `this.db.pragma("synchronous = NORMAL")` (safe with WAL; durability only lost on OS crash for the very last commit). Also `busy_timeout`.
- (low, safe) Wrap each `cmdList` packet in `db.transaction(() => ...)`. It must still roll back or continue per-command on a handler error; keep the existing per-command try/catch inside, which already converts errors to responses, so use a SAVEPOINT or just let the outer transaction commit what succeeded. Verify with `server` tests (a failed handler already may have partially written).
- (low, safe) Cache prepared statements in the repository constructor (hoist `prepare`).
- (med, safe) Per-request document memo: in the packet loop keep a `Map<tag, JsonObject>` identity cache for `universe` (parse once per packet, write once at the end if dirty). Requires handlers to go through the cache; behaviour preserved if writes still happen before the response.
- (med) Later: store universe items in rows rather than one JSON blob. That is a redesign, out of scope for tuning.

### 4.2 [LOW-MED] `/Game` responses not compressed; ping/poll chatter is bounded and already ported
- Packets are XML via `buildCommandEnvelope`, uncompressed. `login` / `get_*` startup responses (the universe) can be large. No `compression` middleware on `/Game`. Fix: (low, safe) add `compression()` for `/Game` only if the client sends `Accept-Encoding` (browsers do).
- Client side batching is already a faithful port (`net/session.ts`: 2 s min / 7 s max cache timers, `forceSendAllNow`, `pingUpdatesTimer`). No chatty-polling finding there. `CommandQueue.start(100)` wall-clock interval is a second driver on top of `Game.tick` calling `queue.tick` (`main.ts` uses `game.tick`, which calls `queue.tick(dtMs)`); check `session.start` is not also invoked, or ticks double-count (not confirmed).

### 4.3 [LOW] Static file serving
`clientStatic.ts` is in good shape: precompressed `.br`/`.gz`, ETag, immutable `/assets`, 1-day `max-age` for art. Improvements: (a) per request `fs.existsSync(abs+".br")` and `statSync` (l.34-52): cache a `Map<path, {enc,etag,body}>` after first read (also removes the repeated `readFileSync` of the multi-hundred-KB `.br` per request). (b) Raise `max-age` for `/sprites /gui /ground` to 7 days, or `immutable`, since filenames are stable per build. (c) `fs.existsSync` in the `webpFallback` is run for every `.png` request: cache the decision. All safe.

---

## 5. Build

### 5.1 [MED] No code splitting of rarely used UI
Evidence: `vite.config.ts:60-68` only splits `pixi`. `assets/index-*.js` = 427 KB (105 KB brotli) holds all of `ui/*`: missions, tutorial, collectibles (`ui/rewards/collectibles.ts` is 600+ lines), invest, visit, shop, plus `gui/tids.ts` (2,109 lines of text IDs, probably ~100 KB+). `ui/index.ts` presumably imports mounts statically.
Fix: (low-med, safe) `await import()` for: tutorial (`ui/tutorial/*`, `game/tutorial.ts`: only needed for new players), collectibles/rewards, invest/visit/social, `debug/panel`, `gui/tids` (load per locale JSON). Expected saving: perhaps 100-200 KB parse on cold start (estimate, no bundle analyser run). Run `npx vite-bundle-visualizer` to confirm before doing the work.

### 5.2 [LOW] Pixi bundle
`pixi-*.js` is 594 KB raw (141 KB br). The code imports from the `pixi.js` root; importing only the used extensions (`pixi.js/…` with `import "pixi.js/sprite"`-style entry points, plus no `unsafe-eval` build issues) can trim the bundle. Medium effort, risk of missing a renderer feature (filters, graphics). Safe if smoke-tested.

### 5.3 [LOW] Asset volume
`dist/` is 277 MB (optimised, `public-opt`), `public/` is 536 MB (originals: 356 MB sprites, 170 MB gui). `dist` ships 15.5k WebP files. Consider an `oxipng`/WebP `-z`/lossy re-encode of gui art and 8-bit palettes for sprites. Check which frame sizes are largest: only 1 file in `dist/sprites` is above 300 KB, so large images are not the issue. File count is.

### 5.4 [LOW] Sourcemaps
None emitted (good for size). No change needed; add `build.sourcemap: "hidden"` only if you need prod debugging.

---

## Prioritised top 15

| # | Finding | Sev | Effort | Risk | Safe? |
|---|---------|-----|--------|------|-------|
| 1 | Lazy-load clip frames and skip Effect layers when animations are off; load only when item becomes visible (`itemView.ts:preload`, `loadLayer`) | High | Low | Low | Yes |
| 2 | Pack per-clip frames into atlases (one texture source per clip) and ship fewer files (`sprites.ts`, `itemView.ts`, export tool) | High | Med | Med | Yes (render-only) |
| 3 | Cull before update and add a change-key early-out in `ItemView.update`; stop allocating per-item state objects each frame (`city.ts:tick`, `main.ts:32`, `itemView.ts:268`) | High | Low | Low | Yes |
| 4 | Memoise `economy.population()` per epoch and drop per-frame `emitPopulation`/`pushSuspension` full loops (`game.ts:718-745,788`, `economy.ts:300`) | High | Low | Low | Yes |
| 5 | Merge the always-on rAF loops (`map-layer.ts`, `extras/maplayer.ts`, `owner-upgrades.ts`, `hud.ts`) into one dirty-checked scheduler; skip identical `style.transform` writes; remove `known = new Set()` and `items()` copies per frame (`noroad.ts:51`, `crew.ts:166`) | High | Low-Med | Low | Yes |
| 6 | Replace 1 s / 250 ms / 700 ms polls (`missions/system.ts:134,225`, `bubbles.ts:112`, `rivals.ts:84`) with version-gated work; keep mission-parity timing (re-run the parity scripts) | High | Med | Med (mission parity) | Mostly |
| 7 | Coalesce `redrawGround` per frame and update only changed tiles (`city.ts:redrawGround`, `main.ts:57`) | Med | Low-Med | Low | Yes |
| 8 | SQLite: `synchronous=NORMAL`, hoist/cached prepared statements, one transaction per `cmdList` packet, per-packet document memo (`database.ts`, `repository.ts`, `serverApp.ts:414`) | Med | Low-Med | Low-Med (handler partial-failure semantics) | Yes with tests |
| 9 | Asset middleware: memoise resolved paths, add `Cache-Control`, compress rules XML (`serverApp.ts:633-655,252`) | Med | Low | Low | Yes |
| 10 | Traffic: `sortableChildren` once, synchronous texture arrays instead of per-frame promises, view-cull cars (`traffic.ts:tick`) | Med | Low | Low | Yes |
| 11 | Lazy per-state button subtrees and `<img decoding="async">` in the DOM GUI builder (`gui/dom.ts:97-108,84`) | Med | Low | Low | Yes |
| 12 | Code-split tutorial, rewards/collectibles, social, debug panel, tids (`vite.config.ts`, `ui/index.ts`) after a bundle analyser run | Med | Low-Med | Low | Yes |
| 13 | Texture lifecycle: refcount per sku and destroy textures and `Assets.unload` after the last item of a sku is removed; cap long-session growth (`sprites.ts`, `city.ts:removeItem`) | Med | Med | Med | Yes |
| 14 | Remove the per-item empty `Graphics` bar, add `icon` lazily (`itemView.ts:124,145`); skip `setGhost` redraw when unchanged (`city.ts:263`) | Low-Med | Low | Low | Yes |
| 15 | Static serving: cache br/gz buffers and `existsSync` decisions in `clientStatic.ts`, raise `max-age` for art, share one `index.json` parse (`ui/shop/icons.ts:19`), install debug panel only in dev (`main.ts:98`) | Low | Low | Low | Yes |

Suggested order of work: 3, 4, 5 and 14 are quick CPU wins (a day). 1, then 2 and 13 address memory and boot time. 6 needs care for mission parity. 8 and 9 are server wins, independent of the client.

Caveats: no profile was captured. Before and after each change, record a Chrome Performance trace on a large save (the `window.__mcity` handle in `main.ts:99` exposes `game`, `city` and `traffic`) and `performance.memory` / `Assets.cache` size to confirm the ordering above. Items marked "verify" or "not confirmed" were read from code but not exercised.
