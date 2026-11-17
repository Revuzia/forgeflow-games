import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const logs = []; p.on('console', m => logs.push(m.type()+': '+m.text().slice(0,200))); p.on('pageerror', e => logs.push('ERR '+e.message.slice(0,300)));
await p.goto('http://localhost:5271/_harness/web/render_bench.html?mode=rift&q=high&t=30&seed=7&dev=1&hud=0&manual=1&dyn=0', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 12; i++) { await p.waitForTimeout(5000); const s = await p.evaluate(() => ({ r: window.__VALE_BENCH__?.ready, e: window.__VALE_BENCH__?.error ?? null, has: !!window.__VALE_BENCH__ })); console.log(i, JSON.stringify(s)); if (s.r || s.e) break; }
console.log(logs.slice(0,30).join('\n')); await b.close();
