// GENESIS — small helpers shared by the god layer: places in words, the default "here", vector maths on the unit
// sphere (tangent directions, moving a point by metres), nearest settlements, hashed choices.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { CommandResult, EntityRef } from '../types.ts';
import type { V3 } from './state.ts';
import { distM } from '../people/world.ts';
import { hashFloat } from '../core/rng.ts';

export function ok(msg: string, created?: EntityRef[]): CommandResult {
  const r: CommandResult = { ok: true, msg };
  if (created) r.created = created;
  return r;
}

export function fail(msg: string): CommandResult {
  return { ok: false, msg };
}

/** the default place on a planet: the camera focus there, else a hashed land cell */
export function herePos(u: Universe, p: Planet): V3 {
  if (u.focus && u.focus.planet === p.id) return [u.focus.pos[0], u.focus.pos[1], u.focus.pos[2]];
  const P = p.grid.pos;
  for (let k = 0; k < 64; k++) {
    const c = Math.floor(hashFloat(p.seed, k, 0x4e7e) * p.count);
    if (p.f.water[c] < 0.1) return [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  }
  return [0, 0, 1];
}

export function cellPos3(p: Planet, c: number): V3 {
  const P = p.grid.pos;
  return [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
}

/** nearest standing settlement to a point (within maxM) */
export function nearestSettlement(p: Planet, pos: ArrayLike<number>, maxM = Infinity, filter?: (st: Settlement) => boolean): Settlement | null {
  let best: Settlement | null = null, bd = Infinity;
  for (const st of p.people?.settlements ?? []) {
    if (st.fallen >= 0) continue;
    if (filter && !filter(st)) continue;
    const d = distM(p, st.pos, pos);
    if (d < bd) { bd = d; best = st; }
  }
  return best && bd <= maxM ? best : null;
}

/** "near Aru", "over Aru", "in the wilds of Gaia (12°N 40°E)" */
export function placeName(p: Planet, pos: ArrayLike<number>): string {
  const st = nearestSettlement(p, pos, 2500);
  if (st) {
    const d = distM(p, st.pos, pos);
    return d < st.territory + 80 ? `on ${st.name}` : `near ${st.name}`;
  }
  const lat = (Math.asin(Math.max(-1, Math.min(1, pos[1]))) * 180) / Math.PI;
  const lon = (Math.atan2(pos[0], pos[2]) * 180) / Math.PI;
  return `in the wilds of ${p.name} (${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'})`;
}

export function norm(a: ArrayLike<number>): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** the tangent part of v at the unit point p */
export function tangent(p: ArrayLike<number>, v: ArrayLike<number>): V3 {
  const d = dot(p, v);
  return [v[0] - p[0] * d, v[1] - p[1] * d, v[2] - p[2] * d];
}

/** east / north unit vectors at p (north = +Y projected) */
export function frame(p: ArrayLike<number>): { east: V3; north: V3 } {
  let ex = p[2], ez = -p[0];
  let el = Math.hypot(ex, ez);
  if (el < 1e-9) { ex = 1; ez = 0; el = 1; }
  const east: V3 = [ex / el, 0, ez / el];
  const north: V3 = norm([p[1] * east[2] - p[2] * east[1], p[2] * east[0] - p[0] * east[2], p[0] * east[1] - p[1] * east[0]]);
  return { east, north };
}

/** a tangent unit direction at p for a bearing (rad, 0 = north, + toward east) */
export function bearingDir(p: ArrayLike<number>, bearing: number): V3 {
  const { east, north } = frame(p);
  return norm([north[0] * Math.cos(bearing) + east[0] * Math.sin(bearing), north[1] * Math.cos(bearing) + east[1] * Math.sin(bearing), north[2] * Math.cos(bearing) + east[2] * Math.sin(bearing)]);
}

/** move a unit point `metres` along a tangent direction on a sphere of radius R */
export function moveBy(p: ArrayLike<number>, dir: ArrayLike<number>, metres: number, R: number): V3 {
  const t = norm(tangent(p, dir));
  const a = metres / R;
  const c = Math.cos(a), s = Math.sin(a);
  return norm([p[0] * c + t[0] * s, p[1] * c + t[1] * s, p[2] * c + t[2] * s]);
}

/** a point `metres` away from p at a bearing */
export function offset(p: ArrayLike<number>, metres: number, bearing: number, R: number): V3 {
  return moveBy(p, bearingDir(p, bearing), metres, R);
}

/** heading (rad, 0 north, + east) of a tangent vector at p */
export function headingOf(p: ArrayLike<number>, v: ArrayLike<number>): number {
  const { east, north } = frame(p);
  return Math.atan2(dot(v, east), dot(v, north));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** the actor of a command: 0 the player, 1.. rival gods */
export function actor(cmd: Record<string, unknown>): number {
  const g = cmd.god;
  return typeof g === 'number' && g >= 0 && g <= 3 ? Math.floor(g) : 0;
}
