/**
 * Options panel, port of GUI/hud/OptionsPanel (hud.swf `options_panel`): zoom in/out, fullscreen, music, sound, quality and a
 * show/hide toggle. Music/sound/quality persist through update_profile gameConfig (Dollars.updateGameConfig).
 */
import { Button } from "../../gui/button";
import { getText } from "../../gui/i18n";
import { Widget, localBounds } from "../../gui/widget";
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { getQuality, persistGameConfig, setQualityLocal } from "./settings";
import { FrameClip } from "./util";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

export class OptionsPanel {
  readonly el: HTMLElement;
  private w!: Widget;
  private expanded = false; // OptionsPanel.as:71 mOptionsVisible = false
  private clips: Record<"music" | "volume", FrameClip[]> = { music: [], volume: [] };
  private shown: Button[] = [];

  private constructor(private readonly ctx: UiContext) {
    this.el = document.createElement("div");
    this.el.className = "mc-options";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
  }

  static async create(ctx: UiContext): Promise<OptionsPanel> {
    const o = new OptionsPanel(ctx);
    await o.build();
    return o;
  }

  private async build(): Promise<void> {
    const { audio, game, city } = this.ctx;
    const w = (this.w = await Widget.create("hud", "options_panel"));
    this.el.appendChild(w.root);
    const mk = (name: string, tip: string, fn: () => void): Button => {
      const b = new Button(w.part(name));
      if (tip) b.setTip(tip);
      b.onClick(fn);
      return b;
    };
    const zoomBy = (f: number): void => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, city.world.scale.x * f)) / city.world.scale.x;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      city.world.x = cx - (cx - city.world.x) * k;
      city.world.y = cy - (cy - city.world.y) * k;
      city.world.scale.set(city.world.scale.x * k);
    };
    const zi = mk("zoomin", getText("TID_HINT_BUTTON_ZOOMIN"), () => zoomBy(1.25));
    const zo = mk("zoomout", getText("TID_HINT_BUTTON_ZOOMOUT"), () => zoomBy(0.8));
    const fs = mk("fullscreen", getText("TID_HINT_BUTTON_FULLSCREEN"), () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    });
    const music = mk("music", getText("TID_HINT_BUTTON_MUSIC_ON"), () => {
      audio.setMusicOn(!audio.musicOn);
      this.sync();
    });
    const sound = mk("volume", getText("TID_HINT_BUTTON_SOUND_ON"), () => {
      audio.setSfxOn(!audio.sfxOn);
      this.sync();
    });
    const quality = mk("quality", getText("TID_HINT_BUTTON_QUALITY"), () => {
      setQualityLocal(getQuality() === "high" ? "low" : "high");
      persistGameConfig(game, audio);
    });
    const toggle = mk("options", getText("TID_HINT_BUTTON_OPTIONS_HIDE"), () => {
      this.expanded = !this.expanded;
      toggle.setTip(getText(this.expanded ? "TID_HINT_BUTTON_OPTIONS_HIDE" : "TID_HINT_BUTTON_OPTIONS_SHOW"));
      this.applyExpanded();
    });
    this.shown = [zi, zo, fs, music, sound, quality];
    // music/volume buttons show frame 0 = on, 1 = off (Button_music / Button_volume have 2 frames).
    for (const [k, name] of [["music", "music"], ["volume", "volume"]] as const) {
      for (const bt of w.partsNamed("ButtonText")) {
        if (bt.el.closest(`[data-n="${name}"]`) || isInside(bt, w.part(name))) this.clips[k].push(new FrameClip("hud", bt));
      }
    }
    // Persist toggles through update_profile gameConfig (AudioManager.onConfigChange).
    audio.onConfigChange = () => persistGameConfig(game, audio);
    // Initial values from get_game_config.
    try {
      const cfg = ((await this.ctx.conn.query("get_game_config"))?._dat ?? {}) as Record<string, string>;
      setQualityLocal(cfg.quality === "0" ? "low" : "high");
    } catch {
      /* default high */
    }
    document.addEventListener("fullscreenchange", () => this.layout());
    this.sync();
    this.applyExpanded();
    uiBus.on("openOptions", () => {
      this.expanded = true;
      this.applyExpanded();
    });
    this.layout();
  }

  private applyExpanded(): void {
    const w = this.w;
    for (const n of ["zoomin", "zoomout", "fullscreen", "music", "volume", "quality"]) w.part(n).setVisible(this.expanded);
    w.node.children[0] && (w.root.firstElementChild as HTMLElement | null)?.style.setProperty("display", this.expanded ? "" : "none");
  }

  /** Music/sound icons show the "off" frame when muted. */
  sync(): void {
    const { audio } = this.ctx;
    for (const c of this.clips.music) c.goto(audio.musicOn ? 0 : 1);
    for (const c of this.clips.volume) c.goto(audio.sfxOn ? 0 : 1);
  }

  /** Bottom-right corner of the window. */
  layout(): void {
    // OptionsPanel.resize :261: y = stageHeight (the clip's art sits above, bounds y ~ -193); the gear is the right-most button and
    // touches the right edge of the 760 px stage (oracle fresh-boot/post-tutorial: gear at stage x 736..760, y ~ 395..421).
    const b = localBounds(this.w.node, false) ?? [578, -193, 790, -160];
    const x = Math.round((window.innerWidth + 760) / 2 - b[2]);
    const y = Math.round(window.innerHeight);
    this.el.style.transform = `translate(${x}px,${y}px)`;
  }
}

function isInside(part: { el: HTMLElement }, container: { el: HTMLElement }): boolean {
  return container.el.contains(part.el);
}
