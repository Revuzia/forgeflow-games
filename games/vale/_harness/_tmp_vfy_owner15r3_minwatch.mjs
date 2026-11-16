// owner15 r1 verifier (temp): the real client's sim in Chrome (render_bench full match, autopilot seats), 25 min of RIFT,
// every Wick sampled each 1 s of match time; a stuck episode = alive, < 0.5 m moved in 6 s, no swing, no enemy within 9 m.
// Screens on the mid first towers every 5 min and on every stuck Wick.
//   node _harness/_tmp_vfy_owner15_minwatch.mjs --seed 3 [--mode rift] [--min 25]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(opt('seed', 3)), MODE = opt('mode', 'rift'), MIN = Number(opt('min', 25));
const OUT = join(HERE, '_reports', `owner15r3_minwatch_${MODE}_s${SEED}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${MODE}&q=low&t=0&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
const rep = { seed: SEED, mode: MODE, min: MIN, stuck: [], samples: 0, towers: null, falls: [] };
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready, null, { timeout: 240000 });
  rep.towers = await page.evaluate(() => {
    const B = window.__VALE_BENCH__;
    return B.host.view.entities.filter((e) => e.kind === 'structure').map((e) => ({ id: e.id, def: e.def, team: e.team, x: +e.x.toFixed(1), y: +e.y.toFixed(1) }));
  });
  await page.evaluate(() => {
    const B = window.__VALE_BENCH__;
    window.__W = { hist: new Map(), stuck: [], open: new Map(), falls: [], alive: new Set() };
  });
  let shotN = 0;
  for (let sec = 0; sec < MIN * 60; sec += 60) {
    const r = await page.evaluate((secs) => {
      const B = window.__VALE_BENCH__, H = B.host, S = window.__W;
      for (let s = 0; s < secs; s++) {
        for (let k = 0; k < 30; k++) H.pump(1 / 30);
        const v = H.view, t = v.time;
        const all = v.entities.filter((e) => e.alive && e.targetable !== false);
        const structs = v.entities.filter((e) => e.kind === 'structure');
        for (const st of structs) { if (!st.alive && !S.alive.has('dead' + st.id)) { S.alive.add('dead' + st.id); S.falls.push({ t: +t.toFixed(0), def: st.def, team: st.team }); } }
        const mins = all.filter((e) => e.kind === 'minion' && !/dummy/.test(e.def));
        const seen = new Set();
        for (const m of mins) {
          seen.add(m.id);
          let h = S.hist.get(m.id); if (!h) { h = []; S.hist.set(m.id, h); }
          h.push({ t, x: m.x, y: m.y, st: m.state });
          if (h.length > 7) h.shift();
          if (h.length < 7) continue;
          const d = Math.hypot(h[6].x - h[0].x, h[6].y - h[0].y);
          const swing = h.some((q) => /attack|cast/.test(q.st ?? ''));
          let near = 1e9;
          for (const o of all) if (o.team !== m.team && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'structure' || o.kind === 'summon')) near = Math.min(near, Math.hypot(o.x - m.x, o.y - m.y) - (o.radius ?? 0.5));
          const stuck = d < 0.5 && !swing && near > 9;
          const ep = S.open.get(m.id);
          if (stuck) {
            if (!ep) {
              let ns = null; for (const st of structs) { const dd = Math.hypot(st.x - m.x, st.y - m.y); if (!ns || dd < ns.d) ns = { def: st.def, team: st.team, alive: st.alive, d: +dd.toFixed(1) }; }
              S.open.set(m.id, { id: m.id, def: m.def, team: m.team, t0: +(t - 6).toFixed(0), t1: +t.toFixed(0), x: +m.x.toFixed(1), y: +m.y.toFixed(1), state: m.state, nearest: ns, enemyDist: +near.toFixed(1) });
            } else ep.t1 = +t.toFixed(0);
          } else if (ep) { S.stuck.push(ep); S.open.delete(m.id); }
        }
        for (const id of [...S.hist.keys()]) if (!seen.has(id)) { S.hist.delete(id); const ep = S.open.get(id); if (ep) { ep.died = true; S.stuck.push(ep); S.open.delete(id); } }
      }
      B.renderer.render(1 / 30);
      return { t: H.view.time, ended: !!H.ended, nMin: H.view.entities.filter((e) => e.kind === 'minion' && e.alive).length, stuckSoFar: S.stuck.length + S.open.size, open: [...S.open.values()].slice(0, 3) };
    }, 60);
    console.log(`t=${r.t.toFixed(0)} wicks=${r.nMin} stuck=${r.stuckSoFar}${r.ended ? ' ENDED' : ''}`);
    if (r.open.length) {
      const o = r.open[0];
      await page.evaluate((o) => { const B = window.__VALE_BENCH__; B.focus(o.x, o.y); B.renderer.render(1 / 30); B.renderer.render(1 / 30); }, o);
      await shot(page, `owner15_controls_r3_minwatch_${MODE}_s${SEED}_stuck_${String(++shotN).padStart(2, '0')}`);
    }
    if ((sec / 60) % 5 === 4 || sec === 0) {
      // mid first towers (the inner pair nearest the map centre on the mid road: the two structures nearest the centre that are towers)
      const pts = await page.evaluate(() => {
        const B = window.__VALE_BENCH__, v = B.host.view;
        const ss = v.entities.filter((e) => e.kind === 'structure');
        const cx = ss.reduce((s, e) => s + e.x, 0) / ss.length, cy = ss.reduce((s, e) => s + e.y, 0) / ss.length;
        const byTeam = {};
        for (const e of ss) { const d = Math.hypot(e.x - cx, e.y - cy); if (!byTeam[e.team] || d < byTeam[e.team].d) byTeam[e.team] = { x: e.x, y: e.y, d, def: e.def }; }
        return Object.values(byTeam);
      });
      for (const p of pts) {
        await page.evaluate((p) => { const B = window.__VALE_BENCH__; B.focus(p.x, p.y); for (let i = 0; i < 3; i++) B.renderer.render(1 / 30); }, p);
        await shot(page, `owner15_controls_r3_minwatch_${MODE}_s${SEED}_${String(Math.round(r.t / 60)).padStart(2, '0')}min_${p.def}`);
      }
    }
    if (r.ended) break;
  }
  const fin = await page.evaluate(() => { const S = window.__W; return { stuck: [...S.stuck, ...S.open.values()], falls: S.falls, t: window.__VALE_BENCH__.host.view.time }; });
  rep.stuck = fin.stuck; rep.falls = fin.falls; rep.endT = fin.t;
} catch (e) {
  rep.error = String(e?.stack ?? e).slice(0, 800); console.log('ERROR', rep.error);
} finally {
  rep.logs = logs.slice(0, 20);
  writeFileSync(OUT, JSON.stringify(rep, null, 2));
  console.log('stuck episodes', rep.stuck.length, JSON.stringify(rep.stuck.slice(0, 12)));
  console.log('report', OUT);
  await browser.close();
}
