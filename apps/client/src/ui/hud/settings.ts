/** Persisted client toggles (Dollars.updateGameConfig: sound/music/quality as "1"/"0" via update_profile action gameConfig). */
import type { AudioManager } from "../../audio/audio";
import type { Game } from "../../game/game";

export type Quality = "high" | "low";
type Listener = (q: Quality) => void;
const listeners = new Set<Listener>();
let quality: Quality = "high";

export const getQuality = (): Quality => quality;
/** Quality LOW disables item animations (feature-inventory 3.3); the view layer can subscribe. */
export function onQualityChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setQualityLocal(q: Quality): void {
  quality = q;
  document.documentElement.dataset.quality = q;
  for (const l of [...listeners]) l(q);
}

export function gameConfigPayload(audio: Pick<AudioManager, "musicOn" | "sfxOn">, q: Quality): Record<string, string> {
  return { sound: audio.sfxOn ? "1" : "0", music: audio.musicOn ? "1" : "0", quality: q === "high" ? "1" : "0" };
}

/** UserDataFacade.updateProfile("gameConfig", {...}) through the queue. */
export function persistGameConfig(game: Game, audio: Pick<AudioManager, "musicOn" | "sfxOn">): void {
  game.queue.sendCommand(game.commands.profile("gameConfig", gameConfigPayload(audio, quality)));
}
