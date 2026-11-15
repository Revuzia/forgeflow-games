// HIT PARADE - netcode lane: rollback save/restore/checksum cost benchmark (Node = V8, same JS
// engine as Chrome/Edge; absolute numbers on a phone will be slower - see the report's 4x rule).
//
// Measures, per state size (1/2/4/8/16 KB):
//   save      : ring[slot].set(state)        (Int32Array copy into a preallocated 10-slot ring)
//   restore   : state.set(ring[slot])
//   checksum  : FNV-1a 32 over the Int32 words (Math.imul, no allocation)
// and, for comparison at ~4 KB of fighter-shaped data:
//   structuredClone(objectGraph), JSON.stringify+parse(objectGraph)
//
// Usage: node tools/research/net_state_bench.mjs
// Output: _research/netcode/state_bench_<stamp>.json + printed table.

import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const OUT_DIR = 'C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/netcode';
const RING = 10; // GGPO keeps MAX_PREDICTION_FRAMES + 2 = 10 saved frames (src/lib/ggpo/sync.h)
const TRIALS = 7;

function fnv1a32(words) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    h = Math.imul(h ^ (w & 0xff), 0x01000193);
    h = Math.imul(h ^ ((w >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((w >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ (w >>> 24), 0x01000193);
  }
  return h >>> 0;
}
// cheaper word-wise mix (one imul per word) - adequate for desync detection, not crypto
function mix32(words) {
  let h = 0x9e3779b9 | 0;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x85ebca6b) ^ (h >>> 13);
  return h >>> 0;
}

function timeit(fn, iters) {
  const res = [];
  for (let t = 0; t < TRIALS; t++) {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn(i);
    res.push(((performance.now() - t0) * 1000) / iters); // us per op
  }
  res.sort((a, b) => a - b);
  return Math.round(res[Math.floor(TRIALS / 2)] * 1000) / 1000; // median us
}

let sink = 0;
const rows = [];
for (const kb of [1, 2, 4, 8, 16]) {
  const words = (kb * 1024) / 4;
  const state = new Int32Array(words);
  for (let i = 0; i < words; i++) state[i] = (i * 2654435761) | 0;
  const ring = Array.from({ length: RING }, () => new Int32Array(words));
  const iters = Math.max(20000, Math.floor(4e6 / words));
  // warm
  for (let i = 0; i < 20000; i++) { ring[i % RING].set(state); state.set(ring[(i + 3) % RING]); sink ^= mix32(state); }
  const save = timeit((i) => { ring[i % RING].set(state); }, iters);
  const restore = timeit((i) => { state.set(ring[i % RING]); }, iters);
  const fnv = timeit(() => { sink ^= fnv1a32(state); }, Math.floor(iters / 4));
  const mix = timeit(() => { sink ^= mix32(state); }, iters);
  rows.push({ state_kb: kb, save_us: save, restore_us: restore, checksum_fnv1a_us: fnv, checksum_mix32_us: mix });
}

// fighter-shaped object graph of roughly 4 KB of numbers, for the "why typed arrays" comparison
function mkFighter(seed) {
  const f = { hp: 1000, meter: 0, x: seed, y: 0, vx: 0, vy: 0, facing: 1, state: 3, stateFrame: 0, hitstun: 0, blockstun: 0,
    combo: 0, juggle: 0, invuln: 0, armor: 0, cancelMask: 0, inputBuf: new Array(32).fill(0), boxes: [], cooldowns: new Array(16).fill(0) };
  for (let i = 0; i < 24; i++) f.boxes.push({ x: i, y: i, w: 10, h: 10, kind: i & 3, active: 1 });
  return f;
}
const graph = { frame: 0, rng: 12345, timer: 5940, round: 1, p: [mkFighter(1), mkFighter(2)], projectiles: [], fx: new Array(64).fill(0) };
for (let i = 0; i < 8; i++) graph.projectiles.push({ x: i, y: 0, vx: 3, vy: 0, owner: i & 1, life: 60, dmg: 40, box: { w: 8, h: 8 } });
const jsonBytes = JSON.stringify(graph).length;
const sc = timeit(() => { const c = structuredClone(graph); sink ^= c.frame; }, 20000);
const js = timeit(() => { const c = JSON.parse(JSON.stringify(graph)); sink ^= c.frame; }, 20000);

const out = {
  tool: 'hit-parade/tools/research/net_state_bench.mjs', at: new Date().toISOString(), node: process.version,
  v8: process.versions.v8, cpu_note: 'desktop dev machine; median of ' + TRIALS + ' trials, microseconds per op',
  ring_slots: RING, typed_array_rows: rows,
  object_graph: { json_bytes: jsonBytes, structuredClone_us: sc, json_roundtrip_us: js },
  sink,
};
mkdirSync(OUT_DIR, { recursive: true });
const path = OUT_DIR + '/state_bench_' + out.at.replace(/[:.]/g, '-') + '.json';
writeFileSync(path, JSON.stringify(out, null, 2));
console.table(rows);
console.log('object graph', JSON.stringify(out.object_graph));
console.log('wrote', path);
