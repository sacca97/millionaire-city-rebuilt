/**
 * Tutorial controller: glue between the pure TutorialMachine (game/tutorial.ts), the game events and the UI (popup, arrows,
 * toolbar lock). Completion hooks follow Tutorial.as / ToolBuild / StateOnRent (see game/tutorial.ts for citations).
 */
import { getText, t } from "../../gui/i18n";
import { STATE_ID, RENT_MODE } from "../../net/commands";
import type { GameItem } from "../../game/game";
import { TILE } from "../../game/geometry";
import { DECORATION_SKU, HOUSE_SKU, HQ_SKU, STEP, STEP_CONTENT, type TutorialMachine, type TutorialSnapshot } from "../../game/tutorial";
import type { UiContext } from "../context";
import { getHud } from "../hud";
import { getShop } from "../shop";
import { startNoteRain, stopNoteRain } from "../extras/noterain";
import { ArrowLayer, type Overlay } from "./arrows";
import { runIntro, showInviteNeighbors } from "./intro";
import { TutorialPopup } from "./popup";

const NEW_TOOL_REV = 3;
const LAUNCH_DELAY_MS = 3000; // DollarsGame.startTutorial: setTimeout(launchTutorial, 3000)
export const JUST_ENDED_KEY = "mcity.tutorialJustEnded";

export class TutorialController {
  private popup!: TutorialPopup;
  private arrows = new ArrowLayer();
  private lastStep = -1;
  private prev = new Map<string, { stateId: number; mode: number }>();
  private genre: 0 | 1 = 0;

  constructor(private readonly ctx: UiContext, readonly machine: TutorialMachine) {}

  async start(): Promise<void> {
    const { game, root } = this.ctx;
    const hud = getHud();
    root.classList.add("mc-tut-lock");
    installStyle();
    hud?.tools.setTutorialLock([]);
    hud?.hud.setButtonsEnabled(false);
    this.ctx.audio.setMusic("Tutorail_Music");
    // Profile.as:1188-1194: while !smTutorialEnd the profile load sets newToolRev = RulesFacade.newToolRev() (settings.xml: 3) and persists it.
    const raw = game.state.profile.raw as Record<string, string>;
    if (Number(raw.newToolRev ?? 0) < NEW_TOOL_REV) {
      raw.newToolRev = String(NEW_TOOL_REV);
      game.sendCommand(game.commands.newToolRev(NEW_TOOL_REV));
    }
    this.genre = Number(game.state.profile.raw.bossGenre ?? 0) === 1 ? 1 : 0;
    const fresh = this.machine.step === STEP.WELCOME;
    if (fresh) {
      this.genre = await runIntro(root);
      (game.state.profile.raw as Record<string, string>).bossGenre = String(this.genre);
      game.sendCommand(game.commands.bossGenre(this.genre));
      hud?.tools.setBossGenre(this.genre);
    }
    this.popup = await TutorialPopup.create(this.genre, () => this.machine.ok());
    this.popup.hide();
    root.append(this.popup.el, this.arrows.el);
    this.watchGame();
    this.machine.on((s) => this.onSnapshot(s));
    this.arrows.start(() => this.overlay());
    await new Promise((r) => setTimeout(r, fresh ? LAUNCH_DELAY_MS : 300));
    if (fresh) game.sendCommand(game.commands.nextRent(-1)); // oracle: update_next_rent -1 when the welcome popup opens
    this.machine.start();
  }

  // ---- game -> machine ---------------------------------------------------------------------------------------------------

  private watchGame(): void {
    const { game } = this.ctx;
    const m = this.machine;
    for (const it of game.items()) this.prev.set(it.sid, { stateId: it.stateId, mode: it.mode });
    game.on("item-added", (it) => {
      this.prev.set(it.sid, { stateId: it.stateId, mode: it.mode });
      if (it.sku === HQ_SKU) {
        game.tutorialRivalWait();
        m.notify({ type: "hqPlaced" });
      }
      else if (it.sku === HOUSE_SKU && it.tileX === m.houseTile.x && it.tileY === m.houseTile.y) m.notify({ type: "housePlaced", sid: it.sid });
      else if (it.sku === DECORATION_SKU && it.tileX === m.decorationTile.x && it.tileY === m.decorationTile.y) m.notify({ type: "decorationPlaced" });
    });
    game.on("map", ({ kind }) => {
      if (kind === "terrain") for (const t of m.terrainTiles) if (game.world.tile(t.x, t.y)?.terrain) m.notify({ type: "terrainBought", x: t.x, y: t.y });
      if (kind === "road") for (const t of m.roadTiles) if (game.world.tile(t.x, t.y)?.road) m.notify({ type: "roadBuilt", x: t.x, y: t.y });
    });
    game.on("item-changed", (it) => {
      const old = this.prev.get(it.sid);
      this.prev.set(it.sid, { stateId: it.stateId, mode: it.mode });
      if (!old || it.sku !== HOUSE_SKU) return;
      if (old.stateId === STATE_ID.CONSTRUCTION && it.stateId === STATE_ID.RENT) m.notify({ type: "constructionDone" });
      if (old.mode === RENT_MODE.WAITING_FOR_CONTRACT && it.mode === RENT_MODE.RENTING) m.notify({ type: "contractSigned" });
      if (old.mode === RENT_MODE.GET_RENT && it.mode !== RENT_MODE.GET_RENT) m.notify({ type: "rentCollected" });
    });
    // Tutorial.activeOkButton: back to the select tool once the forced action is done.
    game.on("tool", () => undefined);
  }

  private house(): GameItem | undefined {
    return this.ctx.game.itemAtTile(this.machine.houseTile.x, this.machine.houseTile.y);
  }

  // ---- machine -> UI -----------------------------------------------------------------------------------------------------

  private onSnapshot(s: TutorialSnapshot): void {
    const { game } = this.ctx;
    const m = this.machine;
    const hud = getHud();
    if (m.ended) {
      void this.finish();
      return;
    }
    const names: Record<string, string> = { terrain: "terrain", build: "build", road: "road" };
    hud?.tools.setTutorialLock(s.buttons.map((b) => names[b]));
    if (s.step !== this.lastStep) {
      this.lastStep = s.step;
      const c = STEP_CONTENT[s.step];
      let body = getText(c.body);
      if (s.step === STEP.WELCOME) body = t(c.body, [getText(this.genre === 1 ? "TID_CINDY_NAME" : "TID_RONALD_NAME")]);
      this.popup.show(getText(c.title), body, s.step, m.showStepCounter, c.button ? getText(c.button) : undefined);
      const forced = m.forcedTool();
      if (forced) game.setTool({ kind: "build", sku: forced.sku });
      if (s.step === STEP.END) startNoteRain(); // Tutorial.onStep10: mRain/mRain2.start
      if (s.step === STEP.INSTANT_BUILD && m.houseSid) game.tutorialShaveConstruction(m.houseSid);
      if (s.step === STEP.COLLECT_RENT) {
        const h = this.house();
        if (h) game.forceRentReady(h.sid);
        game.sendCommand(game.commands.nextRent(0)); // oracle: update_next_rent 0 right after the forced GET_RENT
      }
    }
    this.popup.setOkEnabled(s.okEnabled);
    if (s.okEnabled && s.step === STEP.BUILD_ROAD && m.houseSid) game.resumeTutorialConstruction(m.houseSid);
    if (s.okEnabled && s.step !== STEP.WELCOME) {
      game.setTool({ kind: "select" });
      this.popup.playAnim();
    }
  }

  /** onStep11: persist the end (Profile.tutorialCompleted), then reload so every area starts in its normal post-tutorial state. */
  private async finish(): Promise<void> {
    const { game } = this.ctx;
    this.popup.hide();
    stopNoteRain(); // onStep11
    this.arrows.stop();
    game.sendCommand(game.commands.tutorialCompleted()); // Tutorial.onStep11: popup, then smTutorialEnd + Profile.tutorialCompleted()
    await showInviteNeighbors(this.genre);
    game.sendCommand(game.commands.firstMission(1)); // onStep12 (after the invite popup): Profile.firstMission = true
    try {
      sessionStorage.setItem(JUST_ENDED_KEY, "1");
    } catch {
      /* ignore */
    }
    await game.flush();
    location.reload();
  }

  // ---- arrows / highlights -------------------------------------------------------------------------------------------------

  private overlay(): Overlay {
    const { city, game } = this.ctx;
    const m = this.machine;
    const out: Overlay = { arrows: [], boxes: [] };
    if (!m.active || m.okEnabled || !this.popup) return out;
    const k = city.world.scale.x;
    const sx = (tx: number): number => city.world.x + tx * TILE * k;
    const sy = (ty: number): number => city.world.y + ty * TILE * k;
    const tileArrow = (tx: number, ty: number, w = 1): void => void out.arrows.push({ x: sx(tx + w / 2), y: sy(ty) });
    const box = (tx: number, ty: number, w = 1, h = 1, grid = false): void =>
      void out.boxes.push({ x: sx(tx), y: sy(ty), w: w * TILE * k, h: h * TILE * k, ...(grid ? { grid: { cell: TILE * k } } : {}) });
    // Toolbar arrows (Tutorial.addToolbarArrow(getXButtonPoint)) land on the button centre; shop/contract arrows on the card top.
    const rectArrow = (r?: DOMRect, centre = false): void => {
      if (r && r.width > 0) out.arrows.push({ x: r.left + r.width / 2, y: centre ? r.top + r.height / 2 - 4 : r.top });
    };
    const hud = getHud();
    const shop = getShop()?.shop;
    const shopOpen = shop?.isOpen === true;
    const tool = game.tool;
    const house = m.houseTile;
    switch (m.step) {
      case STEP.HQ:
        tileArrow(m.hq.x, m.hq.y, 4);
        // Map.setBuildGrid: white tile outlines over the HQ plots and the two plots bought in step 2 (oracle d_step1).
        box(m.hq.x, m.hq.y, 4, 3, true);
        m.terrainTiles.forEach((t) => box(t.x, t.y, 1, 1, true));
        break;
      case STEP.PLOTS:
        if (tool.kind !== "terrain") rectArrow(hud?.tools.buttonRect("terrain"), true);
        else {
          const left = m.terrainTiles.filter((t) => !game.world.tile(t.x, t.y)?.terrain);
          if (left[0]) tileArrow(left[0].x, left[0].y);
          left.forEach((t) => box(t.x, t.y));
        }
        break;
      case STEP.BUILD_HOUSE:
        if (tool.kind === "build") {
          tileArrow(house.x, house.y, 2);
          box(house.x, house.y, 2, 2);
        } else if (shopOpen) rectArrow(shop?.targetRect("buy", HOUSE_SKU));
        else rectArrow(hud?.tools.buttonRect("build"), true);
        break;
      case STEP.BUILD_ROAD:
        if (tool.kind !== "road") rectArrow(hud?.tools.buttonRect("road"), true);
        else {
          const left = m.roadTiles.filter((t) => !game.world.tile(t.x, t.y)?.road);
          if (left[0]) tileArrow(left[0].x, left[0].y);
          left.forEach((t) => box(t.x, t.y));
        }
        break;
      case STEP.INSTANT_BUILD:
      case STEP.COLLECT_RENT:
        out.arrows.push({ x: sx(house.x + 1), y: sy(house.y) });
        break;
      case STEP.SIGN_CONTRACT: {
        const c = document.querySelector<HTMLElement>('[data-contract-index="0"]');
        if (c) rectArrow(c.getBoundingClientRect());
        else out.arrows.push({ x: sx(house.x + 1), y: sy(house.y) - 24 * k });
        break;
      }
      case STEP.BUILD_DECORATION:
        if (tool.kind === "build") {
          tileArrow(m.decorationTile.x, m.decorationTile.y);
          box(m.decorationTile.x, m.decorationTile.y);
        } else if (shopOpen) {
          if (shop?.selectedTab === 2) rectArrow(shop.targetRect("buy", DECORATION_SKU));
          else rectArrow(shop?.targetRect("tab", 2));
        } else rectArrow(hud?.tools.buttonRect("build"), true);
        break;
    }
    return out;
  }
}

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  // Friends bar, options panel and the HUD counters ignore the mouse during the tutorial (Tutorial.disableButtons).
  s.textContent = ".mc-tut-lock .mc-actions{display:none!important}.mc-tut-lock .mc-friends *,.mc-tut-lock .mc-options *,.mc-tut-lock .mc-hud *{pointer-events:none!important}";
  document.head.appendChild(s);
}
