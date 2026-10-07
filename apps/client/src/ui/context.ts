import type { AudioManager } from "../audio/audio";
import type { Game } from "../game/game";
import type { DefinitionTable } from "../model/definitions";
import type { GameConnection } from "../net/protocol";
import type { CityView } from "../view/city";

/** Everything a UI area needs. Areas live in ui/<area>/ and export `mount(ctx)`. */
export interface UiContext {
  game: Game;
  conn: GameConnection;
  defs: DefinitionTable;
  audio: AudioManager;
  city: CityView;
  /** Root DOM element overlaid on the canvas (pointer-events: none except for UI). */
  root: HTMLElement;
}
