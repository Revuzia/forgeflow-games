// PERF session 5 — the overlay's performance report (src/render/perfreport.ts): frame percentiles, hitches with their
// context, GPU ms per pass group from timer queries (a fake EXT_disjoint_timer_query_webgl2 here), and a graceful
// report without the extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfRecorder, GPU_SLOTS } from '../src/render/perfreport.ts';

const SLOTS = ['planets', 'actors', 'shadows', 'scene', 'post', 'other'] as const;

function fakeGl(withTimer: boolean) {
  let id = 0, open: { id: number; ms: number } | null = null;
  const done = new Map<number, number>();
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  return {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: (n: string) => (withTimer && n === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
    createQuery: () => ({ id: ++id }),
    deleteQuery: () => {},
    beginQuery: (_t: number, q: { id: number }) => { open = { id: q.id, ms: 2 }; },
    endQuery: () => { if (open) done.set(open.id, open.ms * 1e6); open = null; },
    getParameter: () => false,
    getQueryParameter: (q: { id: number }, p: number) => (p === 1 ? done.has(q.id) : done.get(q.id)),
  };
}

function run(withTimer: boolean): string {
  const r = new PerfRecorder(SLOTS);
  r.attach(fakeGl(withTimer) as unknown as WebGL2RenderingContext);
  r.env = { gpu: 'TestGPU', preset: 'high', canvas: '888x500', dpr: 2 };
  let text = '';
  r.start(1e9, (t) => { text = t; });
  const slots = new Float64Array(SLOTS.length);
  for (let f = 0; f < 120; f++) {
    r.frameBegin();
    for (const s of GPU_SLOTS) { r.gpuBegin(s); r.gpuEnd(s); }
    const hitch = f === 60;
    slots.fill(1); slots[0] = hitch ? 70 : 2;
    r.frameDone(hitch ? 90 : 16.7, hitch ? 80 : 8, slots, { drawCalls: 250, triangles: 3e6, shadowTris: 2e6, patchesBuilt: f * 2, altitude: 200, cam: [f, 0, 0], speed: 1, programs: hitch ? 3 : 0 });
  }
  r.stop();
  return text || r.report;
}

test('the report has percentiles, the hitch with its context, and GPU ms per pass', () => {
  const t = run(true);
  assert.match(t, /^GENESIS perf report v1/);
  assert.match(t, /gpu: TestGPU \| preset high \| canvas 888x500 \| dpr 2/);
  assert.match(t, /frame ms: p50 16\.7 .*>50ms 1/);
  assert.match(t, /gpu ms \(mean\/p95\): planets 2\/2 actors 2\/2 shadows 2\/2 scene 2\/2 post 2\/2 \| total 10\/10/);
  assert.match(t, /hitches >50ms: 1/);
  assert.match(t, /t \d+(\.\d)?s 90 ms: main 80 \[planets 70.*\+prog 3/);
  assert.ok(t.split('\n').length < 30, 'compact');
});

test('without the timer extension the report still comes, and says so', () => {
  const t = run(false);
  assert.match(t, /gpu ms: no timer query in this browser/);
  assert.match(t, /frame ms: p50 16\.7/);
});

test('bisection: GPU ms per named pass inside scene / post (timer queries split at each mark, never nested)', () => {
  const r = new PerfRecorder(SLOTS);
  r.attach(fakeGl(true) as unknown as WebGL2RenderingContext);
  let text = '';
  r.start(1e9, (t) => { text = t; });
  const slots = new Float64Array(SLOTS.length);
  for (let f = 0; f < 20; f++) {
    r.frameBegin();
    r.gpuBegin('shadows'); r.gpuMark('post:nope'); r.gpuEnd('shadows');
    r.gpuBegin('scene'); r.gpuMark('scene:opaque'); r.gpuEnd('scene');
    r.gpuBegin('post'); r.gpuMark('post:clouds'); r.gpuMark('post:atmo'); r.gpuEnd('post');
    slots.fill(1);
    r.frameDone(16.7, 8, slots, { drawCalls: 1, triangles: 1, shadowTris: 0, patchesBuilt: 0, altitude: 1, cam: [0, 0, 0], speed: 1, programs: 0 });
  }
  r.stop();
  const t = text || r.report;
  // each query of the fake lasts 2 ms: scene = 'scene' + 'scene:opaque', post = 'post' + clouds + atmo
  assert.match(t, /gpu ms \(mean\/p95\): planets 0\/0 actors 0\/0 shadows 2\/2 scene 4\/4 post 6\/6/);
  assert.match(t, /gpu ms by pass .*scene 2\/2 · scene:opaque 2\/2 · post 2\/2 · post:clouds 2\/2 · post:atmo 2\/2/);
  assert.doesNotMatch(t, /post:nope/);
});
