// GENESIS — spawns the audio DSP worker. Its own module on purpose (like client/workerspawn.ts): the engine imports it
// DYNAMICALLY, so if a worker cannot be made here the bank simply renders on the main thread in small slices.

export function spawnDspWorker(): Worker {
  return new Worker(new URL('./dspworker.ts', import.meta.url), { type: 'module', name: 'genesis-audio-dsp' });
}
