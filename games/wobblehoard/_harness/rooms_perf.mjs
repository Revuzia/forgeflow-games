// Round 14 (R14_ROOMS, D-104): frame time with THREE squishies out at the LOW tier, per place, before and after the bigger rooms.
// 1280x800, the dev build, software WebGL (SwiftShader): judge RELATIVELY (the same script on the tree before and after).
//   sim     ms per 1/60 s step of the game (physics + LIFE + the stage's update; __WH__.step, no draw)
//   draw    ms per stage.render() with the pixels read back (gl.readPixels of one pixel forces the software rasteriser to finish)
// Usage: node _harness/rooms_perf.mjs [--port=5364] [--places=home,hearthlog,cloudloft] [--out=name]   (writes _harness/_reports/<out>.json)
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5364)), PLACES = arg('places', 'home,hearthlog,ripple,frostbell,rainleaf,lanternroof,cloudloft').split(','), OUT = arg('out', 'rooms_perf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await startVite(PORT);
const browser = await launch();
const rows = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
  await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
  const clickSel = async (sel) => { const b = await page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel); if (!b) return false; await page.mouse.click(b.x, b.y); await sleep(500); return true; };
  await clickSel('.cta');
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 60000 });
  const step = (s) => page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s);
  await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'low'); wh.setSetting('skipAnimations', true); wh.pause(); });
  // own a few species (the dev grant; ceremonies skipped), then three out
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { window.__WH__.shell.grant(1); });
    for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
    await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
    for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
  }
  await step(1);
  const count = () => page.evaluate(() => window.__WH__.shell.matInfo().count);
  // bring the party to exactly three by the mat's own calls
  await page.evaluate(() => {
    const wh = window.__WH__, g = wh.shell;
    const ids = new Set(g.matInfo().bodies.map((b) => b.itemId));
    const items = g.hoardState().items.filter((it) => !ids.has(it.id));
    const seen = new Set([g.identity().species]);
    for (const it of items) { if (g.matInfo().count >= 3) break; if (seen.has(it.species)) continue; seen.add(it.species); try { g.matAdd ? g.matAdd(it.id) : null; } catch { /* next */ } }
  });
  await step(1);
  let n = await count();
  if (n < 3) {   // the Friends strip's own path (real clicks)
    await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    if (await clickSel('.pt-btn')) { await clickSel('.pt-bring:not([hidden])'); await sleep(400); await clickSel('.pt-close'); }
    await page.evaluate(() => window.__WH__.pause()); await step(1);
    n = await count();
  }
  while ((await count()) > 3) { await page.evaluate(() => { const g = window.__WH__.shell; const b = g.matInfo().bodies; const last = b[b.length - 1]; if (g.matRemove && last) g.matRemove(last.itemId); }); await step(0.2); if ((await count()) > 3 && !(await page.evaluate(() => !!window.__WH__.shell.matRemove))) break; }
  n = await count();
  console.log(`party out: ${n}; tier ${(await page.evaluate(() => window.__WH__.state().stage.tier))}`);
  for (const place of PLACES) {
    const ok = await page.evaluate((p) => window.__WH__.travel(p, true), place);
    await step(3);
    const m = await page.evaluate(async () => {
      const wh = window.__WH__, st = wh.shell.stageObj(), gl = st.renderer ? st.renderer.getContext() : null, px = new Uint8Array(4);
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
      const sim = [], draw = [];
      for (let k = 0; k < 6; k++) { const t0 = performance.now(); wh.step(1 / 60, 60); sim.push((performance.now() - t0) / 60); await new Promise((r) => setTimeout(r, 0)); }
      for (let k = 0; k < 30; k++) { wh.step(1 / 60, 1); const t0 = performance.now(); st.render(); if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); draw.push(performance.now() - t0); }
      const s = st.stats();
      return { sim: med(sim), draw: med(draw), calls: s.drawCalls, tris: s.triangles, tier: s.tier, out: wh.shell.matInfo().count };
    });
    rows.push({ place, ok, ...m });
    console.log(`${place.padEnd(12)} travel ${ok}  out ${m.out}  tier ${m.tier}  sim ${m.sim.toFixed(2)} ms  draw ${m.draw.toFixed(1)} ms  frame ${(m.sim + m.draw).toFixed(1)} ms  calls ${m.calls}  tris ${m.tris}`);
  }
  if (errs.length) console.log('errors:', errs.slice(0, 5).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  srv.stop();
}
mkdirSync(resolve(ROOT, '_harness/_reports'), { recursive: true });
writeFileSync(resolve(ROOT, `_harness/_reports/${OUT}.json`), JSON.stringify({ when: new Date().toISOString(), rows }, null, 1));
