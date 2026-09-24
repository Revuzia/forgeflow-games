// BLOCKTOOTH — titan simulation (CONTRACT §3, §5.3, §8). Lane: titan-sim.
// THREE-free, DOM-free, deterministic (no Math.random / clocks; randomness only via world.rng).
//
// Contract exports: createTitan, stepTitan, hurtTitan, healTitan, gainXp, gainMass, titanMaxSpeed.
// Lane extras: gainGrowth (the 'mass' upgrade action), growToRank (dev cheat), paceMul, refundDash,
// dashRechargeS.
//
// GROWTH (2026-09-24): SIZE is driven by LEVEL. gainXp is the only growth path — every level-up
// steps the body up (config titanHeightAt, tweened over LEVEL_GROW_S) and reaching RANK_LEVELS[r]
// is the MASS BREACH (rankUp, GROW_TWEEN_S). The pacing rubber band (catch-up + Size V governor)
// acts on growth XP. gainMass is retired (kept as a no-op export for the pickup lane); titan.mass
// is a mirror of SIZE progress (config sizeMassMirror) for views that still read it.
//
// Sim-private per-titan state lives in titan.kit under `sim_*` keys (plain numbers, so it is part of
// the deterministic state and visible to debug tools). Kits may WRITE two hint keys that this module
// reads on the next tick:  kit.sim_moveMul (own-speed multiplier, default 1) and
// kit.sim_faceH / kit.sim_faceT (heading to swivel toward while idle, and for how long).

import type { DamageKind, DamageOpts, Enemy, TitanDef, TitanState, Tier, World } from '../core/types.ts';
import {
  AHEAD_FROM_RANK, AHEAD_GRACE_S, AHEAD_MIN, AHEAD_PER_MIN, CATCHUP_MAX, CATCHUP_PER_MIN, CRUSH_RATIO, GROW_TWEEN_S, LEVEL_GROW_S,
  RANKS, RANK_LEVELS, RANK_SCHEDULE_S, SMASH_MIN_SPEED_FRAC, SMASH_SLOW, TIERS, TITAN, TITAN_RADIUS_PER_H, cumXpAt, sizeMassMirror,
  titanHeightAt, titanSpeed, xpToNext,
} from '../core/config.ts';
import { clamp, easeOutBack, headingOf, segDist, turnToward, wrapAngle } from '../core/math.ts';
import { buildingsInRect, damageBuilding, damageProp, propsInRect, resolveCircleVsCity } from '../city/citysim.ts';
import { enemiesInCircle } from '../combat/spatial.ts';
import { killEnemy } from '../combat/damage.ts';
import { ENEMIES } from '../data/enemies.ts';
import { recomputeStats, stat } from '../upgrades/stats.ts';
import { initKit, kitMassMul, kitOnDash, kitOnHurt, stepKit } from './kits/index.ts';
import { distToBuilding, propRadius } from './kits/common.ts';

// ─────────────────────────────── tuning (balance gate tunes these) ───────────────────────────────
/** seconds to reach full speed from rest, per rank (snappy at Size I, weighty at V) */
const ACCEL_REACH_S = [0.12, 0.16, 0.2, 0.25, 0.3] as const;
/** braking is this much stronger than accelerating */
const DECEL_MUL = 1.6;
/** turn rate (rad/s) at Size I and Size V, linear across ranks */
const TURN_RATE_I = 10;
const TURN_RATE_V = 5;
/** turn-rate multiplier while dashing, and while swivelling to face an auto target at rest */
const DASH_TURN_MUL = 3;
const IDLE_FACE_TURN_MUL = 0.6;
/** own speed while the body still faces away from the stick (1 = none); gives the pivot weight */
const FACING_MIN = 0.7;
const INPUT_DEADZONE = 0.1;
/** one dash charge recharges in this × dashCooldown seconds; cooldown multipliers floor at 0.35× */
const DASH_RECHARGE_S = 3;
const COOLDOWN_FLOOR = 0.35;
/** a footstep every STRIDE_PER_H body-heights of travel */
const STRIDE_PER_H = 0.9;
/** contact smash: DPS = TIERS[canFlatten].floorHp × SMASH_DPS_FLOORS × smashDamage (× dash mul) */
const SMASH_DPS_FLOORS = 6;
const DASH_SMASH_MUL = 2;
/** contact reach beyond the collision radius (fraction of H) */
const CONTACT_SKIN_PER_H = 0.06;
/** `smash` juice events at most this often */
const SMASH_EVENT_EVERY_S = 0.12;
/** plow slow persists this long after the last flattenable overlap (no speed flicker) */
const PLOW_HOLD_S = 0.15;
/** pressing against an oversize building: `bump` re-arms after this long / after leaving contact */
const BUMP_REARM_S = 0.8;
const PRESS_HOLD_S = 0.2;
/** crush needs the titan moving at least this fraction of max speed (or dashing) */
const CRUSH_MIN_SPEED_FRAC = 0.15;
/** airborne enemies above this fraction of H are out of stomping reach */
const CRUSH_MAX_Y_PER_H = 0.35;
/** own move speed while a winch leash is attached (the pull is added on top) … */
const LEASH_OWN_SPEED_MUL = 0.55;
/** … but never below this × the pull strength, so walking straight away always (slowly) wins */
const LEASH_RESIST_MIN = 1.15;
/** rank-up: current hp keeps its ratio, then heals this fraction of the new max */
const RANKUP_HEAL_FRAC = 0.15;
/** outside a tween the body eases toward its target at this rate (1/s) — only a safety net: every
 *  height change (level-up, rank-up) starts a tween */
const HEIGHT_EASE_RATE = 5;
/** safety caps */
const MAX_SUBSTEPS = 8;
/** Wedge escape: a titan that wants to move but has not budged (< PIN_MOVE_FRAC of its walk
 *  distance) for PIN_S while buildings push it — e.g. it swelled inside a crack between three
 *  towers it cannot flatten yet — squeezes: city collision uses radius × PIN_SQUEEZE until it has
 *  moved one body radius or SQUEEZE_S passes. (Measured: a Size III VOLT-KITE sat wedged for 18 s
 *  under tank fire and died — the only death before the elite window in a 36-run sweep.) */
const PIN_S = 0.5, PIN_MOVE_FRAC = 0.05, PIN_SQUEEZE = 0.7, SQUEEZE_S = 1.5;
const MAX_LEVELUPS_PER_CALL = 60;

// scratch (no per-tick allocation)
const idBuf: number[] = [];
const enemyBuf: Enemy[] = [];
const pushOut = { x: 0, z: 0, bumpTier: -1 };
const SMASH_OPTS: DamageOpts = { src: 'titan', kind: 'smash' };

// ─────────────────────────────── construction ───────────────────────────────
export function createTitan(def: TitanDef, spawn: { x: number; z: number; heading: number }): TitanState {
  const h = titanHeightAt(0, 1);
  const kit: Record<string, number> = {
    sim_vx: 0, sim_vz: 0,                 // own (input-driven) velocity, before leash/collision
    sim_plowT: 0, sim_pressT: 0,          // >0 while grinding flattenable / pressing oversize buildings
    sim_steps: 0,                         // cumulative footsteps (MOLO foot-pulse reads it)
    sim_sinceHurt: 99,                    // seconds since the last damage (regen gate)
    sim_growFrom: h,                      // height at the start of the running grow tween
    sim_growDur: GROW_TWEEN_S,            // length of the running grow tween (rank-up or level-up)
    sim_smashCd: 0, sim_bumpCd: 0, sim_bumping: 0,
    sim_dashX0: spawn.x, sim_dashZ0: spawn.z, sim_dashSp: 0, sim_dashLeft: 0,
    sim_leashX: 0, sim_leashZ: 0,
    sim_moveMul: 1, sim_faceH: spawn.heading, sim_faceT: 0,
    ...initKit(def.id),
  };
  return {
    id: def.id,
    x: spawn.x, z: spawn.z, heading: spawn.heading,
    px: spawn.x, pz: spawn.z, pheading: spawn.heading,
    vx: 0, vz: 0, speed: 0, moving: false,
    hp: def.base.maxHp, maxHp: def.base.maxHp,
    level: 1, xp: 0, xpToNext: xpToNext(1),
    mass: sizeMassMirror(0, 1, 0),        // mirror of SIZE progress (config sizeMassMirror)
    rank: 0,
    height: h,
    radius: h * TITAN_RADIUS_PER_H,
    growT: 0,
    dashCharges: Math.max(0, Math.round(def.base.dashCharges)), dashRecharge: 0, dashT: 0,
    dashDirX: Math.sin(spawn.heading), dashDirZ: Math.cos(spawn.heading),
    iframeT: 0,
    abilityCd: 0,
    autoCd: 0,
    stepAcc: 0,
    slowT: 0, slowMul: 1,
    leash: null,
    stats: { ...def.base },               // recomputeStats(w) fills the real block right after createWorld
    kit,
    alive: true,
    kills: 0, crushed: 0, floorsEaten: 0, buildingsLeveled: 0, propsEaten: 0,
    damageTaken: 0,
  };
}

// ─────────────────────────────── queries ───────────────────────────────
/** Unslowed top speed (m/s) for the current body: titanSpeed(H) × moveSpeed × rank speedMul. */
export function titanMaxSpeed(w: World): number {
  const T = w.titan;
  const ms = stat(w, 'moveSpeed');
  return titanSpeed(T.height) * Math.max(0.1, Number.isFinite(ms) ? ms : 1) * RANKS[T.rank].speedMul;
}

/** Seconds one dash charge takes to recharge right now (DASH_RECHARGE_S × dashCooldown, floored). */
export function dashRechargeS(w: World): number {
  const cd = stat(w, 'dashCooldown');
  return DASH_RECHARGE_S * Math.max(COOLDOWN_FLOOR, Number.isFinite(cd) ? cd : 1);
}

/** Bank every whole charge the recharge counter has earned (the remainder keeps counting). */
function settleRecharge(w: World, maxCharges: number): void {
  const T = w.titan, per = dashRechargeS(w);
  while (T.dashRecharge >= per && T.dashCharges < maxCharges) { T.dashCharges += 1; T.dashRecharge -= per; }
  if (T.dashCharges >= maxCharges) T.dashRecharge = 0;
}

/**
 * Upgrade dash refund (engine 'dashRefund'): pays `frac` of one charge's recharge time into the
 * recharge counter (frac 1 = a whole charge). Refunds are recharge, not free charges: a card that
 * handed out whole charges on every dash/hook let VOLT-KITE dash out of every boss tell and every
 * dash-follow answer for the whole fight (the charges never ran dry — see config.ts BOSS rows).
 * Returns false (nothing happened) when the pool is already full.
 */
export function refundDash(w: World, frac = 1): boolean {
  const T = w.titan;
  const maxCharges = Math.max(0, Math.floor(stat(w, 'dashCharges')));
  if (!T.alive || T.dashCharges >= maxCharges || !(frac > 0)) return false;
  T.dashRecharge += Math.min(1, frac) * dashRechargeS(w);
  settleRecharge(w, maxCharges);
  return true;
}

function num(v: number | undefined, d: number): number { return v === undefined || !Number.isFinite(v) ? d : v; }

// ─────────────────────────────── the tick ───────────────────────────────
export function stepTitan(w: World): void {
  const T = w.titan;
  const K = T.kit;
  const dt = w.dt;
  if (!T.alive) {
    T.vx = 0; T.vz = 0; T.speed = 0; T.moving = false; K.sim_vx = 0; K.sim_vz = 0;
    return;
  }

  // ── timers ──
  T.iframeT = Math.max(0, T.iframeT - dt);
  K.sim_dashIfrT = Math.max(0, num(K.sim_dashIfrT, 0) - dt);
  if (T.slowT > 0) { T.slowT -= dt; if (T.slowT <= 0) { T.slowT = 0; T.slowMul = 1; } }
  else T.slowMul = 1;
  K.sim_sinceHurt = num(K.sim_sinceHurt, 99) + dt;
  K.sim_smashCd = Math.max(0, num(K.sim_smashCd, 0) - dt);
  K.sim_bumpCd = Math.max(0, num(K.sim_bumpCd, 0) - dt);
  K.sim_plowT = Math.max(0, num(K.sim_plowT, 0) - dt);
  K.sim_pressT = Math.max(0, num(K.sim_pressT, 0) - dt);
  K.sim_faceT = Math.max(0, num(K.sim_faceT, 0) - dt);

  // ── dash charges ──
  const maxCharges = Math.max(0, Math.round(stat(w, 'dashCharges')));
  if (T.dashCharges > maxCharges) T.dashCharges = maxCharges;
  if (T.dashCharges < maxCharges) {
    T.dashRecharge += dt;                          // counts UP toward dashRechargeS(w)
    settleRecharge(w, maxCharges);
  } else T.dashRecharge = 0;

  // ── body size (level-up / rank-up grow tween) ──
  updateHeight(w, dt);
  const H = T.height;
  const rank = T.rank;
  const canFlatten = RANKS[rank].canFlatten;
  const maxSp = titanMaxSpeed(w);

  // ── input ──
  let mx = Number.isFinite(w.input.mx) ? w.input.mx : 0;
  let mz = Number.isFinite(w.input.mz) ? w.input.mz : 0;
  let m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; m = 1; }
  T.moving = m > INPUT_DEADZONE;
  if (!T.moving) { mx = 0; mz = 0; m = 0; }

  // ── dash start ──
  if (w.input.dash && T.dashT <= 0 && T.dashCharges >= 1) {
    let ddx = mx, ddz = mz;
    if (m <= INPUT_DEADZONE) { ddx = Math.sin(T.heading); ddz = Math.cos(T.heading); }
    const dl = Math.hypot(ddx, ddz) || 1;
    ddx /= dl; ddz /= dl;
    const distM = Math.max(0, stat(w, 'dashDistance')) * H;
    T.dashCharges -= 1;
    T.dashT = TITAN.dashS;
    T.dashDirX = ddx; T.dashDirZ = ddz;
    T.iframeT = Math.max(T.iframeT, TITAN.dashIframes);
    K.sim_dashIfrT = TITAN.dashIframes;            // dash-only i-frames (damage-over-time respects these)
    K.sim_dashX0 = T.x; K.sim_dashZ0 = T.z;
    K.sim_dashSp = distM / TITAN.dashS;
    K.sim_dashLeft = distM;                        // exact path budget (the last tick is partial)
    w.events.push({ type: 'dash', x0: T.x, z0: T.z, x1: T.x + ddx * distM, z1: T.z + ddz * distM });
  }
  const dashing = T.dashT > 0;

  // ── heading + own velocity ──
  const turnRate = TURN_RATE_I + (TURN_RATE_V - TURN_RATE_I) * (rank / 4);
  let vx = num(K.sim_vx, 0), vz = num(K.sim_vz, 0);
  if (dashing) {
    T.heading = turnToward(T.heading, headingOf(T.dashDirX, T.dashDirZ), turnRate * DASH_TURN_MUL * dt);
    const left = Math.max(0, num(K.sim_dashLeft, 0));
    const sp = Math.min(num(K.sim_dashSp, 0), left / dt);
    K.sim_dashLeft = left - sp * dt;
    vx = T.dashDirX * sp; vz = T.dashDirZ * sp;
  } else {
    if (T.moving) T.heading = turnToward(T.heading, headingOf(mx, mz), turnRate * dt);
    else if (K.sim_faceT > 0) T.heading = turnToward(T.heading, num(K.sim_faceH, T.heading), turnRate * IDLE_FACE_TURN_MUL * dt);

    if (plowCheck(w, canFlatten, vx * dt, vz * dt)) K.sim_plowT = PLOW_HOLD_S;
    let spMul = 1;
    if (T.slowT > 0) spMul *= clamp(T.slowMul, 0.1, 1);
    if (K.sim_plowT > 0) spMul *= SMASH_SLOW;
    if (T.leash) {
      const pull = Math.max(0, num(T.leash.strength, 0));
      spMul *= Math.max(LEASH_OWN_SPEED_MUL, Math.min(1, (pull * LEASH_RESIST_MIN) / Math.max(1e-3, maxSp)));
    }
    spMul *= clamp(num(K.sim_moveMul, 1), 0, 2);

    let tx = 0, tz = 0;
    if (T.moving) {
      const face = Math.cos(wrapAngle(headingOf(mx, mz) - T.heading));
      const f = FACING_MIN + (1 - FACING_MIN) * Math.max(0, face);
      const s = maxSp * spMul * f;              // mx/mz already carry the stick magnitude
      tx = mx * s; tz = mz * s;
    }
    const accel = maxSp / ACCEL_REACH_S[rank];
    const cur = Math.hypot(vx, vz), tgt = Math.hypot(tx, tz);
    const rate = tgt < cur - 1e-6 ? accel * DECEL_MUL : accel;
    const dvx = tx - vx, dvz = tz - vz;
    const dv = Math.hypot(dvx, dvz), stepV = rate * dt;
    if (dv <= stepV) { vx = tx; vz = tz; }
    else { vx += (dvx / dv) * stepV; vz += (dvz / dv) * stepV; }
  }

  // ── winch leash (CAISSON-4): pull toward the anchor; the player resists by moving away ──
  let lpx = 0, lpz = 0;
  if (T.leash) {
    const L = T.leash;
    L.t -= dt;
    K.sim_leashX = L.lx; K.sim_leashZ = L.lz;
    if (!(L.t > 0)) {
      T.leash = null;
      w.events.push({ type: 'leash', on: false, x: L.lx, z: L.lz });
    } else {
      const ddx = L.lx - T.x, ddz = L.lz - T.z, d = Math.hypot(ddx, ddz);
      if (d > T.radius) { const s = Math.max(0, num(L.strength, 0)); lpx = (ddx / d) * s; lpz = (ddz / d) * s; }
    }
  }

  // ── integrate with city collision (substepped so fast dashes never tunnel) ──
  const x0 = T.x, z0 = T.z;
  const squeezing = num(K.sim_squeezeT, 0) > 0;
  const colR = squeezing ? T.radius * PIN_SQUEEZE : T.radius;
  const dx = (vx + lpx) * dt, dz = (vz + lpz) * dt;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(len / Math.max(0.05, T.radius * 0.5))));
  let pushX = 0, pushZ = 0, bumpTier = -1;
  for (let i = 0; i < n; i++) {
    T.x += dx / n; T.z += dz / n;
    pushOut.x = T.x; pushOut.z = T.z; pushOut.bumpTier = -1;
    if (resolveCircleVsCity(w.city, T.x, T.z, colR, canFlatten, pushOut)) {
      if (Number.isFinite(pushOut.x) && Number.isFinite(pushOut.z)) {
        pushX += pushOut.x - T.x; pushZ += pushOut.z - T.z;
        T.x = pushOut.x; T.z = pushOut.z;
      }
      if (pushOut.bumpTier > bumpTier) bumpTier = pushOut.bumpTier;
    }
  }
  const B = w.city.bounds;
  T.x = clamp(T.x, B.minX, B.maxX);
  T.z = clamp(T.z, B.minZ, B.maxZ);

  // wall slide: drop the own-velocity component driving into whatever pushed us
  const pl = Math.hypot(pushX, pushZ);
  if (pl > 1e-6) {
    const nx = pushX / pl, nz = pushZ / pl, vn = vx * nx + vz * nz;
    if (vn < 0 && !dashing) { vx -= nx * vn; vz -= nz * vn; }
  }
  K.sim_vx = vx; K.sim_vz = vz;
  // wedge detector (see PIN_S)
  if (squeezing) {
    K.sim_squeezeT = num(K.sim_squeezeT, 0) - dt;
    if (Math.hypot(T.x - num(K.sim_pinX, T.x), T.z - num(K.sim_pinZ, T.z)) >= T.radius) K.sim_squeezeT = 0;
    K.sim_pinT = 0;
  } else if (T.moving && !dashing && pl > 1e-6 && Math.hypot(T.x - x0, T.z - z0) < PIN_MOVE_FRAC * maxSp * dt) {
    K.sim_pinT = num(K.sim_pinT, 0) + dt;
    if (K.sim_pinT >= PIN_S) { K.sim_squeezeT = SQUEEZE_S; K.sim_pinX = T.x; K.sim_pinZ = T.z; K.sim_pinT = 0; }
  } else K.sim_pinT = 0;
  T.vx = (T.x - x0) / dt; T.vz = (T.z - z0) / dt;
  T.speed = Math.hypot(T.vx, T.vz);

  // ── bump: first contact with a building/prop too big to flatten ──
  if (bumpTier > canFlatten) {
    K.sim_pressT = PRESS_HOLD_S;
    if (!(K.sim_bumping > 0) && K.sim_bumpCd <= 0 && (T.moving || dashing)) {
      const bx = pl > 1e-6 ? T.x - (pushX / pl) * T.radius : T.x;
      const bz = pl > 1e-6 ? T.z - (pushZ / pl) * T.radius : T.z;
      w.events.push({ type: 'bump', x: bx, z: bz, tier: clamp(Math.round(bumpTier), 0, 4) as Tier });
      K.sim_bumpCd = BUMP_REARM_S;
    }
    K.sim_bumping = 1;
  } else if (K.sim_pressT <= 0) K.sim_bumping = 0;

  // ── contact smash + crush ──
  if (dashing || T.speed >= SMASH_MIN_SPEED_FRAC * maxSp) contactSmash(w, x0, z0, dashing, canFlatten);
  if (dashing || T.speed >= CRUSH_MIN_SPEED_FRAC * maxSp) crush(w);

  // ── footsteps ──
  const moved = Math.hypot(T.x - x0, T.z - z0);
  T.stepAcc += moved;
  const stride = STRIDE_PER_H * H;
  let guard = 0;
  while (T.stepAcc >= stride && guard++ < 4) {
    T.stepAcc -= stride;
    K.sim_steps = num(K.sim_steps, 0) + 1;
    w.events.push({ type: 'footstep', x: T.x, z: T.z, heavy: rank / 4 });
  }
  if (T.stepAcc >= stride) T.stepAcc = 0;

  // ── dash end ──
  if (T.dashT > 0) {
    T.dashT -= dt;
    if (T.dashT <= 0) {
      T.dashT = 0;
      const carry = Math.min(maxSp, num(K.sim_dashSp, 0));
      K.sim_vx = T.dashDirX * carry; K.sim_vz = T.dashDirZ * carry;
      kitOnDash(w, num(K.sim_dashX0, T.x), num(K.sim_dashZ0, T.z), T.x, T.z);
    }
  }

  // ── regen after TITAN.regenDelayS without damage ──
  if (K.sim_sinceHurt >= TITAN.regenDelayS && T.hp < T.maxHp) {
    const r = Math.max(0, stat(w, 'regen')) * RANKS[rank].hpMul;
    T.hp = Math.min(T.maxHp, T.hp + r * dt);
  }

  // ── kit: cooldowns, auto-attack, passives, hook ──
  stepKit(w);
}

// ─────────────────────────────── movement helpers ───────────────────────────────
function updateHeight(w: World, dt: number): void {
  const T = w.titan, K = T.kit;
  const target = titanHeightAt(T.rank, T.level);
  T.mass = sizeMassMirror(T.rank, T.level, T.xp);
  if (T.growT > 0) {
    T.growT = Math.max(0, T.growT - dt);
    const dur = Math.max(1e-3, num(K.sim_growDur, GROW_TWEEN_S));
    const u = clamp(1 - T.growT / dur, 0, 1);
    const from = num(K.sim_growFrom, target);
    T.height = from + (target - from) * easeOutBack(u);
  } else {
    T.height += (target - T.height) * (1 - Math.exp(-HEIGHT_EASE_RATE * dt));
    if (Math.abs(target - T.height) < 1e-5) T.height = target;
  }
  if (!(T.height > 0.05)) T.height = target;
  T.radius = T.height * TITAN_RADIUS_PER_H;
}

/** Contact reach radius for smashing/plowing. */
function contactRadius(w: World): number {
  const T = w.titan;
  return T.radius * Math.max(0.2, stat(w, 'smashRadius')) + CONTACT_SKIN_PER_H * T.height;
}

/** Is the titan (about to be) grinding through a flattenable building? */
function plowCheck(w: World, canFlatten: Tier, ax: number, az: number): boolean {
  const T = w.titan;
  const r = contactRadius(w);
  const x = T.x + ax, z = T.z + az;
  buildingsInRect(w.city, x - r, z - r, x + r, z + r, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const b = w.city.buildings[idBuf[i]];
    if (!b || b.collapsed || b.alive <= 0 || b.tier > canFlatten) continue;
    if (distToBuilding(b, x, z) <= r) return true;
  }
  return false;
}

/** Contact destruction along this tick's path (x0,z0)→(T.x,T.z). */
function contactSmash(w: World, x0: number, z0: number, dashing: boolean, canFlatten: Tier): void {
  const T = w.titan, K = T.kit;
  const r = contactRadius(w);
  const x1 = T.x, z1 = T.z;
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const minX = Math.min(x0, x1) - r, maxX = Math.max(x0, x1) + r;
  const minZ = Math.min(z0, z1) - r, maxZ = Math.max(z0, z1) + r;
  const dps = TIERS[canFlatten].floorHp * SMASH_DPS_FLOORS * Math.max(0, stat(w, 'smashDamage')) * (dashing ? DASH_SMASH_MUL : 1);
  const tickDmg = dps * w.dt;
  const evStart = w.events.length;
  let cnt = 0, sx = 0, sz = 0, tier = 0;

  if (tickDmg > 0) {
    buildingsInRect(w.city, minX, minZ, maxX, maxZ, idBuf);
    for (let i = 0; i < idBuf.length; i++) {
      const id = idBuf[i];
      const b = w.city.buildings[id];
      if (!b || b.collapsed || b.alive <= 0 || b.tier > canFlatten) continue;
      const d = Math.min(distToBuilding(b, x1, z1), distToBuilding(b, mx, mz), distToBuilding(b, x0, z0));
      if (d > r) continue;
      const before = T.floorsEaten;
      const floors = damageBuilding(w, id, tickDmg, SMASH_OPTS);
      if (floors > 0 && T.floorsEaten === before) T.floorsEaten += floors;   // fill-in if the city did not count
      cnt++;
      sx += clamp(x1, b.x - b.w / 2, b.x + b.w / 2);
      sz += clamp(z1, b.z - b.d / 2, b.z + b.d / 2);
      if (b.tier > tier) tier = b.tier;
    }
  }

  propsInRect(w.city, minX, minZ, maxX, maxZ, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const id = idBuf[i];
    const p = w.city.props[id];
    if (!p || !p.alive || p.tier > canFlatten) continue;
    if (segDist(p.x, p.z, x0, z0, x1, z1) > r + propRadius(p)) continue;
    const before = T.propsEaten;
    // small things pop instantly: overkill the prop's remaining hp
    const killed = damageProp(w, id, Math.max(1, p.hp) * 4 + tickDmg, SMASH_OPTS);
    if (killed && T.propsEaten === before) T.propsEaten++;                   // fill-in if the city did not count
    cnt++; sx += p.x; sz += p.z;
    if (p.tier > tier) tier = p.tier;
  }

  if (cnt === 0) return;
  let cityEmitted = false;
  for (let i = evStart; i < w.events.length; i++) if (w.events[i].type === 'smash') { cityEmitted = true; break; }
  if (cityEmitted) { K.sim_smashCd = SMASH_EVENT_EVERY_S; return; }
  if (K.sim_smashCd <= 0) {
    w.events.push({ type: 'smash', x: sx / cnt, z: sz / cnt, tier: tier as Tier });
    K.sim_smashCd = SMASH_EVENT_EVERY_S;
  }
}

/** Step on small crushable enemies (CONTRACT §3 Crush). */
function crush(w: World): void {
  const T = w.titan;
  const hLim = T.height * CRUSH_RATIO;
  const yLim = T.height * CRUSH_MAX_Y_PER_H;
  enemiesInCircle(w, T.x, T.z, T.radius, enemyBuf);
  for (let i = 0; i < enemyBuf.length; i++) {
    const e = enemyBuf[i];
    if (!e.alive || e.elite) continue;
    const def = ENEMIES[e.kind];
    if (!def || !def.crushable) continue;
    if (!(e.height < hLim) || e.y > yLim) continue;
    const k0 = T.kills, c0 = T.crushed;
    killEnemy(w, e, true);
    if (T.crushed === c0) T.crushed++;                                        // fill-in if combat did not count
    if (T.kills === k0) T.kills++;
  }
  enemyBuf.length = 0;
}

// ─────────────────────────────── growth ───────────────────────────────
/**
 * Pacing rubber band on growth XP (config RANK_SCHEDULE_S / CATCHUP_* / AHEAD_*): × up to
 * CATCHUP_MAX while the run is behind the next Size rank's scheduled time; × down to AHEAD_MIN when
 * the XP rate since entering this rank projects the next breach more than AHEAD_GRACE_S[next] early.
 * 1 otherwise (and at Size V).
 */
export function paceMul(w: World): number {
  const T = w.titan;
  const next = T.rank + 1;
  if (next >= RANK_SCHEDULE_S.length) return 1;
  if (w.t > RANK_SCHEDULE_S[next]) {
    const behindMin = (w.t - RANK_SCHEDULE_S[next]) / 60;
    return Math.min(CATCHUP_MAX, 1 + CATCHUP_PER_MIN * behindMin);
  }
  if (next >= AHEAD_FROM_RANK) {
    const inRank = w.t - num(T.kit.sim_rankT0, 0);
    const now = cumXpAt(T.level) + T.xp;
    const got = now - cumXpAt(RANK_LEVELS[T.rank]), need = cumXpAt(RANK_LEVELS[next]) - now;
    if (inRank > 5 && got > 0 && need > 0) {
      const eta = w.t + (need * inRank) / got;
      const earlyMin = (RANK_SCHEDULE_S[next] - (AHEAD_GRACE_S[next] ?? 0) - eta) / 60;
      if (earlyMin > 0) return Math.max(AHEAD_MIN, 1 - AHEAD_PER_MIN * earlyMin);
    }
  }
  return 1;
}

/**
 * Growth XP → the titan. × xpGain × massGain (the "growth" stat) × the kit's growth multiplier (MOLO
 * GULLET VACUUM) × the pacing rubber band (paceMul). Every level-up owes a draft, emits `levelUp` and
 * steps the body up; reaching RANK_LEVELS[r] is the Size-r MASS BREACH (rankUp).
 */
export function gainXp(w: World, xp: number): void {
  const T = w.titan;
  if (!T.alive || !(xp > 0)) return;
  const mul = Math.max(0, stat(w, 'xpGain')) * Math.max(0, stat(w, 'massGain')) * kitMassMul(w) * paceMul(w);
  addXp(w, xp * mul);
}

/** Upgrade 'mass' action ("grow"): `frac` of the CURRENT level's XP bar, exactly — no multipliers and
 *  no rubber band, so the card text is the effect at every size. May level up (and rank up). */
export function gainGrowth(w: World, frac: number): void {
  const T = w.titan;
  if (!T.alive || !(frac > 0) || !Number.isFinite(frac)) return;
  addXp(w, frac * T.xpToNext);
}

/** RETIRED (2026-09-24): SIZE comes from LEVEL now, so loot mass grows nothing. Kept (a no-op) because
 *  the pickup lane's collect() still calls it; loot mass only sizes the pickup meshes (config lootMass,
 *  KILL_MASS_RANK_MUL). titan.mass is written by updateHeight as a SIZE-progress mirror. */
export function gainMass(_w: World, _mass: number): void {
  // intentionally empty
}

/**
 * Dev cheat (testsurface cheat.rank): jump straight to Size `rank` (and at least `level`, e.g. a fully
 * grown Size V body). The level becomes max(level, RANK_LEVELS[rank], minLevel) with an empty XP bar
 * and NO drafts are owed (a cheat must not queue thirty draft screens); every rank on the way goes
 * through the real rankUp (stats, heal, `rankUp` events, the MASS BREACH tween). Never shrinks.
 * Returns the rank after the call.
 */
export function growToRank(w: World, rank: number, minLevel = 0): number {
  const T = w.titan;
  const want = clamp(Math.floor(Number.isFinite(rank) ? rank : 0), 0, 4);
  const lv = Math.max(T.level, RANK_LEVELS[want], Number.isFinite(minLevel) ? Math.floor(minLevel) : 0);
  if (!T.alive || (want <= T.rank && lv <= T.level)) return T.rank;
  const r0 = T.rank;
  T.level = lv;
  T.xp = 0;
  T.xpToNext = xpToNext(T.level);
  grow(w, r0);
  return T.rank;
}

function addXp(w: World, amount: number): void {
  const T = w.titan;
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  const lv0 = T.level, r0 = T.rank;
  T.xp += amount;
  let n = 0;
  while (T.xp >= T.xpToNext && n++ < MAX_LEVELUPS_PER_CALL) {
    T.xp -= T.xpToNext;
    T.level++;
    T.xpToNext = xpToNext(T.level);
    w.upgrades.pendingDrafts++;
    w.events.push({ type: 'levelUp', level: T.level });
  }
  if (T.xp >= T.xpToNext) T.xp = T.xpToNext - 1e-6;
  if (T.level !== lv0) grow(w, r0);
}

/** After the level changed: rank up through every RANK_LEVELS threshold reached, then start the grow
 *  tween toward titanHeightAt(rank, level) — the long MASS BREACH tween when the rank changed, the
 *  short level step otherwise. A running breach tween is never cut short by a level step. */
function grow(w: World, r0: number): void {
  const T = w.titan, K = T.kit;
  let guard = 0;
  while (T.rank < 4 && T.level >= RANK_LEVELS[T.rank + 1] && guard++ < 5) rankUp(w);
  const dur = Math.max(T.rank !== r0 ? GROW_TWEEN_S : LEVEL_GROW_S, T.growT);
  K.sim_growFrom = T.height;
  K.sim_growDur = dur;
  T.growT = dur;
  T.mass = sizeMassMirror(T.rank, T.level, T.xp);
}

function rankUp(w: World): void {
  const T = w.titan, K = T.kit;
  const ratio = T.maxHp > 0 ? clamp(T.hp / T.maxHp, 0, 1) : 1;
  T.rank = (T.rank + 1) as TitanState['rank'];
  K.sim_rankT0 = w.t;
  recomputeStats(w);
  T.hp = Math.min(T.maxHp, ratio * T.maxHp + RANKUP_HEAL_FRAC * T.maxHp);
  w.events.push({ type: 'rankUp', rank: T.rank });
}

// ─────────────────────────────── damage / heal ───────────────────────────────
/**
 * Hostile damage → the titan. Returns the HP actually lost.
 * `dot` marks a damage-over-time tick (hostile hazards, active telegraph ticks — 5 Hz): a DoT is a
 * RATE, so it ignores the 0.35 s post-hit i-frames (which would otherwise halve every pool/breath)
 * and grants none itself; only DASH i-frames stop it. Discrete hits (dot = false) work as before.
 */
export function hurtTitan(w: World, dmg: number, kind: DamageKind, x: number, z: number, dot = false): number {
  const T = w.titan;
  if (!T.alive || !(dmg > 0) || !Number.isFinite(dmg)) return 0;
  if (w.cheats.god) return 0;
  if (dot ? num(T.kit.sim_dashIfrT, 0) > 0 : T.iframeT > 0) return 0;
  const armor = Math.max(-50, stat(w, 'armor'));
  let d = dmg * (100 / (100 + armor));
  d = kitOnHurt(w, d);
  if (!(d > 0)) return 0;
  const U = w.upgrades;
  if (U.shield > 0) {
    const a = Math.min(U.shield, d);
    U.shield -= a;
    d -= a;
  }
  if (!dot) T.iframeT = TITAN.hurtIframes + Math.max(0, stat(w, 'iframes'));
  T.kit.sim_sinceHurt = 0;
  if (d <= 0) return 0;
  T.hp -= d;
  T.damageTaken += d;
  w.events.push({ type: 'titanHurt', dmg: d, x, z, src: kind });
  if (T.hp <= 0) { T.hp = 0; T.alive = false; T.dashT = 0; T.vx = 0; T.vz = 0; T.speed = 0; }
  return d;
}

export function healTitan(w: World, amount: number): void {
  const T = w.titan;
  if (!T.alive || !(amount > 0) || !Number.isFinite(amount)) return;
  const before = T.hp;
  T.hp = Math.min(T.maxHp, T.hp + amount);
  const healed = T.hp - before;
  if (healed > 0) w.events.push({ type: 'titanHeal', amount: healed });
}
