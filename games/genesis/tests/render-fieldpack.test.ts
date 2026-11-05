// macfix r1: the field-texture packing runs in a helper worker after the first fill (fieldpack.ts / fieldtex.ts). The
// worker's bytes must equal the main thread's: an in-process stand-in for the worker (structured clones, the same
// handlePackMessage the worker runs) against a FieldTextures that packs synchronously, over a run of field changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { WorldView } from '../src/client/worldview.ts';
import { FieldTextures, type PackPort } from '../src/render/planet/fieldtex.ts';
import { handlePackMessage, type PackReply, type PackRequest, type PackState } from '../src/render/planet/fieldpack.ts';

/** a worker in this thread: messages queue until flush(), and cross by structured clone as they would */
function fakePort(): PackPort & { flush(): number; queued(): number } {
  const state: PackState = new Map();
  const subs = new Map<number, (r: PackReply) => void>();
  const q: PackRequest[] = [];
  return {
    send: (m) => { q.push(structuredClone(m)); },
    listen: (id, reply) => { subs.set(id, reply); },
    unlisten: (id) => { subs.delete(id); },
    queued: () => q.length,
    flush: () => {
      let jobs = 0;
      while (q.length) {
        const r = handlePackMessage(state, q.shift()!);
        if (r) { jobs++; subs.get(r.reply.id)?.(structuredClone(r.reply)); }
      }
      return jobs;
    },
  };
}

test('fieldpack: the worker path packs the same bytes as the main thread, and the main thread does not pack', () => {
  const sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 32 } });
  sim.step(20);
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  const pv = view.planet(sim.u.planets[0].id)!;
  const port = fakePort();
  const sync = new FieldTextures(pv, null);
  const asy = new FieldTextures(pv, port);
  sync.update(); asy.update();
  assert.equal(port.queued(), 0, 'the first fill is synchronous (nothing posted)');
  const same = (why: string) => {
    for (const k of Object.keys(sync.tex) as (keyof typeof sync.tex)[]) {
      assert.deepEqual(Buffer.from((asy.tex[k].image.data as Float32Array).buffer), Buffer.from((sync.tex[k].image.data as Float32Array).buffer), `${why}: ${k}`);
    }
    assert.deepEqual(asy.waterLevel, sync.waterLevel, `${why}: waterLevel`);
    assert.deepEqual(asy.waterDepth, sync.waterDepth, `${why}: waterDepth`);
    assert.equal(asy.geomVersion, sync.geomVersion, `${why}: geomVersion`);
  };
  same('first fill');
  let t = 0;
  for (let round = 0; round < 6; round++) {
    sim.step(30);
    t += 1000;
    view.apply(sim.snapshot({}), t);
    // every field touched once, as arrivals do (surface / water / cover / climate / flow / species / ore / wind)
    for (const f of ['surface', 'water', 'grass', 'temperature', 'flowX', 'biome', 'ore', 'windX', 'lava', 'ash'] as const) pv.fieldVersion.set(f, (pv.fieldVersion.get(f) ?? 0) + 1);
    sync.update();
    const before = Object.fromEntries(Object.entries(asy.tex).map(([k, tx]) => [k, tx.version]));
    asy.update();
    assert.ok(port.queued() > 0, 'changes go to the worker');
    assert.deepEqual(Object.fromEntries(Object.entries(asy.tex).map(([k, tx]) => [k, tx.version])), before, 'nothing uploaded before the job lands');
    // a second update while the job is in flight posts nothing more
    const q = port.queued();
    asy.update();
    assert.equal(port.queued(), q, 'one job in flight');
    assert.ok(port.flush() >= 1);
    asy.update();
    same(`round ${round}`);
  }
  assert.ok(asy.landed >= 6);
});

test('fieldpack: a worker that fails hands the packing back to the main thread', () => {
  const sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 32 } });
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  const pv = view.planet(sim.u.planets[0].id)!;
  let fail = (): void => {};
  const port: PackPort = { send: () => {}, listen: (_id, _r, f) => { fail = f; }, unlisten: () => {} };
  const ft = new FieldTextures(pv, port);
  const ref = new FieldTextures(pv, null);
  ft.update(); ref.update();
  pv.fieldVersion.set('grass', (pv.fieldVersion.get('grass') ?? 0) + 1);
  ft.update(); ref.update();
  const v = ft.tex.V.version;
  fail();
  ft.update();
  assert.ok(ft.tex.V.version > v, 'the lost job refilled here');
  assert.deepEqual(Buffer.from((ft.tex.V.image.data as Float32Array).buffer), Buffer.from((ref.tex.V.image.data as Float32Array).buffer));
});
