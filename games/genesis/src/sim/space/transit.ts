// GENESIS — ships in flight (CONTRACT.md §12): where a ship is at any tick, the timeline of its phases, the chance a
// phase goes wrong, life aboard between the worlds, and the ShipView the renderer draws (types.ts).
//
// Frames: a ship on or near a world is in that world's BODY frame (unit vector + altitude, spinning with the ground);
// a ship between worlds is in the SYSTEM frame (metres, star at the origin). Every position is an analytic function of
// the tick and the ship's stored plan, so snapshots, the renderer's interpolation and a loaded game agree:
//   pad / landed   a fixed body-frame point
//   ascent         rising from the pad and bending east to orbit height
//   orbit          a great circle through the end of the ascent, in the world's equatorial (non-spinning) frame
//   transfer       a cubic Bezier from the orbit to a point above the landing site at the arrival tick: P0 where it
//                  leaves orbit, P3 above the target's PREDICTED position, P1 / P2 along each world's own motion
//                  (Lambert-free, a few game days); when the target's predicted place moves (a world moved to a new
//                  orbit, a moon spiralling in) the curve is set again from the ship's present place and velocity
//                  (flight.ts replanTransfer); a ship whose world was erased drifts on in a straight line
//   descent        straight down onto the landing site (body frame of the target); a ship called down from orbit
//                  glides from where it circled (descFrom) to its landing ground
//   air (airship)  up, then a great circle at cruise height over its own world, then down
//   gate           a fold: a straight line between the two gates in a few minutes
// Failures: a flight's overall chance of going wrong (1 − reliability) is shared between its phases; storms at the pad
// or the landing site, magnetic storms and solar flares raise the odds of the phases they touch. Rolls are stateless
// hashes of (ship, phase, day), so a replay fails the same ship at the same moment.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { ShipView } from '../types.ts';
import type { ShipKindDef } from '../content.ts';
import type { ShipState, V3 } from './state.ts';
import { bodyQuat, equatorQuat, qRotate, qRotateInv, type D3 } from '../world/orbits.ts';
import { hashFloat } from '../core/rng.ts';
import { slerp, tangentBasis } from '../core/vec3.ts';

/** ticks of a game day (CONTRACT §5: 1 tick = 1 minute) */
export const DAY = 1440;
/** phase durations (ticks) */
export const PAD_TICKS = 30;
export const ASCENT_TICKS = 40;
export const DESCENT_TICKS = 60;
export const AIR_CLIMB_TICKS = 30;
/** an orbit lasts this many ticks (a world held in the hand is small: orbits are drawn at a stately pace) */
export const ORBIT_PERIOD = 90;
/** how far east the ascent bends before it reaches orbit (rad) */
const ASCENT_ARC = 0.35;

/** the share of a flight's risk carried by each phase (sums to 1) */
const RISK_SHARE: Record<string, number> = { pad: 0.15, ascent: 0.3, orbit: 0.1, transfer: 0.3, descent: 0.15 };
const RISK_ORDER = ['pad', 'ascent', 'orbit', 'transfer', 'descent'];

const _q: [number, number, number, number] = [0, 0, 0, 1];
const _a: D3 = [0, 0, 0];
const _b: D3 = [0, 0, 0];

// ───────────────────────────── frames ─────────────────────────────

/** system-frame point of a body-frame direction at r metres from the centre of p at tick t */
export function bodyToSystem(u: Universe, p: Planet, t: number, dir: ArrayLike<number>, r: number, out: D3 = [0, 0, 0]): D3 {
  u.centerOf(p, t, _a);
  bodyQuat(p.st.orbit, p.st.axialTilt, u.spinOf(p, t), _q);
  qRotate(_q, dir, _b);
  out[0] = _a[0] + _b[0] * r;
  out[1] = _a[1] + _b[1] * r;
  out[2] = _a[2] + _b[2] * r;
  return out;
}

/** body-frame direction and distance from the centre of p of a system-frame point at tick t */
export function systemToBody(u: Universe, p: Planet, t: number, sys: ArrayLike<number>, out: D3 = [0, 0, 0]): number {
  u.centerOf(p, t, _a);
  const dx = sys[0] - _a[0], dy = sys[1] - _a[1], dz = sys[2] - _a[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  bodyQuat(p.st.orbit, p.st.axialTilt, u.spinOf(p, t), _q);
  _b[0] = dx / r; _b[1] = dy / r; _b[2] = dz / r;
  qRotateInv(_q, _b, out);
  return r;
}

/** rotate a vector about +Y by angle a (in a body or equatorial frame: +a is eastward) */
export function rotY(v: ArrayLike<number>, a: number, out: D3 = [0, 0, 0]): D3 {
  const c = Math.cos(a), s = Math.sin(a);
  const x = v[0] * c + v[2] * s, z = -v[0] * s + v[2] * c;
  out[0] = x; out[1] = v[1]; out[2] = z;
  return out;
}

/** the unit eastward tangent at unit vector v (a stable fallback at the poles) */
export function eastOf(v: ArrayLike<number>, out: D3 = [0, 0, 0]): D3 {
  let x = v[2], z = -v[0];
  const l = Math.hypot(x, z);
  if (l < 1e-9) { x = 1; z = 0; } else { x /= l; z /= l; }
  out[0] = x; out[1] = 0; out[2] = z;
  return out;
}

/** a planet's velocity (m per tick, system frame) at tick t */
export function velocityOf(u: Universe, p: Planet, t: number, out: D3 = [0, 0, 0]): D3 {
  const a = u.centerOf(p, t - 30, [0, 0, 0]);
  const b = u.centerOf(p, t + 30, [0, 0, 0]);
  out[0] = (b[0] - a[0]) / 60; out[1] = (b[1] - a[1]) / 60; out[2] = (b[2] - a[2]) / 60;
  return out;
}

function bezier(P: V3[], f: number, out: D3): D3 {
  const g = 1 - f;
  const a = g * g * g, b = 3 * g * g * f, c = 3 * g * f * f, d = f * f * f;
  for (let k = 0; k < 3; k++) out[k] = a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k];
  return out;
}

function smooth(f: number): number {
  const t = Math.max(0, Math.min(1, f));
  return t * t * (3 - 2 * t);
}

// ───────────────────────────── where a ship is ─────────────────────────────

export interface ShipWhere {
  /** world it is on / near (-1 between the worlds) */
  planet: number;
  /** body-frame unit vector on `planet` (or the system-frame point when between worlds) */
  pos: V3;
  alt: number;
  sys: V3;
}

/** the end of the ascent (body frame), the start of the orbit */
export function ascentEnd(sh: ShipState, out: D3 = [0, 0, 0]): D3 {
  return rotY(sh.padPos, ASCENT_ARC, out);
}

/** set up the orbit great circle for a ship whose ascent ends at tick t1 (E frame of `from`) */
export function planOrbit(u: Universe, sh: ShipState, from: Planet, t1: number): void {
  const end = ascentEnd(sh);
  const A = rotY(end, u.spinOf(from, t1));
  const l = Math.hypot(A[0], A[1], A[2]) || 1;
  sh.orbitA = [A[0] / l, A[1] / l, A[2] / l];
  sh.orbitB = eastOf(sh.orbitA) as V3;
  sh.orbitPeriod = ORBIT_PERIOD;
}

/** system position of a ship in orbit around `p` at tick t, and its body-frame direction */
function orbitAt(u: Universe, sh: ShipState, p: Planet, t: number, sys: D3, body: D3): void {
  const th = (2 * Math.PI * (t - sh.t0)) / Math.max(1, sh.orbitPeriod);
  const c = Math.cos(th), s = Math.sin(th);
  const e: D3 = [sh.orbitA[0] * c + sh.orbitB[0] * s, sh.orbitA[1] * c + sh.orbitB[1] * s, sh.orbitA[2] * c + sh.orbitB[2] * s];
  const r = p.st.radius + sh.altitude;
  u.centerOf(p, t, _a);
  equatorQuat(p.st.orbit, p.st.axialTilt, _q);
  qRotate(_q, e, _b);
  sys[0] = _a[0] + _b[0] * r; sys[1] = _a[1] + _b[1] * r; sys[2] = _a[2] + _b[2] * r;
  rotY(e, -u.spinOf(p, t), body);
}

/** where ship sh is at tick t (pure: a function of its stored plan) */
export function shipWhere(u: Universe, sh: ShipState, t: number, cls: string): ShipWhere {
  const from = u.planet(sh.from);
  const to = sh.to >= 0 ? u.planet(sh.to) : undefined;
  const out: ShipWhere = { planet: sh.from, pos: [sh.padPos[0], sh.padPos[1], sh.padPos[2]], alt: 0, sys: [0, 0, 0] };
  const f = sh.t1 > sh.t0 ? Math.max(0, Math.min(1, (t - sh.t0) / (sh.t1 - sh.t0))) : 0;
  const onBody = (p: Planet | undefined, dir: ArrayLike<number>, alt: number) => {
    if (!p) return;
    out.planet = p.id;
    out.pos = [dir[0], dir[1], dir[2]];
    out.alt = alt;
    bodyToSystem(u, p, t, dir, p.st.radius + alt, out.sys);
  };
  switch (sh.phase) {
    case 'building': case 'fuelling': case 'boarding': case 'pad':
      onBody(from, sh.padPos, 0);
      break;
    case 'ascent': {
      if (cls === 'air') { onBody(from, sh.padPos, sh.altitude * smooth(f)); break; }
      const dir = rotY(sh.padPos, ASCENT_ARC * f * f, [0, 0, 0]);
      onBody(from, dir, sh.altitude * Math.pow(f, 1.4));
      break;
    }
    case 'orbit': {
      if (!from) break;
      const body: D3 = [0, 0, 0];
      orbitAt(u, sh, from, t, out.sys, body);
      out.planet = from.id;
      out.pos = [body[0], body[1], body[2]];
      out.alt = sh.altitude;
      break;
    }
    case 'transfer': {
      if (cls === 'air') {
        const dir = slerp([0, 0, 0], sh.padPos, sh.dest, smooth(f));
        onBody(from, dir, sh.altitude);
        break;
      }
      if (cls === 'gate' || sh.bez.length < 4) {
        const a = from ? bodyToSystem(u, from, t, sh.padPos, from.st.radius + 2) : [0, 0, 0];
        const b = to ? bodyToSystem(u, to, t, sh.dest, to.st.radius + 2) : a;
        for (let k = 0; k < 3; k++) out.sys[k] = a[k] + (b[k] - a[k]) * f;
        nearest(u, out, t, from, to);
        break;
      }
      bezier(sh.bez, f, out.sys);
      nearest(u, out, t, from, to);
      break;
    }
    case 'descent': {
      const fall = Math.pow(1 - f, 1.3);
      // (called down from orbit: it glides from where it circled toward its landing ground over most of the way down)
      const dir = sh.descFrom ? slerp([0, 0, 0], sh.descFrom, sh.dest, smooth(f / 0.7)) : sh.dest;
      onBody(to ?? from, dir, sh.altitude * fall);
      break;
    }
    case 'landed':
      onBody(to ?? from, sh.dest, 0);
      break;
    case 'stranded': {
      // its world is gone: it drifts on in a straight line at the speed it had (bez = [where it was, velocity per tick])
      if (sh.bez.length === 2) {
        const dt = t - sh.t0;
        for (let k = 0; k < 3; k++) out.sys[k] = sh.bez[0][k] + sh.bez[1][k] * dt;
      } else if (sh.bez.length >= 4) {
        // (a ship stranded in an older save: along the end of its curve, velocity 3 (P3 − P2) per transfer)
        const span = Math.max(1, sh.arriveTick - sh.launchTick);
        const dt = t - Math.min(t, sh.arriveTick);
        const g = Math.max(0, Math.min(1, (t - sh.launchTick) / span));
        bezier(sh.bez, g, out.sys);
        for (let k = 0; k < 3; k++) out.sys[k] += ((3 * (sh.bez[3][k] - sh.bez[2][k])) / span) * dt;
      } else if (sh.lostAt) out.sys = [sh.lostAt.sys[0], sh.lostAt.sys[1], sh.lostAt.sys[2]];
      nearest(u, out, t, from, undefined);
      break;
    }
    case 'lost': case 'done': {
      const la = sh.lostAt;
      const p = la && la.planet >= 0 ? u.planet(la.planet) : undefined;
      if (la && p && p.alive) onBody(p, la.pos, la.alt);
      else if (la) { out.sys = [la.sys[0], la.sys[1], la.sys[2]]; out.planet = -1; out.pos = [la.sys[0], la.sys[1], la.sys[2]]; out.alt = 0; }
      break;
    }
  }
  return out;
}

/** the world a point between the worlds is close to (within 8 radii), in its body frame; else system-frame metres */
function nearest(u: Universe, out: ShipWhere, t: number, a: Planet | undefined, b: Planet | undefined): void {
  out.planet = -1;
  out.pos = [out.sys[0], out.sys[1], out.sys[2]];
  out.alt = 0;
  let best = Infinity;
  for (const p of [a, b]) {
    if (!p || !p.alive) continue;
    const dir: D3 = [0, 0, 0];
    const r = systemToBody(u, p, t, out.sys, dir);
    if (r < p.st.radius * 8 && r < best) {
      best = r;
      out.planet = p.id;
      out.pos = [dir[0], dir[1], dir[2]];
      out.alt = r - p.st.radius;
    }
  }
}

/** heading (rad, 0 north, + east) of a ship's motion at tick t, in the local frame of the world it is on */
function headingOf(u: Universe, sh: ShipState, t: number, cls: string, w: ShipWhere): number {
  if (w.planet < 0) return 0;
  const n = shipWhere(u, sh, t + 2, cls);
  if (n.planet !== w.planet) return 0;
  const east: D3 = [0, 0, 0], north: D3 = [0, 0, 0];
  tangentBasis(east, north, w.pos);
  const d: D3 = [n.pos[0] - w.pos[0], n.pos[1] - w.pos[1], n.pos[2] - w.pos[2]];
  const e = d[0] * east[0] + d[1] * east[1] + d[2] * east[2];
  const no = d[0] * north[0] + d[1] * north[1] + d[2] * north[2];
  if (Math.abs(e) + Math.abs(no) < 1e-12) return 0;
  return Math.atan2(e, no);
}

/** the renderer's view of a ship (types.ts ShipView) */
export function shipView(u: Universe, sh: ShipState, def: ShipKindDef | undefined): ShipView {
  const cls = def?.class ?? 'interplanetary';
  const t = u.tick;
  const w = shipWhere(u, sh, t, cls);
  const progress = sh.phase === 'building' || sh.phase === 'fuelling' ? sh.work
    : sh.t1 > sh.t0 ? Math.max(0, Math.min(1, (t - sh.t0) / (sh.t1 - sh.t0))) : 0;
  return {
    id: sh.id, kind: sh.kind, owner: sh.owner, species: sh.species, phase: sh.phase, planet: w.planet,
    pos: [w.pos[0], w.pos[1], w.pos[2]], alt: Math.round(w.alt * 100) / 100, sysPos: [w.sys[0], w.sys[1], w.sys[2]],
    heading: headingOf(u, sh, t, cls, w), crew: sh.phase === 'boarding' || sh.phase === 'building' || sh.phase === 'fuelling' ? sh.crewIds.length : sh.crew.length,
    from: sh.from, to: sh.to, progress: Math.round(progress * 1000) / 1000,
  };
}

// ───────────────────────────── the transfer ─────────────────────────────

/** game days a crossing between two worlds takes (by their distance at departure) */
export function transferTicks(u: Universe, def: ShipKindDef, from: Planet, to: Planet, t: number): number {
  const a = u.centerOf(from, t, [0, 0, 0]);
  const b = u.centerOf(to, t, [0, 0, 0]);
  const au = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1.5e6;
  const k = Math.max(0, Math.min(1, (au - 0.15) / 2.5));
  const days = def.days[0] + (def.days[1] - def.days[0]) * k;
  const speed = Math.max(0.05, u.god.law('space.speed'));
  return Math.max(30, Math.round((days * DAY) / speed));
}

/** an airship's flight time over its own world (great-circle distance at cruise speed) */
export function airTicks(u: Universe, def: ShipKindDef, p: Planet, a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const frac = ang / Math.PI;
  const days = def.days[0] + (def.days[1] - def.days[0]) * frac;
  const speed = Math.max(0.05, u.god.law('space.speed'));
  void p;
  return Math.max(40, Math.round((days * DAY) / speed));
}

/**
 * Plan the crossing: leave orbit at tick t0, arrive above `dest` on `to` at t0 + T. P1 and P2 follow each world's own
 * motion so the ship leaves with its world and comes in with the other; P3 is the target's predicted position.
 */
export function planTransfer(u: Universe, sh: ShipState, from: Planet, to: Planet, t0: number, T: number): void {
  const p0: D3 = [0, 0, 0], body: D3 = [0, 0, 0];
  if (sh.phase === 'orbit' || sh.orbitPeriod > 0) orbitAt(u, sh, from, t0, p0, body);
  else bodyToSystem(u, from, t0, sh.padPos, from.st.radius + sh.altitude, p0);
  const t1 = t0 + T;
  const p3 = bodyToSystem(u, to, t1, sh.dest, to.st.radius + sh.altitude, [0, 0, 0]);
  const v0 = velocityOf(u, from, t0), v1 = velocityOf(u, to, t1);
  const k = T / 3;
  // a gentle bow out of the plane so two ships on one route do not overlap exactly
  const bow = (hashFloat(sh.id, 0xb0e) - 0.5) * 0.06 * Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
  sh.bez = [
    [p0[0], p0[1], p0[2]],
    [p0[0] + v0[0] * k, p0[1] + v0[1] * k + bow, p0[2] + v0[2] * k],
    [p3[0] - v1[0] * k, p3[1] - v1[1] * k + bow, p3[2] - v1[2] * k],
    [p3[0], p3[1], p3[2]],
  ];
  sh.launchTick = t0;
  sh.arriveTick = t1;
}

// ───────────────────────────── risk ─────────────────────────────

/** a storm over a point of a world now (0 calm .. 1+ violent): weather systems with wind or lightning, tornadoes */
export function stormAt(u: Universe, p: Planet, pos: ArrayLike<number>): number {
  let s = 0;
  const R = p.st.radius;
  for (const w of p.weather) {
    const def = u.content.weather.list[w.kind];
    if (!def || (def.wind < 10 && def.lightning <= 0 && def.precipType !== 'hail')) continue;
    const d = Math.acos(Math.max(-1, Math.min(1, w.pos[0] * pos[0] + w.pos[1] * pos[1] + w.pos[2] * pos[2]))) * R;
    if (d > w.radius) continue;
    s = Math.max(s, w.intensity * (def.wind >= 20 || def.lightning > 0.5 ? 1 : 0.6));
  }
  if (p.st.globalWeather) {
    const def = u.content.weather.find(p.st.globalWeather);
    if (def && (def.wind >= 10 || def.lightning > 0)) s = Math.max(s, 0.7);
  }
  for (const d of u.god.disasters) {
    if (d.planet !== p.id || !['tornado', 'hurricane', 'firestorm'].includes(d.kind)) continue;
    const dist = Math.acos(Math.max(-1, Math.min(1, d.pos[0] * pos[0] + d.pos[1] * pos[1] + d.pos[2] * pos[2]))) * R;
    if (dist < d.radius * 2) s = Math.max(s, 1.2);
  }
  return s;
}

/** the sky between the worlds is wild: a magnetic storm or a solar flare on either world, or an active star */
export function spaceWeather(u: Universe, planets: number[]): number {
  let s = Math.max(0, (u.star.activity - 0.45) * 2);
  for (const d of u.god.disasters) if ((d.kind === 'magnetic-storm' || d.kind === 'solar-flare') && planets.includes(d.planet)) s = Math.max(s, 1);
  return s;
}

/**
 * The chance the ship fails in `phase` (conditional on having come through the phases before), from its flight's
 * reliability and the weather it meets there. `days` splits the transfer's risk into daily rolls.
 */
export function phaseRisk(u: Universe, sh: ShipState, phase: string, cls: string, days = 1): number {
  const F = Math.max(0, Math.min(1, 1 - sh.reliability));
  let before = 0;
  for (const k of RISK_ORDER) { if (k === phase) break; before += RISK_SHARE[k]; }
  const share = RISK_SHARE[phase] ?? 0;
  let p = (F * share) / Math.max(1e-6, 1 - F * before);
  if (phase === 'transfer' && days > 1) p = 1 - Math.pow(Math.max(0, 1 - Math.min(1, p)), 1 / days);
  // weather where this phase happens
  const from = u.planet(sh.from), to = sh.to >= 0 ? u.planet(sh.to) : undefined;
  let mult = 1;
  if ((phase === 'pad' || phase === 'ascent') && from) mult *= 1 + 1.6 * stormAt(u, from, sh.padPos);
  if (phase === 'descent' && to) mult *= 1 + 1.6 * stormAt(u, to, sh.dest);
  if (cls === 'air' && phase === 'transfer' && from) mult *= 1 + 2 * Math.max(stormAt(u, from, sh.padPos), stormAt(u, from, sh.dest));
  if ((phase === 'orbit' || phase === 'transfer') && cls !== 'air') mult *= 1 + 2 * spaceWeather(u, [sh.from, sh.to]);
  return Math.min(0.97, p * mult);
}

/** a stateless roll for (ship, phase, n) */
export function roll(u: Universe, sh: ShipState, phase: string, n = 0): number {
  return hashFloat(sh.id, RISK_ORDER.indexOf(phase) + 7, n, u.seed ^ 0x5a1f);
}

/** words for what went wrong */
export function failureWords(u: Universe, sh: ShipState, phase: string, cls: string): string {
  const from = u.planet(sh.from), to = sh.to >= 0 ? u.planet(sh.to) : undefined;
  if (cls === 'air') return from && stormAt(u, from, sh.padPos) > 0.3 ? 'a storm' : 'a fire in the gas bag';
  if ((phase === 'pad' || phase === 'ascent') && from && stormAt(u, from, sh.padPos) > 0.3) return 'lightning in a storm';
  if (phase === 'descent' && to && stormAt(u, to, sh.dest) > 0.3) return 'a storm over the landing ground';
  if ((phase === 'orbit' || phase === 'transfer') && spaceWeather(u, [sh.from, sh.to]) > 0.5) return 'a storm from the star';
  const words = phase === 'pad' ? ['a leak in the fuel', 'a spark'] : phase === 'ascent' ? ['an engine burst', 'the hull gave way']
    : phase === 'orbit' ? ['the air ran out', 'a fault nobody found'] : phase === 'transfer' ? ['a wrong reckoning', 'the engines died', 'the hull was holed']
      : ['the heat of coming down', 'a hard landing'];
  return words[Math.floor(hashFloat(sh.id, 0xfa11) * words.length)];
}
