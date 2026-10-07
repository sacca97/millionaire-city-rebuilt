import { Container, Sprite, type Application, type Texture } from "pixi.js";
import { TrafficSim, roadSetFromRelative, type RoadMap, type TrafficAgent, type TrafficOptions } from "../game/traffic";
import { SpriteLibrary, type SpriteIndex } from "./sprites";

/** Minimal texture source; SpriteLibrary satisfies it. */
export interface TextureSource {
  texture(path: string): Promise<Texture | undefined>;
}

/**
 * Renders TrafficSim agents. Car art lives in Datas/Assets/items/cars/*.swf, exported to
 * public/sprites/cars (index.json + 360 rotation frames per clip "car_new", frame = floor(angle)+1,
 * TrafficAgent.movementSetRotation). Add `view.container` to city.world between ground and items
 * (Map.as:253-268: the cars layers sit above the background, below the item layers).
 */
export class TrafficView {
  /** The two 'cars' layers of Map.as (agents use layer 0). */
  readonly container = new Container();
  readonly sim: TrafficSim;
  private cars?: SpriteLibrary;
  private sprites = new Map<TrafficAgent, Sprite>();
  private running = false;
  private frameOf = new Map<Sprite, number>();

  constructor(
    private app: Application,
    roads: RoadMap,
    private lib?: TextureSource,
    opts: TrafficOptions = {}
  ) {
    this.sim = new TrafficSim(roads, opts);
    this.container.label = "traffic";
  }

  static roadsFromRelative(roads: Array<[number, number]>, cols: number, rows: number): RoadMap {
    return roadSetFromRelative(roads, cols, rows);
  }

  setRoads(roads: RoadMap): void {
    this.sim.setRoadsAndPrune(roads);
  }

  async start(): Promise<void> {
    if (!this.cars) {
      const res = await fetch("/sprites/cars/index.json");
      if (!res.ok) {
        throw new Error("Car sprite index missing (apps/client/public/sprites/cars).");
      }
      this.cars = new SpriteLibrary((await res.json()) as SpriteIndex);
    }
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Advance the simulation and sync sprites. Call from app.ticker with the frame delta in ms. */
  tick(dtMs: number): void {
    if (!this.running || !this.cars) {
      return;
    }
    this.sim.update(Math.min(dtMs, 100));
    for (const a of this.sim.agents) {
      let sp = this.sprites.get(a);
      if (!a.enabled) {
        if (sp) {
          sp.visible = false;
        }
        continue;
      }
      if (!sp) {
        sp = new Sprite();
        this.sprites.set(a, sp);
        this.container.addChild(sp);
      }
      const sym = this.cars.symbol(a.def.sku, "car");
      if (!sym) {
        continue;
      }
      sp.visible = true;
      sp.alpha = a.alpha;
      sp.x = Math.round(a.x + sym.offsetX);
      sp.y = Math.round(a.y + sym.offsetY);
      sp.zIndex = a.y;
      const frame = Math.min(sym.frames.length - 1, Math.floor(a.rotation) % 360);
      if (this.frameOf.get(sp) !== frame) {
        this.frameOf.set(sp, frame);
        const loader = this.lib ?? this.cars;
        void loader.texture(sym.frames[frame]).then((t) => {
          if (t && this.frameOf.get(sp!) === frame) {
            sp!.texture = t;
          }
        });
      }
    }
    this.container.sortableChildren = true;
  }
}
