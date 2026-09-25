// BLOCKTOOTH v2 — map objectives: OVERLOAD SITE, RELIEF DEPOT, RECORDS ANNEX (FEATURES_V2 §5). SIM:
// THREE-free, DOM-free, deterministic (placement draws only from w.rng.meta; guards via spawnEnemy, which
// draws rng.ai for its jitter — rng.spawn is untouched). Lane L4 (MAP-SIM). Exact exports of
// `ModObjectives` (_spec/features_v2_types.ts).
//
// Tick order (world.ts): processTriggers → stepObjectives → stepPowerups → chargeUltimate. stepObjectives:
//   1. MASS BREACH bookkeeping from this tick's `rankUp` events: a RECORDS ANNEX is owed 20 s later; a
//      prop-bound OVERLOAD SITE expires at the breach into Size II; a building-bound one whose tier is now
//      ≥ 2 below canFlatten expires; either is re-placed 3 s later at the new tier (§5.2);
//   2. completion, event-matched: `buildingCollapse` / `propDestroyed` with the bound id and NOT tagged
//      `noCredit` (a boss leg or RAMROD bringing it down never pays the titan). Read after processTriggers,
//      so trigger-proc collapses pay out that tick. RELIEF DEPOT completes on titan-circle overlap;
//   3. the state sweep: a bound building found collapsed (a bound prop found dead) without a credited
//      event this tick expires the objective (`objectiveExpire`) instead of sticking;
//   4. life / strand (> strandMul × spawnRing from the titan) expiry;
//   5. the scheduler (first / respawn per biome, caps, RELIEF placement rule, ANNEX dues; no candidate →
//      retry in 3 s).
// Payouts (§5.1): OVERLOAD SITE +35 UPROAR (× ultCharge, addUproar), XP = xpFrac × xpToNext(level) as ONE
// scrap pickup on the titan pre-aged + magnetised so the NEXT tick's stepPickups collects it before
// processTriggers (level-up procs fire normally; XP is never granted directly after processTriggers, §2.3),
// and one guaranteed power-up at the site (weighted, BACK PAY excluded); RELIEF DEPOT 3 heal pickups (or
// +8 UPROAR at ≥ 95 % HP); RECORDS ANNEX one chest pickup.
// Lane bookkeeping that MapState has no field for lives in w.director.data under 'map_*' keys (the same
// deterministic per-run bag spawnEnemy uses for its 'seen_*' alert flags): map_reliefLastT (last RELIEF
// placement), seen_overloadSite (the first-OVERLOAD alert).
//
// Measured (L4, 2026-09-25). probe_map K = `node _harness/probe_map.ts`, gate bot + _harness/bot_map.ts detours,
// fresh meta, seeds 1337/7/42/2024/99 (titans rotate), per-run medians; GATE 2 = `probe_sim.ts --det 2`, seed 1337.
//
//   | quantity (probe_map K medians)            | GRID-EAST | WHITE STACKS | LOCKWATER | asserted              |
//   |-------------------------------------------|-----------|--------------|-----------|-----------------------|
//   | OVERLOAD SITE shed / placed               | 8 / 9     | 9 / 11       | 7 / 8     | shed 5–12             |
//   | RELIEF DEPOT opened / placed              | 0 / 6     | 2 / 6        | 2 / 6     | —                     |
//   | RECORDS ANNEX placed (opened)             | 4 (1)     | 4 (1)        | 4 (1)     | placed = breaches (4) |
//   | power-up tokens dropped (collected)       | 10 (9)    | 10 (10)      | 10 (10)   | 4–12                  |
//
//   | GATE 2, seed 1337 (fresh / full meta)     | config start (§5.3 respawn, xpFrac 0.20, config drops) | tuned (below)    |
//   |-------------------------------------------|--------------------------------------------------------|------------------|
//   | clears · deaths                           | 12/12 · 0 (FAIL: deaths ≥ 1) / —                       | 10/12 · 2 / 11/12 · 1 |
//   | earliest Size V · earliest clear          | 403 s (floor 400) · 491 s                              | 423 s · 504 s / 430 s · 546 s |
//   | XP share via OVERLOAD SITE payouts        | 3.9 %                                                  | 2.4 % / 2.7 %    |
//   | DEMOLITION kills over the matrix          | 450                                                    | 210 / 227        |
//
// Tuning, in §14 order: OVERLOAD xpFrac 0.20 → 0.15 (MAP_TUNE; Size V had reached 403 s against the 400 s floor),
// then the OVERLOAD respawn +15 s per biome (data/objectives.ts), random power-up chances × 0.15 and DEMOLITION
// weight 18 → 9 (meta/powerups.ts PU_TUNE). Variants measured with _harness/scratch/l4/exp.ts. Pre-v2 GATE 2 on
// the same tree (stubs): 8/12 clears · 4 deaths; the map systems make the run easier (heals, chest drafts, screen
// clears), which is why the deaths ≥ 1 leg — not the rank bands — bound this lane's tuning.

import type { Building, MapState, Objective, ObjectiveKind, Prop, RankIndex, World } from '../core/types.ts';
import { CITY, OBJECTIVES, PERKS, RANKS, xpToNext } from '../core/config.ts';
import { spawnRing } from '../ai/director.ts';
import { spawnEnemy } from '../ai/enemies.ts';
import { spawnPickup } from '../combat/pickups.ts';
import { propRadius } from '../city/citygen.ts';
import { OBJECTIVE_BIOME, PROP_HEIGHT_M } from '../data/objectives.ts';
import { addUproar } from './ultimate.ts';
import { rollKind, spawnPowerup } from './powerups.ts';

// ─────────────────────────────── lane-local tuning ───────────────────────────────
/**
 * SUPERSEDES config.ts OBJECTIVES.overload.xpFrac (config.ts is L0's file; §2.2 lets the owning lane tune it,
 * §15.2 gives L4 no config edits, so the tuned value lives here — reported as a contract gap for the
 * orchestrator to fold back). Every other OBJECTIVES.* number is read from config.ts. Exported (mutable) so
 * probes can sweep it.
 */
export const MAP_TUNE = {
  /** config 0.20 → 0.15: at 0.20 Size V came at 403 s (band floor 400) on MOLO / GRID-EAST, seed 1337 */
  overloadXpFrac: 0.15,
  /** no candidate → retry after this (s) (§5.2) */
  retryS: 3,
  /** a building-bound OVERLOAD SITE expires at a breach when its tier ≤ canFlatten − this (§5.2) */
  breachTierGap: 2,
  /** candidate score weights (§5.2) */
  aheadMul: 1.5, cornerMul: 1.3, tier1Mul: 2, cornerFrac: 0.3,
  /** PICKET SQUAD size of a Size II ANNEX guard (= the director's SQUAD_SIZE) */
  squadSize: 5,
};

const MIN_T = 1e-9;
const KEY_RELIEF_LAST = 'map_reliefLastT';
const KEY_SEEN_OVERLOAD = 'seen_overloadSite';

// ─────────────────────────────── exports ───────────────────────────────
export function createMapState(): MapState {
  return {
    objectives: [], powerups: [],
    nextOverloadT: 0, nextReliefT: 0, annexDue: [], lastDropT: -1e9,
    redLightT: 0, rushHourT: 0,
    overloadsDone: 0, reliefsDone: 0, annexesDone: 0,
    overloadXp: 0, demolitionKills: 0,
  };
}

/** Event-matched completion + state sweep + expiry + scheduler (see the header). */
export function stepObjectives(w: World): void {
  const m = w.map;
  const T = w.titan;
  const live = !w.run.result || !!w.endless;
  if (!live) return;
  const ring = spawnRing(w);

  // ── 1. MASS BREACH (rankUp events of this tick) ──
  const ev = w.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type !== 'rankUp') continue;
    if (e.rank >= OBJECTIVES.annex.fromRank) m.annexDue.push(w.t + OBJECTIVES.annex.delayAfterBreachS);
    const can = RANKS[e.rank].canFlatten;
    for (const o of m.objectives) {
      if (!o.alive || o.kind !== 'overloadSite') continue;
      const stale = o.target === 'prop'
        ? e.rank >= 1
        : o.target === 'building' && (w.city.buildings[o.targetId]?.tier ?? 0) <= can - MAP_TUNE.breachTierGap;
      if (stale) {
        expire(w, o);
        m.nextOverloadT = w.t + MAP_TUNE.retryS;
      }
    }
  }

  // ── 2. event-matched completion (credited city events only) ──
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type !== 'buildingCollapse' && e.type !== 'propDestroyed') continue;
    if ((e as { noCredit?: boolean }).noCredit) continue;
    const tgt = e.type === 'buildingCollapse' ? 'building' : 'prop';
    for (const o of m.objectives) {
      if (o.alive && o.target === tgt && o.targetId === e.id) complete(w, o);
    }
  }

  // ── 3–4. contact, sweep, life, strand ──
  const strand = OBJECTIVES.strandMul * ring;
  for (const o of m.objectives) {
    if (!o.alive) continue;
    o.t += w.dt;
    if (o.target === 'building') {
      const b = w.city.buildings[o.targetId];
      if (!b || b.collapsed || b.alive <= 0) { expire(w, o); continue; }
    } else if (o.target === 'prop') {
      const p = w.city.props[o.targetId];
      if (!p || !p.alive) { expire(w, o); continue; }
    } else if (o.kind === 'reliefDepot' && T.alive) {
      const dx = T.x - o.x, dz = T.z - o.z, rr = T.radius + o.r;
      if (dx * dx + dz * dz <= rr * rr) { complete(w, o); continue; }
    }
    if (o.t >= o.life - MIN_T) { expire(w, o); continue; }
    if (T.alive && Math.hypot(T.x - o.x, T.z - o.z) > strand) { expire(w, o); continue; }
  }

  // ── 5. scheduler ──
  if (!T.alive) return;
  schedule(w);
}

/** Place one objective of `kind` now (scheduler + dev cheat). null when no candidate exists. */
export function spawnObjective(w: World, kind: ObjectiveKind): Objective | null {
  const T = w.titan;
  const ring = spawnRing(w);
  let o: Objective | null = null;
  if (kind === 'overloadSite') {
    o = T.rank === 0
      ? placeProp(w, kind, OBJECTIVE_BIOME[w.biomeId].overloadPropsS1, OBJECTIVES.overload.bandMin * ring, OBJECTIVES.overload.bandMax * ring, true)
      : placeBuilding(w, kind, OBJECTIVES.overload.bandMin * ring, OBJECTIVES.overload.bandMax * ring);
    if (o) o.life = OBJECTIVES.overload.lifeS;
  } else if (kind === 'recordsAnnex') {
    o = placeBuilding(w, kind, OBJECTIVES.annex.bandMin * ring, OBJECTIVES.annex.bandMax * ring);
    if (o) { o.life = OBJECTIVES.annex.lifeS; guard(w, o); }
  } else {
    o = placeProp(w, kind, OBJECTIVE_BIOME[w.biomeId].reliefProps, OBJECTIVES.relief.bandMin * ring, OBJECTIVES.relief.bandMax * ring, false);
    if (o) {
      const size = Math.max(OBJECTIVES.relief.sizeMinM, OBJECTIVES.relief.sizeH * T.height);
      o.target = 'none'; o.targetId = -1;
      o.r = 0.6 * size; o.h = size;
      o.life = OBJECTIVES.relief.lifeS;
      w.director.data[KEY_RELIEF_LAST] = w.t;
    }
  }
  if (!o) return null;
  w.map.objectives.push(o);
  w.events.push({ type: 'objectiveSpawn', id: o.id, kind: o.kind, x: o.x, z: o.z });
  if (kind === 'overloadSite' && !w.director.data[KEY_SEEN_OVERLOAD]) {
    w.director.data[KEY_SEEN_OVERLOAD] = 1;
    w.events.push({ type: 'alert', key: 'overloadSite' });
  } else if (kind === 'recordsAnnex') {
    w.events.push({ type: 'alert', key: 'recordsAnnex' });
  }
  return o;
}

/**
 * Dev / harness helper (not called by the sim; beyond the ModObjectives exports): place `kind` bound to the
 * eligible target NEAREST (x, z) instead of the §5.2 band pick — an OVERLOAD SITE on the nearest live static
 * prop of the biome's list at Size I (nearest standing building of tier canFlatten / −1 at Size II+), an ANNEX
 * on the nearest such building, a RELIEF crate exactly at (x, z). For real-input walk-in checks (playtest_v2
 * step 4: "a prop site 2 H ahead"), which testsurface's `objective(kind, ahead)` can only do for RELIEF.
 * Emits objectiveSpawn (+ the same alerts / ANNEX guard as the scheduler). null when nothing is eligible.
 */
export function placeObjectiveNear(w: World, kind: ObjectiveKind, x: number, z: number): Objective | null {
  const T = w.titan;
  let o: Objective | null = null;
  if (kind === 'reliefDepot') {
    o = newObjective(w, kind);
    const size = Math.max(OBJECTIVES.relief.sizeMinM, OBJECTIVES.relief.sizeH * T.height);
    o.x = x; o.z = z; o.r = 0.6 * size; o.h = size; o.life = OBJECTIVES.relief.lifeS;
    w.director.data[KEY_RELIEF_LAST] = w.t;
  } else if (kind === 'overloadSite' && T.rank === 0) {
    const kinds = OBJECTIVE_BIOME[w.biomeId].overloadPropsS1;
    let best = -1, bd = Infinity;
    for (const p of w.city.props) {
      if (!p.alive || p.lane !== -1 || !kinds.includes(p.kind)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p.id; }
    }
    if (best >= 0) {
      const p = w.city.props[best];
      o = newObjective(w, kind);
      o.x = p.x; o.z = p.z; o.target = 'prop'; o.targetId = p.id; o.r = propRadius(p.kind); o.h = PROP_HEIGHT_M[p.kind] ?? 2;
      o.life = OBJECTIVES.overload.lifeS;
    }
  } else {
    const can = RANKS[T.rank].canFlatten;
    let best = -1, bd = Infinity;
    for (const b of w.city.buildings) {
      if (b.collapsed || b.alive < 1 || (b.tier !== can && b.tier !== can - 1)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b.id; }
    }
    if (best >= 0) {
      const b = w.city.buildings[best];
      o = newObjective(w, kind);
      o.x = b.x; o.z = b.z; o.target = 'building'; o.targetId = b.id; o.r = 0.5 * Math.hypot(b.w, b.d); o.h = b.alive * b.floorH;
      o.life = kind === 'recordsAnnex' ? OBJECTIVES.annex.lifeS : OBJECTIVES.overload.lifeS;
      if (kind === 'recordsAnnex') guard(w, o);
    }
  }
  if (!o) return null;
  w.map.objectives.push(o);
  w.events.push({ type: 'objectiveSpawn', id: o.id, kind: o.kind, x: o.x, z: o.z });
  if (kind === 'overloadSite' && !w.director.data[KEY_SEEN_OVERLOAD]) {
    w.director.data[KEY_SEEN_OVERLOAD] = 1;
    w.events.push({ type: 'alert', key: 'overloadSite' });
  } else if (kind === 'recordsAnnex') {
    w.events.push({ type: 'alert', key: 'recordsAnnex' });
  }
  return o;
}

// ─────────────────────────────── scheduler ───────────────────────────────
function countLive(w: World, kind: ObjectiveKind): number {
  let n = 0;
  for (const o of w.map.objectives) if (o.alive && o.kind === kind) n++;
  return n;
}

function schedule(w: World): void {
  const m = w.map;
  const T = w.titan;
  const cfgB = OBJECTIVE_BIOME[w.biomeId];

  // OVERLOAD SITE
  const oCfg = OBJECTIVES.overload;
  const oMax = oCfg.maxActive + (w.meta.perk === 'perk_tip_line' ? PERKS.tipLineExtraOverload : 0);
  if (w.t >= oCfg.firstAtS - MIN_T && w.t >= m.nextOverloadT - MIN_T && countLive(w, 'overloadSite') < oMax) {
    const o = spawnObjective(w, 'overloadSite');
    m.nextOverloadT = w.t + (o ? cfgB.overloadRespawnS : MAP_TUNE.retryS);
  }

  // RELIEF DEPOT
  const rCfg = OBJECTIVES.relief;
  const rMax = T.rank >= 2 ? rCfg.maxActiveHigh : rCfg.maxActiveLow;
  if (w.t >= rCfg.firstAtS - MIN_T && w.t >= m.nextReliefT - MIN_T && countLive(w, 'reliefDepot') < rMax) {
    const last = w.director.data[KEY_RELIEF_LAST];
    const hurt = T.maxHp > 0 && T.hp / T.maxHp < rCfg.hpBelow;
    const stale = last === undefined || w.t - last >= rCfg.forceEveryS - MIN_T;
    if (hurt || stale) {
      const o = spawnObjective(w, 'reliefDepot');
      m.nextReliefT = w.t + (o ? cfgB.reliefRespawnS : MAP_TUNE.retryS);
    }
  }

  // RECORDS ANNEX (one per MASS BREACH, owed delayAfterBreachS after it)
  if (m.annexDue.length > 0 && w.t >= m.annexDue[0] - MIN_T) {
    const o = spawnObjective(w, 'recordsAnnex');
    if (o) m.annexDue.shift();
    else m.annexDue[0] = w.t + MAP_TUNE.retryS;
  }
}

/** payout + `objectiveDone` */
function complete(w: World, o: Objective): void {
  if (!o.alive) return;
  o.alive = false;
  o.done = true;
  const m = w.map;
  const T = w.titan;
  w.events.push({ type: 'objectiveDone', id: o.id, kind: o.kind, x: o.x, z: o.z });
  if (o.kind === 'overloadSite') {
    m.overloadsDone++;
    addUproar(w, OBJECTIVES.overload.uproar);
    const xp = MAP_TUNE.overloadXpFrac * xpToNext(T.level);
    if (xp > 0 && T.alive) {
      const id0 = w.nextId;
      spawnPickup(w, 'scrap', T.x, T.z, xp, 0);
      // collected by the NEXT tick's stepPickups (before processTriggers): pre-age past its collect delay
      // and latch the magnet; when the ground is at CITY.maxPickups the value merged into the pickup
      // nearest the titan instead (spawnPickup's own rule), which is already homing or resting nearby
      const p = w.pickups[w.pickups.length - 1];
      if (p && p.id === id0 && w.nextId === id0 + 1) { p.t = Math.max(p.t, 0.1); p.magnet = true; p.vx = 0; p.vz = 0; }
      m.overloadXp += xp;
    }
    m.nextOverloadT = Math.max(m.nextOverloadT, w.t + OBJECTIVE_BIOME[w.biomeId].overloadRespawnS);
    spawnPowerup(w, rollKind(w, true), o.x, o.z, true);
  } else if (o.kind === 'reliefDepot') {
    m.reliefsDone++;
    const cfg = OBJECTIVES.relief;
    if (T.maxHp > 0 && T.hp / T.maxHp >= 0.95) addUproar(w, cfg.fullHpUproar);
    else for (let i = 0; i < cfg.heals; i++) spawnPickup(w, 'heal', o.x, o.z, 0, 0);
    m.nextReliefT = Math.max(m.nextReliefT, w.t + OBJECTIVE_BIOME[w.biomeId].reliefRespawnS);
  } else {
    m.annexesDone++;
    spawnPickup(w, 'chest', o.x, o.z, 0, 0);
  }
}

/** `objectiveExpire`; the scheduler re-places after the respawn delay */
function expire(w: World, o: Objective): void {
  if (!o.alive) return;
  o.alive = false;
  o.done = false;
  const m = w.map;
  w.events.push({ type: 'objectiveExpire', id: o.id, kind: o.kind });
  if (o.kind === 'overloadSite') m.nextOverloadT = Math.max(m.nextOverloadT, w.t + OBJECTIVE_BIOME[w.biomeId].overloadRespawnS);
  else if (o.kind === 'reliefDepot') m.nextReliefT = Math.max(m.nextReliefT, w.t + OBJECTIVE_BIOME[w.biomeId].reliefRespawnS);
}

// ─────────────────────────────── placement (§5.2) ───────────────────────────────
interface Cand { id: number; s: number }
const CANDS: Cand[] = [];

function newObjective(w: World, kind: ObjectiveKind): Objective {
  return {
    id: w.nextId++,   // = core/world.ts newId (world.ts imports this module)
    kind, alive: true, x: 0, z: 0, target: 'none', targetId: -1, r: 0, h: 0, t: 0, life: 60,
    rank: w.titan.rank as RankIndex, done: false,
  };
}

function aheadMul(w: World, x: number, z: number): number {
  const T = w.titan;
  const dot = Math.sin(T.heading) * (x - T.x) + Math.cos(T.heading) * (z - T.z);
  return dot > 0 ? MAP_TUNE.aheadMul : 1;
}

/** mild continuous preference for the middle of the band (breaks the ties of the discrete multipliers) */
function bandMul(d: number, lo: number, hi: number): number {
  const mid = 0.5 * (lo + hi), half = Math.max(1e-6, 0.5 * (hi - lo));
  return 1 - 0.3 * Math.min(1, Math.abs(d - mid) / half);
}

function isCorner(w: World, b: Building): boolean {
  const c = w.city;
  const off = c.roadW / 2 + c.sidewalkW;
  const lx = c.originX + Math.round((b.x - c.originX) / c.pitch) * c.pitch;
  const lz = c.originZ + Math.round((b.z - c.originZ) / c.pitch) * c.pitch;
  const dx = Math.max(0, Math.abs(b.x - lx) - off), dz = Math.max(0, Math.abs(b.z - lz) - off);
  return Math.hypot(dx, dz) <= MAP_TUNE.cornerFrac * c.pitch;
}

function tooCloseToLive(w: World, x: number, z: number, minD: number): boolean {
  for (const o of w.map.objectives) {
    if (!o.alive) continue;
    const dx = o.x - x, dz = o.z - z;
    if (dx * dx + dz * dz < minD * minD) return true;
  }
  return false;
}

function blockHasLive(w: World, block: number): boolean {
  for (const o of w.map.objectives) {
    if (!o.alive || o.target !== 'building') continue;
    const b = w.city.buildings[o.targetId];
    if (b && b.block === block) return true;
  }
  return false;
}

/** weighted rng.meta pick among the best OBJECTIVES.topN of CANDS (sorted by score desc, id asc) */
function pick(w: World): number {
  if (CANDS.length === 0) return -1;
  CANDS.sort((a, b) => (b.s - a.s) || (a.id - b.id));
  const n = Math.min(OBJECTIVES.topN, CANDS.length);
  let total = 0;
  for (let i = 0; i < n; i++) total += CANDS[i].s;
  let r = w.rng.meta() * total;
  for (let i = 0; i < n; i++) {
    if (r < CANDS[i].s) return CANDS[i].id;
    r -= CANDS[i].s;
  }
  return CANDS[n - 1].id;
}

/** Size II+ OVERLOAD SITE / RECORDS ANNEX: a standing building at tier canFlatten (fallback canFlatten − 1). */
function placeBuilding(w: World, kind: ObjectiveKind, lo: number, hi: number): Objective | null {
  const T = w.titan;
  const can = RANKS[T.rank].canFlatten;
  for (const tier of [can, can - 1]) {
    if (tier < 0) break;
    CANDS.length = 0;
    const bs = w.city.buildings;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.collapsed || b.alive < 1 || b.tier !== tier) continue;
      const d = Math.hypot(b.x - T.x, b.z - T.z);
      if (d < lo || d > hi) continue;
      if (blockHasLive(w, b.block)) continue;
      const s = aheadMul(w, b.x, b.z) * (isCorner(w, b) ? MAP_TUNE.cornerMul : 1) * bandMul(d, lo, hi);
      CANDS.push({ id: b.id, s });
    }
    const id = pick(w);
    if (id < 0) continue;
    const b = bs[id];
    const o = newObjective(w, kind);
    o.x = b.x; o.z = b.z; o.target = 'building'; o.targetId = b.id;
    o.r = 0.5 * Math.hypot(b.w, b.d);
    o.h = b.alive * b.floorH;
    CANDS.length = 0;
    return o;
  }
  CANDS.length = 0;
  return null;
}

/** Size I OVERLOAD SITE (tier 1 × tier1Mul) or a RELIEF DEPOT anchor: a live static prop of `kinds`. */
function placeProp(w: World, kind: ObjectiveKind, kinds: readonly string[], lo: number, hi: number, preferTier1: boolean): Objective | null {
  const T = w.titan;
  const minD = 0.5 * CITY.pitch;
  CANDS.length = 0;
  const ps = w.city.props;
  for (let i = 0; i < ps.length; i++) {
    const p: Prop = ps[i];
    if (!p.alive || p.lane !== -1 || !kinds.includes(p.kind)) continue;
    const d = Math.hypot(p.x - T.x, p.z - T.z);
    if (d < lo || d > hi) continue;
    if (tooCloseToLive(w, p.x, p.z, minD)) continue;
    const s = aheadMul(w, p.x, p.z) * (preferTier1 && p.tier === 1 ? MAP_TUNE.tier1Mul : 1) * bandMul(d, lo, hi);
    CANDS.push({ id: p.id, s });
  }
  const id = pick(w);
  CANDS.length = 0;
  if (id < 0) return null;
  const p = ps[id];
  const o = newObjective(w, kind);
  o.x = p.x; o.z = p.z; o.target = 'prop'; o.targetId = p.id;
  o.r = propRadius(p.kind);
  o.h = PROP_HEIGHT_M[p.kind] ?? 2;
  return o;
}

/** RECORDS ANNEX guard (§5.3): Size II one PICKET SQUAD, Size III+ one BULWARK, beside the building on the
 *  titan's side (angle jitter from rng.meta). Skipped under the noSpawns cheat. */
function guard(w: World, o: Objective): void {
  if (w.cheats.noSpawns) return;
  const T = w.titan;
  const b = w.city.buildings[o.targetId];
  const half = b ? 0.5 * Math.max(b.w, b.d) : 4;
  const base = Math.atan2(T.x - o.x, T.z - o.z);
  const a = base + (w.rng.meta() - 0.5) * 1.2;
  const d = half + 6;
  const gx = o.x + Math.sin(a) * d, gz = o.z + Math.cos(a) * d;
  if (T.rank <= 1) {
    const sid = w.director.squadSeq++;
    const h = Math.atan2(T.x - gx, T.z - gz);
    const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
    for (let s = 0; s < MAP_TUNE.squadSize; s++) {
      const side = s === 0 ? 0 : (s % 2 === 1 ? -1 : 1) * Math.ceil(s / 2);
      const back = Math.ceil(s / 2) * 2.2;
      const e = spawnEnemy(w, 'squad', gx + rx * side * 2.4 - fx * back, gz + rz * side * 2.4 - fz * back, { squad: sid, slot: s });
      e.heading = e.pheading = h;
    }
  } else {
    spawnEnemy(w, 'apc', gx, gz);
  }
}
