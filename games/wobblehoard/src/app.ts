// WOBBLEHOARD app = the game core (src/shell/game.ts) + the dev tools (src/shell/debugHook.ts: window.__WH__ and the sound lab).
// This is the composition the node probes (_harness/probe_app.ts with the mocks) and the dev server use. The PRODUCTION entry
// (src/main.ts -> src/shell/boot.ts) builds the game core alone and imports the dev tools only behind import.meta.env.DEV, so a
// `vite build` contains neither the hook nor the lab (audit findings 6 / 20; browser_shell.mjs greps the bundle).
// DOM-free on purpose (no document/window at import time or in createApp), so it runs under node.
import type { DebugHook } from './contracts.ts';
import type { Genome } from './core/genome.ts';
import { genomeEquals } from './core/genome.ts';
import { nameForGenome } from './ui/names.ts';
import type { LabApi, ShellDebugHook } from './shell/debugHook.ts';
import { createDebugTools } from './shell/debugHook.ts';
import type { Game, GameDeps } from './shell/game.ts';
import { createGame } from './shell/game.ts';

export { TUNING, CALIBRATION } from './shell/feel.ts';
export type { Phase, PointerIn, InputPort, PauseReason, PlayLabel } from './shell/game.ts';
export type { LabApi } from './shell/debugHook.ts';

export interface AppDeps extends GameDeps {
  postShot?: (name: string, dataUrl: string) => Promise<{ ok: boolean; path?: string }>;
}

export interface App extends Game {
  readonly lab: LabApi;
  readonly debug: DebugHook & Pick<ShellDebugHook, 'shell'>;
  /**
   * DEPRECATED (slice-1 meaning, kept for _harness/probe_app.ts): the stored starter's name, or a nickname picked from the genome for any
   * other genome. The HUD shows `label` instead (catalog species name, audit finding 19).
   */
  readonly name: string;
}

export function createApp(deps: AppDeps): App {
  const game = createGame(deps);
  const { debug, lab } = createDebugTools(game, { postShot: deps.postShot });
  const nameOf = (g: Genome): string => (genomeEquals(g, game.instance.genome) ? game.instance.name : nameForGenome(g));
  // the Game object's getters must keep working: extend it in place rather than copying (a spread would freeze the getters' values)
  return Object.defineProperties(game, {
    lab: { value: lab, enumerable: true },
    debug: { value: debug, enumerable: true },
    name: { get: () => nameOf(game.genome), enumerable: true },
  }) as App;
}
