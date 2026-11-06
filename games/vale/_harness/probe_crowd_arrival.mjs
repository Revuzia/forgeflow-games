// VALE probe — the triangle governor on the frame a crowd arrives (CW1 r3 refix, done:7; src/render/renderer.ts frameMatch,
// src/render/crowd.ts CrowdLayer.estimate). The verifier's seed 11 drew 398k -> 518k on one frame (29 -> 52 units), the governor
// a frame late. A real late-match scene is frozen (no pump, so both arms draw the same world); on one frame every crowd unit is
// pushed twice, an arrival as large as the crowd on screen. Control: the estimate reads 0 (the governor as it was, last frame's
// count only). Shipped: the estimate. Also reads the estimate against the crowd's measured triangles (the frame with no crowd).
//   node _harness/probe_crowd_arrival.mjs [--seed 11] [--rot 5] [--tag name]    exit 0 pass, 1 fail, 2 the scene never qualified
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const BUDGET = 500000;
mkdirSync(join(HERE, '_reports'), { recursive: true });
const OUT = join(HERE, '_reports', `fw_CW1_crowd_arrival${opt('tag', '') ? '_' + opt('tag', '') : ''}.json`);
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=0&seed=${opt('seed', 11)}&rot=${opt('rot', 5)}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
let code = 1;
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  // play the match on at x8 until a crowded, ungoverned frame, then stop pumping
  await page.evaluate(() => {
    const b = window.__VALE_BENCH__, r = b.renderer, host = b.host, S = (window.__S = { done: false, found: false, t: 0, seen: 0, best: 0 });
    host.setTimeScale(8); b.follow();
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      host.pump(dt); r.render(dt);
      const st = r.stats(); S.t = host.view.time; S.best = Math.max(S.best, st.crowd ?? 0);
      if (host.view.time > 600 && (st.crowd ?? 0) >= 24 && st.triangles >= 300000 && st.triangles <= 400000 && !r.crowdHard) { S.found = true; S.done = true; S.crowd = st.crowd; S.tris = st.triangles; return; }
      if (host.ended) { S.done = true; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForFunction(() => window.__S.done, null, { timeout: 1500000, polling: 2000 });
  const S = await page.evaluate(() => window.__S);
  if (!S.found) { console.log(`probe_crowd_arrival: NOT MEASURED, no frame qualified (game ${S.t} s, most crowd ${S.best})`); code = 2; }
  else {
    const res = await page.evaluate(() => {
      const r = window.__VALE_BENCH__.renderer, c = r.crowd, push = c.push.bind(c), est = c.estimate.bind(c);
      let n = 1;
      c.push = (a) => { for (let i = 0; i < n; i++) push(a); };
      const frame = () => { r.render(1 / 60); const s = r.stats(); return { tris: s.triangles, crowd: s.crowd ?? 0, hard: !!r.crowdHard, estimate: Math.round(r.crowdEstimate) }; };
      const settle = () => { let f = 0; for (; f < 30 || (r.crowdHard && f < 900); f++) frame(); return f; };
      const arm = (name) => {
        const settled = settle();
        const before = frame();
        n = 2; const arrival = frame(); const next = frame(); n = 1;
        return { name, settled, before, arrival, next };
      };
      c.estimate = () => 0;
      const control = arm('control');
      c.estimate = est;
      const shipped = arm('shipped');
      // the estimate against what the crowd really draws
      settle();
      const withCrowd = frame();
      n = 0; frame(); const without = frame(); n = 1;
      return { control, shipped, accuracy: { withCrowd, without, crowdTris: withCrowd.tris - without.tris, estimate: withCrowd.estimate, ratio: +(withCrowd.estimate / (withCrowd.tris - without.tris)).toFixed(3) } };
    });
    const { control, shipped, accuracy } = res;
    console.log(`scene: game ${S.t.toFixed(1)} s, ${S.crowd} units, ${S.tris} triangles`);
    for (const a of [control, shipped]) console.log(`${a.name.padEnd(8)} before ${a.before.tris} (${a.before.crowd} units)  arrival frame ${a.arrival.tris} (${a.arrival.crowd} units, governed ${a.arrival.hard})  next ${a.next.tris} (governed ${a.next.hard})`);
    console.log(`estimate ${accuracy.estimate} vs measured crowd ${accuracy.crowdTris} (x${accuracy.ratio})`);
    const fails = [];
    if (control.arrival.tris <= shipped.before.tris + 60000) fails.push('the arrival added too little to test');
    if (!shipped.arrival.hard) fails.push('the governor did not engage on the arrival frame');
    if (control.arrival.hard) fails.push('control: the governor engaged on the arrival frame, so the control does not control');
    if (shipped.arrival.tris > BUDGET) fails.push(`arrival frame ${shipped.arrival.tris} > ${BUDGET}`);
    if (accuracy.ratio < 0.7 || accuracy.ratio > 1.3) fails.push(`estimate off by x${accuracy.ratio}`);
    writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), scene: S, ...res, fails }, null, 1));
    console.log(fails.length ? `probe_crowd_arrival: FAIL ${fails.join('; ')}` : 'probe_crowd_arrival: PASS');
    code = fails.length ? 1 : 0;
  }
} finally { await browser.close(); }
process.exit(code);
