// scratch (B4 lane): evaluate a function in the bench page after load: node _harness/_scratch_eval.mjs <file.js> [t] [q]
import { readFileSync } from 'node:fs';
import { open } from './pw.mjs';
const src = readFileSync(process.argv[2], 'utf8');
const T = Number(process.argv[3] ?? 900), Q = process.argv[4] ?? 'high';
const MODE = process.env.MODE ?? "rift";
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=${Q}&t=${T}&dev=1&hud=0`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
await page.waitForTimeout(5000);
await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
await page.waitForTimeout(1500);
const r = await page.evaluate(`(async () => { ${src} })()`);
console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
console.error(logs.slice(0, 10).join('\n'));
await browser.close();
