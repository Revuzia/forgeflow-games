// BLOCKTOOTH — the HALVARD CIVIL DEFENSE dispatch desk (ai lane, CONTRACT §5.3, §9).
// THREE-free, DOM-free, deterministic: every roll comes from world.rng.spawn.
//
//   * Spawn budget accrues 1.2 + 0.9·min(t/PACE_STRETCH,600)/60 + 0.6·rank points per second (× 0.3 once the
//     boss is on the field). p20 (owner 2026-09-30 "go with 20 minutes"): world time is read / PACE_STRETCH 2.1,
//     so pressure per Size rank stays what GATE 2 tuned and the ramp spans the ~20-minute run (cap at 21:00).
//     At Size IV outside a boss fight it is × SIZE_IV_RAMP_FROM at the breach rising to × 1 at the city lock.
//     A wave fires every 6–9 s and spends the budget on the kinds the
//     titan's rank allows (ENEMIES[k].minRank; PICKET SQUADs only after 45 s), weighted by a
//     per-rank mix × the biome's enemyBias, respecting per-kind caps and CITY.maxEnemies.
//   * Groups: CROSSING WARDENs arrive in pairs/trios along a street, PICKET SQUADs as five in a
//     wedge (one squad id), GNATs in small clusters, vehicles one at a time on road lanes.
//   * First appearance of a category raises its alert (spawnEnemy emits it, so squads deployed by
//     a BULWARK or a cheat spawn count too).
//   * Elite: RAMROD at min(ELITE_AT_S, t(rank IV) + 30) → `alert elite` + `eliteSpawn`, run.phase
//     'elite'. While the phase lasts and none is alive, another follows every ELITE_REPEAT_S
//     (max ELITE_MAX) so the chest economy survives a fast kill. p20: ELITE_MAX is 1 — one RAMROD per run, as the
//     10-minute run always had (its 520 s cutoff kept the repeat dormant). For a future cap > 1 the repeat keeps two
//     guards: none within 20 s of the locked city boss's gates.dueT and none at LV >= RANK_LEVELS[4] -
//     ELITE_CITY_LEVELS, so the last RAMROD is down before the climax.
//   * Boss: director.bossT = min(BOSS_AT_S, t(rank V) + 20) is still kept here, but the spawn itself
//     moved to meta/gates.ts stepGates (GATEKEEPERS §4.1 / §7.3; the K0 stub runs the old block verbatim).
//   * cheats.noSpawns: nothing is fielded (waves, trickle, elite, scheduled boss) and the
//     budget does not bank; timers keep running so switching it off resumes the schedule.
//   * GATEKEEPERS (§2.8, §6.3, §6.4, lane K0 pre-wire): BOSS_SPAWN_MUL / BOSS_MIX only for a city boss or a
//     gate rematch (slot 0); × gateSpawnMul(w) always; no elite while a gate lock (slot 1–3) is pending or
//     any fight is alive; RAMROD at SWITCHBOARD-5's kill + ELITE_AFTER_RANK_IV_S (the rank IV rule stays
//     for a rank IV reached without that kill: the open-gate skeleton and dev cheats); nothing spawned or
//     banked during the finale; the boss framing keeps a post-kill floor over a gate breach's tween.

import type { DirectorState, EnemyKind, World } from '../core/types.ts';
import {
  BOSS_AT_S, BOSS_FRAME, PACE_STRETCH, RANK_LEVELS, SIZE_IV_RAMP_FROM, CAMERA, CITY, DIRECTOR_BUDGET_RANK_MUL, ELITE_AT_S, GROW_TWEEN_S, bossFrameFitAt, bossFrameFloorAt,
  bossFrameNeed, cameraDistance, frameDistance, stepFrameHold, titanHeightAt,
} from '../core/config.ts';
import type { FrameHold } from '../core/config.ts';
import { TAU, clamp } from '../core/math.ts';
import { BIOMES } from '../data/biomes.ts';
import { ENEMIES } from '../data/enemies.ts';
import { ringPoint, ringRadius, spawnEnemy } from './enemies.ts';
import { endlessBudgetMul } from '../meta/endless.ts';
import { fightAlive, gateSpawnMul } from '../meta/gates.ts';
import { redLightActive } from '../meta/powerups.ts';

// ─────────────────────────────── tuning (lane-local) ───────────────────────────────
const FIRST_WAVE_S = 2.5;
const FIRST_BUDGET = 3;
const WAVE_MIN_S = 6, WAVE_SPAN_S = 3;           // 6–9 s between waves (§9)
const SQUAD_AFTER_S = 45;                         // PICKET SQUADs join from 45 s (§9 table)
const BOSS_SPAWN_MUL = 0.5;                       // regular spawns during the boss (§9 said 30 %; balance: the adds are what drain dash charges)
const BANK_WAVES = 2.5;                           // unspent budget carries, capped at this × one wave
const MAX_PER_WAVE = 48;                          // bodies per wave (keeps the ring from flooding)
const ELITE_AFTER_RANK_IV_S = 30;
const BOSS_AFTER_RANK_V_S = 20;
const ELITE_REPEAT_S = 75;
/** p20: 1 (was 3). The repeat never fired in the 10-minute run (its 520 s cutoff), so every RAMROD count GATE 2 and
 *  the player-like sets tuned was 1. With BOSS_AT_S 1250 the 3-cap went live (2–3 per run) and RAMROD fire became the
 *  main pre-city killer in the 4.75-min Size IV (Q-human, 96 runs, with SIZE_IV_RAMP_FROM 0.5: cap 3 → 73 clears,
 *  6 pre-city deaths; cap 2 → 76, 4; cap 1 → 81, 2; HEAD 80, 3). The repeat code and its p20 guards stay for a
 *  future cap > 1. */
const ELITE_MAX = 1;
const ELITE_CITY_LEVELS = 2;
const SQUAD_SIZE = 5;

/** Relative pick weight per kind by titan rank (I..V). Heavy kinds take over as the titan grows;
 *  cheap infantry never disappears (it is the crunchy snack layer). Multiplied by biome bias. */
const MIX: Record<EnemyKind, readonly number[]> = {
  android: [10, 6, 3.2, 2.2, 1.6],
  squad: [4, 5, 4, 3, 2.2],
  drone: [0, 4, 4, 3.2, 3],
  buggy: [0, 3, 4, 3.2, 2.6],
  apc: [0, 0, 2, 2.2, 2.2],
  tank: [0, 0, 2.6, 3, 3.2],
  walker: [0, 0, 0, 1.6, 2.6],
  elite: [0, 0, 0, 0, 0],
};

/** Alive caps per kind by titan rank (squad counts members). Cheap infantry is capped lower at
 *  Size I–II, where the spawn ring is only ~14–30 m and a full 70-strong picket line would wall the
 *  baby titan in (readability first). BULWARK-deployed squads count toward these totals, so the
 *  director only tops up what is left (BULWARKs themselves stop deploying at 90 squad members). */
const CAP: Record<EnemyKind, readonly number[]> = {
  android: [12, 22, 70, 70, 70],
  squad: [5, 15, 70, 70, 70],
  drone: [0, 12, 44, 44, 44],
  buggy: [0, 12, 16, 16, 16],
  apc: [0, 0, 6, 8, 8],
  tank: [0, 0, 10, 12, 14],
  walker: [0, 0, 0, 6, 8],
  elite: [0, 0, 2, 2, 2],
};
const capOf = (w: World, k: EnemyKind) => CAP[k][w.titan.rank];

/** Pick weights while the boss is on the field: the adds are the artillery that paints the ground
 *  around the fight (tank lanes, mortar barrages, dives) — not chaff that soaks the titan's
 *  auto-attacks (which target enemies before boss parts) and stretches the fight. */
const BOSS_MIX: Record<EnemyKind, number> = {
  android: 0.2, squad: 0.4, drone: 1.6, buggy: 1.0, apc: 0.6, tank: 3.2, walker: 3.0, elite: 0,
};

/** Group size range per kind (bodies per pick). */
const GROUP: Record<EnemyKind, readonly [number, number]> = {
  android: [2, 4], squad: [SQUAD_SIZE, SQUAD_SIZE], drone: [2, 4], buggy: [1, 1],
  apc: [1, 1], tank: [1, 1], walker: [1, 1], elite: [1, 1],
};

const KINDS: readonly EnemyKind[] = ['android', 'squad', 'drone', 'buggy', 'apc', 'tank', 'walker'];

// ─────────────────────────────── contract exports ───────────────────────────────
export function createDirector(): DirectorState {
  return {
    wave: 0,
    nextWaveT: FIRST_WAVE_S,
    spawnBudget: FIRST_BUDGET,
    eliteT: ELITE_AT_S,
    elitesSpawned: 0,
    bossT: BOSS_AT_S,
    bossSpawned: false,
    squadSeq: 0,
    data: {},
  };
}

/** Spawn ring radius (m) = max(14, 0.55 × camera vertical extent at the current D) (§9). */
export function spawnRing(w: World): number {
  return ringRadius(w);
}

// ─────────────────────────────── helpers ───────────────────────────────
const alive = { n: 0, by: { android: 0, squad: 0, drone: 0, buggy: 0, apc: 0, tank: 0, walker: 0, elite: 0 } as Record<EnemyKind, number> };
function countAlive(w: World): void {
  alive.n = 0;
  for (const k of KINDS) alive.by[k] = 0;
  alive.by.elite = 0;
  const es = w.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e.alive) continue;
    alive.n++;
    alive.by[e.kind]++;
  }
}

function kindAllowed(w: World, k: EnemyKind): boolean {
  const def = ENEMIES[k];
  if (!(def.cost > 0)) return false;             // the elite is scheduled, never bought
  if (def.minRank > w.titan.rank) return false;
  if (k === 'squad' && w.t < SQUAD_AFTER_S) return false;
  return true;
}

/** GATEKEEPERS §6.3: the city-boss spawn rules (BOSS_SPAWN_MUL, BOSS_MIX) apply to a city boss and to a
 *  gate REMATCH (slot 0); a home gatekeeper keeps the rank's normal MIX (its budget is gateSpawnMul's). */
function bossRules(w: World): boolean {
  const b = w.boss;
  return !!b && b.alive && (b.role === 'main' || b.slot === 0);
}

function weightOf(w: World, k: EnemyKind): number {
  const bias = BIOMES[w.biomeId].enemyBias[k];
  const b = bias !== undefined && Number.isFinite(bias) ? Math.max(0, bias) : 1;
  return (bossRules(w) ? BOSS_MIX[k] : MIX[k][w.titan.rank]) * b;
}

/** p20: × budget at Size IV outside a boss fight — SIZE_IV_RAMP_FROM at the breach level rising to × 1 at the city lock */
function sizeIvRamp(w: World): number {
  const T = w.titan;
  if (T.rank !== 3 || SIZE_IV_RAMP_FROM >= 1) return 1;
  const u = clamp((T.level - RANK_LEVELS[3]) / (RANK_LEVELS[4] - RANK_LEVELS[3]), 0, 1);
  return SIZE_IV_RAMP_FROM + (1 - SIZE_IV_RAMP_FROM) * u;
}

/** Budget points per second at the current time/rank (§9). */
export function budgetRate(w: World): number {
  const r = (1.2 + (0.9 * Math.min(w.t / PACE_STRETCH, 600)) / 60 + 0.6 * w.titan.rank) * (DIRECTOR_BUDGET_RANK_MUL[w.titan.rank] ?? 1);
  const out = bossRules(w) ? r * BOSS_SPAWN_MUL : r * sizeIvRamp(w);
  return out * endlessBudgetMul(w)    // v2: EXTENDED COVERAGE escalation (1 outside endless)
    * gateSpawnMul(w);                // GATEKEEPERS §6.3: GATES.spawnMul × pressure while a home gatekeeper is alive (1 otherwise)
}

const P = { x: 0, z: 0 };
const Q = { x: 0, z: 0 };

/** Field one group of `kind` just off-screen. Returns bodies spawned. */
function spawnGroup(w: World, kind: EnemyKind, n: number): number {
  const T = w.titan, rs = w.rng.spawn;
  ringPoint(w, kind, P);
  if (kind === 'squad') {
    const sid = w.director.squadSeq++;
    // wedge facing the titan: the leader (slot 0) nearest, the rest fanned out behind it
    const h = Math.atan2(T.x - P.x, T.z - P.z);
    const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
    for (let s = 0; s < n; s++) {
      const side = s === 0 ? 0 : (s % 2 === 1 ? -1 : 1) * Math.ceil(s / 2);
      const back = Math.ceil(s / 2) * 2.2;
      const e = spawnEnemy(w, 'squad', P.x + rx * side * 2.4 - fx * back, P.z + rz * side * 2.4 - fz * back, { squad: sid, slot: s });
      e.heading = e.pheading = h;
    }
    return n;
  }
  if (n <= 1) { spawnEnemy(w, kind, P.x, P.z); return 1; }
  // clusters: scatter around the ring point (drones in the air, wardens along the street)
  const spread = kind === 'drone' ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = rs() * TAU, r = spread * Math.sqrt(rs());
    Q.x = P.x + Math.sin(a) * r; Q.z = P.z + Math.cos(a) * r;
    spawnEnemy(w, kind, Q.x, Q.z);
  }
  return n;
}

/** Spend the banked budget on one wave. */
function runWave(w: World): void {
  const D = w.director, rs = w.rng.spawn;
  countAlive(w);
  const room0 = CITY.maxEnemies - alive.n;
  if (room0 <= 0) return;
  D.wave++;
  w.events.push({ type: 'waveStart', wave: D.wave });
  let bodies = 0;
  const cand: EnemyKind[] = [];
  for (let guard = 0; guard < 64; guard++) {
    cand.length = 0;
    let total = 0;
    for (const k of KINDS) {
      if (!kindAllowed(w, k)) continue;
      const def = ENEMIES[k];
      const g = GROUP[k][0];
      if (def.cost * g > D.spawnBudget + 1e-9) continue;
      if (alive.by[k] + g > capOf(w, k)) continue;
      if (alive.n + g > CITY.maxEnemies || bodies + g > MAX_PER_WAVE) continue;
      const wt = weightOf(w, k);
      if (!(wt > 0)) continue;
      cand.push(k);
      total += wt;
    }
    if (cand.length === 0 || !(total > 0)) break;
    let x = rs() * total, kind = cand[cand.length - 1];
    for (const k of cand) { x -= weightOf(w, k); if (x <= 0) { kind = k; break; } }
    const def = ENEMIES[kind];
    const [g0, g1] = GROUP[kind];
    let n = g0 + Math.floor(rs() * (g1 - g0 + 1));
    n = Math.min(n, Math.floor(D.spawnBudget / def.cost), capOf(w, kind) - alive.by[kind], CITY.maxEnemies - alive.n, MAX_PER_WAVE - bodies);
    if (kind === 'squad') n = SQUAD_SIZE;
    if (n < g0) break;
    const got = spawnGroup(w, kind, n);
    D.spawnBudget -= got * def.cost;
    alive.by[kind] += got; alive.n += got; bodies += got;
    D.data['spawned_' + kind] = (D.data['spawned_' + kind] ?? 0) + got;
  }
  D.data.lastWaveBodies = bodies;
}

function spawnElite(w: World): void {
  const D = w.director;
  ringPoint(w, 'elite', P);
  const e = spawnEnemy(w, 'elite', P.x, P.z, { elite: true });
  D.elitesSpawned++;
  D.data.lastEliteT = w.t;
  D.data.spawned_elite = (D.data.spawned_elite ?? 0) + 1;
  w.events.push({ type: 'alert', key: 'elite' });
  w.events.push({ type: 'eliteSpawn', id: e.id });
  if (w.run.phase === 'waves' || w.run.phase === 'intro') w.run.phase = 'elite';
}

// ─────────────────────────────── step ───────────────────────────────
/** Waves, elite and boss scheduling + run.phase transitions (stepWorld, after stepTitan). */
/** BOSS FRAMING (config BOSS_FRAME / bossFrameNeed / stepFrameHold): the distance the boss, its live
 *  telegraphs and the titan need is HELD with hysteresis — widened at once, shrunk only after a hold
 *  with no need for the extra width, and then slowly (never pumping with the attack rhythm). The
 *  look-target offset eases toward the need's while the width is needed, holds through the hold and
 *  eases home after it. The spawn ring and the camera read the result through config frameDistance /
 *  frameOffset (never below the curve); the ring reads spawnView, which adds a replica of the rig's own
 *  smoothing (camD / camOx / camOz). Generic: any fight in the w.boss slot gets it. */
const BF_HOLD: FrameHold = { held: 0, quietT: 0, holdS: 0, relT: -1, relD: 0 };
function stepBossFrame(w: World): void {
  const D = w.director, dat = D.data;
  const b = w.boss;
  stepPostFrame(w);
  if (!b || !b.alive) {
    // GATEKEEPERS §6.4: after a gate kill the held framing is not released while the breach tween runs —
    // a floor of max(held framing, curve(new H)) for GROW_TWEEN_S, then released at BOSS_FRAME.releaseOmega
    if (b && b.role === 'gate' && dat.bossFrameD > 0) {
      const T = w.titan;
      const curve = cameraDistance(Math.max(T.height, titanHeightAt(T.rank, T.level)));
      dat.postFrameD = Math.max(dat.bossFrameD, curve);
      dat.postFrameT = GROW_TWEEN_S;
    }
    if (dat.bossFrameD) {
      dat.bossFrameD = 0; dat.bossFrameHoldT = 0; dat.bossFrameHeld = 0; dat.bossFrameOx = 0; dat.bossFrameOz = 0;
      dat.bossFrameHoldS = 0; dat.bossFrameRelT = -1; dat.bossFrameRelD = 0;
    }
    dat.camD = 0; dat.camDv = 0; dat.camOx = 0; dat.camOz = 0;
    return;
  }
  const dt = w.dt;
  const need = bossFrameNeed(w);
  // the look-target offset: toward the need's while the width is needed (last tick's verdict), held
  // through the hold, home at the slower release rate after it
  const needed = !((dat.bossFrameHoldT ?? 0) > 0);
  const released = (dat.bossFrameHoldT ?? 0) >= (dat.bossFrameHoldS || BOSS_FRAME.holdS);
  const om = needed ? BOSS_FRAME.offsetOmega : released ? BOSS_FRAME.offsetReleaseOmega : 0;
  const ko = 1 - Math.exp(-om * dt);
  const ox0 = dat.bossFrameOx ?? 0, oz0 = dat.bossFrameOz ?? 0;
  const ox = ox0 + (need.ox - ox0) * ko, oz = oz0 + (need.oz - oz0) * ko;
  dat.bossFrameOx = ox; dat.bossFrameOz = oz;
  // replica of the camera rig (render/camera.ts) offset smoothing: the rig's look target lags the
  // eased offset, so what the paint needs around THAT centre is part of the need (held like the rest),
  // and the spawn ring (config spawnView) reads the same centre
  const kc = 1 - Math.exp(-CAMERA.frameOffOmega * dt);
  dat.camOx = (dat.camOx ?? 0) + (ox - (dat.camOx ?? 0)) * kc;
  dat.camOz = (dat.camOz ?? 0) + (oz - (dat.camOz ?? 0)) * kc;
  const needD = Math.max(need.d, bossFrameFitAt(dat.camOx, dat.camOz));
  // the distance: widen at once, shrink late and slowly (config stepFrameHold)
  const H = BF_HOLD;
  H.held = dat.bossFrameHeld ?? 0; H.quietT = dat.bossFrameHoldT ?? 0; H.holdS = dat.bossFrameHoldS ?? 0;
  H.relT = dat.bossFrameRelT ?? -1; H.relD = dat.bossFrameRelD ?? 0;
  stepFrameHold(H, needD, cameraDistance(w.titan.height), dt, BOSS_FRAME);
  dat.bossFrameHeld = H.held; dat.bossFrameHoldT = H.quietT; dat.bossFrameHoldS = H.holdS;
  dat.bossFrameRelT = H.relT; dat.bossFrameRelD = H.relD;
  dat.bossFrameD = H.held;
  // replica of the rig's critically damped distance spring (spawnView keeps the ring off the view the
  // rig is STILL showing while it releases): widening at CAMERA.widenOmega, shrinking at zoomOmega, never
  // under the rig's hard floor (config bossFrameFloorAt around the replica's centre — the rig's own lead
  // is view-only, so this is the sim's best knowledge of it; wider = the ring stays safer)
  const dStar = frameDistance(w);
  if (!(dat.camD > 0)) { dat.camD = dStar; dat.camDv = 0; }
  else {
    const omz = dStar > dat.camD ? CAMERA.widenOmega : CAMERA.zoomOmega;
    const x0 = dat.camD - dStar, e = Math.exp(-omz * dt), c = (dat.camDv ?? 0) + omz * x0;
    dat.camD = dStar + (x0 + c * dt) * e;
    dat.camDv = (c - omz * (x0 + c * dt)) * e;
  }
  const floorD = bossFrameFloorAt(dat.camOx, dat.camOz);
  if (dat.camD < floorD) { dat.camD = floorD; if ((dat.camDv ?? 0) < 0) dat.camDv = 0; }
}

/** GATEKEEPERS §6.4: the post-kill framing floor (director.data.postFrameD, read by config frameDistance):
 *  held for postFrameT, then eased down to the curve at BOSS_FRAME.releaseOmega and cleared. */
function stepPostFrame(w: World): void {
  const dat = w.director.data;
  const pf = dat.postFrameD;
  if (pf === undefined || !(pf > 0)) return;
  if (dat.postFrameT > 0) { dat.postFrameT = Math.max(0, dat.postFrameT - w.dt); return; }
  const curve = cameraDistance(w.titan.height);
  const next = pf + (curve - pf) * (1 - Math.exp(-BOSS_FRAME.releaseOmega * w.dt));
  dat.postFrameD = next <= curve * 1.002 ? 0 : next;
}

export function stepDirector(w: World): void {
  const D = w.director, T = w.titan;
  if (w.run.result || !T.alive) return;
  stepBossFrame(w);

  // GATEKEEPERS §2.8: RAMROD comes ELITE_AFTER_RANK_IV_S after SWITCHBOARD-5's kill (replaces the rank IV
  // rule whenever Size IV came from that kill; the rank IV rule below stays for the open-gate skeleton)
  const k3 = w.gates.killT[3];
  if (Number.isFinite(k3) && D.data.gate3KillT === undefined) {
    D.data.gate3KillT = k3;
    if (D.data.rankIVT === undefined) D.data.rankIVT = w.t;
    D.eliteT = k3 + ELITE_AFTER_RANK_IV_S;
  }
  // schedule tightening from the titan's growth (never pushes a time later)
  if (T.rank >= 3 && D.data.rankIVT === undefined) {
    D.data.rankIVT = w.t;
    D.eliteT = Math.min(Number.isFinite(D.eliteT) ? D.eliteT : ELITE_AT_S, ELITE_AT_S, w.t + ELITE_AFTER_RANK_IV_S);
  }
  if (T.rank >= 4 && D.data.rankVT === undefined) {
    D.data.rankVT = w.t;
    D.bossT = Math.min(Number.isFinite(D.bossT) ? D.bossT : BOSS_AT_S, BOSS_AT_S, w.t + BOSS_AFTER_RANK_V_S);
  }

  if (w.cheats.noSpawns) {
    D.spawnBudget = 0;
    if (w.t >= D.nextWaveT) D.nextWaveT = w.t + WAVE_MIN_S;
    return;
  }
  // GATEKEEPERS §4.3: the finale — the director spawns nothing and banks nothing
  if (w.gates.finaleT > 0) {
    if (w.t >= D.nextWaveT) D.nextWaveT = w.t + WAVE_MIN_S;
    return;
  }

  // ── budget ──
  const rate = budgetRate(w);
  // v2 RED LIGHT (FEATURES_V2 §6.1, pre-wired): the budget does not bank and waves are held
  const red = redLightActive(w);
  if (!red) {
    D.spawnBudget += rate * w.dt;
    const cap = rate * (WAVE_MIN_S + WAVE_SPAN_S) * BANK_WAVES + 10;
    if (D.spawnBudget > cap) D.spawnBudget = cap;
  }

  // ── boss ── moved to meta/gates.ts stepGates (GATEKEEPERS §4.1 / §7.3)

  // ── elite(s) ── (GATEKEEPERS §2.8: never while a gate lock, slot 1–3, is pending or any fight is alive)
  const gatePending = w.gates.pending >= 1 && w.gates.pending <= 3;
  // GATEKEEPERS §2.8: with the gates live, the first RAMROD waits for SWITCHBOARD-5's kill (D.eliteT is set from
  // killT[3] above; the old ELITE_AT_S 390 default must not fire first), never on a kill tick before its breach
  // flush (w.gates.active / breachDue still set), and the rank IV rule only for the dev bypass (Size IV without it)
  const eliteOpen = Number.isFinite(w.gates.killT[3]) || (T.rank >= 3 && w.gates.active === 0 && w.gates.breachDue === 0);
  if (!D.bossSpawned && !gatePending && !fightAlive(w) && eliteOpen && w.gates.active === 0 && w.gates.breachDue === 0) {
    // p20: the gates.ts float convention (accumulated w.t reads 829.6666666666 against a 829.67 schedule; the
    // 20-minute run exposed the one-tick-late RAMROD, probe_gatekeepers case 14)
    if (D.elitesSpawned === 0 && w.t >= D.eliteT - 1e-9) spawnElite(w);
    else if (D.elitesSpawned > 0 && D.elitesSpawned < ELITE_MAX) {
      let eliteAlive = false;
      for (let i = 0; i < w.enemies.length; i++) { const e = w.enemies[i]; if (e.alive && e.kind === 'elite') { eliteAlive = true; break; } }
      const last = D.data.lastEliteT ?? D.eliteT;
      // p20: the "20 s before the boss" guard reads the city boss's real due time once it is locked (D.bossT is
      // only the 1250 s cap now), so no RAMROD is fielded right before the city boss arrives
      const cityDue = w.gates.pending === 4 ? w.gates.dueT : Infinity;
      // p20: no REPEAT RAMROD within ELITE_CITY_LEVELS levels of the city lock (≈ 70 s of Size IV levels), so the
      // last one is down before the city boss arrives (the 10-minute run got that from the 520 s cutoff)
      const nearCity = T.level >= RANK_LEVELS[4] - ELITE_CITY_LEVELS;
      if (!eliteAlive && !nearCity && w.t >= last + ELITE_REPEAT_S - 1e-9 && w.t < Math.min(D.bossT, cityDue) - 20) spawnElite(w);
    }
  }

  // ── waves ──
  if (red) {
    if (Number.isFinite(D.nextWaveT)) D.nextWaveT += w.dt;   // v2 RED LIGHT: the wave clock stands still
  } else if (w.t >= D.nextWaveT) {
    runWave(w);
    D.nextWaveT = w.t + WAVE_MIN_S + WAVE_SPAN_S * w.rng.spawn();
  }
  D.data.budgetRate = rate;
  D.data.ring = clamp(ringRadius(w), 0, 1e6);
}
