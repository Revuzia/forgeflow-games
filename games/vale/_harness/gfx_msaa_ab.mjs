// VALE harness — GR-3: MSAA on the composer's first HDR buffer (the only one geometry draws into), with SMAA or without, at Ultra,
// in one page: frozen frames, synced cost, the pan's temporal metric. No src change: the variants are set on the live chain.
//   node _harness/gfx_msaa_ab.mjs [--w 1920 --h 1080 --dsf 1] [--q ultra] [--variants smaa,m2s,m4s,m2,m4] [--both 0]
// Variant names: smaa = shipped; m2s/m4s = 2x/4x + SMAA; m2/m4 = 2x/4x, SMAA pass replaced by a copy.
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab, panMetric, timedFrames, median, footprint, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const w = Number(arg('w', 1920)), h = Number(arg('h', 1080)), dsf = Number(arg('dsf', 1)), q = arg('q', 'ultra'), both = arg('both', '0') === '1';
const names = arg('variants', 'smaa,m2s,m4s,m2,m4').split(','), tag = arg('tag', `${q}_${w}x${dsf}`);
const OUT = '_harness/_shots/gfx_GR3'; mkdirSync(OUT, { recursive: true });
const V = { smaa: [0, 'smaa'], m2s: [2, 'smaa'], m4s: [4, 'smaa'], m2: [2, 'off'], m4: [4, 'off'], m8s: [8, 'smaa'] };
const { browser, page, logs } = await openBench({ q, t: 300, seed: Number(arg('seed', 7)), w, h, dsf });
await B(page, (b) => {
  window.__set = (n, aa, both) => {
    const R = b.renderer, c = R.post.composer, q = R.q;
    R.post.setQuality({ ao: q.ao, bloom: q.bloom, aa, tier: q.tier });
    for (const [rt, on] of [[c.inputBuffer, true], [c.outputBuffer, both]]) {
      const s = on ? n : 0;
      if (rt.samples !== s) { rt.samples = s; rt.dispose(); }
    }
    R.render(0); R.render(0);
    const s = R.stats();
    return { programs: s.programs, calls: s.calls, tris: s.triangles };
  };
  /** the composer's HDR colour + depth bytes as allocated (MB) */
  window.__rtMb = () => {
    const c = b.renderer.post.composer, W = c.inputBuffer.width, H = c.inputBuffer.height;
    const one = (rt) => { const n = rt.samples; return (n > 0 ? (8 + 4) * n * W * H : 0) + (8 + 4) * W * H; };
    return +((one(c.inputBuffer) + one(c.outputBuffer)) / 1048576).toFixed(1);
  };
});
const spots = await B(page, (b) => { const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)], t = st[Math.floor(st.length * 2 / 3)]; return { fight: [f.x, f.y], struct: [s.x, s.y], struct2: [t.x, t.y] }; });
const rep = { q, w, h, dsf, both, load0: load(), spots: {}, variants: {} };
const set = (name) => B(page, (b, a) => window.__set(a[0], a[1], a[2]), [...V[name], both]);
for (const n of names) { const p = await set(n); await timedFrames(page, 4); rep.variants[n] = { ...p, rtMb: await B(page, () => window.__rtMb()) }; console.log(n, JSON.stringify(rep.variants[n])); }
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 25; i++) b.renderer.render(1 / 60); }, [x, y]);
  const cost = Object.fromEntries(names.map((n) => [n, []]));
  for (let r = 0; r < 5; r++) for (const n of names) { await set(n); await timedFrames(page, 6); cost[n].push(median(await timedFrames(page, 20))); }
  rep.spots[k] = { cost: Object.fromEntries(names.map((n) => [n, +median(cost[n]).toFixed(2)])), costMin: Object.fromEntries(names.map((n) => [n, +Math.min(...cost[n]).toFixed(2)])), pan: {}, load: load() };
  for (const n of names) {
    await set(n);
    await B(page, (b, p) => { b.focus(p[0], p[1]); b.renderer.render(0); b.renderer.render(0); }, [x, y]);
    await grab(page, `${OUT}/${tag}_${k}_${n}.png`);
    rep.spots[k].pan[n] = await panMetric(page, x, y, { step: 0.004, n: 26 });
    await B(page, (b, p) => { b.focus(p[0], p[1]); }, [x, y]);
  }
  console.log(k, JSON.stringify(rep.spots[k]));
}
rep.errors = logs; rep.load1 = load();
writeFileSync(`_harness/_reports/gfx_GR3_${tag}.json`, JSON.stringify(rep, null, 1));
console.log('errors', logs.length, logs.slice(0, 4));
await browser.close();
