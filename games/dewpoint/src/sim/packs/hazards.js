// Pack: WATER HAZARDS - `pool`, `drip`, `sprinkler` (LEVELS.md section 10).
//
// A pack is a set of element-only mechanisms (ELEMENTS.md "Packs"). This one never asks which
// form or element the hero is: each form says how it meets water in its `water` flag,
//     water: { pool: <reaction>, drip: <reaction>, spray: <reaction> }
// and a reaction is one of
//     'die'                   put out: respawn at the checkpoint (cause 'water')
//     'ignore' / undefined    nothing happens
//     { boil: cost }          (pool) turn the pool to passable steam for its `boil` seconds, spending `cost` gauge
//     { evaporate: cost }     (drip) the drop is gone, spending `cost` gauge
//     { drain: perSecond }    (spray) survive, but the gauge runs down this much faster inside
//     { to: form, back }      become `form`; with `back: true` the hero is also shoved back out of the water
// A reaction that costs more gauge than the hero has is 'die'. So Clay can say `pool: { to: 'slip' }`
// and Fire `pool: 'die'` and both use the same piece.

export const DRIP_R = 0.16;             // radius of a falling drop, m
export const DRIP_SPEED = 4.5;          // default fall speed, m/s (constant and slow: readable, easy to time)
export const DRIP_PERIOD = 1.6;         // default seconds between drops
export const POOL_BOIL = 3;             // default seconds a boiled pool stays passable
const BOIL_REACH = 0.25;                // a form that boils a pool does so from this far off, m

function douse(sim, p) {
  sim.sfx('extinguish', 1);
  sim.ev({ type: 'burst', kind: 'douse_hero', x: p.x, y: p.y, z: p.z });
  sim.respawn('water');
  return true;
}

/** Apply a { to, back } reaction. Returns true when the hero died instead (the new form had no room). */
function turn(sim, p, r, box) {
  if (p.form !== r.to) {
    const T = sim.F[r.to];
    if (!((T.r <= p.r && T.h <= p.h) || sim.fits(r.to))) return douse(sim, p);   // no room to change: put out
    sim._changeForm(r.to, 'water');
  }
  if (r.back && box) {
    // out through the nearest side of the spray, at rest: it drops where the water turned it back
    const l = p.x - box[0], rr = box[3] - p.x, n = p.z - box[2], f = box[5] - p.z, m = Math.min(l, rr, n, f), e = p.r + 0.08;
    if (m === l) p.x = box[0] - e; else if (m === rr) p.x = box[3] + e; else if (m === n) p.z = box[2] - e; else p.z = box[5] + e;
    p.vx = 0; p.vz = 0; p.bvx = 0; p.bvz = 0; if (p.vy > 0) p.vy = 0;
  }
  return false;
}

export default {
  name: 'hazards',
  types: ['pool', 'drip', 'sprinkler'],

  init(L) { L.pools = []; L.drips = []; L.sprinklers = []; },

  build(type, def, p, c) {
    const L = c.L;
    if (type === 'pool') {
      c.box();
      p.boil = c.num(def.boil, POOL_BOIL); if (!(p.boil > 0)) c.pf('boil must be > 0 (seconds a boiled pool stays passable)');
      p.on = c.onNode(); p.active = !p.on;
      p.steamT = 0;                    // > 0 while boiled away
      p.wet = p.active;                // water is really there (active and not boiled)
      L.pools.push(p);
    } else if (type === 'drip') {
      p.pos = c.vec3(def.pos, 'pos', c.pf);
      p.speed = c.num(def.speed, DRIP_SPEED); if (!(p.speed > 0)) c.pf('speed must be > 0');
      p.period = c.num(def.period, DRIP_PERIOD); if (!(p.period > 0)) c.pf('period must be > 0');
      p.offset = c.num(def.offset, 0); if (!(p.offset >= 0)) c.pf('offset must be >= 0 (seconds before the first drop)');
      p.drop = def.drop === undefined ? null : c.num(def.drop, 0);
      if (p.drop !== null && !(p.drop > 0)) c.pf('drop must be > 0 (metres the drop falls)');
      p.on = c.onNode(); p.active = !p.on;
      p.clock = -p.offset - 1e-9;      // seconds since the current drop left the nozzle (negative: not yet)
      p.y = p.pos[1]; p.py = p.y; p.live = false; p.count = 0;
      c.grow([p.pos[0], p.pos[1], p.pos[2], p.pos[0], p.pos[1], p.pos[2]]);
      L.drips.push(p);
    } else {
      c.box();
      p.on = c.onNode(); p.active = !p.on;
      p.period = c.num(def.period, 0); if (p.period < 0) c.pf('period must be >= 0 (0 = sprays all the time)');
      p.duty = c.num(def.duty, 0.5); if (!(p.duty > 0 && p.duty <= 1)) c.pf('duty must be in (0, 1]: the fraction of each period it sprays');
      p.offset = c.num(def.offset, 0);
      p.clock = p.offset; p.wet = p.active;
      L.sprinklers.push(p);
    }
  },

  finish(L, c) {
    // a drip with no `drop` falls to the first block or ramp top below its nozzle
    for (const d of L.drips) {
      if (d.drop === null) {
        let top = -Infinity;
        for (const s of L.solids) {
          const t = s.owner.type;
          if ((t !== 'block' && t !== 'ramp') || s.y1 > d.pos[1] + 1e-6) continue;
          if (d.pos[0] < s.x0 || d.pos[0] > s.x1 || d.pos[2] < s.z0 || d.pos[2] > s.z1) continue;
          if (s.y1 > top) top = s.y1;
        }
        if (top === -Infinity) c.fail(`piece #${d.index} (drip): nothing below the nozzle to fall onto - give it "drop" (metres)`);
        d.drop = d.pos[1] - top;
        if (!(d.drop > 0.3)) c.fail(`piece #${d.index} (drip): the nozzle must be at least 0.3 m above the floor`);
      }
      if (d.drop / d.speed >= d.period) c.fail(`piece #${d.index} (drip): period ${d.period}s is shorter than the ${(d.drop / d.speed).toFixed(2)}s fall - one drop at a time`);
      d.fallT = d.drop / d.speed;
    }
  },

  settle(sim) {
    const L = sim.level, S = sim.signals;
    for (const q of L.pools) { q.active = q.on ? S.read(q.on) : true; q.wet = q.active; }
    for (const d of L.drips) d.active = d.on ? S.read(d.on) : true;
    for (const s of L.sprinklers) { s.active = s.on ? S.read(s.on) : true; s.wet = s.active && (s.period <= 0 || (s.clock >= 0 && s.clock < s.period * s.duty)); }
  },

  actuators(sim, dt) {
    const L = sim.level, S = sim.signals;
    for (const q of L.pools) {
      q.active = q.on ? S.read(q.on) : true;
      if (q.steamT > 0) {
        q.steamT -= dt;
        if (q.steamT <= 0) { q.steamT = 0; if (q.active) sim.sfx('splash', 0.5, (q.box[0] + q.box[3]) / 2, q.box[4], (q.box[2] + q.box[5]) / 2); }
      }
      q.wet = q.active && q.steamT <= 0;
    }
    for (const d of L.drips) {
      d.active = d.on ? S.read(d.on) : true;
      d.py = d.y;
      // a drop already falling finishes its fall; a switched-off drip releases no new ones and
      // starts again with a fresh drop the moment it is switched back on
      if (!d.active && !d.live) { d.clock = -1e-9; continue; }
      const before = d.clock;
      d.clock += dt;
      let release = before < 0 && d.clock >= 0;
      if (d.clock >= d.period) { d.clock -= d.period; release = true; }
      if (release) {
        if (!d.active) { d.live = false; d.clock = -1e-9; continue; }
        d.live = true; d.spent = false; d.count++; d.py = d.pos[1];
      }
      if (!d.live) continue;
      if (d.clock >= d.fallT) {
        d.live = false; d.y = d.pos[1] - d.drop;
        sim.ev({ type: 'burst', kind: 'drip', x: d.pos[0], y: d.y, z: d.pos[2] });
      } else d.y = d.pos[1] - d.speed * d.clock;
    }
    for (const s of L.sprinklers) {
      s.active = s.on ? S.read(s.on) : true;
      let wet = s.active;
      if (s.period > 0) {
        s.clock += dt; if (s.clock >= s.period) s.clock -= s.period;
        wet = wet && s.clock >= 0 && s.clock < s.period * s.duty;
      }
      s.wet = wet;
    }
  },

  /** Called every tick before the hero moves. Returns true when the hero was respawned. */
  hazards(sim, p, env, dt) {
    const W = p.caps.water;
    if (!W) return false;
    const L = sim.level;
    for (const q of L.pools) {
      if (!q.wet) continue;
      const r = W.pool, b = q.box;
      if (r && r.boil !== undefined && sim._bodyInBox(p, b, -BOIL_REACH, -BOIL_REACH)) {
        if (p.gauge < r.boil) { if (sim._bodyInBox(p, b, 0.06, 0.04)) return douse(sim, p); continue; }
        sim.addGauge(-r.boil);
        q.steamT = q.boil; q.wet = false;
        const x = (b[0] + b[3]) / 2, z = (b[2] + b[5]) / 2;
        sim.sfx('vaporize', 1, x, b[4], z);
        sim.ev({ type: 'burst', kind: 'boil', x, y: b[4], z, piece: q.index });
        continue;
      }
      if (!sim._bodyInBox(p, b, 0.06, 0.04)) continue;
      if (!r || r === 'ignore') continue;
      if (r === 'die' || r.to === undefined) return douse(sim, p);
      if (turn(sim, p, r, b)) return true;
    }
    for (const d of L.drips) {
      if (!d.live) continue;
      const dx = p.x - d.pos[0], dz = p.z - d.pos[2], rr = p.r + DRIP_R;
      if (dx * dx + dz * dz >= rr * rr || d.y > p.y + p.h + DRIP_R || d.y < p.y - DRIP_R) continue;
      const r = W.drip;
      if (!r || r === 'ignore') continue;
      d.live = false;                                   // whatever happens, this drop is spent
      sim.ev({ type: 'burst', kind: 'drip', x: d.pos[0], y: d.y, z: d.pos[2], hit: true });
      if (r === 'die') return douse(sim, p);
      if (r.evaporate !== undefined) {
        if (p.gauge < r.evaporate) return douse(sim, p);
        sim.addGauge(-r.evaporate);
        sim.sfx('ember_douse', 0.6);                    // a hiss: the drop is gone, and a bite of the gauge with it
        continue;
      }
      if (r.to !== undefined) { if (turn(sim, p, r, null)) return true; continue; }
      return douse(sim, p);
    }
    for (const s of L.sprinklers) {
      if (!s.wet || !sim._bodyInBox(p, s.box, 0.06, 0.04)) continue;
      const r = W.spray;
      if (!r || r === 'ignore') continue;
      if (r === 'die') return douse(sim, p);
      if (r.drain !== undefined) {
        if (p.gauge <= 0) return douse(sim, p);
        sim.addGauge(-r.drain * dt);
        if (sim.tick % 30 === 0) sim.sfx('ember_douse', 0.35);
        continue;
      }
      if (r.to !== undefined) { if (turn(sim, p, r, s.box)) return true; continue; }
      return douse(sim, p);
    }
    return false;
  },

  fingerprint(sim, out) {
    const L = sim.level;
    for (const q of L.pools) out.push(q.steamT);
    for (const d of L.drips) out.push(d.clock, d.live ? 1 : 0);
    for (const s of L.sprinklers) out.push(s.wet ? 1 : 0);
  },
};
