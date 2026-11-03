// VALE harness — polish OBS-camjump: after a camera focus jump (respawn re-centre, Space, a minimap click) every body
// the new view holds must be drawn on the FIRST frame (the closing review saw bars drawn with their bodies missing).
//
// The real renderer (render bench, real Chrome GPU, heavy slot), RIFT fast-forwarded to 370 s. For each trial the camera
// sits on one spot for 10 frames, then jumps to a visible unit 40+ m away and ONE frame is rendered. Counted on that
// frame: the actors in the viewer's vision whose body sphere is inside the camera frustum, and how many of them are not
// drawn (root hidden by the actor cull). `--ab 1` also runs every trial with the post-camera re-cull switched off
// (renderer.recullActors, the old behaviour) for the before number.
//
//   node _harness/probe_camjump.mjs [--trials 12] [--ab 1]   → _harness/_reports/fw_CW1_camjump.json; exit 0 = 0 dropped
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPS = join(HERE, '_reports'), SHOTS = join(HERE, '_shots');
mkdirSync(REPS, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const TRIALS = Number(opt('trials', '12')), AB = opt('ab', '1') === '1';
const OUT = join(REPS, 'fw_CW1_camjump.json');

const { browser, page } = await open('/_harness/web/render_bench.html?mode=rift&q=high&t=370&dev=1&hud=0&manual=1', { wait: false, hmr: false });
const report = { at: new Date().toISOString(), trials: [], pass: true, fails: [] };
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B((b) => b.frames(20, 1 / 30));
  const run = async (off) => {
    const rows = [];
    for (let t = 0; t < TRIALS; t++) {
      const r = await B(async (b, a) => {
        const R = b.renderer;
        const orig = R.recullActors;
        if (a.off) R.recullActors = () => { R.culledVis.length = 0; };
        try {
          const units = b.entities().filter((e) => (e.kind === 'fighter' || e.kind === 'minion' || e.kind === 'monster') && e.alive && (e.mask & 1));
          if (units.length < 2) return null;
          // a start spot and a target ≥ 40 m from it (trial t picks the t-th pair, deterministic)
          const from = units[(a.t * 7) % units.length];
          const far = units.filter((e) => Math.hypot(e.x - from.x, e.y - from.y) > 40);
          if (!far.length) return null;
          const to = far[(a.t * 5) % far.length];
          b.focus(from.x, from.y); b.frames(10, 1 / 30);
          b.focusEntity(to.id); b.frames(1, 1 / 30);
          const cam = R.rig.camera;
          const V = cam.position.constructor;
          let inView = 0, dropped = 0; const drop = [];
          for (const ac of R.actors.values()) {
            if (!ac.visible || !ac.model || !ac.view || !ac.view.alive) continue;
            // the body's middle projects inside the frame (5 % in from the edges)
            const q = new V(ac.x, ac.h + ac.artHeight * 0.5, ac.y).project(cam);
            if (Math.abs(q.x) > 0.95 || Math.abs(q.y) > 0.95 || q.z < -1 || q.z > 1) continue;
            inView++;
            if (!ac.root.visible) { dropped++; drop.push(`${ac.view.kind}:${ac.view.def}`); }
          }
          return { from: [from.x, from.y], to: [to.x, to.y], toKind: to.kind, inView, dropped, drop: drop.slice(0, 6) };
        } finally { R.recullActors = orig; }
      }, { t, off });
      if (r) rows.push(r);
    }
    return rows;
  };
  const after = await run(false);
  report.trials = after;
  report.after = { trials: after.length, inView: after.reduce((s, r) => s + r.inView, 0), dropped: after.reduce((s, r) => s + r.dropped, 0) };
  console.log(`camjump after:  ${report.after.trials} jumps, ${report.after.inView} bodies in view on the first frame, ${report.after.dropped} not drawn`);
  if (AB) {
    const before = await run(true);
    report.beforeTrials = before;
    report.before = { trials: before.length, inView: before.reduce((s, r) => s + r.inView, 0), dropped: before.reduce((s, r) => s + r.dropped, 0) };
    console.log(`camjump before: ${report.before.trials} jumps, ${report.before.inView} bodies in view on the first frame, ${report.before.dropped} not drawn (re-cull off)`);
  }
  if (!report.after.trials) { report.pass = false; report.fails.push('no jump trial ran'); }
  if (report.after.dropped > 0) { report.pass = false; report.fails.push(`${report.after.dropped} bodies in view not drawn on the first frame after a jump`); }
} catch (e) {
  report.pass = false; report.fails.push(`harness error: ${e.stack ?? e.message}`);
} finally {
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
for (const f of report.fails) console.log('FAIL', f);
console.log(report.pass ? 'camjump: PASS' : 'camjump: FAIL', '→', OUT);
process.exit(report.pass ? 0 : 1);
