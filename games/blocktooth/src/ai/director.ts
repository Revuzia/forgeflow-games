// BLOCKTOOTH — the HALVARD CIVIL DEFENSE dispatch desk (ai lane, CONTRACT §5.3, §9).
// THREE-free, DOM-free, deterministic: every roll comes from world.rng.spawn.
//
//   * Spawn budget accrues 1.2 + 0.9·min(t,600)/60 + 0.6·rank points per second (× 0.3 once the
//     boss is on the field). A wave fires every 6–9 s and spends the budget on the kinds the
//     titan's rank allows (ENEMIES[k].minRank; PICKET SQUADs only after 45 s), weighted by a
//     per-rank mix × the biome's enemyBias, respecting per-kind caps and CITY.maxEnemies.
//   * Groups: CROSSING WARDENs arrive in pairs/trios along a street, PICKET SQUADs as five in a
//     wedge (one squad id), GNATs in small clusters, vehicles one at a time on road lanes.
//   * First appearance of a category raises its alert (spawnEnemy emits it, so squads deployed by
//     a BULWARK or a cheat spawn count too).
//   * Elite: RAMROD at min(ELITE_AT_S, t(rank IV) + 30) → `alert elite` + `eliteSpawn`, run.phase
//     'elite'. While the phase lasts and none is alive, another follows every ELITE_REPEAT_S
//     (max ELITE_MAX) so the chest economy survives a fast kill.
//   * Boss: at min(BOSS_AT_S, t(rank V) + 20) → spawnBoss(w, biome.boss) (which raises
//     `alert boss`, emits `bossSpawn`, sets director.bossSpawned and run.phase 'boss').
//   * cheats.noSpawns: nothing is fielded (waves, trickle, elite, scheduled boss) and the
//     budget does not bank; timers keep running so switching it off resumes the schedule.

import type { DirectorState, EnemyKind, World } from '../core/types.ts';
import { BOSS_AT_S, BOSS_FRAME, CAMERA, CITY, DIRECTOR_BUDGET_RANK_MUL, ELITE_AT_S, bossFrameFitAt, bossFrameNeed, frameDistance } from '../core/config.ts';
import { TAU, clamp } from '../core/math.ts';
import { BIOMES } from '../data/biomes.ts';
import { ENEMIES } from '../data/enemies.ts';
import { ringPoint, ringRadius, spawnEnemy } from './enemies.ts';
import { spawnBoss } from './bosses/index.ts';

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
const ELITE_MAX = 3;
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

function weightOf(w: World, k: EnemyKind): number {
  const bias = BIOMES[w.biomeId].enemyBias[k];
  const b = bias !== undefined && Number.isFinite(bias) ? Math.max(0, bias) : 1;
  return (w.boss && w.boss.alive ? BOSS_MIX[k] : MIX[k][w.titan.rank]) * b;
}

/** Budget points per second at the current time/rank (§9). */
export function budgetRate(w: World): number {
  const r = (1.2 + (0.9 * Math.min(w.t, 600)) / 60 + 0.6 * w.titan.rank) * (DIRECTOR_BUDGET_RANK_MUL[w.titan.rank] ?? 1);
  return w.boss && w.boss.alive ? r * BOSS_SPAWN_MUL : r;
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
/** BOSS FRAMING (config BOSS_FRAME / bossFrameNeed): hold the widest distance the boss, its live
 *  telegraphs and the titan needed, release it after BOSS_FRAME.holdS at BOSS_FRAME.releaseOmega; ease
 *  the look-target offset toward the need's at BOSS_FRAME.offsetOmega. The spawn ring and the camera
 *  read the result through config frameDistance / frameOffset (never below the curve); the ring reads
 *  spawnView, which adds a replica of the rig's own smoothing (camD / camOx / camOz). */
function stepBossFrame(w: World): void {
  const D = w.director, dat = D.data;
  const b = w.boss;
  if (!b || !b.alive) {
    if (dat.bossFrameD) { dat.bossFrameD = 0; dat.bossFrameHoldT = 0; dat.bossFrameHeld = 0; dat.bossFrameOx = 0; dat.bossFrameOz = 0; }
    dat.camD = 0; dat.camDv = 0; dat.camOx = 0; dat.camOz = 0;
    return;
  }
  const dt = w.dt;
  const need = bossFrameNeed(w);
  // the look-target offset eases toward the need's
  const ko = 1 - Math.exp(-BOSS_FRAME.offsetOmega * dt);
  const ox0 = dat.bossFrameOx ?? 0, oz0 = dat.bossFrameOz ?? 0;
  const ox = ox0 + (need.ox - ox0) * ko, oz = oz0 + (need.oz - oz0) * ko;
  dat.bossFrameOx = ox; dat.bossFrameOz = oz;
  // the distance the need asks for is HELD (no pumping between attacks), then released
  const cur = dat.bossFrameHeld ?? 0;
  if (need.d >= cur) { dat.bossFrameHeld = need.d; dat.bossFrameHoldT = 0; }
  else {
    const held = (dat.bossFrameHoldT ?? 0) + dt;
    dat.bossFrameHoldT = held;
    if (held > BOSS_FRAME.holdS) dat.bossFrameHeld = cur + (need.d - cur) * (1 - Math.exp(-BOSS_FRAME.releaseOmega * dt));
  }
  // replica of the camera rig (render/camera.ts) offset smoothing: the rig's look target lags the
  // eased offset, so what the paint needs around THAT centre is a floor on the distance (not held —
  // it melts away as the slide lands), and the spawn ring (config spawnView) reads the same centre
  const kc = 1 - Math.exp(-CAMERA.frameOffOmega * dt);
  dat.camOx = (dat.camOx ?? 0) + (ox - (dat.camOx ?? 0)) * kc;
  dat.camOz = (dat.camOz ?? 0) + (oz - (dat.camOz ?? 0)) * kc;
  dat.bossFrameD = Math.max(dat.bossFrameHeld, bossFrameFitAt(dat.camOx, dat.camOz));
  // replica of the rig's critically damped distance spring (spawnView keeps the ring off the view the
  // rig is STILL showing while it releases)
  const dStar = frameDistance(w);
  if (!(dat.camD > 0)) { dat.camD = dStar; dat.camDv = 0; }
  else {
    const om = CAMERA.zoomOmega, x0 = dat.camD - dStar, e = Math.exp(-om * dt), c = (dat.camDv ?? 0) + om * x0;
    dat.camD = dStar + (x0 + c * dt) * e;
    dat.camDv = (c - om * (x0 + c * dt)) * e;
  }
}

export function stepDirector(w: World): void {
  const D = w.director, T = w.titan;
  if (w.run.result || !T.alive) return;
  stepBossFrame(w);

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

  // ── budget ──
  const rate = budgetRate(w);
  D.spawnBudget += rate * w.dt;
  const cap = rate * (WAVE_MIN_S + WAVE_SPAN_S) * BANK_WAVES + 10;
  if (D.spawnBudget > cap) D.spawnBudget = cap;

  // ── boss ──
  if (!D.bossSpawned && w.t >= D.bossT) {
    spawnBoss(w, BIOMES[w.biomeId].boss);
    D.bossSpawned = true;
    w.run.phase = 'boss';
  }

  // ── elite(s) ──
  if (!D.bossSpawned) {
    if (D.elitesSpawned === 0 && w.t >= D.eliteT) spawnElite(w);
    else if (D.elitesSpawned > 0 && D.elitesSpawned < ELITE_MAX) {
      let eliteAlive = false;
      for (let i = 0; i < w.enemies.length; i++) { const e = w.enemies[i]; if (e.alive && e.kind === 'elite') { eliteAlive = true; break; } }
      const last = D.data.lastEliteT ?? D.eliteT;
      if (!eliteAlive && w.t >= last + ELITE_REPEAT_S && w.t < D.bossT - 20) spawnElite(w);
    }
  }

  // ── waves ──
  if (w.t >= D.nextWaveT) {
    runWave(w);
    D.nextWaveT = w.t + WAVE_MIN_S + WAVE_SPAN_S * w.rng.spawn();
  }
  D.data.budgetRate = rate;
  D.data.ring = clamp(ringRadius(w), 0, 1e6);
}
