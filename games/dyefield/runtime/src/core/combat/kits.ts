// DYEFIELD — kits (CONTRACT §10.1 / §10.4 + CHANGED(KITSIM), CONTRACT_P6_11 §18.1). THREE-free, DOM-free,
// deterministic. data/weapons.json kits[].fire is the only source of kit numbers; fire.type picks the behaviour:
//
//   stream  MIST-RASP (phase 4): a held trigger fires shotsPerSecond droplets; each costs tankPerShot.
//   roll    SHEET-DRUM: held + grounded + moving paints a capsule strip at the drum and flattens foes in
//           front of it; a tap / a press while standing / standing with fire held flicks a pitch-fanned
//           column of droplets (kind 1).
//   charge  NEEDLE-GLINT: held charges 0→1 (glint events every 0.1 s); release ≥ 15 % fires a hitscan beam
//           that paints a floor line + an end splat.
//   burst   POP-WELL: held fires shotsPerSecond straight bursts (kind 2) that explode on contact or at
//           maxRange (the explosion itself is MatchWorld.burst).
//
// With too little tank the trigger dry-clicks: a 'dry' event, no projectile, no paint, TANK.dryCooldown
// between clicks. The tank dropping to ≤ TANK.low fires 'tankLow' once per dip. streamFire(id) keeps
// returning MIST-RASP numbers for non-stream kits (the bots' ballistic model reads it).

import type { PlayerIntent, TeamId } from '../types.ts';
import { DEG } from '../types.ts';
import { WEAPONS } from '../data.ts';
import { hash32 } from '../rng.ts';
import { COMBAT, HITBOX, KITS, TANK } from '../config.ts';
import type { PhysicsWorld } from '../physics.ts';
import type { Runner } from '../runner.ts';
import type { SimEvent } from '../match/events.ts';
import {
  KIND_BURST, KIND_FLICK, KIND_MIST, paintImpact, segVerticalCapsuleT, type ProjectileKind, type ProjectilePool,
} from './projectiles.ts';
import { parseBurst, parseCharge, parseRoll, type BurstFire, type ChargeFire, type RollFire } from './defs.ts';

export type { BurstFire, ChargeFire, RollFire } from './defs.ts';

export interface StreamFire {
  type: 'stream';
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
    type: 'stream',
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

/** Every kit's fire block, discriminated by `type` (weapons.json kits[].fire.type). */
export type KitFire = StreamFire | RollFire | ChargeFire | BurstFire;

const fireCache = new Map<string, KitFire>();

/** The fire behaviour of `kitId` (an unknown kit or fire type → MIST-RASP's stream). */
export function kitFire(kitId: string): KitFire {
  const hit = fireCache.get(kitId);
  if (hit) return hit;
  const row = WEAPONS.kits.find((x) => x.id === kitId);
  const fire = row ? (row['fire'] as Record<string, unknown> | undefined) : undefined;
  let f: KitFire;
  const type = fire ? fire['type'] : undefined;
  if (row && fire && type === 'roll') f = parseRoll(row.id, fire);
  else if (row && fire && type === 'charge') f = parseCharge(row.id, fire);
  else if (row && fire && type === 'burst') f = parseBurst(row.id, fire);
  else f = streamFire(kitId);
  fireCache.set(kitId, f);
  return f;
}

export type DamageCause = 'dye' | 'sub' | 'special';

/** What firing needs from the match (MatchWorld implements it). */
export interface KitHost {
  readonly pool: ProjectilePool;
  emit(e: SimEvent): void;
  /** match seed word (shot seeds) */
  readonly seedWord: number;
  // ── CHANGED(KITSIM) ──
  readonly physics: PhysicsWorld;
  readonly runners: readonly Runner[];
  /** paint one splat for `owner` (credits painted area + special; emits the 'splat' event); returns flips */
  paint(owner: number, team: TeamId, x: number, y: number, z: number, r: number,
    nx: number, ny: number, nz: number, minFacing: number, seed: number): number;
  /** the roller strip: one painter.capsule a → b (floors/ramps only, crisp edge), credited, no 'splat' event */
  paintStrip(owner: number, team: TeamId, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r: number, seed: number): number;
  /** deal `dmg` to `victim` (no friendly fire, live phase only, leapers immune); puddle = splat a hit puddle */
  damage(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number, cause: DamageCause, puddle?: boolean): void;
  /** no map geometry between a and b */
  lineClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
}

/**
 * One tick of a stream kit for runner `r` (after the runner has moved). Sets r.firing. `rng` is the
 * runner's own mulberry32 combat stream (spread rolls).
 */
export function stepStream(r: Runner, intent: PlayerIntent, dt: number, f: StreamFire, rng: () => number, host: KitHost,
  variant: number = f.kind): void {
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
    fireOne(r, f, rng, host, variant);
    r.fireCd += period;
  }
}

/** A dry click (too little tank): the 'dry' event at most every TANK.dryCooldown. */
export function dryClick(r: Runner, host: KitHost): void {
  if (r.dryCd > 0) return;
  r.dryCd = TANK.dryCooldown;
  r.dries++;
  host.emit({ t: 'dry', pid: r.id });
}

function fireOne(r: Runner, f: StreamFire, rng: () => number, host: KitHost, variant: number): void {
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
  host.pool.spawn(f.kind, r.id, r.team, ox, oy, oz, dx * sp, dy * sp, dz * sp, seed, f.dripEvery, variant);
  r.tank = Math.max(0, r.tank - f.tankPerShot);
  r.shots++;
  host.emit({ t: 'shot', pid: r.id, kit: r.kit, x: ox, y: oy, z: oz, dx, dy, dz });
  tankLowCheck(r, host);
}

export function tankLowCheck(r: Runner, host: KitHost): void {
  if (r.tank <= TANK.low && r.lowArmed) {
    r.lowArmed = false;
    host.emit({ t: 'tankLow', pid: r.id });
  }
}


// ── dispatcher ───────────────────────────────────────────────────────────────────────────────

/**
 * One tick of runner `r`'s kit (after every runner has moved). `variant` = the host's ProjectileKind
 * index for this kit's projectiles (stream / flick / burst; unused by charge).
 */
export function stepKit(r: Runner, intent: PlayerIntent, dt: number, f: KitFire, variant: number,
  rng: () => number, host: KitHost): void {
  switch (f.type) {
    case 'stream': stepStream(r, intent, dt, f, rng, host, variant); break;
    case 'roll': stepRoll(r, intent, dt, f, variant, host); break;
    case 'charge': stepCharge(r, intent, dt, f, host); break;
    case 'burst': stepBurst(r, intent, dt, f, variant, host); break;
  }
}

/** Drop every kit transient (death, match end); emits 'roll' off when the drum was down. */
export function resetKit(r: Runner, host: { emit(e: SimEvent): void } | null): void {
  if (r.rolling && host) host.emit({ t: 'roll', pid: r.id, on: false });
  r.rolling = false; r.rollHas = false;
  r.flicking = false; r.flickT = 0; r.standT = 0; r.holdT = 0; r.pressFlicked = false; r.prevFireHeld = false;
  r.charging = false; r.charge = 0; r.glintT = 0;
  r.firing = false;
}

// ── SHEET-DRUM (roll) ───────────────────────────────────────────────────────────────────────

/**
 * Roll: fire held + grounded + moving → a capsule strip at the drum contact (KITS.drumAhead ahead of the
 * feet along the motion), tank −tankPerMetre per metre, enemies in front of the drum flattened. Flick: a
 * fresh press while not moving, a tap (released ≤ KITS.tapSeconds), or KITS.standFlickDelay standing with
 * fire held → windup → `splats` droplets (kind 1) → cooldown.
 */
export function stepRoll(r: Runner, intent: PlayerIntent, dt: number, f: RollFire, variant: number, host: KitHost): void {
  r.firing = false;
  r.dryCd = Math.max(0, r.dryCd - dt);
  r.flickCd = Math.max(0, r.flickCd - dt);
  if (!r.canFire()) { resetKit(r, host); return; }
  const held = !!intent.fire;
  const pressed = held && !r.prevFireHeld;
  const stick = Math.hypot(Number.isFinite(intent.moveX) ? intent.moveX : 0, Number.isFinite(intent.moveZ) ? intent.moveZ : 0);
  const moving = r.grounded && (r.speed >= KITS.rollMinSpeed || stick >= KITS.rollMinStick);

  // windup in progress → the droplets leave when it runs out
  if (r.flickT > 0) {
    r.flickT -= dt;
    if (r.flickT <= 1e-9) {
      r.flickT = 0;
      r.flicking = false;
      releaseFlick(r, f, variant, host);
      r.flickCd = f.cooldown;
    }
  }

  let roll = false;
  if (held) {
    if (pressed) { r.holdT = 0; r.pressFlicked = false; r.standT = 0; } else r.holdT += dt;
    if (r.grounded && !moving) r.standT += dt; else r.standT = 0;
    const wantFlick = (pressed && !moving) || r.standT >= KITS.standFlickDelay - 1e-9;
    if (wantFlick && r.flickT <= 0 && r.flickCd <= 0) startFlick(r, f, host);
    if (moving && r.flickT <= 0) {
      if (r.tank > 0) roll = true;
      else dryClick(r, host);
    }
  } else {
    if (r.prevFireHeld && r.holdT <= KITS.tapSeconds + 1e-9 && !r.pressFlicked && r.flickT <= 0 && r.flickCd <= 0) startFlick(r, f, host);
    r.holdT = 0; r.standT = 0;
  }
  r.prevFireHeld = held;

  if (roll !== r.rolling) {
    r.rolling = roll;
    r.rollHas = false;
    if (roll) r.rollSeed = hash32(host.seedWord, r.id, 0x2011 + r.strokes++);
    host.emit({ t: 'roll', pid: r.id, on: roll });
  }
  if (roll) paintRoll(r, f, host);
  r.firing = r.rolling || r.flicking;
}

function startFlick(r: Runner, f: RollFire, host: KitHost): void {
  if (r.tank < f.flickTankCost) { dryClick(r, host); return; }
  r.flickT = Math.max(1e-6, f.windup);
  r.flicking = true;
  r.pressFlicked = true;
  r.standT = 0;
  host.emit({ t: 'flick', pid: r.id });
}

function releaseFlick(r: Runner, f: RollFire, variant: number, host: KitHost): void {
  if (r.tank < f.flickTankCost) { dryClick(r, host); return; }
  const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
  const yaw = r.aimYaw;
  const lift = Math.max(0, r.aimPitch);            // aiming above level raises the column; below never shortens it
  const v = KITS.flickSpeed;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  for (let j = 0; j < f.splats; j++) {
    const p = f.flickPitch[j] + lift;
    const cp = Math.cos(p);
    const seed = hash32(host.seedWord, r.id, (r.shots << 4) + j);
    host.pool.spawn(KIND_FLICK, r.id, r.team, ox, oy, oz, sy * cp * v, Math.sin(p) * v, cy * cp * v, seed, 0, variant);
  }
  r.tank = Math.max(0, r.tank - f.flickTankCost);
  r.shots++;
  r.flicks++;
  const cl = Math.cos(lift);
  host.emit({ t: 'shot', pid: r.id, kit: r.kit, x: ox, y: oy, z: oz, dx: sy * cl, dy: Math.sin(lift), dz: cy * cl });
  tankLowCheck(r, host);
}

function paintRoll(r: Runner, f: RollFire, host: KitHost): void {
  const ph = host.physics;
  const mx = r.x - r.px, mz = r.z - r.pz;
  const dist = Math.hypot(mx, mz);
  let fx: number, fz: number;
  if (dist > 1e-4) { fx = mx / dist; fz = mz / dist; } else { fx = Math.sin(r.yaw); fz = Math.cos(r.yaw); }
  const rx = -fz, rz = fx;                          // right = (−cos yaw, sin yaw) for forward (sin yaw, cos yaw)
  const y0 = r.y + 0.3;
  // the drum never sits inside the wall in front of it
  let ahead = KITS.drumAhead;
  const fw = ph.raycast(r.x, y0, r.z, fx, 0, fz, KITS.drumAhead + 0.1);
  if (fw && Math.abs(fw.ny) < 0.5) ahead = Math.max(0, fw.toi - 0.1);
  const dx = r.x + fx * ahead, dz = r.z + fz * ahead, dy = r.y;
  // each half of the strip stops a pad past a wall at its side (no bleed under a thin wall)
  const hw = f.rollWidth * 0.5;
  let eR = hw, eL = hw;
  const wr = ph.raycast(dx, y0, dz, rx, 0, rz, hw + 0.3);
  if (wr && Math.abs(wr.ny) < 0.5) eR = Math.min(hw, wr.toi + KITS.rollWallPad);
  const wl = ph.raycast(dx, y0, dz, -rx, 0, -rz, hw + 0.3);
  if (wl && Math.abs(wl.ny) < 0.5) eL = Math.min(hw, wl.toi + KITS.rollWallPad);
  const off = 0.5 * (eR - eL), rad = Math.max(0.05, 0.5 * (eR + eL));
  const cx = dx + rx * off, cz = dz + rz * off;
  const ax = r.rollHas ? r.rollAx : cx, ay = r.rollHas ? r.rollAy : dy, az = r.rollHas ? r.rollAz : cz;
  host.paintStrip(r.id, r.team, ax, ay, az, cx, dy, cz, rad, r.rollSeed);
  r.rollAx = cx; r.rollAy = dy; r.rollAz = cz; r.rollHas = true;
  // tank per metre actually rolled
  r.rollMetres += dist;
  r.tank = Math.max(0, r.tank - f.tankPerMetre * dist);
  tankLowCheck(r, host);
  // flatten: an enemy capsule overlapping [0, flattenReach] ahead of the drum line, within the drum width
  const R = host.runners;
  for (let i = 0; i < R.length; i++) {
    const v = R[i];
    if (!v.alive || v.team === r.team || v.leaping) continue;
    const ex = v.x - dx, ez = v.z - dz;
    const along = ex * fx + ez * fz;
    if (along + HITBOX.radius < 0 || along - HITBOX.radius > f.flattenReach) continue;
    if (Math.abs(ex * rx + ez * rz) > hw) continue;
    if (v.y < dy - 0.8 || v.y > dy + 1.0) continue;
    if (!host.lineClear(dx, dy + 0.4, dz, v.x, v.y + 0.4, v.z)) continue;
    r.flattens++;
    host.damage(v, r.id, f.flattenDamage, v.x, v.y + 0.3, v.z, 'dye');
  }
}

// ── NEEDLE-GLINT (charge) ───────────────────────────────────────────────────────────────────

/**
 * Hold → charge += dt / chargeSeconds (capped by what the tank can pay), a 'glint' every KITS.glintEvery.
 * Release ≥ KITS.minReleaseCharge → one hitscan beam. Losing the ability to fire drops the charge unfired.
 */
export function stepCharge(r: Runner, intent: PlayerIntent, dt: number, f: ChargeFire, host: KitHost): void {
  r.firing = false;
  r.dryCd = Math.max(0, r.dryCd - dt);
  if (!r.canFire()) { r.charging = false; r.charge = 0; r.prevFireHeld = false; return; }
  const held = !!intent.fire;
  if (held) {
    if (!r.charging) {
      if (r.tank < f.tankMin) { dryClick(r, host); r.prevFireHeld = true; return; }
      r.charging = true; r.charge = 0; r.glintT = 0;
    }
    const span = f.tankFull - f.tankMin;
    const cap = span > 1e-9 ? Math.min(1, Math.max(0, (r.tank - f.tankMin) / span)) : 1;
    let c = r.charge + dt / Math.max(1e-6, f.chargeSeconds);
    if (c > 1 - 1e-6) c = 1;
    r.charge = Math.min(c, cap);
    r.firing = true;
    // first glint on the first charging tick, then one every glintEvery (check, then count down)
    if (r.glintT <= 1e-9) {
      r.glintT += KITS.glintEvery;
      const cp = Math.cos(r.aimPitch);
      host.emit({ t: 'glint', pid: r.id, x: r.x, y: r.y + COMBAT.muzzleHeight, z: r.z,
        dx: Math.sin(r.aimYaw) * cp, dy: Math.sin(r.aimPitch), dz: Math.cos(r.aimYaw) * cp, charge: r.charge });
    }
    r.glintT -= dt;
  } else if (r.charging) {
    const c = r.charge;
    r.charging = false; r.charge = 0;
    if (c >= KITS.minReleaseCharge - 1e-9) fireBeam(r, f, c, host);
  }
  r.prevFireHeld = held;
}

function fireBeam(r: Runner, f: ChargeFire, c: number, host: KitHost): void {
  const ph = host.physics;
  const L = f.minRange + (f.maxRange - f.minRange) * c;
  const dmg = f.damageMin + (f.damageFull - f.damageMin) * c;
  const cost = f.tankMin + (f.tankFull - f.tankMin) * c;
  const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
  const cp = Math.cos(r.aimPitch);
  const dx = Math.sin(r.aimYaw) * cp, dy = Math.sin(r.aimPitch), dz = Math.cos(r.aimYaw) * cp;
  const map = ph.raycast(ox, oy, oz, dx, dy, dz, L);
  let end = map ? map.toi : L;
  let victim: Runner | null = null;
  const R = host.runners;
  for (let i = 0; i < R.length; i++) {
    const v = R[i];
    if (!v.alive || v.team === r.team || v.id === r.id) continue;
    const h = v.hitHeight();
    const rad = Math.min(HITBOX.radius, h * 0.5);
    const t = segVerticalCapsuleT(ox, oy, oz, dx * L, dy * L, dz * L, v.x, v.y + rad, v.z, h - 2 * rad, rad);
    if (t >= 0 && t * L <= end) { end = t * L; victim = v; }
  }
  const ex = ox + dx * end, ey = oy + dy * end, ez = oz + dz * end;
  r.tank = Math.max(0, r.tank - cost);
  r.shots++;
  r.beams++;
  host.emit({ t: 'shot', pid: r.id, kit: r.kit, x: ox, y: oy, z: oz, dx, dy, dz });
  host.emit({ t: 'beam', pid: r.id, x0: ox, y0: oy, z0: oz, x1: ex, y1: ey, z1: ez, charge: c });
  if (victim) host.damage(victim, r.id, dmg, ex, ey, ez, 'dye');
  // the line: a splat every lineSpacing along the beam, dropped straight down onto the floor
  const base = hash32(host.seedWord, r.id, 0xbea0 + r.shots);
  let k = 0;
  for (let s = f.lineSpacing; s < end - 1e-6; s += f.lineSpacing) {
    const g = ph.raycast(ox + dx * s, oy + dy * s, oz + dz * s, 0, -1, 0, COMBAT.dripMaxDrop);
    k++;
    if (g) host.paint(r.id, r.team, g.x, g.y, g.z, f.lineRadius, g.nx, g.ny, g.nz, -0.1, hash32(base, k));
  }
  // the end splat: at the map hit (thin-wall rule), else on the floor under the end point / the victim
  const es = hash32(base, 0xe0d);
  if (map && !victim) {
    paintImpact(host, r.id, r.team, map.x, map.y, map.z, map.nx, map.ny, map.nz, f.endRadius, es, dx, dz);
  } else {
    const g = ph.raycast(ex, ey, ez, 0, -1, 0, COMBAT.dripMaxDrop);
    if (g) host.paint(r.id, r.team, g.x, g.y, g.z, f.endRadius, g.nx, g.ny, g.nz, -0.1, es);
  }
  tankLowCheck(r, host);
}

// ── POP-WELL (burst) ────────────────────────────────────────────────────────────────────────

/** Held → shotsPerSecond straight bursts (kind 2) along the aim; each costs tankPerShot. */
export function stepBurst(r: Runner, intent: PlayerIntent, dt: number, f: BurstFire, variant: number, host: KitHost): void {
  r.firing = false;
  r.dryCd = Math.max(0, r.dryCd - dt);
  const held = !!intent.fire && r.canFire();
  if (!held) { r.fireCd = Math.max(0, r.fireCd - dt); return; }
  r.fireCd -= dt;
  if (r.tank < f.tankPerShot) { dryClick(r, host); r.fireCd = Math.max(0, r.fireCd); return; }
  r.firing = true;
  const period = 1 / f.shotsPerSecond;
  let guard = 3;
  while (r.fireCd <= 1e-9 && guard-- > 0) {
    if (r.tank < f.tankPerShot) { dryClick(r, host); r.fireCd = Math.max(0, r.fireCd); break; }
    const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
    const cp = Math.cos(r.aimPitch);
    const dx = Math.sin(r.aimYaw) * cp, dy = Math.sin(r.aimPitch), dz = Math.cos(r.aimYaw) * cp;
    const sp = f.projectileSpeed;
    host.pool.spawn(KIND_BURST, r.id, r.team, ox, oy, oz, dx * sp, dy * sp, dz * sp, hash32(host.seedWord, r.id, r.shots), 0, variant);
    r.tank = Math.max(0, r.tank - f.tankPerShot);
    r.shots++;
    r.bursts++;
    host.emit({ t: 'shot', pid: r.id, kit: r.kit, x: ox, y: oy, z: oz, dx, dy, dz });
    tankLowCheck(r, host);
    r.fireCd += period;
  }
}

/** Distance from (x, y, z) to `v`'s hit-capsule axis (splash / blast / core falloff measure). */
export function axisDistance(v: Runner, x: number, y: number, z: number): number {
  const h = v.hitHeight();
  const rad = Math.min(HITBOX.radius, h * 0.5);
  const y0 = v.y + rad, y1 = v.y + h - rad;
  const cy = y < y0 ? y0 : y > y1 ? y1 : y;
  return Math.hypot(x - v.x, y - cy, z - v.z);
}
