// DEWPOINT simulation core. Deterministic, DOM-free, three-free: runs identically in Node.
//
//   const sim = new Sim(levelData);
//   sim.step({ mx, mz, jump, form, restart });   // advances exactly DT (1/120 s)
//   sim.drainEvents();                            // sfx / form / respawn / complete / hint ...
//
// Input: mx,mz = WORLD-space move vector (length <= 1), jump = held boolean,
// form = a form name of the level's element, or null (a request for this tick; asking for the form
// the hero is already in triggers that form's special, if it has one), restart = held boolean.
//
// The hero's ELEMENT is data (src/sim/elements/, ELEMENTS.md). This file never names a form or an
// element: it reads the current form's movement model (`move`: walk / slide / float) and its
// capability flags (pressesLight, passesGrate, floats, douses ...), the element's gauge, and how
// the element reacts to zones. Element-only mechanisms live in "packs" that hook into each phase
// of the tick (src/sim/packs/).

import {
  DT, GRAVITY, TERMINAL, EPS, COYOTE_TIME, JUMP_BUFFER, FORM_COOLDOWN, FORM_BUFFER, RESPAWN_FREEZE,
  CRATE_PUSH_SPEED, WATER_SPEED_FACTOR, SPROUT_GROW_TIME,
} from './constants.js';
import { Signals } from './signals.js';
import { buildLevel } from './level.js';
import {
  moveBody, topAt, rampU, rampSlope, rampDir, overlapsAny, resolveEmbedded, penetration,
  raycast, xzPen, blocks, PASS, BLOCK,
} from './collide.js';

const NO_INPUT = Object.freeze({ mx: 0, mz: 0, jump: false, form: null, restart: false });
const PEN = { nx: 0, nz: 0 };
const DIR = { x: 0, z: 0 };

function approach(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}

export class Sim {
  constructor(levelData) {
    this.signals = new Signals(levelData && typeof levelData === 'object' ? levelData.signals : undefined);
    this.level = buildLevel(levelData, this.signals);
    this.solids = this.level.solids;
    const E = this.level.element;
    this.element = E;                 // element definition (data)
    this.F = E.formDefs;              // form name -> movement parameters + capability flags
    this.G = E.gauge;                 // { max, start, refill }
    this.packs = E.packs;             // element-only mechanisms hooked into the tick
    this.feed = E.kilnFire && E.kilnFire !== 'kill' ? E.kilnFire.feed || 0 : -1;   // gauge per second gained in a `fire` piece; -1 = it kills
    this.time = 0;
    this.tick = 0;
    this.events = [];
    this.completed = false;
    this.completeT = 0;
    this.deaths = 0;
    this.shardsTaken = [];
    this.checkpoint = null;
    this.prevRestart = false;
    this.lastPushSfx = -1;
    this.env = { force: null, fill: false, hold: false, reacts: [], wx: 0, wy: 0, wz: 0, water: null, fire: false, inWaterZone: null };
    const sp = this.level.spawn;
    const F = this.F[E.defaultForm];
    const p = {
      shape: 'cyl', form: E.defaultForm, caps: F, r: F.r, h: F.h,
      x: sp[0], y: sp[1], z: sp[2], px: sp[0], py: sp[1], pz: sp[2],
      vx: 0, vy: 0, vz: 0, bvx: 0, bvz: 0,
      grounded: false, ground: null, floating: false, inWater: false,
      gauge: this.level.startGauge, coyoteT: 0, bufferT: 0, jumpHeld: false, jumping: false,
      ivx: 0, ivz: 0,                 // launch impulse (a blast): constant in the air, gone on landing or at a wall
      airSpecial: false,              // a once-per-airtime special has been used since the last landing
      formCd: 0, respawnT: 0, crushT: 0, facing: 0,
      landed: false, headHit: false, wallHit: 0, wallNx: 0, wallNz: 0, stepped: false,
      pushing: false, formT: 0, warp: 0, pendForm: null, pendT: 0,
    };
    p.owner = p;
    // start out facing the way the level's camera looks (camYaw 0 looks toward -z)
    p.facing = Math.atan2(-Math.sin(this.level.camYaw * Math.PI / 180), -Math.cos(this.level.camYaw * Math.PI / 180));
    this.player = p;
    this._probe = { shape: 'cyl', owner: p, form: E.defaultForm, caps: F, r: F.r, h: F.h, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    // Collision hooks (bound once)
    this.onHitH = this._onHitH.bind(this);
    this.onLand = this._onLand.bind(this);
    this._settle();
  }

  /** Put every actuator in the state its signal has at t = 0 (e.g. a door on '!plate' starts open), silently. */
  _settle() {
    const L = this.level, S = this.signals;
    S.evaluate(0);
    for (const m of L.movers) {
      if (m.mode === 'toggle' && S.read(m.on)) {
        m.t = m.pt = 1;
        const s = m.solid, b = m.box;
        s.x0 = b[0] + m.to[0]; s.x1 = b[3] + m.to[0]; s.y0 = b[1] + m.to[1]; s.y1 = b[4] + m.to[1]; s.z0 = b[2] + m.to[2]; s.z1 = b[5] + m.to[2];
      }
    }
    for (const d of L.doors) {
      if (S.read(d.on)) {
        d.open = d.popen = d.target = 1;
        const s = d.solid, b = d.box;
        s.x0 = b[0] + d.travel[0]; s.x1 = b[3] + d.travel[0]; s.y0 = b[1] + d.travel[1]; s.y1 = b[4] + d.travel[1]; s.z0 = b[2] + d.travel[2]; s.z1 = b[5] + d.travel[2];
        s.active = !d.buried;
      }
    }
    for (const f of L.fans) f.active = f.on ? S.read(f.on) : true;
    for (const z of L.zones) z.active = z.on ? S.read(z.on) : true;
    for (const z of L.fires) z.active = z.on ? S.read(z.on) : true;
    for (const z of L.currents) z.active = z.on ? S.read(z.on) : true;
    for (const x of L.exits) x.open = x.on ? S.read(x.on) : true;
    for (const k of this.packs) if (k.settle) k.settle(this);
  }

  // ---------------------------------------------------------------- events
  ev(e) { this.events.push(e); }
  sfx(name, intensity = 1, x = this.player.x, y = this.player.y, z = this.player.z) {
    this.events.push({ type: 'sfx', name, intensity, x, y, z });
  }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------------------------------------------------------------- step
  step(input) {
    const inp = input || NO_INPUT;
    this.tick++;
    if (this.tick === 1 && this.level.hints.start) this.ev({ type: 'hint', key: 'start', text: this.level.hints.start });
    this._actuators(DT);
    this._crates(DT);
    this._player(inp, DT);
    this._triggers(DT);
    this.signals.evaluate(DT);
    if (!this.completed) this.time += DT; else this.completeT += DT;
  }

  // ---------------------------------------------------------------- actuators
  _actuators(dt) {
    const L = this.level, S = this.signals;
    for (const m of L.movers) {
      const ot = m.t; m.pt = ot;
      const on = m.on ? S.read(m.on) : true;
      const dT = m.speed * dt / m.len;
      if (m.mode === 'toggle') {
        const target = on ? 1 : 0;
        if (m.t < target) m.t = Math.min(target, m.t + dT);
        else if (m.t > target) m.t = Math.max(target, m.t - dT);
      } else if (on) {
        if (m.wait > 0) m.wait -= dt;
        else {
          m.t += m.dirSign * dT;
          if (m.t >= 1) { m.t = 1; m.dirSign = -1; m.wait = m.pause; }
          else if (m.t <= 0) { m.t = 0; m.dirSign = 1; m.wait = m.pause; }
        }
      }
      const d = m.t - ot, s = m.solid, b = m.box;
      m.moving = d !== 0;
      s.dx = m.to[0] * d; s.dy = m.to[1] * d; s.dz = m.to[2] * d;
      s.x0 = b[0] + m.to[0] * m.t; s.x1 = b[3] + m.to[0] * m.t;
      s.y0 = b[1] + m.to[1] * m.t; s.y1 = b[4] + m.to[1] * m.t;
      s.z0 = b[2] + m.to[2] * m.t; s.z1 = b[5] + m.to[2] * m.t;
    }
    for (const d of L.doors) {
      const oo = d.open; d.popen = oo;
      const want = S.read(d.on) ? 1 : 0;
      if (want !== d.target) {
        d.target = want;
        const b = d.box;
        this.sfx(want ? 'door_open' : 'door_close', 1, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      }
      if (d.open < want) d.open = Math.min(1, d.open + dt / d.time);
      else if (d.open > want && !this._doorBlocked(d)) d.open = Math.max(0, d.open - dt / d.time);
      const dd = d.open - oo, s = d.solid, b = d.box, o = d.open;
      s.dx = d.travel[0] * dd; s.dy = d.travel[1] * dd; s.dz = d.travel[2] * dd;
      s.x0 = b[0] + d.travel[0] * o; s.x1 = b[3] + d.travel[0] * o;
      s.y0 = b[1] + d.travel[1] * o; s.y1 = b[4] + d.travel[1] * o;
      s.z0 = b[2] + d.travel[2] * o; s.z1 = b[5] + d.travel[2] * o;
      s.active = !(d.buried && d.open >= 0.999);
    }
    for (const f of L.fans) {
      const a = f.on ? S.read(f.on) : true;
      if (a && !f.active) { const b = f.box; this.sfx('fan', 1, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2); }
      f.active = a;
    }
    for (const z of L.zones) z.active = z.on ? S.read(z.on) : true;
    for (const z of L.fires) z.active = z.on ? S.read(z.on) : true;
    for (const z of L.currents) z.active = z.on ? S.read(z.on) : true;
    for (const sp of L.sprouts) {
      sp.pgrowth = sp.growth;
      if (sp.state === 1) {
        sp.growth += dt / SPROUT_GROW_TIME;
        if (sp.growth >= 1) { sp.growth = 1; sp.state = 2; for (const l of sp.leaves) l.solid.active = true; }
      }
    }
    for (const x of L.exits) {
      const o = x.on ? S.read(x.on) : true;
      if (o && !x.open) this.sfx('door_open', 1, x.pos[0], x.pos[1] + 0.8, x.pos[2]);
      x.open = o;
    }
    for (const k of this.packs) if (k.actuators) k.actuators(this, dt);
  }

  _doorBlocked(d) {
    const b = d.box, p = this.player, m = 0.02;
    if (p.x + p.r > b[0] + m && p.x - p.r < b[3] - m && p.z + p.r > b[2] + m && p.z - p.r < b[5] - m &&
        p.y + p.h > b[1] + m && p.y < b[4] - m) return true;
    for (const c of this.level.crates) {
      if (c.gone) continue;
      const q = c.body;
      if (q.x + q.hx > b[0] + m && q.x - q.hx < b[3] - m && q.z + q.hz > b[2] + m && q.z - q.hz < b[5] - m &&
          q.y + q.h > b[1] + m && q.y < b[4] - m) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- crates
  _crates(dt) {
    for (const c of this.level.crates) {
      if (c.gone) continue;           // a pack removed it (burnt away, crumbled)
      const b = c.body;
      const sx = b.x, sy = b.y, sz = b.z;
      c.px = sx; c.py = sy; c.pz = sz;
      const g = b.ground;
      if (c.grounded && g && g.active && (g.dx || g.dy || g.dz)) { b.x += g.dx; b.y += g.dy; b.z += g.dz; }
      b.vy = Math.max(-TERMINAL, b.vy - GRAVITY * dt);
      const fall = -b.vy;
      moveBody(this, b, 0, b.vy * dt, 0, { grounded: c.grounded, snap: false, stepGround: 0, stepAir: 0 });
      if (b.landed) {
        if (!c.grounded && fall > 4) this.sfx('land', Math.min(1, fall / 14), b.x, b.y, b.z);
        b.vy = 0;
      } else b.ground = null;
      c.grounded = b.landed;
      if (b.y < this.level.killY) {
        b.x = c.home[0]; b.y = c.home[1]; b.z = c.home[2]; b.vy = 0; c.grounded = false; b.ground = null;
        c.px = b.x; c.py = b.y; c.pz = b.z; c.resets++;
        this._syncCrate(c, b.x, b.y, b.z);
      } else this._syncCrate(c, sx, sy, sz);
    }
  }

  _syncCrate(c, fromX, fromY, fromZ) {
    const b = c.body, s = c.solid;
    s.dx = b.x - fromX; s.dy = b.y - fromY; s.dz = b.z - fromZ;
    s.x0 = b.x - b.hx; s.x1 = b.x + b.hx; s.y0 = b.y; s.y1 = b.y + b.h; s.z0 = b.z - b.hz; s.z1 = b.z + b.hz;
  }

  /** Try to shove a crate horizontally. All-or-nothing; returns the distance moved. */
  _pushCrate(c, dx, dz) {
    const b = c.body, ox = b.x, oz = b.z;
    const oy = b.y;
    b.x += dx; b.z += dz;
    let hit = overlapsAny(this, b);
    if (hit && hit.kind === 'box' && hit.y1 - b.y <= 0.1) {   // a lip such as a pressure plate: ride up onto it
      b.y = hit.y1;
      hit = overlapsAny(this, b);
    }
    if (hit) { b.x = ox; b.z = oz; b.y = oy; return 0; }
    const s = c.solid;
    s.dx += dx; s.dz += dz; s.dy += b.y - oy;
    s.x0 = b.x - b.hx; s.x1 = b.x + b.hx; s.z0 = b.z - b.hz; s.z1 = b.z + b.hz;
    s.y0 = b.y; s.y1 = b.y + b.h;
    return Math.abs(dx) + Math.abs(dz);
  }

  _breakPane(pane, intensity = 1) {
    if (pane.broken) return;
    pane.broken = true; pane.solid.active = false;
    const b = pane.box, x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2, z = (b[2] + b[5]) / 2;
    this.sfx('pane_smash', intensity, x, y, z);
    this.ev({ type: 'burst', kind: 'pane', x, y, z, piece: pane.index });
  }

  _onHitH(b, s, vn, nx, nz, depth) {
    const p = this.player;
    if (b !== p) return BLOCK;
    const F = p.caps, o = s.owner;
    if (o.type === 'pane') {
      if (!F.smashesPanes) return BLOCK;
      if (vn >= o.speed) { this._breakPane(o); p.vx *= 0.85; p.vz *= 0.85; return PASS; }
      if (vn > 1.5 && this.time - (o.lastCrack || -9) > 0.35) {
        o.lastCrack = this.time; o.cracks = (o.cracks || 0) + 1;
        this.sfx('pane_crack', Math.min(1, vn / o.speed));
      }
    } else if (F.pushesCrates && o.crate === true && o.grounded && p.grounded) {
      const ax = Math.abs(nx) > Math.abs(nz);
      if (Math.max(Math.abs(nx), Math.abs(nz)) > 0.75) {
        const moved = ax ? this._pushCrate(o, -Math.sign(nx) * depth, 0) : this._pushCrate(o, 0, -Math.sign(nz) * depth);
        if (ax) p.vx = Math.max(-CRATE_PUSH_SPEED, Math.min(CRATE_PUSH_SPEED, p.vx));
        else p.vz = Math.max(-CRATE_PUSH_SPEED, Math.min(CRATE_PUSH_SPEED, p.vz));
        if (moved > 1e-7) {
          p.pushing = true;
          if (this.time - this.lastPushSfx > 0.3) { this.lastPushSfx = this.time; this.sfx('crate_push', 0.8, o.body.x, o.body.y, o.body.z); }
          return PASS;
        }
      }
    }
    return BLOCK;
  }

  _onLand(b, s, fallSpeed) {
    const p = this.player;
    if (b === p && p.caps.smashesPanes && s.owner.type === 'pane' && fallSpeed >= s.owner.speed) {
      this._breakPane(s.owner); p.vy *= 0.85; return PASS;
    }
    return BLOCK;
  }

  // ---------------------------------------------------------------- environment
  _bodyInBox(b, box, mxz, my) {
    return b.x + b.r - mxz > box[0] && b.x - b.r + mxz < box[3] &&
           b.z + b.r - mxz > box[2] && b.z - b.r + mxz < box[5] &&
           b.y + b.h - my > box[1] && b.y + my < box[4];
  }

  _queryEnv(p) {
    const e = this.env, L = this.level;
    e.force = null; e.fill = false; e.hold = false; e.reacts.length = 0; e.wx = 0; e.wy = 0; e.wz = 0; e.water = null; e.fire = false;
    for (const z of L.zones) {
      if (!z.active || !this._bodyInBox(p, z.box, z.mxz, z.my)) continue;
      const r = z.react;
      if (r.force) { e.force = r.force; e.fill = r.fill === true; }   // forces a form (and may hold the gauge full)
      else if (r.demote || r.refuse) e.reacts.push(r);                // turns some forms back / refuses them
      if (r.hold) e.hold = true;                                      // the gauge does not drain inside
    }
    for (const f of L.fans) {
      if (!f.active || !this._bodyInBox(p, f.box, 0.15, 0.02)) continue;
      e.wx += f.dir[0] * f.strength; e.wy += f.dir[1] * f.strength; e.wz += f.dir[2] * f.strength;
    }
    for (const c of L.currents) {
      if (!c.active) continue;
      const b = c.box;
      if (p.x > b[0] && p.x < b[3] && p.z > b[2] && p.z < b[5] && p.y < b[4] && p.y + p.h > b[1]) { e.water = c; break; }
    }
    for (const f of L.fires) {
      if (f.active && this._bodyInBox(p, f.box, 0.1, 0.05)) { e.fire = true; break; }
    }
    return e;
  }

  // ---------------------------------------------------------------- forms
  /** Would `form` fit at the player's current position? */
  fits(form) {
    const p = this.player, q = this._probe, F = this.F[form];
    q.form = form; q.caps = F; q.r = F.r; q.h = F.h; q.x = p.x; q.y = p.y; q.z = p.z;
    return !overlapsAny(this, q, q.y, 0.01);
  }

  _changeForm(to, cause) {
    const p = this.player, from = p.form;
    if (from === to) return;
    const F = this.F[to];
    p.form = to; p.caps = F; p.r = F.r; p.h = F.h; p.formT = 0;
    if (cause !== 'respawn') {
      // the sound of becoming the new form, or (for a form without one) of leaving the old one
      const name = F.sfxEnter || this.F[from].sfxLeave;
      if (name) this.sfx(name, 1);
    }
    if (F.move === 'float') { if (p.vy < -2) p.vy = -2; p.grounded = false; p.jumping = false; }
    this.ev({ type: 'form', from, to, cause });
  }

  _deny(reason) {
    this.sfx('denied', 1);
    this.ev({ type: 'denied', reason });
  }

  /**
   * A voluntary form change. Hard refusals (locked form, zone, gauge) are denied at once.
   * "No room" is different: the request is remembered for FORM_BUFFER seconds and fires the
   * moment Mote fits (e.g. pressing 1 while still crawling out from under a low wall), and is
   * only denied if that never happens.
   */
  _requestForm(to, env, fresh) {
    const p = this.player, T = this.F[to];
    if (!T) return;
    // pressing the button of the form you are already in is that form's special (if it has one)
    if (to === p.form) { p.pendForm = null; if (fresh && T.special) this._special(T.special, env); return; }
    if (!this.level.forms.includes(to)) { if (fresh) this._deny('locked'); return; }
    if (p.formCd > 0) { if (fresh) { p.pendForm = to; p.pendT = FORM_BUFFER; } return; }
    let why = null;
    if (env.force && env.force !== to) why = 'zone';
    else {
      for (const r of env.reacts) if (r.refuse && r.refuse[to]) { why = r.refuse[to]; break; }
      if (!why && T.minStart !== undefined && p.gauge < T.minStart) why = 'gauge';
    }
    if (why) { p.pendForm = null; if (fresh) this._deny(why); return; }
    if (!this.fits(to)) {
      if (fresh && p.pendForm !== to) { p.pendForm = to; p.pendT = FORM_BUFFER; }
      return;
    }
    p.pendForm = null;
    p.formCd = FORM_COOLDOWN;
    this._changeForm(to, 'player');
  }

  /** A form's special action (the element's `specials[name]`). It returns false to refuse. */
  _special(name, env) {
    const p = this.player, fn = this.element.specials[name];
    if (fn(this, p, env) === false) { this._deny('special'); return; }
    this.ev({ type: 'special', name, form: p.form, x: p.x, y: p.y, z: p.z });
  }

  /** Add to (or take from) the gauge, clamped to 0..max. Packs and specials use this. */
  addGauge(n) {
    const p = this.player;
    p.gauge = Math.max(0, Math.min(this.G.max, p.gauge + n));
    return p.gauge;
  }

  /** Throw the hero: vy is set outright, the horizontal part rides on top of its own control until it lands. */
  launch(vx, vy, vz) {
    const p = this.player;
    p.ivx = vx; p.ivz = vz; p.vy = vy;
    p.grounded = false; p.ground = null; p.floating = false; p.jumping = false; p.coyoteT = 0; p.bufferT = 0;
  }

  // ---------------------------------------------------------------- player
  _player(inp, dt) {
    const p = this.player;
    p.px = p.x; p.py = p.y; p.pz = p.z;
    p.pushing = false;
    p.formT += dt;
    if (this.completed) { p.vx = p.vy = p.vz = 0; return; }
    const restart = !!inp.restart;
    if (restart && !this.prevRestart) { this.prevRestart = true; this.respawn('restart'); return; }
    this.prevRestart = restart;
    if (p.respawnT > 0) { p.respawnT -= dt; p.jumpHeld = !!inp.jump; return; }

    // a pack may take the hero over for this tick (riding a wire, say)
    for (const k of this.packs) if (k.control && k.control(this, p, inp, dt)) return;

    const env = this._queryEnv(p);
    if (env.fire) {
      if (this.feed < 0) { this.respawn('fire'); return; }
      this.addGauge(this.feed * dt);              // what kills one element feeds another
    }
    if (env.water && p.caps.dousedByWater) { this.respawn('water'); return; }
    for (const k of this.packs) if (k.hazards && k.hazards(this, p, env, dt)) return;

    // --- forced state changes (zones). Postponed while the forced form would not fit.
    if (env.force && p.form !== env.force && this.fits(env.force)) this._changeForm(env.force, 'zone');
    for (const r of env.reacts) {
      const to = r.demote && r.demote[p.form];
      if (to && (!r.ifFits || this.fits(to))) this._changeForm(to, 'zone');
    }
    if (p.formCd > 0) p.formCd -= dt;
    if (inp.form && inp.form !== p.pendForm) this._requestForm(inp.form, env, true);
    else if (p.pendForm) {
      this._requestForm(p.pendForm, env, false);
      if (p.pendForm && (p.pendT -= dt) <= 0) { p.pendForm = null; this._deny('space'); }
    }

    // --- the gauge: forms with `drain` spend it and fall back to the default form when it is empty
    const drain = p.caps.drain;
    if (drain) {
      if (env.fill) p.gauge = this.G.max;
      else if (!env.hold) {
        p.gauge -= drain * dt;
        if (p.gauge <= 0) {
          p.gauge = 0;
          // if the default form is bigger than this one it must fit first (a spark in a pinhole stays a spark)
          const D = this.F[this.element.defaultForm];
          if ((D.r <= p.r && D.h <= p.h) || this.fits(this.element.defaultForm)) this._changeForm(this.element.defaultForm, 'gauge');
        }
      }
    } else if (this.G.refill > 0 && (p.grounded || p.floating)) {
      p.gauge = Math.min(this.G.max, p.gauge + this.G.refill * dt);
    }

    const form = p.form, F = this.F[form], move = F.move;

    // --- carried by whatever we stand on
    let g = p.grounded ? p.ground : null;
    if (g && !g.active) g = null;
    if (g && (g.dx || g.dy || g.dz)) { p.x += g.dx; p.y += g.dy; p.z += g.dz; }

    // --- input
    let mx = +inp.mx || 0, mz = +inp.mz || 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const hasInput = ml > 0.01;
    if (hasInput) p.facing = Math.atan2(mx, mz);

    // --- water
    const water = env.water;
    let floating = false;
    if (water && F.floats) {
      const target = water.box[4] - F.floatDepth;
      if (p.y <= target + 0.02 && !(p.jumping && p.vy > 0)) {
        floating = true;
        if (!p.inWater) {
          p.inWater = true;
          if (p.vy < -2) { this.sfx('splash', Math.min(1, -p.vy / 12)); this.ev({ type: 'burst', kind: 'splash', x: p.x, y: water.box[4], z: p.z }); }
        }
        p.vy += ((target - p.y) * 80 - p.vy * 12) * dt;
      }
    }
    if (!floating && p.inWater && !(water && p.y < water.box[4])) p.inWater = false;
    if (water && F.sinks && !p.inWater) {
      p.inWater = true;
      if (p.vy < -2) { this.sfx('splash', Math.min(1, -p.vy / 12)); this.ev({ type: 'burst', kind: 'splash', x: p.x, y: water.box[4], z: p.z }); }
    }
    p.floating = floating;
    const supported = p.grounded || floating;

    // --- horizontal velocity per movement model
    if (move === 'walk') {
      const sp = F.speed * (floating ? WATER_SPEED_FACTOR : 1);
      const a = supported ? (hasInput ? F.accel : F.decel) : (hasInput ? F.airAccel : F.airDecel);
      this._approach2(p, mx * sp, mz * sp, a * dt);
    } else if (move === 'slide') {
      const wet = water ? 0.5 : 1;
      if (hasInput) {
        const sp0 = Math.hypot(p.vx, p.vz);
        const a = (p.grounded ? F.accel : F.airAccel) * wet;
        let nvx = p.vx + mx * a * dt, nvz = p.vz + mz * a * dt;
        const sp1 = Math.hypot(nvx, nvz), cap = Math.max(sp0, F.speed * wet);
        if (sp1 > cap) { nvx *= cap / sp1; nvz *= cap / sp1; }
        p.vx = nvx; p.vz = nvz;
      }
      if (p.grounded) {
        const sp = Math.hypot(p.vx, p.vz);
        if (sp > 0) {
          const f = Math.min(sp, (hasInput ? F.friction * 0.4 : F.friction) * (water ? 3 : 1) * dt);
          p.vx -= p.vx / sp * f; p.vz -= p.vz / sp * f;
        }
        if (g && g.kind === 'ramp') {
          const u = rampU(g, p);
          if (u > 0 && u < 1) {
            const s = rampSlope(g), a = GRAVITY * s / (1 + s * s);
            rampDir(g, DIR);
            p.vx -= DIR.x * a * dt; p.vz -= DIR.z * a * dt;
          }
        }
      }
      const sp2 = Math.hypot(p.vx, p.vz);
      if (sp2 > F.maxSpeed) { p.vx *= F.maxSpeed / sp2; p.vz *= F.maxSpeed / sp2; }
    } else { // float
      const windH = env.wx !== 0 || env.wz !== 0;
      const a = windH ? F.windAccel : (hasInput ? F.accel : F.drag);
      this._approach2(p, mx * F.speed + env.wx, mz * F.speed + env.wz, a * dt);
      p.vy = approach(p.vy, F.rise + env.wy, (env.wy !== 0 ? F.windAccel : F.riseAccel) * dt);
    }

    // --- carry velocity: wind on liquid, current on floaters
    let tbx = 0, tbz = 0;
    if (F.windCarry) { tbx += env.wx * F.windCarry; tbz += env.wz * F.windCarry; }
    if (floating) { tbx += water.flow[0]; tbz += water.flow[1]; }
    p.bvx = approach(p.bvx, tbx, 30 * dt); p.bvz = approach(p.bvz, tbz, 30 * dt);

    // --- jump (forms with a `jump` speed)
    const jumpHeld = !!inp.jump;
    const jumpPressed = jumpHeld && !p.jumpHeld;
    p.jumpHeld = jumpHeld;
    if (jumpPressed) p.bufferT = JUMP_BUFFER; else if (p.bufferT > 0) p.bufferT -= dt;
    if (supported) p.coyoteT = COYOTE_TIME; else if (p.coyoteT > 0) p.coyoteT -= dt;
    let left = false; // left the ground on purpose this tick (jump or ramp launch)
    if (F.jump && p.bufferT > 0 && p.coyoteT > 0) {
      p.vy = F.jump;
      if (g && p.grounded) { p.vx += g.dx / dt; p.vz += g.dz / dt; if (g.dy > 0) p.vy += g.dy / dt; }
      p.grounded = false; p.floating = floating = false; p.coyoteT = 0; p.bufferT = 0; p.jumping = true; left = true;
      this.sfx('jump', 1);
      this.ev({ type: 'burst', kind: 'jump', x: p.x, y: p.y, z: p.z });
    }

    // --- gravity
    if (move !== 'float' && !floating) {
      let gr = GRAVITY;
      if (F.gravMul !== undefined) gr *= F.gravMul;       // a form that floats on its own updraft
      if (p.vy < 0) gr *= F.fallMul || 1;
      else if (p.jumping && !jumpHeld) gr *= F.cutMul || 1;
      if (F.sinks && water) { gr *= F.waterGravity; p.vy -= p.vy * 2 * dt; }
      p.vy -= gr * dt;
      if (F.updraftAccel && env.wy !== 0) p.vy += env.wy * F.updraftAccel * dt;
      const term = F.maxFall === undefined ? TERMINAL : F.maxFall;
      if (p.vy < -term) p.vy = -term;
    }

    // --- a sliding form launches off the crest of a ramp instead of sticking to it
    if (move === 'slide' && p.grounded && g && g.kind === 'ramp') {
      const u = rampU(g, p);
      if (u < 1) {
        rampDir(g, DIR);
        const vUp = p.vx * DIR.x + p.vz * DIR.z, vyS = rampSlope(g) * vUp;
        const run = DIR.x !== 0 ? g.x1 - g.x0 : g.z1 - g.z0;
        if (vyS >= F.launchMin && u + vUp * dt / run >= 1) { p.vy = vyS; p.grounded = false; left = true; }
      }
    }

    // --- move
    const wasGrounded = p.grounded;
    const preVy = p.vy;
    resolveEmbedded(this, p);
    let hx = p.vx + p.bvx, hz = p.vz + p.bvz;
    if (p.ivx !== 0 || p.ivz !== 0) { hx += p.ivx; hz += p.ivz; }   // thrown by a blast: carried until it lands or hits a wall
    moveBody(this, p, hx * dt, p.vy * dt, hz * dt, {
      grounded: wasGrounded, snap: wasGrounded && !left && move !== 'float',
      stepGround: F.step, stepAir: F.airStep,
    });

    if (p.headHit && p.vy > 0) p.vy = 0;
    if (p.wallHit > 0 && (p.ivx !== 0 || p.ivz !== 0)) { p.ivx = 0; p.ivz = 0; }
    if (move === 'float') {
      p.grounded = false; p.ground = null;
    } else if (p.landed) {
      p.grounded = true; p.ivx = 0; p.ivz = 0; p.airSpecial = false;
      if (!wasGrounded && preVy < -3) {
        this.sfx('land', Math.min(1, Math.max(0.15, -preVy / 14)));
        this.ev({ type: 'burst', kind: 'land', x: p.x, y: p.y, z: p.z, form, speed: -preVy });
      }
      p.vy = 0; p.jumping = false;
    } else {
      if (wasGrounded && !left && g) { p.vx += g.dx / dt; p.vz += g.dz / dt; } // walked off a mover
      p.grounded = false; p.ground = null;
    }
    if (F.wallBounce && p.wallHit > 2.5) {
      // a little bounce so ice feels hard, plus a knock
      p.vx += p.wallNx * p.wallHit * 0.25; p.vz += p.wallNz * p.wallHit * 0.25;
      this.sfx('land', Math.min(1, p.wallHit / 12));
    }

    // --- crushed between solids (a mover closed on us and there is no way out)
    // Normal resolution leaves ~0 penetration, so a deep overlap that survives a few ticks is a
    // squeeze. React fast: waiting longer would let the mover shove Mote through the wall.
    if (penetration(this, p) > 0.1) {
      if (++p.crushT > 4) { this.respawn('crush'); return; }
    } else p.crushT = 0;

    if (p.y < this.level.killY) this.respawn('fall');
  }

  _approach2(p, tx, tz, maxDelta) {
    const dx = tx - p.vx, dz = tz - p.vz, d = Math.hypot(dx, dz);
    if (d <= maxDelta || d === 0) { p.vx = tx; p.vz = tz; }
    else { p.vx += dx / d * maxDelta; p.vz += dz / d * maxDelta; }
  }

  // ---------------------------------------------------------------- triggers
  _triggers(dt) {
    const L = this.level, S = this.signals, p = this.player, F = p.caps;
    const alive = !this.completed && p.respawnT <= 0;
    for (const pl of L.plates) {
      const top = pl.solid.y1;
      let pressed = false, by = null, refused = false;
      if (alive && p.grounded && Math.abs(p.y - top) < 0.12 && xzPen(pl.solid, p, PEN) > 0.05) {
        if (pl.heavy ? F.pressesHeavy : F.pressesLight) { pressed = true; by = 'player'; }
        else refused = true;
      }
      if (!pressed) {
        for (const c of L.crates) {
          if (c.grounded && !c.gone && Math.abs(c.body.y - top) < 0.12 && xzPen(pl.solid, c.body, PEN) > 0.05) { pressed = true; by = 'crate'; break; }
        }
      }
      if (pressed !== pl.pressed) {
        pl.pressed = pressed;
        this.sfx(pressed ? 'plate_down' : 'plate_up', pl.heavy ? 1 : 0.7, pl.pos[0], pl.pos[1], pl.pos[2]);
      }
      if (refused && !pl.refused) this.sfx('denied', 0.5, pl.pos[0], pl.pos[1], pl.pos[2]);
      pl.refused = refused; pl.by = by;
      if (pressed) S.emit(pl.emit);
    }
    for (const e of L.electrodes) {
      const b = e.box;
      const live = alive && F.conducts === true && p.grounded &&
        p.x > b[0] - 0.1 && p.x < b[3] + 0.1 && p.z > b[2] - 0.1 && p.z < b[5] + 0.1 && p.y > b[1] - 0.1 && p.y < b[4];
      if (live && !e.live) this.sfx('spark', 1, (b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
      e.live = live;
      if (live) S.emit(e.emit);
    }
    for (const s of L.sensors) {
      let live = alive && (!s.forms || s.forms.includes(p.form)) && this._bodyInBox(p, s.box, 0.05, 0.02);
      if (!live && s.crates) {
        const b = s.box;
        for (const c of L.crates) {
          if (c.gone) continue;
          const q = c.body;
          if (q.x + q.hx > b[0] && q.x - q.hx < b[3] && q.z + q.hz > b[2] && q.z - q.hz < b[5] && q.y + q.h > b[1] && q.y < b[4]) { live = true; break; }
        }
      }
      s.live = live;
      if (live) S.emit(s.emit);
    }
    for (const e of L.embers) {
      if (!e.doused && alive && F.douses === true && this._bodyInBox(p, e.box, -0.1, -0.05)) {
        e.doused = true; e.solid.active = false;
        const b = e.box, x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2, z = (b[2] + b[5]) / 2;
        this.sfx('ember_douse', 1, x, y, z);
        this.ev({ type: 'burst', kind: 'douse', x, y, z, piece: e.index });
      }
      if (e.doused && e.emit) S.emit(e.emit);
    }
    for (const sp of L.sprouts) {
      if (sp.state === 0 && alive && F.waters === true &&
          Math.hypot(p.x - sp.pos[0], p.z - sp.pos[2]) < 0.95 && Math.abs(p.y - sp.pos[1]) < 1.0) {
        sp.state = 1;
        this.sfx('sprout_grow', 1, sp.pos[0], sp.pos[1], sp.pos[2]);
        this.ev({ type: 'burst', kind: 'sprout', x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] });
      }
      if (sp.state === 2 && sp.emit) S.emit(sp.emit);
    }
    for (const pn of L.panes) if (pn.broken && pn.emit) S.emit(pn.emit);
    for (const cp of L.checkpoints) {
      if (alive && this.checkpoint !== cp &&
          Math.hypot(p.x - cp.pos[0], p.z - cp.pos[2]) < cp.r && p.y - cp.pos[1] > -0.5 && p.y - cp.pos[1] < 1.5) {
        if (this.checkpoint) this.checkpoint.current = false;
        this.checkpoint = cp; cp.lit = true; cp.current = true;
        this.sfx('checkpoint', 1, cp.pos[0], cp.pos[1], cp.pos[2]);
        this.ev({ type: 'checkpoint', index: cp.index, x: cp.pos[0], y: cp.pos[1], z: cp.pos[2] });
      }
      if (cp.lit && cp.emit) S.emit(cp.emit);
    }
    for (const k of this.packs) if (k.triggers) k.triggers(this, alive, dt);
    if (!alive) return;
    const cy = p.y + p.h / 2;
    for (const sh of L.shards) {
      if (!sh.taken && Math.hypot(p.x - sh.pos[0], cy - sh.pos[1], p.z - sh.pos[2]) < 0.85) {
        sh.taken = true; this.shardsTaken.push(sh.shardIndex);
        this.sfx('shard', 1, sh.pos[0], sh.pos[1], sh.pos[2]);
        this.ev({ type: 'shard', index: sh.shardIndex, count: this.shardsTaken.length, x: sh.pos[0], y: sh.pos[1], z: sh.pos[2] });
      }
    }
    for (const h of L.hintZones) {
      if (!h.seen && this._bodyInBox(p, h.box, 0.05, 0.02)) {
        h.seen = true; this.ev({ type: 'hint', key: h.key, text: L.hints[h.key] });
      }
    }
    const x = L.exits[0];
    if (x.open && this._bodyInBox(p, x.box, 0.1, 0.05)) this.complete();
  }

  // ---------------------------------------------------------------- lifecycle
  complete() {
    if (this.completed) return;
    this.completed = true;
    const p = this.player;
    this.sfx('level_complete', 1);
    this.ev({
      type: 'complete', id: this.level.id, timeMs: Math.round(this.time * 1000),
      shards: this.shardsTaken.slice().sort((a, b) => a - b), deaths: this.deaths, x: p.x, y: p.y, z: p.z,
    });
  }

  respawn(cause = 'fall') {
    const p = this.player;
    const from = [p.x, p.y, p.z];
    const at = this.checkpoint ? this.checkpoint.pos : this.level.spawn;
    const def = this.element.defaultForm;
    if (p.form !== def) this._changeForm(def, 'respawn');
    p.x = p.px = at[0]; p.y = p.py = at[1] + 0.02; p.z = p.pz = at[2];
    p.vx = p.vy = p.vz = 0; p.bvx = p.bvz = 0;
    p.grounded = false; p.ground = null; p.floating = false; p.inWater = false; p.jumping = false;
    // a checkpoint that refuels (a brazier) sends the hero back with a full gauge; otherwise the level's start value
    p.gauge = this.checkpoint && this.checkpoint.fullGauge ? this.G.max : this.level.startGauge;
    p.coyoteT = 0; p.bufferT = 0; p.formCd = 0; p.crushT = 0; p.pendForm = null;
    p.ivx = 0; p.ivz = 0; p.airSpecial = false;
    p.respawnT = RESPAWN_FREEZE; p.warp = this.tick;
    if (cause !== 'restart') this.deaths++;
    else {
      for (const c of this.level.crates) {
        if (c.gone) continue;
        const b = c.body;
        b.x = c.home[0]; b.y = c.home[1]; b.z = c.home[2]; b.vy = 0; c.grounded = false; b.ground = null;
        c.px = b.x; c.py = b.y; c.pz = b.z;
        this._syncCrate(c, b.x, b.y, b.z);
      }
    }
    for (const k of this.packs) if (k.respawn) k.respawn(this, cause);
    this.sfx('respawn', 1);
    this.ev({ type: 'respawn', cause, from, to: [p.x, p.y, p.z] });
  }

  // ---------------------------------------------------------------- debug / tools
  teleport(x, y, z) {
    const p = this.player;
    p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z;
    p.vx = p.vy = p.vz = 0; p.bvx = p.bvz = 0; p.grounded = false; p.ground = null; p.warp = this.tick;
    p.coyoteT = 0; p.bufferT = 0; p.jumping = false; p.floating = false; p.inWater = false; p.crushT = 0;
    p.ivx = 0; p.ivz = 0;
    for (const k of this.packs) if (k.teleport) k.teleport(this);
  }

  /** Debug: change form ignoring level locks, zones and the gauge (still refuses if it would not fit). */
  forceForm(form) {
    if (!this.F[form]) return false;
    if (form === this.player.form) return true;
    if (!this.fits(form)) return false;
    if (this.F[form].drain) this.player.gauge = this.G.max;
    this._changeForm(form, 'debug');
    return true;
  }

  raycast(ox, oy, oz, dx, dy, dz, maxDist, filter) { return raycast(this, ox, oy, oz, dx, dy, dz, maxDist, filter); }

  /** Compact numeric fingerprint of the whole dynamic state (determinism tests). */
  fingerprint() {
    const p = this.player, L = this.level;
    const out = [this.tick, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.form, p.gauge, p.grounded ? 1 : 0, this.deaths, this.shardsTaken.join('')];
    for (const c of L.crates) out.push(c.body.x, c.body.y, c.body.z);
    for (const m of L.movers) out.push(m.t);
    for (const d of L.doors) out.push(d.open);
    for (const pl of L.plates) out.push(pl.pressed ? 1 : 0);
    for (const k of this.packs) if (k.fingerprint) k.fingerprint(this, out);
    return out.join(',');
  }
}

export { blocks, topAt };
