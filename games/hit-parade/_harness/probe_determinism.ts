// probe_determinism (G2, lane SIM): same seed + same input streams => identical checksums, every
// frame (CONTRACT §4.1, NETCODE §4). Also: identical event streams; a different input stream
// diverges (the check can fail); save -> step -> load -> re-step EVERY frame reproduces the straight
// run exactly (0 mismatches); state size <= 1024 ints. Fixture pairs always; real data/ pairs too
// when data/ loads (reported separately).
import { fixtureData, newMatch, randomInputs, tester } from './fixtures/simkit.ts';
import { step, save, load, checksum } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { loadGameData } from '../runtime/src/core/data.ts';
import type { GameData } from '../runtime/src/core/types.ts';
import { eventsSince } from '../runtime/src/core/sim/events.ts';
import type { SimEvent } from '../runtime/src/core/sim/events.ts';
import { STATE_INTS, W, PH } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_determinism');
const FRAMES = 12000;

function runStream(m: Match, inp: Int32Array, frames: number, sums: Uint32Array, evOut: SimEvent[] | null): void {
  for (let f = 0; f < frames; f++) {
    step(m, inp[f * 2], inp[f * 2 + 1]);
    sums[f] = checksum(m);
    if (evOut) eventsSince(m.events, m.frame(), evOut);
  }
}

function evKey(e: SimEvent): string {
  return `${e.frame}:${e.type}:${e.a}:${e.b}:${e.c}:${e.d}`;
}

interface PairResult { twinDiff: number; evDiff: number; diverged: boolean; saveLoadMismatch: number; finalHash: number; matchesEnded: number }

function checkPair(data: GameData, p1: string, p2: string, seed: number): PairResult {
  const inp = randomInputs(seed, FRAMES);
  const mk = (): Match => newMatch({ data, p1, p2, seed, skipIntro: false });
  // twin straight runs
  const a = mk();
  const b = mk();
  const sa = new Uint32Array(FRAMES);
  const sb2 = new Uint32Array(FRAMES);
  const ea: SimEvent[] = [];
  const eb: SimEvent[] = [];
  let ended = 0;
  for (let f = 0; f < FRAMES; f++) {
    step(a, inp[f * 2], inp[f * 2 + 1]);
    step(b, inp[f * 2], inp[f * 2 + 1]);
    sa[f] = checksum(a);
    sb2[f] = checksum(b);
    eventsSince(a.events, a.frame(), ea);
    eventsSince(b.events, b.frame(), eb);
    if (a.s[W.phase] === PH.MATCH_END) {
      // start a fresh match on both (same seed) so the stream keeps exercising the sim
      ended++;
      const na = mk();
      const nb = mk();
      a.s.set(na.s);
      b.s.set(nb.s);
    }
  }
  let twinDiff = 0;
  for (let f = 0; f < FRAMES; f++) if (sa[f] !== sb2[f]) twinDiff++;
  let evDiff = ea.length === eb.length ? 0 : Math.abs(ea.length - eb.length);
  for (let k = 0; k < Math.min(ea.length, eb.length); k++) if (evKey(ea[k]) !== evKey(eb[k])) evDiff++;
  // a different stream must diverge
  const c = mk();
  const sc = new Uint32Array(2000);
  runStream(c, randomInputs(seed + 1000, 2000), 2000, sc, null);
  let diverged = false;
  for (let f = 0; f < 2000; f++) if (sc[f] !== sa[f]) diverged = true;
  // save / step / load / re-step every frame vs the straight run
  const d = mk();
  const slot = new Int32Array(d.s.length);
  let mism = 0;
  const N = 3000;
  for (let f = 0; f < N; f++) {
    save(d, slot);
    step(d, inp[f * 2], inp[f * 2 + 1]);
    const c1 = checksum(d);
    load(d, slot);
    step(d, inp[f * 2], inp[f * 2 + 1]);
    const c2 = checksum(d);
    if (c1 !== c2 || c1 !== sa[f]) mism++;
    if (d.s[W.phase] === PH.MATCH_END) break;
  }
  return { twinDiff, evDiff, diverged, saveLoadMismatch: mism, finalHash: sa[FRAMES - 1], matchesEnded: ended };
}

t.ok(STATE_INTS <= 1024, `versus state = ${STATE_INTS} ints (<= 1024 hard cap)`);

const fx = fixtureData();
const pairs: [string, string][] = [['kit_a', 'kit_b'], ['kit_b', 'kit_a'], ['kit_a', 'kit_a']];
let hashes: string[] = [];
for (const [p1, p2] of pairs) {
  for (const seed of [1, 2]) {
    const r = checkPair(fx, p1, p2, seed);
    t.eq(r.twinDiff, 0, `${p1} vs ${p2} seed ${seed}: twin runs identical checksums (${FRAMES} frames, ${r.matchesEnded} matches ended)`);
    t.eq(r.evDiff, 0, `${p1} vs ${p2} seed ${seed}: identical event streams`);
    t.ok(r.diverged, `${p1} vs ${p2} seed ${seed}: a different input stream diverges`);
    t.eq(r.saveLoadMismatch, 0, `${p1} vs ${p2} seed ${seed}: save/step/load/re-step every frame == straight run`);
    hashes.push(r.finalHash.toString(16));
  }
}
// run the first pair again: same hash twice
const again = checkPair(fx, 'kit_a', 'kit_b', 1);
t.eq(again.finalHash, parseInt(hashes[0], 16), 'same seed => same final hash twice');

// real data (reported separately; skipped with a note when data/ does not load yet)
let realNote = 'real data/: not loaded';
try {
  const real = loadGameData();
  const ids = Object.keys(real.fighters).sort();
  if (ids.length >= 2) {
    const rp: [string, string][] = [[ids[0], ids[1]], [ids[ids.length - 1], ids[0]]];
    for (const [p1, p2] of rp) {
      const r = checkPair(real, p1, p2, 7);
      t.eq(r.twinDiff, 0, `real ${p1} vs ${p2}: twin runs identical`);
      t.eq(r.saveLoadMismatch, 0, `real ${p1} vs ${p2}: save/load/re-step == straight run`);
    }
    realNote = `real data/: ${ids.length} fighters, pairs ${rp.map((p) => p.join('-')).join(', ')}`;
  }
} catch (e) {
  realNote = `real data/ failed to load: ${String((e as Error).message).split('\n')[0]}`;
  t.note(realNote);
}

t.done(`fixture final hashes ${hashes.join(' ')}; ${realNote}`);
