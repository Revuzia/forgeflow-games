// VALE harness — MAX units lane U4: soft-part follow-through in the real client. Every fighter in a match plays each
// role in place (Actor.pose, 60 Hz) with the chain follow-through (actors.ts ACTOR_LIFE.chains) off, then on; per
// fighter and role, over its chain and hanging bones (x_<chain>_<n>, x_hang_*, x_cord*, x_mantle_*, x_lantern): the
// largest world-space turn in one display frame (deg) and its 99th percentile.
//   node _harness/max_units_chain.mjs [--roles run,attack1,attack2,cast_ult,dash] [--frames 240] [--picks ...] [--out ...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openBench, B } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const N = Number(arg('frames', 240)), out = arg('out', '_design/reviews/max/units/u4_chain.json');
const ROLES = arg('roles', 'run,attack1,attack2,cast_a1,cast_ult,dash').split(',');
const { browser, page, logs } = await openBench({ q: 'high', t: 10, land: 9000, extra: arg('picks', '') ? `&picks=${arg('picks')}` : '' });
await page.evaluate(async () => {
  const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(`/src/render/${f}`)).pop() ?? `/src/render/${f}`;
  window.__LIFE = (await import(url('actors.ts'))).ACTOR_LIFE;
});
const sample = (on) => B(page, (b, { on, N, ROLES }) => {
  window.__LIFE.chains = on;
  const R = b.renderer, acts = [...R.actors.values()].filter((a) => a.kind === 'fighter' && a.model);
  const RE = /^x_(?:[a-z]+[a-z0-9]*(?:_[a-z0-9]+)*_\d+|hang_[lr]|cord|cord_swing|mantle_[lr]|lantern)$/i;
  const Q = R.scene.quaternion.constructor;
  const res = {};
  for (const role of ROLES) for (const a of acts) {
    const bones = []; a.model.traverse((o) => { if (RE.test(o.name)) bones.push(o); });
    if (!bones.length) continue;
    const prev = bones.map(() => new Q()), cur = new Q(), steps = [];
    for (let f = 0; f < N; f++) {
      a.pose(role, 1 / 60);
      a.root.updateMatrixWorld(true);
      bones.forEach((o, i) => { o.getWorldQuaternion(cur); if (f > 30) steps.push(prev[i].angleTo(cur) * 180 / Math.PI); prev[i].copy(cur); });
    }
    steps.sort((x, y) => x - y);
    res[`${a.def}/${role}`] = { bones: bones.length, maxDeg: +steps[steps.length - 1].toFixed(1), p99Deg: +steps[Math.floor(steps.length * 0.99)].toFixed(1) };
  }
  return res;
}, { on, N, ROLES });
const off = await sample(false), on = await sample(true);
const summary = {};
for (const k of Object.keys(off)) summary[k] = { off: off[k], on: on[k] };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ frames: N, note: 'per display frame (60 Hz) world-space turn of the chain and hanging bones; off = clip only, on = clip + follow-through (lag, 12 deg/frame cap, 30 deg max trail)', summary }, null, 1));
for (const [k, v] of Object.entries(summary).sort()) console.log(k.padEnd(20), 'off', JSON.stringify(v.off), ' on', JSON.stringify(v.on));
if (logs.length) console.log('page errors:', logs.slice(0, 6).join('\n'));
await browser.close();
