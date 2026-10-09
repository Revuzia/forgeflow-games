// GENESIS — SIM perf push 2: the deterministic TIME-LAPSE level of detail (CONTRACT.md §5 note, sim.ts header).
//
// The player's speed preset is a LOGGED sim input: the worker issues `time.scale` when the preset changes the level
// (1x / 10x → level 0, 100x → 1, 1000x → 2). It is recorded in the command log, saved (Universe.settings.lapse) and
// replayed by rewind, so the same seed + the same command log (speed changes included) give the same hash.
//
// At level 0 nothing differs from a sim that never heard of time-lapse: every system runs on its base cadence and no
// state is kept (settings.lapse is absent) — except the coarse schedule of DEAD worlds (below, `dormant`), which holds at
// every level. At levels 1 and 2 the slow, smooth systems run on coarser FIXED cadences with proportionally larger
// steps (LAPSE_* below; each system scales its own rates by the elapsed time it is handed):
//   climate      60 →  120 / 360 ticks   (one pass integrates 2 / 6 hours: the energy balance and everything temperature
//                                        drives step hour by hour under each hour's sun — round 2; the soil hour below)
//   vegetation   60 →  120 / 480         (plants change over days: each pass grows the hours it stands for)
//   biomes      720 →  720 / 1440
//   weather      10 →   20 /  30         (systems drift and age the whole interval; rain batches follow the sky; the
//                                        overlay of rain / cloud / wind under them is redrawn every 2nd / 4th step)
//   sand / ash   10 →   20 /  30         (terrain.ts: wind-blown sand and ash, a third of the grid per pass as before)
//   rain batch   10 →   20 /  30         (hydrology.ts: one batch carries the whole period's rain)
//   hydrology     2 →    2 / 4 or 2     (hydrology.ts: a 4-tick step keeps the per-step gain — the CFL bound — and
//                                        takes half the per-step friction: steady flows carry the same discharge per
//                                        tick. Round 2: only while the sea is calm — `coarseIf`, a pure function of
//                                        state — since free waves then lost a quarter of the 1x friction per game tick
//                                        and the whole sea stayed awake for days after a quake or a tsunami)
//   sheet flow    2 →    4 /  12         (hydrology.ts: thin overland films, zero inertia: flux ∝ the step)
//   soil hour     — every hour the climate pass skips (climate.ts soilHour: evaporation and infiltration of the
//                  land stay hourly at every level, so rain that runs off between passes still soaks in)
//   keyframes  2880 → 2880 / 5760       (rewind spacing; not state)
//   settlement re-planning (people/settlement.ts: caches, roles, work lists) ×2 / ×3; what integrates time stays hourly
// What the player sees at 100x / 1000x is snapshots ~100 ms apart = 170 / 1 700 game minutes: the coarser cadences
// stay below that.
//
// Exactness across a change of level: each scheduled system keeps the tick it last ran (settings.lapse.run, per planet
// and system) while time-lapse is or was active, and integrates exactly the ticks since then — a step after a switch is
// as long as the time that really passed, nothing is integrated twice or skipped. Back at level 0 each record is
// consumed by the system's next step, and once none is left the state is dropped again (the hash of a world played at
// 1x / 10x never depends on whether it once ran at 1000x — except through what happened at 1000x, of course).

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { CommandRegistry } from '../god/commands.ts';
import { anyFlag, countCommonBits } from '../core/activeset.ts';

export type LapseLevel = 0 | 1 | 2;

/** saved time-lapse state (Universe.settings.lapse; absent = level 0 with nothing pending) */
export interface LapseState {
  /** the requested speed multiplier the level came from (the worker's preset) */
  scale: number;
  /** last run tick of each scheduled system, by `${planet}:${system}` */
  run: Record<string, number>;
}

/** a system on a time-lapse schedule: base cadence (ticks) and its multiplier per level */
export interface LapseSys {
  key: string;
  base: number;
  mult: readonly [number, number, number];
  /** due when (ts − phase) mod cadence < window[level] (rain batches: the first hydrology step at or after the sky
   * step, so the window is the hydrology cadence of the level) */
  window: readonly [number, number, number];
  /** it only ever runs on ticks that are multiples of this (systems called from the hydrology step: 2) */
  step: number;
  /** cadence multiplier on a dormant world (1 = none) */
  dormant: number;
  /** a state-dependent coarse cadence: the level's multiplier applies only while this holds — a pure function of the
   * planet's state, asked on the ticks the coarse schedule is due (exact and deterministic: lapseDue keeps the records
   * across a flip) */
  coarseIf?: (p: Planet) => boolean;
}

/** a dead world's slow passes (climate, vegetation) run this many times less often (see `dormant` below) */
export const DORMANT_MULT = 6;

export const LAPSE_CLIMATE: LapseSys = {
  key: 'clim', base: 60, mult: [1, 2, 6], window: [1, 1, 1], step: 1, dormant: DORMANT_MULT,
};
export const LAPSE_VEG: LapseSys = {
  key: 'veg', base: 60, mult: [1, 2, 8], window: [1, 1, 1], step: 1, dormant: DORMANT_MULT,
};
export const LAPSE_WEATHER: LapseSys = { key: 'wx', base: 10, mult: [1, 2, 3], window: [1, 1, 1], step: 1, dormant: 1 };
/** hydrology: every 2 ticks; at 1000x every 4 — but only while the sea is calm (push 2 round 2; calmSea below). A
 * 4-tick step keeps the per-step gain (the CFL bound) and halves the per-step friction: a steady flow carries the same
 * discharge per tick, but a free wave loses a quarter of the 1x friction per game tick, so after a quake or a tsunami
 * the whole sea stayed awake 3-5x longer than at 1x (days of 1000x at a third of its speed). With waves on the sea the
 * pipes now run exactly as at 1x; a calm sea — the usual state: no sea cell wakes in an idle day on the home world, a
 * few dozen off river mouths in a monsoon — keeps the 4-tick step (~20 % of 1000x idle, ~35 % in a monsoon). */
export const LAPSE_HYDRO: LapseSys = { key: 'hydro', base: 2, mult: [1, 1, 2], window: [1, 1, 1], step: 2, dormant: 1, coarseIf: calmSea };
/** the rain batch rides on the sky period (= the weather cadence); window = the longest hydrology cadence of the level
 * (with the sea awake at 1000x the steps are 2 ticks apart: a second, 2-tick batch then falls in the window — exact) */
export const LAPSE_RAIN: LapseSys = { key: 'rain', base: 10, mult: [1, 2, 3], window: [2, 2, 4], step: 2, dormant: 1 };
/** biome classification (biomes.ts): twice a day, daily at 1000x */
export const LAPSE_BIOME: LapseSys = { key: 'biome', base: 720, mult: [1, 1, 2], window: [1, 1, 1], step: 1, dormant: 1 };
/** wind on sand and ash (terrain.ts; the terrain step's phase is +5) */
export const LAPSE_SAND: LapseSys = { key: 'sand', base: 10, mult: [1, 2, 3], window: [1, 1, 1], step: 1, dormant: 1 };
/** thin overland sheets: every hydrology step, every 2nd (100x), every 3rd 4-tick step (1000x) */
export const LAPSE_SHEETS: LapseSys = { key: 'sheet', base: 2, mult: [1, 2, 6], window: [1, 1, 1], step: 2, dormant: 1 };
/** systems whose last run is recorded when time-lapse starts (all scheduled systems; phases as sim.ts runPlanet) */
const SYSTEMS: { sys: LapseSys; phase: number; stagger: boolean }[] = [
  { sys: LAPSE_CLIMATE, phase: 0, stagger: true },
  { sys: LAPSE_VEG, phase: 30, stagger: true },
  { sys: LAPSE_WEATHER, phase: 0, stagger: true },
  { sys: LAPSE_HYDRO, phase: 0, stagger: false },
  { sys: LAPSE_RAIN, phase: 0, stagger: true },
  { sys: LAPSE_SHEETS, phase: 0, stagger: false },
  { sys: LAPSE_SAND, phase: 5, stagger: true },
  { sys: LAPSE_BIOME, phase: 360, stagger: true },
];
/** keyframe spacing multiplier per level (Sim.keyframeEvery × this) */
export const KEYFRAME_MULT: readonly [number, number, number] = [1, 1, 2];

/** the level a speed multiplier asks for */
export function levelOfScale(scale: number): LapseLevel {
  return scale >= 1000 ? 2 : scale >= 100 ? 1 : 0;
}

/** the current time-lapse level */
export function lapseLevel(u: Universe): LapseLevel {
  const la = u.settings.lapse;
  return la ? levelOfScale(la.scale) : 0;
}

/** the current cadence (ticks) of a scheduled system */
export function lapseCadence(u: Universe, sys: LapseSys): number {
  return sys.base * sys.mult[lapseLevel(u)];
}

/** the planet stagger of runPlanet (slow passes of different worlds never share a tick) */
export function stagger(p: Planet): number {
  return p.id * 13;
}

function mod(a: number, m: number): number {
  const r = a % m;
  return r < 0 ? r + m : r;
}

/**
 * Is `sys` due on planet p at the current tick (ts = tick + stagger when the system is staggered)? Returns the number
 * of ticks this run must integrate, 0 when not due. Without time-lapse state and on a living world: the base cadence,
 * exactly as before. A system with no record has been running on its base cadence (that is what a record-less state
 * means): its first coarse run after a change integrates from its last base run.
 */
export function lapseDue(u: Universe, p: Planet, sys: LapseSys, ts: number, phase: number): number {
  let la = u.settings.lapse;
  const onBase = mod(ts - phase, sys.base) < sys.window[0];
  // a dormant world (no air, water, life, weather, lava or fire: perf/lapse.ts dormant) runs its slow passes coarser
  const dm = sys.dormant > 1 && onBase && dormant(u, p) ? sys.dormant : 1;
  if (!la && dm === 1) return onBase ? sys.base : 0;
  const lv = la ? levelOfScale(la.scale) : 0;
  let mult = sys.mult[lv] > dm ? sys.mult[lv] : dm;
  const key = runKey(p.id, sys);
  // a state-dependent coarse cadence (hydrology at 1000x: only while the sea is calm). The state is asked on the ticks
  // the coarse schedule is due; the block it decides lasts to the next of them: a coarse run leaves a record, a fine
  // one consumes it, so a base tick inside the block is fine exactly when no record is pending (saved state: exact
  // across save / load and rewind)
  if (mult > 1 && sys.coarseIf !== undefined) {
    if (!onBase) return 0;
    if (mod(ts - phase, sys.base * mult) < sys.window[lv]) {
      if (!sys.coarseIf(p)) mult = dm;
    } else if (la === undefined || la.run[key] === undefined) mult = dm;
  }
  const cad = sys.base * mult;
  const t = u.tick;
  if (mod(ts - phase, cad) >= sys.window[lv]) {
    // entering a dormant schedule between its runs: the last run was the base one just before
    if (dm > 1 && (!la || la.run[key] === undefined)) {
      if (!la) { la = { scale: 1, run: {} }; u.settings.lapse = la; }
      la.run[key] = lastBaseRun(t, ts - t, sys, phase);
    }
    return 0;
  }
  if (!la) { la = { scale: 1, run: {} }; u.settings.lapse = la; }
  const last = la.run[key];
  const dt = last === undefined ? lastBaseGap(t, ts - t, sys, phase) : last >= t ? cad : t - last;
  if (mult > 1) la.run[key] = t;
  else if (last !== undefined) {
    delete la.run[key];
    // back at level 0, nothing dormant and nothing pending: forget time-lapse entirely
    if (lv === 0 && Object.keys(la.run).length === 0) delete u.settings.lapse;
  }
  return dt;
}

/** ticks since the base-cadence run before t (a system without a record has been on its base cadence) */
function lastBaseGap(t: number, offset: number, sys: LapseSys, phase: number): number {
  return t - lastBaseRun(t, offset, sys, phase);
}

// ───────────────────────────── dormant worlds ─────────────────────────────
//
// A world with no air, no water anywhere (no sea, nothing awake), no life (plants, people, herds), no weather, no
// vents, springs, lava or fire, that the camera is not on, has nothing for its hourly passes to do but swing its
// temperature between day and night (a dead moon). Its climate and vegetation passes then run every 6 hours (each
// integrating the hours it stands for, as in time-lapse). The test is a pure function of the planet's state (and the
// logged camera focus), made at each base tick of those systems, so it wakes exactly: air, water, seeds, people, a
// meteor's fire — anything that changes one of these — puts the world back on hourly passes at the next hour, and that
// first pass integrates exactly the hours since the last one.

/** is p a dead world right now (evaluated at the base ticks of the systems that slow down on one: twice an hour)? The
 * world the camera is on (the logged `focus`) is never dormant: the player is looking at it */
export function dormant(u: Universe, p: Planet): boolean {
  if (p.airy || (u.focus !== null && u.focus.planet === p.id)) return false;
  const ps = p.people;
  return p.hydro.oceanCells === 0 && p.springs.length === 0 && p.vents.length === 0 && p.weather.length === 0
    && p.vegTotal <= 0 && !p.vegDirty && (!ps || (ps.agents.count === 0 && ps.settlements.length === 0 && ps.herds.length === 0))
    && !anyFlag(p.s.hAct, p.count) && !anyFlag(p.s.lAct, p.count) && !anyFlag(p.s.fAct, p.count) && noWater(p);
}

/** the sea is calm (LAPSE_HYDRO.coarseIf): fewer than 1 in 256 of its cells awake, and fewer than 128 in any case —
 * the churn off river mouths in a downpour (tens of cells) or a pond-sized sea that never settles (twoworlds' Rust: all
 * 89 cells) is calm, a wave crossing a sea (a tsunami, a quake's seiche: hundreds to thousands of cells) is not. A
 * world without a sea counts as calm */
function calmSea(p: Planet): boolean {
  const n = p.hydro.oceanCells;
  if (n === 0) return true;
  const k = n >> 8 > 128 ? n >> 8 : 128;
  return countCommonBits(p.s.hAct, p.s.ocean, p.count, k) < k;
}

/** no standing water and no lava anywhere (a sleeping puddle is not awake, but it is water) */
function noWater(p: Planet): boolean {
  const w = p.f.water, l = p.f.lava;
  for (let c = 0; c < p.count; c++) if (w[c] > 0 || l[c] > 0) return false;
  return true;
}

/** `${planet}:${system}` record keys, made once (a template string per call was garbage on every tick of every world) */
const keyCache = new Map<LapseSys, string[]>();
function runKey(planet: number, sys: LapseSys): string {
  let a = keyCache.get(sys);
  if (!a) { a = []; keyCache.set(sys, a); }
  let k = a[planet];
  if (k === undefined) { k = `${planet}:${sys.key}`; a[planet] = k; }
  return k;
}

/** the last tick < t at which `sys` ran on its base cadence (ts = t + offset) */
function lastBaseRun(t: number, offset: number, sys: LapseSys, phase: number): number {
  // the largest t' < t on the system's step grid with (t' + offset − phase) mod base < window
  for (let k = 1; k <= sys.base * sys.step; k++) {
    const tt = t - k;
    if (mod(tt, sys.step) === 0 && mod(tt + offset - phase, sys.base) < sys.window[0]) return tt;
  }
  return t - sys.base;
}

/**
 * Set the time-lapse level from a speed multiplier (the `time.scale` command). Level 0 with nothing pending keeps no
 * state at all. Every system that goes coarse at the new level and has no record yet records when it last ran on its
 * base cadence (a record-less system has been on it — at level 0, or at level 1 for those whose level-1 multiplier is
 * 1, such as the biomes: round 2 fixed 100x → 1000x, which used to skip this and lose up to one base period).
 */
export function setTimeScale(u: Universe, scale: number): LapseLevel {
  const lv = levelOfScale(scale);
  let la = u.settings.lapse;
  if (lv > 0) {
    for (const p of u.planets) {
      for (const { sys, phase, stagger: st } of SYSTEMS) {
        if (sys.mult[lv] === 1) continue;
        if (!la) { la = { scale, run: {} }; u.settings.lapse = la; }
        const key = runKey(p.id, sys);
        if (la.run[key] === undefined) la.run[key] = lastBaseRun(u.tick, st ? stagger(p) : 0, sys, phase);
      }
    }
  }
  if (!la) return lv;
  la.scale = scale;
  if (lv === 0 && Object.keys(la.run).length === 0) delete u.settings.lapse;
  return lv;
}

const LEVEL_NAMES = ['real time', 'time-lapse (100x)', 'deep time-lapse (1000x)'];

/** register `time.scale` (the worker issues it when the speed preset changes the level) */
export function registerTimeScale(r: CommandRegistry): void {
  r.register('time.scale', ({ u }, a) => {
    const scale = Number(a.scale);
    const lv = setTimeScale(u, scale);
    return { ok: true, msg: `The sim runs in ${LEVEL_NAMES[lv]}.` };
  }, {
    desc: 'Time-lapse level from the speed preset (logged: coarser cadences at 100x and 1000x)', category: 'Time',
    params: { scale: { type: 'number', required: true, min: 0, max: 1e6, desc: 'speed multiplier' } },
  });
}
