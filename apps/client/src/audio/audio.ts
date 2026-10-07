import { type AudioEvent, type SoundName, musicFor, parseFlag, soundForEvent } from './events';

interface IndexEntry { file: string; kind: 'music' | 'sfx'; loop: boolean; volume: number }
interface AudioIndex { sounds: Record<string, IndexEntry> }

const FADE_S = 1;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private index: AudioIndex | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private current: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedMusic: SoundName | null = null;
  musicOn = true;
  sfxOn = true;
  /** Called when a toggle changes so the caller can persist via the game config ('music'/'sound'). */
  onConfigChange?: (cfg: { music: '0' | '1'; sound: '0' | '1' }) => void;

  constructor(private base = '/audio/') {
    const unlock = () => {
      this.ensureCtx();
      void this.ctx?.resume().then(() => this.syncMusic());
      for (const e of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(e, unlock);
    };
    if (typeof window !== 'undefined') {
      for (const e of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(e, unlock);
    }
  }

  /** Apply get_game_config values, e.g. {music:'1', sound:'1'}. */
  applyConfig(cfg: { music?: string; sound?: string }): void {
    this.musicOn = parseFlag(cfg.music);
    this.sfxOn = parseFlag(cfg.sound);
    this.syncMusic();
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    this.syncMusic();
    this.persist();
  }
  setSfxOn(on: boolean): void {
    this.sfxOn = on;
    this.persist();
  }
  setVolume(music: number, sfx: number): void {
    if (this.musicGain) this.musicGain.gain.value = music;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
  }

  /** Play the sound mapped to a game event. */
  play(ev: AudioEvent, opts: { isDecoration?: boolean } = {}): void {
    const name = soundForEvent(ev, opts);
    if (name) void this.playSound(name);
  }

  async playSound(name: string): Promise<void> {
    const entry = await this.entry(name);
    if (!entry || !this.ensureCtx() || (entry.kind === 'sfx' && !this.sfxOn)) return;
    const buf = await this.load(entry.file);
    if (!buf || !this.ctx || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = entry.volume;
    src.connect(g).connect(this.sfxGain!);
    src.start();
  }

  /** Select the looping track (fades out the previous one). */
  setMusic(name: SoundName | null): void {
    this.wantedMusic = name;
    this.syncMusic();
  }
  setMusicForState(state: Parameters<typeof musicFor>[0]): void {
    this.setMusic(musicFor(state));
  }

  private async syncMusic(): Promise<void> {
    const want = this.musicOn ? this.wantedMusic : null;
    if (this.current?.name === want) return;
    if (!this.ctx || this.ctx.state !== 'running') return; // retried on unlock
    this.fadeOutCurrent();
    if (!want) return;
    const entry = await this.entry(want);
    const buf = entry && (await this.load(entry.file));
    if (!buf || !entry || !this.ctx || this.wantedMusic !== want || !this.musicOn || this.current) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = entry.loop;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(entry.volume, this.ctx.currentTime + FADE_S);
    src.connect(gain).connect(this.musicGain!);
    src.start();
    this.current = { name: want, src, gain };
  }

  private fadeOutCurrent(): void {
    const c = this.current;
    if (!c || !this.ctx) return;
    this.current = null;
    c.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    c.gain.gain.setValueAtTime(c.gain.gain.value, this.ctx.currentTime);
    c.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + FADE_S);
    c.src.stop(this.ctx.currentTime + FADE_S + 0.05);
  }

  private persist(): void {
    this.onConfigChange?.({ music: this.musicOn ? '1' : '0', sound: this.sfxOn ? '1' : '0' });
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = typeof window !== 'undefined' ? window.AudioContext ?? (window as any).webkitAudioContext : undefined;
    if (!AC) return null;
    this.ctx = new AC();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain.connect(this.ctx.destination);
    return this.ctx;
  }

  private async entry(name: string): Promise<IndexEntry | null> {
    if (!this.index) {
      try { this.index = await (await fetch(this.base + 'index.json')).json(); } catch { return null; }
    }
    return this.index?.sounds[name] ?? null;
  }

  private load(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(this.base + file);
          return await this.ctx!.decodeAudioData(await r.arrayBuffer());
        } catch { return null; }
      })();
      this.buffers.set(file, p);
    }
    return p;
  }
}
