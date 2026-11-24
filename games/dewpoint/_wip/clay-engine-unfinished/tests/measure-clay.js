// Measures the numbers a Clay level designer needs, straight from the headless sim.
//   node tests/measure-clay.js
// LEVELS.md section 11 quotes this output. Re-run it after touching src/sim/elements/clay.js,
// src/sim/packs/clay.js or src/sim/sim.js. Every number is a real run with real inputs (the stick,
// jump, form buttons); the only shortcut is sim.forceForm('stone') where a test would otherwise
// first walk into a kiln.

import { crun } from './lib/clay.js';
import { DT } from '../src/sim/constants.js';
import clay, { DUST_MAX, DUST_REFILL, DUST_MIN_START } from '../src/sim/elements/clay.js';
import { CLAY } from '../src/sim/packs/clay.js';

const F = clay.formDefs;
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const out = [];
const row = (k, v) => out.push(`${k.padEnd(66)} ${v}`);
const as = (form, pieces, extra) => {
  const r = crun(pieces, extra);
  r.allowDeath = true;
  if (form !== 'clay') r.sim.forceForm(form);
  r.p.gauge = DUST_MAX;
  return r;
};

function apex(form, holdTicks = 9999) {
  const r = as(form);
  r.tick(0, 0, false);
  let m = 0;
  for (let i = 0; i < 900; i++) { r.tick(0, 0, i < holdTicks); m = Math.max(m, r.p.y); if (i > 5 && r.p.grounded) break; }
  return m;
}

/** Longest gap (landing `dy` metres higher or lower) cleared with a running jump; `dustAt` presses dust at that vy after the jump. */
export function maxGap(form, dy, { dust = false } = {}) {
  let best = 0;
  for (let gap = 0.5; gap <= 16; gap += 0.1) {
    const r = as(form, [
      { type: 'block', box: [-10, -1, -3, 0, 0, 3] },
      { type: 'block', box: [gap, -1 + dy - 5, -3, gap + 18, dy, 3] },
    ], { noFloor: true, exit: [gap + 17, dy, 2], killY: -12, spawn: [-8, 0, 0] });
    let ok = false, pressed = false;
    for (let i = 0; i < 2400; i++) {
      const jump = r.p.x > -0.12 - F[form].speed * DT * 2 && !pressed;
      let fm = null;
      if (dust && !pressed && !r.p.grounded && r.p.vy < 0.2 && r.p.x > -0.5) { fm = 'dust'; pressed = true; }
      r.tick(1, 0, jump && !dust ? true : jump && r.p.grounded, fm);
      if (r.sim.deaths > 0) break;
      if ((r.p.grounded || (dust && r.p.form === 'dust')) && r.p.x > gap - F[form].r + 0.02 && Math.abs(r.p.y - dy) < 0.05 && (r.p.grounded || r.p.vy > -0.05)) { ok = true; break; }
      if (dust && r.p.form === 'dust' && r.p.x > gap + 0.2 && r.p.y <= dy + 0.01) { ok = true; break; }
    }
    if (ok) best = gap; else if (gap > best + 0.5) break;
  }
  return best;
}

/** Highest ledge that can be jumped onto from the floor. */
function maxLedge(form, start = 0, pre = null) {
  let best = 0;
  for (let h = 0.1; h <= 4; h += 0.05) {
    let ok = false;
    for (let from = 0.05; from <= 2.2 && !ok; from += 0.15) {
      const r = as(form, [{ type: 'block', box: [3, 0, -3, 9, start + h, 3] }, ...(start ? [{ type: 'block', box: [-10, 0, -3, 2.2, start, 3] }] : [])], start ? { spawn: [0, start, 0] } : {});
      if (pre) pre(r);
      for (let i = 0; i < 500; i++) {
        r.tick(1, 0, r.p.x > 3 - F[form].r - from);
        if (r.p.grounded && Math.abs(r.p.y - (start + h)) < 1e-6 && r.p.x > 3) { ok = true; break; }
      }
    }
    if (ok) best = h;
  }
  return best;
}

/** Tallest rough wall Dab climbs onto: from standing (walk into it), or with a jump at it first. */
function maxClimb({ jump = false, start = 0 } = {}) {
  let best = 0;
  for (let h = 1.0; h <= 9; h += 0.1) {
    const r = as('clay', [{ type: 'rough', box: [2, 0, -3, 4, start + h, 3] }, ...(start ? [{ type: 'block', box: [-10, 0, -3, 2, start, 3] }] : [])], start ? { spawn: [0, start, 0] } : {});
    let ok = false;
    for (let i = 0; i < 1500; i++) {
      const j = jump && r.p.x > 2 - F.clay.r - 0.9 && r.p.grounded && r.p.y < start + 0.01;
      r.tick(1, 0, j);
      if (r.p.grounded && r.p.y > start + h - 0.01) { ok = true; break; }
      if (!r.p.climb && !r.p.grounded && r.p.vy < -2 && i > 60) break;
    }
    if (ok) best = h; else if (h > best + 0.6) break;
  }
  return best;
}

out.push('--- BODY (cylinder: radius, height)');
for (const f of clay.forms) row(f, `r ${F[f].r}  h ${F[f].h}  (${F[f].move})`);

out.push('', `--- DUST GAUGE (0..${DUST_MAX}; refills ${DUST_REFILL}/s on the ground in any other form)`);
row('dust: drain per second / seconds on a full gauge / needed to switch to it', `${F.dust.drain} / ${f2(DUST_MAX / F.dust.drain)} / ${DUST_MIN_START}`);
row('refill from empty to full (s, standing)', f2(DUST_MAX / DUST_REFILL));
row('in a fan stream: drain', 'none (windHold)');
row('a fan drying slip into dust fills the gauge', 'yes');

out.push('', '--- GRIP (per climb; refills on the ground)');
row('grip on a full gauge (s) / refill per second / needed to take hold', `${CLAY.GRIP_MAX} / ${CLAY.GRIP_REFILL} / ${CLAY.GRIP_MIN}`);
row('climb up / down / sideways (m/s); hang under a ceiling (m/s)', `${CLAY.CLIMB_UP} / ${CLAY.CLIMB_DOWN} / ${CLAY.CLIMB_SIDE}; ${CLAY.HANG_SPEED}`);
row('push into a wall from the ground before Dab starts up it (s)', CLAY.GRAB_DELAY);

for (const form of ['clay', 'stone']) {
  out.push('', `--- ${form.toUpperCase()}`);
  { const r = as(form); let t = 0; while (r.speed < F[form].speed - 1e-6 && t < 600) { r.tick(1, 0); t++; } row('run speed (m/s) / time to reach it (s)', `${F[form].speed} / ${f2(t * DT)}`); }
  { const r = as(form); r.move(1, 0, 1.5); const x0 = r.p.x; let t = 0; while (r.speed > 1e-6 && t < 600) { r.tick(0, 0); t++; } row('stopping distance from full speed (m)', f2(r.p.x - x0)); }
  row('jump apex, held / shortest tap (m)', `${f2(apex(form))} / ${f2(apex(form, 1))}`);
  row('highest ledge it can jump onto (m)', f2(maxLedge(form)));
  row('longest gap, running jump: level / 1 m lower / 2 m lower / 1 m higher', [0, -1, -2, 1].map((d) => f2(maxGap(form, d))).join(' / '));
  row('step-up without jumping (m)', F[form].step);
}

out.push('', '--- CLIMBING (clay)');
{
  const r = as('clay', [{ type: 'rough', box: [2, 0, -3, 4, 8, 3] }]);
  r.waitUntil((s, p) => !!p.climb, { mx: 1, timeout: 3 });
  const t0 = r.t, y0 = r.p.y;
  r.waitUntil((s, p) => !p.climb, { mx: 1, timeout: 6 });
  row('climb from the floor on a full grip: height gained before it slips off (m) / time (s)', `${f2(r.p.y - y0)} / ${f2(r.t - t0)}`);
}
row('tallest rough wall climbed onto from standing (m)', f2(maxClimb()));
row('tallest rough wall climbed onto with a running jump at it first (m)', f2(maxClimb({ jump: true })));
{
  const r = as('clay', [{ type: 'rough', box: [-3, 1.8, -3, 30, 2.4, 3] }]);
  r.tick(0, 0, false);
  r.waitUntil((s, p) => p.climb && p.climb.mode === 'ceil', { jump: true, timeout: 2 });
  const x0 = r.p.x;
  r.waitUntil((s, p) => !p.climb, { mx: 1, timeout: 6 });
  row('rough ceiling 1.8 m up: reached by a standing jump; hang distance on a full grip (m)', f2(r.p.x - x0));
}
{
  let best = 0;
  for (let hgt = 1.0; hgt < 3; hgt += 0.05) {
    const r = as('clay', [{ type: 'rough', box: [-3, hgt, -3, 30, hgt + 0.5, 3] }]);
    r.tick(0, 0, false);
    let ok = false;
    for (let i = 0; i < 200; i++) { r.tick(0, 0, true); if (r.p.climb) { ok = true; break; } }
    if (ok) best = hgt;
  }
  row('highest rough ceiling a standing jump reaches (m, floor to underside)', f2(best));
}
{
  const r = as('clay', [{ type: 'rough', box: [2, 0, -3, 4, 8, 3] }]);
  r.waitUntil((s, p) => p.climb && p.y > 1.5, { mx: 1, timeout: 4 });
  const x0 = r.p.x, y0 = r.p.y;
  r.tick(0, 0, false); r.tick(0, 0, true);
  let top = r.p.y;
  r.waitUntil((s, p) => { top = Math.max(top, p.y); return p.grounded; }, { jump: true, timeout: 4 });
  row('jump off a wall: rises (m) / lands this far out from the wall, no stick (m)', `${f2(top - y0)} / ${f2(x0 - r.p.x)}`);
}

out.push('', '--- SLIP');
{ const r = as('slip'); let t = 0; while (r.speed < F.slip.speed - 1e-6 && t < 600) { r.tick(1, 0); t++; } row('speed on the flat (m/s) / time to reach it (s)', `${F.slip.speed} / ${f2(t * DT)}`); }
{ const r = as('slip'); r.move(1, 0, 1.5); const x0 = r.p.x; let t = 0; while (r.speed > 1e-6 && t < 900) { r.tick(0, 0); t++; } row('stopping distance from full speed (m)', f2(r.p.x - x0)); }
for (const slope of [0.25, 0.5, 0.75, 1.0]) {
  const L = 12, H = L * slope;
  const mk = () => as('slip', [{ type: 'ramp', box: [2, 0, -3, 2 + L, H, 3], up: '+x' }, { type: 'block', box: [2 + L, 0, -3, 2 + L + 6, H, 3] }]);
  const r = mk(); r.move(1, 0, 0.6);
  let x0 = null, t0 = 0;
  for (let i = 0; i < 2400; i++) { r.tick(1, 0); if (x0 === null && r.p.x > 4) { x0 = r.p.x; t0 = r.t; } if (r.p.x > 2 + L - 2) break; if (x0 !== null && r.t - t0 > 6) break; }
  const up = x0 === null ? 0 : (r.p.x - x0) / Math.max(1e-6, r.t - t0);
  const d = as('slip', [{ type: 'ramp', box: [2, 0, -3, 2 + L, H, 3], up: '+x' }, { type: 'block', box: [2 + L, 0, -3, 2 + L + 6, H, 3] }], { spawn: [2 + L + 4, H, 0] });
  d.move(-1, 0, 1.6);
  let sp = 0; for (let i = 0; i < 300; i++) { d.tick(-1, 0); if (d.p.x < 2 + L - 1 && d.p.x > 4) sp = Math.max(sp, Math.hypot(d.p.vx, d.p.vz)); }
  // let go half way down: it oozes on downhill by itself
  const f = as('slip', [{ type: 'ramp', box: [2, 0, -3, 2 + L, H, 3], up: '+x' }, { type: 'block', box: [2 + L, 0, -3, 2 + L + 6, H, 3] }], { spawn: [2 + L + 4, H, 0] });
  f.waitUntil((s, p) => p.x < 2 + L / 2, { mx: -1, timeout: 8 });
  f.wait(0.8); const flow = Math.hypot(f.p.vx, f.p.vz);
  row(`slope ${slope} (${H.toFixed(1)} m over ${L} m): uphill / downhill / let go, oozes (m/s)`, `${up > 0.05 ? f2(up) : 'cannot climb'} / ${f2(sp)} / ${f2(flow)}`);
}
row('step-up / fits under a gap taller than (m)', `${F.slip.step} / ${F.slip.h}`);

out.push('', '--- DUST');
{ const r = as('dust', [], { spawn: [0, 6, 0] }); r.wait(1.5); row('sinks at (m/s) / drifts at (m/s)', `${f2(-r.p.vy)} / ${F.dust.speed}`); }
{
  const r = as('dust', [{ type: 'block', box: [-10, 0, -3, 0, 20, 3] }], { spawn: [-1, 20, 0], noFloor: true, killY: -30 });
  const x0 = r.p.x, y0 = r.p.y;
  r.waitUntil((s, p) => p.form !== 'dust', { mx: 1, timeout: 12 });
  row('from a ledge, full gauge, stick forward: along (m) / down (m) before it settles to clay', `${f2(r.p.x - x0)} / ${f2(y0 - r.p.y)}`);
}
row('running jump as clay then dust at the top: longest gap level / 2 m lower / 4 m lower', [0, -2, -4].map((d) => f2(maxGap('clay', d, { dust: true }))).join(' / '));
for (const s of [4, 8, 12]) {
  const r = as('dust', [{ type: 'fan', box: [-9, 0, -4, 49, 6, 4], dir: '+x', strength: s }], { spawn: [0, 2, 0] });
  r.wait(2); const v = r.p.vx;
  row(`tail wind strength ${s}: carried at (m/s), no gauge spent`, `${f2(v)}  gauge ${f2(r.p.gauge)}`);
}
for (const s of [2, 4, 8]) {
  const r = as('dust', [{ type: 'fan', box: [-3, 0, -3, 3, 30, 3], dir: '+y', strength: s }], { spawn: [0, 0.5, 0] });
  r.wait(2); row(`updraft strength ${s}: rises at (m/s)`, f2(r.p.vy));
}
{
  const r = as('dust', [{ type: 'fan', box: [-9, 0, -4, 6, 6, 4], dir: '+x', strength: 8 }, { type: 'block', box: [-10, -1, -4, 6, 0, 4] }], { spawn: [0, 3, 0], noFloor: true, killY: -40 });
  r.waitUntil((s, p) => p.x > 6, { timeout: 6 });
  const x0 = r.p.x, y0 = r.p.y;
  r.waitUntil((s, p) => p.form !== 'dust', { timeout: 12 });
  row('leaving a strength-8 stream 3 m up, stick released: glides on (m) / sinks (m)', `${f2(r.p.x - x0)} / ${f2(y0 - r.p.y)}`);
}

out.push('', '--- STONE AND ITS SHELL');
row('shell block w x h x d (m)', CLAY.SHELL.join(' x '));
row('highest ledge stone reaches: from the floor / after shedding a shell next to it', `${f2(maxLedge('stone'))} / ${f2(maxLedge('stone', 0, (r) => { r.walkTo(2.2, 0); r.special(); }) )}`);
row('highest ledge clay reaches standing on a shell (0.7 m) / its own jump from the floor', `${f2(0.7 + maxLedge('clay', 0.7))} / ${f2(maxLedge('clay'))}`);
row('tallest rough wall climbed onto from the top of a shell (measured from the floor)', f2(0.7 + maxClimb({ jump: true, start: 0.7 })));
for (const [speed, name] of [[5.5, 'default pane (5.5 m/s)'], [9, 'pane speed 9']]) {
  let best = null;
  for (let hgt = 0.1; hgt < 8 && best === null; hgt += 0.05) {
    const r = as('stone', [{ type: 'block', box: [-3, 0, -3, 3, hgt, 3] }, { type: 'pane', box: [-1, -0.3, -1, 1, -0.2, 1], speed }], { spawn: [0, hgt, 0], noFloor: true, killY: -20 });
    r.sim.teleport(0, hgt + 0.01, 0); r.sim.level.solids.find((s) => s.owner.type === 'block').active = false;
    r.waitUntil((s, p) => p.grounded || s.level.panes[0].broken || p.y < -2, { timeout: 4 });
    if (r.sim.level.panes[0].broken) best = hgt + 0.2;
  }
  row(`fall needed to smash a floor pane, ${name} (m)`, f2(best));
}

out.push('', '--- FANS (net speed walking straight into a head wind; negative = driven back)');
for (const form of ['clay', 'stone']) {
  const vals = [2, 4, 8, 12].map((s) => {
    const r = as(form, [{ type: 'fan', box: [-9.5, 0, -3, 40, 3, 3], dir: '-x', strength: s }]);
    r.move(1, 0, 1.5); const x0 = r.p.x; r.move(1, 0, 1);
    return `${s}: ${f2(r.p.x - x0)}`;
  });
  row(form, vals.join('   '));
}
row('slip in any fan', 'dried to dust at once (full gauge), then carried');

out.push('', '--- PISTON PUNCH (default fling ' + CLAY.PISTON.fling + ' m/s, lift ' + CLAY.PISTON.lift + ' m/s; standing in front of a +x piston on the flat, no stick)');
for (const form of ['clay', 'slip', 'stone', 'dust']) {
  const r = as(form, [{ type: 'piston', box: [-1.2, 0, -0.6, -0.4, 1, 0.6], dir: '+x', on: 'go' }, { type: 'sensor', box: [-30, 0, -9, 49, 9, 9], emit: 'any', visible: false }], { signals: { go: { delay: 'any', for: 0.3 } } });
  r.p.gauge = DUST_MAX;
  const x0 = r.p.x;
  let top = r.p.y;
  r.waitUntil((s) => s.level.pistons[0].t > 0.99, { timeout: 3 });
  r.waitUntil((s, p) => { top = Math.max(top, p.y); return p.ivx === 0 && Math.abs(p.vx) < 0.05 && (p.grounded || p.form === 'dust'); }, { timeout: 8 });
  row(`${form} (x${F[form].pistonScale}): thrown along (m) / up (m)`, `${f2(r.p.x - x0)} / ${f2(top)}`);
}

out.push('', '--- POTTER\'S WHEEL (default r 1.2, rim 5 m/s; standing on the rim, then jumping (slip: sliding) off over a 3 m drop)');
for (const form of ['clay', 'slip', 'stone']) {
  const r = as(form, [{ type: 'block', box: [-10, -3.35, -10, 50, -3, 10] }, { type: 'wheel', pos: [0, -0.35, 0], r: 1.2, h: 0.35 }, { type: 'block', box: [-1.2, -3, -1.2, 1.2, -0.35, 1.2] }], { noFloor: true, spawn: [0, 0, F[form].jump ? 0.9 : 0.4], killY: -20 });
  if (F[form].jump) r.wait(0.5);
  let x0 = r.p.x, z0 = r.p.z, sp = 0;
  if (F[form].jump) {
    // wait until the hero is carried along +x, then jump (no stick)
    r.waitUntil((s, p) => p.wheel && p.wheelV[0] > 0 && Math.abs(p.wheelV[1]) < 0.6, { timeout: 5 });
    x0 = r.p.x; z0 = r.p.z; sp = Math.hypot(r.p.wheelV[0], r.p.wheelV[1]);
    r.waitUntil((s, p) => !p.wheel && p.vy < 0, { timeout: 2, jump: true });     // a full, held jump
  } else {
    // slip slides outward on its own and leaves over the rim
    r.waitUntil((s, p) => { if (p.wheel) { x0 = p.x; z0 = p.z; sp = Math.hypot(p.wheelV[0], p.wheelV[1]); } return !p.wheel; }, { timeout: 8 });
    r.waitUntil((s, p) => !p.grounded || Math.hypot(p.vx, p.vz) < 0.05, { timeout: 4 });
  }
  r.waitUntil((s, p) => p.grounded, { timeout: 6 });
  const back = r.p.y > -1;
  row(`${form} (x${F[form].wheelFling}): rim speed at release ${f2(sp)} m/s; lands this far from where it left (m)`, `${f2(Math.hypot(r.p.x - x0, r.p.z - z0))}${back ? ' (back on the wheel: it cannot be thrown off)' : ''}`);
}
{
  // the wheel as a launcher: run WITH the spin and jump off the rim
  const r = as('clay', [{ type: 'block', box: [-10, -3.35, -10, 50, -3, 10] }, { type: 'wheel', pos: [0, -0.35, 0], r: 1.2, h: 0.35 }, { type: 'block', box: [-1.2, -3, -1.2, 1.2, -0.35, 1.2] }], { noFloor: true, spawn: [0, 0, 0.75], killY: -20 });
  r.waitUntil((s, p) => p.wheel && p.wheelV[0] > 0 && Math.abs(p.wheelV[1]) < 0.6, { timeout: 5 });
  const x0 = r.p.x;
  r.waitUntil((s, p) => !p.wheel && p.vy < 0, { mx: 1, jump: true, timeout: 2 });
  r.waitUntil((s, p) => p.grounded, { mx: 1, timeout: 6 });
  row('clay running with the spin and jumping off the rim: lands this far along (m, 3 m drop)', f2(r.p.x - x0));
  const q = as('clay', [{ type: 'block', box: [-10, -3.35, -10, 50, -3, 10] }, { type: 'block', box: [-1.2, -3, -1.2, 1.2, 0, 1.2] }], { noFloor: true, spawn: [0, 0, 0.75], killY: -20 });
  const x1 = q.p.x;
  q.waitUntil((s, p) => p.x > 0.8, { mx: 1, timeout: 2 });
  q.waitUntil((s, p) => !p.grounded && p.vy < 0, { mx: 1, jump: true, timeout: 2 });
  q.waitUntil((s, p) => p.grounded, { mx: 1, timeout: 6 });
  row('  (the same run and jump off a still block of the same size)', f2(q.p.x - x1));
}

console.log(out.join('\n'));
