// Falling banknotes behind/in front of the level-up and mission-reward popups. Port of utils/particles/NoteRain.as:
// DollarsGame.mRain = NoteRain(BACKGROUND, 50 particles, notes 2-3) and mRain2 = NoteRain(FOREGROUND, 10, notes 0-1), started by
// PopupLevel.showPopup (:218) / MissionObjectManager.openReward (:166), stopped on close (new particles stop, the rest fall out).
import { Widget } from '../../gui/widget';

const STAGE_W = 760;
const STAGE_H = 600;
/** Flash frame rate of the game (ENTER_FRAME steps). */
const FPS = 25;

class Rain {
  private el?: HTMLElement;
  private raf = 0;
  private last = 0;
  private spawn = false;
  private parts: { el: HTMLElement; y: number; x: number; speed: number; rx: number; rz: number }[] = [];
  private raining = false;
  constructor(
    private readonly layer: 'bg' | 'fg',
    private readonly max: number,
    private readonly templates: Promise<HTMLElement[]>,
  ) {}

  async start(): Promise<void> {
    this.spawn = true;
    if (this.raining) return;
    this.raining = true;
    const tpl = await this.templates;
    if (!this.raining || !tpl.length) return;
    this.el = document.createElement('div');
    // under the popup dim (z 1000) for the background rain, above everything for the foreground rain
    this.el.style.cssText = `position:fixed;left:50%;top:50%;width:${STAGE_W}px;height:${STAGE_H}px;margin:${-STAGE_H / 2}px 0 0 ${-STAGE_W / 2}px;pointer-events:none;overflow:visible;z-index:${this.layer === 'bg' ? 999 : 100001};perspective:800px`;
    document.body.appendChild(this.el);
    for (let i = 0; i < this.max; i++) this.make(i, tpl);
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.raining) return;
      const steps = Math.min(4, Math.floor(((now - this.last) * FPS) / 1000));
      if (steps > 0) {
        this.last += (steps * 1000) / FPS;
        for (let s = 0; s < steps; s++) this.step(tpl);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.spawn = false;
  }

  private make(i: number, tpl: HTMLElement[]): void {
    // NoteRain.createNewPartilce: BACKGROUND -> Note2/Note3, FOREGROUND -> Note/Note1
    const kind = (this.layer === 'bg' ? 2 : 0) + Math.floor(Math.random() * 2);
    const el = tpl[kind].cloneNode(true) as HTMLElement;
    el.style.position = 'absolute';
    const p = {
      el,
      speed: 5 + Math.random() * 10,
      y: -60 - Math.random() * (STAGE_H / 2),
      x: Math.random() * (STAGE_W + 200) - 100,
      rx: Math.random() * 360,
      rz: Math.random() * 360,
    };
    this.parts[i] = p;
    this.place(p);
    this.el?.appendChild(el);
  }

  private place(p: { el: HTMLElement; y: number; x: number; rx: number; rz: number }): void {
    p.el.style.transform = `translate(${p.x}px,${p.y}px) rotateX(${p.rx}deg) rotateZ(${p.rz}deg)`;
  }

  private step(tpl: HTMLElement[]): void {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (!p) continue;
      p.y += p.speed;
      p.rx += 10;
      p.rz += 5;
      if (p.y > STAGE_H + STAGE_H / 4) {
        p.el.remove();
        delete this.parts[i];
        if (this.spawn) this.make(i, tpl);
      }
      if (this.parts[i]) {
        alive++;
        this.place(this.parts[i]);
      }
    }
    if (!alive && !this.spawn) this.end();
  }

  private end(): void {
    this.raining = false;
    cancelAnimationFrame(this.raf);
    this.el?.remove();
    this.el = undefined;
    this.parts = [];
  }
}

let rains: Rain[] | undefined;
function get(): Rain[] {
  if (!rains) {
    const load = async (): Promise<HTMLElement[]> => {
      const names = ['Note', 'Note1', 'Note2', 'Note3'];
      const ws = await Promise.all(names.map((n) => Widget.create('Dollars', `com.dchoc.framework.utils.AssetManager_${n}`).catch(() => undefined)));
      return ws.filter((w): w is Widget => !!w).map((w) => w.root);
    };
    const templates = load();
    rains = [new Rain('bg', 50, templates), new Rain('fg', 10, templates)];
  }
  return rains;
}

export function startNoteRain(): void {
  for (const r of get()) void r.start();
}
export function stopNoteRain(): void {
  for (const r of get()) r.stop();
}
