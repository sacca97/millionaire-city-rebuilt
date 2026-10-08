import { renderRoadChunks, vectorRoadsSupported } from "./vectorRoads";
import { Application, Assets, BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { MAP_COLS, MAP_ROWS, TILE, tileX, tileY } from "../game/geometry";
import { TILESET_COLS, computeTileIndices, tilesetIndex } from "../terrain";
import type { DefinitionTable } from "../model/definitions";
import type { PlacedItem, WorldState } from "../model/save";
import type { SpriteLibrary } from "./sprites";
import type { ItemStateInput } from "./animation";
import { ItemAssets, ItemView, stateFromItem } from "./itemView";
import type { Ghost } from "../game/tools";
import { intersects, worldViewRect } from "./cull";

const CHUNK = 8; // ground tiles per culling chunk side
/** Roads are drawn as vector art (view/vectorRoads.ts) at this multiple of the native 32 px tiles. `?tileroads=1` restores the original road tile bitmaps (backup path). */
const ROAD_SCALE = 3;
const useVectorRoads = (): boolean => vectorRoadsSupported() && !/[?&]tileroads=1/.test(location.search);
const CULL_MARGIN = 8; // world px

// Geometry lives in game/geometry.ts (no Pixi dependency); re-exported for existing importers.
export { TILE, MAP_COLS, MAP_ROWS, tileX, tileY };

/** HQ is drawn with its skin SWF (HQDecorations/HeadQuarter_0N); default skin HeadQuarter_01 (ItemDecoration.currentSku setter). */
function renderSku(item: { sku: string; skin?: string }): string {
  return item.sku === "HeadQuarter" ? item.skin || "HeadQuarter_01" : item.sku;
}

export class CityView {
  readonly world = new Container();
  private ground = new Container();
  private backdrop?: Sprite;
  private items = new Container();
  private overlay = new Container();
  private itemsTop = new Container();
  private views = new Map<string, { view: ItemView; state: ItemStateInput }>();
  /** The whole 90x60 ground baked into one texture (2D canvas): at fractional zoom separate tile sprites left faint seams between tiles. */
  private tilesBaked = new Sprite();
  /** Vector road chunks drawn above the baked ground (empty with ?tileroads=1). */
  private roadLayer = new Container();
  private tileCache = new Map<number, Texture>();
  private tileset?: Texture;
  private ghostGfx = new Graphics();
  private ghostGlow = new Graphics();
  private ghostView?: { sku: string; view: ItemView };
  private ghostSeq = 0;
  /** Live per-item state (called every frame); falls back to the state stored via setItemState. */
  stateProvider?: (sid: string) => (ItemStateInput & { incomeMs?: number }) | undefined;
  /** Pointer callbacks in WORLD pixels (camera-independent). A click is a press+release without a pan (drag threshold). */
  pointerHandlers: { move?: (wx: number, wy: number) => void; click?: (wx: number, wy: number) => void; leave?: () => void } = {};
  private assets?: Promise<ItemAssets>;
  private clock = 0;

  constructor(
    private app: Application,
    private lib: SpriteLibrary,
    private defs: DefinitionTable
  ) {
    this.items.sortableChildren = true;
    // Map input is handled on the stage (hitArea); nothing under the world is interactive, so skip the per-pointer-move hit-test traversal.
    this.world.interactiveChildren = false;
    this.ground.addChild(this.tilesBaked, this.roadLayer);
    this.world.addChild(this.ground, this.items, this.itemsTop, this.overlay);
    this.ghostGlow.filters = [new BlurFilter({ strength: 5 })];
    this.overlay.addChild(this.ghostGlow, this.ghostGfx);
    app.ticker.add((t) => {
      this.clock += t.deltaMS;
      this.stepZoom(t.deltaMS);
      this.tick();
    });
    app.stage.addChild(this.world);
    this.installCamera();
  }

  /** ItemObject.mBarPosX/Y (BarPosition child, bottom-left item coordinates) for bars drawn above an item (StateOnIA.SellBarOnHouse). */
  barAnchor(sku: string): { x: number; y: number } | undefined {
    const b = this.lib.symbol(sku, "BarPosition");
    return b ? { x: b.offsetX, y: b.offsetY } : undefined;
  }

  get overlayLayer(): Container {
    return this.overlay;
  }

  /** Redraws ground and all items from the world state. */
  async render(state: WorldState): Promise<void> {
    await this.drawGround(state);
    for (const v of this.views.values()) {
      v.view.destroy();
    }
    this.views.clear();
    const mine = state.mine?.items ?? [];
    await Promise.all(mine.map((item) => this.addItem(item)));
  }

  private async drawGround(state: WorldState): Promise<void> {
    const g = this.ground;
    for (const c of g.removeChildren()) {
      if (c !== this.tilesBaked && c !== this.roadLayer) c.destroy();
    }
    // Backdrop: terrain.swf "background" clip, origin (0,0) (Background.as:256-259).
    const backdrop = await Assets.load<Texture>("/ground/background.png").catch(() => undefined);
    if (backdrop) {
      g.addChild(new Sprite(backdrop));
    }
    g.addChild(this.tilesBaked, this.roadLayer);
    const terrain = new Set<number>();
    const road = new Set<number>();
    for (const [x, y] of state.terrain) {
      terrain.add(tileY(y) * MAP_COLS + tileX(x));
    }
    for (const [x, y] of state.roads) {
      road.add(tileY(y) * MAP_COLS + tileX(x));
    }
    await this.redrawGround({ terrain, roads: road });
  }

  /** Redraws terrain/road tiles from absolute tile index sets (index = y * MAP_COLS + x), e.g. GameWorld. */
  async redrawGround(sets: { terrain: ReadonlySet<number>; roads: ReadonlySet<number> }): Promise<void> {
    this.tileset ??= await Assets.load<Texture>("/mcity/0.501/Datas/Assets/terrain/tiles/tileset.png").catch(() => undefined);
    const tileset = this.tileset;
    if (!tileset) {
      return;
    }
    const data = computeTileIndices({ cols: MAP_COLS, rows: MAP_ROWS, terrain: sets.terrain as Set<number>, road: sets.roads as Set<number> });
    // Bake every tile into one canvas at native resolution: one sprite instead of ~5,400, and no inner tile edges to show seams.
    const res = tileset.source.resource as CanvasImageSource;
    const canvas = document.createElement("canvas");
    canvas.width = MAP_COLS * TILE;
    canvas.height = MAP_ROWS * TILE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    // Roads: vector chunks above the ground (the road tiles are then left out of the bake); falls back to the tile bitmaps.
    const isRoadTile = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP_COLS && y < MAP_ROWS && sets.roads.has(y * MAP_COLS + x) && !sets.terrain.has(y * MAP_COLS + x);
    const chunks = useVectorRoads()
      ? renderRoadChunks({ cols: MAP_COLS, rows: MAP_ROWS, isRoad: isRoadTile, tileIndex: (x, y) => tilesetIndex(data[y * MAP_COLS + x]), scale: ROAD_SCALE, chunk: CHUNK })
      : undefined;
    for (const c of this.roadLayer.removeChildren()) c.destroy({ texture: true });
    if (chunks) {
      for (const rc of chunks) {
        const sp = new Sprite(Texture.from(rc.canvas));
        sp.x = rc.cx * CHUNK * TILE;
        sp.y = rc.cy * CHUNK * TILE;
        sp.width = sp.height = CHUNK * TILE;
        this.roadLayer.addChild(sp);
      }
    }
    for (let i = 0; i < data.length; i += 1) {
      const idx = tilesetIndex(data[i]);
      if (idx < 0 || (chunks && isRoadTile(i % MAP_COLS, Math.floor(i / MAP_COLS)))) {
        continue;
      }
      ctx.drawImage(res, (idx % TILESET_COLS) * TILE, Math.floor(idx / TILESET_COLS) * TILE, TILE, TILE, (i % MAP_COLS) * TILE, Math.floor(i / MAP_COLS) * TILE, TILE, TILE);
    }
    const old = this.tilesBaked.texture;
    this.tilesBaked.texture = Texture.from(canvas);
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  /** Ground culling chunks (CHUNK x CHUNK tiles each), key = chunkY * 1000 + chunkX. */
  private chunks = new Map<number, Container>();
  private cullTiles(view: ReturnType<typeof worldViewRect>): void {
    const px = CHUNK * TILE;
    for (const [key, c] of this.chunks) {
      const cx = (key % 1000) * px;
      const cy = Math.floor(key / 1000) * px;
      c.visible = intersects(view, cx, cy, cx + px, cy + px);
    }
  }

  private viewConfig(sku: string, tx: number, ty: number) {
    const def = this.defs.get(sku);
    const cols = def?.cols ?? 1;
    const rows = def?.rows ?? 1;
    const a = def?.attrs ?? {};
    return {
      sku,
      tileX: tx,
      tileY: ty,
      cols,
      rows,
      // Decorations always play their normal clip (ItemObject.as:2312 skips the stop for TYPE_DECORATIONS).
      isAnimated: a.isAnimated === "1" || sku.startsWith("decorations_"),
      isClub: sku.startsWith("club"),
      isCommerce: sku.startsWith("commerce"),
      constructionMinutes: Number(a.constructionTime ?? 0),
      // Draw order: tile index of the footprint's bottom-right row (Map.addIntoDisplay).
      depth: (ty + rows - 1) * MAP_COLS + (tx + cols)
    };
  }

  async addItem(item: PlacedItem): Promise<void> {
    if (this.views.has(item.sid)) {
      return;
    }
    this.assets ??= ItemAssets.load();
    const view = await ItemView.create(
      { ...this.viewConfig(item.sku, tileX(item.x), tileY(item.y)), sku: renderSku(item) },
      this.lib,
      await this.assets
    );
    const state = stateFromItem(item);
    view.update(state, this.clock);
    if (this.views.has(item.sid)) {
      view.destroy(); // added twice while loading
      return;
    }
    this.items.addChild(view.container);
    this.itemsTop.addChild(view.top);
    this.views.set(item.sid, { view, state });
  }

  removeItem(sid: string): void {
    const v = this.views.get(sid);
    if (v) {
      v.view.destroy();
      this.views.delete(sid);
    }
  }

  /** Re-places an item's view after a move (absolute tile of the footprint's top-left). */
  moveItemView(sid: string, sku: string, tx: number, ty: number): void {
    this.views.get(sid)?.view.setTile(tx, ty, this.viewConfig(sku, tx, ty).depth);
  }

  /** Changes an item's visual state (e.g. from a future controller). */
  setItemState(sid: string, state: ItemStateInput): void {
    const v = this.views.get(sid);
    if (v) {
      v.state = state;
    }
  }

  private tick(): void {
    const k = this.world.scale.x;
    const view = worldViewRect(this.world.x, this.world.y, k, this.app.screen.width, this.app.screen.height, CULL_MARGIN);
    this.cullTiles(view);
    for (const [sid, v] of this.views) {
      const live = this.stateProvider?.(sid);
      if (live) {
        v.view.setIncomeMs(live.incomeMs);
        v.state = live;
      }
      v.view.update(v.state, this.clock);
      // Viewport culling (render-only): items entirely outside the camera are not drawn.
      const o = v.view.originPx;
      const b = v.view.bounds;
      v.view.setCulled(!intersects(view, o.x + b[0], o.y + b[1], o.x + b[2], o.y + b[3]));
    }
  }

  /** Screen (canvas) pixels -> world pixels. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    const k = this.world.scale.x;
    return { x: (sx - this.world.x) / k, y: (sy - this.world.y) / k };
  }

  /** Screen pixels -> absolute tile (floor). */
  pointerToTile(sx: number, sy: number): { x: number; y: number } {
    const w = this.toWorld(sx, sy);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  private installCamera(): void {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    const DRAG_THRESHOLD = 5; // px: below this a press+release is a click, not a pan
    let pressed = false;
    let panning = false;
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    stage.on("pointerdown", (e) => {
      pressed = true;
      panning = false;
      start = { x: e.global.x, y: e.global.y };
      last = { x: e.global.x, y: e.global.y };
    });
    stage.on("pointerup", (e) => {
      if (pressed && !panning) {
        const w = this.toWorld(e.global.x, e.global.y);
        this.pointerHandlers.click?.(w.x, w.y);
      }
      pressed = false;
      panning = false;
    });
    stage.on("pointerupoutside", () => {
      pressed = false;
      panning = false;
    });
    stage.on("pointerleave", () => this.pointerHandlers.leave?.());
    stage.on("pointermove", (e) => {
      if (pressed && !panning && Math.hypot(e.global.x - start.x, e.global.y - start.y) > DRAG_THRESHOLD) {
        panning = true;
      }
      if (panning) {
        this.world.x += e.global.x - last.x;
        this.world.y += e.global.y - last.y;
        this.clampCamera();
        last = { x: e.global.x, y: e.global.y };
        return;
      }
      const w = this.toWorld(e.global.x, e.global.y);
      this.pointerHandlers.move?.(w.x, w.y);
    });
    this.app.canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.zoomTarget = Math.min(3, Math.max(0.3, (this.zoomTarget ?? this.world.scale.x) * factor));
        this.zoomAnchor = { x: ev.offsetX, y: ev.offsetY };
      },
      { passive: false }
    );
  }

  private zoomTarget: number | null = null;
  private zoomAnchor = { x: 0, y: 0 };

  /** Eases the wheel zoom towards its target about the pointer (frame-rate independent). */
  private stepZoom(dtMs: number): void {
    if (this.zoomTarget === null) return;
    const cur = this.world.scale.x;
    let next = cur + (this.zoomTarget - cur) * (1 - Math.exp(-dtMs / 70));
    if (Math.abs(this.zoomTarget - next) < 0.002) {
      next = this.zoomTarget;
      this.zoomTarget = null;
    }
    const k = next / cur;
    this.world.x = this.zoomAnchor.x - (this.zoomAnchor.x - this.world.x) * k;
    this.world.y = this.zoomAnchor.y - (this.zoomAnchor.y - this.world.y) * k;
    this.world.scale.set(next);
    this.clampCamera();
  }

  /** Draws the build/move/tile ghost (absolute tiles); null hides it. Items get a translucent sprite plus a green/red footprint. */
  setGhost(g: Ghost | null): void {
    const gfx = this.ghostGfx;
    gfx.clear();
    this.ghostGlow.clear();
    if (!g) {
      this.hideGhostView();
      this.grill.visible = false;
      return;
    }
    if (g.art === "terrain") {
      // Map.as:285-301: valid tile = 2 px green outline + 50% green fill + `Grill` grid art; invalid = 50% red fill + `GrillBad`.
      const px = g.x * TILE;
      const py = g.y * TILE;
      if (g.valid) gfx.rect(px, py, TILE, TILE).fill({ color: 0x00ff00, alpha: 0.5 }).stroke({ color: 0x00ff00, width: 2 });
      else gfx.rect(px, py, TILE, TILE).fill({ color: 0xff0000, alpha: 0.5 });
      void this.showGrill(g.valid, px + TILE / 2, py + TILE / 2);
      this.hideGhostView();
      return;
    }
    this.grill.visible = false;
    // Oracle (build-flow 05-04-placing): the ghost is the opaque finished building with a 3 px green (red when invalid) frame around the
    // footprint, one line per tile and a soft glow.
    const colour = g.valid ? 0x00ff00 : 0xff0000;
    const x0 = g.x * TILE;
    const y0 = g.y * TILE;
    const w = g.cols * TILE;
    const h = g.rows * TILE;
    gfx.rect(x0, y0, w, h).fill({ color: colour, alpha: g.kind === "item" ? 0.08 : 0.3 });
    for (let c = 1; c < g.cols; c += 1) gfx.moveTo(x0 + c * TILE, y0).lineTo(x0 + c * TILE, y0 + h);
    for (let r = 1; r < g.rows; r += 1) gfx.moveTo(x0, y0 + r * TILE).lineTo(x0 + w, y0 + r * TILE);
    gfx.stroke({ color: colour, width: 1.5, alpha: 0.9 });
    gfx.rect(x0, y0, w, h).stroke({ color: colour, width: 2, alpha: 1, alignment: 1 });
    this.ghostGlow.clear();
    this.ghostGlow.rect(x0, y0, w, h).stroke({ color: colour, width: 5, alpha: 0.8 });
    if (g.kind === "item" && g.sku) {
      void this.showGhostView(g);
    } else {
      this.hideGhostView();
    }
  }

  private grill = new Sprite();
  private grillTex = new Map<boolean, Texture>();
  private async showGrill(valid: boolean, cx: number, cy: number): Promise<void> {
    if (!this.grill.parent) {
      this.grill.anchor.set(0.5);
      this.overlay.addChild(this.grill);
    }
    let tex = this.grillTex.get(valid);
    if (!tex) {
      tex = await Assets.load<Texture>(`/gui/Dollars/sprites/com.dchoc.framework.utils.AssetManager_Grill${valid ? "" : "Bad"}/1.png`).catch(() => undefined);
      if (tex) this.grillTex.set(valid, tex);
    }
    if (!tex) return;
    this.grill.texture = tex;
    this.grill.position.set(cx, cy);
    this.grill.visible = true;
  }

  private hideGhostView(): void {
    if (this.ghostView) {
      this.ghostView.view.container.visible = false;
      this.ghostView.view.top.visible = false;
    }
  }

  private async showGhostView(g: Ghost): Promise<void> {
    const sku = g.sku as string;
    if (this.ghostView?.sku !== sku) {
      const seq = ++this.ghostSeq;
      this.assets ??= ItemAssets.load();
      const view = await ItemView.create({ ...this.viewConfig(sku, g.x, g.y), sku: renderSku({ sku }) }, this.lib, await this.assets);
      if (seq !== this.ghostSeq) {
        view.destroy();
        return;
      }
      this.ghostView?.view.destroy();
      view.setEffectsEnabled(false); // no animated effect layers on the ghost
      view.container.alpha = 1;
      view.top.alpha = 1;
      this.overlay.addChild(view.container, view.top, this.ghostGlow, this.ghostGfx); // frame above the building
      this.ghostView = { sku, view };
    }
    const v = this.ghostView.view;
    v.container.visible = true;
    v.top.visible = true;
    v.container.tint = v.top.tint = g.valid ? 0x88ff88 : 0xff8888; // colour transform of the cursor item (green = placeable)
    v.setTile(g.x, g.y, 0);
    v.update({ stateId: 4, mode: 0, time: 0 }, this.clock); // HEADQUARTER state = plain animated "normal" clip
  }

  /** FriendsBar.getHeight(): the bottom strip not available to the map camera (DollarsGame.getScreenHeight). */
  bottomInset = 96;

  /** Map.as:1015-1075 (scroll limits): the map (plus a 4-tile right margin) never scrolls past the stage edges. */
  clampCamera(): void {
    const k = this.world.scale.x;
    const w = this.app.screen.width;
    const h = this.app.screen.height - this.bottomInset;
    const mapW = Math.round(MAP_COLS * TILE * k) + Math.round(4 * TILE * k);
    const mapH = Math.round(MAP_ROWS * TILE * k);
    this.world.x = w > mapW ? (w - mapW) >> 1 : Math.min(0, Math.max(w - mapW, this.world.x));
    this.world.y = h > mapH ? Math.round((h - mapH) / 2) : Math.min(0, Math.max(h - mapH, this.world.y));
  }

  /** Map.cameraStart (:853-860) + cameraGetLookingAtHQX/Y (:1650-1678): the HQ centre at stage x/2 and stage y/3 + 25. */
  centerOnHQ(hq: { tileX: number; tileY: number; cols: number; rows: number }): void {
    const s = this.world.scale.x;
    this.world.x = Math.trunc(-(hq.tileX * TILE + (hq.cols * TILE) / 2) * s + this.app.screen.width / 2);
    this.world.y = Math.trunc(-(hq.tileY * TILE + (hq.rows * TILE) / 2) * s + this.app.screen.height / 3 + 25);
    this.clampCamera();
  }

  /** Map.cameraStart tutorial branch (:861-867): map centred horizontally (+1 tile), vertically in the area above the friends bar. */
  cameraStartTutorial(): void {
    const k = this.world.scale.x;
    this.world.x = ((this.app.screen.width - MAP_COLS * TILE * k) >> 1) + TILE * k;
    this.world.y = (this.app.screen.height - 124 - MAP_ROWS * TILE * k) >> 1; // 124 = measured FriendsBar background height (oracle)
    this.clampCamera();
  }

  centerOn(tileCol: number, tileRow: number): void {
    const s = this.world.scale.x;
    this.world.x = this.app.screen.width / 2 - tileCol * TILE * s;
    this.world.y = this.app.screen.height / 2 - tileRow * TILE * s;
  }
}
