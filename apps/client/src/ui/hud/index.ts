/** HUD area (feature-inventory 3.x): top HUD, tools bar, cursors, info boxes, context actions, options, friends bar, toasts. */
import "../../gui/fonts";
import { fontsReady } from "../../gui/fonts";
import { Graphics } from "pixi.js";
import { TILE } from "../../game/geometry";
import type { UiContext } from "../context";
import { ContextActions } from "./actions";
import { CursorLayer, PointerTracker } from "./cursor";
import { FriendsBar } from "./friends";
import { HudView } from "./hud";
import { InfoBox } from "./infobox";
import { OptionsPanel } from "./options";
import { Toasts } from "./toast";
import { ToolsBar } from "./toolsbar";
import { RENT_MODE, STATE_ID } from "../../net/commands";
import { uiBus } from "../bus";

export interface HudController {
  hud: HudView;
  tools: ToolsBar;
  friends: FriendsBar;
  options: OptionsPanel;
  toasts: Toasts;
}

let controller: HudController | undefined;
/** Access to the mounted HUD (e.g. popups call `getHud()?.tools.setBuildSelected(false)` when the shop closes). */
export const getHud = (): HudController | undefined => controller;

export async function mount(ctx: UiContext): Promise<HudController> {
  await fontsReady();
  const [hud, tools, friends, options] = await Promise.all([HudView.create(ctx), ToolsBar.create(ctx), FriendsBar.create(ctx), OptionsPanel.create(ctx)]);
  const pointer = new PointerTracker(ctx);
  const cursor = new CursorLayer(ctx, pointer);
  const info = new InfoBox(ctx, pointer);
  // Mouse-over outline (ItemObject.mouseOverShow :2878 -> setDisplayObjectOutlineVisible(true, GLOW_COLOR)): yellow frame on the footprint.
  const hoverBox = new Graphics();
  ctx.city.overlayLayer.addChild(hoverBox);
  pointer.onChange((i) => {
    hoverBox.clear();
    const tool = ctx.game.tool.kind;
    const it = i.item;
    if (!i.onMap || !it || (tool !== "select" && tool !== "move") || ctx.game.selection?.sid === it.sid) return;
    hoverBox.rect(it.tileX * TILE, it.tileY * TILE, it.cols * TILE, it.rows * TILE).stroke({ color: 0xffff33, width: 2 });
  });
  const actions = new ContextActions(ctx);
  const toasts = new Toasts(ctx);
  ctx.root.append(friends.el, tools.el, hud.el, options.el, info.el, actions.el, toasts.el, cursor.el);

  const layout = (): void => {
    hud.layout();
    friends.layout();
    const o = friends.toolbarOrigin;
    tools.el.style.transform = `translate(${o.x}px,${o.y}px)`;
    options.layout();
  };
  layout();
  window.addEventListener("resize", layout);

  // Multifunction tools (UI-only): collector / contract signator / move act on the next map click.
  tools.onMultiChange = (m) => cursor.setMulti(m);
  ctx.game.multiToolActive = () => tools.multiTool !== null;
  let down = { x: 0, y: 0 };
  window.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }), true);
  window.addEventListener("pointerup", (e) => {
    const m = tools.multiTool;
    if (!m || !(e.target instanceof HTMLCanvasElement) || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const tile = ctx.city.pointerToTile(e.clientX, e.clientY);
    const item = ctx.game.itemAtTile(tile.x, tile.y);
    if (m === "move" && item) {
      tools.setMulti(null);
      ctx.game.startMove(item.sid);
    } else if (m === "collector") {
      // ToolMoneyCollector: collects every ready item within moneyCollectorAreaX/Y (11x11 tiles) of the click.
      const r = 5;
      for (const it of ctx.game.items()) {
        const near = Math.abs(it.tileX + it.cols / 2 - tile.x) <= r + it.cols / 2 && Math.abs(it.tileY + it.rows / 2 - tile.y) <= r + it.rows / 2;
        if (near && it.stateId === STATE_ID.RENT && it.mode === RENT_MODE.GET_RENT) ctx.game.collectRent(it.sid);
      }
    } else if (m === "contract") {
      // ToolContractSignator: opens the contract chooser for waiting items in the 11x11 area (nearest first).
      const waiting = ctx.game.items().filter((it) => it.stateId === STATE_ID.RENT && it.mode === RENT_MODE.WAITING_FOR_CONTRACT && Math.abs(it.tileX - tile.x) <= 5 && Math.abs(it.tileY - tile.y) <= 5);
      if (waiting[0]) uiBus.emit("openContract", { sid: waiting[0].sid });
    }
  });

  (window as unknown as { __uiBus?: typeof uiBus }).__uiBus = uiBus; // dev aid: observe/emit UI events from the console
  controller = { hud, tools, friends, options, toasts };
  return controller;
}
