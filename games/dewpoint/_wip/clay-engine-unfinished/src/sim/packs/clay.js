// Pack: CLAY MECHANISMS - rough, mould (+ its cast), piston, heat, sieve, wheel, and Stone's shell
// (LEVELS.md section 11; the pack interface is in ELEMENTS.md section 7).
//
// Nothing here asks which form or element the hero is. Every reaction is decided by a capability
// flag of the current form (`p.caps`):
//   climbsRough   sticks to `rough` walls (climbs them) and rough ceilings (hangs under them) while
//                 its grip lasts (p.grip, refilled on the ground)
//   fillsMould    filling a `mould` by lying in it; leaving it leaves a cast block behind
//   passesSieve   falls down through a `sieve` (never up through it: from below it is a ceiling)
//   windForm      a fan turns this form into that one (slip dries to dust), with a full gauge
//   windHold      the gauge does not run down while a fan carries it (dust rides a fan for ever)
//   soakTo        what running water (a `current`) turns it into; inside water no other form can be chosen
//   pistonScale   how hard a piston's punch throws it (1 when absent)
//   wheelFling    how much of a potter's wheel's rim speed it keeps when it leaves the wheel (0 when absent)
//   wheelSlide    a spinning wheel slides it outward (at this fraction of the rim speed)
// Pools (the hazards pack) soak by each form's `water` flag; this pack adds the "wet" refusal and the
// soak sound. Shell and cast blocks are free rigid boxes made with the core's makeCrate, so they
// fall, ride movers, weigh plates of both kinds and are pushed by any form with `pushesCrates`.

import { moveBody, overlapsAny, xzPen } from '../collide.js';

export const CLAY = {
  GRIP_MAX: 3.5,           // seconds of grip on a full gauge (wall or ceiling)
  GRIP_REFILL: 5,          // grip per second regained on the ground (full in 0.7 s)
  GRIP_MIN: 0.3,           // grip needed to take hold of a rough surface
  CLIMB_UP: 1.8,           // m/s up a rough wall (stick into the wall)
  CLIMB_DOWN: 2.6,         // m/s down it (stick away from the wall)
  CLIMB_SIDE: 1.6,         // m/s along it
  HANG_SPEED: 2.0,         // m/s under a rough ceiling
  REACH: 0.06,             // body surface within this of a rough face can take hold
  GRAB_DELAY: 0.12,        // s of pushing into a rough wall from the ground before Dab starts up it
  PUSH_OFF: 3.2,           // m/s away from the wall when jumping off it
  PUSH_UP: 6.2,            // m/s upward when jumping off it
  REGRAB: 0.3,             // s after letting go before any rough surface can be taken again
  MANTLE_IN: 0.2,          // m: where the body's centre lands inside the top edge when it climbs over
  SHELL: [0.8, 0.7, 0.8],  // shell block w, h, d (m)
  MOULD_FILL: 0.7,         // default s for slip to fill a mould
  PISTON: { stroke: 1.5, out: 7, back: 2, hold: 0.4, period: 3, fling: 7, lift: 5 },
  WHEEL: { r: 1.2, h: 0.35, speed: 5, spinUp: 0.8 },
  WET: 'wet',              // refusal reason inside water
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PEN = { nx: 0, nz: 0 };
const MOVE = { grounded: false, snap: false, stepGround: 0, stepAir: 0 };
const PISTON_DIRS = ['+x', '-x', '+z', '-z', '+y'];

// ---------------------------------------------------------------------------- climbing helpers
/** The rough wall face the body touches (or null): { s, nx, nz } with n the face's outward normal. */
function wallContact(L, p, reach, needMid = true) {
  const mid = p.y + p.h * 0.5;
  let best = null, bd = Infinity;
  for (const q of L.roughs) {
    const s = q.solid;
    if (!s.active) continue;
    if (needMid ? (mid < s.y0 - 0.02 || mid > s.y1 + 0.02) : (p.y + p.h < s.y0 || p.y > s.y1)) continue;
    const qx = clamp(p.x, s.x0, s.x1), qz = clamp(p.z, s.z0, s.z1), dx = p.x - qx, dz = p.z - qz;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-9 || d > p.r + reach) continue;
    // a face, not a corner: the body's centre must be in front of the face
    let nx = 0, nz = 0;
    if (Math.abs(dx) >= Math.abs(dz)) { if (dz !== 0) continue; nx = Math.sign(dx); } else { if (dx !== 0) continue; nz = Math.sign(dz); }
    if (d < bd) { bd = d; best = { s, nx, nz }; }
  }
  return best;
}

/** The rough ceiling right above the body (its underside within `tol` of the head, centre under it), or null. */
function ceilingAbove(L, p, tol = 0.04) {
  const head = p.y + p.h;
  for (const q of L.roughs) {
    const s = q.solid;
    if (!s.active || Math.abs(s.y0 - head) > tol) continue;
    if (p.x > s.x0 && p.x < s.x1 && p.z > s.z0 && p.z < s.z1) return s;
  }
  return null;
}

function stick(sim, p, mode, s, nx, nz) {
  p.climb = { mode, s, nx, nz };
  p.vx = 0; p.vy = 0; p.vz = 0; p.bvx = 0; p.bvz = 0; p.ivx = 0; p.ivz = 0;
  p.grounded = false; p.ground = null; p.jumping = false; p.coyoteT = 0; p.pushT = 0;
  sim.sfx('climb_stick', 0.8);
  sim.ev({ type: 'burst', kind: 'stick', mode, x: p.x, y: p.y + p.h * 0.5, z: p.z, nx, nz });
}

function letGo(sim, p, why) {
  if (!p.climb) return;
  const c = p.climb;
  p.climb = null; p.climbCd = CLAY.REGRAB;
  sim.ev({ type: 'burst', kind: 'unstick', why, mode: c.mode, x: p.x, y: p.y + p.h * 0.5, z: p.z });
}

/** Would a cylinder of the hero's size fit with its feet at (x, y, z)? */
function fitsAt(sim, p, x, y, z) {
  const q = sim._probe;
  q.form = p.form; q.caps = p.caps; q.r = p.r; q.h = p.h; q.x = x; q.y = y; q.z = z;
  return !overlapsAny(sim, q, y, 0.01);
}

/** Is anything (a crate, the hero) in the box? Used before a shell or cast appears. */
function boxFree(sim, body) { return !overlapsAny(sim, body, body.y, 0.005); }

// ---------------------------------------------------------------------------- shells and casts
function crumble(sim, c, kind) {
  if (c.gone) return;
  const b = c.body;
  c.gone = true; c.grounded = false; c.solid.active = false; b.ground = null;
  sim.sfx('shell_crumble', 1, b.x, b.y + b.h / 2, b.z);
  sim.ev({ type: 'burst', kind, x: b.x, y: b.y, z: b.z, w: b.hx * 2, h: b.h, d: b.hz * 2 });
}

function place(sim, c, x, y, z) {
  const b = c.body;
  b.x = x; b.y = y; b.z = z; b.vy = 0; b.ground = null;
  c.px = x; c.py = y; c.pz = z; c.grounded = false; c.gone = false; c.solid.active = true;
  c.home = [x, y, z]; c.resets0 = c.resets;
  sim._syncCrate(c, x, y, z);
}

function castMould(sim, m) {
  const c = m.cast, b = c.body, B = m.box;
  // try the cast where it will stand; wait while anything is in the way
  const ox = b.x, oy = b.y, oz = b.z, wasGone = c.gone, wasActive = c.solid.active;
  b.x = (B[0] + B[3]) / 2; b.y = B[1]; b.z = (B[2] + B[5]) / 2;
  c.solid.active = false;
  const free = boxFree(sim, b) && !sim._bodyInBox(sim.player, [B[0], B[1], B[2], B[3], B[4], B[5]], 0.01, 0.01);
  b.x = ox; b.y = oy; b.z = oz; c.solid.active = wasActive;
  if (!free) return false;
  if (!wasGone) crumble(sim, c, 'castcrumble');
  place(sim, c, (B[0] + B[3]) / 2, B[1], (B[2] + B[5]) / 2);
  m.full = false; m.t = 0; m.pt = 0; m.casts++;
  sim.sfx('mould_cast', 1, b.x, b.y + b.h / 2, b.z);
  sim.ev({ type: 'burst', kind: 'cast', x: b.x, y: b.y, z: b.z, w: b.hx * 2, h: b.h, d: b.hz * 2, piece: m.index });
  return true;
}

// ---------------------------------------------------------------------------- pistons
function headBox(q, t) {
  const b = q.box, o = q.stroke * t, d = q.d;
  return [b[0] + d[0] * o, b[1] + d[1] * o, b[2] + d[2] * o, b[3] + d[0] * o, b[4] + d[1] * o, b[5] + d[2] * o];
}
const boxesOverlap = (a, b, m = 0) => a[0] < b[3] - m && a[3] > b[0] + m && a[1] < b[4] - m && a[4] > b[1] + m && a[2] < b[5] - m && a[5] > b[2] + m;

/** Push everything in front of an extending piston head by `delta` metres. False = something is pinned: stall. */
function pistonPush(sim, q, delta) {
  const L = sim.level, p = sim.player, d = q.d, nb = headBox(q, q.t + delta / q.stroke);
  const up = d[1] > 0;
  // crates (shells, casts, plain crates) in the way of a sideways head are shoved, all or nothing
  if (!up) {
    for (const c of L.crates) {
      if (c.gone) continue;
      const cb = [c.body.x - c.body.hx, c.body.y, c.body.z - c.body.hz, c.body.x + c.body.hx, c.body.y + c.body.h, c.body.z + c.body.hz];
      if (!boxesOverlap(nb, cb, 0.005) || cb[1] >= nb[4] - 0.02) continue;     // riding on top of the head: carried, not pushed
      const ax = Math.abs(d[0]) > 0;
      const pen = ax ? (d[0] > 0 ? nb[3] - cb[0] : cb[3] - nb[0]) : (d[2] > 0 ? nb[5] - cb[2] : cb[5] - nb[2]);
      if (pen <= 0) continue;
      if (sim._pushCrate(c, d[0] * pen, d[2] * pen) <= 0) return false;
    }
  }
  // the hero
  if (sim.completed || p.respawnT > 0) return true;
  const hb = [p.x - p.r, p.y, p.z - p.r, p.x + p.r, p.y + p.h, p.z + p.r];
  if (!boxesOverlap(nb, hb, 0.002)) return true;
  if (p.grounded && p.ground === q.solid) return true;              // standing on the head: the core carries it
  if (!up && p.y >= nb[4] - 0.02) return true;
  const ox = p.x, oy = p.y, oz = p.z;
  let need;
  if (up) need = nb[4] - p.y;
  else {
    const s = { x0: nb[0], z0: nb[2], x1: nb[3], z1: nb[5] };
    need = xzPen(s, p, PEN);
    if (need <= 0) return true;
  }
  if (p.climb) letGo(sim, p, 'piston');
  moveBody(sim, p, up ? 0 : d[0] * need, up ? need : 0, up ? 0 : d[2] * need, { grounded: p.grounded, snap: false, stepGround: 0, stepAir: 0 });
  const moved = (p.x - ox) * d[0] + (p.y - oy) * d[1] + (p.z - oz) * d[2];
  if (moved < need - 0.004) { p.x = ox; p.y = oy; p.z = oz; return false; }   // pinned against something: the piston waits
  if (!q.flung) {
    q.flung = true;
    const k = p.caps.pistonScale === undefined ? 1 : p.caps.pistonScale;
    // (a cloud is pushed along, not tossed up: its own drag slows it, see hazards())
    const lift = p.caps.move === 'float' ? 0 : q.lift * k;
    if (up) sim.launch(0, q.fling * k, 0);
    else sim.launch(d[0] * q.fling * k, lift, d[2] * q.fling * k);
    sim.sfx('squish', 0.8);
    sim.ev({ type: 'burst', kind: 'punch', x: p.x, y: p.y + p.h / 2, z: p.z, dx: d[0], dy: d[1], dz: d[2], piece: q.index });
  }
  return true;
}

// ---------------------------------------------------------------------------- the pack
const pack = {
  name: 'clay',
  types: ['rough', 'mould', 'piston', 'heat', 'sieve', 'wheel'],

  init(L) { L.roughs = []; L.moulds = []; L.casts = []; L.pistons = []; L.heats = []; L.sieves = []; L.wheels = []; L.shell = null; },

  build(type, def, p, c) {
    const L = c.L;
    switch (type) {
      case 'rough': {
        const b = c.box(); c.thin(b);
        p.mat = def.mat || 'clay'; p.rough = true;
        p.solid = c.solid(p, 'box', b);
        L.roughs.push(p); break;
      }
      case 'mould': {
        const b = c.box(); c.thin(b);
        const w = b[3] - b[0], h = b[4] - b[1], d = b[5] - b[2];
        if (w < 0.4 || h < 0.4 || d < 0.4) c.pf('a mould (the cast it makes) must be at least 0.4 m on every axis');
        p.fill = c.num(def.fill, CLAY.MOULD_FILL); if (!(p.fill > 0)) c.pf('fill must be > 0 (seconds of slip in it)');
        p.emit = c.emit(false);
        p.t = 0; p.pt = 0; p.full = false; p.casts = 0;
        // the block it casts: a free rigid box, out of the world until the first cast
        const cast = { type: 'cast', id: p.id ? `${p.id}-cast` : null, index: p.index, def: null, crate: true, mould: p };
        c.makeCrate(cast, [(b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2], [w, h, d]);
        cast.gone = true; cast.solid.active = false; cast.resets0 = 0;
        p.cast = cast;
        L.moulds.push(p); L.casts.push(cast); break;
      }
      case 'piston': {
        const b = c.box(); c.thin(b);
        p.dir = def.dir === undefined ? '+x' : def.dir;
        if (!PISTON_DIRS.includes(p.dir)) c.pf(`dir must be one of ${PISTON_DIRS.join(' ')}`);
        p.d = c.dirs[p.dir];
        const P = CLAY.PISTON;
        p.stroke = c.num(def.stroke, P.stroke); if (!(p.stroke >= 0.2 && p.stroke <= 6)) c.pf('stroke must be 0.2 to 6 m');
        p.out = c.num(def.out, P.out); if (!(p.out > 0 && p.out <= 12)) c.pf('out must be in (0, 12] m/s');
        p.back = c.num(def.back, P.back); if (!(p.back > 0 && p.back <= 12)) c.pf('back must be in (0, 12] m/s');
        p.hold = c.num(def.hold, P.hold); if (p.hold < 0) c.pf('hold must be >= 0');
        p.period = c.num(def.period, P.period);
        p.offset = c.num(def.offset, 0); if (p.offset < 0) c.pf('offset must be >= 0');
        p.fling = c.num(def.fling, P.fling); if (p.fling < 0) c.pf('fling must be >= 0');
        p.lift = c.num(def.lift, P.lift); if (p.lift < 0) c.pf('lift must be >= 0');
        p.on = c.onNode();
        const cycle = p.stroke / p.out + p.hold + p.stroke / p.back;
        if (!p.on && !(p.period >= cycle + 0.1)) c.pf(`period ${p.period}s is shorter than one stroke out and back (${cycle.toFixed(2)}s + 0.1)`);
        p.t = 0; p.pt = 0; p.clock = -p.offset; p.flung = false; p.stall = false; p.target = 0;
        p.solid = c.solid(p, 'box', b);
        c.grow(headBox(p, 1));
        L.pistons.push(p); break;
      }
      case 'heat': {
        c.box();
        p.on = c.onNode(); p.active = !p.on;
        // a zone like the shared ones: what it does is the element's `zones.heat`
        p.react = (c.E.zones && c.E.zones.heat) || {};
        p.force = p.react.force || null;
        p.mxz = 0.12; p.my = 0.02;
        L.zones.push(p); L.heats.push(p); break;
      }
      case 'sieve': {
        const b = c.box(); c.thin(b);
        p.solid = c.solid(p, 'box', b, { pass: 'passesSieve' });
        p.open = false;
        L.sieves.push(p); break;
      }
      default: { // wheel
        p.pos = c.vec3(def.pos, 'pos', c.pf);
        const W = CLAY.WHEEL;
        p.r = c.num(def.r, W.r); if (!(p.r >= 0.6 && p.r <= 4)) c.pf('r must be 0.6 to 4 m');
        p.h = c.num(def.h, W.h); if (!(p.h >= 0.1 && p.h <= 1.5)) c.pf('h must be 0.1 to 1.5 m');
        p.speed = c.num(def.speed, W.speed); if (!(p.speed > 0 && p.speed <= 12)) c.pf('speed (rim, m/s) must be in (0, 12]');
        p.spin = def.dir === 'cw' ? -1 : 1;
        if (def.dir !== undefined && def.dir !== 'cw' && def.dir !== 'ccw') c.pf('dir must be "cw" or "ccw" (seen from above)');
        p.on = c.onNode();
        p.w = 0; p.angle = 0; p.pangle = 0;
        const [x, y, z] = p.pos, r = p.r;
        const b = [x - r, y, z - r, x + r, y + p.h, z + r];
        p.box = b; c.grow(b);
        p.solid = c.solid(p, 'box', b);
        L.wheels.push(p);
      }
    }
  },

  finish(L, c) {
    // Stone's shell: one free box per level, out of the world until the first one is shed
    const sh = { type: 'shell', id: 'shell', index: -1, def: null, crate: true };
    c.makeCrate(sh, L.spawn.slice(), CLAY.SHELL.slice());
    sh.gone = true; sh.solid.active = false; sh.resets0 = 0; sh.sheds = 0;
    L.shell = sh;
  },

  settle(sim) {
    const p = sim.player, L = sim.level, S = sim.signals;
    p.grip = CLAY.GRIP_MAX; p.climb = null; p.climbCd = 0; p.pushT = 0;
    p.wheel = null; p.wheelV = [0, 0]; p.wet = false;
    for (const q of L.pistons) {
      if (q.on && S.read(q.on)) { q.t = q.pt = 1; q.target = 1; q.flung = true; const nb = headBox(q, 1), s = q.solid; [s.x0, s.y0, s.z0, s.x1, s.y1, s.z1] = nb; }
    }
    for (const w of L.wheels) w.w = (w.on ? S.read(w.on) : true) ? w.spin * w.speed / w.r : 0;
    // refusals used inside water: every form but the one the water made (built from the element's own list)
    L.wetRefuse = {};
    for (const f of sim.element.forms) { const r = {}; for (const g of sim.element.forms) if (g !== f) r[g] = CLAY.WET; L.wetRefuse[f] = { refuse: r }; }
  },

  actuators(sim, dt) {
    const L = sim.level, S = sim.signals, p = sim.player;
    // pistons
    for (const q of L.pistons) {
      q.pt = q.t;
      let target;
      if (q.on) target = S.read(q.on) ? 1 : 0;
      else {
        q.clock += dt;
        if (q.clock >= q.period) q.clock -= q.period;
        target = q.clock >= 0 && q.clock < q.stroke / q.out + q.hold ? 1 : 0;
      }
      if (target === 1 && q.target === 0) {
        q.flung = false;
        const b = headBox(q, q.t);
        sim.sfx('piston', 1, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      }
      q.target = target;
      const sp = target > q.t ? q.out : q.back;
      let nt = target > q.t ? Math.min(target, q.t + sp * dt / q.stroke) : Math.max(target, q.t - sp * dt / q.stroke);
      q.stall = false;
      if (nt > q.t && !pistonPush(sim, q, (nt - q.t) * q.stroke)) { nt = q.t; q.stall = true; }
      const s = q.solid, o = (nt - q.t) * q.stroke, d = q.d;
      const reachedTop = nt >= 1 && q.t < 1;
      q.t = nt;
      const nb = headBox(q, q.t);
      s.dx = d[0] * o; s.dy = d[1] * o; s.dz = d[2] * o;
      s.x0 = nb[0]; s.y0 = nb[1]; s.z0 = nb[2]; s.x1 = nb[3]; s.y1 = nb[4]; s.z1 = nb[5];
      // a stamp that pops up throws whoever stands on it when it reaches the top
      if (reachedTop && d[1] > 0 && !q.flung && p.grounded && p.ground === s && !sim.completed) {
        q.flung = true;
        const k = p.caps.pistonScale === undefined ? 1 : p.caps.pistonScale;
        sim.launch(0, q.fling * k, 0);
        sim.ev({ type: 'burst', kind: 'punch', x: p.x, y: p.y, z: p.z, dx: 0, dy: 1, dz: 0, piece: q.index });
      }
    }
    // wheels spin up and down
    for (const w of L.wheels) {
      w.pangle = w.angle;
      const on = w.on ? S.read(w.on) : true, target = on ? w.spin * w.speed / w.r : 0, rate = (w.speed / w.r) / CLAY.WHEEL.spinUp;
      if ((target !== 0) !== (w.w !== 0) && target !== 0) sim.sfx('wheel_spin', 0.8, w.pos[0], w.pos[1], w.pos[2]);
      w.w = w.w < target ? Math.min(target, w.w + rate * dt) : Math.max(target, w.w - rate * dt);
      w.angle += w.w * dt;
    }
    // sieves: open to a hero that arrives from above, a ceiling to one that comes up from below
    for (const q of L.sieves) {
      const s = q.solid;
      if (p.y >= s.y1 - 0.01) q.open = true;
      else if (p.y + p.h <= s.y0 + 0.01) q.open = false;
      s.pass = q.open ? 'passesSieve' : null;
    }
    // a shell or cast that fell out of the world crumbles (it is not put back where it came from)
    for (const c of [L.shell, ...L.casts]) {
      if (c && !c.gone && c.resets !== c.resets0) { c.resets0 = c.resets; crumble(sim, c, c === L.shell ? 'shellcrumble' : 'castcrumble'); }
    }
  },

  /** Climbing: while Dab holds on to a rough wall or ceiling, this hook moves it, and nothing else does. */
  control(sim, p, inp, dt) {
    const L = sim.level, F = p.caps;
    if (p.climbCd > 0) p.climbCd -= dt;
    if (!F.climbsRough) { if (p.climb) letGo(sim, p, 'form'); return false; }
    if (!p.climb) {
      if (p.grounded) p.grip = Math.min(CLAY.GRIP_MAX, p.grip + CLAY.GRIP_REFILL * dt);
      if (p.grip < CLAY.GRIP_MIN || p.climbCd > 0 || p.floating) { p.pushT = 0; return false; }
      let mx = +inp.mx || 0, mz = +inp.mz || 0;
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      // jumped into a rough ceiling: stick to it
      if (!p.grounded && p.headHit) {
        const s = ceilingAbove(L, p);
        if (s) { stick(sim, p, 'ceil', s, 0, 0); p.y = s.y0 - p.h; return true; }
      }
      const w = ml > 0.2 ? wallContact(L, p, CLAY.REACH) : null;
      const into = w ? (mx * w.nx + mz * w.nz) / ml : 0;
      if (w && p.grounded && into <= -0.6 && w.s.y1 > p.y + F.step + 0.05) {
        p.pushT += dt;
        if (p.pushT >= CLAY.GRAB_DELAY) { stick(sim, p, 'wall', w.s, w.nx, w.nz); return true; }
      } else p.pushT = 0;
      if (w && !p.grounded && into <= -0.3) { stick(sim, p, 'wall', w.s, w.nx, w.nz); return true; }
      return false;
    }

    // --- holding on. The world can still change Dab: then it lets go and the core takes over.
    const env = sim._queryEnv(p);
    let wetPool = false;
    for (const q of L.pools || []) if (q.wet && sim._bodyInBox(p, q.box, 0.06, 0.04)) { wetPool = true; break; }
    if (env.fire || env.water || wetPool || (env.force && env.force !== p.form) || env.reacts.some((r) => r.demote && r.demote[p.form])) { letGo(sim, p, 'world'); return false; }
    if (inp.form && inp.form !== p.form) { letGo(sim, p, 'form'); return false; }
    const jumpHeld = !!inp.jump, jumpPressed = jumpHeld && !p.jumpHeld;
    p.jumpHeld = jumpHeld;
    const c = p.climb;
    if (jumpPressed) {
      // push off: away and up from a wall; drop from a ceiling
      letGo(sim, p, 'jump');
      if (c.mode === 'wall') {
        p.vx = c.nx * CLAY.PUSH_OFF; p.vz = c.nz * CLAY.PUSH_OFF; p.vy = CLAY.PUSH_UP; p.jumping = true;
        p.facing = Math.atan2(c.nx, c.nz);
        sim.sfx('jump', 1);
        sim.ev({ type: 'burst', kind: 'jump', x: p.x, y: p.y, z: p.z });
      } else p.vy = -0.5;
      p.bufferT = 0; p.coyoteT = 0;
      return false;
    }
    p.grip -= dt;
    if (p.grip <= 0) {
      p.grip = 0;
      letGo(sim, p, 'grip');
      p.vy = c.mode === 'wall' ? -1 : -0.5;
      sim.sfx('squish', 0.7);
      return false;
    }
    let mx = +inp.mx || 0, mz = +inp.mz || 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const ox = p.x, oy = p.y, oz = p.z;
    p.px = ox; p.py = oy; p.pz = oz;
    p.bvx = 0; p.bvz = 0; p.grounded = false; p.ground = null; p.coyoteT = 0; p.bufferT = 0; p.floating = false;

    if (c.mode === 'ceil') {
      // hanging: the stick moves it about under the ceiling; pushing into a rough wall takes hold of that
      const w = ml > 0.2 ? wallContact(L, p, CLAY.REACH) : null;
      if (w && (mx * w.nx + mz * w.nz) / ml <= -0.6) { p.climb = { mode: 'wall', s: w.s, nx: w.nx, nz: w.nz }; return true; }
      if (ml > 0.01) p.facing = Math.atan2(mx, mz);
      moveBody(sim, p, mx * CLAY.HANG_SPEED * dt, 0, mz * CLAY.HANG_SPEED * dt, MOVE);
      const s = ceilingAbove(L, { x: p.x, z: p.z, y: oy, h: p.h }, 0.05);
      if (!s) { p.x = ox; p.z = oz; }                                    // the edge of the rough: stay on it
      else c.s = s;
      p.y = c.s.y0 - p.h;
      p.vx = (p.x - ox) / dt; p.vy = 0; p.vz = (p.z - oz) / dt;
      return true;
    }

    // on a wall: into it climbs up, away from it climbs down, sideways moves along
    const tx = -c.nz, tz = c.nx;
    const a = -(mx * c.nx + mz * c.nz), side = mx * tx + mz * tz;
    const vy = a > 0.05 ? a * CLAY.CLIMB_UP : a < -0.05 ? a * CLAY.CLIMB_DOWN : 0;
    const vs = Math.abs(side) > 0.05 ? side * CLAY.CLIMB_SIDE : 0;
    p.facing = Math.atan2(-c.nx, -c.nz);
    moveBody(sim, p, tx * vs * dt, vy * dt, tz * vs * dt, MOVE);
    // keep the body against the face it holds
    const s0 = c.s;
    if (c.nx) p.x = (c.nx > 0 ? s0.x1 : s0.x0) + c.nx * (p.r + 0.004); else p.z = (c.nz > 0 ? s0.z1 : s0.z0) + c.nz * (p.r + 0.004);
    if (p.landed) {
      // climbed down to the floor
      letGo(sim, p, 'floor'); p.climbCd = 0.15;
      p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
      return true;
    }
    if (p.headHit) {
      const s = ceilingAbove(L, p, 0.05);
      if (s) { p.climb = { mode: 'ceil', s, nx: 0, nz: 0 }; p.y = s.y0 - p.h; sim.sfx('climb_stick', 0.6); }
    }
    const same = (q) => q && q.nx === c.nx && q.nz === c.nz;
    let w = wallContact(L, p, CLAY.REACH + 0.01);
    if (!same(w)) w = null;
    // a rough block stacked on this one carries the climb on up (or down)
    if (w && w.s !== s0) c.s = w.s;
    const top = c.s.y1, mid = p.y + p.h * 0.5;
    if (vy > 0 && mid > top - 0.02) {
      // over the top: climb onto it if there is room; else hold on at the top (and can move along it)
      const x = p.x - c.nx * (p.r + CLAY.MANTLE_IN), z = p.z - c.nz * (p.r + CLAY.MANTLE_IN), y = top + 0.002;
      if (fitsAt(sim, p, x, y, z)) {
        p.x = x; p.y = y; p.z = z;
        p.vx = 0; p.vy = 0; p.vz = 0;
        letGo(sim, p, 'top'); p.climbCd = 0.2;
        sim.sfx('land', 0.35);
        sim.ev({ type: 'burst', kind: 'mantle', x, y, z });
        return true;
      }
      p.y = Math.min(p.y, top - p.h * 0.5 - 0.01);
      w = wallContact(L, p, CLAY.REACH + 0.01);
      if (!same(w)) w = null;
    }
    if (!w) {
      if (vy < 0 && mid < c.s.y0) { letGo(sim, p, 'bottom'); return false; }   // climbed off the bottom of the rough
      p.x = ox; p.z = oz;                                                // the end of the rough: stay on it
    }
    p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt; p.vz = (p.z - oz) / dt;
    return true;
  },

  hazards(sim, p, env, dt) {
    const L = sim.level, F = p.caps;
    // --- water soaks: a pool (the hazards pack turned Dab already) or running water (here)
    let wet = false;
    for (const q of L.pools || []) if (q.wet && sim._bodyInBox(p, q.box, 0.06, 0.04)) { wet = true; break; }
    if (env.water && F.soakTo) {
      wet = true;
      if (p.form !== F.soakTo && sim.fits(F.soakTo)) sim._changeForm(F.soakTo, 'water');
    }
    if (wet) {
      if (!p.wet) { sim.sfx('soak', 1); sim.ev({ type: 'burst', kind: 'soak', x: p.x, y: p.y, z: p.z }); }
      env.reacts.push(L.wetRefuse[p.form]);
    }
    p.wet = wet;
    // --- wind dries what it can, and holds a cloud together
    const windy = env.wx !== 0 || env.wy !== 0 || env.wz !== 0;
    if (windy && F.windForm && sim.fits(F.windForm)) {
      sim._changeForm(F.windForm, 'wind');
      p.gauge = sim.G.max;
      sim.ev({ type: 'burst', kind: 'dry', x: p.x, y: p.y, z: p.z });
    }
    if (windy && p.caps.windHold) env.hold = true;
    // --- a floating form that has been thrown (a piston's punch) slows down with its own drag
    if (F.move === 'float' && (p.ivx !== 0 || p.ivz !== 0)) {
      const k = Math.max(0, 1 - F.drag * dt);
      p.ivx *= k; p.ivz *= k;
      if (Math.abs(p.ivx) + Math.abs(p.ivz) < 0.02) { p.ivx = 0; p.ivz = 0; }
    }
    // --- potter's wheels: the round head turns whoever stands on it; leaving it throws them along the rim
    for (const w of L.wheels) {
      const cx = w.pos[0], cz = w.pos[2];
      const on = p.grounded && p.ground === w.solid && Math.hypot(p.x - cx, p.z - cz) <= w.r;
      if (on) {
        const th = w.w * dt;
        let dx = p.x - cx, dz = p.z - cz;
        const cs = Math.cos(th), sn = Math.sin(th);
        let nx = dx * cs + dz * sn, nz = -dx * sn + dz * cs;
        const slide = p.caps.wheelSlide || 0, dist = Math.hypot(nx, nz);
        if (slide > 0 && dist > 0.02 && w.w !== 0) { const out = Math.abs(w.w) * dist * slide * dt; nx += nx / dist * out; nz += nz / dist * out; }
        moveBody(sim, p, cx + nx - p.x, 0, cz + nz - p.z, { grounded: true, snap: false, stepGround: F.step || 0, stepAir: 0 });
        p.grounded = true; p.ground = w.solid;
        p.facing += th;
        dx = p.x - cx; dz = p.z - cz;
        const dd = Math.hypot(dx, dz), cap = dd > w.r ? w.r / dd : 1;    // never faster than the rim
        p.wheelV[0] = w.w * dz * cap; p.wheelV[1] = -w.w * dx * cap;
        p.wheel = w;
      } else if (p.wheel === w) {
        p.wheel = null;
        const k = p.caps.wheelFling || 0;
        if (k > 0 && Math.hypot(p.wheelV[0], p.wheelV[1]) > 0.3) {
          // in the air: thrown, and carried until it lands; onto the bench round the head: it staggers off with the speed
          if (!p.grounded) { p.ivx += p.wheelV[0] * k; p.ivz += p.wheelV[1] * k; }
          else { p.vx += p.wheelV[0] * k; p.vz += p.wheelV[1] * k; }
          sim.ev({ type: 'burst', kind: 'fling', x: p.x, y: p.y, z: p.z, vx: p.wheelV[0] * k, vz: p.wheelV[1] * k, piece: w.index });
        }
      }
    }
    return false;
  },

  triggers(sim, alive, dt) {
    const L = sim.level, S = sim.signals, p = sim.player, F = p.caps;
    for (const m of L.moulds) {
      m.pt = m.t;
      const b = m.box;
      const inside = alive && F.fillsMould === true && p.grounded && p.x > b[0] && p.x < b[3] && p.z > b[2] && p.z < b[5] && Math.abs(p.y - b[1]) < 0.15;
      const over = xzPen({ x0: b[0], z0: b[2], x1: b[3], z1: b[5] }, p, PEN) > 0 && p.y < b[4] && p.y + p.h > b[1];
      if (inside) {
        if (m.t === 0) sim.sfx('slip_pour', 0.7, (b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
        if (m.t < 1) {
          m.t = Math.min(1, m.t + dt / m.fill);
          if (m.t >= 1) { m.full = true; sim.ev({ type: 'burst', kind: 'mouldfull', x: (b[0] + b[3]) / 2, y: b[1], z: (b[2] + b[5]) / 2, piece: m.index }); }
        }
      } else if (m.full) {
        if (!alive || (over && F.fillsMould !== true)) { m.full = false; m.t = 0; }   // took the clay back (or was lost)
        else if (!over) castMould(sim, m);
      } else if (m.t > 0) m.t = Math.max(0, m.t - dt * 2);
      if (m.emit && !m.cast.gone) S.emit(m.emit);
    }
  },

  respawn(sim, cause) {
    const p = sim.player, L = sim.level;
    p.climb = null; p.climbCd = 0; p.pushT = 0; p.grip = CLAY.GRIP_MAX; p.wheel = null; p.wet = false;
    for (const m of L.moulds) { m.full = false; m.t = 0; m.pt = 0; }
    if (cause === 'restart') {
      // R puts the room back: the shell and every cast crumble, so nothing left in the wrong place can block the way
      if (L.shell) crumble(sim, L.shell, 'shellcrumble');
      for (const c of L.casts) crumble(sim, c, 'castcrumble');
    }
  },

  teleport(sim) { const p = sim.player; p.climb = null; p.pushT = 0; p.wheel = null; },

  fingerprint(sim, out) {
    const L = sim.level, p = sim.player;
    out.push(p.grip, p.climb ? p.climb.mode : '-');
    if (L.shell) out.push(L.shell.gone ? 1 : 0, L.shell.body.x, L.shell.body.y, L.shell.body.z);
    for (const m of L.moulds) out.push(m.t, m.casts, m.cast.gone ? 1 : 0);
    for (const q of L.pistons) out.push(q.t);
    for (const w of L.wheels) out.push(w.angle);
  },

  /** HUD gauges beyond the element's own: grip, while Dab holds on (or has just let go with it spent). */
  meters(sim, out) {
    const p = sim.player;
    if (p.grip === undefined) return;
    out.push({ id: 'grip', value: p.grip / CLAY.GRIP_MAX, active: !!p.climb, full: p.grip >= CLAY.GRIP_MAX - 1e-6 });
  },

  /**
   * Stone's special (called from the element's `specials.shed`): leave a shell block where Dab
   * stands and pop up onto it. False = refused (in the air, on a slope, no room for it or above it).
   */
  shed(sim, p) {
    const L = sim.level, sh = L.shell;
    if (!sh || !p.grounded || p.floating) return false;
    const [, h] = CLAY.SHELL, b = sh.body;
    // room for the shell where Dab stands (the old shell, being the same block, does not count)
    const ox = b.x, oy = b.y, oz = b.z, act = sh.solid.active;
    b.x = p.x; b.y = p.y + 0.001; b.z = p.z;
    sh.solid.active = false;
    const free = boxFree(sim, b);
    b.x = ox; b.y = oy; b.z = oz; sh.solid.active = act;
    if (!free) return false;
    // and room for Dab on top of it
    if (!fitsAt(sim, p, p.x, p.y + h + 0.002, p.z)) return false;
    if (!sh.gone) crumble(sim, sh, 'shellcrumble');
    place(sim, sh, p.x, p.y, p.z);
    sh.sheds++;
    p.y += h + 0.002; p.vy = 0;
    p.grounded = true; p.ground = sh.solid;
    sim.sfx('shell_shed', 1);
    sim.ev({ type: 'burst', kind: 'shell', x: p.x, y: p.y - h, z: p.z, w: CLAY.SHELL[0], h, d: CLAY.SHELL[2] });
    return true;
  },
};

export default pack;
