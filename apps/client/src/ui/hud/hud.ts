/**
 * Top HUD, port of GUI/hud/HudOwner.as on Assets/hud/hud.swf class `hud` (exported here as `hud_new`):
 * coin counter (Coins.DCCoins) + "Add" button (exchange_cash), gold counter (DCcash.DCCash) + add_gold, XP bar (XP: fill_bar,
 * ExLevel, ExPoints, ExperienceStar), city name + company value (name_city: name_city/total/arrow_down_red/photo).
 */
import { Button } from "../../gui/button";
import { convertNumberToString, TRUNCATE_MILLIONS, TRUNCATE_THOUSAND } from "../../gui/format";
import { getText, t } from "../../gui/i18n";
import { ProgressBar } from "../../gui/progress";
import { Widget, localBounds } from "../../gui/widget";
import type { ProfileState } from "../../game/game";
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { Counter } from "./counter";
import { FrameClip, hitArea, hoverTip } from "./util";

/** Config.SCREEN_WIDTH: HudOwner.onResize :665 centres the hud clip on a constant 760 px stage width. */
export const STAGE_W = 760;
export const STAGE_H = 600;
const MAX_COINS = 99999999000000; // HudOwner.as:73
const ARROW_DOWN = 0; // ARROW_VALUE_DOWN_FRAME = 1 (1-based)
const ARROW_UP = 1; // ARROW_VALUE_UP_FRAME = 2

export class HudView {
  readonly widget: Widget;
  readonly el: HTMLElement;
  private coins = new Counter(0);
  private exp = new Counter(0);
  private cash = new Counter(0);
  private xpBar!: ProgressBar;
  private star!: FrameClip;
  private arrow!: FrameClip;
  private expShown = Number.NaN;
  private oldCompanyValue = 0;
  /** While visiting: the visited company's value / photo replace the owner's in the name block (HudVisitor role). */
  private visited: { name: string; value: number } | null = null;
  private lastProfile!: ProfileState;
  private cityName = "";
  private raf = 0;
  private addButtons: Button[] = [];

  /** HudOwner.enableButtons / disableButtons (the tutorial disables the add coins / add gold buttons, HudOwner.as:444-487). */
  setButtonsEnabled(on: boolean): void {
    for (const b of this.addButtons) b.setEnabled(on);
  }

  private constructor(private readonly ctx: UiContext, widget: Widget) {
    this.widget = widget;
    this.el = document.createElement("div");
    this.el.className = "mc-hud";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
    this.el.appendChild(widget.root);
  }

  static async create(ctx: UiContext): Promise<HudView> {
    const w = await Widget.create("hud", "hud_new");
    const v = new HudView(ctx, w);
    v.setup();
    return v;
  }

  private setup(): void {
    const { game } = this.ctx;
    const w = this.widget;
    // Online-only / multifunction / video parts of the exported clip are not part of HudOwner's HUD.
    // HudOwner.load :893-905 (!FACEBOOK_CREDITS_AS_CURRENCY): the coin/gold counters and their Add buttons shift right by the width of
    // the (then hidden) Facebook-credits counter "FC".
    const fcNode = w.find("FC")?.node;
    const fcB = fcNode ? localBounds(fcNode, true) : null;
    const fcW = fcB ? fcB[2] - fcB[0] : 0;
    if (fcW) for (const n of ["Coins", "DCcash", "exchange_cash", "add_gold"]) { const q = w.part(n); q.moveTo(q.x + fcW, q.y); }
    for (const n of ["FC", "add_Facebook_Credits", "move", "moneyCollector", "contractSignator", "button_video"]) w.find(n)?.hide();
    w.find("name_city.photo")?.hide(); // mFriendPhoto.visible = false (HudOwner.as:ln 'this.mFriendPhoto.visible = false')

    // Buttons (HudOwner.load: exchange_cash -> onAddCoins, add_gold -> onAddCash).
    const addCoins = new Button(w.part("exchange_cash")).setLabel(getText("TID_BUTTON_TEXT_ADD"));
    addCoins.onClick(() => uiBus.emit("openExchange"));
    const addCash = new Button(w.part("add_gold")).setLabel(getText("TID_BUTTON_TEXT_ADD"));
    addCash.onClick(() => uiBus.emit("openAddGold"));
    this.addButtons = [addCoins, addCash];

    // XP bar: DCFillBar(fill_bar, 0, 340), star plays on every exp change.
    const xp = w.part("XP");
    this.xpBar = new ProgressBar(xp.get("fill_bar"), 0, 340);
    this.star = new FrameClip("hud", xp.get("ExperienceStar"));
    this.star.goto(0);
    this.arrow = new FrameClip("hud", w.part("name_city.arrow_down_red"));
    this.arrow.goto(ARROW_UP);

    // Tooltips (setTipExpBar / setTipCoins / setTipCash / setTipName / setTipValue).
    hoverTip(hitArea(xp), () => {
      const p = this.lastProfile;
      return t("TID_HINT_EXP_BAR", [String(Math.max(0, p.xpMax - p.exp)), String(p.level + 1)]);
    }, true);
    hoverTip(hitArea(w.part("Coins")), getText("TID_HINT_BANK_BAR"));
    hoverTip(hitArea(w.part("DCcash")), getText("TID_HINT_GOLD_BAR"));
    const nameField = w.part("name_city.name_city");
    const nameHit = hitArea(nameField);
    nameHit.style.cursor = "pointer";
    nameHit.addEventListener("click", () => uiBus.emit("openCityName"));
    hoverTip(nameHit, getText("TID_HINT_CITY_NAME"));
    hoverTip(hitArea(w.part("name_city.total")), getText("TID_HINT_VALUE"));

    // Initial state, no animation.
    const p = game.profile;
    this.lastProfile = p;
    this.coins.set(p.coins, false);
    this.cash.set(p.cash, false);
    this.exp.set(p.exp, false);
    this.oldCompanyValue = p.companyValue;
    this.setCityName(game.state.profile.cityName);
    this.render(p, true);
    game.on("profile", (np) => this.onProfile(np));

    const loop = (): void => {
      this.tickFrame();
      this.raf = requestAnimationFrame(loop);
    };
    let last = performance.now();
    const tickFrame = (): void => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      let dirty = this.coins.tick(dt);
      dirty = this.cash.tick(dt) || dirty;
      dirty = this.exp.tick(dt) || dirty;
      if (dirty) this.render(this.lastProfile, false);
      this.blinkCash(dt);
    };
    this.tickFrame = tickFrame;
    this.raf = requestAnimationFrame(loop);
    this.layout();
  }
  private tickFrame: () => void = () => {};

  /** HudOwner.onResize: hud.x = (stageWidth - hud.width) / 2. */
  layout(): void {
    this.el.style.transform = `translate(${Math.round((window.innerWidth - STAGE_W) / 2)}px,0px)`;
  }

  /** DollarsGame.visitUniverse HUD: friend photo + the visited city's name and company value (name_city.photo visible, Hud.setFriend). */
  setVisited(v: { name: string; value: number; photo?: string } | null): void {
    this.visited = v;
    const photo = this.widget.find("name_city.photo");
    if (v) {
      photo?.show();
      if (v.photo) this.widget.part("name_city.photo").setImage(v.photo, { x: 0, y: 0, w: 50, h: 50 });
      this.widget.part("name_city.name_city").setText(v.name, { rich: false });
      this.widget.part("name_city.total").setText(getText("TID_COIN_SYMBOL") + convertNumberToString(v.value, TRUNCATE_MILLIONS, 10), { rich: false });
    } else {
      photo?.hide();
      this.setCityName(this.cityName);
      this.render(this.lastProfile, true);
    }
  }

  setCityName(name: string): void {
    this.cityName = name || getText("TID_INITIAL_CITY_NAME");
    this.widget.part("name_city.name_city").setText(this.cityName, { rich: false });
  }

  private onProfile(p: ProfileState): void {
    this.lastProfile = p;
    this.coins.set(Math.min(p.coins, MAX_COINS));
    this.cash.set(p.cash, false);
    // XP counter animates upwards; the fill bar follows the real value immediately (setValueWithoutBarAnimation).
    this.exp.set(p.exp, p.exp > this.exp.value);
    this.render(p, false);
  }

  /** setCoins/setExp/setLevel/setCash/setCompanyValue (HudOwner.as 700-840). */
  private render(p: ProfileState, initial: boolean): void {
    const w = this.widget;
    const coinsTxt = w.part("Coins.DCCoins");
    coinsTxt.setText(getText("TID_COIN_SYMBOL") + convertNumberToString(this.coins.value, TRUNCATE_MILLIONS, 8), { rich: false });
    coinsTxt.setTextColor(p.coins < 1001 ? "#ff0000" : "#ffffff"); // textEffectCoins
    const cashTxt = w.part("DCcash.DCCash");
    cashTxt.setText(convertNumberToString(this.cash.value, TRUNCATE_THOUSAND, 4), { rich: false });
    w.part("XP.ExLevel").setText(String(p.level), { rich: false });
    w.part("XP.ExPoints").setText(convertNumberToString(this.exp.value, 0, 0), { rich: false });
    const max = Number.isFinite(p.xpMax) ? p.xpMax : p.xpMin + 1;
    this.xpBar.setRange(p.xpMin, Math.max(max, p.xpMin + 1)).setValue(p.exp, false);
    if (p.exp !== this.expShown) {
      if (!initial && !Number.isNaN(this.expShown)) this.star.playOnce(24, 0);
      this.expShown = p.exp;
    }
    // Company value + trend arrow (setCompanyValue)
    if (p.companyValue > this.oldCompanyValue) this.arrow.goto(ARROW_UP);
    else if (p.companyValue < this.oldCompanyValue) this.arrow.goto(ARROW_DOWN);
    if (this.visited) return;
    const total = w.part("name_city.total");
    total.setText(getText("TID_COIN_SYMBOL") + convertNumberToString(p.companyValue, TRUNCATE_MILLIONS, 10), { rich: false });
  }

  /**
   * HudOwner has no gold-counter blink: only the coin counter reddens below 1001 coins (textEffectCoins :550, setCoins :725-731).
   * The oracle shows the gold "0" in white, so the gold text always stays white.
   */
  private blinkCash(_dt: number): void {
    const txt = this.widget.part("DCcash.DCCash");
    txt.setTextColor("#ffffff");
    txt.setOpacity(1);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
