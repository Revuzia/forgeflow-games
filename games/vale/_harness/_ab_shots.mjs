// scratch (B4 lane): deterministic gameplay-camera frames for an A/B (manual frames, fixed dt); raw RGBA + PNG
//   VALE_URL=… node _harness/_ab_shots.mjs <outDir> <mode> <q> <t>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from './pw.mjs';
const [OUT, MODE = 'rift', Q = 'high', T = '900'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=${Q}&t=${T}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(2, 1 / 30));
await page.waitForTimeout(9000);                          // every model, prop and texture lands in real time
await B((b) => b.frames(30, 1 / 30));
const m = await B((b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); return { size: m.size, bases: m.bases.map((x) => x.spawn) }; });
const f = await B((b) => b.fight());
const [W, H] = m.size;
const spots = { fight: f ? [f.x, f.y] : [W / 2, H / 2], centre: [W / 2, H / 2], q1: [W * 0.3, H * 0.3], q3: [W * 0.7, H * 0.65], ...(m.bases[0] ? { base: [m.bases[0][0] + 6, m.bases[0][1]] } : {}) };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B((b, p) => { b.focus(p[0], p[1]); b.frames(20, 1 / 30); }, [x, y]);
  const px = await page.evaluate(() => {
    const gl = window.__VALE_BENCH__.renderer.gl.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
    let s = ''; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
    return { w, h, b64: btoa(s) };
  });
  writeFileSync(join(OUT, `${MODE}_${Q}_${k}.rgba`), Buffer.from(px.b64, 'base64'));
  await page.screenshot({ path: join(OUT, `${MODE}_${Q}_${k}.png`) });
  console.log(k, x.toFixed(1), y.toFixed(1), px.w, px.h);
}
await browser.close();
