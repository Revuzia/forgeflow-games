// BLOCKTOOTH v2 — UPROAR, the charged ultimate (FEATURES_V2 §3). SIM: THREE-free, DOM-free, deterministic.
// Lane L1 (ULT-SIM). Exact exports of `ModUltimate` (_spec/features_v2_types.ts).
//
// Call sites (pre-wired by L0, FEATURES_V2 §2.3 / §2.7):
//   * world.ts stepWorld: stepUltimate (after the first rebuildEnemyGrid, BEFORE stepTitan) and
//     chargeUltimate (after processTriggers + stepObjectives + stepPowerups: reads this tick's events);
//   * combat/damage.ts killEnemy: `if (!ultBankKill(w, e.x, e.z, xp, mass)) { …scrap… }`;
//   * titans/titansim.ts: hurtTitan returns 0 while w.ult.invulnT > 0; max speed × ultMoveMul(w);
//   * upgrades/engine.ts execute 'ultCharge' → addUproar (L2's body); meta/powerups.ts (L4) BACK PAY →
//     addUproar(w, ULT.max, true) and DEMOLITION → w.ult.bankOpen around its kill loop.
//
// Life of one UPROAR:
//   idle (charging) ─ E / pad Y / RT while ready ─▶ ROAR (roarS: invulnerable, 30 % move, leash snapped)
//     ─ roar end: hostile NON-boss projectiles + unfired enemy-owned telegraphs inside R deleted ─▶
//   BLAST (blastS: the titan's pulses from data/ultimates.ts + its extras) ─▶ idle, meter frozen until
//   ULT.lockoutS after the fire. Kills while phase !== 'idle' bank their XP × killXpMul (capped per fire at
//   xpCapLevelFrac × the level's XP need); the bank is flushed once per tick as ≤ bankPickupsPerTick
//   merged scrap pickups at the first banked kill positions.
//
// Measured (L1, 2026-09-24, `node _harness/probe_ult.ts`, seed 1337, fresh meta, fire-on-ready bot, the C1 tree with
// GRID-EAST on PARKADE-6). Config ULT starting points gave ready-edge gaps of II 38.8 / III 22.1 / IV 16.2 / V 22.7 s
// and first readiness 87 s (kills + city charge scale with Size; charge by source per minute at Size I–V:
// trickle 34/30/26/22/27, city 18/61/162/253/79, kills 10/72/93/120/118, boss 0/0/0/0/40 — scratch
// _harness/scratch/l1/chargesrc.ts). Tuned in §3.2 order (city rank mul → trickle → kill points) with ULT_CHARGE:
//
//   | quantity (probe_ult H)                | config start | tuned (ULT_CHARGE)  | band             |
//   |---------------------------------------|--------------|---------------------|------------------|
//   | first readiness, median               | 87.4 s       | 57.9 s (50–63)      | target 45–75 s   |
//   | ready-edge gap, Size I / II / III      | — / 38.8 / 22.1 s | 56.9 / 49.3 / 41.5 s | 30–65 s     |
//   | ready-edge gap, Size IV / V            | 16.2 / 22.7 s | 39.0 / 38.4 s      | 30–65 s          |
//   | fires per run (12 runs)               | 18–23        | 11–15               |                  |
//   | boss fight median caisson4/irongully/parkade6 | —     | 133 / 122 / 96 s    | 70–170 s         |
//   | XP share through the bank (GATE 2)    | 8.1 %        | 4.1 %               | reported         |
//   | GATE 2 clears / deaths (fresh = full) | 10/12 · 2 (CAISSON-4 on GRID-EAST) | 8/12 · 4 (PARKADE-6 on GRID-EAST) | ≥ 8/12 · ≥ 1 |
//
// UPROAR takes 12–24 % of a boss per fight (2–4 fires × 6 %); the shortest fight seen is HEARTHBACK vs PARKADE-6
// at 48 s (clear @ 481 s, window floor 480). ULT.bossCapFrac sweep on that tree (_harness/scratch/l1/capsweep.ts,
// GATE-2 matrix, seed 1337): 0.06 → 8/12 clears · 4 deaths · earliest clear 481 s; 0.05 → 10/12 · 2 · 498 s;
// 0.04 → 11/12 · 1 · 498 s. 0.05 has the widest margin on BOTH legs; the constant is config.ts (L0), so the
// change is recommended to the orchestrator, not made here (probe_ult reads ULT.bossCapFrac, so it follows).

import type { DamageKind, DamageOpts, Enemy, Hazard, Shape, Telegraph, UltPulse, UltState, World } from '../core/types.ts';
import { ULT } from '../core/config.ts';
import { spawnRing } from '../ai/director.ts';
import { ULTS } from '../data/ultimates.ts';
import { ENEMIES } from '../data/enemies.ts';
import { damageEnemyFrom, rollCrit, titanDamage } from '../combat/damage.ts';
import { enemiesInCircle, enemiesInShape } from '../combat/spatial.ts';
import { magnetAll, spawnPickup } from '../combat/pickups.ts';
import { spawnHazard } from '../combat/hazards.ts';
import { healTitan } from '../titans/titansim.ts';
import { bossUltHit, releaseLeash } from '../ai/bosses/index.ts';
import { stat } from '../upgrades/stats.ts';
import { VOLT } from '../titans/kits/voltkite.ts';
import { makeRoom, titanHazards } from '../titans/kits/common.ts';

// ─────────────────────────────── lane-local charge tuning (FEATURES_V2 §3.2 tuning order) ───────────────────────────────
/**
 * SUPERSEDES config.ts ULT.trickle and ULT_CITY_RANK_MUL (config.ts is L0's file; §2.2 lets the owning lane tune
 * these, §15.2 gives L1 no config edits, so the tuned values live here — reported as a contract gap so the
 * orchestrator can fold them back into config.ts). killRankMul scales ULT.kill by Size (§3.2 knob 3).
 * Every other ULT.* number (per-event points, hurt, bossHit, lockout, radius, caps) is read from config.ts.
 */
export const ULT_CHARGE = {
  trickle: 1.0,
  cityRankMul: [1.8, 0.32, 0.1, 0.03, 0.02] as number[],
  killRankMul: [1, 0.6, 0.4, 0.28, 0.24] as number[],
};

// ─────────────────────────────── lane-local tuning (the per-titan extras of FEATURES_V2 §3.3) ───────────────────────────────
/** exported (mutable) so probes can sweep them; the design numbers of §3.3 */
export const ULT_X = {
  /** MOLO PULL: drag speed (× R per second) and damage (base per second, 5 Hz ticks) during [0, pullS) of the blast */
  pullRPerS: 0.4, pullDps: 20, pullS: 0.9, pullTickS: 0.2,
  /** MOLO SNAP: heal + shield (fractions of maxHp); the shield respects the engine's 50 % absorb cap */
  moloHeal: 0.12, moloShield: 0.10, shieldCapFrac: 0.5,
  /** VOLT-KITE: 6 radial wires out to min(wireRFrac × R, wireMaxH × H); life = wireDuration + wireExtraS */
  wires: 6, wireRFrac: 0.6, wireMaxH: 6, wireExtraS: 2,
  /** HEARTHBACK: rings × (1 + shellBoost × shell fill); 6 magma pools r magmaRH × H on the magmaRingFrac × R circle */
  shellBoost: 0.6, magmaN: 6, magmaRingFrac: 0.55, magmaRH: 0.5, magmaS: 5, magmaDps: 12,
  /** BRIARWICK: root = the pulse stun (3 s), then slowed slowS at slowMul; turretCap blooms on the bloomRingFrac × R circle */
  rootSlowS: 3, rootSlowMul: 0.6, bloomRingFrac: 0.4, bloomLifeS: 14, bloomRH: 0.3,
  /** BRIARWICK heal-over-time: healFrac × maxHp over healS */
  briarHeal: 0.20, healS: 4,
};

// ─────────────────────────────── scratch (no per-tick allocation in hot loops) ───────────────────────────────
const enemyBuf: Enemy[] = [];
const hitBuf: Enemy[] = [];
const hazBuf: Hazard[] = [];
const circleShape = { k: 'circle' as const, x: 0, z: 0, r: 0 };
const ringShape = { k: 'ring' as const, x: 0, z: 0, r0: 0, r1: 0 };
const OPTS: Record<string, DamageOpts> = {};
function optsFor(kind: DamageKind, knock: number, crit: boolean): DamageOpts {
  const key = kind;
  let o = OPTS[key];
  if (!o) { o = { src: 'titan', kind, noCity: true }; OPTS[key] = o; }
  o.knock = knock; o.crit = crit;
  return o;
}

// ─────────────────────────────── exports ───────────────────────────────
export function createUltState(): UltState {
  return {
    charge: 0, ready: false, phase: 'idle', t: 0, x: 0, z: 0, r: 0, pulse: 0,
    lockT: 0, invulnT: 0, fired: 0, kills: 0, killsBest: 0, heal: 0,
    bankXp: 0, bankMass: 0, bankOpen: false, bankPts: [], xpCap: 0, xpTotal: 0,
  };
}

/** Blast radius R (m) = max(ULT.rFloorH · H, ULT.rFrac · spawnRing(w)) — covers the auto-framed view. */
export function ultRadius(w: World): number {
  return Math.max(ULT.rFloorH * w.titan.height, ULT.rFrac * spawnRing(w));
}

/** titansim stepTitan: max speed × this (ULT.roarMove while phase === 'roar', else 1). */
export function ultMoveMul(w: World): number {
  return w.ult.phase === 'roar' ? ULT.roarMove : 1;
}

/**
 * Add UPROAR points (× the ultCharge stat unless `raw`). Frozen while an ultimate is in flight or during
 * the post-fire lockout, except `raw` fills (BACK PAY, dev cheat), which ignore the lockout. The rising
 * edge of `ready` emits `ultCharged`.
 */
export function addUproar(w: World, points: number, raw = false): void {
  const u = w.ult;
  if (!(points > 0) || !Number.isFinite(points)) return;
  if (!raw && (u.phase !== 'idle' || u.lockT > 0)) return;
  if (!w.titan.alive || w.run.result) return;
  const mul = raw ? 1 : Math.max(0, stat(w, 'ultCharge'));
  u.charge = Math.min(ULT.max, u.charge + points * mul);
  if (!u.ready && u.charge >= ULT.max - 1e-9) {
    u.charge = ULT.max;
    u.ready = true;
    w.events.push({ type: 'ultCharged' });
  }
}

/**
 * combat/damage.ts killEnemy: true = the kill's XP was banked (killEnemy then spawns no scrap of its own).
 * Banks while an ultimate is in flight (XP × killXpMul, capped by what is left of this fire's xpCap; the
 * rest is dropped) or while `bankOpen` (DEMOLITION NOTICE: XP unchanged, no cap).
 */
export function ultBankKill(w: World, x: number, z: number, xp: number, mass: number): boolean {
  const u = w.ult;
  const inUlt = u.phase !== 'idle';
  if (!inUlt && !u.bankOpen) return false;
  const xv = Number.isFinite(xp) && xp > 0 ? xp : 0;
  const mv = Number.isFinite(mass) && mass > 0 ? mass : 0;
  if (u.bankOpen) {
    u.bankXp += xv;
    u.bankMass += mv;
  } else {
    const want = xv * ULT.killXpMul;
    const got = Math.min(want, Math.max(0, u.xpCap));
    u.xpCap -= got;
    u.xpTotal += got;
    u.bankXp += got;
    u.bankMass += mv * ULT.killXpMul;
    u.kills++;
  }
  if (u.bankPts.length < 2 * ULT.bankPickupsPerTick && Number.isFinite(x) && Number.isFinite(z)) u.bankPts.push(x, z);
  return true;
}

/**
 * Tick order: after the first rebuildEnemyGrid, BEFORE stepTitan. Timers, the fire (reads
 * `!!w.input.ultimate`), the ROAR → BLAST → idle state machine, the BRIARWICK heal pool, and the bank flush.
 */
export function stepUltimate(w: World): void {
  const u = w.ult;
  const T = w.titan;
  const dt = w.dt;
  if (u.invulnT > 0) u.invulnT = u.invulnT - dt <= 1e-9 ? 0 : u.invulnT - dt;
  if (u.lockT > 0) u.lockT = u.lockT - dt <= 1e-9 ? 0 : u.lockT - dt;

  if (u.phase !== 'idle' && !T.alive) endUlt(w);

  // ── fire ──
  if (u.phase === 'idle' && u.ready && !!w.input.ultimate && T.alive && !w.run.result) fire(w);
  else if (u.phase === 'roar') {
    u.t += dt;
    const def = ULTS[w.titanId];
    if (u.t >= def.roarS - 1e-9) roarEnd(w);
  } else if (u.phase === 'blast') {
    u.t += dt;
    stepBlast(w);
  }

  // ── BRIARWICK heal-over-time pool ──
  if (u.heal > 0 && T.alive) {
    const rate = (ULT_X.briarHeal * T.maxHp) / ULT_X.healS;
    const a = Math.min(u.heal, rate * dt);
    u.heal -= a;
    if (u.heal < 1e-6) u.heal = 0;
    healTitan(w, a);
  } else if (!T.alive) u.heal = 0;

  flushBank(w);
}

/** Tick order: after processTriggers + objectives/powerups. UPROAR charge from this tick's events (§3.2). */
export function chargeUltimate(w: World): void {
  const u = w.ult;
  const T = w.titan;
  if (u.phase !== 'idle' || u.lockT > 0 || u.ready) return;
  if (!T.alive || w.run.result) return;
  let pts = ULT_CHARGE.trickle * w.dt;
  const H = T.height;
  const near = ULT.nearH * H;
  const cityMul = ULT_CHARGE.cityRankMul[T.rank] ?? 1;
  const killMul = ULT_CHARGE.killRankMul[T.rank] ?? 1;
  let city = 0;
  const ev = w.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    switch (e.type) {
      case 'propDestroyed':
        if (within(T.x, T.z, e.x, e.z, near)) city += ULT.prop;
        break;
      case 'floorBreak':
        if (within(T.x, T.z, e.x, e.z, near)) city += ULT.floor;
        break;
      case 'buildingCollapse':
        if (within(T.x, T.z, e.x, e.z, near + 0.5 * Math.max(e.w, e.d))) city += ULT.collapsePerTier * (e.tier + 1);
        break;
      case 'enemyKilled':
        pts += (ULT.kill[e.kind] ?? 0) * killMul;
        break;
      case 'titanHurt':
        if (T.maxHp > 0) pts += (ULT.hurt * e.dmg) / T.maxHp;
        break;
      case 'bossHit': {
        const b = w.boss;
        if (b && b.maxHp > 0) pts += (ULT.bossHit * e.dmg) / b.maxHp;
        break;
      }
      default: break;
    }
  }
  pts += city * cityMul;
  addUproar(w, pts);
}

// ─────────────────────────────── internals ───────────────────────────────
function within(ax: number, az: number, bx: number, bz: number, r: number): boolean {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz <= r * r;
}

function fire(w: World): void {
  const u = w.ult;
  const T = w.titan;
  const def = ULTS[w.titanId];
  u.charge = 0;
  u.ready = false;
  u.phase = 'roar';
  u.t = 0;
  u.x = T.x; u.z = T.z;
  u.r = ultRadius(w);
  u.pulse = 0;
  u.invulnT = Math.max(u.invulnT, def.roarS);
  u.lockT = ULT.lockoutS;
  u.fired++;
  u.kills = 0;
  u.xpCap = ULT.xpCapLevelFrac * Math.max(0, T.xpToNext);
  // a WINCH / TOW leash snaps
  if (T.leash) {
    if (w.boss) releaseLeash(w, w.boss);
    else { w.events.push({ type: 'leash', on: false, x: T.leash.lx, z: T.leash.lz }); T.leash = null; }
  }
  w.events.push({ type: 'ultFire', titan: w.titanId, x: u.x, z: u.z, r: u.r });
}

/** Where a telegraph sits (its shape origin; a capsule's midpoint; a chain's first point). */
function tgPos(t: Telegraph, out: { x: number; z: number }): { x: number; z: number } {
  const s: Shape = t.shape;
  if (s.k === 'capsule') { out.x = (s.x0 + s.x1) / 2; out.z = (s.z0 + s.z1) / 2; }
  else { out.x = s.x; out.z = s.z; }
  if (t.chain && t.chain.length >= 2) { out.x = t.chain[0]; out.z = t.chain[1]; }
  return out;
}
const tgp = { x: 0, z: 0 };

/** Roar end: clear the air (hostile NON-boss projectiles + unfired ENEMY-owned telegraphs inside R), then BLAST. */
function roarEnd(w: World): void {
  const u = w.ult;
  const R = u.r;
  const R2 = R * R;
  const ps = w.projectiles;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.alive || p.owner !== 'enemy') continue;
    const dx = p.x - u.x, dz = p.z - u.z;
    if (dx * dx + dz * dz > R2) continue;
    p.alive = false;
    if (p.tg >= 0) killTelegraphById(w, p.tg);
  }
  const ts = w.telegraphs;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (!t.alive || t.owner !== 'enemy' || t.fired) continue;
    tgPos(t, tgp);
    const dx = tgp.x - u.x, dz = tgp.z - u.z;
    if (dx * dx + dz * dz > R2) continue;
    t.alive = false;
  }
  u.phase = 'blast';
  u.t = 0;
  u.pulse = 0;
  blastStart(w);
  stepBlast(w);          // pulses scheduled at t = 0 land on the roar-end tick
}

function killTelegraphById(w: World, id: number): void {
  const ts = w.telegraphs;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.id === id) { if (t.owner === 'enemy') t.alive = false; return; }
  }
}

/** Per-titan extras that happen once when the BLAST begins. */
function blastStart(w: World): void {
  const u = w.ult;
  const T = w.titan;
  const H = T.height;
  const R = u.r;
  switch (w.titanId) {
    case 'molo':
      magnetAll(w, R);
      break;
    case 'voltkite': {
      const len = Math.min(ULT_X.wireRFrac * R, ULT_X.wireMaxH * H);
      const life = Math.max(0.1, stat(w, 'wireDuration')) + ULT_X.wireExtraS;
      const r = VOLT.wireRH * H * Math.max(0.1, stat(w, 'area'));
      const dps = titanDamage(w, VOLT.wireDps) * Math.max(0, stat(w, 'wireDamage'));
      for (let k = 0; k < ULT_X.wires; k++) {
        const a = T.heading + (k * Math.PI * 2) / ULT_X.wires;
        makeRoom(titanHazards(w, 'wire', hazBuf), VOLT.wireCap);   // the oldest wires go first (cap 6)
        spawnHazard(w, {
          owner: 'titan', kind: 'wire',
          shape: { k: 'capsule', x0: T.x, z0: T.z, x1: T.x + Math.sin(a) * len, z1: T.z + Math.cos(a) * len, r },
          life, dps, data: { life0: life, h: H, ult: 1 },
        });
      }
      T.kit.wires = titanHazards(w, 'wire', hazBuf).length;
      w.tally.ultWireUntilT = Math.max(w.tally.ultWireUntilT, w.t + life);
      break;
    }
    case 'hearthback': {
      const pr = ULT_X.magmaRingFrac * R;
      const dps = titanDamage(w, ULT_X.magmaDps) * Math.max(0, stat(w, 'ultPower'));
      for (let k = 0; k < ULT_X.magmaN; k++) {
        const a = T.heading + (k * Math.PI * 2) / ULT_X.magmaN;
        spawnHazard(w, {
          owner: 'titan', kind: 'magma',
          shape: { k: 'circle', x: u.x + Math.sin(a) * pr, z: u.z + Math.cos(a) * pr, r: ULT_X.magmaRH * H },
          life: ULT_X.magmaS, dps, data: { ult: 1 },
        });
      }
      break;
    }
    case 'briarwick': {
      const cap = Math.max(1, Math.floor(stat(w, 'turretCap')));
      const br = ULT_X.bloomRingFrac * R;
      for (let k = 0; k < cap; k++) {
        const a = T.heading + (k * Math.PI * 2) / cap;
        const x = u.x + Math.sin(a) * br, z = u.z + Math.cos(a) * br;
        makeRoom(titanHazards(w, 'bloom', hazBuf), cap);          // the decree REPLANTS: oldest replaced
        const h = spawnHazard(w, {
          owner: 'titan', kind: 'bloom',
          shape: { k: 'circle', x, z, r: Math.max(0.3, ULT_X.bloomRH * H) },
          life: ULT_X.bloomLifeS, dps: 0,
          data: { cd: 0.4, spore: 4, h: H, upg: 1, wild: 1 },
        });
        w.events.push({ type: 'bloomSpawn', id: h.id, x, z });
      }
      T.kit.turrets = titanHazards(w, 'bloom', hazBuf).length;
      u.heal += ULT_X.briarHeal * T.maxHp;
      break;
    }
  }
}

/** BLAST: continuous extras (MOLO pull) + every pulse whose time has come; ends the ultimate at blastS. */
function stepBlast(w: World): void {
  const u = w.ult;
  const def = ULTS[w.titanId];
  if (w.titanId === 'molo' && u.t <= ULT_X.pullS + 1e-9) moloPull(w);
  while (u.pulse < def.pulses.length && u.t >= def.pulses[u.pulse].t - 1e-9) {
    firePulse(w, def.pulses[u.pulse], u.pulse, def.pulses.length);
    u.pulse++;
    if (u.phase !== 'blast') return;   // the titan died mid-blast (endUlt ran)
  }
  if (u.t >= def.blastS - 1e-9 && u.pulse >= def.pulses.length) endUlt(w);
}

/** MOLO STREET SWALLOW pull: crushable foes inside R are dragged toward the jaws; 20 base/s at 5 Hz. */
function moloPull(w: World): void {
  const u = w.ult;
  const T = w.titan;
  const dt = w.dt;
  const step = ULT_X.pullRPerS * u.r * dt;
  // 5 Hz damage ticks: the first on the first blast tick, then every pullTickS
  const tickNow = Math.floor((u.t + 1e-9) / ULT_X.pullTickS) !== Math.floor((u.t - dt + 1e-9) / ULT_X.pullTickS);
  const dmg = tickNow ? titanDamage(w, ULT_X.pullDps * ULT_X.pullTickS) * Math.max(0, stat(w, 'ultPower')) : 0;
  const opts = optsFor('bite', 0, false);
  enemiesInCircle(w, u.x, u.z, u.r, enemyBuf);
  hitBuf.length = 0;
  for (let i = 0; i < enemyBuf.length; i++) hitBuf.push(enemyBuf[i]);
  for (let i = 0; i < hitBuf.length; i++) {
    const e = hitBuf[i];
    if (!e.alive) continue;
    const d = ENEMIES[e.kind];
    if (!d || !d.crushable) continue;
    const dx = T.x - e.x, dz = T.z - e.z;
    const dist = Math.hypot(dx, dz);
    const stop = T.radius + e.radius;
    if (dist > stop) {
      const mv = Math.min(step, dist - stop);
      e.x += (dx / dist) * mv; e.z += (dz / dist) * mv;
    }
    if (dmg > 0) damageEnemyFrom(w, e, dmg, opts, u.x, u.z);
  }
  hitBuf.length = 0;
}

/** One damage pulse: enemies in the ring [r0, r1] × R (enemiesInShape + damageEnemy — never the city),
 *  the boss through bossUltHit when parts[0] is within R + its radius, plus the per-titan pulse extras. */
function firePulse(w: World, p: UltPulse, n: number, nPulses: number): void {
  const u = w.ult;
  const T = w.titan;
  const H = T.height;
  const R = u.r;
  const r0 = p.r0 * R, r1 = p.r1 * R;
  let base = p.dmg;
  if (w.titanId === 'hearthback') {
    const cap = T.kit.cap ?? 0, stored = T.kit.stored ?? 0;
    const fill = cap > 0 && Number.isFinite(stored) ? Math.min(1, Math.max(0, stored / cap)) : 0;
    base *= 1 + ULT_X.shellBoost * fill;     // the SHELL is not emptied
  }
  const c = rollCrit(w, titanDamage(w, base) * Math.max(0, stat(w, 'ultPower')));
  const knock = (p.knock ?? 0) * H;
  const opts = optsFor(p.kind, knock, c.crit);
  let s: Shape;
  if (r0 <= 0) { circleShape.x = u.x; circleShape.z = u.z; circleShape.r = r1; s = circleShape; }
  else { ringShape.x = u.x; ringShape.z = u.z; ringShape.r0 = r0; ringShape.r1 = r1; s = ringShape; }
  enemiesInShape(w, s, enemyBuf);
  hitBuf.length = 0;
  for (let i = 0; i < enemyBuf.length; i++) hitBuf.push(enemyBuf[i]);
  const stun = p.stun ?? 0;
  const root = w.titanId === 'briarwick';
  for (let i = 0; i < hitBuf.length; i++) {
    const e = hitBuf[i];
    if (!e.alive) continue;
    const killed = damageEnemyFrom(w, e, c.dmg, opts, u.x, u.z);
    if (killed || !e.alive) continue;
    if (stun > 0) e.stun = Math.max(e.stun, stun);
    if (root) {
      if (!(e.slowT > 0 && e.slowMul < ULT_X.rootSlowMul)) e.slowMul = ULT_X.rootSlowMul;   // a stronger live slow wins
      e.slowT = Math.max(e.slowT, stun + ULT_X.rootSlowS);
    }
  }
  hitBuf.length = 0;
  // the boss: exactly ULT.bossCapFrac / pulses of its max HP and bossMeter / pulses per pulse, body-only
  const b = w.boss;
  if (b && b.alive && b.parts.length > 0) {
    const bp = b.parts[0];
    const dx = bp.x - u.x, dz = bp.z - u.z;
    const reach = R + bp.r;
    if (dx * dx + dz * dz <= reach * reach) bossUltHit(w, ULT.bossCapFrac / nPulses, ULT.bossMeter / nPulses);
  }
  w.events.push({ type: 'ultPulse', titan: w.titanId, x: u.x, z: u.z, r0, r1, n, kind: p.kind });
  // MOLO SNAP (its last pulse): heal + shield
  if (w.titanId === 'molo' && n === nPulses - 1 && T.alive) {
    healTitan(w, ULT_X.moloHeal * T.maxHp);
    const U = w.upgrades;
    const cap = ULT_X.shieldCapFrac * T.maxHp;
    const add = ULT_X.moloShield * T.maxHp;
    if (U.shield < cap) U.shield = Math.max(U.shield, Math.min(U.shield + add, cap));
  }
  if (!T.alive) endUlt(w);
}

function endUlt(w: World): void {
  const u = w.ult;
  if (u.phase === 'idle') return;
  u.phase = 'idle';
  u.t = 0;
  if (u.kills > u.killsBest) u.killsBest = u.kills;
  w.events.push({ type: 'ultEnd', titan: w.titanId, kills: u.kills });
}

/** ≤ ULT.bankPickupsPerTick merged scrap pickups at the first banked kill positions (titan if none). */
function flushBank(w: World): void {
  const u = w.ult;
  if (!(u.bankXp > 0) && !(u.bankMass > 0)) { u.bankXp = 0; u.bankMass = 0; u.bankPts.length = 0; return; }
  const pts = u.bankPts;
  const n = Math.max(1, Math.min(ULT.bankPickupsPerTick, pts.length >> 1));
  const xp = u.bankXp / n, mass = u.bankMass / n;
  for (let i = 0; i < n; i++) {
    const x = pts.length >= 2 * (i + 1) ? pts[2 * i] : w.titan.x;
    const z = pts.length >= 2 * (i + 1) ? pts[2 * i + 1] : w.titan.z;
    spawnPickup(w, 'scrap', x, z, xp, mass);
  }
  u.bankXp = 0; u.bankMass = 0; pts.length = 0;
}
