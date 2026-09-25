// DYEFIELD — JELLY CHARGE, the sub (CONTRACT §10.2 CHANGED(KITSIM), CONTRACT_P6_11 §18.1). THREE-free,
// DOM-free, deterministic. Numbers: data/weapons.json subs[jelly-charge]; knobs: config.ts KITS.
//
//   throw  intent.sub held + canFire + tank ≥ tankCost + subCooldown over → pay tankCost, spawn kind 3 at
//          throwSpeed on the low-arc ballistic solution through the aim point (gravity `gravity`); out of
//          reach → 45°; no aim point → aim pitch + KITS.subLoftDeg. A short tank dry-clicks.
//   land   the first map contact (runners are ignored) turns the slot into a puddle (state PUDDLE) for
//          puddleFuse (counted in whole ticks).
//   pop    damage lerp(damageCenter, damageEdge, d / blastRadius) to every enemy whose hit-capsule axis is
//          within blastRadius of the puddle and in line of sight of it (cause 'sub'), plus a paintRadius splat.
// Events: 'sub' throw / land / pop.

import type { PlayerIntent } from '../types.ts';
import { DEG } from '../types.ts';
import { hash32 } from '../rng.ts';
import { COMBAT, KITS, TICK } from '../config.ts';
import type { CastHit } from '../physics.ts';
import type { Runner } from '../runner.ts';
import type { JellyDef } from './defs.ts';
import { KIND_JELLY, PSTATE_PUDDLE } from './projectiles.ts';
import { axisDistance, dryClick, tankLowCheck, type KitHost } from './kits.ts';

/** Low-arc launch pitch reaching horizontal distance D and height difference dy at speed v, gravity g; NaN = out of reach. */
export function lowArcPitch(v: number, g: number, D: number, dy: number): number {
  if (D < 1e-6) return dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * D * D + 2 * dy * v2);
  if (disc < 0) return NaN;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * D));
}

/** One tick of runner `r`'s sub (after its kit). `variant` = the host's ProjectileKind index for the jelly. */
export function stepSub(r: Runner, intent: PlayerIntent, dt: number, s: JellyDef | null, variant: number, host: KitHost): void {
  r.subCooldown = Math.max(0, r.subCooldown - dt);
  if (!s || !intent.sub || !r.canFire() || r.subCooldown > 1e-9) return;
  if (r.tank < s.tankCost) { dryClick(r, host); return; }
  const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
  let yaw = r.aimYaw;
  let pitch = Math.min(KITS.subMaxPitchDeg * DEG, r.aimPitch + KITS.subLoftDeg * DEG);
  if (intent.hasAim && Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY) && Number.isFinite(intent.aimZ)) {
    const ax = intent.aimX - ox, az = intent.aimZ - oz, ay = intent.aimY - oy;
    const D = Math.hypot(ax, az);
    if (D > COMBAT.minAimDist) {
      yaw = Math.atan2(ax, az);
      const p = lowArcPitch(s.throwSpeed, s.gravity, D, ay);
      pitch = Number.isFinite(p) ? p : 45 * DEG;
    }
  }
  const cp = Math.cos(pitch), v = s.throwSpeed;
  const seed = hash32(host.seedWord, r.id, 0x5ab0 + r.subs);
  const slot = host.pool.spawn(KIND_JELLY, r.id, r.team, ox, oy, oz, Math.sin(yaw) * cp * v, Math.sin(pitch) * v, Math.cos(yaw) * cp * v, seed, 0, variant);
  if (slot < 0) return;                             // pool full: nothing thrown, nothing paid
  r.tank = Math.max(0, r.tank - s.tankCost);
  r.subCooldown = KITS.subCooldown;
  r.subs++;
  host.emit({ t: 'sub', pid: r.id, id: s.id, phase: 'throw', x: ox, y: oy, z: oz });
  tankLowCheck(r, host);
}

/** The jelly in `slot` touched the map: it rests there as a puddle (state PUDDLE, timer = fuse ticks). */
export function landJelly(slot: number, hit: CastHit, s: JellyDef, host: KitHost): void {
  const P = host.pool;
  P.state[slot] = PSTATE_PUDDLE;
  P.x[slot] = hit.x + hit.nx * 0.02; P.y[slot] = hit.y + hit.ny * 0.02; P.z[slot] = hit.z + hit.nz * 0.02;
  P.vx[slot] = 0; P.vy[slot] = 0; P.vz[slot] = 0;
  P.nx[slot] = hit.nx; P.ny[slot] = hit.ny; P.nz[slot] = hit.nz;
  P.timer[slot] = Math.max(1, Math.round(s.puddleFuse / TICK));
  host.emit({ t: 'sub', pid: P.owner[slot], id: s.id, phase: 'land', x: P.x[slot], y: P.y[slot], z: P.z[slot] });
}

/** One tick of the puddle in `slot`; pops when the fuse runs out. Returns true when the slot is done (remove it). */
export function tickPuddle(slot: number, s: JellyDef, host: KitHost): boolean {
  const P = host.pool;
  P.timer[slot] -= 1;
  if (P.timer[slot] > 0) return false;
  const owner = P.owner[slot], team = P.team[slot];
  const x = P.x[slot], y = P.y[slot], z = P.z[slot];
  const nx = P.nx[slot], ny = P.ny[slot], nz = P.nz[slot];
  host.emit({ t: 'sub', pid: owner, id: s.id, phase: 'pop', x, y, z });
  const lx = x + nx * 0.3, ly = y + ny * 0.3, lz = z + nz * 0.3;
  const R = host.runners;
  for (let i = 0; i < R.length; i++) {
    const v = R[i];
    if (!v.alive || v.team === team) continue;
    const d = axisDistance(v, x, y, z);
    if (d > s.blastRadius) continue;
    if (!host.lineClear(lx, ly, lz, v.x, v.y + v.hitHeight() * 0.5, v.z)) continue;
    const dmg = s.damageCenter + (s.damageEdge - s.damageCenter) * (d / s.blastRadius);
    host.damage(v, owner, dmg, v.x, v.y + v.hitHeight() * 0.5, v.z, 'sub');
  }
  host.paint(owner, team as 0 | 1 | 2, x, y, z, s.paintRadius, nx, ny, nz, -0.1, P.seed[slot]);
  return true;
}
