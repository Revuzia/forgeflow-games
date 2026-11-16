// owner15 r1 verifier (temp): replay a render_bench RIFT seed to a time window and film one Wick (id) each 0.5 s
//   node _harness/_tmp_vfy_owner15_minzoom.mjs --seed 3 --id 2686 --from 224 --to 238
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(opt('seed', 3)), ID = Number(opt('id', 0)), FROM = Number(opt('from', 0)), TO = Number(opt('to', 0)), MODE = opt('mode', 'rift');
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=high&t=0&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
const rows = [];
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready, null, { timeout: 240000 });
  await page.evaluate((T) => { const H = window.__VALE_BENCH__.host; while (H.view.time < T) H.pump(1 / 30); }, FROM);
  let n = 0;
  while (true) {
    const r = await page.evaluate((id) => {
      const B = window.__VALE_BENCH__, H = B.host;
      for (let k = 0; k < 15; k++) H.pump(1 / 30);
      const W = H.sim.world ?? H.sim.w;
      const e = W?.entity ? W.entity(id) : null;
      const v = H.view.entity(id);
      if (v) { B.focus(v.x, v.y); }
      for (let i = 0; i < 2; i++) B.renderer.render(1 / 30);
      const near = v ? H.view.entities.filter((o) => o.alive && o.id !== id && Math.hypot(o.x - v.x, o.y - v.y) < 3).map((o) => ({ id: o.id, k: o.kind, def: o.def, team: o.team, d: +Math.hypot(o.x - v.x, o.y - v.y).toFixed(2), st: o.state })) : [];
      return { t: +H.view.time.toFixed(2), v: v ? { x: +v.x.toFixed(2), y: +v.y.toFixed(2), st: v.state, alive: v.alive } : null, sim: e ? { order: e.order, ox: e.orderX, oy: e.orderY, ot: e.orderTarget, atk: e.atkTarget, path: e.path ? (e.path.length ?? null) : undefined, keys: Object.keys(e).filter((k) => /stuck|block|relax|path|progress|step/i.test(k)).map((k) => [k, typeof e[k] === 'object' ? (Array.isArray(e[k]) ? 'arr' + e[k].length : e[k] && JSON.stringify(e[k]).slice(0, 80)) : e[k]]) } : null, near };
    }, ID);
    rows.push(r);
    console.log(JSON.stringify(r).slice(0, 900));
    if (n % 2 === 0) await shot(page, `owner15_controls_r1_minzoom_${MODE}_s${SEED}_id${ID}_${String(n).padStart(2, '0')}`);
    n++;
    if (r.t >= TO || !r.v) break;
  }
} finally {
  writeFileSync(join(HERE, '_reports', `owner15_minzoom_${MODE}_s${SEED}_${ID}.json`), JSON.stringify(rows, null, 2));
  await browser.close();
}
