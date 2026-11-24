// Pack: FIRE MECHANISMS - wood, fuse, lantern, brazier, iceblock, wax, terminal, wire, gas,
// weakwall, heatsensor, coal (LEVELS.md section 10; the pack interface is in ELEMENTS.md).
//
// Nothing here asks which form or element the hero is. Every reaction is decided by a capability
// flag of the current form (`p.caps`):
//   ignites     lights lanterns, braziers and fuses by touch
//   burns       sets wood alight by touch (and is paid `fuel` gauge for it)
//   melts       melts ice blocks and wax by touch
//   tripsHeat   trips heat sensors
//   sparksGas   sets off gas pockets by touch
//   ridesWires  is carried along a wire from a terminal to the terminal at its other end
//   powers      makes a terminal emit while it sits on it
//   blastScale  how hard a gas blast throws it (1 when absent)
// so another element's form can reuse any of these pieces by setting the flag.

export const FIRE = {
  BURN: { block: 1.6, plank: 1.0, crate: 1.2, rope: 0.6 },   // default seconds for wood to burn away, by kind
  FUEL: { block: 1.5, plank: 1.5, crate: 1.5, rope: 0.5 },   // default gauge paid to the hero for lighting it
  SPREAD_AT: 0.5,          // fraction burnt at which fire jumps to touching wood
  SPREAD_GAP: 0.08,        // wood this close (m) counts as touching
  FUSE_RATE: 1.6,          // default m/s a fuse burns
  FUSE_REACH: 0.55,        // hero's body surface within this of the fuse's first point lights it
  LANTERN_R: 1.0,          // default reach of a lantern (hero's centre to the flame), m
  BRAZIER_R: 1.2,          // default reach of a brazier, m
  BRAZIER_RATE: 30,        // gauge per second gained near a lit brazier (full in a third of a second)
  ICE_MELT: 1.5,           // default seconds of touch to melt an ice block
  WAX_MELT: 2.5,           // default seconds of touch to sag a wax block all the way
  WAX_MIN: 0.12,           // default height (m) of the puddle a wax block sags to
  TOUCH: 0.14,             // "touching" a block: body surface within this of it, m
  WIRE_SPEED: 14,          // default m/s along a wire
  TERMINAL_R: 0.6,         // hero's body surface within this of a terminal post (horizontally); was 0.4: a key tap of a spark is 0.76 m
  GAS_LAUNCH: [0, 13, 0],  // default launch velocity of a gas pocket, m/s
  GAS_RADIUS: 2.5,         // default reach of a blast (to weak walls, panes, other pockets), m
  GAS_REFILL: 5,           // default seconds for a pocket to fill again
  GAS_CHAIN: 0.12,         // seconds before a pocket caught in a blast goes off itself
  COAL_HEAT: 4,            // default gauge in a lump of coal
  COAL_R: 0.8,             // pick-up radius (hero's centre to the coal), m
};

const OUT = [0, 0, 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Is the hero's body within `reach` of the box x0..z1? */
function touches(p, x0, y0, z0, x1, y1, z1, reach) {
  const dx = p.x - clamp(p.x, x0, x1), dz = p.z - clamp(p.z, z0, z1), rr = p.r + reach;
  return dx * dx + dz * dz < rr * rr && p.y + p.h + reach > y0 && p.y - reach < y1;
}
const touchesSolid = (p, s, reach) => s.active && touches(p, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, reach);

/** Distance from point q to segment a-b. */
function segDist(qx, qy, qz, a, b) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], l2 = ux * ux + uy * uy + uz * uz;
  const t = l2 > 0 ? clamp(((qx - a[0]) * ux + (qy - a[1]) * uy + (qz - a[2]) * uz) / l2, 0, 1) : 0;
  return Math.hypot(qx - a[0] - ux * t, qy - a[1] - uy * t, qz - a[2] - uz * t);
}

/** Gap between two boxes [x0,y0,z0,x1,y1,z1] (0 when they touch or overlap). */
function boxGap(a, b) {
  const dx = Math.max(0, a[0] - b[3], b[0] - a[3]), dy = Math.max(0, a[1] - b[4], b[1] - a[4]), dz = Math.max(0, a[2] - b[5], b[2] - a[5]);
  return Math.hypot(dx, dy, dz);
}

/** Current extents of a wood piece (a crate moves; a rope is its bounding box). */
function woodBox(w) {
  if (w.kind === 'rope') return w.bounds;
  const s = w.solid;
  return [s.x0, s.y0, s.z0, s.x1, s.y1, s.z1];
}

/** Lengths of a polyline's segments and its total length. */
function measure(pts) {
  const seg = []; let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); seg.push(l); len += l; }
  return { seg, len };
}

/** Point `d` metres along a polyline { pts, seg, len } (clamped to its ends). Writes [x,y,z] to out. */
export function pointAlong(line, d, out = OUT) {
  const { pts, seg } = line;
  let rest = clamp(d, 0, line.len);
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? Math.min(1, rest / seg[i]) : 0, a = pts[i], b = pts[i + 1];
      out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
      return out;
    }
    rest -= seg[i];
  }
  return out;
}

function points(v, name, c, min = 2) {
  if (!Array.isArray(v) || v.length < min) c.pf(`"${name}" must be a list of at least ${min} points [x, y, z]`);
  return v.map((q, i) => c.vec3(q, `${name}[${i}]`, c.pf));
}

function igniteWood(sim, w, byHero) {
  if (w.state !== 0) return;
  w.state = 1; w.t = 0; w.pt = 0;
  const b = woodBox(w), x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2, z = (b[2] + b[5]) / 2;
  sim.sfx('wood_burn', 1, x, y, z);
  sim.ev({ type: 'burst', kind: 'woodlight', x, y, z, piece: w.index });
  if (byHero && w.fuel > 0) { sim.addGauge(w.fuel); sim.ev({ type: 'fuel', amount: w.fuel, x, y, z }); }
}

function blast(sim, g) {
  if (!g.full) return;
  const L = sim.level, p = sim.player, b = g.box;
  g.full = false; g.t = g.refill; g.chainT = 0; g.blasts++;
  const x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2, z = (b[2] + b[5]) / 2;
  sim.sfx('gas_blast', 1, x, y, z);
  sim.ev({ type: 'burst', kind: 'blast', x, y, z, radius: g.radius, piece: g.index });
  for (const w of L.weakwalls) {
    if (w.broken || boxGap(b, w.box) > g.radius) continue;
    w.broken = true; w.solid.active = false;
    const wb = w.box;
    sim.sfx('pane_smash', 0.8, (wb[0] + wb[3]) / 2, (wb[1] + wb[4]) / 2, (wb[2] + wb[5]) / 2);
    sim.ev({ type: 'burst', kind: 'weakwall', x: (wb[0] + wb[3]) / 2, y: (wb[1] + wb[4]) / 2, z: (wb[2] + wb[5]) / 2, piece: w.index });
  }
  for (const pn of L.panes) if (!pn.broken && boxGap(b, pn.box) <= g.radius) sim._breakPane(pn);
  for (const q of L.gases) if (q !== g && q.full && q.chainT <= 0 && boxGap(b, q.box) <= g.radius) q.chainT = FIRE.GAS_CHAIN;
  // whoever is in the pocket is thrown
  if (!sim.completed && p.respawnT <= 0 && !p.ride && sim._bodyInBox(p, b, -0.25, -0.25)) {
    const k = p.caps.blastScale === undefined ? 1 : p.caps.blastScale, l = g.launch;
    sim.launch(l[0] * k, l[1] * k, l[2] * k);
    sim.ev({ type: 'burst', kind: 'launch', x: p.x, y: p.y, z: p.z });
  }
}

export default {
  name: 'fire',
  types: ['wood', 'fuse', 'lantern', 'brazier', 'iceblock', 'wax', 'terminal', 'wire', 'gas', 'weakwall', 'heatsensor', 'coal'],

  init(L) {
    L.woods = []; L.fuses = []; L.lanterns = []; L.braziers = []; L.iceblocks = []; L.waxes = [];
    L.terminals = []; L.wires = []; L.gases = []; L.weakwalls = []; L.heatsensors = []; L.coals = [];
  },

  build(type, def, p, c) {
    const L = c.L;
    switch (type) {
      case 'wood': {
        p.kind = def.kind || 'block';
        if (!['block', 'plank', 'crate', 'rope'].includes(p.kind)) c.pf('wood kind must be block, plank, crate or rope');
        if (p.kind === 'crate') {
          const pos = c.vec3(def.pos, 'pos', c.pf);
          let sz = def.size === undefined ? [1, 1, 1] : def.size;
          if (typeof sz === 'number') sz = [sz, sz, sz];
          sz = c.vec3(sz, 'size', c.pf);
          if (sz[0] < 0.4 || sz[1] < 0.4 || sz[2] < 0.4) c.pf('crate size must be at least 0.4 on every axis');
          c.makeCrate(p, pos, sz);
        } else if (p.kind === 'rope') {
          p.a = c.vec3(def.from, 'from', c.pf); p.b = c.vec3(def.to, 'to', c.pf);
          if (Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]) < 0.2) c.pf('a rope needs "from" and "to" at least 0.2 m apart');
          p.bounds = [Math.min(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.min(p.a[2], p.b[2]), Math.max(p.a[0], p.b[0]), Math.max(p.a[1], p.b[1]), Math.max(p.a[2], p.b[2])];
          c.grow(p.bounds);
        } else {
          const b = c.box(); c.thin(b);
          p.solid = c.solid(p, 'box', b);
        }
        p.burn = c.num(def.burn, FIRE.BURN[p.kind]); if (!(p.burn > 0)) c.pf('burn must be > 0 (seconds to burn away)');
        p.fuel = c.num(def.fuel, FIRE.FUEL[p.kind]); if (p.fuel < 0) c.pf('fuel must be >= 0');
        p.spread = def.spread !== false;
        p.on = c.onNode(); p.emit = c.emit(false);
        p.state = 0; p.t = 0; p.pt = 0; p.spreadDone = false;   // state: 0 sound, 1 burning, 2 gone
        L.woods.push(p); break;
      }
      case 'fuse': {
        p.pts = points(def.path, 'path', c);
        Object.assign(p, measure(p.pts));
        if (!(p.len > 0.2)) c.pf('a fuse must be longer than 0.2 m');
        for (const q of p.pts) c.grow([q[0], q[1], q[2], q[0], q[1], q[2]]);
        p.rate = c.num(def.rate, FIRE.FUSE_RATE); if (!(p.rate > 0)) c.pf('rate must be > 0 (m/s)');
        p.regrow = c.num(def.regrow, 0); if (p.regrow < 0) c.pf('regrow must be >= 0 (seconds; 0 = burns once)');
        p.on = c.onNode(); p.emit = c.emit(true);
        p.state = 0; p.d = 0; p.pd = 0; p.spentT = 0; p.sfxT = 0;   // state: 0 ready, 1 burning, 2 spent (emitting)
        L.fuses.push(p); break;
      }
      case 'lantern': {
        p.pos = c.vec3(def.pos, 'pos', c.pf);
        p.r = c.num(def.r, FIRE.LANTERN_R); if (!(p.r > 0)) c.pf('r must be > 0');
        p.mount = def.mount || 'post';
        if (!['post', 'hang', 'wall'].includes(p.mount)) c.pf('mount must be post, hang or wall');
        p.lit = def.lit === true; p.emit = c.emit(false);
        c.grow([p.pos[0], p.pos[1], p.pos[2], p.pos[0], p.pos[1], p.pos[2]]);
        L.lanterns.push(p); break;
      }
      case 'brazier': {
        p.pos = c.vec3(def.pos, 'pos', c.pf);
        p.r = c.num(def.r, FIRE.BRAZIER_R); if (!(p.r > 0)) c.pf('r must be > 0');
        p.lit = def.lit === true; p.current = false; p.emit = c.emit(false);
        p.fullGauge = true;            // a respawn here comes back with a full gauge
        c.grow([p.pos[0], p.pos[1], p.pos[2], p.pos[0], p.pos[1], p.pos[2]]);
        L.braziers.push(p); break;
      }
      case 'iceblock': case 'wax': {
        const b = c.box(); c.thin(b);
        p.solid = c.solid(p, 'box', b);
        p.melt = c.num(def.melt, type === 'wax' ? FIRE.WAX_MELT : FIRE.ICE_MELT); if (!(p.melt > 0)) c.pf('melt must be > 0 (seconds of touch)');
        p.t = 0; p.pt = 0; p.heat = false; p.heating = false; p.cool = 0; p.emit = c.emit(false);
        if (type === 'wax') {
          p.min = c.num(def.min, FIRE.WAX_MIN);
          if (!(p.min >= c.minSolid) || !(p.min < b[4] - b[1])) c.pf(`min must be at least ${c.minSolid} and less than the block's height`);
          L.waxes.push(p);
        } else { p.gone = false; L.iceblocks.push(p); }
        break;
      }
      case 'terminal': {
        p.pos = c.vec3(def.pos, 'pos', c.pf);
        if (typeof def.id !== 'string' || !def.id) c.pf('a terminal needs an "id" (wires name it)');
        if (L.terminals.some((t) => t.id === def.id)) c.pf(`terminal id "${def.id}" is used twice`);
        p.emit = c.emit(false); p.live = false; p.wire = null;
        c.grow([p.pos[0], p.pos[1], p.pos[2], p.pos[0], p.pos[1], p.pos[2]]);
        L.terminals.push(p); break;
      }
      case 'wire': {
        if (typeof def.from !== 'string' || typeof def.to !== 'string' || def.from === def.to) c.pf('a wire needs "from" and "to": the ids of two different terminals');
        p.fromId = def.from; p.toId = def.to;
        p.via = def.via === undefined ? [] : points(def.via, 'via', c, 1);
        p.speed = c.num(def.speed, FIRE.WIRE_SPEED); if (!(p.speed > 0 && p.speed <= 30)) c.pf('speed must be in (0, 30] m/s');
        p.on = c.onNode(); p.active = !p.on; p.where = c.where;
        L.wires.push(p); break;
      }
      case 'gas': {
        c.box();
        p.launch = def.launch === undefined ? FIRE.GAS_LAUNCH.slice() : c.vec3(def.launch, 'launch', c.pf);
        p.radius = c.num(def.radius, FIRE.GAS_RADIUS); if (!(p.radius >= 0)) c.pf('radius must be >= 0');
        p.refill = c.num(def.refill, FIRE.GAS_REFILL); if (p.refill < 0) c.pf('refill must be >= 0 (seconds; 0 = one blast only)');
        p.on = c.onNode(); p.prevOn = false;
        p.full = true; p.t = 0; p.chainT = 0; p.blasts = 0;
        L.gases.push(p); break;
      }
      case 'weakwall': {
        const b = c.box(); c.thin(b);
        p.solid = c.solid(p, 'box', b);
        p.broken = false; p.emit = c.emit(false);
        L.weakwalls.push(p); break;
      }
      case 'heatsensor': {
        c.box(); p.emit = c.emit(true); p.live = false;
        L.heatsensors.push(p); break;
      }
      default: { // coal
        p.pos = c.vec3(def.pos, 'pos', c.pf);
        p.heat = c.num(def.heat, FIRE.COAL_HEAT); if (!(p.heat > 0)) c.pf('heat must be > 0');
        p.taken = false;
        L.coals.push(p);
      }
    }
  },

  finish(L, c) {
    for (const w of L.wires) {
      const A = L.terminals.find((t) => t.id === w.fromId), B = L.terminals.find((t) => t.id === w.toId);
      if (!A || !B) c.fail(`${w.where}: no terminal with id "${!A ? w.fromId : w.toId}"`);
      for (const T of [A, B]) {
        if (T.wire) c.fail(`${w.where}: terminal "${T.id}" already has a wire (one wire per terminal; use "via" for a longer run)`);
        T.wire = w;
      }
      w.from = A; w.to = B;
      // the wire leaves each post 0.3 m above its foot
      w.pts = [[A.pos[0], A.pos[1] + 0.3, A.pos[2]], ...w.via, [B.pos[0], B.pos[1] + 0.3, B.pos[2]]];
      Object.assign(w, measure(w.pts));
      for (const q of w.pts) c.grow([q[0], q[1], q[2], q[0], q[1], q[2]]);
    }
  },

  settle(sim) {
    const p = sim.player, L = sim.level, S = sim.signals;
    p.ride = null;                     // { w: wire, dir: 1 | -1, d: metres travelled } while on a wire
    p.rideExit = null;                 // the terminal just arrived at: no return trip until the hero steps off it
    for (const w of L.wires) w.active = w.on ? S.read(w.on) : true;
    for (const g of L.gases) g.prevOn = g.on ? S.read(g.on) : false;
  },

  actuators(sim, dt) {
    const L = sim.level, S = sim.signals;
    for (const w of L.woods) {
      w.pt = w.t;
      if (w.state === 0) { if (w.on && S.read(w.on)) igniteWood(sim, w, false); continue; }
      if (w.state !== 1) continue;
      w.t += dt / w.burn;
      if (w.spread && !w.spreadDone && w.t >= FIRE.SPREAD_AT) {
        w.spreadDone = true;
        const b = woodBox(w);
        for (const o of L.woods) if (o.state === 0 && o.spread && boxGap(b, woodBox(o)) <= FIRE.SPREAD_GAP) igniteWood(sim, o, false);
      }
      if (w.t >= 1) {
        w.t = 1; w.state = 2;
        const b = woodBox(w), x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2, z = (b[2] + b[5]) / 2;
        if (w.solid) w.solid.active = false;
        if (w.kind === 'crate') { w.gone = true; w.grounded = false; }
        sim.sfx('land', 0.5, x, y, z);
        sim.ev({ type: 'burst', kind: 'woodgone', x, y, z, piece: w.index, box: b });
      }
    }
    for (const f of L.fuses) {
      f.pd = f.d;
      if (f.state === 0) {
        if (f.on && S.read(f.on)) { f.state = 1; f.d = 0; f.pd = 0; f.sfxT = 0; sim.sfx('fuse_burn', 1, f.pts[0][0], f.pts[0][1], f.pts[0][2]); }
      } else if (f.state === 1) {
        f.d += f.rate * dt;
        f.sfxT += dt;
        if (f.sfxT >= 0.9) { f.sfxT = 0; pointAlong(f, f.d); sim.sfx('fuse_burn', 0.6, OUT[0], OUT[1], OUT[2]); }
        if (f.d >= f.len) {
          f.d = f.len; f.state = 2; f.spentT = 0;
          const e = f.pts[f.pts.length - 1];
          sim.ev({ type: 'burst', kind: 'fuseend', x: e[0], y: e[1], z: e[2], piece: f.index });
        }
      } else if (f.regrow > 0) {
        f.spentT += dt;
        if (f.spentT >= f.regrow) { f.state = 0; f.d = 0; f.pd = 0; }
      }
    }
    for (const q of L.iceblocks) {
      q.pt = q.t; q.heating = q.heat;
      if (q.gone || !q.heat) continue;
      q.heat = false;
      if (q.t === 0) { const b = q.box; sim.sfx('ice_melt', 1, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2); }
      q.t = Math.min(1, q.t + dt / q.melt);
      if (q.t >= 1) {
        q.gone = true; q.solid.active = false;
        const b = q.box;
        sim.ev({ type: 'burst', kind: 'icegone', x: (b[0] + b[3]) / 2, y: b[1], z: (b[2] + b[5]) / 2, piece: q.index });
      }
    }
    for (const q of L.waxes) {
      q.pt = q.t; q.heating = q.heat;
      const s = q.solid;
      s.dy = 0;
      if (!q.heat || q.t >= 1) continue;
      q.heat = false;
      const b = q.box;
      if (q.t === 0 || q.cool > 0.6) sim.sfx('wax_melt', 1, (b[0] + b[3]) / 2, s.y1, (b[2] + b[5]) / 2);
      q.cool = 0;
      q.t = Math.min(1, q.t + dt / q.melt);
      const top = b[1] + q.min + (b[4] - b[1] - q.min) * (1 - q.t);
      s.dy = top - s.y1; s.y1 = top;            // whatever stands on it is carried down
      if (q.t >= 1) sim.ev({ type: 'burst', kind: 'waxdone', x: (b[0] + b[3]) / 2, y: top, z: (b[2] + b[5]) / 2, piece: q.index });
    }
    for (const q of L.waxes) if (!q.heating) q.cool += dt;
    for (const w of L.wires) w.active = w.on ? S.read(w.on) : true;
    for (const g of L.gases) {
      if (!g.full) { if (g.refill > 0 && (g.t -= dt) <= 0) g.full = true; }
      const on = g.on ? S.read(g.on) : false;
      if (g.full && on && !g.prevOn) blast(sim, g);
      else if (g.full && g.chainT > 0 && (g.chainT -= dt) <= 0) blast(sim, g);
      g.prevOn = on;
    }
  },

  /** The hero is on a wire: carry it along and keep everything else off it this tick. */
  control(sim, p, inp, dt) {
    const r = p.ride;
    if (!r) return false;
    const w = r.w;
    r.d += w.speed * dt;
    const done = r.d >= w.len;
    pointAlong(w, r.dir > 0 ? r.d : w.len - r.d);
    p.x = OUT[0]; p.y = OUT[1] - p.h / 2; p.z = OUT[2];
    p.vx = (p.x - p.px) / dt; p.vy = (p.y - p.py) / dt; p.vz = (p.z - p.pz) / dt;
    if (Math.abs(p.vx) + Math.abs(p.vz) > 0.5) p.facing = Math.atan2(p.vx, p.vz);
    p.bvx = 0; p.bvz = 0; p.grounded = false; p.ground = null; p.floating = false; p.jumping = false;
    p.jumpHeld = !!inp.jump; p.bufferT = 0; p.coyoteT = 0; p.pendForm = null;
    if (done) {
      const T = r.dir > 0 ? w.to : w.from;
      p.x = T.pos[0]; p.y = T.pos[1] + 0.02; p.z = T.pos[2];
      p.vx = 0; p.vy = 0; p.vz = 0;
      p.ride = null; p.rideExit = T;
      sim.sfx('spark', 0.7, p.x, p.y, p.z);
      sim.ev({ type: 'burst', kind: 'wireend', x: p.x, y: p.y + 0.3, z: p.z });
    }
    return true;
  },

  triggers(sim, alive, dt) {
    const L = sim.level, S = sim.signals, p = sim.player, F = p.caps;
    const live = alive && !p.ride;
    const cx = p.x, cy = p.y + p.h / 2, cz = p.z;

    for (const w of L.woods) {
      if (w.state === 0 && live && F.burns === true) {
        const hit = w.kind === 'rope'
          ? segDist(cx, cy, cz, w.a, w.b) < Math.max(p.r, p.h / 2) + 0.25
          : touchesSolid(p, w.solid, FIRE.TOUCH);
        if (hit) igniteWood(sim, w, true);
      }
      if (w.state === 2 && w.emit) S.emit(w.emit);
    }
    for (const f of L.fuses) {
      if (f.state === 0 && live && F.ignites === true) {
        const a = f.pts[0];
        if (Math.hypot(cx - a[0], cy - a[1], cz - a[2]) < Math.max(p.r, p.h / 2) + FIRE.FUSE_REACH) {
          f.state = 1; f.d = 0; f.pd = 0; f.sfxT = 0;
          sim.sfx('ignite', 0.8, a[0], a[1], a[2]); sim.sfx('fuse_burn', 1, a[0], a[1], a[2]);
          sim.ev({ type: 'burst', kind: 'ignite', x: a[0], y: a[1], z: a[2], piece: f.index });
        }
      }
      if (f.state === 2) S.emit(f.emit);
    }
    for (const q of L.lanterns) {
      if (!q.lit && live && F.ignites === true && Math.hypot(cx - q.pos[0], cy - q.pos[1], cz - q.pos[2]) < q.r) {
        q.lit = true;
        sim.sfx('ignite', 1, q.pos[0], q.pos[1], q.pos[2]);
        sim.ev({ type: 'burst', kind: 'ignite', x: q.pos[0], y: q.pos[1], z: q.pos[2], piece: q.index });
      }
      if (q.lit && q.emit) S.emit(q.emit);
    }
    for (const q of L.braziers) {
      const near = live && Math.hypot(p.x - q.pos[0], p.z - q.pos[2]) < q.r && p.y - q.pos[1] > -0.5 && p.y - q.pos[1] < 1.5;
      if (near && !q.lit && F.ignites === true) {
        q.lit = true;
        sim.sfx('ignite', 1, q.pos[0], q.pos[1], q.pos[2]);
        sim.ev({ type: 'burst', kind: 'ignite', x: q.pos[0], y: q.pos[1] + 0.7, z: q.pos[2], piece: q.index });
      }
      if (near && q.lit) {
        if (sim.checkpoint !== q) {
          if (sim.checkpoint) sim.checkpoint.current = false;
          sim.checkpoint = q; q.current = true;
          sim.sfx('checkpoint', 1, q.pos[0], q.pos[1], q.pos[2]);
          sim.ev({ type: 'checkpoint', index: q.index, x: q.pos[0], y: q.pos[1], z: q.pos[2] });
        }
        if (p.gauge < sim.G.max) sim.addGauge(FIRE.BRAZIER_RATE * dt);
      }
      if (q.lit && q.emit) S.emit(q.emit);
    }
    for (const q of L.iceblocks) {
      if (!q.gone && live && F.melts === true && touchesSolid(p, q.solid, FIRE.TOUCH)) q.heat = true;
      if (q.gone && q.emit) S.emit(q.emit);
    }
    for (const q of L.waxes) {
      if (q.t < 1 && live && F.melts === true && touchesSolid(p, q.solid, FIRE.TOUCH)) q.heat = true;
      if (q.t >= 1 && q.emit) S.emit(q.emit);
    }
    if (p.rideExit && (!live || Math.hypot(p.x - p.rideExit.pos[0], p.z - p.rideExit.pos[2]) > 0.9)) p.rideExit = null;
    for (const T of L.terminals) {
      const on = live && Math.hypot(p.x - T.pos[0], p.z - T.pos[2]) < p.r + FIRE.TERMINAL_R && Math.abs(p.y - T.pos[1]) < 0.6;
      const w = T.wire;
      if (on && w && w.active && F.ridesWires === true && T !== p.rideExit) {
        p.ride = { w, dir: T === w.from ? 1 : -1, d: 0 };
        p.rideExit = null;
        sim.sfx('wire_ride', 1, T.pos[0], T.pos[1], T.pos[2]);
        sim.ev({ type: 'burst', kind: 'wirestart', x: T.pos[0], y: T.pos[1] + 0.3, z: T.pos[2] });
        T.live = false;
        continue;
      }
      const lv = on && !p.ride && F.powers === true && p.grounded;
      if (lv && !T.live) sim.sfx('spark', 1, T.pos[0], T.pos[1], T.pos[2]);
      T.live = lv;
      if (lv && T.emit) S.emit(T.emit);
    }
    for (const g of L.gases) {
      if (g.full && live && F.sparksGas === true && sim._bodyInBox(p, g.box, 0.05, 0.02)) blast(sim, g);
    }
    for (const w of L.weakwalls) if (w.broken && w.emit) S.emit(w.emit);
    for (const h of L.heatsensors) {
      let lv = live && F.tripsHeat === true && sim._bodyInBox(p, h.box, 0.05, 0.02);
      if (!lv) for (const w of L.woods) if (w.state === 1 && boxGap(h.box, woodBox(w)) === 0) { lv = true; break; }
      h.live = lv;
      if (lv) S.emit(h.emit);
    }
    if (!live) return;
    for (const q of L.coals) {
      if (q.taken || p.gauge >= sim.G.max || Math.hypot(cx - q.pos[0], cy - q.pos[1], cz - q.pos[2]) >= FIRE.COAL_R) continue;
      q.taken = true;
      sim.addGauge(q.heat);
      sim.sfx('coal', 1, q.pos[0], q.pos[1], q.pos[2]);
      sim.ev({ type: 'burst', kind: 'coal', x: q.pos[0], y: q.pos[1], z: q.pos[2], piece: q.index });
      sim.ev({ type: 'fuel', amount: q.heat, x: q.pos[0], y: q.pos[1], z: q.pos[2] });
    }
  },

  respawn(sim) {
    const p = sim.player;
    p.ride = null; p.rideExit = null;
    for (const q of sim.level.coals) q.taken = false;      // fuel comes back, so a wasted gauge is never a dead end
  },

  teleport(sim) { sim.player.ride = null; sim.player.rideExit = null; },

  fingerprint(sim, out) {
    const L = sim.level;
    for (const w of L.woods) out.push(w.state, w.t);
    for (const f of L.fuses) out.push(f.state, f.d);
    for (const q of L.lanterns) out.push(q.lit ? 1 : 0);
    for (const q of L.braziers) out.push(q.lit ? 1 : 0);
    for (const q of L.iceblocks) out.push(q.t);
    for (const q of L.waxes) out.push(q.t);
    for (const g of L.gases) out.push(g.full ? 1 : 0);
    for (const w of L.weakwalls) out.push(w.broken ? 1 : 0);
    for (const q of L.coals) out.push(q.taken ? 1 : 0);
  },
};
