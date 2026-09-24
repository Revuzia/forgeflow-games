// BLOCKTOOTH — helpers shared by the four titan kits (lane titan-sim; CONTRACT §8).
// THREE-FREE, DOM-free, deterministic. Lane-internal module: nothing outside
// src/titans/ should import it.

import type { Building, Enemy, Hazard, HazardKind, Prop, StatKey, TitanId, World } from '../../core/types.ts';
import { clamp } from '../../core/math.ts';
import { stat } from '../../upgrades/stats.ts';
import { targetPos } from '../../combat/targeting.ts';
import type { Target } from '../../combat/targeting.ts';

/** Current stat incl. frenzy buffs. */
export function S(w: World, k: StatKey): number { return stat(w, k); }

/** Read a kit number with a default (kit records survive save/clone as plain objects). */
export function kv(w: World, key: string, dflt = 0): number {
  const v = w.titan.kit[key];
  return v === undefined || v !== v ? dflt : v;
}

/** Auto-attack interval (s) for a base interval, divided by the attackRate stat (floored). */
export function autoInterval(w: World, baseS: number): number {
  return baseS / Math.max(0.2, S(w, 'attackRate'));
}

/** Hook cooldown (s) for a base cooldown. abilityCooldown is a multiplier (floor 0.35× per §5.5). */
export function hookCooldown(w: World, baseS: number): number {
  return baseS * Math.max(0.35, S(w, 'abilityCooldown'));
}

/** Knockback impulse (m/s) for an attack: grows gently with body height so a Size V swat still flings
 *  (k=1 → ~3 m/s at Size I, ~9.7 m/s at Size V), × the knockback stat. */
export function knockFor(w: World, k: number): number {
  return k * (2 + Math.sqrt(w.titan.height)) * Math.max(0, S(w, 'knockback'));
}

/** True while the titan is grinding through (or shoving against) buildings. Set by titansim. */
export function isPlowing(w: World): boolean {
  return kv(w, 'sim_plowT') > 0 || kv(w, 'sim_pressT') > 0;
}

export function emitAttack(w: World, attack: string, x: number, z: number, dir: number, r: number, hits: number): void {
  w.events.push({ type: 'titanAttack', attack, x, z, dir, r, hits });
}

export function emitAbility(w: World, titan: TitanId, power: number): void {
  w.events.push({ type: 'ability', titan, x: w.titan.x, z: w.titan.z, power });
}

/** Alive titan-owned hazards of a kind, oldest first (hazards are appended in spawn order). */
export function titanHazards(w: World, kind: HazardKind, out: Hazard[]): Hazard[] {
  out.length = 0;
  for (const h of w.hazards) if (h.alive && h.owner === 'titan' && h.kind === kind) out.push(h);
  return out;
}

/** Remove the oldest hazards until at most `cap - 1` remain (making room for one more). */
export function makeRoom(list: Hazard[], cap: number): void {
  const n = Math.max(1, Math.floor(cap));
  let excess = list.length - (n - 1);
  for (let i = 0; i < list.length && excess > 0; i++) {
    if (list[i].alive) { list[i].alive = false; excess--; }
  }
}

/** Distance from a point to a building footprint (0 inside). */
export function distToBuilding(b: Building, x: number, z: number): number {
  const hx = b.w / 2, hz = b.d / 2;
  const dx = Math.max(Math.abs(x - b.x) - hx, 0);
  const dz = Math.max(Math.abs(z - b.z) - hz, 0);
  return Math.hypot(dx, dz);
}

/** Closest point of a building footprint to (x,z). */
export function closestOnBuilding(b: Building, x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = clamp(x, b.x - b.w / 2, b.x + b.w / 2);
  out.z = clamp(z, b.z - b.d / 2, b.z + b.d / 2);
  return out;
}

/** Approximate footprint radius (m) of a prop kind (props carry no radius field). */
export function propRadius(p: Prop): number {
  switch (p.kind) {
    case 'car': case 'taxi': return 2.1;
    case 'van': return 2.4;
    case 'bus': return 5.2;
    case 'truck': return 4.2;
    case 'kiosk': return 1.3;
    case 'hydrant': return 0.35;
    case 'lamp': return 0.35;
    case 'tree': return 1.2;
    case 'bench': return 0.9;
    case 'vending': return 0.6;
    case 'signpost': return 0.35;
    case 'barrier': return 1.2;
    case 'drum': return 0.45;
    case 'forklift': return 1.5;
    case 'container': return 3.1;
    case 'bollard': return 0.3;
    case 'boat': return 3.8;
    case 'pylon': return 0.5;
    case 'snowbank': return 1.6;
  }
}

/** Is an enemy alive and targetable by the titan's area abilities? */
export function enemyLive(e: Enemy): boolean { return e.alive && e.hp > 0; }

// ─────────────────────────────── auto-attack cadence + aiming ───────────────────────────────
/** Re-arm the auto after a swing; keeps a small negative remainder so the cadence stays steady. */
export function rearmAuto(w: World, intervalS: number): void {
  const T = w.titan;
  T.autoCd = Math.max(T.autoCd, -w.dt) + intervalS;
}

/** No target: hold the auto ready (fires the moment something comes into reach, never at air). */
export function idleAuto(w: World): void {
  if (w.titan.autoCd < 0) w.titan.autoCd = 0;
}

/** Ask titansim to swivel toward a heading while the stick is idle (kit → sim hint). */
export function faceToward(w: World, heading: number, holdS = 0.35): void {
  const K = w.titan.kit;
  K.sim_faceH = heading;
  K.sim_faceT = holdS;
}

/** Kit → sim own-speed multiplier (1 = normal). titansim reads it on the next tick. */
export function setMoveMul(w: World, m: number): void {
  w.titan.kit.sim_moveMul = m;
}

/** Where to aim at a target from (fromX, fromZ): enemies/props/boss parts at their centre,
 *  buildings at the closest point of their footprint (a wall right in front reads as "ahead"). */
export function aimPoint(w: World, t: Target, fromX: number, fromZ: number, out: { x: number; z: number }): { x: number; z: number } {
  switch (t.kind) {
    case 'enemy': out.x = t.e.x; out.z = t.e.z; return out;
    case 'prop': {
      const p = w.city.props[t.id];
      if (p) { out.x = p.x; out.z = p.z; return out; }
      break;
    }
    case 'building': {
      const b = w.city.buildings[t.id];
      if (b) return closestOnBuilding(b, fromX, fromZ, out);
      break;
    }
    case 'boss': {
      const part = w.boss ? w.boss.parts[t.part] : undefined;
      if (part) { out.x = part.x; out.z = part.z; return out; }
      break;
    }
  }
  const p = targetPos(w, t);
  out.x = p.x; out.z = p.z;
  return out;
}

/** Seconds of titan-relative distance → a speed (m/s) that scales with the body (min floor). */
export function hSpeed(w: World, hPerS: number, minMps: number): number {
  return Math.max(minMps, hPerS * w.titan.height);
}
