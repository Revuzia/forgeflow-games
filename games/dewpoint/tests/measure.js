// Measures the numbers a level designer needs, straight from the headless sim.
//   node tests/measure.js
// LEVELS.md quotes this output. Re-run it after touching src/sim/constants.js.

import { run } from './lib/mini.js';
import { DT, FORMS } from '../src/sim/constants.js';

const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const out = [];
const row = (k, v) => out.push(`${k.padEnd(58)} ${v}`);

function apex(form, holdTicks = 9999, pieces = []) {
  const r = run(pieces);
  if (form !== 'liquid') r.form(form);
  r.tick(0, 0, false);
  let m = 0;
  for (let i = 0; i < 400; i++) { r.tick(0, 0, i < holdTicks); m = Math.max(m, r.p.y); if (i > 5 && r.p.grounded) break; }
  return m;
}

/** Longest gap (same height, or landing `drop` metres lower / `rise` higher) cleared with a running jump. */
function maxGap(form, dy) {
  let best = 0;
  for (let gap = 0.5; gap <= 9; gap += 0.1) {
    const r = run([
      { type: 'block', box: [-10, -1, -3, 0, 0, 3] },
      { type: 'block', box: [gap, -1 + dy - 5, -3, gap + 12, dy, 3] },
    ], { noFloor: true, exit: [gap + 11, dy, 2], killY: -8, spawn: [-8, 0, 0] });
    r.allowDeath = true;
    if (form !== 'liquid') r.form(form);
    // run up, jump on the last tick before the edge
    let ok = false;
    for (let i = 0; i < 1200; i++) {
      const jump = r.p.x > -0.15 - FORMS[form].speed * DT * 2;
      r.tick(1, 0, jump);
      if (r.sim.deaths > 0) break;
      if (r.p.grounded && r.p.x > gap - 0.37 && Math.abs(r.p.y - dy) < 1e-6) { ok = true; break; }
    }
    if (ok) best = gap; else if (gap > best + 0.35) break;
  }
  return best;
}

/** Highest ledge that can be jumped onto from the floor. */
function maxLedge(form) {
  let best = 0;
  for (let h = 0.1; h <= 2.2; h += 0.05) {
    let ok = false;
    // try jumping from several distances short of the ledge, with a run-up
    for (let from = 0.05; from <= 1.6 && !ok; from += 0.15) {
      const r = run([{ type: 'block', box: [3, 0, -3, 30, h, 3] }], { spawn: [-6, 0, 0] });
      if (form !== 'liquid') r.form(form);
      for (let i = 0; i < 480; i++) {
        r.tick(1, 0, r.p.x > 3 - FORMS[form].r - from);
        if (r.p.grounded && Math.abs(r.p.y - h) < 1e-6 && r.p.x > 3) { ok = true; break; }
      }
    }
    if (ok) best = h;
  }
  return best;
}

out.push('--- sizes (collision cylinder: radius, height) ---');
for (const f of Object.keys(FORMS)) row(`${f}`, `r ${FORMS[f].r}  h ${FORMS[f].h}`);

out.push('\n--- liquid ---');
{
  const r = run(); let t = 0; while (r.speed < FORMS.liquid.speed - 1e-6 && t < 240) { r.tick(1, 0); t++; }
  row('run speed (m/s) / time to reach it (s)', `${FORMS.liquid.speed} / ${f2(t * DT)}`);
  const x0 = r.p.x; let n = 0; while (r.speed > 0 && n < 240) { r.tick(0, 0); n++; }
  row('stopping distance from full speed (m)', f2(r.p.x - x0));
}
row('jump apex, held (m)', f2(apex('liquid')));
row('jump apex, shortest tap (m)', f2(apex('liquid', 1)));
row('highest ledge reachable by jumping (m)', f2(maxLedge('liquid')));
row('longest gap, running jump, same height (m)', f2(maxGap('liquid', 0)));
row('longest gap landing 1 m lower / 2 m lower (m)', `${f2(maxGap('liquid', -1))} / ${f2(maxGap('liquid', -2))}`);
row('longest gap landing 1 m higher (m)', f2(maxGap('liquid', 1)));
row('step-up without jumping (m)', FORMS.liquid.step);
row('jump apex inside a strength-6 updraft (m)', f2(apex('liquid', 9999, [{ type: 'fan', box: [-2, 0, -2, 2, 9, 2], dir: '+y', strength: 6 }])));

out.push('\n--- ice ---');
{
  const r = run(); r.form('ice'); let t = 0; while (r.speed < FORMS.ice.speed - 0.01 && t < 600) { r.tick(1, 0); t++; }
  row('top speed from input (m/s) / time (s) / distance (m)', `${FORMS.ice.speed} / ${f2(t * DT)} / ${f2(r.p.x)}`);
  let x0 = r.p.x, n = 0; while (r.speed > 0 && n < 2400) { r.tick(0, 0); n++; }
  row('coasting distance from top speed, stick released (m)', f2(r.p.x - x0));
  const q = run(); q.form('ice'); q.move(1, 0, 2); x0 = q.p.x; n = 0; while (q.p.vx > 0 && n < 2400) { q.tick(-1, 0); n++; }
  row('braking distance from top speed, stick reversed (m)', f2(q.p.x - x0));
}
row('jump apex (m)', f2(apex('ice')));
row('highest ledge reachable by jumping (m)', f2(maxLedge('ice')));
row('longest gap, running jump, same height (m)', f2(maxGap('ice', 0)));
row('step-up without jumping (m)', FORMS.ice.step);
for (const [rise, run_] of [[1, 2], [2, 4], [3, 6], [3, 8], [4, 8], [6, 12]]) {
  const r = run([
    { type: 'block', box: [-10, 0, -3, 0.5, rise, 3] },
    { type: 'ramp', box: [0.5, 0, -3, 0.5 + run_, rise, 3], up: '-x' },
  ], { spawn: [0, rise, 0] });
  r.form('ice');
  r.waitUntil((s, p) => p.x > 0.5 + run_ + 0.6, { mx: 1, timeout: 12 });
  row(`speed at the bottom of a ramp dropping ${rise} m over ${run_} m (m/s)`, f2(r.speed));
}
{
  // can ice climb a ramp from a standing start at its foot / with a full run-up?
  const res = [];
  for (const slope of [0.2, 0.3, 0.4, 0.5, 0.6, 0.75]) {
    const mk = (startX) => {
      const r = run([{ type: 'ramp', box: [4, 0, -3, 4 + 2 / slope, 2, 3], up: '+x' }, { type: 'block', box: [4 + 2 / slope, 0, -3, 30, 2, 3] }], { spawn: [startX, 0, 0] });
      r.form('ice');
      for (let i = 0; i < 960; i++) { r.tick(1, 0); if (r.p.grounded && r.p.y > 1.99) return true; }
      return false;
    };
    res.push(`${slope}:${mk(3.3) ? 'yes' : 'no'}/${mk(-6) ? 'yes' : 'no'}`);
  }
  row('climbs a 2 m high ramp of slope s? (from standstill/with run-up)', res.join('  '));
}
{
  // kicker: flat run at speed v into a ramp rising 1 m over 2.5 m, then a gap at the same height as the crest
  const res = [];
  for (const v of [6.5, 9, 12, 15]) {
    const r = run([{ type: 'ramp', box: [6, 0, -3, 8.5, 1, 3], up: '+x' }], { spawn: [0, 0, 0] });
    r.form('ice'); r.p.vx = v;
    let landed = null;
    for (let i = 0; i < 600; i++) {
      r.tick(1, 0); if (r.p.x < 5.5) r.p.vx = v;
      if (r.p.x > 9 && r.p.grounded) { landed = r.p.x - 8.5; break; }
    }
    res.push(`${v}->${landed === null ? '?' : f2(landed)}`);
  }
  row('kicker (1 m rise over 2.5 m): entry speed -> flight past the crest, landing 1 m lower (m)', res.join('  '));
}

out.push('\n--- steam ---');
{
  const r = run(); r.form('steam'); const y0 = r.p.y; r.wait(1); const y1 = r.p.y; r.wait(1);
  row('rise speed (m/s)', f2(r.p.y - y1));
  const q = run(); q.form('steam'); let maxY = 0, n = 0; while (q.p.form === 'steam' && n < 1200) { q.tick(); n++; maxY = Math.max(maxY, q.p.y); }
  row('gauge (s) / total climb on a full gauge, no fan (m)', `${f2(n * DT)} / ${f2(maxY - y0)}`);
  const d = run([], {}); d.sim.teleport(-9, 0, 0); d.wait(0.2); d.form('steam'); const x0 = d.p.x; n = 0; while (d.p.form === 'steam' && n < 1200) { d.tick(1, 0); n++; }
  row('drift speed (m/s) / horizontal range on a full gauge (m)', `${FORMS.steam.speed} / ${f2(d.p.x - x0)}`);
  row('gauge needed to vaporise (s) / refill time on the ground (s)', `0.40 / ${f2(4 / 2)}`);
  for (const s of [4, 6, 8, 12]) {
    const u = run([{ type: 'fan', box: [-3, 0, -3, 3, 40, 3], dir: '+y', strength: s }]); u.form('steam'); n = 0; let top = 0; while (u.p.form === 'steam' && n < 1200) { u.tick(); n++; top = Math.max(top, u.p.y); }
    const h = run([{ type: 'fan', box: [-9.5, 0, -3, 60, 30, 3], dir: '+x', strength: s }]); h.sim.teleport(-9, 0, 0); h.wait(0.1); h.form('steam'); const hx = h.p.x; n = 0; while (h.p.form === 'steam' && n < 1200) { h.tick(1, 0); n++; }
    row(`fan strength ${s}: climb in an updraft / distance in a tail wind, full gauge (m)`, `${f2(top)} / ${f2(h.p.x - hx)}`);
  }
}

out.push('\n--- film ---');
row('crawl speed (m/s)', FORMS.film.speed);
row('height (m): fits under any gap taller than', `${FORMS.film.h} (use >= 0.25)`);
row('step-up (m)', FORMS.film.step);

out.push('\n--- fans vs liquid (head wind) ---');
for (const s of [2, 4, 6, 7, 8]) {
  const r = run([{ type: 'fan', box: [2, 0, -3, 40, 3, 3], dir: '-x', strength: s }]);
  r.move(1, 0, 2); const x0 = r.p.x; r.move(1, 0, 1);
  row(`strength ${s}: liquid's net speed walking into it (m/s)`, f2(r.p.x - x0));
}

console.log(out.join('\n'));
