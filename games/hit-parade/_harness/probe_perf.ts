// probe_perf (G2, lane SIM): sim budgets (CONTRACT §4.1, NETCODE §3.5).
//   step <= 0.25 ms desktop (2 fighters + projectiles): measured per step over play-like random
//   input streams (p99 and mean must both be under budget);
//   save + checksum <= 10 us: measured over a ring of 10 slots;
//   versus state <= 1024 ints.
// Timings use performance.now() in the HARNESS only (the sim never reads a clock). Other agents may
// load this machine; the numbers printed are what was measured this run.
import { newMatch, randomInputs, tester, fixtureData, uniqueInputs } from './fixtures/simkit.ts';
import { loadGameData } from '../runtime/src/core/data.ts';
import { step, save, load, checksum } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { STATE_INTS, W, PH, P, PROJ_CAP, projBase } from '../runtime/src/core/sim/layout.ts';
import { BUDGET } from '../runtime/src/core/config.ts';
import { performance } from 'node:perf_hooks';

const t = tester('probe_perf');
fixtureData();

function pct(a: Float64Array, q: number): number {
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// warm-up (JIT)
{
  const m = newMatch({ skipIntro: false, seed: 99 });
  const inp = randomInputs(99, 6000);
  for (let f = 0; f < 6000; f++) step(m, inp[f * 2], inp[f * 2 + 1]);
}

const FRAMES = 8000;
const RUNS = 4;
const times = new Float64Array(FRAMES * RUNS);
let n = 0;
let maxProj = 0;
for (let r = 0; r < RUNS; r++) {
  const pair: [string, string] = r % 2 === 0 ? ['kit_a', 'kit_b'] : ['kit_a', 'kit_a'];
  let m: Match = newMatch({ p1: pair[0], p2: pair[1], seed: 10 + r, skipIntro: false });
  const inp = randomInputs(10 + r, FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    const a = inp[f * 2];
    const b = inp[f * 2 + 1];
    const t0 = performance.now();
    step(m, a, b);
    times[n++] = performance.now() - t0;
    let pc = 0;
    for (let k = 0; k < PROJ_CAP; k++) if (m.s[projBase(k) + P.act] !== 0) pc++;
    if (pc > maxProj) maxProj = pc;
    if (m.s[W.phase] === PH.MATCH_END) m = newMatch({ p1: pair[0], p2: pair[1], seed: 10 + r + f, skipIntro: false });
  }
}
let sum = 0;
for (let i = 0; i < n; i++) sum += times[i];
const mean = sum / n;
const p50 = pct(times, 0.5);
const p99 = pct(times, 0.99);
const max = pct(times, 1);
t.ok(p99 <= BUDGET.stepMs, `step p99 ${(p99 * 1000).toFixed(1)} us <= ${BUDGET.stepMs * 1000} us`);
t.ok(mean <= BUDGET.stepMs, `step mean ${(mean * 1000).toFixed(2)} us`);
t.ok(maxProj >= 1, `projectiles were live during the run (max ${maxProj})`);

// CHANGED(SIM) P2: the real 12 kits with unique-heavy streams (ball, stance, counters, teleports, phases) and the bonus
// rounds (4 goons / heckle arcs); same 0.25 ms budget
function measure(mk: () => Match, streams: (f: number) => [number, number], frames: number): { mean: number; p99: number; max: number } {
  const ts = new Float64Array(frames);
  let mm = mk();
  for (let f = 0; f < frames; f++) {
    const [a, b] = streams(f);
    const q0 = performance.now();
    step(mm, a, b);
    ts[f] = performance.now() - q0;
    if (mm.s[W.phase] === PH.MATCH_END) mm = mk();
  }
  let s0 = 0;
  for (let i = 0; i < frames; i++) s0 += ts[i];
  return { mean: s0 / frames, p99: pct(ts, 0.99), max: pct(ts, 1) };
}
let realNote = '';
try {
  const real = loadGameData();
  const ids = Object.keys(real.fighters).sort();
  const UF = 1500;
  const ua = uniqueInputs(5, 8, UF * ids.length);
  const ub = uniqueInputs(6, 4, UF * ids.length);
  let k = 0;
  const vs = measure(() => { const id = ids[k++ % ids.length]; return newMatch({ data: real, p1: id, p2: ids[(k * 5) % ids.length], seed: k, s1: 1, s2: 0, skipIntro: false }); },
    (f) => [ua[f], ub[f]], UF * ids.length);
  // warm the bonus paths, then measure
  measure(() => newMatch({ data: real, p1: 'johnny', p2: 'johnny', mode: 'brawl', seed: 1, skipIntro: false, s1: 0 }), (f) => [ua[f], 0], 2000);
  let kb = 0;
  const br = measure(() => newMatch({ data: real, p1: ids[kb++ % ids.length], p2: 'johnny', mode: kb % 2 ? 'brawl' : 'heckler', seed: kb, skipIntro: false, s1: 0 }),
    (f) => [ua[f], 0], 6000);
  t.ok(vs.p99 <= BUDGET.stepMs, `real kits + unique streams: step p99 ${(vs.p99 * 1000).toFixed(1)} us <= ${BUDGET.stepMs * 1000} us (mean ${(vs.mean * 1000).toFixed(2)} us)`);
  t.ok(br.p99 <= BUDGET.stepMs, `bonus rounds (4 goons / heckle arcs): step p99 ${(br.p99 * 1000).toFixed(1)} us <= ${BUDGET.stepMs * 1000} us (mean ${(br.mean * 1000).toFixed(2)} us)`);
  realNote = `; real+uniques p99 ${(vs.p99 * 1000).toFixed(1)} us, bonus p99 ${(br.p99 * 1000).toFixed(1)} us`;
} catch (e) {
  t.ok(false, `real-data perf run crashed: ${String((e as Error).message).split(/\r?\n/)[0]}`);
}

// save + checksum
const m = newMatch({ seed: 3 });
const inp = randomInputs(3, 600);
for (let f = 0; f < 600; f++) step(m, inp[f * 2], inp[f * 2 + 1]);
const ring = Array.from({ length: 10 }, () => new Int32Array(m.s.length));
let acc = 0;
for (let k = 0; k < 20000; k++) {
  save(m, ring[k % 10]);
  acc ^= checksum(m);
}
const ITER = 200000;
const t0 = performance.now();
for (let k = 0; k < ITER; k++) {
  save(m, ring[k % 10]);
  acc ^= checksum(m);
}
const perOp = ((performance.now() - t0) * 1000) / ITER;
const t1 = performance.now();
for (let k = 0; k < ITER; k++) load(m, ring[k % 10]);
const loadUs = ((performance.now() - t1) * 1000) / ITER;
t.ok(perOp <= BUDGET.saveChecksumUs, `save + checksum ${perOp.toFixed(3)} us <= ${BUDGET.saveChecksumUs} us`);
t.ok(STATE_INTS <= BUDGET.stateIntsCap, `state ${STATE_INTS} ints (${STATE_INTS * 4} bytes) <= ${BUDGET.stateIntsCap}`);

t.done(`step mean ${(mean * 1000).toFixed(2)} us p50 ${(p50 * 1000).toFixed(1)} us p99 ${(p99 * 1000).toFixed(1)} us max ${(max * 1000).toFixed(1)} us over ${n} steps; save+checksum ${perOp.toFixed(3)} us; load ${loadUs.toFixed(3)} us; state ${STATE_INTS} ints [x${acc & 1}]${realNote}`);
