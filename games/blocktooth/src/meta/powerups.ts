// BLOCKTOOTH v2 — map power-ups: CLEANUP CREW, DEMOLITION NOTICE, RED LIGHT, RUSH HOUR, BACK PAY
// (FEATURES_V2 §6). SIM: THREE-free, DOM-free, deterministic (drops and kinds from w.rng.meta only).
// Lane L4 (MAP-SIM). Exact exports of `ModPowerups` (_spec/features_v2_types.ts).
//
// Tick order (world.ts): stepObjectives → stepPowerups → chargeUltimate. stepPowerups, in order:
//   1. drops from this tick's events (enemyKilled by kind; buildingCollapse tier ≥ 2), read AFTER
//      processTriggers so trigger-proc kills/collapses drop too (§2.3). Only the events that were in
//      w.events when the step began are read: DEMOLITION kills made in step 3 never drop tokens;
//   2. RED LIGHT / RUSH HOUR timers (`powerupEnd` on expiry);
//   3. token ageing, expiry (life 30 s) and collection (titan.radius + max(1 m, 0.6 H)) → effect.
// RED LIGHT itself is honoured by the pre-wired hooks (ai/director.ts holds waves; ai/enemies.ts skips AI
// and movement; combat/projectiles.ts and combat/telegraphs.ts freeze enemy-owned shots and paint), all
// reading redLightActive(w). Bosses and their shots/paint ignore it.
// DEMOLITION kills bank through meta/ultimate.ts (`w.ult.bankOpen` around the kill loop): normal XP, merged
// into ≤ ULT.bankPickupsPerTick pickups flushed by the next stepUltimate. They happen after processTriggers,
// so they proc no on-kill cards (accepted, §2.3); chargeUltimate and stepTally still see them.
//
// Measured (L4, 2026-09-25): see the table at the top of meta/objectives.ts. Why PU_TUNE differs from config:
// with config's chances the GATE 2 matrix (seed 1337) saw 13–19 tokens per run (the OVERLOAD SITE's guaranteed
// drop alone is 7–11 per run, elites 1–2) against the §6.2 expectation of 5–10, and 12/12 clears with 0 deaths
// (GATE 2 FAIL on the §0.6 deaths ≥ 1 leg: DEMOLITION made 450 kills over the matrix). Random chances × 0.15
// and DEMOLITION 18 → 9 (with the objectives.ts tuning) gave 7–14 tokens (median 10), 9/12 clears, 3 deaths
// (_harness/scratch/l4/exp.ts variant drop0.15+xp0.15+ores10+demow9).

import type { Enemy, EnemyKind, PowerUp, PowerUpKind, World } from '../core/types.ts';
import { POWERUP_KINDS } from '../core/types.ts';
import { POWERUPS, ULT } from '../core/config.ts';
import { spawnRing } from '../ai/director.ts';
import { bossUltHit } from '../ai/bosses/index.ts';
import { damageEnemy, killEnemy } from '../combat/damage.ts';
import { magnetAll } from '../combat/pickups.ts';
import { addUproar } from './ultimate.ts';

// ─────────────────────────────── lane-local tuning ───────────────────────────────
/**
 * SUPERSEDES the drop chances of config.ts POWERUPS (config.ts is L0's file; §2.2 lets the owning lane tune
 * them and §15.2 gives L4 no config edits, so the tuned values live here and are reported as a contract gap
 * for the orchestrator to fold back). Everything else (life, blink, cap, gap, weights, effect numbers) is
 * read from config.ts POWERUPS. Exported (mutable) so probes can sweep it.
 */
export const PU_TUNE = {
  /** random-drop chance per kill by kind = config × 0.15 (elite stays a sure drop) */
  dropByKill: { android: 0.0003, squad: 0.0003, drone: 0.0006, buggy: 0.0018, apc: 0.0045, tank: 0.00525, walker: 0.0075, elite: 1 } as Record<EnemyKind, number>,
  /** per credited tier ≥ 2 collapse = config × 0.15 */
  dropByCollapse: 0.0009,
  /** kind weights: config's, DEMOLITION halved (18 → 9) */
  weights: { ...POWERUPS.weights, demolition: 9 } as Record<PowerUpKind, number>,
  /** DEMOLITION weight × this at Size I (§6.2) */
  demolitionSizeIMul: 0.5,
};

const MAX_BUFFS = 12;   // = upgrades/engine.ts MAX_BUFFS (frenzy buffs; oldest dropped)

// ─────────────────────────────── exports ───────────────────────────────
/** RED LIGHT active (foes, their shots and their paint stop). */
export function redLightActive(w: World): boolean {
  return w.map.redLightT > 0;
}

/**
 * Spawn a power-up token at (x, z) (clamped into the city bounds). `kind === null` = weighted roll from
 * rng.meta (DEMOLITION × 0.5 at Size I). Unforced (random) drops obey the ≥ minGapS spacing and the
 * maxAlive cap and return null when blocked; forced drops (elite, OVERLOAD SITE, endless rematch, dev
 * cheat) ignore the gap and, at the cap, retire the oldest token to make room.
 */
export function spawnPowerup(w: World, kind: PowerUpKind | null, x: number, z: number, forced: boolean): PowerUp | null {
  if (w.run.result && !w.endless) return null;
  const m = w.map;
  if (!Number.isFinite(x) || !Number.isFinite(z)) { x = w.titan.x; z = w.titan.z; }
  let alive = 0, oldest: PowerUp | null = null;
  for (let i = 0; i < m.powerups.length; i++) {
    const p = m.powerups[i];
    if (!p.alive) continue;
    alive++;
    if (!oldest || p.t > oldest.t || (p.t === oldest.t && p.id < oldest.id)) oldest = p;
  }
  if (!forced) {
    if (w.t - m.lastDropT < POWERUPS.minGapS - 1e-9) return null;
    if (alive >= POWERUPS.maxAlive) return null;
  } else if (alive >= POWERUPS.maxAlive && oldest) {
    oldest.alive = false;
  }
  const k = kind ?? rollKind(w, false);
  const B = w.city.bounds;
  const pad = 1;
  const p: PowerUp = {
    id: w.nextId++,   // = core/world.ts newId (not imported: world.ts imports this module)
    kind: k, alive: true,
    x: Math.min(B.maxX - pad, Math.max(B.minX + pad, x)),
    z: Math.min(B.maxZ - pad, Math.max(B.minZ + pad, z)),
    t: 0, life: POWERUPS.lifeS, h: w.titan.height,
  };
  m.powerups.push(p);
  if (!forced) m.lastDropT = w.t;
  w.events.push({ type: 'powerupSpawn', id: p.id, kind: p.kind, x: p.x, z: p.z });
  return p;
}

/** Tick order: right after stepObjectives (drops from ALL of this tick's kills/collapses, timers, collect). */
export function stepPowerups(w: World): void {
  const m = w.map;
  const T = w.titan;
  const dt = w.dt;
  const live = !w.run.result || !!w.endless;

  // ── 1. drops from this tick's events (only the ones present now) ──
  if (live && T.alive) {
    const ev = w.events;
    const n0 = ev.length;
    const bossMul = w.boss && w.boss.alive ? POWERUPS.bossDropMul : 1;
    for (let i = 0; i < n0; i++) {
      const e = ev[i];
      if (e.type === 'enemyKilled') {
        if (e.kind === 'elite') { spawnPowerup(w, null, e.x, e.z, true); continue; }
        const c = (PU_TUNE.dropByKill[e.kind] ?? 0) * bossMul;
        if (c > 0 && canRandomDrop(w) && w.rng.meta() < c) spawnPowerup(w, null, e.x, e.z, false);
      } else if (e.type === 'buildingCollapse') {
        if (e.tier < 2 || (e as { noCredit?: boolean }).noCredit) continue;
        const c = PU_TUNE.dropByCollapse * bossMul;
        if (c > 0 && canRandomDrop(w) && w.rng.meta() < c) spawnPowerup(w, null, e.x, e.z, false);
      }
    }
  }

  // ── 2. timed effects ──
  if (m.redLightT > 0) {
    m.redLightT = m.redLightT - dt <= 1e-9 ? 0 : m.redLightT - dt;
    if (m.redLightT === 0) w.events.push({ type: 'powerupEnd', kind: 'redLight' });
  }
  if (m.rushHourT > 0) {
    m.rushHourT = m.rushHourT - dt <= 1e-9 ? 0 : m.rushHourT - dt;
    if (m.rushHourT === 0) w.events.push({ type: 'powerupEnd', kind: 'rushHour' });
  }

  // ── 3. tokens: age, expire, collect ──
  const H = T.height;
  const reach = T.radius + Math.max(1, POWERUPS.collectH * H);
  const reach2 = reach * reach;
  const ps = m.powerups;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.alive) continue;
    p.t += dt;
    if (p.t >= p.life - 1e-9) { p.alive = false; continue; }
    if (!live || !T.alive) continue;
    const dx = p.x - T.x, dz = p.z - T.z;
    if (dx * dx + dz * dz <= reach2) collect(w, p);
  }
}

// ─────────────────────────────── internals ───────────────────────────────
function canRandomDrop(w: World): boolean {
  const m = w.map;
  if (w.t - m.lastDropT < POWERUPS.minGapS - 1e-9) return false;
  let alive = 0;
  for (let i = 0; i < m.powerups.length; i++) if (m.powerups[i].alive) alive++;
  return alive < POWERUPS.maxAlive;
}

/** Weighted kind roll (one rng.meta draw). `noBackPay`: OVERLOAD SITE's guaranteed drop (§5.1). */
export function rollKind(w: World, noBackPay: boolean): PowerUpKind {
  let total = 0;
  for (const k of POWERUP_KINDS) total += kindWeight(w, k, noBackPay);
  let r = w.rng.meta() * total;
  for (const k of POWERUP_KINDS) {
    const wt = kindWeight(w, k, noBackPay);
    if (r < wt) return k;
    r -= wt;
  }
  return noBackPay ? 'cleanup' : POWERUP_KINDS[POWERUP_KINDS.length - 1];
}

function kindWeight(w: World, k: PowerUpKind, noBackPay: boolean): number {
  if (noBackPay && k === 'backPay') return 0;
  let wt = PU_TUNE.weights[k] ?? 0;
  if (k === 'demolition' && w.titan.rank === 0) wt *= PU_TUNE.demolitionSizeIMul;
  return Math.max(0, wt);
}

function collect(w: World, p: PowerUp): void {
  p.alive = false;
  const m = w.map;
  w.events.push({ type: 'powerup', id: p.id, kind: p.kind, x: p.x, z: p.z });
  switch (p.kind) {
    case 'cleanup':
      magnetAll(w, Infinity);
      break;
    case 'demolition':
      demolition(w);
      break;
    case 'redLight': {
      const s = w.boss && w.boss.alive ? POWERUPS.redLightBossS : POWERUPS.redLightS;
      if (m.redLightT < s) m.redLightT = s;
      break;
    }
    case 'rushHour':
      m.rushHourT = Math.max(m.rushHourT, POWERUPS.rushHourS);
      buff(w, 'attackRate', POWERUPS.rushAttackRate, POWERUPS.rushHourS);
      buff(w, 'moveSpeed', POWERUPS.rushMoveSpeed, POWERUPS.rushHourS);
      buff(w, 'smashDamage', POWERUPS.rushSmash, POWERUPS.rushHourS);
      break;
    case 'backPay':
      addUproar(w, ULT.max, true);
      break;
  }
}

/** frenzy buff (same semantics as upgrades/engine.ts addBuff: an identical stat+mul refreshes its timer) */
function buff(w: World, stat: 'attackRate' | 'moveSpeed' | 'smashDamage', mul: number, dur: number): void {
  const B = w.upgrades.buffs;
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    if (b.stat === stat && Math.abs(b.mul - mul) < 1e-9) { if (b.t < dur) b.t = dur; return; }
  }
  if (B.length >= MAX_BUFFS) B.shift();
  B.push({ stat, mul, t: dur });
}

const DEMO_OPTS = { src: 'titan' as const, kind: 'generic' as const, noCity: true };

/** DEMOLITION NOTICE (§6.1): regular foes within 1.0 × spawnRing die (banked XP), elites take 25 % of max HP,
 *  hostile non-boss projectiles in the ring are deleted (with their lob telegraphs), the boss takes 2 %. */
function demolition(w: World): void {
  const T = w.titan;
  const R = spawnRing(w);
  const R2 = R * R;
  const u = w.ult;
  const wasOpen = u.bankOpen;
  u.bankOpen = true;
  let kills = 0;
  const es = w.enemies;
  const n = es.length;
  for (let i = 0; i < n; i++) {
    const e: Enemy = es[i];
    if (!e.alive) continue;
    const dx = e.x - T.x, dz = e.z - T.z;
    if (dx * dx + dz * dz > R2) continue;
    if (e.elite || e.kind === 'elite') {
      if (damageEnemy(w, e, POWERUPS.demolitionEliteFrac * e.maxHp, DEMO_OPTS)) kills++;
    } else {
      killEnemy(w, e, false);
      kills++;
    }
  }
  u.bankOpen = wasOpen;
  w.map.demolitionKills += kills;
  // hostile non-boss projectiles (and the telegraph painted under a lob)
  const ps = w.projectiles;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.alive || p.owner !== 'enemy') continue;
    const dx = p.x - T.x, dz = p.z - T.z;
    if (dx * dx + dz * dz > R2) continue;
    p.alive = false;
    if (p.tg >= 0) {
      const tgs = w.telegraphs;
      for (let j = 0; j < tgs.length; j++) if (tgs[j].id === p.tg && tgs[j].alive && tgs[j].owner === 'enemy') { tgs[j].alive = false; break; }
    }
  }
  bossUltHit(w, POWERUPS.demolitionBossFrac, POWERUPS.demolitionBossMeter);
}
