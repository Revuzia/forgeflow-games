// GENESIS — spawns the sim Web Worker. Kept in its own module on purpose: SimClient imports it DYNAMICALLY, so if the
// worker module is missing or fails to transform (the sim lane builds it in parallel), only this import rejects and
// the client falls back to the lookdev generator instead of the whole module graph failing to load.

export function spawnSimWorker(): Worker {
  return new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module', name: 'genesis-sim' });
}
