// VALE harness — GR-2: High on a HiDPI viewport at each DPR cap: frozen frames, synced cost and a live run with dynamic
// resolution on (fps, intervals, the scale it settled on), and the footprint. Each step is a fresh page.
//   node _harness/gfx_dpr.mjs --w 1512 --h 982 --dprs 1,1.25,1.5,2 [--dsf 2] [--q high] [--sec 40] [--tag x]
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab, timedFrames, median, footprint, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const w = Number(arg('w', 1512)), h = Number(arg('h', 982)), dsf = Number(arg('dsf', 2)), q = arg('q', 'high'), sec = Number(arg('sec', 40)), seed = Number(arg('seed', 7));
const dprs = arg('dprs', '1,1.25,1.5,2').split(',').map(Number), tag = arg('tag', `${q}_${w}x${h}`);
const OUT = '_harness/_shots/gfx_GR2'; mkdirSync(OUT, { recursive: true });
const rep = { q, w, h, dsf, seed, sec, steps: {} };
for (const dpr of dprs) {
  const r = { dpr, load0: load() };
  // frozen frames and the synced cost
  {
    const { browser, page, logs } = await openBench({ q, t: 300, seed, w, h, dsf });
    await B(page, (b, d) => { b.setVideo(b.renderer.stats().tier, { maxDpr: d }); }, dpr);
    const spots = await B(page, (b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)]; return { fight: [f.x, f.y], struct: [s.x, s.y], centre: [m.size[0] / 2, m.size[1] / 2] }; });
    r.synced = {};
    for (const [k, [x, y]] of Object.entries(spots)) {
      await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 25; i++) b.renderer.render(1 / 60); }, [x, y]);
      await B(page, (b) => { b.renderer.render(0); });
      await grab(page, `${OUT}/${tag}_${k}_dpr${dpr}.png`);
      await timedFrames(page, 10);
      r.synced[k] = +median(await timedFrames(page, 40)).toFixed(2);
    }
    const s = await B(page, (b) => { const s = b.renderer.stats(); return { px: [s.width, s.height], programs: s.programs, calls: s.calls, tris: s.triangles, pr: s.pixelRatio }; });
    r.frame = s; r.frozenErrors = logs.slice(0, 2);
    await browser.close();
  }
  // live: the game loop with the controller on
  {
    const { browser, page, logs } = await openBench({ q, t: 300, seed, w, h, dsf, manual: false, dyn: true });
    await B(page, (b, d) => { b.setVideo(b.renderer.stats().tier, { maxDpr: d }); const f = b.fight(); if (f) b.focus(f.x, f.y); b.zoom(28.5); }, dpr);
    await page.waitForTimeout(9000);
    const live = await B(page, (b, s) => new Promise((res) => {
      const iv = [], scales = []; let last = performance.now(); const t0 = last; let nextFight = t0 + 5000, nextS = t0 + 1000;
      const tick = (now) => {
        iv.push(now - last); last = now;
        if (now > nextFight) { const f = b.fight(); if (f) b.focus(f.x, f.y); nextFight = now + 5000; }
        if (now > nextS) { scales.push(b.renderer.stats().renderScale); nextS = now + 1000; }
        if (now - t0 < s * 1000) requestAnimationFrame(tick); else { const st = b.renderer.stats(); res({ iv, scales, st: { bound: st.bound, programs: st.programs, w: st.width, h: st.height, tris: st.triangles, calls: st.calls } }); }
      };
      requestAnimationFrame(tick);
    }), sec);
    const s = [...live.iv].sort((a, b) => a - b), at = (k) => +s[Math.floor(s.length * k)].toFixed(1);
    r.live = { fps: +(1000 * s.length / s.reduce((a, b) => a + b, 0)).toFixed(1), p50: at(0.5), p95: at(0.95), p99: at(0.99), over25: +(100 * s.filter((x) => x > 25).length / s.length).toFixed(1), scaleFirst: live.scales[0], scaleLast: live.scales[live.scales.length - 1], scaleMin: Math.min(...live.scales), scales: live.scales.join(','), st: live.st };
    r.mem = await footprint(browser, page);
    r.liveErrors = logs.slice(0, 2);
    await browser.close();
  }
  r.load1 = load();
  rep.steps[dpr] = r;
  console.log(dpr, JSON.stringify({ synced: r.synced, frame: r.frame, live: { ...r.live, scales: undefined }, mem: r.mem, load0: r.load0, load1: r.load1 }));
  writeFileSync(`_harness/_reports/gfx_GR2_${tag}.json`, JSON.stringify(rep, null, 1));
}
