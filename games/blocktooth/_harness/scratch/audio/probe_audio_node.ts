// Audio lane node probe: with NO AudioContext (plain node) every audio API must be a safe no-op,
// fed with REAL sim events from a real World.
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { AudioEngine } from '../../../src/audio/audio.ts';
import { Sfx } from '../../../src/audio/sfx.ts';
import { Music } from '../../../src/audio/music.ts';
import type { SimEvent } from '../../../src/core/types.ts';

const eng = new AudioEngine();
console.log('AudioContext global in node:', typeof (globalThis as any).AudioContext);
await eng.unlock();
console.log('after unlock: ready=', eng.ready, 'ctx=', eng.ctx, 'sfxBus=', eng.sfxBus, 'musicBus=', eng.musicBus);
eng.setVolumes(0.8, 0.6, 0.8);
eng.duck(0.5, 1, 1);
const sfx = new Sfx(eng);
const mus = new Music(eng);
mus.play('title'); mus.play('select'); mus.setIntensity(0.9); mus.play('grideast'); mus.pump(); mus.setIntensity(NaN); mus.stop();
for (const k of ['move', 'confirm', 'back', 'draft', 'pick', 'slate', 'print'] as const) sfx.ui(k);
const w = createWorld({ titan: 'voltkite', biome: 'lockwater', seed: 7 });
const counts: Record<string, number> = {};
let total = 0;
for (let i = 0; i < 1800; i++) {
  const a = i * 0.01;
  stepWorld(w, { mx: Math.sin(a), mz: Math.cos(a * 0.7), ability: i % 90 === 0, abilityHeld: false, dash: i % 70 === 0 });
  for (const e of w.events as SimEvent[]) { counts[e.type] = (counts[e.type] ?? 0) + 1; total++; }
  sfx.onEvents(w, w.events, w.titan.x, w.titan.z);
}
console.log('ticks=1800 events=', total, 'types=', Object.keys(counts).length);
console.log(JSON.stringify(counts));
console.log('activeVoices=', sfx.activeVoices, 'music.track=', mus.track);
console.log('PROBE OK (no throws, no AudioContext)');
