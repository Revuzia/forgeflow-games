// DYEFIELD — typed phase-6 kit / sub / special definitions parsed from data/weapons.json (CONTRACT §10.2
// CHANGED(KITSIM), CONTRACT_P6_11 §18.1). THREE-free, DOM-free, deterministic.
//
// weapons.json is the only source of kit numbers; config.ts KITS holds the geometric / feel knobs the data
// leaves open. A missing or non-numeric field throws at parse time (never a silent default), except the
// optional `moveSpeedWhileFiring` of roll / burst kits (1 when absent).

import { WEAPONS } from '../data.ts';
import { COMBAT, KITS } from '../config.ts';
import { DEG } from '../types.ts';
import {
  KIND_BURST, KIND_CLOUD, KIND_FLICK, KIND_JELLY, MODE_BURST, MODE_DROPLET, MODE_LANDER, type ProjectileKind,
} from './projectiles.ts';

type Obj = Record<string, unknown>;

export function num(o: Obj, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`weapons.json ${where}.${key} missing or not a number`);
  return v;
}

function optNum(o: Obj, key: string, d: number): number {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** SHEET-DRUM style: roll a floor strip, flatten, flick. */
export interface RollFire {
  type: 'roll';
  kit: string;
  rollWidth: number; rollSpeed: number; tankPerMetre: number; flattenDamage: number; flattenReach: number;
  windup: number; cooldown: number; flickTankCost: number; splats: number; reach: number;
  damageNear: number; damageFar: number; flickPaintRadius: number;
  /** launch pitch (rad) of flick droplet j at level aim: it lands reach·(j+1)/splats out on level floor */
  flickPitch: number[];
  moveSpeedWhileFiring: number;
}

/** NEEDLE-GLINT style: hold to charge, release a hitscan beam. */
export interface ChargeFire {
  type: 'charge';
  kit: string;
  chargeSeconds: number; minRange: number; maxRange: number; damageMin: number; damageFull: number;
  tankMin: number; tankFull: number;
  /** = moveSpeedWhileCharging (the runner's speed factor while fire is held) */
  moveSpeedWhileFiring: number;
  lineSpacing: number; lineRadius: number; endRadius: number;
}

/** POP-WELL style: slow exploding bursts. */
export interface BurstFire {
  type: 'burst';
  kit: string;
  shotsPerSecond: number; tankPerShot: number; projectileSpeed: number; maxRange: number; airburstAtMaxRange: boolean;
  directDamage: number; splashDamage: number; splashRadius: number; impactRadius: number; airburstRadius: number;
  moveSpeedWhileFiring: number;
}

/** JELLY CHARGE (weapons.json subs[]). */
export interface JellyDef {
  id: string; name: string;
  tankCost: number; throwSpeed: number; gravity: number; puddleFuse: number; blastRadius: number;
  damageCenter: number; damageEdge: number; paintRadius: number;
}

export interface CloudDef {
  type: 'cloudburst'; id: string; name: string; chargePoints: number;
  throwRange: number; hoverHeight: number; duration: number; soakRadius: number; dropsPerSecond: number;
  dropPaintRadius: number; damagePerSecond: number;
}

export interface WellDef {
  type: 'wellspring'; id: string; name: string; chargePoints: number;
  leapHeight: number; ringRadius: number; ringWidth: number; coreDamage: number; coreRadius: number; knockback: number;
}

export type SpecialDef = CloudDef | WellDef;

// ── flick fan ─────────────────────────────────────────────────────────────────────────────────

/** Level-floor range of a droplet launched at pitch θ, speed v, gravity g, from h above the floor (no drag). */
export function flickRange(theta: number, v: number, g: number, h: number): number {
  const vy = v * Math.sin(theta);
  const t = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
  return v * Math.cos(theta) * t;
}

/** Pitches (rad, low arc) so droplet j lands reach·(j+1)/n out on level floor. Beyond the max range: the optimum pitch. */
export function flickPitches(n: number, reach: number, v: number, g: number, h: number): number[] {
  let best = 0, bestR = -1;
  for (let a = -10; a <= 60; a += 0.25) {
    const r = flickRange(a * DEG, v, g, h);
    if (r > bestR) { bestR = r; best = a * DEG; }
  }
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const d = reach * (j + 1) / n;
    if (d >= bestR) { out.push(best); continue; }
    let lo = -85 * DEG, hi = best;
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (flickRange(mid, v, g, h) < d) lo = mid; else hi = mid;
    }
    out.push(0.5 * (lo + hi));
  }
  return out;
}

// ── parsers ───────────────────────────────────────────────────────────────────────────────────

export function parseRoll(id: string, fire: Obj): RollFire {
  const w = `kits[${id}].fire`;
  const fl = (fire['flick'] ?? {}) as Obj;
  const wf = `${w}.flick`;
  const splats = Math.max(1, Math.round(num(fl, 'splats', wf)));
  const reach = num(fl, 'reach', wf);
  return {
    type: 'roll', kit: id,
    rollWidth: num(fire, 'rollWidth', w), rollSpeed: num(fire, 'rollSpeed', w), tankPerMetre: num(fire, 'tankPerMetre', w),
    flattenDamage: num(fire, 'flattenDamage', w), flattenReach: num(fire, 'flattenReach', w),
    windup: num(fl, 'windup', wf), cooldown: num(fl, 'cooldown', wf), flickTankCost: num(fl, 'tankCost', wf),
    splats, reach, damageNear: num(fl, 'damageNear', wf), damageFar: num(fl, 'damageFar', wf),
    flickPaintRadius: num(fl, 'paintRadius', wf),
    flickPitch: flickPitches(splats, reach, KITS.flickSpeed, KITS.flickGravity, COMBAT.muzzleHeight),
    moveSpeedWhileFiring: optNum(fire, 'moveSpeedWhileFiring', 1),
  };
}

export function parseCharge(id: string, fire: Obj): ChargeFire {
  const w = `kits[${id}].fire`;
  const paint = (fire['paint'] ?? {}) as Obj;
  return {
    type: 'charge', kit: id,
    chargeSeconds: num(fire, 'chargeSeconds', w), minRange: num(fire, 'minRange', w), maxRange: num(fire, 'maxRange', w),
    damageMin: num(fire, 'damageMin', w), damageFull: num(fire, 'damageFull', w),
    tankMin: num(fire, 'tankMin', w), tankFull: num(fire, 'tankFull', w),
    moveSpeedWhileFiring: num(fire, 'moveSpeedWhileCharging', w),
    lineSpacing: num(paint, 'lineSpacing', `${w}.paint`), lineRadius: num(paint, 'lineRadius', `${w}.paint`),
    endRadius: num(paint, 'endRadius', `${w}.paint`),
  };
}

export function parseBurst(id: string, fire: Obj): BurstFire {
  const w = `kits[${id}].fire`;
  const paint = (fire['paint'] ?? {}) as Obj;
  return {
    type: 'burst', kit: id,
    shotsPerSecond: num(fire, 'shotsPerSecond', w), tankPerShot: num(fire, 'tankPerShot', w),
    projectileSpeed: num(fire, 'projectileSpeed', w), maxRange: num(fire, 'maxRange', w),
    airburstAtMaxRange: fire['airburstAtMaxRange'] === true,
    directDamage: num(fire, 'directDamage', w), splashDamage: num(fire, 'splashDamage', w), splashRadius: num(fire, 'splashRadius', w),
    impactRadius: num(paint, 'impactRadius', `${w}.paint`), airburstRadius: num(paint, 'airburstRadius', `${w}.paint`),
    moveSpeedWhileFiring: optNum(fire, 'moveSpeedWhileFiring', 1),
  };
}

const subCache = new Map<string, JellyDef | null>();
/** The sub a kit names (only 'jelly-charge' style subs exist); null = none / unknown. */
export function jellyDef(subId: string): JellyDef | null {
  if (subCache.has(subId)) return subCache.get(subId) ?? null;
  const row = WEAPONS.subs.find((s) => s.id === subId) as Obj | undefined;
  let out: JellyDef | null = null;
  if (row) {
    const w = `subs[${subId}]`;
    out = {
      id: subId, name: String(row['name'] ?? subId),
      tankCost: num(row, 'tankCost', w), throwSpeed: num(row, 'throwSpeed', w), gravity: num(row, 'gravity', w),
      puddleFuse: num(row, 'puddleFuse', w), blastRadius: num(row, 'blastRadius', w),
      damageCenter: num(row, 'damageCenter', w), damageEdge: num(row, 'damageEdge', w), paintRadius: num(row, 'paintRadius', w),
    };
  }
  subCache.set(subId, out);
  return out;
}

const specialCache = new Map<string, SpecialDef | null>();
/** The special a kit names ('cloudburst' / 'wellspring' by id); null = none / unknown. */
export function specialDef(specialId: string): SpecialDef | null {
  if (specialCache.has(specialId)) return specialCache.get(specialId) ?? null;
  const row = WEAPONS.specials.find((s) => s.id === specialId) as Obj | undefined;
  let out: SpecialDef | null = null;
  if (row) {
    const w = `specials[${specialId}]`;
    const name = String(row['name'] ?? specialId);
    if (specialId === 'cloudburst') {
      out = {
        type: 'cloudburst', id: specialId, name, chargePoints: num(row, 'chargePoints', w),
        throwRange: num(row, 'throwRange', w), hoverHeight: num(row, 'hoverHeight', w), duration: num(row, 'duration', w),
        soakRadius: num(row, 'soakRadius', w), dropsPerSecond: num(row, 'dropsPerSecond', w),
        dropPaintRadius: num(row, 'dropPaintRadius', w), damagePerSecond: num(row, 'damagePerSecond', w),
      };
    } else if (specialId === 'wellspring') {
      out = {
        type: 'wellspring', id: specialId, name, chargePoints: num(row, 'chargePoints', w),
        leapHeight: num(row, 'leapHeight', w), ringRadius: num(row, 'ringRadius', w), ringWidth: num(row, 'ringWidth', w),
        coreDamage: num(row, 'coreDamage', w), coreRadius: num(row, 'coreRadius', w), knockback: num(row, 'knockback', w),
      };
    }
  }
  specialCache.set(specialId, out);
  return out;
}

// ── projectile variants ──────────────────────────────────────────────────────────────────────

/** kind 1: flick droplets — ballistic (no drag), damage falls from damageNear to damageFar over `reach`. */
export function flickKind(f: RollFire): ProjectileKind {
  return {
    damage: f.damageNear, damageFar: f.damageFar, falloffRange: f.reach,
    straightTime: 0, gravity: KITS.flickGravity, drag: 0,
    impactRadius: f.flickPaintRadius, dripEvery: 0, dripRadius: 0, maxLife: COMBAT.maxLife, mode: MODE_DROPLET,
  };
}

/** kind 2: bursts — straight, explode on contact or at maxRange (airburstAtMaxRange). */
export function burstKind(f: BurstFire): ProjectileKind {
  const straight = !f.airburstAtMaxRange;
  return {
    damage: f.directDamage, straightTime: straight ? f.maxRange / Math.max(1e-3, f.projectileSpeed) : 0,
    gravity: straight ? KITS.burstFallGravity : 0, drag: 0,
    impactRadius: f.impactRadius, dripEvery: 0, dripRadius: 0, maxLife: COMBAT.maxLife, mode: MODE_BURST,
    airburstRange: f.airburstAtMaxRange ? f.maxRange : 0,
  };
}

/** kind 3: the thrown jelly (lands, then the host runs the puddle fuse). */
export function jellyKind(s: JellyDef): ProjectileKind {
  return {
    damage: 0, straightTime: 0, gravity: s.gravity, drag: 0,
    impactRadius: s.paintRadius, dripEvery: 0, dripRadius: 0, maxLife: 4, mode: MODE_LANDER,
  };
}

/** kind 4: the thrown CLOUDBURST cell (lands, then the host runs rise + rain). */
export function cloudKind(_c: CloudDef): ProjectileKind {
  return {
    damage: 0, straightTime: 0, gravity: KITS.cloudGravity, drag: 0,
    impactRadius: 0, dripEvery: 0, dripRadius: 0, maxLife: 5, mode: MODE_LANDER,
  };
}

export { KIND_FLICK, KIND_BURST, KIND_JELLY, KIND_CLOUD };
