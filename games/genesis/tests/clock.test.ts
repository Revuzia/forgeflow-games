// GENESIS — the client's interpolated render clock (src/client/worldview.ts, CONTRACT §14): planet spin, sun and
// calendar are evaluated at WorldView.renderTick every frame, so it must advance smoothly and never run backwards,
// whatever the sim's real pace. A deterministic simulation of the real loop: 60 Hz frames with timing jitter, snapshot
// requests ≤ 30 Hz with one in flight, worker replies after a jittered latency carrying the INTEGER tick the sim has
// reached; the sim runs at the requested rate — or slower, like 1000x on a weak machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldView } from '../src/client/worldview.ts';
import { Rng } from '../src/sim/core/rng.ts';
import type { Snapshot } from '../src/sim/types.ts';

function snap(tick: number, speed: number, achieved: number): Snapshot {
  return {
    tick, speed, achievedSpeed: achieved, star: { name: 'Sun', kind: 'G', luminosity: 1, temperature: 5800, radius: 1e4, color: [1, 1, 1], activity: 0 },
    planets: [], ships: [], creatures: [], hand: null, events: [], chronicle: [], content: [], msPerTick: 0, restraint: false, worship: [],
  };
}

interface Run { meanRate: number; jitter: number; backward: number; maxLagS: number }

/** speed = requested multiplier; simRate = ticks per real second the sim actually manages */
function run(speed: number, simRate: number, seed: number): Run {
  const rng = new Rng(seed);
  const view = new WorldView();
  let now = 0;
  let inFlight = false;
  let lastReq = -1e9;
  const pending: { at: number; tick: number }[] = [];
  const simTick = (t: number) => Math.floor((t / 1000) * simRate);
  view.apply(snap(0, speed, 0), 0);
  view.speedChanged(speed);
  const samples: [number, number][] = [];
  let maxLag = 0;
  for (let frame = 0; frame < 60 * 12; frame++) {
    now += 16.667 + (rng.float() - 0.5) * 4;
    // deliver replies that have arrived
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= now) { view.apply(snap(pending[i].tick, speed, simRate / 10), pending[i].at); pending.splice(i, 1); inFlight = false; }
    }
    view.update(now);
    if (now > 2000) {
      samples.push([now, view.renderTick]);
      maxLag = Math.max(maxLag, Math.abs(simTick(now) - view.renderTick) / Math.max(1, simRate));
    }
    // SimClient.pump: ≤ 30 Hz, one in flight; the worker snapshots the tick it has reached and replies 4–30 ms later
    if (!inFlight && now - lastReq >= 1000 / 30) {
      lastReq = now;
      inFlight = true;
      const produced = now + 1 + rng.float() * 3;
      pending.push({ at: produced + 3 + rng.float() * 26, tick: simTick(produced) });
    }
  }
  const rates: number[] = [];
  let backward = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i][0] - samples[i - 1][0], dk = samples[i][1] - samples[i - 1][1];
    if (dk < -1e-9) backward++;
    rates.push((dk / dt) * 1000);
  }
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
  return { meanRate: mean, jitter: sd / Math.max(1e-9, mean), backward, maxLagS: maxLag };
}

for (const [label, speed, simRate] of [['1x', 1, 10], ['10x', 10, 100], ['100x', 100, 1000], ['1000x held at 300x', 1000, 3000]] as const) {
  test(`render clock at ${label}: smooth, monotonic, close behind the sim`, () => {
    const r = run(speed, simRate, 7 + speed);
    assert.equal(r.backward, 0, 'the clock ran backwards');
    assert.ok(Math.abs(r.meanRate - simRate) / simRate < 0.03, `mean rate ${r.meanRate.toFixed(1)} vs sim ${simRate}`);
    // per-frame rate variation: frame-time jitter is ±12 %, integer snapshot ticks and irregular replies add the rest
    assert.ok(r.jitter < 0.2, `per-frame rate jitter ${(r.jitter * 100).toFixed(1)} %`);
    assert.ok(r.maxLagS < 0.25, `render clock strays ${r.maxLagS.toFixed(3)} s from the sim`);
  });
}
