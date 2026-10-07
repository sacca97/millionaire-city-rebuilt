import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { PlacedItem } from "../model/save";
import {
  type ClipName,
  type ItemStateInput,
  type VisualSpec,
  iconFrame,
  loopFrameIndex,
  resolveVisual
} from "./animation";
import type { SpriteLibrary, SymbolInfo } from "./sprites";
import { unionBoxes } from "./cull";

/** Quality LOW (OptionsPanel.onQualityClick; ItemObject.as:2240-2345): no looping item animations / effects. Set by ui/extras. */
export const renderOptions = { animations: true };

const TILE = 32;
const ICON_SIZE = 75; // TopLayer.TILE_WIDTH/HEIGHT
const DEFAULT_FPS = 30;
const ITEMS_ROOT = "/mcity/0.501/Datas/Assets/items/";

export function stateFromItem(item: PlacedItem): ItemStateInput {
  return {
    stateId: item.stateId,
    mode: Number(item.state.mode ?? 0) || 0,
    time: Number(item.state.time ?? 0) || 0
  };
}

interface GenericEntry {
  file: string;
  width: number;
  height: number;
}

/** Shared, lazily-loaded extra assets (frame rates, BuildingState bitmaps, TopLayer icon sheets). */
export class ItemAssets {
  private icons = new Map<string, Promise<Texture[] | undefined>>();
  private constructor(
    private rates: Record<string, number>,
    private generic: Record<string, GenericEntry>
  ) {}

  static async load(): Promise<ItemAssets> {
    const get = async <T>(url: string): Promise<T> => {
      try {
        const r = await fetch(url);
        return r.ok ? ((await r.json()) as T) : ({} as T);
      } catch {
        return {} as T;
      }
    };
    const [rates, generic] = await Promise.all([
      get<Record<string, number>>("/sprites/framerates.json"),
      get<Record<string, GenericEntry>>("/sprites/_building_state/index.json")
    ]);
    return new ItemAssets(rates, generic);
  }

  fps(sku: string): number {
    return this.rates[sku] ?? DEFAULT_FPS;
  }

  /** Generic "T<rows>x<cols>" construction-site bitmap (BuildingState.swf). */
  async genericBuilding(rows: number, cols: number): Promise<Texture | undefined> {
    const e = this.generic[`T${rows}x${cols}`];
    return e ? Assets.load<Texture>(`/sprites/_building_state/${e.file}`).catch(() => undefined) : undefined;
  }

  /** 4-frame 75x75 sheet from items/common (contract/rent) or CommerceTypes/icons. */
  iconFrames(kind: "contract" | "rent" | "commerce", sku: string): Promise<Texture[] | undefined> {
    const path =
      kind === "commerce" ? `CommerceTypes/icons/${sku}.png` : kind === "rent" ? "common/rentIcon.png" : "common/contractIcon.png";
    let p = this.icons.get(path);
    if (!p) {
      p = Assets.load<Texture>(ITEMS_ROOT + path)
        .then((sheet) =>
          [0, 1, 2, 3].map((i) => new Texture({ source: sheet.source, frame: new Rectangle(i * ICON_SIZE, 0, ICON_SIZE, ICON_SIZE) }))
        )
        .catch(() => undefined);
      this.icons.set(path, p);
    }
    return p;
  }
}

export interface ItemViewConfig {
  sku: string;
  /** Absolute tile of the footprint's top-left. */
  tileX: number;
  tileY: number;
  cols: number;
  rows: number;
  isAnimated: boolean;
  isClub: boolean;
  isCommerce: boolean;
  /** Definition constructionTime in minutes. */
  constructionMinutes: number;
  /** Total income time of the current contract in ms, if known (otherwise inferred). */
  incomeMs?: number;
  /** Draw-order key (see city.ts). */
  depth: number;
}

const SHOW_CONSTRUCTION_BAR = false;

interface Layer {
  sym: SymbolInfo;
  tex: Texture[];
}

/**
 * One building. `container` goes into the sorted item layer (L0), `top` into the layer above all items (L1:
 * Effect_*_top, progress bar, state icon). Call update(state, nowMs) every frame; it is cheap and idempotent.
 */
export class ItemView {
  readonly container = new Container();
  readonly top = new Container();
  private main = new Sprite();
  private effects: { sprite: Sprite; layer: Layer; top: boolean }[] = [];
  private clips = new Map<ClipName, Layer>();
  private generic?: Texture;
  private icon = new Sprite();
  private bar = new Graphics();
  private barAnchor = { x: 0, y: 0 };
  private fps = DEFAULT_FPS;
  private observedMax = 0;
  private iconTex = new Map<string, Texture[]>();
  private originX: number;
  private originY: number;

  private constructor(
    private cfg: ItemViewConfig,
    private lib: SpriteLibrary,
    private assets: ItemAssets
  ) {
    // Footprint bottom-left: state clips are anchored here (ItemObject.as:2307).
    this.originX = cfg.tileX * TILE;
    this.originY = (cfg.tileY + cfg.rows) * TILE;
    this.container.position.set(this.originX, this.originY);
    this.top.position.set(this.originX, this.originY);
    this.container.zIndex = cfg.depth;
    this.container.addChild(this.main);
    this.icon.visible = false;
    this.top.addChild(this.bar, this.icon);
    this.fps = assets.fps(cfg.sku);
  }

  static async create(cfg: ItemViewConfig, lib: SpriteLibrary, assets: ItemAssets): Promise<ItemView> {
    const v = new ItemView(cfg, lib, assets);
    await v.preload();
    return v;
  }

  private async loadLayer(name: string): Promise<Layer | undefined> {
    const sym = this.lib.symbol(this.cfg.sku, name);
    if (!sym || sym.frames.length === 0) {
      return undefined;
    }
    const tex = await Promise.all(sym.frames.map((f) => this.lib.texture(f)));
    if (tex.some((t) => !t)) {
      return undefined;
    }
    return { sym, tex: tex as Texture[] };
  }

  private async preload(): Promise<void> {
    const { sku, rows, cols } = this.cfg;
    for (const name of ["normal", "normal_2", "building"] as const) {
      const l = await this.loadLayer(name);
      if (l) {
        this.clips.set(name, l);
      }
    }
    this.generic = await this.assets.genericBuilding(rows, cols);
    const bar = this.lib.symbol(sku, "BarPosition");
    if (bar) {
      // mBarPosX/Y = BarPosition child position (ItemObject.as:2252); y is relative to the footprint top,
      // which in our bottom-left coordinates is simply offsetY.
      this.barAnchor = { x: bar.offsetX, y: bar.offsetY };
    }
    // Effect_<i>[_top] (+ "_new"), ItemObject.effectsDraw: L0 for "", L1 for "_top". Anchored like state clips.
    for (const suffix of ["", "_top", "_people"]) {
      for (let i = 0; ; i += 1) {
        const l = await this.loadLayer(`Effect_${i}${suffix}`);
        if (!l) {
          break;
        }
        const sprite = new Sprite(l.tex[0]);
        sprite.position.set(l.sym.offsetX, l.sym.offsetY);
        this.effects.push({ sprite, layer: l, top: suffix === "_top" });
        (suffix === "_top" ? this.top : this.container).addChild(sprite);
      }
    }
    for (const kind of this.cfg.isCommerce ? (["commerce", "rent", "contract"] as const) : (["rent", "contract"] as const)) {
      const t = await this.assets.iconFrames(kind, sku);
      if (t) {
        this.iconTex.set(kind, t);
      }
    }
  }

  private boundsBox?: [number, number, number, number];
  /** Conservative art bounds relative to the footprint bottom-left (all clips, effects, generic site, icon); used only for viewport culling. */
  get bounds(): [number, number, number, number] {
    if (!this.boundsBox) {
      const boxes: Array<[number, number, number, number]> = [];
      const addLayer = (l: Layer): void => {
        let w = 0;
        let h = 0;
        for (const t of l.tex) {
          w = Math.max(w, t.width);
          h = Math.max(h, t.height);
        }
        boxes.push([l.sym.offsetX, l.sym.offsetY, l.sym.offsetX + w, l.sym.offsetY + h]);
      };
      for (const l of this.clips.values()) addLayer(l);
      for (const e of this.effects) addLayer(e.layer);
      if (this.generic) boxes.push([0, -this.generic.height, this.generic.width, 0]);
      const ix = (this.cfg.cols * TILE - ICON_SIZE) / 2;
      const iy = -this.cfg.rows * TILE + (this.cfg.rows * TILE - ICON_SIZE) / 2;
      boxes.push([ix, iy, ix + ICON_SIZE, iy + ICON_SIZE]);
      boxes.push([0, -this.cfg.rows * TILE, this.cfg.cols * TILE, 0]);
      const u = unionBoxes(boxes) as [number, number, number, number];
      this.boundsBox = [u[0] - 16, u[1] - 16, u[2] + 16, u[3] + 16];
    }
    return this.boundsBox;
  }

  /** Viewport culling: hides both layers without touching state. */
  setCulled(culled: boolean): void {
    this.container.visible = !culled;
    this.top.visible = !culled;
  }

  get originPx(): { x: number; y: number } {
    return { x: this.originX, y: this.originY };
  }

  private context() {
    return {
      isAnimated: this.cfg.isAnimated,
      isClub: this.cfg.isClub,
      hasBuildingClip: this.clips.has("building"),
      hasNormal2Clip: this.clips.has("normal_2"),
      constructionMs: this.cfg.constructionMinutes * 60000,
      incomeMs: this.cfg.incomeMs ?? this.observedMax
    };
  }

  /** Total income time of the active contract (drives the renting frame); undefined -> inferred. */
  setIncomeMs(ms: number | undefined): void {
    this.cfg.incomeMs = ms && ms > 0 ? ms : undefined;
  }

  /** Moves the view to a new footprint (absolute tile of the top-left). */
  setTile(tileX: number, tileY: number, depth: number): void {
    this.cfg.tileX = tileX;
    this.cfg.tileY = tileY;
    this.originX = tileX * TILE;
    this.originY = (tileY + this.cfg.rows) * TILE;
    this.container.position.set(this.originX, this.originY);
    this.top.position.set(this.originX, this.originY);
    this.container.zIndex = depth;
  }

  /** Applies the item's state at time nowMs (ms, any monotonic clock). */
  update(st: ItemStateInput, nowMs: number): VisualSpec {
    if (this.cfg.incomeMs === undefined && st.stateId === 1 && st.mode === 4) {
      this.observedMax = Math.max(this.observedMax, st.time);
    }
    const spec = resolveVisual(st, this.context(), this.cfg.isCommerce);
    this.applyMain(spec, nowMs);
    this.applyEffects(spec, nowMs);
    this.applyIcon(spec, nowMs);
    this.applyBar(spec);
    return spec;
  }

  private applyMain(spec: VisualSpec, nowMs: number): void {
    if (spec.clip === "generic") {
      if (!this.generic) {
        this.main.visible = false;
        return;
      }
      this.main.visible = true;
      this.main.texture = this.generic;
      // Bottom-aligned to the footprint; ItemObject.as:2290 puts the bitmap at y = baseHeight - h.
      this.main.position.set(0, -this.generic.height);
      return;
    }
    const layer = this.clips.get(spec.clip) ?? this.clips.get("normal");
    if (!layer) {
      this.main.visible = false;
      return;
    }
    this.main.visible = true;
    const idx = spec.frame === "loop" ? (renderOptions.animations ? loopFrameIndex(nowMs, this.fps, layer.tex.length) : 0) : Math.min(spec.frame, layer.tex.length) - 1;
    this.main.texture = layer.tex[idx];
    this.main.position.set(layer.sym.offsetX, layer.sym.offsetY);
  }

  private effectsEnabled = true;
  setEffectsEnabled(on: boolean): void {
    this.effectsEnabled = on;
  }

  private applyEffects(spec: VisualSpec, nowMs: number): void {
    for (const e of this.effects) {
      e.sprite.visible = this.effectsEnabled && spec.effects && renderOptions.animations;
      if (spec.effects) {
        e.sprite.texture = e.layer.tex[loopFrameIndex(nowMs, this.fps, e.layer.tex.length)];
      }
    }
  }

  private applyIcon(spec: VisualSpec, nowMs: number): void {
    const tex = spec.icon ? this.iconTex.get(spec.icon) ?? this.iconTex.get("rent") : undefined;
    if (!tex || !spec.icon) {
      this.icon.visible = false;
      return;
    }
    this.icon.visible = true;
    this.icon.texture = tex[iconFrame(nowMs)];
    // StateOnRent.setAnimationPosition: 75x75 centred on the footprint.
    this.icon.position.set((this.cfg.cols * TILE - ICON_SIZE) / 2, (-this.cfg.rows * TILE + (this.cfg.rows * TILE - ICON_SIZE) / 2));
  }

  private applyBar(spec: VisualSpec): void {
    const g = this.bar;
    // The bar is never drawn while SHOW_CONSTRUCTION_BAR is off; clearing an empty Graphics every frame only dirtied the render group.
    if (!SHOW_CONSTRUCTION_BAR) {
      return;
    }
    g.clear();
    // Oracle (build-flow 07 / 09): a construction site shows no bar above the building - the remaining time is only in the hover box.
    if (!SHOW_CONSTRUCTION_BAR || spec.progress === undefined) {
      return;
    }
    // Approximation: the original DCFillBar art is not exported; draw a simple bar at the BarPosition anchor.
    const w = 40;
    const h = 6;
    const x = this.barAnchor.x - w / 2 + 3;
    const y = this.barAnchor.y;
    g.rect(x - 1, y - 1, w + 2, h + 2).fill(0x000000);
    g.rect(x, y, w, h).fill(0x444444);
    g.rect(x, y, w * spec.progress, h).fill(0x4cd137);
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.top.destroy({ children: true });
  }
}
