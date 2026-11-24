// Measures the numbers a Fire level designer needs, straight from the headless sim.
//   node tests/measure-fire.js
// LEVELS.md section 10 quotes this output. Re-run it after touching src/sim/elements/fire.js or
// src/sim/packs/*.js.

import { frun } from './lib/fire.js';
import { DT } from '../src/sim/constants.js';
import fire, { HEAT_MAX, FLARE_COST, FLARE_UP } from '../src/sim/elements/fire.js';
import { FIRE } from '../src/sim/packs/fire.js';
import { DRIP_SPEED, DRIP_PERIOD, DRIP_R, POOL_BOIL } from '../src/sim/packs/hazards.js';

const F = fire.formDefs;
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const out = [];
const row = (k, v) => out.push(`${k.padEnd(62)} ${v}`);
const as = (form, pieces, extra) => { const r = frun(pieces, extra); if (form !== 'ember') r.form(form); return r; };

function apex(form, { holdTicks = 9999, flareAt = 0 } = {}) {
  const r = as(form);
  r.tick(0, 0, false);
  let m = 0;
  for (let i = 0; i < 900; i++) {
    r.tick(0, 0, i < holdTicks, flareAt && !r.p.grounded && r.p.vy < flareAt && !r.p.airSpecial ? form : null);
    m = Math.max(m, r.p.y);
    if (i > 5 && r.p.grounded) break;
  }
  return m;
}

/** Longest gap (landing `dy` metres higher or lower) cleared with a running jump; `flare` adds the special at the top. */
function maxGap(form, dy, flare = false) {
  let best = 0;
  for (let gap = 0.5; gap <= 12; gap += 0.1) {
    const r = frun([
      { type: 'block', box: [-10, -1, -3, 0, 0, 3] },
      { type: 'block', box: [gap, -1 + dy - 5, -3, gap + 14, dy, 3] },
    ], { noFloor: true, exit: [gap + 13, dy, 2], killY: -9, spawn: [-8, 0, 0] });
    r.allowDeath = true;
    if (form !== 'ember') r.form(form);
    r.p.gauge = HEAT_MAX;
    let ok = false;
    for (let i = 0; i < 1500; i++) {
      const jump = r.p.x > -0.12 - F[form].speed * DT * 2;
      r.tick(1, 0, jump, flare && !r.p.grounded && r.p.vy < 0.3 && !r.p.airSpecial ? form : null);
      if (r.sim.deaths > 0) break;
      if (r.p.grounded && r.p.x > gap - F[form].r + 0.02 && Math.abs(r.p.y - dy) < 1e-6) { ok = true; break; }
    }
    if (ok) best = gap; else if (gap > best + 0.35) break;
  }
  return best;
}

/** Highest ledge that can be jumped onto from the floor. */
function maxLedge(form, flare = false) {
  let best = 0;
  for (let h = 0.1; h <= 3.2; h += 0.05) {
    let ok = false;
    for (let from = 0.05; from <= 2.2 && !ok; from += 0.15) {
      const r = frun([{ type: 'block', box: [3, 0, -3, 9, h, 3] }]);
      if (form !== 'ember') r.form(form);
      r.p.gauge = HEAT_MAX;
      for (let i = 0; i < 500; i++) {
        r.tick(1, 0, r.p.x > 3 - F[form].r - from, flare && !r.p.grounded && r.p.vy < 0.3 && !r.p.airSpecial ? form : null);
        if (r.p.grounded && Math.abs(r.p.y - h) < 1e-6 && r.p.x > 3) { ok = true; break; }
      }
    }
    if (ok) best = h;
  }
  return best;
}

out.push('--- BODY (cylinder: radius, height)');
for (const f of fire.forms) row(f, `r ${F[f].r}  h ${F[f].h}`);

out.push('', '--- HEAT (gauge 0..' + HEAT_MAX + ', starts full unless level.startGauge says otherwise; never refills by itself)');
for (const f of fire.forms) row(`${f}: drain per second / seconds on a full gauge / needed to switch to it`, F[f].drain ? `${F[f].drain} / ${f2(HEAT_MAX / F[f].drain)} / ${F[f].minStart}` : 'none');
row('flare (blaze special): cost / upward speed', `${FLARE_COST} / ${FLARE_UP} m/s`);
row('boil a pool / turn a drip to steam (blaze)', `${F.blaze.water.pool.boil} / ${F.blaze.water.drip.evaporate}`);
row('extra drain in a sprinkler (blaze), per second', F.blaze.water.spray.drain);
row('brazier refill per second (inside its radius)', FIRE.BRAZIER_RATE);
row('kiln fire piece refill per second', fire.kilnFire.feed);
row('coal lump (default) / lighting wood: block, plank, crate, rope', `+${FIRE.COAL_HEAT} / +${FIRE.FUEL.block}, +${FIRE.FUEL.plank}, +${FIRE.FUEL.crate}, +${FIRE.FUEL.rope}`);

for (const form of ['ember', 'blaze', 'spark']) {
  out.push('', `--- ${form.toUpperCase()}`);
  { const r = as(form); let t = 0; while (r.speed < F[form].speed - 1e-6 && t < 240) { r.tick(1, 0); t++; } row('run speed (m/s) / time to reach it (s)', `${F[form].speed} / ${f2(t * DT)}`); }
  { const r = as(form); r.move(1, 0, 1); const x0 = r.p.x; let t = 0; while (r.speed > 1e-6 && t < 240) { r.tick(0, 0); t++; } row('stopping distance from full speed (m)', f2(r.p.x - x0)); }
  row('jump apex, held / shortest tap (m)', `${f2(apex(form))} / ${f2(apex(form, { holdTicks: 1 }))}`);
  row('highest ledge it can jump onto (m)', f2(maxLedge(form)));
  row('longest gap, running jump: level / 1 m lower / 2 m lower / 1 m higher', [0, -1, -2, 1].map((d) => f2(maxGap(form, d))).join(' / '));
  row('step-up without jumping (m)', F[form].step);
  if (form === 'blaze') {
    row('jump + flare at the top: apex (m)', f2(apex('blaze', { flareAt: 0.3 })));
    row('highest ledge with jump + flare (m)', f2(maxLedge('blaze', true)));
    row('longest gap with jump + flare: level / 1 m lower / 1 m higher', [0, -1, 1].map((d) => f2(maxGap('blaze', d, true))).join(' / '));
    { const r = as('blaze'); r.special(); let m = 0; while (!r.p.grounded || m === 0) { r.tick(0, 0); m = Math.max(m, r.p.y); if (r.p.grounded && m > 0.1) break; } row('flare from the ground: rise (m)', f2(m)); }
    row('fall speed limit (m/s)', F.blaze.maxFall);
  }
}

out.push('', '--- SMOKE');
row('rise (m/s) / drift (m/s)', `${F.smoke.rise} / ${F.smoke.speed}`);
{ const r = as('smoke'); r.waitUntil((s, p) => p.form !== 'smoke', { timeout: 30 }); row('climb on a full gauge, no ceiling (m)', f2(r.p.y)); }
{ const r = as('smoke'); r.waitUntil((s, p) => p.form !== 'smoke', { mx: 1, timeout: 30 }); row('level drift on a full gauge (m)', f2(r.p.x)); }
for (const s of [4, 8, 12]) {
  const r = as('smoke', [{ type: 'fan', box: [-9, 0, -4, 49, 40, 4], dir: '+x', strength: s }]);
  const x0 = r.p.x; r.waitUntil((q, p) => p.form !== 'smoke', { mx: 1, timeout: 30 });
  row(`in a tail wind of strength ${s}, full gauge (m)`, f2(r.p.x - x0));
}

out.push('', '--- FANS (net speed walking straight into a head wind; negative = driven back)');
for (const form of ['ember', 'blaze', 'spark']) {
  const vals = [2, 4, 6, 8, 12].map((s) => {
    const r = as(form, [{ type: 'fan', box: [-9.5, 0, -3, 40, 3, 3], dir: '-x', strength: s }]);
    r.p.gauge = HEAT_MAX; r.move(1, 0, 1.2); const x0 = r.p.x; r.move(1, 0, 1);
    return `${s}: ${f2(r.p.x - x0)}`;
  });
  row(form, vals.join('   '));
}

out.push('', '--- PIECES');
row('wood burn time (s): block / plank / crate / rope', `${FIRE.BURN.block} / ${FIRE.BURN.plank} / ${FIRE.BURN.crate} / ${FIRE.BURN.rope}`);
row('fire spreads to touching wood at / gap that stops it (m)', `${FIRE.SPREAD_AT * 100}% burnt / > ${FIRE.SPREAD_GAP}`);
row('fuse burn rate, default (m/s) / reach to light its end (m)', `${FIRE.FUSE_RATE} / ${FIRE.FUSE_REACH}`);
row('lantern reach, default (m, hero centre to flame)', FIRE.LANTERN_R);
row('brazier radius, default (m)', FIRE.BRAZIER_R);
row('ice block melt time, default (s of touch)', FIRE.ICE_MELT);
row('wax sag time, default (s of touch) / height it sags to (m)', `${FIRE.WAX_MELT} / ${FIRE.WAX_MIN}`);
row('wire speed, default (m/s)', FIRE.WIRE_SPEED);
row('gas: default launch (m/s) / reach (m) / refill (s) / chain delay (s)', `[${FIRE.GAS_LAUNCH}] / ${FIRE.GAS_RADIUS} / ${FIRE.GAS_REFILL} / ${FIRE.GAS_CHAIN}`);
row('coal pick-up radius (m)', FIRE.COAL_R);
row('pool: default seconds boiled', POOL_BOIL);
row('drip: fall speed (m/s) / period (s) / drop radius (m)', `${DRIP_SPEED} / ${DRIP_PERIOD} / ${DRIP_R}`);

out.push('', '--- GAS LAUNCH ARCS (standing in the pocket when it goes off; no stick input)');
function launch(form, vec) {
  const r = as(form, [{ type: 'sensor', box: [-1, 0, -1, 1, 2, 1], emit: 'q', visible: false }, { type: 'gas', box: [-1, 0, -1, 1, 1.5, 1], on: { delay: 'q', for: 0.3 }, launch: vec }]);
  r.p.gauge = HEAT_MAX;
  let top = 0, t0 = 0;
  r.waitUntil((s) => !s.level.gases[0].full, { timeout: 3 }); t0 = r.t;
  r.waitUntil((s, p) => { top = Math.max(top, p.y); return p.grounded || p.form === 'ember' && form === 'smoke'; }, { timeout: 12 });
  return `up ${f2(top)} m, along ${f2(r.p.x)} m, ${f2(r.t - t0)} s`;
}
for (const vec of [[0, 13, 0], [6, 11, 0], [10, 8, 0]]) {
  for (const form of ['ember', 'blaze', 'spark']) row(`launch [${vec}]  ${form} (x${F[form].blastScale})`, launch(form, vec));
}

console.log(out.join('\n'));
