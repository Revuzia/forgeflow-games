// controls r2 live verifier (temp): replay render_bench RIFT seed N to T0 and dump one Wick's sim state + neighbours every 0.5 s
//   node _harness/_tmp_vfy_ctl_r2live_wickdump.mjs --seed 3 --mode rift --id 23280 --t0 1476 --t1 1530
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(opt('seed', 3)), MODE = opt('mode', 'rift'), ID = Number(opt('id', 23280)), T0 = Number(opt('t0', 1476)), T1 = Number(opt('t1', 1530));
const OUT = join(HERE, '_reports', `ctl_r2live_wickdump_${MODE}_s${SEED}_${ID}.json`);
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=low&t=0&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
const rep = { seed: SEED, mode: MODE, id: ID, samples: [] };
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready, null, { timeout: 240000 });
  await page.evaluate((T0) => { const H = window.__VALE_BENCH__.host; while (H.view.time < T0) H.pump(1 / 30); }, T0);
  let n = 0;
  while (true) {
    const s = await page.evaluate((a) => {
      const B = window.__VALE_BENCH__, H = B.host, W = H.sim.world;
      for (let k = 0; k < 15; k++) H.pump(1 / 30);
      const e = W.entity(a.ID);
      if (!e || !e.alive) return { t: H.view.time, gone: true };
      const pick = (u) => ({ id: u.id, kind: u.kind, def: u.def ?? u.unit?.id, team: u.team, x: +u.x.toFixed(2), y: +u.y.toFixed(2), d: +(Math.hypot(u.x - e.x, u.y - e.y) - u.radius - e.radius).toFixed(2), alive: u.alive, targetable: u.targetable, vis: u.visibleMask, st: u.state, statuses: (u.statuses ?? []).map((q) => q.id ?? q.def ?? q.kind) });
      const near = W.entities.filter((u) => u !== e && u.alive && Math.hypot(u.x - e.x, u.y - e.y) < 9).map(pick).sort((p, q) => p.d - q.d).slice(0, 14);
      const keys = ['x', 'y', 'state', 'order', 'orderTarget', 'orderX', 'orderY', 'atkTarget', 'atkCd', 'atkWindup', 'aggroTarget', 'target', 'laneIdx', 'watchStage', 'watchFails', 'arriveStall', 'arrivePinned', 'ccFlags', 'flags'];
      const me = {}; for (const k of keys) if (e[k] !== undefined) me[k] = typeof e[k] === 'number' ? +e[k].toFixed(3) : e[k];
      me.path = e.path?.length; me.statuses = (e.statuses ?? []).map((q) => q.id ?? q.def ?? q.kind);
      me.range = e.stats?.range; me.extra = Object.fromEntries(Object.entries(e).filter(([k, v]) => /creep|chase|spot|aggro|leash|wick|minion|lanePt|wave/i.test(k) && (typeof v !== 'object' || v === null)));
      return { t: +H.view.time.toFixed(2), me, near };
    }, { ID });
    rep.samples.push(s);
    if (s.gone || s.t >= T1) break;
    if (n++ === 6) { await page.evaluate((id) => { const B = window.__VALE_BENCH__, e = B.host.sim.world.entity(id); B.focus(e.x, e.y); for (let i = 0; i < 3; i++) B.renderer.render(1 / 30); }, ID); await shot(page, `owner15_controls_r2_wickdump_${MODE}_s${SEED}_${ID}`); }
  }
} catch (e) { rep.error = String(e?.stack ?? e).slice(0, 800); console.log('ERROR', rep.error); }
finally { writeFileSync(OUT, JSON.stringify(rep, null, 1)); console.log('report', OUT, rep.samples.length); await browser.close(); }
