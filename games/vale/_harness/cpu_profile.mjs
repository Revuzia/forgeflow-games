// VALE harness — r12 B4 CPU profile of the live render-bench loop (RIFT, densest fight): the CDP sampling profiler
// for <sec> seconds, then self and inclusive ms PER FRAME by function, plus the bench's own pump / render means.
//   VALE_URL=http://localhost:<port> node _harness/cpu_profile.mjs [t=900] [q=high] [sec=4]
// Point it at a dev server (readable names); note the shared 5190 server does not watch _harness/, so a changed
// render_bench.ts needs a fresh server. Prints only (no report).
import { open } from './pw.mjs';
const T = Number(process.argv[2] ?? 900), Q = process.argv[3] ?? 'high', SEC = Number(process.argv[4] ?? 4);
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=rift&q=${Q}&t=${T}&dev=1&hud=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
await page.waitForTimeout(5000);
await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
await page.waitForTimeout(2000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await page.evaluate(() => window.__VALE_BENCH__.timing(true));
await cdp.send('Profiler.start');
await page.waitForTimeout(SEC * 1000);
const { profile } = await cdp.send('Profiler.stop');
const tm = await page.evaluate(() => window.__VALE_BENCH__.timing(true));
const frames = tm.render.length;
const self = new Map(), byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
// total (inclusive) time too
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
for (const [id, us] of dt) {
  const n = byId.get(id);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  self.set(k, (self.get(k) ?? 0) + us);
  const seen = new Set();
  for (let p = id; p !== undefined; p = parent.get(p)) {
    const m = byId.get(p);
    const kk = `${m.callFrame.functionName || '(anon)'} ${m.callFrame.url.split('/').slice(-2).join('/')}:${m.callFrame.lineNumber + 1}`;
    if (seen.has(kk)) continue; seen.add(kk);
    incl.set(kk, (incl.get(kk) ?? 0) + us);
  }
}
const ms = (us) => (us / 1000 / frames).toFixed(3);
console.log(`frames ${frames}  render mean ${(tm.render.reduce((s, x) => s + x, 0) / frames).toFixed(2)} ms  pump mean ${(tm.pump.reduce((s, x) => s + x, 0) / frames).toFixed(2)} ms`);
console.log('--- self ms/frame');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(ms(v).padStart(7), k);
console.log('--- inclusive ms/frame');
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 70)) console.log(ms(v).padStart(7), k);
await browser.close();
