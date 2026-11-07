// VALE harness — GR-3: MSAA on the Ultra world, in one page: frozen frames, synced cost, the pan's temporal metric, what the overlay
// does, render-target bytes. Set on the live chain through PostChain.setMsaaSamples (the switch MSAA_ULTRA_SAMPLES stays what it is).
//   node _harness/gfx_msaa_ab.mjs [--w 1920 --h 1080 --dsf 1] [--q ultra] [--variants smaa,m2s,m4s,m2,m4] [--zoom 31] [--naive 1]
// Variant names: smaa = shipped; m2s/m4s = 2x/4x + SMAA; m2/m4 = 2x/4x, SMAA pass replaced by a copy.
// --mode all | cost (only the cost blocks, 8 rounds, nothing heavier in the page: the timing reading) | overlay (only the overlay
// checks, with controls: SMAA High and Medium presets, the same frame through tiers that already ship).
// --naive 1 also shoots postprocessing's own composer.multisampling = 4 (the path the chain does not use), to show why.
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab, panMetric, timedFrames, median, footprint, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const w = Number(arg('w', 1920)), h = Number(arg('h', 1080)), dsf = Number(arg('dsf', 1)), q = arg('q', 'ultra'), zoom = Number(arg('zoom', 31)), mode = arg('mode', 'all');
const names = arg('variants', 'smaa,m2s,m4s,m2,m4').split(','), tag = arg('tag', `${q}_${w}x${dsf}`);
const OUT = '_harness/_shots/gfx_GR3'; mkdirSync(OUT, { recursive: true });
const V = { smaa: [0, 'smaa'], m2s: [2, 'smaa'], m4s: [4, 'smaa'], m2: [2, 'off'], m4: [4, 'off'] };
const { browser, page, logs } = await openBench({ q, t: 300, seed: Number(arg('seed', 7)), w, h, dsf });
await B(page, (b) => {
  window.__set = (n, aa) => {
    const R = b.renderer, q = R.q ?? R.quality;
    R.post.setMsaaSamples(n);
    R.post.setQuality({ ao: q.ao, bloom: q.bloom, aa, tier: q.tier });
    R.render(0); R.render(0);
    const s = R.stats();
    return { programs: s.programs, calls: s.calls, tris: s.triangles };
  };
  /** the frame's luma + rgb with the overlay on, off (frozen sim); the overlay's contribution per pixel */
  window.__ovContribution = () => {
    const R = b.renderer, gl = R.gl.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, pass = R.post.composer.passes.find((p) => p.name === 'OverlayPass');
    const read = () => { R.render(0); R.render(0); const p = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    const on = read(); pass.enabled = false; const off = read(); pass.enabled = true;
    const c = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) c[i] = Math.max(Math.abs(on[i * 4] - off[i * 4]), Math.abs(on[i * 4 + 1] - off[i * 4 + 1]), Math.abs(on[i * 4 + 2] - off[i * 4 + 2]));
    return c;
  };
  /** A against B: covered pixels, covered in one only (a flipped test or a moved edge), and the mean change where both cover */
  window.__ovCompare = (A, B) => {
    let a = 0, bb = 0, xor = 0, both = 0, dsum = 0, big = 0;
    for (let i = 0; i < A.length; i++) {
      const x = A[i] > 12, y = B[i] > 12;
      if (x) a++; if (y) bb++;
      if (x !== y) { xor++; if (Math.max(A[i], B[i]) > 48) big++; }
      if (x && y) { both++; dsum += Math.abs(A[i] - B[i]); }
    }
    return { covA: a, covB: bb, xor, xorStrong: big, meanDiffBoth: +(dsum / Math.max(1, both)).toFixed(2) };
  };
});
const spots = await B(page, (b) => { const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)], t = st[Math.floor(st.length * 2 / 3)]; return { fight: [f.x, f.y], struct: [s.x, s.y], struct2: [t.x, t.y] }; });
const rep = { q, w, h, dsf, zoom, load0: load(), spots: {}, variants: {}, overlay: {} };
const set = (name) => B(page, (b, a) => window.__set(a[0], a[1]), V[name]);

for (const n of names) { const p = await set(n); await timedFrames(page, 4); rep.variants[n] = p; console.log(n, JSON.stringify(p)); }
await set('smaa');

for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(p[2]); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 25; i++) b.renderer.render(1 / 60); }, [x, y, zoom]);
  // a spot's shared edge mask comes from the shipped frame
  await set('smaa');
  if (mode === 'overlay') break;
  rep.spots[k] = { load0: load(), floor: mode === 'cost' ? null : await panMetric(page, x, y, { step: 0, n: 8 }), pan: {}, pan3: {} };
  const cost = Object.fromEntries(names.map((n) => [n, []]));
  for (let r = 0; r < (mode === 'cost' ? 8 : 5); r++) for (const n of names) { await set(n); await timedFrames(page, 6); cost[n].push(median(await timedFrames(page, 20))); }
  rep.spots[k].cost = Object.fromEntries(names.map((n) => [n, +median(cost[n]).toFixed(2)]));
  rep.spots[k].costMin = Object.fromEntries(names.map((n) => [n, +Math.min(...cost[n]).toFixed(2)]));
  rep.spots[k].cost1Load = load();
  if (mode === 'cost') { rep.spots[k].blocks = cost; console.log(k, JSON.stringify({ cost: rep.spots[k].cost, costMin: rep.spots[k].costMin, load0: rep.spots[k].load0, load1: rep.spots[k].cost1Load })); continue; }
  for (const n of names) {
    await set(n);
    await B(page, (b, p) => { b.focus(p[0], p[1]); b.renderer.render(0); b.renderer.render(0); }, [x, y]);
    await grab(page, `${OUT}/${tag}_${k}_${n}.png`);
    rep.spots[k].pan[n] = await panMetric(page, x, y, { step: 0.004, n: 26, maskKey: k });
    rep.spots[k].pan3[n] = await panMetric(page, x, y, { step: 0.012, n: 26, maskKey: k });
    await B(page, (b, p) => { b.focus(p[0], p[1]); }, [x, y]);
  }
  rep.spots[k].load1 = load();
  console.log(k, JSON.stringify({ cost: rep.spots[k].cost, floor: rep.spots[k].floor.flickEdge, flickEdge: Object.fromEntries(names.map((n) => [n, rep.spots[k].pan[n].flickEdge])), load: rep.spots[k].load1 }));
}

// the overlay: a telegraph, rings and bars over and behind units and structures, the same frozen frame in every variant
if (mode !== 'cost') for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(p[2]); b.telegraphTest(p[0], p[1]); for (let i = 0; i < 4; i++) b.renderer.render(1 / 60); }, [x, y, zoom]);
  const res = {};
  await set('smaa'); await B(page, () => { window.__ov0 = window.__ovContribution(); });
  res.selfCheck = await B(page, () => window.__ovCompare(window.__ov0, window.__ovContribution()));
  for (const n of names.filter((m) => m !== 'smaa')) {
    await set(n);
    res[n] = await B(page, () => window.__ovCompare(window.__ov0, window.__ovContribution()));
    await grab(page, `${OUT}/${tag}_ov_${k}_${n}.png`);
  }
  await set('smaa'); await grab(page, `${OUT}/${tag}_ov_${k}_smaa.png`);
  // controls: what already differs between shipped tiers (the post tier alone: SMAA preset, bloom levels); and the composer's own MSAA
  for (const tier of ['high', 'medium']) {
    res['ctl_' + tier] = await B(page, (b, t) => { const R = b.renderer, q = R.q; R.post.setQuality({ ao: q.ao, bloom: q.bloom, aa: 'smaa', tier: t }); return window.__ovCompare(window.__ov0, window.__ovContribution()); }, tier);
  }
  await set('smaa');
  if (mode === 'overlay') {
    res.naive4 = await B(page, (b) => { const c = b.renderer.post.composer; c.multisampling = 4; const r = window.__ovCompare(window.__ov0, window.__ovContribution()); return r; });
    await grab(page, `${OUT}/${tag}_ov_${k}_naive4.png`);
    await B(page, (b) => { b.renderer.post.composer.multisampling = 0; });
    // where the 4x flips lie: strong (one side covered, other not) pixels, and the depth step under each
    await set('m4s');
    res.flips = await B(page, () => { const A = window.__ov0, C = window.__ovContribution(), W = 1920, out = []; for (let i = 0; i < A.length; i++) if ((A[i] > 12) !== (C[i] > 12) && Math.max(A[i], C[i]) > 48) out.push([i % W, Math.floor(i / W), A[i], C[i]]); return out.slice(0, 400); });
    await set('smaa');
  }
  rep.overlay[k] = res;
  console.log('overlay', k, JSON.stringify(res));
  await B(page, (b) => { b.renderer.director.telegraphs.length = 0; });
}

if (arg('naive', '0') === '1') {
  await set('smaa');
  const x = spots.fight;
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.telegraphTest(p[0], p[1]); for (let i = 0; i < 4; i++) b.renderer.render(1 / 60); b.renderer.post.composer.multisampling = 4; b.renderer.render(0); b.renderer.render(0); }, x);
  await grab(page, `${OUT}/${tag}_naive4x.png`);
  await B(page, (b) => { b.renderer.post.composer.multisampling = 0; b.renderer.render(0); b.renderer.render(0); });
  rep.naiveShot = `${OUT}/${tag}_naive4x.png`;
}

// footprint in one page: settle, read, per variant (a page's own GPU bytes; the match-long reading is probe_match_memory's)
rep.footprint = {};
if (mode === 'all') for (const n of ['smaa', 'm2s', 'm4s'].filter((m) => names.includes(m))) { await set(n); await timedFrames(page, 30); await page.waitForTimeout(1500); rep.footprint[n] = await footprint(browser, page); console.log('footprint', n, JSON.stringify(rep.footprint[n])); }
rep.rtMb = { m2extra: +(((8 + 4) * 2 + (8 + 4)) * w * h * dsf * dsf / 1048576).toFixed(1), m4extra: +(((8 + 4) * 4 + (8 + 4)) * w * h * dsf * dsf / 1048576).toFixed(1) };
rep.errors = logs; rep.load1 = load();
writeFileSync(`_harness/_reports/gfx_GR3_${tag}${mode === 'all' ? '' : '_' + mode}.json`, JSON.stringify(rep, null, 1));
console.log('errors', logs.length, logs.slice(0, 4), 'load', rep.load0, '->', rep.load1);
await browser.close();
