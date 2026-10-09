// GENESIS — the worker protocol (CONTRACT.md §14): init -> ready, paced stepping at a speed, snapshots with fields only
// when changed (throttled) and transferable arrays, cmd / parse / step / save / load / rewind / query round trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import type { FromWorker, Snapshot, ToWorker } from '../src/sim/types.ts';

class Client {
  readonly w: Worker;
  private waiting: { pred: (m: FromWorker) => boolean; ok: (m: FromWorker) => void }[] = [];
  snaps: Snapshot[] = [];
  constructor() {
    this.w = new Worker(new URL('./helpers/workerboot.ts', import.meta.url));
    this.w.on('message', (m: FromWorker) => {
      if (m.type === 'snapshot') this.snaps.push(m.snap);
      if (m.type === 'error') throw new Error(`worker error: ${m.msg}`);
      for (let i = 0; i < this.waiting.length; i++) {
        if (this.waiting[i].pred(m)) { this.waiting[i].ok(m); this.waiting.splice(i, 1); return; }
      }
    });
  }
  send(m: ToWorker, transfer: ArrayBuffer[] = []): void { this.w.postMessage(m, transfer); }
  next<T extends FromWorker>(pred: (m: FromWorker) => boolean, ms = 30000): Promise<T> {
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('timeout waiting for the worker')), ms);
      this.waiting.push({ pred, ok: (m) => { clearTimeout(t); ok(m as T); } });
    });
  }
  async call<T extends FromWorker>(m: ToWorker & { id: number }): Promise<T> {
    const p = this.next<T>((x) => 'id' in x && (x as { id: number }).id === m.id);
    this.send(m);
    return p;
  }
  async snapshot(full = false): Promise<Snapshot> {
    const p = this.next<{ type: 'snapshot'; snap: Snapshot }>((x) => x.type === 'snapshot');
    this.send({ type: 'snapshot', full });
    return (await p).snap;
  }
}

test('worker protocol round trip', async () => {
  const c = new Client();
  await c.next((m) => (m as { type: string }).type === '__booted');
  const ready = c.next<{ type: 'ready'; content: string[] }>((m) => m.type === 'ready');
  c.send({ type: 'init', scenario: 'sandbox', seed: 42, options: { overrides: { n: 16 }, speed: 0 } });
  assert.deepEqual((await ready).content, ['base']);
  try {
    // a full snapshot carries every published field as a Float32Array of the grid's size
    const full = await c.snapshot(true);
    assert.equal(full.planets.length, 2);
    const home = full.planets[0];
    assert.equal(home.gridN, 16);
    assert.ok(home.fields?.surface instanceof Float32Array);
    assert.equal(home.fields!.surface!.length, 10 * 16 * 16 + 2);
    assert.ok(home.fields!.water && home.fields!.temperature && home.fields!.biome && home.fields!.windX);
    assert.equal(full.star.kind, 'G');
    // nothing changed since: the next snapshot ships no field arrays
    const quiet = await c.snapshot(false);
    assert.equal(quiet.planets[0].fields, undefined);
    // step 120 ticks (paused world), then fields that changed come again
    const st = await c.call<{ type: 'stepped'; id: number; tick: number }>({ type: 'step', id: 1, ticks: 120 });
    assert.equal(st.tick, 120);
    const soon = await c.snapshot(false);
    assert.equal(soon.tick, 120);
    assert.equal(soon.planets[0].fields?.temperature, undefined, 'slow fields are throttled (~500 ms)');
    await new Promise((ok) => setTimeout(ok, 550));
    const after = await c.snapshot(false);
    assert.ok(after.planets[0].fields?.temperature, 'temperature changed and was sent once the throttle allowed');
    // commands, parse, query
    const r = await c.call<{ type: 'result'; id: number; result: { ok: boolean; msg?: string } }>({ type: 'cmd', id: 2, cmd: { k: 'water.rain', lat: 10, lon: 10 } });
    assert.ok(r.result.ok, r.result.msg);
    const bad = await c.call<{ type: 'result'; id: number; result: { ok: boolean; msg?: string } }>({ type: 'cmd', id: 3, cmd: { k: 'terrain.rase', lat: 0, lon: 0 } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.msg ?? '', /terrain\.raise/);
    const parsed = await c.call<{ type: 'parsed'; id: number; result: { ok: boolean; resolved?: { k: string }[] } }>({ type: 'parse', id: 4, text: 'set gravity to 5' });
    assert.ok(parsed.result.ok);
    assert.equal(parsed.result.resolved?.[0].k, 'set');
    const cell = await c.call<{ type: 'answer'; id: number; data: { biome: { id: string } } }>({ type: 'query', id: 5, q: 'cell', args: { lat: 0, lon: 0 } });
    assert.ok(cell.data.biome.id);
    // save, then load the bytes back
    const saved = await c.call<{ type: 'saved'; id: number; data: ArrayBuffer }>({ type: 'save', id: 6 });
    assert.ok(saved.data.byteLength > 1000);
    const hashBefore = await c.call<{ type: 'answer'; id: number; data: string }>({ type: 'query', id: 7, q: 'hash' });
    const loaded = await c.call<{ type: 'loaded'; id: number; ok: boolean; msg?: string }>({ type: 'load', id: 8, data: saved.data });
    assert.ok(loaded.ok, loaded.msg);
    const hashAfter = await c.call<{ type: 'answer'; id: number; data: string }>({ type: 'query', id: 9, q: 'hash' });
    assert.equal(hashAfter.data, hashBefore.data);
    // run at speed: ticks advance on their own, and the achieved multiplier is measured
    c.send({ type: 'speed', speed: 100 });
    await new Promise((ok) => setTimeout(ok, 1500));
    const live = await c.snapshot(false);
    assert.ok(live.tick > 300, `paced stepping advanced to ${live.tick}`);
    assert.ok(live.achievedSpeed > 10, `achieved ${live.achievedSpeed.toFixed(0)}x`);
    assert.ok(live.msPerTick > 0);
    c.send({ type: 'speed', speed: 0 });
    // rewind: the save carried its rewind history, so the loaded world reaches back past the load point (tick 120)
    const rw = await c.call<{ type: 'result'; id: number; result: { ok: boolean; tick?: number } }>({ type: 'rewind', id: 10, tick: 200 });
    assert.ok(rw.result.ok);
    assert.equal(rw.result.tick, 200);
    const before = await c.call<{ type: 'result'; id: number; result: { ok: boolean; tick?: number } }>({ type: 'rewind', id: 13, tick: 60 });
    assert.ok(before.result.ok, 'a moment before the load is still in reach');
    assert.equal(before.result.tick, 60);
    // the future is not
    const tooFar = await c.call<{ type: 'result'; id: number; result: { ok: boolean; msg?: string } }>({ type: 'rewind', id: 12, tick: 1e9 });
    assert.equal(tooFar.result.ok, false);
    // a broken mod pack is refused with the reason
    const mod = await c.call<{ type: 'result'; id: number; result: { ok: boolean; msg?: string } }>({ type: 'mod', id: 11, pack: { id: 'bad', plants: [{ id: 'x', name: 'X', type: 'tre' }] } });
    assert.equal(mod.result.ok, false);
    assert.match(mod.result.msg ?? '', /type/);
  } finally {
    await c.w.terminate();
  }
});

test('worker pacing: sleeps when it keeps up (no busy spin at 10x / 100x), answers promptly when it cannot keep up', async () => {
  const c = new Client();
  await c.next((m) => (m as { type: string }).type === '__booted');
  const ready = c.next((m) => m.type === 'ready');
  c.send({ type: 'init', scenario: 'barren', seed: 3, options: { overrides: { n: 16 }, speed: 0 } });
  await ready;
  try {
    for (const speed of [10, 100]) {
      c.send({ type: 'speed', speed });
      await new Promise((ok) => setTimeout(ok, 600));
      const s0 = await c.snapshot(false);
      const u0 = c.w.performance.eventLoopUtilization();
      await new Promise((ok) => setTimeout(ok, 1500));
      const u1 = c.w.performance.eventLoopUtilization(u0);
      const s1 = await c.snapshot(false);
      const tps = (s1.tick - s0.tick) / 1.5;
      assert.ok(tps > 10 * speed * 0.7, `${speed}x runs ${tps.toFixed(0)} ticks/s`);
      // the barren n=16 sim needs ~1 % of a core here; a self-reposting loop showed 100 %
      assert.ok(u1.utilization < 0.5, `${speed}x: worker busy ${(u1.utilization * 100).toFixed(0)} % of the time`);
    }
    // flat out (a pace no sim can hold, so every slice runs its full budget): messages still get through between slices
    // (a MessagePort self-post loop held them back ~13 s in Node)
    c.send({ type: 'speed', speed: 100000 });
    await new Promise((ok) => setTimeout(ok, 300));
    const t0 = performance.now();
    const ans = await c.call<{ type: 'answer'; id: number; data: unknown }>({ type: 'query', id: 1, q: 'scenario' });
    const ms = performance.now() - t0;
    assert.ok(ans.data, 'answered');
    assert.ok(ms < 1000, `a query waited ${ms.toFixed(0)} ms while the sim ran flat out`);
    c.send({ type: 'speed', speed: 1 });
    await new Promise((ok) => setTimeout(ok, 3500));
    const s = await c.snapshot(false);
    assert.equal(s.achievedSpeed, 1, `a steady 1x reads ${s.achievedSpeed}`);
  } finally {
    await c.w.terminate();
  }
});
