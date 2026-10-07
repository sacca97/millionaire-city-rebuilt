/**
 * Tutorial arrows and tile highlights. The arrow is the original `AssetManager.TutorialArrow` clip (Dollars.swf, 30 frames, a
 * bouncing orange arrow whose tip sits at the clip origin); highlights are the green tiles of Tutorial.addTerrains/addRoads/
 * addDecoration (lineStyle(2, 0x00FF00), fill 0x00FF00 @ 25%). Targets are evaluated every frame by the controller so the
 * overlay follows the camera and the HUD parts it points at (their DOM bounding boxes).
 */
const ARROW_DIR = "/gui/Dollars/sprites/com.dchoc.framework.utils.AssetManager_TutorialArrow/";
const ARROW_FRAMES = 30;
/** Pixel of the tip inside a frame PNG (frame 1: 56x77, tip at x ~ 32, bottom edge). */
const TIP = { x: 32, y: 77 };
const FPS = 30;

/** Tip position in screen pixels. */
export interface ArrowSpec {
  x: number;
  y: number;
}
/** Highlight rectangle in screen pixels. */
export interface BoxSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Map.setBuildGrid look (step 1): 1 px white cell outlines instead of the green 2 px box. `cell` is the tile size in px. */
  grid?: { cell: number };
}
export interface Overlay {
  arrows: ArrowSpec[];
  boxes: BoxSpec[];
}

export class ArrowLayer {
  readonly el: HTMLElement;
  private arrowEls: HTMLImageElement[] = [];
  private boxEls: HTMLElement[] = [];
  private raf = 0;
  private frame = -1;
  private compute: () => Overlay = () => ({ arrows: [], boxes: [] });

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "mc-tutorial-arrows";
    this.el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1500";
    for (let i = 1; i <= ARROW_FRAMES; i += 1) new Image().src = `${ARROW_DIR}${i}.png`; // preload the 30 frames
  }

  start(compute: () => Overlay): void {
    this.compute = compute;
    const loop = (): void => {
      this.update();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.el.replaceChildren();
    this.arrowEls = [];
    this.boxEls = [];
  }

  /** Last computed overlay (tests / debugging). */
  last: Overlay = { arrows: [], boxes: [] };

  private update(): void {
    const o = this.compute();
    this.last = o;
    const f = Math.floor(performance.now() / (1000 / FPS)) % ARROW_FRAMES;
    const frameChanged = f !== this.frame;
    this.frame = f;
    while (this.arrowEls.length < o.arrows.length) {
      const img = document.createElement("img");
      img.draggable = false;
      img.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;image-rendering:auto";
      this.el.appendChild(img);
      this.arrowEls.push(img);
    }
    while (this.arrowEls.length > o.arrows.length) this.arrowEls.pop()?.remove();
    o.arrows.forEach((a, i) => {
      const img = this.arrowEls[i];
      if (frameChanged || !img.src) img.src = `${ARROW_DIR}${f + 1}.png`;
      img.style.transform = `translate(${Math.round(a.x - TIP.x)}px,${Math.round(a.y - TIP.y)}px)`;
    });
    while (this.boxEls.length < o.boxes.length) {
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;left:0;top:0;box-sizing:border-box;border:2px solid #00ff00;background:rgba(0,255,0,.25);pointer-events:none";
      this.el.appendChild(d);
      this.boxEls.push(d);
    }
    while (this.boxEls.length > o.boxes.length) this.boxEls.pop()?.remove();
    o.boxes.forEach((b, i) => {
      const d = this.boxEls[i];
      d.style.transform = `translate(${b.x}px,${b.y}px)`;
      d.style.width = `${b.w}px`;
      d.style.height = `${b.h}px`;
      if (b.grid) {
        const c = b.grid.cell;
        d.style.border = "0";
        d.style.background = `repeating-linear-gradient(to right,#fff 0 1px,transparent 1px ${c}px),repeating-linear-gradient(to bottom,#fff 0 1px,transparent 1px ${c}px)`;
        d.style.boxShadow = "inset -1px -1px 0 #fff";
      } else {
        d.style.border = "2px solid #00ff00";
        d.style.background = "rgba(0,255,0,.25)";
        d.style.boxShadow = "";
      }
    });
  }
}
