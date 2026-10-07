/** Economy area (feature-inventory 2.5/10): HQ connection icons, influence areas, commerce population, wonders, crew, rent accelerator. */
import { PointerTracker } from "../hud/cursor";
import type { UiContext } from "../context";
import { uiBus } from "../bus";
import { AcceleratorTool } from "./accelerator";
import { CrewIcons, openHireCrew } from "./crew";
import { RentFx } from "./fx";
import { InfluenceView } from "./influence";
import { MapLayer } from "./map-layer";
import { NoRoadIcons } from "./noroad";
import { openCompanyValue } from "./value";

export interface EconomyUi {
  layer: MapLayer;
  noRoad: NoRoadIcons;
  influence: InfluenceView;
  accelerator: AcceleratorTool;
}

export async function mount(ctx: UiContext): Promise<EconomyUi> {
  const layer = new MapLayer(ctx);
  const pointer = new PointerTracker(ctx);
  const noRoad = new NoRoadIcons(ctx, layer);
  const influence = new InfluenceView(ctx, layer, pointer);
  const accelerator = new AcceleratorTool(ctx);
  new CrewIcons(ctx, layer);
  new RentFx(ctx, layer);
  ctx.game.on("hq-click", () => void openCompanyValue(ctx));
  ctx.game.on("hire-crew", ({ sid }) => void openHireCrew(ctx, sid));
  uiBus.on("openCrew", ({ sid }) => void openHireCrew(ctx, sid));
  // A visit re-renders the shared CityView with the neighbour's city: my overlays (icons, influence, crew counters) must not float over it.
  uiBus.on("visitStarted", () => {
    layer.el.style.display = "none";
    accelerator.stop();
  });
  uiBus.on("visitEnded", () => (layer.el.style.display = ""));
  const ui = { layer, noRoad, influence, accelerator };
  (window as unknown as { __economyUi?: EconomyUi }).__economyUi = ui; // dev aid
  return ui;
}
