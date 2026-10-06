// Black blob repro, exactly the look.mjs calm sequence, with sparse rendering (only the 'at' shots) vs every frame rendered.
import { setup, b64, S } from './common.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir = `${S}/out/look/black2`; mkdirSync(dir, { recursive: true });
const env = await setup({ width: 1280, height: 800 });
for (const every of [false, true]) {
  const r = await env.page.evaluate(async (every) => {
    const V = window.__V__; V.newStage(1280, 800, 'med', 1);
    const c = V.ctx, out = [];
    const blackCount = (png) => new Promise((res) => { const im = new Image(); im.onload = () => { const cc = document.createElement('canvas'); cc.width = im.width; cc.height = im.height; const x = cc.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, im.width, im.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] <= 3 && d[i + 1] <= 3 && d[i + 2] <= 3) n++; res(n); }; im.src = png; });
    for (const [tier, burst] of [['common', 0.65 * 0.65], ['rare', 0.95 * 0.65]]) {
      const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); c.stage.setBody(c.play, g); V.frames(40, 1 / 30);
      const at = {}; for (let k = -2; k <= 12; k++) at['t' + (k + 10)] = burst + k / 30;
      const rr = await V.run({ kind: 'capsule', tier, calm: true, dt: 1 / 30, record: every, at });
      const counts = {}; let worst = null, wn = 0;
      for (const [k, png] of Object.entries(rr.shots)) { const n = await blackCount(png); counts[k] = n; if (n > wn) { wn = n; worst = png; } }
      out.push({ tier, counts, worst: wn, png: worst });
    }
    return out;
  }, every);
  for (const o of r) { console.log(every ? 'EVERY-FRAME' : 'SPARSE', o.tier, JSON.stringify(o.counts)); if (o.png) writeFileSync(`${dir}/${every ? 'every' : 'sparse'}_${o.tier}.png`, b64(o.png)); }
}
console.log('console', env.bad.slice(0, 5));
await env.close();
