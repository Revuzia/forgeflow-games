// GENESIS — determinism (CONTRACT.md §6.1, §19): same seed + same command log ⇒ same state hash; chunked stepping is
// invisible; save/load round-trips the hash and continues identically; rewind replays the log to the same state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';

// a mid-sized terran world keeps the suite quick while exercising every system (seas, rivers, weather, life)
const OPTS = { seed: 20261008, scenario: 'sandbox', overrides: { n: 24 } };

/** a scripted god: commands at fixed ticks (planet 0 unless given) */
const SCRIPT: [number, Command][] = [
  [120, { k: 'life.forest', lat: 12, lon: 40, radius: 300 }],
  [130, { k: 'weather.paint', kind: 'thunderstorm', lat: 10, lon: 45, radius: 600, duration: 400 }],
  [300, { k: 'terrain.raise', lat: -20, lon: -60, radius: 250, strength: 40 }],
  [301, { k: 'water.add', lat: -18, lon: -58, radius: 200, depth: 3 }],
  [450, { k: 'fire.ignite', lat: 12, lon: 40, radius: 80 }],
  [600, { k: 'water.sea-level', delta: 4 }],
  [700, { k: 'set', path: 'star.luminosity', value: 1.2 }],
  [820, { k: 'life.plant', species: 'wild-grain', lat: 30, lon: 0, radius: 200 }],
];

/** run to `ticks` in chunks of `chunk`, applying the script at its ticks */
function run(ticks: number, chunk: number, script = SCRIPT): Sim {
  const sim = new Sim(OPTS);
  let si = 0;
  while (sim.tick < ticks) {
    while (si < script.length && script[si][0] === sim.tick) {
      const r = sim.applyNow(script[si][1]);
      assert.ok(r.ok, `${script[si][1].k}: ${r.msg}`);
      si++;
    }
    // never step past the next scripted tick
    const next = si < script.length ? script[si][0] : ticks;
    sim.step(Math.min(chunk, next - sim.tick, ticks - sim.tick));
  }
  return sim;
}

test('same seed, same commands: same hash after 1000 ticks', () => {
  const a = run(1000, 1000);
  const b = run(1000, 1000);
  assert.equal(a.tick, 1000);
  assert.equal(a.hash(), b.hash());
  // a different seed really is a different world
  const c = new Sim({ ...OPTS, seed: OPTS.seed + 1 });
  c.step(10);
  assert.notEqual(c.hash(), a.hash());
});

test('chunked stepping 1x1000, 10x100, 1000x1 is identical', () => {
  const h1 = run(1000, 1000).hash();
  const h10 = run(1000, 100).hash();
  const h1000 = run(1000, 1).hash();
  assert.equal(h10, h1);
  assert.equal(h1000, h1);
});

test('queued apply() and applyNow() at the same boundary agree', () => {
  const a = new Sim(OPTS);
  const b = new Sim(OPTS);
  a.step(50);
  b.step(50);
  a.applyNow({ k: 'water.rain', lat: 5, lon: 5, radius: 500 });
  const q = b.apply({ k: 'water.rain', lat: 5, lon: 5, radius: 500 });
  assert.ok(q.ok);
  a.step(200);
  b.step(200);
  assert.equal(a.hash(), b.hash());
  // invalid commands are refused at once with a readable reason
  const bad = b.apply({ k: 'weather.paint', kind: 'thunderstorn', lat: 0, lon: 0 });
  assert.equal(bad.ok, false);
  assert.match(bad.msg ?? '', /thunderstorm/);
});

test('save/load round trip preserves the hash and continues identically (with commands)', () => {
  const a = run(700, 50);
  const bytes = a.save();
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'GNSS');
  const b = Sim.load(bytes);
  assert.equal(b.tick, a.tick);
  assert.equal(b.hash(), a.hash());
  // continue both with the rest of the script and more commands
  for (const sim of [a, b]) {
    sim.applyNow({ k: 'terrain.crater', lat: 40, lon: 100, radius: 150 });
    sim.step(150);
    sim.applyNow({ k: 'weather.global', kind: 'rain' });
    sim.step(150);
  }
  assert.equal(b.hash(), a.hash());
  // the log travelled with the save
  assert.ok(b.u.log.length >= a.u.log.length - 2);
});

test('load refuses foreign bytes and unknown major versions with readable messages', () => {
  assert.throws(() => Sim.load(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])), /not a GENESIS save/);
  const bytes = new Sim({ ...OPTS, overrides: { n: 8 } }).save();
  bytes[5] = 9; // major version 9
  assert.throws(() => Sim.load(bytes), /incompatible GENESIS version/);
});

test('rewind restores the keyframe and replays the command log to the same state', () => {
  const sim = new Sim(OPTS);
  sim.keyframeEvery = 400;
  let si = 0;
  const hashes = new Map<number, string>();
  while (sim.tick < 1200) {
    while (si < SCRIPT.length && SCRIPT[si][0] === sim.tick) sim.applyNow(SCRIPT[si++][1]);
    sim.step(1);
    if (sim.tick === 950) hashes.set(950, sim.hash());
  }
  assert.ok(sim.rewind(950));
  assert.equal(sim.tick, 950);
  assert.equal(sim.hash(), hashes.get(950));
  // the future was discarded: no logged command after the rewind point
  assert.ok(sim.u.log.every((e) => e.tick < 950));
  assert.equal(sim.rewind(5000), false);
});

test('save at every tick of a sea-level ramp in the rain: every loaded copy continues identically', () => {
  // Regression (phase-1 review): a cache of raining land cells filtered by the ocean mask went stale while the mask
  // moved under a sea-level ramp; the live sim and a loaded copy (fresh cache) then diverged.
  const sim = new Sim({ ...OPTS, overrides: { n: 16 } });
  sim.applyNow({ k: 'weather.global', kind: 'rain' });
  sim.step(130);
  sim.applyNow({ k: 'water.sea-level', delta: -9 });
  const saves: Uint8Array[] = [];
  const END = 260;
  while (sim.tick < 200) {
    saves.push(sim.save());
    sim.step(1);
  }
  sim.step(END - sim.tick);
  const want = sim.hash();
  let bad = 0;
  for (const bytes of saves) {
    const b = Sim.load(bytes);
    b.step(END - b.tick);
    if (b.hash() !== want) bad++;
  }
  assert.equal(bad, 0, `${bad} of ${saves.length} loaded copies diverged`);
});

test('a command queued by apply() travels with the save', () => {
  const a = new Sim({ ...OPTS, overrides: { n: 12 } });
  a.step(10);
  assert.ok(a.apply({ k: 'water.sea-level', delta: 30 }).ok);
  const b = Sim.load(a.save());
  assert.equal(b.hash(), a.hash());
  a.step(300);
  b.step(300);
  assert.equal(b.hash(), a.hash());
  assert.equal(b.u.planets[0].st.seaLevel, a.u.planets[0].st.seaLevel);
  assert.equal(b.u.log.length, a.u.log.length);
});

test('rewind through the compressed keyframe chain reproduces every lived keyframe', () => {
  const sim = new Sim({ ...OPTS, overrides: { n: 16 } });
  sim.keyframeEvery = 120;
  const lived = new Map<number, string>([[0, sim.hash()]]);
  let si = 0;
  while (sim.tick < 900) {
    while (si < SCRIPT.length && SCRIPT[si][0] === sim.tick) sim.applyNow(SCRIPT[si++][1]);
    sim.step(1);
    if (sim.tick % 120 === 0 || sim.tick === 655) lived.set(sim.tick, sim.hash());
  }
  const kb = sim.keyframeBytes();
  assert.ok(kb.keyframes >= 7, `${kb.keyframes} keyframes held`);
  // the ring is compressed: well under one raw copy per keyframe
  assert.ok(kb.encoded < kb.raw * (kb.keyframes - 1) * 0.6, `encoded ${kb.encoded} vs raw ${kb.raw} x ${kb.keyframes - 1}`);
  // newest first (short chain), then the oldest (the whole chain), then between keyframes (replay)
  for (const t of [840, 655, sim.rewindRange()[0]]) {
    assert.ok(sim.rewind(t), `rewind to ${t}`);
    assert.equal(sim.hash(), lived.get(t), `state at ${t}`);
  }
});
