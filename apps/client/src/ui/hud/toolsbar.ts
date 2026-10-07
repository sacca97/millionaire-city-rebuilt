/**
 * Tools bar, port of GUI/ToolsBar.as (+ MultifunctionBar / VaultBar) on hud.swf class `tool_panel`.
 * Button order SELECT, BUILD, DEMOLITION, ROAD, BUY_TERRAIN, VAULT, BOSS, HOME, INVEST, MULTI_FUNCTION (ToolsBar.as:83-107).
 * Selected/disabled states: DynamicButton.setSelected -> SelectState, disabled -> grayscale + no clicks.
 */
import { Button } from "../../gui/button";
import { getText, t } from "../../gui/i18n";
import { Widget, type Part } from "../../gui/widget";
import type { ToolState } from "../../game/tools";
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { FrameClip } from "./util";

/** settings.xml: investmentsUnlockLevel=1, collectibleUnlockLevel=6, sideTabsUnlockLevel=5. */
export const INVESTMENTS_UNLOCK_LEVEL = 1;
export const COLLECTIBLE_UNLOCK_LEVEL = 6;
export const SIDE_TABS_UNLOCK_LEVEL = 5;

/** Local (UI-only) multifunction tools; the game core knows none of them. */
export type MultiTool = "move" | "collector" | "contract";

export type BossAlert = "none" | "newMission" | "missionReached";

const HIDDEN = ["GohomeButton", "PartnerButton", "UpgradeButton", "SuperupgradeButton", "selectvideo", "alert_ok", "alert", "click_alert", "click_alert_ok", "BossButton_01", "BossButton_02"];

/** ToolsBar.toolBarSetTool: which toolbar button is "selected" for a game tool. */
export function buttonForTool(tool: ToolState): "select" | "road" | "demolition" | "terrain" | null {
  switch (tool.kind) {
    case "select":
      return "select";
    case "road":
      return "road";
    case "destroy":
      return "demolition";
    case "terrain":
      return "terrain";
    default:
      return null; // build/move: item attached to the cursor, no button stays pressed
  }
}

/** settings.xml newItemsRev. */
const NEW_ITEMS_REV = 1;

export class ToolsBar {
  readonly el: HTMLElement;
  private panel!: Widget;
  private multiBar!: Widget;
  private vaultBar!: Widget;
  private collectBtn?: Button;
  private b: Record<string, Button> = {};
  private multiBtns: Record<MultiTool, Button> = {} as never;
  private multiActive: MultiTool | null = null;
  private vaultOpen = false;
  private multiOpen = false;
  private bossAlert: Record<string, FrameClip> = {};
  private genre = 1;
  /** Tutorial lock (Tutorial.disableButtons / enableButton): when set only these buttons are enabled. */
  private tutorialAllowed: Set<string> | null = null;

  private constructor(private readonly ctx: UiContext) {
    this.el = document.createElement("div");
    this.el.className = "mc-toolsbar";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
  }

  static async create(ctx: UiContext): Promise<ToolsBar> {
    const tb = new ToolsBar(ctx);
    await tb.build();
    return tb;
  }

  get multiTool(): MultiTool | null {
    return this.multiActive;
  }

  private async build(): Promise<void> {
    const { game } = this.ctx;
    const [panel, multi, vault] = await Promise.all([
      Widget.create("hud", "tool_panel"),
      Widget.create("hud", "button_multifuncion"),
      Widget.create("hud", "button_multifuncion_storage"),
    ]);
    this.panel = panel;
    this.multiBar = multi;
    this.vaultBar = vault;
    for (const n of HIDDEN) for (const p of panel.partsNamed(n)) p.hide();
    // Boss/advisor button: BossButton_0<genre+1> (ToolsBar.setBossButton), boss_genre from the profile.
    const genre = Number(game.state.profile.raw.bossGenre ?? 0) === 1 ? 2 : 1;
    // ToolsBar.as:320/936: `mBossButton.visible = false` always - the advisor lives in the left mission-icon column (ui/missions/iconlayer.ts).
    this.genre = genre;
    // ToolsBar adds the multifunction/vault bars into mToolBar (same coordinate space as the panel).
    this.el.append(multi.root, vault.root, panel.root);
    multi.root.style.display = "none";
    vault.root.style.display = "none";

    const mk = (name: string, tip: string, fn: () => void, w: Widget = panel): Button => {
      const btn = new Button(w.part(name));
      if (tip) btn.setTip(tip);
      btn.onClick(fn);
      return btn;
    };
    this.b.select = mk("SelectButton", getText("TID_HINT_MENU_BUTTON_SELECTOR"), () => game.setTool({ kind: "select" }));
    this.b.build = mk("BuildButton", getText("TID_HINT_MENU_BUTTON_HOUSES"), () => {
      game.setTool({ kind: "select" });
      uiBus.emit("openShop", {});
      // ToolsBar.as:629-634: first shop opening with an unseen items revision -> Profile.newItemsRevDone (settings.xml newItemsRev=1).
      const raw = game.state.profile.raw as Record<string, string>;
      if (Number(raw.newItemsRev ?? 0) < NEW_ITEMS_REV) {
        raw.newItemsRev = String(NEW_ITEMS_REV);
        game.sendCommand(game.commands.newItemsRevDone());
      }
    });
    this.b.demolition = mk("DemolitionButton", getText("TID_HINT_MENU_BUTTON_DEMOLISH"), () => game.setTool({ kind: "destroy" }));
    this.b.road = mk("RoadButton", getText("TID_HINT_MENU_BUTTON_ROAD"), () => game.setTool({ kind: "road" }));
    this.b.road.setLabel(getText("TID_GEN_FREE"));
    this.b.terrain = mk("BuyButton", "", () => game.setTool({ kind: "terrain" }));
    this.b.vault = mk("VaultButton", getText("TID_COLLECTIBLES_SHOP_BUTTON02"), () => this.toggleVault());
    this.b.boss = mk(`BossButton_0${genre}`, getText("TID_HINT_MENU_BUTTON_MISSIONS"), () => uiBus.emit("openMissions"));
    // The other advisor's button exists too so the tutorial's boss selection can swap it in (setBossGenre).
    this.b.boss2 = mk(`BossButton_0${genre === 1 ? 2 : 1}`, getText("TID_HINT_MENU_BUTTON_MISSIONS"), () => uiBus.emit("openMissions"));
    this.b.invest = mk("InvestButton", "", () => uiBus.emit("openInvest"));
    this.b.multi = mk("SpecialButton", getText("TID_HINT_BUTTION_MULTIFUNCTION"), () => this.toggleMulti());

    // Boss alert (blinking marker) is driven by setBossAlert(); hidden until then.
    for (const n of ["alert", "alert_ok"]) {
      const p = panel.find(n);
      if (p) this.bossAlert[n] = new FrameClip("hud", p);
    }

    // MultifunctionBar: move / money collector / contract signator.
    this.multiBtns = {
      move: mk("move", getText("TID_HINT_BUTTON_MOVE"), () => this.setMulti("move"), multi),
      collector: mk("collector", getText("TID_HINT_BUTTON_COLLECT"), () => this.setMulti("collector"), multi),
      contract: mk("contract", getText("TID_HINT_BUTTON_MULTICONTRACT"), () => this.setMulti("contract"), multi),
    };
    // VaultBar: storage + collectibles (the popups area subscribes).
    mk("storage", "", () => uiBus.emit("openStorage"), vault);
    this.collectBtn = mk("collectibles", getText("TID_HINT_MENU_BUTTON_GIFT"), () => uiBus.emit("openCollectibles"), vault);

    game.on("tool", (tool) => this.syncTool(tool));
    game.on("profile", () => this.syncLevel());
    this.syncTool(game.tool);
    this.syncLevel();
    this.layout();
  }

  /**
   * ToolsBar.setToolbarConfig(true) (:896-945) for RoleVisitor: owner tools hidden; the Home button (GohomeButton -> visitUniverse(owner))
   * and the upgrades counter (UpgradeButton, label = upgrades left, hidden at 0 :739-747) are shown.
   */
  setVisitor(on: boolean, upgradesLeft = 0, onHome?: () => void): void {
    if (on) this.hideMulti();
    this.visitorMode = on;
    const owner = ["SelectButton", "BuildButton", "DemolitionButton", "RoadButton", "BuyButton", "VaultButton", "InvestButton", "SpecialButton", "BossButton_01", "BossButton_02"];
    for (const n of owner) for (const p of this.panel.partsNamed(n)) p.setVisible(!on && !(n.startsWith("BossButton")));
    if (on) {
      this.hideVault();
      if (!this.homeBtn) {
        this.homeBtn = new Button(this.panel.part("GohomeButton"));
        this.homeBtn.setTip(getText("TID_HINT_MENU_BUTTON_HOME"));
        this.upgradesBtn = new Button(this.panel.part("UpgradeButton"));
        this.upgradesBtn.setTip(getText("TID_HINT_MENU_BUTTON_UPGRADES"));
      }
      this.homeBtn.onClick(() => this.homeHandler?.());
    }
    this.homeHandler = onHome;
    for (const p of this.panel.partsNamed("GohomeButton")) p.setVisible(on);
    this.setUpgrades(upgradesLeft);
  }
  private visitorMode = false;
  private homeHandler?: () => void;
  private homeBtn?: Button;
  private upgradesBtn?: Button;

  /** ToolsBar.setUpgrades: label + visibility of the visitor's upgrade counter. */
  setUpgrades(n: number): void {
    for (const p of this.panel.partsNamed("UpgradeButton")) p.setVisible(this.visitorMode && n > 0);
    if (this.visitorMode && n > 0) this.upgradesBtn?.setLabel(String(n));
  }

  /** ToolsBar.toolBarSetTool selected-state handling. */
  private syncTool(tool: ToolState): void {
    if (tool.kind !== "select") this.clearMulti(false);
    const which = this.multiActive ? null : buttonForTool(tool);
    for (const k of ["select", "demolition", "road", "terrain"]) this.b[k].setSelected(k === which);
    // Oracle (build tool active with a ghost): the build button shows its selected ring, select does not
    this.b.build.setSelected(!this.multiActive && tool.kind === "build");
    uiBus.emit("toolChanged", { tool: this.multiActive ?? tool.kind });
  }

  /** BuyButton tip (TID_HINT_MENU_BUTTON_TERRAIN with the level terrain price) + unlock gating. */
  private syncLevel(): void {
    const { game } = this.ctx;
    this.b.terrain.setTip(t("TID_HINT_MENU_BUTTON_TERRAIN", [String(game.terrainPrice)]));
    // VaultBar.start :51-62: the collectibles button (not the toolbar's vault button) is disabled below the unlock level, with the
    // "unlocks at level N" tooltip.
    const unlocked = game.profile.level >= COLLECTIBLE_UNLOCK_LEVEL;
    this.collectBtn?.setEnabled(unlocked);
    this.collectBtn?.setTip(unlocked ? getText("TID_HINT_MENU_BUTTON_GIFT") : t("TID_UNLOCK_LEVEL_COLLECTIBLES", [String(COLLECTIBLE_UNLOCK_LEVEL)]));
    this.refreshEnabled();
  }
  /** Natural (level based) enabled state, overridden by the tutorial lock. */
  private refreshEnabled(): void {
    const lvl = this.ctx.game.profile.level;
    for (const k of Object.keys(this.b)) {
      const natural = k === "vault" ? true : k === "invest" ? lvl >= INVESTMENTS_UNLOCK_LEVEL : true;
      this.b[k].setEnabled(this.tutorialAllowed ? this.tutorialAllowed.has(k) : natural);
    }
  }

  /**
   * Tutorial.disableButtons / enableButton(s): `allowed` = the only enabled buttons (select, build, demolition, road,
   * terrain, vault, boss, invest, multi); null restores the normal level-based state.
   */
  setTutorialLock(allowed: string[] | null): void {
    this.tutorialAllowed = allowed ? new Set(allowed) : null;
    this.refreshEnabled();
  }

  /** DOM rectangle of a toolbar button (arrows / highlights of the tutorial point at it). */
  buttonRect(name: string): DOMRect | undefined {
    const b = name === "boss" ? this.b.boss : this.b[name];
    const hit = b?.el.querySelector<HTMLElement>(":scope > .g-btnhit");
    return (hit ?? b?.el)?.getBoundingClientRect();
  }

  /** ToolsBar.setBossButton: show the chosen advisor's missions button (tutorial boss selection). */
  setBossGenre(genre: 0 | 1): void {
    const want = genre === 1 ? 2 : 1;
    if (want === this.genre) return;
    const old = this.b.boss;
    this.b.boss = this.b.boss2;
    this.b.boss2 = old;
    this.genre = want;
  }

  private toggleMulti(): void {
    if (this.multiOpen) {
      this.hideMulti();
      this.ctx.game.setTool({ kind: "select" });
      return;
    }
    this.ctx.game.setTool({ kind: "select" });
    this.hideVault();
    this.multiOpen = true;
    this.multiBar.root.style.display = "";
    this.b.multi.setSelected(true);
  }
  private hideMulti(): void {
    this.clearMulti(true);
    this.multiOpen = false;
    this.multiBar.root.style.display = "none";
    this.b.multi.setSelected(false);
  }
  private toggleVault(): void {
    if (this.vaultOpen) return this.hideVault();
    this.hideMulti();
    this.ctx.game.setTool({ kind: "select" });
    this.vaultOpen = true;
    this.vaultBar.root.style.display = "";
    this.b.vault.setSelected(true);
  }
  private hideVault(): void {
    this.vaultOpen = false;
    this.vaultBar.root.style.display = "none";
    this.b.vault.setSelected(false);
  }

  /** Choose a multifunction tool (MultifunctionBar button); clicking it again returns to select. */
  setMulti(tool: MultiTool | null): void {
    this.multiActive = this.multiActive === tool ? null : tool;
    for (const k of Object.keys(this.multiBtns) as MultiTool[]) this.multiBtns[k].setSelected(this.multiActive === k);
    if (this.multiActive) {
      this.ctx.game.setTool({ kind: "select" });
      this.b.select.setSelected(false);
    } else this.b.select.setSelected(this.ctx.game.tool.kind === "select");
    uiBus.emit("toolChanged", { tool: this.multiActive ?? this.ctx.game.tool.kind });
    this.onMultiChange?.(this.multiActive);
  }
  private clearMulti(emit: boolean): void {
    if (!this.multiActive) return;
    this.multiActive = null;
    for (const k of Object.keys(this.multiBtns) as MultiTool[]) this.multiBtns[k].setSelected(false);
    if (emit) this.onMultiChange?.(null);
  }
  onMultiChange?: (t: MultiTool | null) => void;

  /** Shop closed / popup closed: BuildButton goes back to up state. */
  setBuildSelected(on: boolean): void {
    this.b.build.setSelected(on);
  }

  /** ToolsBar.bossAlertOnChange: marker on the missions button. */
  setBossAlert(kind: BossAlert): void {
    for (const [n, clip] of Object.entries(this.bossAlert)) {
      const show = false && ((kind === "newMission" && n === "alert") || (kind === "missionReached" && n === "alert_ok")); // boss button hidden in the original
      clip.setVisible(show);
      if (show) clip.loop(15);
      else clip.stop();
    }
  }

  /** ToolsBar placement: centred horizontally, bottom aligned with the friends bar (DollarsGame.as:681-682, 1033-1034). */
  layout(bottomOffset = 0): void {
    const x = Math.round(window.innerWidth / 2 - 330);
    const y = Math.round(window.innerHeight - bottomOffset);
    this.el.style.transform = `translate(${x}px,${y}px)`;
  }
  /** Public access for the multi bar button parts. */
  part(name: string): Part {
    return this.panel.part(name);
  }
}

