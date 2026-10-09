// GENESIS — the creature's eyes on the hand (CONTRACT.md §11.5): a miracle cast near a creature can be learned by
// watching. belief.ts calls creaturesWatch for every miracle; creature.ts registers the watcher (a hook list keeps the
// two modules free of an import cycle).

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';

export type Watcher = (u: Universe, p: Planet, pos: ArrayLike<number>, miracle: string, god: number) => void;

export const watchHooks: Watcher[] = [];

export function creaturesWatch(u: Universe, p: Planet, pos: ArrayLike<number>, miracle: string, god: number): void {
  for (const h of watchHooks) h(u, p, pos, miracle, god);
}
