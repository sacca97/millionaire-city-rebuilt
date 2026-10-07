// First-session tutorial state machine (pure: no DOM, no network). Port of dollars/model/Tutorial.as; the UI half lives in
// ui/tutorial/. Citations are decompiled/scripts/com/dchoc/dollars/... paths.
//
// The original keeps `Tutorial.smTutorialStep` (a static counter incremented at the start of each `onStepN`) and lets every
// class poll `smTutorialEnd/smTutorialStep` to restrict itself. Here the machine owns the step and exposes the same
// restrictions as queries (`allowTool`, `checkBuild`, `checkTerrain`, `checkRoad`, `allowTile`, `shopTabAllowed`, ...) that
// Game and the UI areas consult through `game.tutorial`.
import { MAP_COLS, MAP_ROWS } from "./geometry";

/** Tutorial.TUTORIAL_BUILD_HOUSE_TIME (Tutorial.as): the first rent/construction countdown shown during the tutorial. */
export const TUTORIAL_BUILD_HOUSE_TIME = 5000;

/** Step constants (Tutorial.as:83-99). `smTutorialStep` is incremented at the start of every onStepN. */
export const STEP = {
  WELCOME: 0,
  HQ: 1,
  PLOTS: 2,
  BUILD_HOUSE: 3,
  BUILD_ROAD: 4,
  INSTANT_BUILD: 5,
  SIGN_CONTRACT: 6,
  BUILD_DECORATION: 7,
  COLLECT_RENT: 8,
  /** onStep10: final popup (TID_TUTORIAL_END). */
  END: 9,
  /** onStep11 done: smTutorialEnd = true. */
  DONE: 10
} as const;
export type StepId = (typeof STEP)[keyof typeof STEP];

/** TutorialHQPositions.xml (assets/recreations/TutorialHQPositions.xml), save-relative tiles. */
export const TUTORIAL_POSITIONS = {
  hq: { x: -1, y: -3 },
  addTerrain: [
    { x: 5, y: 2 },
    { x: 5, y: 3 }
  ],
  addRoad: [
    { x: 3, y: 4 },
    { x: 4, y: 4 }
  ],
  addDecoration: { x: 4, y: 1 },
  /** The 2x2 plot the Bungalow goes on (apps/server TUTORIAL_COMPLETED_HOUSE_TILE). */
  house: { x: 4, y: 2 }
} as const;

export interface Tile {
  x: number;
  y: number;
}

/** Save-relative -> absolute tile (Map.getTileRelativeXToTile). */
const abs = (t: Tile): Tile => ({ x: t.x + MAP_COLS / 2, y: t.y + MAP_ROWS / 2 });

export const HQ_SKU = "HeadQuarter";
export const HOUSE_SKU = "houses_001_001";
/** First decoration of the shop tab (ItemContentUnlocked.as:99: `mId == 0 && type == decorations`): the Cypress Tree. */
export const DECORATION_SKU = "decorations_tree_01";

/** Toolbar buttons the tutorial enables one at a time (Tutorial.as showStep3/onStep3/onStep4/onStep7). */
export type TutorialButton = "terrain" | "build" | "road";

export type TutorialTool = { kind: string; sku?: string };

export interface StepContent {
  /** TextIDs (TID names): title and body of the PopupTutorial. */
  title: string;
  body: string;
  /** Button label override (PopupTutorial.changeButtonText(TID_BUTTON_DONE)). */
  button?: string;
}

/** Popup texts per step (Tutorial.as onStep1..onStep10, welcomeTutorial, showStep2/3). */
export const STEP_CONTENT: Record<number, StepContent> = {
  [STEP.WELCOME]: { title: "TID_TUTORIAL_TITLE_1", body: "TID_TUTORIAL_1" },
  [STEP.HQ]: { title: "TID_TUTORIAL_TITLE_2", body: "TID_TUTORIAL_2" },
  [STEP.PLOTS]: { title: "TID_TUTORIAL_TITLE_3", body: "TID_TUTORIAL_3" },
  [STEP.BUILD_HOUSE]: { title: "TID_TUTORIAL_TITLE_4", body: "TID_TUTORIAL_4" },
  [STEP.BUILD_ROAD]: { title: "TID_TUTORIAL_TITLE_5", body: "TID_TUTORIAL_5" },
  [STEP.INSTANT_BUILD]: { title: "TID_TUTORIAL_TITLE_6", body: "TID_TUTORIAL_6" },
  [STEP.SIGN_CONTRACT]: { title: "TID_TUTORIAL_TITLE_7", body: "TID_TUTORIAL_7" },
  [STEP.BUILD_DECORATION]: { title: "TID_TUTORIAL_TITLE_8", body: "TID_TUTORIAL_8" },
  [STEP.COLLECT_RENT]: { title: "TID_TUTORIAL_TITLE_9", body: "TID_TUTORIAL_9", button: "TID_BUTTON_DONE" },
  [STEP.END]: { title: "TID_POPUP_LEVEL_TITLE", body: "TID_TUTORIAL_END", button: "TID_BUTTON_DONE" }
};

/** What the player does to finish each forced step. Steps without an entry (0, 9) finish with the OK button only. */
export type TutorialEvent =
  | { type: "hqPlaced" }
  | { type: "terrainBought"; x: number; y: number }
  | { type: "housePlaced"; sid: string }
  | { type: "roadBuilt"; x: number; y: number }
  | { type: "constructionDone" }
  | { type: "contractSigned" }
  | { type: "decorationPlaced" }
  | { type: "rentCollected" };

export interface TutorialSnapshot {
  step: number;
  okEnabled: boolean;
  mapEnabled: boolean;
  buttons: TutorialButton[];
}

type Listener = (s: TutorialSnapshot) => void;

export interface Check {
  ok: boolean;
  reason?: string;
}

/** Tile -> key for the sets. */
const key = (t: Tile): string => `${t.x}:${t.y}`;

export class TutorialMachine {
  /** Tutorial.smTutorialStep. */
  step: number = STEP.WELCOME;
  /** PopupTutorial OK button (disabled until Tutorial.activeOkButton). */
  okEnabled = true;
  /** smTutorialEnd. */
  ended = false;
  /** sid of the Bungalow built in step 3 (Tutorial.smItemBuildByTheUser). */
  houseSid: string | undefined;
  private started = false;
  private terrainDone = new Set<string>();
  private roadDone = new Set<string>();
  private listeners = new Set<Listener>();

  readonly hq = abs(TUTORIAL_POSITIONS.hq);
  readonly terrainTiles = TUTORIAL_POSITIONS.addTerrain.map(abs);
  readonly roadTiles = TUTORIAL_POSITIONS.addRoad.map(abs);
  readonly decorationTile = abs(TUTORIAL_POSITIONS.addDecoration);
  readonly houseTile = abs(TUTORIAL_POSITIONS.house);

  /** `resumeStep`: where to continue after a reload in the middle of the tutorial (see inferResumeStep). */
  constructor(resumeStep: number = STEP.WELCOME) {
    this.step = resumeStep;
  }

  get active(): boolean {
    return !this.ended;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.snapshot();
    for (const fn of [...this.listeners]) fn(s);
  }

  snapshot(): TutorialSnapshot {
    return { step: this.step, okEnabled: this.okEnabled, mapEnabled: this.mapEnabled, buttons: this.enabledButtons() };
  }

  // ---- flow ------------------------------------------------------------------------------------------------------------

  /** Shows the popup of the current step (welcomeTutorial / showStepN). OK starts enabled only on the welcome and final steps. */
  start(): void {
    this.started = true;
    this.enterStep(this.step);
  }

  /** Popup OK button (EVENT_ACCEPT -> onStepN). No-op while the forced action is pending. */
  ok(): void {
    if (!this.started || this.ended || !this.okEnabled) return;
    if (this.step === STEP.END) {
      this.ended = true;
      this.step = STEP.DONE;
      this.okEnabled = false;
      this.emit();
      return;
    }
    this.enterStep(this.step + 1);
  }

  private enterStep(step: number): void {
    this.step = step;
    this.okEnabled = step === STEP.WELCOME || step === STEP.END;
    this.terrainDone.clear();
    this.roadDone.clear();
    this.emit();
  }

  /** Tutorial.activeOkButton: the forced action is done; wait for OK (map disabled, tool back to select). */
  private complete(): void {
    this.okEnabled = true;
    this.emit();
  }

  /** The forced action of the current step happened. Events for other steps are ignored. */
  notify(ev: TutorialEvent): void {
    if (!this.started || this.ended || this.okEnabled) return;
    switch (ev.type) {
      case "hqPlaced":
        if (this.step === STEP.HQ) this.complete();
        break;
      case "terrainBought":
        if (this.step === STEP.PLOTS && this.terrainTiles.some((t) => t.x === ev.x && t.y === ev.y)) {
          this.terrainDone.add(key(ev));
          if (this.terrainDone.size >= this.terrainTiles.length) this.complete();
          else this.emit();
        }
        break;
      case "housePlaced":
        if (this.step === STEP.BUILD_HOUSE) {
          this.houseSid = ev.sid;
          this.complete();
        }
        break;
      case "roadBuilt":
        if (this.step === STEP.BUILD_ROAD && this.roadTiles.some((t) => t.x === ev.x && t.y === ev.y)) {
          this.roadDone.add(key(ev));
          if (this.roadDone.size >= this.roadTiles.length) this.complete();
          else this.emit();
        }
        break;
      case "constructionDone":
        if (this.step === STEP.INSTANT_BUILD) this.complete();
        break;
      case "contractSigned":
        if (this.step === STEP.SIGN_CONTRACT) this.complete();
        break;
      case "decorationPlaced":
        if (this.step === STEP.BUILD_DECORATION) this.complete();
        break;
      case "rentCollected":
        if (this.step === STEP.COLLECT_RENT) this.complete();
        break;
    }
  }

  // ---- restrictions (queried by Game / ui areas) ----------------------------------------------------------------------

  /** True while a forced action is pending and the map accepts clicks (smMap.enable/disable). */
  get mapEnabled(): boolean {
    return this.active && this.started && !this.okEnabled && this.step >= STEP.HQ && this.step <= STEP.COLLECT_RENT;
  }

  /** Toolbar buttons enabled in the current step (everything else is disabled: Tutorial.disableButtons). */
  enabledButtons(): TutorialButton[] {
    if (!this.active || this.okEnabled) return [];
    switch (this.step) {
      case STEP.PLOTS:
        return ["terrain"];
      case STEP.BUILD_HOUSE:
      case STEP.BUILD_DECORATION:
        return ["build"];
      case STEP.BUILD_ROAD:
        return ["road"];
      default:
        return [];
    }
  }

  /** The tool the step wants armed right after its popup is shown (Tutorial.setHQTerrains: toolsBar.setToolBuild(HQ)). */
  forcedTool(): { kind: string; sku?: string } | undefined {
    return this.step === STEP.HQ && !this.okEnabled ? { kind: "build", sku: HQ_SKU } : undefined;
  }

  /** setTool gate: the select tool is always allowed; other tools only for the step that needs them. */
  allowTool(tool: TutorialTool): boolean {
    if (!this.active || tool.kind === "select") return true;
    if (!this.started || this.okEnabled) return false;
    switch (this.step) {
      case STEP.HQ:
        return tool.kind === "build" && tool.sku === HQ_SKU;
      case STEP.PLOTS:
        return tool.kind === "terrain";
      case STEP.BUILD_HOUSE:
        return tool.kind === "build" && tool.sku === HOUSE_SKU;
      case STEP.BUILD_ROAD:
        return tool.kind === "road";
      case STEP.BUILD_DECORATION:
        return tool.kind === "build" && tool.sku === DECORATION_SKU;
      default:
        return false;
    }
  }

  private same(t: Tile, tx: number, ty: number): boolean {
    return t.x === tx && t.y === ty;
  }

  /**
   * ToolBuild gate: HQ only on the arrowed tiles (Tutorial.setHQTerrains), the Bungalow on the 2x2 plot (first placement is
   * forced here: the original only had that one valid plot), the decoration only on `smAddDecorationTile` (ToolBuild.as:85-91).
   * Returns null when the tutorial has no opinion.
   */
  checkBuild(sku: string, tx: number, ty: number): Check | null {
    if (!this.active) return null;
    if (!this.mapEnabled) return { ok: false, reason: "Not now" };
    switch (this.step) {
      case STEP.HQ:
        return sku === HQ_SKU && this.same(this.hq, tx, ty) ? { ok: true } : { ok: false, reason: "Place the Headquarters on the marked tiles" };
      case STEP.BUILD_HOUSE:
        return sku === HOUSE_SKU && this.same(this.houseTile, tx, ty) ? { ok: true } : { ok: false, reason: "Place the Bungalow on the marked plot" };
      case STEP.BUILD_DECORATION:
        return sku === DECORATION_SKU && this.same(this.decorationTile, tx, ty) ? { ok: true } : { ok: false, reason: "Place the tree on the marked tile" };
      default:
        return { ok: false, reason: "Not now" };
    }
  }

  /** Forced placements: a build ghost within 2 tiles of the step's target tile snaps onto it (UX aid; the original had one valid spot). */
  snapBuild(sku: string, tx: number, ty: number): Tile {
    if (!this.mapEnabled) return { x: tx, y: ty };
    let target: Tile | undefined;
    if (this.step === STEP.HQ && sku === HQ_SKU) target = this.hq;
    else if (this.step === STEP.BUILD_HOUSE && sku === HOUSE_SKU) target = this.houseTile;
    else if (this.step === STEP.BUILD_DECORATION && sku === DECORATION_SKU) target = this.decorationTile;
    return target && Math.abs(target.x - tx) <= 2 && Math.abs(target.y - ty) <= 2 ? target : { x: tx, y: ty };
  }

  /** Map.as:3230-3238: during step 2 only the arrowed plot tiles can be bought. */
  checkTerrain(tx: number, ty: number): Check | null {
    if (!this.active) return null;
    if (!this.mapEnabled || this.step !== STEP.PLOTS) return { ok: false, reason: "Not now" };
    return this.terrainTiles.some((t) => this.same(t, tx, ty) && !this.terrainDone.has(key(t))) ? { ok: true } : { ok: false, reason: "Buy the 2 marked plots" };
  }

  /** ToolSetTile.as:39-45 / Map.as:2276: during step 4 only the two missing road pieces. */
  checkRoad(tx: number, ty: number): Check | null {
    if (!this.active) return null;
    if (!this.mapEnabled || this.step !== STEP.BUILD_ROAD) return { ok: false, reason: "Not now" };
    return this.roadTiles.some((t) => this.same(t, tx, ty) && !this.roadDone.has(key(t))) ? { ok: true } : { ok: false, reason: "Build the 2 marked road pieces" };
  }

  /** Select-tool clicks: only the Bungalow reacts in steps 5/6/8 (StateOnRent.doDoIsMouseOverEnabled, :1062-1069). */
  allowTile(tx: number, ty: number): boolean {
    if (!this.active) return true;
    if (!this.mapEnabled) return false;
    if (this.step !== STEP.INSTANT_BUILD && this.step !== STEP.SIGN_CONTRACT && this.step !== STEP.COLLECT_RENT) return false;
    const h = this.houseTile;
    return tx >= h.x && tx < h.x + 2 && ty >= h.y && ty < h.y + 2;
  }

  /** Any other map interaction (move/destroy/pointer clicks of the active tool) is blocked while the map is disabled. */
  allowMapClick(): boolean {
    return !this.active || this.mapEnabled;
  }

  // ---- timers / economy overrides --------------------------------------------------------------------------------------

  /** StateOnConstruction.as:254 / StateOnConstructionOwner.as:56: construction and rent timers wait for smTutorialEnd. */
  get timersFrozen(): boolean {
    return this.active;
  }

  /** Step 3: the Bungalow is placed away from the roads; its construction (XP, RESUME) starts when step 4's roads are done (Company.as:751). */
  get holdConstructionStart(): boolean {
    return this.active && this.step === STEP.BUILD_HOUSE;
  }

  /** StateOnRent.incomeInit: the first contract during the tutorial lasts TUTORIAL_BUILD_HOUSE_TIME. */
  incomeTimeMs(real: number): number {
    return this.active ? TUTORIAL_BUILD_HOUSE_TIME : real;
  }

  /** PollManager.registerEvent only runs after smTutorialEnd (PollManager.as:115). */
  get pollsEnabled(): boolean {
    return !this.active;
  }

  // ---- shop / contract box ---------------------------------------------------------------------------------------------

  /** BuyBox tabs: Houses always; Decorations in the decoration step (BuyBox.as:458, 960). Indexes: Houses 0, Decorations 2. */
  shopTabAllowed(tab: number): boolean {
    if (!this.active) return true;
    return tab === 0 || (this.step === STEP.BUILD_DECORATION && tab === 2);
  }

  /** ItemContentUnlocked.start (:96-103): only the Bungalow (step 3) / the first decoration (step 7) can be bought. */
  shopBuyAllowed(sku: string): boolean {
    if (!this.active) return true;
    return (this.step === STEP.BUILD_HOUSE && sku === HOUSE_SKU) || (this.step === STEP.BUILD_DECORATION && sku === DECORATION_SKU);
  }

  /** BuyBox.show / ContractBox.show: the close buttons are disabled for the whole tutorial. */
  get closeButtonsEnabled(): boolean {
    return !this.active;
  }

  /** ContractItem.as:215-221: only the first contract of the box can be chosen. */
  contractAllowed(index: number): boolean {
    return !this.active || index === 0;
  }

  /** Popup step counter "Step n / 8" (PopupTutorial.showPopUp: hidden for step 0 and >= TUTORIAL_STEP_COUNT). */
  get showStepCounter(): boolean {
    return this.step > 0 && this.step < STEP.END;
  }
}

/** Minimal view of the loaded save used to continue an interrupted tutorial (no equivalent in the original). */
export interface ResumeFacts {
  hasHq: boolean;
  /** both addTerrain tiles owned */
  plotsBought: boolean;
  /** the Bungalow at the forced plot: undefined when not built */
  house?: { construction: boolean; waitingContract: boolean; renting: boolean };
  /** both addRoad tiles built */
  roadsBuilt: boolean;
  decorationPlaced: boolean;
}

/** Which step to continue from when the page was reloaded before `tutorialEnd`. A fresh save returns WELCOME. */
export function inferResumeStep(f: ResumeFacts): number {
  if (!f.hasHq) return STEP.WELCOME;
  if (!f.plotsBought) return STEP.PLOTS;
  if (!f.house) return STEP.BUILD_HOUSE;
  if (!f.roadsBuilt) return STEP.BUILD_ROAD;
  if (f.house.construction) return STEP.INSTANT_BUILD;
  if (f.house.waitingContract && !f.decorationPlaced) return STEP.SIGN_CONTRACT;
  if (!f.decorationPlaced) return STEP.BUILD_DECORATION;
  if (f.house.renting) return STEP.COLLECT_RENT;
  return STEP.END;
}
