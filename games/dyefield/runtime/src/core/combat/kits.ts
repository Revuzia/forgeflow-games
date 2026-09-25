// DYEFIELD — kits (CONTRACT §10.1 / §10.4). THREE-free, DOM-free, deterministic.
//
// Phase 4 ships MIST-RASP, a 'stream' kit: data/weapons.json kits[mist-rasp].fire is the only source
// of its numbers. A held trigger fires shotsPerSecond droplets; each costs tankPerShot. With too little
// tank the trigger dry-clicks: a 'dry' event, no droplet, no paint, TANK.dryCooldown between clicks.
// The tank dropping to ≤ TANK.low fires 'tankLow' once per dip. Other kits (phase 6) fall back to the
// MIST-RASP stream until they are implemented, so a roster naming them still plays.

import type { PlayerIntent } from '../types.ts';
import { DEG } from '../types.ts';
import { WEAPONS } from '../data.ts';
import { hash32 } from '../rng.ts';
import { COMBAT, TANK } from '../config.ts';
import type { Runner } from '../runner.ts';
import type { SimEvent } from '../match/events.ts';
import { KIND_MIST, type ProjectileKind, type ProjectilePool } from './projectiles.ts';

export interface StreamFire {
  kit: string;            // the kit id this fire block came from
  shotsPerSecond: number;
  tankPerShot: number;
  damage: number;
  projectileSpeed: number;
  straightTime: number;
  gravity: number;
  spreadDeg: number;
  jumpSpreadDeg: number;
  maxRange: number;
  impactRadius: number;
  dripEvery: number;
  dripRadius: number;
  moveSpeedWhileFiring: number;
  /** projectile kind this kit spawns */
  kind: number;
}

type KitRow = (typeof WEAPONS)['kits'][number];

export function kitDef(id: string): KitRow {
  const k = WEAPONS.kits.find((x) => x.id === id);
  if (!k) throw new Error(`unknown kit '${id}' (data/weapons.json has: ${WEAPONS.kits.map((x) => x.id).join(', ')})`);
  return k;
}

function num(o: Record<string, unknown>, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`weapons.json ${where}.${key} missing or not a number`);
  return v;
}

const streamCache = new Map<string, StreamFire>();

/** The stream-fire numbers a runner with `kitId` uses (MIST-RASP's for kits phase 6 has not built yet). */
export function streamFire(kitId: string): StreamFire {
  const hit = streamCache.get(kitId);
  if (hit) return hit;
  let row = WEAPONS.kits.find((x) => x.id === kitId);
  let fire = row ? (row['fire'] as Record<string, unknown> | undefined) : undefined;
  if (!row || !fire || fire['type'] !== 'stream') {
    row = kitDef('mist-rasp');
    fire = row['fire'] as Record<string, unknown>;
  }
  const w = `kits[${row.id}].fire`;
  const paint = (fire['paint'] ?? {}) as Record<string, unknown>;
  const f: StreamFire = {
    kit: row.id,
    shotsPerSecond: num(fire, 'shotsPerSecond', w),
    tankPerShot: num(fire, 'tankPerShot', w),
    damage: num(fire, 'damage', w),
    projectileSpeed: num(fire, 'projectileSpeed', w),
    straightTime: num(fire, 'straightTime', w),
    gravity: num(fire, 'gravity', w),
    spreadDeg: num(fire, 'spreadDeg', w),
    jumpSpreadDeg: num(fire, 'jumpSpreadDeg', w),
    maxRange: num(fire, 'maxRange', w),
    impactRadius: num(paint, 'impactRadius', `${w}.paint`),
    dripEvery: num(paint, 'dripEvery', `${w}.paint`),
    dripRadius: num(paint, 'dripRadius', `${w}.paint`),
    moveSpeedWhileFiring: num(fire, 'moveSpeedWhileFiring', w),
    kind: KIND_MIST,
  };
  streamCache.set(kitId, f);
  return f;
}

/** Flight numbers for the projectile kind a stream kit spawns (§10.4: maxRange = asymptotic reach). */
export function projectileKind(f: StreamFire): ProjectileKind {
  const straight = f.projectileSpeed * f.straightTime;
  const rest = Math.max(0.5, f.maxRange - straight);
  return {
    damage: f.damage,
    straightTime: f.straightTime,
    gravity: f.gravity,
    drag: f.projectileSpeed / rest,
    impactRadius: f.impactRadius,
    dripEvery: f.dripEvery,
    dripRadius: f.dripRadius,
    maxLife: COMBAT.maxLife,
  };
}

/** Special-meter points needed for the kit's special (weapons.json specials[].chargePoints). */
export function specialChargePoints(kitId: string): number {
  const row = WEAPONS.kits.find((x) => x.id === kitId) ?? kitDef('mist-rasp');
  const sp = WEAPONS.specials.find((s) => s.id === row.special);
  const v = sp ? (sp['chargePoints'] as number) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 190;
}

/** What firing needs from the match. */
export interface KitHost {
  readonly pool: ProjectilePool;
  emit(e: SimEvent): void;
  /** match seed word (shot seeds) */
  readonly seedWord: number;
}

/**
 * One tick of a stream kit for runner `r` (after the runner has moved). Sets r.firing. `rng` is the
 * runner's own mulberry32 combat stream (spread rolls).
 */
export function stepStream(r: Runner, intent: PlayerIntent, dt: number, f: StreamFire, rng: () => number, host: KitHost): void {
  r.firing = false;
  r.dryCd = Math.max(0, r.dryCd - dt);
  const held = !!intent.fire && r.canFire();
  if (!held) { r.fireCd = Math.max(0, r.fireCd - dt); return; }
  r.fireCd -= dt;                                   // no clamp while held: the remainder keeps the exact rate
  if (r.tank < f.tankPerShot) { dryClick(r, host); r.fireCd = Math.max(0, r.fireCd); return; }
  r.firing = true;
  const period = 1 / f.shotsPerSecond;
  let guard = 3;
  while (r.fireCd <= 1e-9 && guard-- > 0) {
    if (r.tank < f.tankPerShot) { dryClick(r, host); r.fireCd = Math.max(0, r.fireCd); break; }
    fireOne(r, f, rng, host);
    r.fireCd += period;
  }
}

function dryClick(r: Runner, host: KitHost): void {
  if (r.dryCd > 0) return;
  r.dryCd = TANK.dryCooldown;
  r.dries++;
  host.emit({ t: 'dry', pid: r.id });
}

function fireOne(r: Runner, f: StreamFire, rng: () => number, host: KitHost): void {
  const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
  // spread: uniform in a disc of half-angle spread (airborne: jumpSpread), squashed vertically
  const half = (r.grounded ? f.spreadDeg : f.jumpSpreadDeg) * DEG;
  const ang = rng() * Math.PI * 2;
  const rad = half * Math.sqrt(rng());
  const yaw = r.aimYaw + rad * Math.cos(ang);
  const pitch = r.aimPitch + rad * Math.sin(ang) * COMBAT.verticalSpreadScale;
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
  const sp = f.projectileSpeed;
  const seed = hash32(host.seedWord, r.id, r.shots);
  host.pool.spawn(f.kind, r.id, r.team, ox, oy, oz, dx * sp, dy * sp, dz * sp, seed, f.dripEvery);
  r.tank = Math.max(0, r.tank - f.tankPerShot);
  r.shots++;
  host.emit({ t: 'shot', pid: r.id, kit: r.kit, x: ox, y: oy, z: oz, dx, dy, dz });
  if (r.tank <= TANK.low && r.lowArmed) {
    r.lowArmed = false;
    host.emit({ t: 'tankLow', pid: r.id });
  }
}
