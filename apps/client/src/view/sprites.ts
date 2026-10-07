import { Assets, Texture } from "pixi.js";

export interface SymbolInfo {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  frames: string[];
}

export type SpriteIndex = Record<string, Record<string, SymbolInfo>>;

const BASE = "/sprites/";

export class SpriteLibrary {
  private cache = new Map<string, Promise<Texture | undefined>>();
  constructor(private index: SpriteIndex) {}

  static async load(): Promise<SpriteLibrary> {
    const res = await fetch(BASE + "index.json");
    if (!res.ok) {
      throw new Error("Sprite index missing. Run `npm run export-sprites -w @mcity/client`.");
    }
    return new SpriteLibrary((await res.json()) as SpriteIndex);
  }

  /** Symbol for a clip, preferring the `_new` variant like ItemDefinition.getDisplayObject. */
  symbol(sku: string, clip: string): SymbolInfo | undefined {
    const entry = this.index[sku];
    return entry?.[clip + "_new"] ?? entry?.[clip];
  }

  texture(path: string): Promise<Texture | undefined> {
    let p = this.cache.get(path);
    if (!p) {
      p = Assets.load<Texture>(BASE + path).catch(() => undefined);
      this.cache.set(path, p);
    }
    return p;
  }
}
