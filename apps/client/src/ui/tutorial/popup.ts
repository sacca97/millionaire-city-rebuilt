/**
 * PopupTutorial (GUI/PopupTutorial.as) on houses_info.swf `popup_tutorial_01` (Ronald) / `_02` (Cindy): title ("Tutorial"
 * field), body (TextInfo), "Step n / 8" and the OK button, which stays disabled until the forced action is done
 * (Tutorial.activeOkButton -> enable() + playAnim(): AssetManager.NextButtonAnim). The box is not modal (mDrawBackground = false);
 * createBox places it at (width/2 - 30, height/2 + 50) in stage pixels (PopupTutorial.as createBox).
 */
import { Button } from "../../gui/button";
import { getText, t } from "../../gui/i18n";
import { Widget } from "../../gui/widget";

const NEXT_DIR = "/gui/Dollars/sprites/com.dchoc.framework.utils.AssetManager_NextButtonAnim/";
const NEXT_FRAMES = 31;
/** Next-button anim clip bounds (Dollars layout): top-left of frame PNGs relative to the origin. */
const NEXT_BOUNDS = { x: -125.5, y: -76.248 };

export class TutorialPopup {
  readonly el: HTMLElement;
  private widget!: Widget;
  private ok!: Button;
  private animTimer = 0;
  private anim?: HTMLImageElement;
  private onOk: () => void = () => undefined;

  private constructor(private readonly genre: 0 | 1) {
    this.el = document.createElement("div");
    this.el.className = "mc-tutorial-popup";
    this.el.style.cssText = "position:absolute;left:0;top:0;z-index:500;pointer-events:none";
  }

  static async create(genre: 0 | 1, onOk: () => void): Promise<TutorialPopup> {
    const p = new TutorialPopup(genre);
    p.onOk = onOk;
    await p.build();
    return p;
  }

  private async build(): Promise<void> {
    const w = await Widget.create("houses_info", this.genre === 1 ? "popup_tutorial_02" : "popup_tutorial_01");
    this.widget = w;
    this.ok = new Button(w.part("OkButton"));
    this.ok.setLabel(getText("TID_BUTTON_NEXT"));
    this.ok.onClick(() => this.onOk());
    this.el.appendChild(w.root);
    this.layout();
    window.addEventListener("resize", () => this.layout());
  }

  /** PopupTutorial.createBox: mBox.x = width/2 - 30, mBox.y = height/2 + 50 with the box bounds -218..261 x -209..172. */
  layout(): void {
    this.widget.root.style.transform = "translate(209px,240px)";
  }

  get okEnabled(): boolean {
    return this.ok.isEnabled;
  }
  get okRect(): DOMRect {
    return this.ok.el.getBoundingClientRect();
  }
  /** Hides the box (between steps / after the end). */
  hide(): void {
    this.el.style.display = "none";
  }

  /** PopupTutorial.showPopUp(title, text, step) + the Back-ease open tween (Popup.startShow, 0.35 s). */
  show(title: string, body: string, step: number, showStep: boolean, buttonText?: string): void {
    const w = this.widget;
    w.setText("Tutorial", title, { fit: true });
    // Original body text: Arial 14 bold with leading 2 -> 18 px lines (measured in the oracle).
    // Flash text fields are top-anchored: the first line sits 20 px below the field top (measured: oracle first line centre y=144).
    w.part("TextInfo").setTextTop();
    w.setText("TextInfo", body, { fit: false });
    const span = w.part("TextInfo").el.querySelector(".g-text")?.firstElementChild as HTMLElement | null | undefined;
    if (span) {
      span.style.lineHeight = "18px";
      span.style.paddingTop = "20px";
    }
    const stepPart = w.find("Step");
    if (stepPart) {
      stepPart.setVisible(showStep);
      if (showStep) stepPart.setText(t("TID_TUTORIAL_STEP", [step, 8]), { fit: true });
    }
    this.ok.setLabel(buttonText ?? getText("TID_BUTTON_NEXT"));
    this.stopAnim();
    this.el.style.display = "";
    const root = w.root;
    root.style.transformOrigin = "0 0";
    root.animate?.(
      [
        { transform: "translate(209px,240px) scale(0.2)", opacity: 0.2 },
        { transform: "translate(209px,240px) scale(1)", opacity: 1 }
      ],
      { duration: 350, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
    );
  }

  /** PopupTutorial.enable/disable. */
  setOkEnabled(on: boolean): void {
    this.ok.setEnabled(on);
  }

  /** PopupTutorial.playAnim: the NextButtonAnim plays once over the OK button (Tutorial.activeOkButton). */
  playAnim(): void {
    this.stopAnim();
    const img = document.createElement("img");
    img.draggable = false;
    // clip origin ~ button centre: y = -OkButton.y + box.height/3 (PopupTutorial.as playAnim) = local (0, ~127)
    img.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;transform:translate(${NEXT_BOUNDS.x}px,${127 + NEXT_BOUNDS.y}px)`;
    this.widget.root.appendChild(img);
    this.anim = img;
    let f = 1;
    img.src = `${NEXT_DIR}${f}.png`;
    this.animTimer = window.setInterval(() => {
      f += 1;
      if (f > NEXT_FRAMES) this.stopAnim();
      else img.src = `${NEXT_DIR}${f}.png`;
    }, 1000 / 30);
  }

  private stopAnim(): void {
    if (this.animTimer) window.clearInterval(this.animTimer);
    this.animTimer = 0;
    this.anim?.remove();
    this.anim = undefined;
  }

  destroy(): void {
    this.stopAnim();
    this.el.remove();
  }
}
