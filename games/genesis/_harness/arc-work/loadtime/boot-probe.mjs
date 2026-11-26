#!/usr/bin/env node
// LOADTIME: boot one URL on SwiftShader against a running server and dump the boot trace (boot.ts).
//   bash _harness/slot.sh node _harness/arc-work/loadtime/boot-probe.mjs --base=http://127.0.0.1:5311 --query='scenario=babel&seed=307987276' --out=DIR --tag=a [--after=20] [--shot=1] [--size=640x360]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/loadtime');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '640x360').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || /boot compile|warm-up/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
// the page's own liveness: the longest gap between two 20 ms timer ticks while the boot card is up, and what the card said
await page.addInitScript(() => {
  const L = (window.__LT__ = { gaps: [], last: performance.now(), status: [] });
  setInterval(() => {
    const t = performance.now();
    if (t - L.last > 100) L.gaps.push([Math.round(L.last), Math.round(t - L.last)]);
    L.last = t;
    const s = document.getElementById('boot-status')?.textContent ?? '';
    if (s && L.status[L.status.length - 1]?.[1] !== s) L.status.push([Math.round(t), s]);
  }, 20);
});
const T0 = Date.now();
await page.goto(`${opts.base ?? 'http://127.0.0.1:5311'}/?${opts.query ?? ''}`);
await page.evaluate(() => window.__GENESIS__.ready);
const tReady = Date.now() - T0;
await new Promise((ok) => setTimeout(ok, Number(opts.after ?? 20) * 1000));
if (opts.eval) await page.evaluate(opts.eval);
const res = await page.evaluate(() => {
  const B = window.__GN_BOOTTRACE__;
  const playable = B.marks.find((m) => m.name === 'playable')?.t ?? 1e12;
  return { lines: B.lines(true), snap: B.snapshot(), gaps: window.__LT__.gaps.filter((g) => g[0] < playable), status: window.__LT__.status, progs: window.__GENESIS__.programs?.().length };
});
if (opts.shot) await page.screenshot({ path: join(OUT, `${tag}.png`) });
writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ query: opts.query, tReady, errors, ...res }, null, 1));
const txt = [`query: ${opts.query}`, `ready (wall, node side): ${tReady} ms`, `timer gaps > 100 ms before playable (start, length): ${res.gaps.map((g) => `${g[1]}@${g[0]}`).join(' ') || 'none'} | total ${res.gaps.reduce((a, g) => a + g[1], 0)} ms`,
  `boot card: ${res.status.map((s) => `${s[0]} "${s[1]}"`).join(' | ')}`, `errors: ${errors.length ? errors.join(' || ') : 'none'}`, ...res.lines].join('\n');
writeFileSync(join(OUT, `${tag}.txt`), txt);
console.log(txt.split('\n').slice(0, 12).join('\n'));
await browser.close();
