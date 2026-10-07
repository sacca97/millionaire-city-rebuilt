// Expansion plots: 25 plots composed of "mini" areas on a 6x6 grid of 15x10-tile areas.
// Sources: rules/expansions.xml (Composition), Map.getAreaIndexFromTileIndex (Map.as:1850),
// Profile.isExpansionAreaType (Profile.as:1475), apps/server/src/commandHandlers/plots.ts.

export const AREA_COLS = 15;
export const AREA_ROWS = 10;
export const MINI_SIDE = 6;
/** Plot.TYPE_FULL: the plot is owned. States: 0 locked, 1 for sale, 2 owned. */
export const PLOT_OWNED = 2;
export const PLOT_FOR_SALE = 1;

export interface ExpansionDef {
  unlockedOrder: number;
  composition: number[];
}

export function parseExpansions(xml: string): ExpansionDef[] {
  const out: ExpansionDef[] = [];
  for (const m of xml.matchAll(/<Definition\s+([^>]*?)\/?>/g)) {
    const order = /unlockedOrder="(\d+)"/.exec(m[1])?.[1];
    const comp = /Composition="([^"]*)"/.exec(m[1])?.[1];
    if (order !== undefined && comp !== undefined) {
      out.push({ unlockedOrder: Number(order), composition: comp.split(",").map(Number) });
    }
  }
  return out;
}

/** Default plot states when the save has none (plots.ts getPlotStates). */
export function defaultPlotStates(defs: ExpansionDef[]): number[] {
  return defs.map((d) => (d.unlockedOrder === 0 ? PLOT_OWNED : d.unlockedOrder === 1 ? PLOT_FOR_SALE : 0));
}

export function parsePlotStates(type: string | undefined, defs: ExpansionDef[]): number[] {
  if (!type) {
    return defaultPlotStates(defs);
  }
  return type.split(",").map(Number);
}

export class Expansions {
  readonly miniToPlot: number[] = [];

  constructor(
    readonly defs: ExpansionDef[],
    public states: number[]
  ) {
    defs.forEach((d, plot) => d.composition.forEach((mini) => (this.miniToPlot[mini] = plot)));
  }

  miniIndex(tx: number, ty: number): number {
    return Math.floor(tx / AREA_COLS) + Math.floor(ty / AREA_ROWS) * MINI_SIDE;
  }

  plotAt(tx: number, ty: number): number {
    return this.miniToPlot[this.miniIndex(tx, ty)] ?? -1;
  }

  /** Map.isTileInAreaMine. */
  isMine(tx: number, ty: number): boolean {
    return this.states[this.plotAt(tx, ty)] === PLOT_OWNED;
  }

  /** Tile rectangle covered by a plot (union of its minis' bounding box; plots are rectangles). */
  plotRect(plot: number): { x: number; y: number; w: number; h: number } {
    const minis = this.defs[plot].composition;
    const cols = minis.map((m) => m % MINI_SIDE);
    const rows = minis.map((m) => Math.floor(m / MINI_SIDE));
    const x0 = Math.min(...cols);
    const y0 = Math.min(...rows);
    return { x: x0 * AREA_COLS, y: y0 * AREA_ROWS, w: (Math.max(...cols) - x0 + 1) * AREA_COLS, h: (Math.max(...rows) - y0 + 1) * AREA_ROWS };
  }
}
