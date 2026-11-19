// `?bench=` (render/bench.ts): the plans and their URL encodings, the interleaved order, a step's URL, what is read out
// of a perf report, and the per-variant median / min / max the results panel shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCH_PLANS, BENCH_WHEEL, aggregate, benchWarnings, decodePlan, encodePlan, encodeVariantList, estimateSeconds, frameStats, landingDist, median,
  parseBench, parseReport, parseVariantList, resultsText, settleFor, stepOrder, stepSearch, tcstatOf, usesTcache, type BenchResult, type BenchRun,
} from '../src/render/bench.ts';
import { PerfRecorder } from '../src/render/perfreport.ts';

test('built-in plans: water, terrain, full hold the open questions', () => {
  const P = 'scene=0&shadows=0';
  assert.deepEqual(BENCH_PLANS.water.map((v) => v.params), [P, `${P}&wfast=3`, `${P}&wfast=3&wshade3=nossr`, `${P}&wfrag=0`, `${P}&water=0`]);
  const T = BENCH_PLANS.terrain.map((v) => v.params);
  const FIX = 'tcache=1&wfast=3&deepbed=1';
  assert.deepEqual(T.slice(0, 3), ['', 'tcache=1', FIX]);
  for (const cut of ['water=0', 'shadows=0', 'msaa=0', 'hide=veg,cover,life', 'scene=0&shadows=0', 'rscale=0.5']) assert.ok(T.includes(`${FIX}&${cut}`), cut);
  assert.deepEqual(BENCH_PLANS.full.map((v) => v.params), ['', FIX]);
  // labels are unique inside a plan (the summary is keyed by them)
  for (const [name, vs] of Object.entries(BENCH_PLANS)) assert.equal(new Set(vs.map((v) => v.label)).size, vs.length, name);
});

test('bv list: label~params, ; and : in place of & and =, round trip', () => {
  const vs = parseVariantList('N~|fast~wfast:3;wshade3:nossr|nowater~water=0&scene=0|hide:veg,cover,life|base');
  assert.deepEqual(vs, [
    { label: 'N', params: '' },
    { label: 'fast', params: 'wfast=3&wshade3=nossr' },
    { label: 'nowater', params: 'water=0&scene=0' },
    { label: 'hide:veg,cover,life', params: 'hide=veg,cover,life' },
    { label: 'base', params: '' },
  ]);
  assert.deepEqual(parseVariantList(encodeVariantList(vs)), vs);
  // the encoded list survives a URL as it is (no character needs escaping but | which browsers escape themselves)
  const url = new URL(`http://x/?bench=custom&bv=${encodeVariantList(vs)}`);
  assert.deepEqual(parseBench(url.search).variants, vs);
  // a percent-encoded fragment means the same; duplicate labels are numbered; empty parts are dropped
  assert.deepEqual(parseBench('?bench=custom&bv=' + encodeURIComponent('a~x=1&y=2|a~x=2||')).variants, [{ label: 'a', params: 'x=1&y=2' }, { label: 'a#2', params: 'x=2' }]);
});

test('bench=<base64url JSON> and bench=<JSON>: lists, objects, timings', () => {
  const vs = [{ label: 'N', params: '' }, { label: 'fix é', params: 'tcache=1&wfast=3' }];
  const code = encodePlan(vs);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePlan(code)?.variants, vs);
  const p = parseBench(`?bench=${code}`);
  assert.equal(p.name, 'custom');
  assert.deepEqual(p.variants, vs);
  assert.deepEqual(p.errors, []);
  const full = encodePlan({ name: 'round21', variants: vs, reps: 5, settle: 10, rec: 8, base: 'wclock=100' });
  const q = parseBench(`?bench=${full}&gltrace=0`);
  assert.equal(q.name, 'round21');
  assert.equal(q.opts.reps, 5);
  assert.equal(q.opts.settle, 10);
  assert.equal(q.opts.settleTc, 20);
  assert.equal(q.opts.rec, 8);
  assert.match(q.base, /gltrace=0/);
  assert.match(q.base, /wclock=100/);
  // raw JSON in the URL, pairs or objects
  assert.deepEqual(parseBench('?bench=' + encodeURIComponent('[["a","x=1"],{"label":"b","params":"y=2"}]')).variants, [{ label: 'a', params: 'x=1' }, { label: 'b', params: 'y=2' }]);
  // nonsense names an error and runs nothing
  const bad = parseBench('?bench=nosuchplan');
  assert.equal(bad.variants.length, 0);
  assert.match(bad.errors[0], /unknown plan/);
  assert.match(parseBench('?bench=custom').errors[0], /needs a list/);
});

test('parseBench: defaults, overrides, the base and the forced preset', () => {
  const d = parseBench('?bench=water');
  assert.equal(d.name, 'water');
  assert.deepEqual(d.opts, { reps: 3, settle: 30, settleTc: 60, rec: 15, load: 240, preset: 'ultra', order: 'seq', focus: false, dist: null, cam: '', auto: true });
  assert.equal(d.base, 'scenario=babel&seed=307987276');
  const o = parseBench('?bench=TERRAIN&breps=2&bsettle=5&brec=2.5&bload=60&bpreset=High&border=rot&bfocus=0&bdist=80&bauto=0&scenario=lookdev&seed=7&gltrace=0&bv=extra~flat:1');
  assert.equal(o.name, 'terrain');
  assert.equal(o.variants.length, BENCH_PLANS.terrain.length + 1);
  assert.deepEqual(o.variants.at(-1), { label: 'extra', params: 'flat=1' });
  assert.deepEqual(o.opts, { reps: 2, settle: 5, settleTc: 10, rec: 2.5, load: 60, preset: 'high', order: 'rot', focus: false, dist: 80, cam: '', auto: false });
  assert.equal(o.base, 'scenario=lookdev&seed=7&gltrace=0');
  assert.equal(parseBench('?bench=full&bsettle=5&bsettletc=7').opts.settleTc, 7);
  // a quality in the launch URL is the preset unless bpreset says otherwise
  assert.equal(parseBench('?bench=full&quality=low').opts.preset, 'low');
  assert.equal(parseBench('?bench=full&quality=low&bpreset=ultra').opts.preset, 'ultra');
  assert.doesNotMatch(parseBench('?bench=full&quality=low').base, /quality/);
  // a bad number and a bad camera are said, not fatal
  const e = parseBench('?bench=full&breps=many&bcam=nope');
  assert.equal(e.opts.reps, 3);
  assert.equal(e.opts.cam, '');
  assert.equal(e.errors.length, 2);
  assert.equal(parseBench('?bench=full&bcam=' + encodeURIComponent('{"mode":"orbit","dist":90}')).opts.cam, '{"mode":"orbit","dist":90}');
});

test('stepOrder: interleaved repeats, not one variant after another', () => {
  assert.deepEqual(stepOrder(3, 3), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
  assert.deepEqual(stepOrder(3, 3, 'rot'), [0, 1, 2, 1, 2, 0, 2, 0, 1]);
  assert.deepEqual(stepOrder(2, 1), [0, 1]);
});

test('stepSearch: the variant over the base, the preset, the bookkeeping', () => {
  const base = 'scenario=babel&seed=307987276&wfast=1';
  const s = new URLSearchParams(stepSearch(base, { label: 'x', params: 'scene=0&wfast=3&hide=veg,cover' }, 'ultra', 'r1', 4));
  assert.equal(s.get('scenario'), 'babel');
  assert.equal(s.get('seed'), '307987276');
  assert.equal(s.get('wfast'), '3');
  assert.equal(s.get('hide'), 'veg,cover');
  assert.equal(s.get('quality'), 'ultra');
  assert.equal(s.get('bench'), 'run');
  assert.equal(s.get('brun'), 'r1');
  assert.equal(s.get('bstep'), '4');
  // a variant's own quality wins over the forced preset
  assert.equal(new URLSearchParams(stepSearch(base, { label: 'h', params: 'quality=high' }, 'ultra', 'r1', 0)).get('quality'), 'high');
  assert.equal(new URLSearchParams(stepSearch(base, { label: '', params: '' }, 'ultra', 'r1', 'done')).get('bstep'), 'done');
});

test('tcache variants settle longer; the estimate adds up', () => {
  const plan = parseBench('?bench=terrain');
  assert.equal(usesTcache(plan.base, plan.variants[0]), false);
  assert.equal(usesTcache(plan.base, plan.variants[1]), true);
  assert.equal(usesTcache('tcache=1', { label: 'N', params: '' }), true);
  assert.equal(usesTcache('tcache=1', { label: 'off', params: 'tcache=0' }), false);
  assert.equal(settleFor(plan, plan.variants[0]), 30);
  assert.equal(settleFor(plan, plan.variants[2]), 60);
  // 9 variants x 3: N settles 30 s, the other eight 60 s; + 15 s recorded, 25 s load, 2 s between
  assert.equal(estimateSeconds(plan, stepOrder(9, 3)), 3 * ((30 + 42) + 8 * (60 + 42)));
  assert.equal(estimateSeconds(plan, stepOrder(9, 3), 26, 10), 60 + 27);
});

test('the landing: the hand protocol\'s wheel zoom as a distance', () => {
  assert.equal(BENCH_WHEEL, -3040);
  const R = 6000;
  assert.ok(Math.abs(landingDist(R) - R * 2.6 * Math.exp(-3040 * 0.0013)) < 1e-9);
  assert.equal(landingDist(1), 2);
});

test('frameStats, median, tcstatOf', () => {
  assert.deepEqual(frameStats([]), { fps: 0, p50: 0, p95: 0, frames: 0 });
  assert.deepEqual(frameStats([100, 100, 100, 100]), { fps: 10, p50: 100, p95: 100, frames: 4 });
  // 19 frames of 16.7 ms and one of 200: the mean moves, the median does not (NaN and zero intervals are dropped)
  const s = frameStats([...new Array<number>(19).fill(16.7), 200, NaN, 0]);
  assert.equal(s.frames, 20);
  assert.equal(s.p50, 16.7);
  assert.equal(s.p95, 200);
  assert.equal(s.fps, 38.7);
  // with the window's span: frames over the time, a frame still in flight at the end counts as time without a frame
  assert.deepEqual(frameStats([198], 8200), { fps: 0.1, p50: 198, p95: 198, frames: 1 });
  assert.equal(frameStats(new Array<number>(150).fill(100), 15040).fps, 10);
  // (a span shorter than the intervals themselves is not believed)
  assert.equal(frameStats([100, 100], 50).fps, 10);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(tcstatOf('span=0 tcache=1(247MB,9L) tcstat=pix=98.2%,used=140MB,tiles=742 zcons=1'), 'pix=98.2%,used=140MB,tiles=742');
  assert.equal(tcstatOf('span=0 tcache=0 zcons=1'), '');
});

test('parseReport reads the real report\'s HEADLINE, fixes line and build', () => {
  const rec = new PerfRecorder(['scene', 'other']);
  rec.start(1e9);
  const slots = new Float64Array(2);
  for (let i = 0; i < 12; i++) { rec.frameBegin(); rec.frameDone(100, 10, slots, null); }
  rec.env = { gpu: 'ANGLE (Apple, M5)', preset: 'ultra', canvas: '1686x963 (css 1686x963, render 1686x963)', dpr: 1 };
  rec.stop();
  const p = parseReport(rec.report);
  assert.equal(p.fps, 10);
  assert.equal(p.p50, 100);
  assert.equal(p.p95, 100);
  assert.equal(p.mainMs, 10);
  assert.equal(typeof p.fixes, 'string');
  assert.equal(p.build, 'dev');
  assert.equal(p.gpu, 'ANGLE (Apple, M5)');
  assert.equal(p.canvas, '1686x963 (css 1686x963, render 1686x963) dpr 1 preset ultra');
  // a Mac round's lines
  const mac = ['GENESIS perf report v2 · 2026-11-19T03:12:01Z · 20 s · 150 frames · build e0f6caa1 built 2026-11-19T02:40Z',
    'HEADLINE: fps 7.5 | interval p50 133 p95 151.2 ms | main 9.4 ms/frame = 7% of wall (the rest waits: GPU / GPU process / vsync) | long tasks 0, 0 ms, NOT in main 0 ms = 0 ms/s',
    'perf fixes (A/B switches, effective): scene=0 shadows=0 tcache=1(247MB,9L) tcstat=pix=97%,used=120MB wfast=3',
    'machine (fill in from Activity Monitor): memory pressure colour ___ || page: js heap 782 MB | deviceMemory 8 GB',
    'js heap by owner (MB; usedJSHeapSize counts ArrayBuffers): attributed 300 of used 782 | unattributed 482'].join('\n');
  const m = parseReport(mac);
  assert.deepEqual([m.fps, m.p50, m.p95, m.mainMs, m.heapMB], [7.5, 133, 151.2, 9.4, 782]);
  assert.equal(m.tcstat, 'pix=97%,used=120MB');
  assert.equal(m.build, 'e0f6caa1 built 2026-11-19T02:40Z');
  assert.match(m.heapOwners ?? '', /^js heap by owner .* unattributed 482$/);
  assert.deepEqual(parseReport('nothing here'), {});
});

function step(i: number, variant: number, rep: number, label: string, fps: number, p50: number, more: Partial<BenchResult> = {}): BenchResult {
  return { step: i, variant, rep, label, params: variant ? 'x=1' : '', ok: true, fps, p50, p95: p50 * 1.2, frames: 100, mainMs: 5 + variant, build: 'b1', canvas: '1686x963 (css) dpr 1 preset ultra', alt: 59.7, at: '2026-11-19T10:00:00Z', report: `report of step ${i + 1}`, ...more };
}

test('aggregate: median / min / max per variant across valid repeats; failed and invalid steps left out', () => {
  const variants = [{ label: 'A', params: '' }, { label: 'B', params: 'x=1' }, { label: 'C', params: 'x=1' }];
  const R: BenchResult[] = [
    step(0, 0, 0, 'A', 7.5, 133), step(1, 1, 0, 'B', 12.3, 82), { step: 2, variant: 2, rep: 0, label: 'C', params: 'x=1', ok: false, fail: 'not loaded after 240 s' },
    step(3, 0, 1, 'A', 2.9, 350), step(4, 1, 1, 'B', 11.6, 86, { invalid: 'page hidden during the recording' }), step(5, 2, 1, 'C', 18, 51),
    step(6, 0, 2, 'A', 6.1, 167), step(7, 1, 2, 'B', 9.9, 100),
  ];
  const rows = aggregate(variants, R, 3);
  assert.deepEqual(rows[0].fps, { med: 6.1, min: 2.9, max: 7.5 });
  assert.deepEqual(rows[0].p50, { med: 167, min: 133, max: 350 });
  assert.equal(rows[0].n, 3);
  assert.equal(rows[0].vsFirst, 1);
  // B: the hidden step does not count; an even count takes the mean of the middle two
  assert.deepEqual(rows[1].fps, { med: 11.1, min: 9.9, max: 12.3 });
  assert.deepEqual(rows[1].p50, { med: 91, min: 82, max: 100 });
  assert.deepEqual([rows[1].n, rows[1].invalid, rows[1].failed, rows[1].run, rows[1].planned], [2, 1, 0, 3, 3]);
  assert.equal(rows[1].vsFirst, 1.82);
  assert.deepEqual([rows[2].n, rows[2].failed, rows[2].run], [1, 1, 2]);
  assert.deepEqual(rows[2].fps, { med: 18, min: 18, max: 18 });
  assert.equal(rows[2].mainMed, 7);
  // a variant with nothing valid has no numbers
  assert.equal(aggregate(variants, R.slice(0, 2), 3)[2].fps, null);

  const run: BenchRun = { name: 'water', launch: 'http://x/?bench=water', base: 'scenario=babel&seed=307987276', variants, opts: parseBench('?bench=water').opts, order: stepOrder(3, 3), results: R, startedAt: '2026-11-19T10:00:00Z', endedAt: '2026-11-19T10:20:00Z', aborted: true };
  const W = benchWarnings(run);
  assert.match(W[0], /ABORTED after 8 of 9 steps/);
  assert.match(W[1], /1 step\(s\) FAILED: #3 C \(not loaded after 240 s\)/);
  assert.match(W[2], /1 step\(s\) INVALID.*#5 B \(page hidden during the recording\)/);
  assert.equal(W.length, 3);
  // a build or a window size that changed mid-run is said
  const R2 = [step(0, 0, 0, 'A', 7, 140), step(1, 1, 0, 'B', 8, 120, { build: 'b2', canvas: '1200x800 (css) dpr 1 preset ultra', alt: 80 })];
  const W2 = benchWarnings({ ...run, aborted: false, order: [0, 1], results: R2 });
  assert.equal(W2.length, 3);
  // a window that held only a few frames is said too (and still counted)
  const W3 = benchWarnings({ ...run, aborted: false, order: [0], results: [step(0, 0, 0, 'A', 0.5, 2000, { frames: 7 })] });
  assert.deepEqual(W3, ['1 step(s) with fewer than 10 frames in the window (use a longer brec): #1 A (7)']);
  assert.match(W2.join('\n'), /build CHANGED.*b1 \/ b2[\s\S]*canvas size CHANGED.*1686x963 \/ 1200x800[\s\S]*altitude differs.*59.7 - 80 m/);

  const text = resultsText(run);
  const L = text.split('\n');
  assert.match(L[0], /^GENESIS BENCH · plan water · 3 variants x 3 repeats = 9 steps \(8 run\) · build b1$/);
  assert.ok(L.some((l) => /^\s+A\s+3\/3\s+6\.1\s+2\.9\s+7\.5\s+167\s+133\s+350\s/.test(l)), 'row A');
  assert.ok(L.some((l) => /^\s+B\s+2\/3\s+11\.1\s+9\.9\s+12\.3\s+91\s+82\s+100\s/.test(l)), 'row B');
  assert.ok(L.some((l) => /^\s+3\s+1\s+C\s+FAILED: not loaded after 240 s/.test(l)), 'failed step in the order');
  assert.ok(L.some((l) => /^===== step 5 of 9 · rep 2 · B · x=1 · INVALID: page hidden during the recording =====$/.test(l)));
  // every step's raw report is there, in the order run
  const at = R.filter((r) => r.report).map((r) => text.indexOf(`\n${r.report}\n`));
  assert.ok(at.every((x) => x > 0));
  assert.deepEqual(at, at.slice().sort((a, b) => a - b));
  assert.ok(text.includes('(no perf report)'));
});
