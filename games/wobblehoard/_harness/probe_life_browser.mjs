// LF-02 measured once in a real browser tab (PG_LIFE round 4; the orchestrator's item 4): headless Chromium on port 5369 (PG_LIFE's port,
// SESSION3) runs _harness/lifeview/lf02_work.ts, the same replay design as probe_life.ts' LF-02 row, with a forced GC before each 1000-tick
// window and precise memory info. One heavy job; everything it starts is stopped at the end. Info only: it prints the windows, it does not
// change LF-02's bar or its node measurement.
//   node _harness/probe_life_browser.mjs [--port 5369] [--passes 3,30]
import { startVite, launch } from './pw.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 5369));
const PASSES = String(arg('passes', '3,30')).split(',').map(Number);
const vite = await startVite(PORT);
const browser = await launch();
const results = [];
try {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${vite.url}_harness/lifeview/lf02.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__LF02__ && window.__LF02__.ready, null, { timeout: 120000 });
  const ver = await page.evaluate(() => navigator.userAgent);
  console.log(`browser: ${ver}`);
  for (const passes of PASSES) {
    // a fresh page per measurement so the JIT starts cold each time (the same as node's isolated child process)
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__LF02__ && window.__LF02__.ready, null, { timeout: 120000 });
    await page.evaluate(([p]) => window.__LF02__.prepare(p, 1000, 6000), [passes]);
    const cdp = await page.context().newCDPSession(page);
    const used = async () => (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const measure = async (fn) => { await cdp.send('HeapProfiler.collectGarbage'); const u0 = await used(); const ms = await fn(); const u1 = await used(); return { d: u1 - u0, ms }; };
    const base = [];
    for (let k = 0; k < 6; k++) base.push((await measure(() => page.evaluate(() => window.__LF02__.noop()))).d);
    const b0 = Math.min(...base);
    const wins = [], ms = [];
    for (let k = 0; k < 6; k++) { const m = await measure(() => page.evaluate(([w]) => window.__LF02__.win(w), [k])); wins.push(m.d - b0); ms.push(m.ms); }
    // --sample: the allocation sites of the measured world over its 6 windows again (a second replay of the same ticks into the same world is not
    // possible, so this samples a fresh replay of the last 2000 ticks into it: the decisions differ, the code paths are the same kind)
    const sites = [];
    if (process.argv.includes('--sample')) {
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 64 });
      for (let k = 4; k < 6; k++) await page.evaluate(([w]) => window.__LF02__.win(w), [k]);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const self = new Map();
      const walk = (n, stack) => { const fr = `${n.callFrame.functionName || '(anon)'}@${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`; const st = [fr, ...stack].slice(0, 3); if (n.selfSize > 0) { const key = st.join(' < '); self.set(key, (self.get(key) ?? 0) + n.selfSize); } for (const c of n.children) walk(c, st); };
      walk(profile.head, []);
      for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) sites.push(`${v} B ${k}`);
      console.log(`  sampled allocation sites (2000 ticks re-run, 64 B interval):\n    ${sites.join('\n    ')}`);
    }
    await cdp.detach();
    const r = { passes, wins, base, tickUs: ms.reduce((a, b) => a + b, 0) / 6000 * 1000, sites };
    results.push(r);
    console.log(`LF-02 browser, ${passes} replay passes before the measured world: windows ${wins.join(', ')} B per 1000 ticks (an empty call's own growth ${base.join(', ')} B, the smallest subtracted); lifeStep ${r.tickUs.toFixed(1)} us a tick`);
  }
  if (problems.length) console.log('PAGE PROBLEMS', problems);
} finally {
  await browser.close();
  vite.stop();
}
console.log('LF02B ' + JSON.stringify(results));
