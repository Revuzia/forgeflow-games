// VALE harness — MAX units lane U3/U4: how much a fighter moves while it stands (idle, channel, recall, stunned), in
// the real client with the real clips: every fighter in a match plays each held role in place (Actor.pose: the clip
// looped, the life layer on top) for --frames display frames at 60 Hz (the first 40, the crossfade in, are not measured), the life layer (actors.ts ACTOR_LIFE) off, then on.
//   node _harness/max_units_life.mjs [--t 20] [--frames 360] [--picks a,b,...] [--out _design/reviews/max/units/u3_life.json]
// Per fighter and role: the head's range and the hands' range (cm, actor space) and the longest hold (frames in which
// the head, chest and both hands each moved < 1.5 mm).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openBench, B } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const t = Number(arg('t', 30)), N = Number(arg('frames', 360)), out = arg('out', '_design/reviews/max/units/u3_life.json');
const { browser, page, logs } = await openBench({ q: arg('q', 'high'), t, land: 9000, extra: arg('picks', '') ? `&picks=${arg('picks')}` : '' });
await page.evaluate(async () => {
  const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(`/src/render/${f}`)).pop() ?? `/src/render/${f}`;
  window.__LIFE = (await import(url('actors.ts'))).ACTOR_LIFE;
});
// every fighter actor in the match plays the role in place (Actor.pose: the clip looped, the life layer on top), N frames
const ROLES = ['idle', 'channel', 'recall', 'stunned'];
const sample = (on) => B(page, (b, { on, N, ROLES }) => {
  window.__LIFE.on = on;
  const R = b.renderer, acts = [...R.actors.values()].filter((a) => a.kind === 'fighter' && a.model);
  const NODES = ['head', 'chest', 'handL', 'handR'];
  const v = new (R.scene.position.constructor)();
  const res = {};
  for (const role of ROLES) {
    for (const a of acts) {
      const rows = [];
      for (let f = 0; f < N; f++) {
        a.pose(role, 1 / 60);
        if (f < 40) continue;   // the 0.2 s crossfade from the previous role settles first
        a.root.updateMatrixWorld(true);
        rows.push(NODES.map((n) => { const o = a.model.getObjectByName(n); if (!o) return null; o.getWorldPosition(v); a.root.worldToLocal(v); return [v.x, v.y, v.z]; }));
      }
      const range = (k) => { let mx = 0; for (let i = 0; i < rows.length; i += 2) for (let j = i + 2; j < rows.length; j += 6) { const p = rows[i][k], q = rows[j][k]; if (p && q) mx = Math.max(mx, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); } return mx; };
      let hold = 0, cur = 0;
      for (let k = 1; k < rows.length; k++) {
        const still = rows[k].every((q, n) => !q || !rows[k - 1][n] || Math.hypot(q[0] - rows[k - 1][n][0], q[1] - rows[k - 1][n][1], q[2] - rows[k - 1][n][2]) < 0.0015);
        cur = still ? cur + 1 : 0; hold = Math.max(hold, cur);
      }
      res[`${a.def}/${role}`] = { headCm: +(range(0) * 100).toFixed(1), handCm: +(Math.max(range(2), range(3)) * 100).toFixed(1), holdFrames: hold };
    }
  }
  return res;
}, { on, N, ROLES });
const off = await sample(false);
const on = await sample(true);
const summary = {};
for (const k of Object.keys(off)) summary[k] = { off: off[k], on: on[k] };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ t, frames: N, note: 'each fighter plays the role in place for `frames` display frames at 60 Hz (Actor.pose); actor space; headCm/handCm = range, holdFrames = longest run with head, chest and both hands each under 1.5 mm/frame; off = clips only, on = clips + life layer', summary }, null, 1));
for (const [k, v] of Object.entries(summary).sort()) console.log(k.padEnd(22), 'off', JSON.stringify(v.off), ' on', JSON.stringify(v.on));
if (logs.length) console.log('page errors:', logs.slice(0, 6).join('\n'));
await browser.close();
