// GENESIS — hydrology (CONTRACT.md §7.2): surface water as a virtual-pipes shallow-water model on the cell graph.
//
// Every directed edge e = (c -> o) carries a non-negative OUTFLOW f[e] (m³ per step) that persists between steps —
// that persistence is the momentum (a flood keeps rolling, a tsunami crosses the sea). Per step:
//   1. f[e] ← damping(d)·f[e] + K_e·(H_c − H_o),  K_e = G·w_e·min(d_e, DCAP)/L_e,  clamped ≥ 0
//      (H = surface + water; d_e = water depth above the higher bed across the edge, so water spills over lips and
//      never flows out of a dry cell; damping is friction: strong in thin films, weak in deep water)
//   2. outflows of a cell are scaled so it never sends more than it holds (positivity, no negative depths)
//   3. each cell's volume changes by inflow − outflow — every m³ leaving c arrives in o: mass is conserved to rounding
//      except for EXPLICIT sources/sinks (rain, springs, seepage, evaporation, infiltration, the sea relaxation,
//      commands), all of which are accounted in hydro.sourced.
// G is chosen per planet so a wave in water ≥ DCAP deep moves at WAVE_SPEED (m/tick) — the stylised speed of
// CONTRACT.md: a tsunami crosses a quarter of a 3 km world in ~300 ticks; rain on a hillside reaches the valley floor
// in tens of ticks — capped at C_WAVE cells per step so it stays CFL-safe (the symplectic pipe scheme is stable below
// ~0.8 on this lattice).
//
// Active set: only cells with moving water are stepped. A cell joins when anything changes its water or ground (rain,
// inflow, a brush, a command) and leaves after QUIET_STEPS quiet steps (its fluxes are dropped then — they are below
// the quiet threshold). A still ocean, a still lake and dry land cost nothing.
//
// The sea: cells below sea level connected to the deepest basin form the ocean mask. The ocean is a reservoir whose
// MEAN level relaxes toward the live sea level (uniform corrections keep waves intact); moving the sea-level slider
// ramps the level and floods / drains the mask as it goes. Rivers carve (erosion moves sand / soil downstream and
// deposits it where flow slows — deltas), floods leave wet ground, snow and ice melt into the system (climate.ts).
//
// SIM perf push 2:
//   * SHEETS (below, "sheets: thin overland flow"): land water shallower than SHEET_IN (2 cm, until it is deeper than
//     SHEET_OUT = 5 cm) runs as zero-inertia sheet flow — each step it sends its lower neighbours the pipes' steady-state
//     flux for the drop, with no momentum to carry and no quiet counter (about half the work of a pipe cell). On an
//     ordinary day ~2/3 of the awake cells are such films, ~85 % in a downpour. Lakes, rivers, floods, tsunamis and the
//     sea keep the momentum of the pipes. Mass is exchanged through the same dV / sink accounting, so it is conserved
//     exactly. Round 2: a sheet keeps its per-step edge outflow in the pipes' flux array, so velocities count inflow
//     and outflow alike (sheets and the rivers they feed: a monsoon carves as the pure pipes did) and a sheet that
//     deepens into the pipes starts with its flow as momentum.
//   * TIME-LAPSE (perf/lapse.ts, the logged speed level): at 100x the sheets step every 2nd step and rain batches come
//     every 20 ticks; at 1000x the sheets every 8 ticks (12 until SIM perf push 3 round 2: films left standing soaked
//     the soils; on a world the camera is not on they run on every 16-tick step — perf/lapse.ts LAPSE_SHEETS), the
//     rain every 30, and the hydrology every 4 ticks while the
//     sea is calm (same per-step gain — the CFL bound — and half the per-step friction, so a steady flow carries the
//     same discharge per tick) — with waves on the sea every 2, as at 1x (round 2: the 4-tick friction kept a quake's
//     seiche alive for days). Level 0 (1x, 10x) is the plain model above.
//   * SEDIMENT INTO THE SEA displaces sea water (an accounted sink; the mean-level relaxation spreads it back): a delta
//     raising the sea surface over itself kept the open sea awake at every river mouth in a downpour (round 2).

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { markRainDirty, rainingCells } from './climate.ts';
import { priorityFlood } from '../world/gen.ts';
import { collectFlags } from '../core/activeset.ts';
import { lapseDue, stagger, LAPSE_RAIN, LAPSE_SHEETS } from '../perf/lapse.ts';

export const HYDRO_CADENCE = 2;
/** depth (m) at which wave speed saturates (deeper water moves no faster: CFL safety) */
const DCAP = 20;
/** CFL cap: wave speed at DCAP never exceeds this many cells per step (stable below ~0.8 on this lattice) */
const C_WAVE = 0.6;
/** films thinner than this (m) do not flow: surface retention soaks them up (keeps drizzle from waking the world) */
export const DRY = 0.001;
/** friction: damping = 1 − (FR0 + FR1 / (1 + d / H0)) */
const FR0 = 0.009, FR1 = 0.09, H0 = 0.25;
/** a cell is quiet when its outflow and its level change per step are both below this (m): sub-millimetre ripples
 * on the open sea would otherwise keep every ocean cell awake forever */
const QUIET = 1e-4;
/** outflow per step as a fraction of the cell's water column below which a cell counts as still */
const QUIET_REL = 0.002;
const QUIET_STEPS = 4;
/** level difference (m) across a wet edge below which neighbours count as level: 2 mm in a puddle, ~2 cm over deep
 * water (an invisible swell on the open sea must not keep the whole ocean awake) */
const LEVEL_EPS = 0.002;
const LEVEL_EPS_DEPTH = 0.0008;
const LEVEL_EPS_MAXD = 25;
function levelEps(depth: number): number {
  return LEVEL_EPS + LEVEL_EPS_DEPTH * (depth < LEVEL_EPS_MAXD ? depth : LEVEL_EPS_MAXD);
}


/** how fast the ramping sea level moves (m per step) */
const SEA_RAMP = 0.3;

/**
 * Wake a cell (its water or ground just changed) and its WET neighbours. A neighbour holding no more than the retention
 * film (DRY) has nothing to send (the flux pass never moves water out of it) and does not need to be awake to receive
 * (the moves deliver to sleeping cells and wake them when the inflow is real). (Waking the dry banks of every river cell
 * the hourly climate touched kept hundreds of dry cells stepping for nothing.) Wet neighbours are all woken, lower ones
 * included: limiting this to higher neighbours let small level differences pile up unseen in a sleeping sea and later
 * release as basin-wide sloshing — the sea relies on these wakes along its shores.
 */
export function activateCell(p: Planet, c: number): void {
  const s = p.s, g = p.grid;
  const act = s.hAct, quiet = s.hQuiet, water = p.f.water, nbr = g.nbr;
  // (an awake sheet stays a sheet: the mode split of the next step decides by depth)
  if (act[c] === 0) act[c] = 1;
  quiet[c] = 0;
  const e1 = g.nbrStart[c + 1];
  for (let e = g.nbrStart[c]; e < e1; e++) {
    const o = nbr[e];
    if (water[o] <= DRY) continue;
    if (act[o] === 0) act[o] = 1;
    quiet[o] = 0;
  }
}

/**
 * Wake what a change of a cell's water needs awake, and nothing else (SIM perf push 2): the cell itself if it now
 * stands above a neighbour beyond the level tolerance (it has to send), and every sleeping wet neighbour that now stands
 * above it (they have to send). For the climate's slow exchanges (melt, evaporation, infiltration): activateCell woke
 * every wet neighbour of every coastal cell the hourly pass touched — in a downpour ~450 sea cells stepping for nothing
 * (water running off the land into the sea joins the reservoir directly, and land beside the sea stands above it).
 */
export function wakeIfUnlevel(p: Planet, c: number): void {
  const s = p.s, g = p.grid, f = p.f;
  const act = s.hAct, quiet = s.hQuiet, water = f.water, surf = f.surface, nbr = g.nbr;
  const w = water[c], sc = surf[c], Hc = sc + w;
  const e1 = g.nbrStart[c + 1];
  for (let e = g.nbrStart[c]; e < e1; e++) {
    const o = nbr[e];
    const wo = water[o], so = surf[o], Ho = so + wo;
    const bed = sc > so ? sc : so;
    if (Hc > Ho) {
      if (act[c] === 0 && w > DRY && Hc - Ho > levelEps(Hc - bed)) { act[c] = 1; quiet[c] = 0; }
    } else if (act[o] === 0 && wo > DRY && Ho - Hc > levelEps(Ho - bed)) { act[o] = 1; quiet[o] = 0; }
  }
}

export function activateCells(p: Planet, cells: ArrayLike<number>): void {
  for (let i = 0; i < cells.length; i++) activateCell(p, cells[i]);
}

/** stylised deep-water wave speed (m per tick): a quarter of a 3 km world (4.7 km) in ~300 ticks */
export const WAVE_SPEED = 15.7;

/**
 * Pipe gain G (m): deep water (>= DCAP) carries waves at WAVE_SPEED whatever the grid frequency, unless that would
 * exceed C_WAVE cells per step (CFL) on a very fine grid — then the cap wins.
 */
export function gain(p: Planet): number {
  const cells = Math.min(C_WAVE, (WAVE_SPEED * HYDRO_CADENCE) / p.edgeM);
  return (cells * cells * p.edgeM * p.edgeM) / DCAP;
}

// ───────────────────────────── ocean mask ─────────────────────────────

/**
 * Recompute the ocean mask: the cells below `level` connected (through cells below `level`) to the sea that is already
 * there. Seeds are every cell of the previous mask still below the level (so a sea that splits as it drains stays
 * sea, and cells dig-sea marked as sea join it). Only when no sea remains below the level does the mask restart from
 * the cell the last sea grew from (hydro.seedCell), and only when that is dry too from the deepest cell — the first sea
 * of a barren world fills the lowest basin. An inland pit, however deep, is never "the ocean" just for being deepest:
 * it is a basin that rain fills (it joins the sea only if the sea rises over its rim).
 */
export function computeOcean(p: Planet, level: number): number {
  const f = p.f, s = p.s, g = p.grid;
  const N = p.count;
  const q = p.scratch.list;
  let qt = 0;
  // seeds from the previous mask (index order: deterministic)
  for (let c = 0; c < N; c++) if (s.ocean[c] && f.surface[c] < level) q[qt++] = c;
  if (qt === 0) {
    const sc = p.hydro.seedCell;
    if (sc !== undefined && sc >= 0 && sc < N && f.surface[sc] < level) q[qt++] = sc;
    else {
      let deep = 0;
      for (let c = 1; c < N; c++) if (f.surface[c] < f.surface[deep]) deep = c;
      if (f.surface[deep] < level) q[qt++] = deep;
    }
  }
  s.ocean.fill(0);
  s.coast.fill(0);
  for (let i = 0; i < qt; i++) s.ocean[q[i]] = 1;
  let count = 0;
  if (qt > 0) {
    let qh = 0;
    while (qh < qt) {
      const c = q[qh++];
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (s.ocean[o] || f.surface[o] >= level) continue;
        s.ocean[o] = 1;
        q[qt++] = o;
      }
    }
    count = qt;
    let deepest = -1;
    for (let c = 0; c < N; c++) {
      if (!s.ocean[c]) continue;
      if (deepest < 0 || f.surface[c] < f.surface[deepest]) deepest = c;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (!s.ocean[o]) { s.coast[c] = 1; s.coast[o] = 1; }
      }
    }
    // remember where this sea lies, so a sea drained away and poured again comes back in the same basin
    p.hydro.seedCell = deepest;
  }
  p.hydro.oceanCells = count;
  p.hydro.maskLevel = level;
  p.hydro.maskDirty = false;
  // belt and braces: nothing cached may depend on the old mask (climate.ts rainingCells no longer filters by it)
  markRainDirty(p);
  return count;
}

/** set every ocean cell's water to reach `level` (ramping slider / generation); returns the volume added */
function fillOceanTo(p: Planet, level: number): number {
  const f = p.f, s = p.s, A = p.cellArea;
  let added = 0;
  for (let c = 0; c < p.count; c++) {
    if (!s.ocean[c]) continue;
    const target = Math.max(0, level - f.surface[c]);
    const d = target - f.water[c];
    if (d !== 0) {
      added += d * A[c];
      f.water[c] = target;
    }
  }
  return added;
}

function activateCoast(p: Planet): void {
  const s = p.s;
  for (let c = 0; c < p.count; c++) if (s.coast[c]) { s.hAct[c] = 1; s.hQuiet[c] = 0; }
}

/** per-planet derived constants and per-step scratch of the solver (a cache: never saved, rebuilt identically) */
interface HydroCache {
  /** pipe gain per directed edge, G · width / length (G = gain(p)) */
  K: Float64Array;
  /** largest outflow of each active cell this step (fluxPass -> finishActive) */
  maxOut: Float64Array;
  /** this step's awake sheet cells (ascending) */
  sheets: Int32Array;
  /** each sheet cell's main receiver this step (erosion drops its load there), -1 none */
  mainRcv: Int32Array;
}
const hydroCache = new WeakMap<Planet, HydroCache>();
function cacheOf(p: Planet): HydroCache {
  let h = hydroCache.get(p);
  if (!h) {
    const G = gain(p), wid = p.geo.width, len = p.geo.len;
    const K = new Float64Array(wid.length);
    for (let e = 0; e < K.length; e++) K[e] = (G * wid[e]) / len[e];
    h = { K, maxOut: new Float64Array(p.count), sheets: new Int32Array(p.count), mainRcv: new Int32Array(p.count) };
    hydroCache.set(p, h);
  }
  return h;
}

// ───────────────────────────── the step ─────────────────────────────
//
// The step is split into small kernels taking plain typed arrays: V8 optimises small monomorphic loops far better than
// one giant function (the active-list scan alone ran 13x slower inside the monolith).

/**
 * One hydrology step (every HYDRO_CADENCE ticks; `dt` = the ticks it covers). In 1000x time-lapse with a calm sea
 * (perf/lapse.ts) a step covers two: the pipes keep their per-step gain (the CFL bound) and take half the per-step
 * friction, so a steady flow carries the same discharge per tick while waves cross the world at half the speed in game
 * time; sources, thresholds and erosion are per step and scale with it. At dt = HYDRO_CADENCE every expression is the
 * plain one.
 */
export function hydroStep(u: Universe, p: Planet, dt = HYDRO_CADENCE): void {
  const hy = p.hydro, s = p.s, f = p.f, g = p.grid;
  hy.steps++;
  const kf = dt / HYDRO_CADENCE;
  // rain batches ride on the sky period, sheets run every step — both coarser in time-lapse (perf/lapse.ts)
  let sourced = applySources(p, lapseDue(u, p, LAPSE_RAIN, u.tick + stagger(p), 0), kf);
  sourced += seaUpkeep(p, kf);
  // the sheets' schedule is asked every step, work or not (a time-lapse record is consumed on schedule)
  const sheetDue = lapseDue(u, p, LAPSE_SHEETS, u.tick, 0);
  const list = p.scratch.list;
  const n = collectFlags(s.hAct, list, p.count);
  if (n === 0) { hy.sourced += sourced; return; }
  const hc = cacheOf(p);
  // the mode split: thin land water flows as sheets (zero inertia), everything else through the pipes (momentum)
  const np = splitModes(list, n, hc.sheets, f.water, s.ocean, s.hAct, s.hQuiet, s.flux, g.nbrStart);
  const ns = sheetCount;
  // ticks the sheets' flow covers this step (0 = not their step in time-lapse: they only take in what reaches them)
  const sheetDt = ns > 0 ? sheetDue : 0;
  sourced += fluxPass(
    list, np, g.nbrStart, g.nbr, g.rev, hc.K, f.surface, f.water, p.cellArea, s.flux, p.scratch.edge,
    s.ocean, s.hAct, s.hQuiet, p.scratch.dV, hc.maxOut, p.scratch.list2, kf,
  );
  if (sheetDt > 0) {
    sourced += sheetPass(
      hc.sheets, ns, g.nbrStart, g.nbr, g.rev, hc.K, f.surface, f.water, p.cellArea, s.flux, s.ocean, s.hAct, s.hQuiet, p.scratch.dV,
      p.scratch.list2, p.geo.tx, p.geo.ty, p.geo.tz, f.flowX, f.flowY, f.flowZ, hc.mainRcv, 1 / (3 * (p.edgeM / Math.sqrt(3))),
      sheetDt,
    );
  }
  applyFed(p.scratch.list2, fedCount, g.nbrStart, g.nbr, f.surface, f.water, p.cellArea, s.hAct, s.hQuiet, p.scratch.dV);
  applyActive(list, np, f.water, p.cellArea, p.scratch.dV, p.scratch.lastDv);
  if (ns > 0) applySheets(hc.sheets, ns, f.water, p.cellArea, p.scratch.dV, s.hAct, f.flowX, f.flowY, f.flowZ, g.nbrStart, s.flux);
  let eroded = finishActive(p, list, np, hc.maxOut, kf);
  if (sheetDt > 0 && p.cfg.erosion > 0) {
    const m = sheetErosion(p, hc.sheets, ns, hc.mainRcv, sheetDt / HYDRO_CADENCE);
    if (m > eroded) eroded = m;
  }
  hy.sourced += sourced;
  p.bump('water');
  p.bump('flowX'); p.bump('flowY'); p.bump('flowZ');
  // River erosion moves millimetres on most steps. Field versions cover whole arrays, so bumping surface / sand / soil
  // on every step re-sent ~160 KB arrays (and re-ran the client's curvature fit) several times a second in an idle
  // world. Publish the change once it can matter: when some cell may have moved by EROSION_PUBLISH metres (erodeAcc is
  // an upper bound: the sum of each step's largest single-cell change), or hourly. The sim itself always reads the
  // live arrays (and Planet.ground() keys on its own surface revision), so this only paces the snapshots.
  if (eroded > 0) hy.erodeAcc = (hy.erodeAcc ?? 0) + eroded;
  if ((hy.erodeAcc ?? 0) > 0 && ((hy.erodeAcc ?? 0) >= EROSION_PUBLISH || hy.steps % EROSION_PUBLISH_STEPS === 0)) {
    hy.erodeAcc = 0;
    p.bump('surface'); p.bump('sand'); p.bump('soil');
  }
}

/** erosion is published to snapshots once any cell may have moved this far (m), or every this many steps (hourly) */
const EROSION_PUBLISH = 0.02;
const EROSION_PUBLISH_STEPS = 30;

/**
 * Rain arrives in batches (SIM perf pass): once per sky period (RAIN_PERIOD ticks = the weather cadence), at the first
 * hydrology step at or after the moment the sky can change — the weather and climate passes run every RAIN_PERIOD ticks
 * on the planet's stagger (sim.ts runPlanet: `(tick + id * 13) % 10 === 0`, before the hydrology step of that tick) —
 * carrying the whole period's rain at the rate the sky shows for that period. Per-step rain touched every raining land
 * cell on every step (thousands of cells soaking a drizzle into dry soil); a 10-minute pulse is physically the same
 * rain, conserves mass exactly, and is stateless (a function of the tick), so save / load / rewind are unaffected.
 * Sky changes made by a command mid-period (a planet-wide override) reach the ground at the next period.
 */
const RAIN_PERIOD = 10;

export function rainBatchDue(tick: number, planetId: number): boolean {
  const ph = (tick + planetId * 13) % RAIN_PERIOD;
  return ph < HYDRO_CADENCE;
}

/** rain (on batch steps: `rainTicks` = the ticks of rain the batch carries, 0 = none), springs and aquifer seepage;
 * returns the volume added */
function applySources(p: Planet, rainTicks: number, kf: number): number {
  const f = p.f, s = p.s, g = p.grid, cfg = p.cfg;
  const water = f.water, surf = f.surface, A = p.cellArea, act = s.hAct, quiet = s.hQuiet;
  const nbrStart = g.nbrStart, nbr = g.nbr;
  let sourced = 0;
  if (rainTicks > 0 && p.airy && cfg.rainScale > 0) {
    const rc = rainingCells(p);
    const k = (cfg.rainScale * rainTicks) / 60 / 1000; // mm/h -> m per batch
    const kInf = rainTicks / 60; // per hour -> per batch
    const freeze = p.st.liquid.freeze;
    const infiltration = cfg.infiltration;
    const list = rc.list, ocean = s.ocean, precip = f.precip, temperature = f.temperature;
    const soil = f.soil, sand = f.sand, moisture = f.moisture, aquifer = f.aquifer;
    for (let i = 0; i < rc.count; i++) {
      const c = list[i];
      if (ocean[c]) continue; // rain on the sea (shelf included) is absorbed by the reservoir
      let d = precip[c] * k;
      sourced += d * A[c];
      // rain soaks in as it lands; only what the ground cannot drink runs off (Hortonian runoff) — light rain on
      // dry soil wakes nothing, a downpour or saturated ground sends sheets of water downhill
      if (infiltration > 0 && temperature[c] > freeze && water[c] <= DRY) {
        // permeability (climate.ts) × the period, less as the soil fills
        const so = soil[c], sa = sand[c];
        const perm = 0.004 * (0.25 + Math.min(1, so) + 2.5 * Math.min(1, sa)) * infiltration;
        const inf = Math.min(d, perm * kInf * (1.15 - moisture[c]));
        if (inf > 0) {
          // soak (climate.ts): soil moisture first, the overflow recharges the aquifer
          const cap = 0.4 * (so + sa + 0.08);
          let m = moisture[c] + inf / cap;
          if (m > 1) {
            aquifer[c] += (m - 1) * cap;
            m = 1;
          }
          moisture[c] = m;
          d -= inf;
          sourced -= inf * A[c];
        }
      }
      water[c] += d;
      // rain wakes a cell only once it can run somewhere: wet beyond the retention film and above a neighbour
      // (uniform rain on level ground keeps it level, so a soaked plain does not need stepping)
      if (act[c] === 0) wakeIfRunning(c, water, surf, nbrStart, nbr, act, quiet);
    }
  }
  for (const sp of p.springs) {
    const r = kf === 1 ? sp.rate : sp.rate * kf; // (per step)
    water[sp.cell] += r / A[sp.cell];
    sourced += r;
    act[sp.cell] = 1;
    quiet[sp.cell] = 0;
  }
  const seep = seepCells(p);
  for (let i = 0; i < seep.count; i++) {
    const c = seep.list[i];
    const d = Math.min(s.seep[c] * kf, f.aquifer[c]);
    if (d <= 0) continue;
    f.aquifer[c] -= d;
    water[c] += d;
    // groundwater is outside the surface-water budget: seepage is a source like a spring (conservedVolume)
    sourced += d * A[c];
    // like rain, a seep wakes its cell once the water can run somewhere (wet beyond the film, above a neighbour)
    if (act[c] === 0) wakeIfRunning(c, water, surf, nbrStart, nbr, act, quiet);
  }
  return sourced;
}

/** wake a sleeping cell that is wet beyond the retention film and stands above a neighbour (it can run there) */
function wakeIfRunning(c: number, water: Float64Array, surf: Float32Array, nbrStart: Int32Array, nbr: Int32Array, act: Uint8Array, quiet: Uint8Array): void {
  const w = water[c];
  if (w <= DRY) return;
  const sc = surf[c];
  const Hc = sc + w;
  const e1 = nbrStart[c + 1];
  for (let e = nbrStart[c]; e < e1; e++) {
    const o = nbr[e];
    const so = surf[o];
    const bed = sc > so ? sc : so;
    if (Hc - (so + water[o]) > levelEps(Hc - bed)) { act[c] = 1; quiet[c] = 0; return; }
  }
}

/** the sea: slider ramp, mask upkeep, mean-level relaxation; returns the volume added */
function seaUpkeep(p: Planet, kf: number): number {
  const hy = p.hydro, cfg = p.cfg;
  let sourced = 0;
  if (hy.maskDirty) computeOcean(p, hy.seaNow);
  const target = p.st.seaLevel;
  if (Math.abs(target - hy.seaNow) > 1e-9 && cfg.oceanRelax) {
    const ramp = SEA_RAMP * kf;
    const step = Math.max(-ramp, Math.min(ramp, target - hy.seaNow));
    hy.seaNow += step;
    // The ramp LIFTS (or lowers) the sea by the step: every cell keeps its anomaly, so a tsunami or a flood launched
    // while the sea is moving still runs (overwriting the sea with a flat level erased it). Only cells that join the
    // mask at this recompute are filled to the new level. `mark` tags the old mask.
    let stamp = 0;
    if (Math.abs(hy.seaNow - hy.maskLevel) >= 0.5 || Math.abs(target - hy.seaNow) < 1e-9) {
      stamp = p.nextMark();
      const mark = p.scratch.mark, ocean = p.s.ocean;
      for (let c = 0; c < p.count; c++) if (ocean[c]) mark[c] = stamp;
      computeOcean(p, hy.seaNow);
    }
    sourced += rampOcean(p, step, hy.seaNow, stamp);
    activateCoast(p);
  } else if (cfg.oceanRelax && hy.oceanCells > 0 && hy.steps % relaxSteps(kf) === 0) {
    const d0 = hy.seaNow - oceanMeanLevel(p.s.ocean, p.f.surface, p.f.water, p.cellArea, p.count);
    if (Math.abs(d0) > 0.004) {
      const d = Math.max(-0.03, Math.min(0.03, d0));
      sourced += shiftOcean(p.s.ocean, p.f.water, p.cellArea, p.count, d);
      activateCoast(p);
    }
  }
  return sourced;
}

/**
 * One ramp step of the sea: cells already in the sea move by `step` (anomalies kept); with a fresh mask (`stamp` ≠ 0
 * tags the previous one in scratch.mark) cells that just joined are filled to `level`. Returns the volume added.
 */
function rampOcean(p: Planet, step: number, level: number, stamp: number): number {
  const f = p.f, s = p.s, A = p.cellArea, mark = p.scratch.mark;
  let added = 0;
  for (let c = 0; c < p.count; c++) {
    if (!s.ocean[c]) continue;
    const w = f.water[c];
    let nw: number;
    if (stamp !== 0 && mark[c] !== stamp) nw = Math.max(w, level - f.surface[c]); // newly flooded
    else nw = w + step > 0 ? w + step : 0;
    if (nw !== w) {
      added += (nw - w) * A[c];
      f.water[c] = nw;
    }
  }
  return added;
}

/** the sea's mean level is relaxed every 30 plain steps' worth: 30 / 15 steps at kf 1 / 2 (as before), 8 when a step
 * covers 8 ticks (a world nobody watches at 100x / 1000x: SIM perf push 3) */
function relaxSteps(kf: number): number {
  return kf === 1 || kf === 2 ? 30 / kf : Math.max(1, Math.round(30 / kf));
}

function oceanMeanLevel(ocean: Uint8Array, surf: Float32Array, water: Float64Array, A: Float64Array, N: number): number {
  let num = 0, den = 0;
  for (let c = 0; c < N; c++) {
    if (!ocean[c]) continue;
    num += (surf[c] + water[c]) * A[c];
    den += A[c];
  }
  return den > 0 ? num / den : 0;
}

function shiftOcean(ocean: Uint8Array, water: Float64Array, A: Float64Array, N: number, d: number): number {
  let sourced = 0;
  for (let c = 0; c < N; c++) {
    if (!ocean[c]) continue;
    const w = water[c];
    const nw = w + d > 0 ? w + d : 0;
    sourced += (nw - w) * A[c];
    water[c] = nw;
  }
  return sourced;
}

/**
 * The flux pass: net exchange per edge pair, limit, move — one sweep over the active list (ascending).
 *
 * Net exchange, from the OLD fluxes (order independent). The pair (c->o, o->c) stores the positive part of one
 * antisymmetric net flux, so a reversing flow gains K·Δh per step — not 2K, which would break the CFL bound. Nothing
 * crosses a dry lip or leaves a (nearly) dry higher cell. The net is antisymmetric bit for bit (geo len / width are
 * symmetric, the dry test and the depth are symmetric), so a pair of two ACTIVE cells is evaluated once, by its lower
 * cell, which hands the negated value to the higher one through `tmp` — that halves the edge work in a flowing region.
 * Because the list is ascending, every pair of a cell is known when the cell is reached (pairs with lower active
 * neighbours were evaluated by them, the rest are evaluated now), so the cell can limit and move at once: nothing later
 * reads its old outflows (its pairs with higher active cells are already evaluated, inactive cells carry no flux).
 *
 * Limit: outflow = positive part; the limiter keeps a cell from sending more than it holds.
 *
 * Move: a sleeping receiver always gets its volume (mass) but only a real inflow wakes it (act 2 = woken, stepped from
 * the next step; 4 = apply only). Water running off the land into the open sea joins the reservoir directly (an
 * accounted sink): the sea's level is held by the relaxation anyway, and a slow stylised sea would otherwise heap
 * centimetre domes at every river mouth and keep the whole ocean awake. Returns the volume sunk.
 *
 * (`act[o] === 1` means "o is in this step's active list": the move only ever marks cells that were 0 or 4.)
 */
function fluxPass(
  list: Int32Array, n: number, nbrStart: Int32Array, nbr: Int32Array, rev: Int32Array, K: Float64Array,
  surf: Float32Array, water: Float64Array, A: Float64Array, flux: Float64Array, tmp: Float64Array,
  ocean: Uint8Array, act: Uint8Array, quiet: Uint8Array, dV: Float64Array, maxOutA: Float64Array, fed: Int32Array,
  kf: number,
): number {
  let sunk = 0;
  let nf = 0;
  // time-lapse step of kf plain steps: the per-step friction / kf (see hydroStep); the wake threshold is per step
  const invKf = 1 / kf, quietRel = QUIET_REL * kf;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const bc = surf[c];
    const wc = water[c];
    const Hc = bc + wc;
    const e0 = nbrStart[c], e1 = nbrStart[c + 1];
    let sum = 0, mx = 0;
    for (let e = e0; e < e1; e++) {
      const o = nbr[e];
      const ao = act[o];
      let t = 0;
      if (o < c && ao === 1) t = tmp[e]; // evaluated by o
      else {
        const bo = surf[o];
        const wo = water[o];
        const Ho = bo + wo;
        const top = Hc > Ho ? Hc : Ho;
        const bed = bc > bo ? bc : bo;
        let d = top - bed;
        if (d > DRY && (Hc >= Ho ? wc : wo) > DRY) {
          const damp = 1 - (FR0 + FR1 / (1 + d / H0)) * invKf;
          const dh = Hc - Ho;
          if (d > DCAP) d = DCAP;
          t = (flux[e] - flux[rev[e]]) * damp + K[e] * d * dh;
        }
        if (ao === 1) tmp[rev[e]] = -t;
      }
      const fl = t > 0 ? t : 0;
      flux[e] = fl;
      sum += fl;
      if (fl > mx) mx = fl;
    }
    const V = wc * A[c];
    if (sum > V) {
      const k = sum > 0 ? V / sum : 0;
      for (let e = e0; e < e1; e++) flux[e] *= k;
      mx *= k;
    }
    maxOutA[c] = mx;
    if (sum <= 0) continue; // nothing leaves: no moves (out stays 0)
    let out = 0;
    const fromLand = ocean[c] === 0;
    for (let e = e0; e < e1; e++) {
      const fl = flux[e];
      if (fl <= 0) continue;
      out += fl;
      const o = nbr[e];
      if (fromLand && ocean[o] !== 0) { sunk += fl; continue; }
      dV[o] += fl;
      const a = act[o];
      if (a === 0 || a === 4) {
        if (a === 0) fed[nf++] = o; // first inflow this step: collect the receiver
        const wo = water[o] > 0.075 ? water[o] : 0.075;
        if (fl / (A[o] * wo) > quietRel) { act[o] = 2; quiet[o] = 0; } else if (a === 0) act[o] = 4;
      }
    }
    dV[c] -= out;
  }
  fedCount = nf;
  return -sunk;
}

/** receivers collected by the last fluxPass (in order of their first inflow) */
let fedCount = 0;

/** apply fed cells (act 2 = woken by a real inflow, 4 = apply only); an apply-only cell wakes if the gift lifted it
 * out of level with a wet neighbour */
function applyFed(
  list2: Int32Array, n2: number, nbrStart: Int32Array, nbr: Int32Array, surf: Float32Array, water: Float64Array, A: Float64Array,
  act: Uint8Array, quiet: Uint8Array, dV: Float64Array,
): void {
  for (let i = 0; i < n2; i++) {
    const c = list2[i];
    const dv = dV[c];
    dV[c] = 0;
    let w = water[c] + dv / A[c];
    if (w < 0) w = 0;
    water[c] = w;
    // woken by a real inflow — but a cell still within the retention film cannot send anything yet: it stays asleep
    // (inflow keeps reaching it, and wakes it again once it is wet)
    if (act[c] === 2) { act[c] = w > DRY ? 1 : 0; continue; }
    act[c] = 0;
    if (w <= DRY) continue;
    const Hc = surf[c] + w;
    const e1 = nbrStart[c + 1];
    for (let e = nbrStart[c]; e < e1; e++) {
      const o = nbr[e];
      const d = Hc - (surf[c] > surf[o] ? surf[c] : surf[o]);
      if (d > DRY && Hc - (surf[o] + water[o]) > levelEps(d)) { act[c] = 1; quiet[c] = 0; break; }
    }
  }
}

function applyActive(list: Int32Array, n: number, water: Float64Array, A: Float64Array, dV: Float64Array, lastDv: Float64Array): void {
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const dv = dV[c];
    dV[c] = 0;
    let w = water[c] + dv / A[c];
    if (w < 0) w = 0;
    lastDv[c] = w - water[c];
    water[c] = w;
  }
}

// ───────────────────────────── sheets: thin overland flow (SIM perf push 2) ─────────────────────────────
//
// Most awake water is a film a few millimetres to centimetres thick running over the land after rain or snowmelt (on
// the home world ~65 % of the active set on an ordinary day, ~85 % in a planet-wide downpour). Such films have no
// momentum worth keeping: the pipes' friction takes ~10 % of a film's flux every step, so its flow is always within a
// few steps of the steady state of its slope. Sheets therefore skip the pipes: each step a sheet sends each LOWER
// neighbour (by water level) the pipes' steady-state flux for that drop,
//     F_e = K_e · d_e · (H_c − H_o) / (FR0 + FR1 / (1 + d_e / H0))      (the fixed point of fluxPass's update)
// limited, like the pipes, to what the cell holds. No momentum update, no pair bookkeeping, no quiet counter: about a
// third of the work of a pipe cell. A sheet is a land cell shallower than SHEET_IN; it goes back to the pipes once
// deeper than SHEET_OUT (it pools, a river or a flood reaches it): lakes, rivers, floods, tsunamis and the sea keep full
// momentum dynamics. A sheet writes what it sends along each edge, per plain step, into the pipes' flux array (zero on
// the rest of its edges, all zero once asleep): its velocity — and that of every cell it feeds — is net flux, outflow
// less inflow, as in the pipes (round 2: counting the outflow alone halved a channel's speed, and a monsoon carved
// ~35 % less), and the flow is its momentum when it deepens into the pipes. Every m³ a sheet sends arrives in its
// receiver's dV (or joins the sea, accounted), so mass is conserved exactly as in the pipes. Wake rules are the pipes' own: a sheet that is level with its wet neighbours, or
// within the retention film, sleeps at once (nothing to carry); sleepers are woken by any source (rain, melt, springs,
// seepage, commands, terrain edits: activateCell / wakeIfRunning), by a real inflow, or by a level mismatch.
//
// The stability bound of the explicit zero-inertia step (a sheet must not overshoot its receiver's level) holds by a
// wide margin at these depths: per edge K·d / ((FR0 + FR1)·A) ≈ 0.12 per metre of depth on the home world, so a 5 cm
// sheet exchanges well under 1 % of a level difference per step.

/** hAct value of an awake cell in SHEET mode (pipes are 1; 2 and 4 are transient marks inside a step) */
export const SHEET = 8;
/** a land cell shallower than this (m) flows as a sheet ... */
export const SHEET_IN = 0.02;
/** ... until it is deeper than this (m): then the pipes carry it (hysteresis keeps cells from flapping) */
export const SHEET_OUT = 0.05;

/** sheets found by the last splitModes */
let sheetCount = 0;

/**
 * Split this step's awake list (ascending) into pipe cells (compacted in place at the front of `list`, still ascending;
 * returned count) and sheet cells (`sheets`, ascending; count in sheetCount). A pipe cell turning into a sheet drops its
 * outflow fluxes (a film's momentum is negligible); a sheet turning into a pipe cell starts from rest.
 */
function splitModes(
  list: Int32Array, n: number, sheets: Int32Array, water: Float64Array, ocean: Uint8Array, act: Uint8Array, quiet: Uint8Array,
  flux: Float64Array, nbrStart: Int32Array,
): number {
  let np = 0, ns = 0;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const a = act[c];
    if (ocean[c] === 0 && water[c] < (a === SHEET ? SHEET_OUT : SHEET_IN)) {
      if (a !== SHEET) {
        act[c] = SHEET;
        quiet[c] = 0;
        const e1 = nbrStart[c + 1];
        for (let e = nbrStart[c]; e < e1; e++) flux[e] = 0;
      }
      sheets[ns++] = c;
    } else {
      if (a === SHEET) { act[c] = 1; quiet[c] = 0; }
      list[np++] = c;
    }
  }
  sheetCount = ns;
  return np;
}

/** per-sheet receiver scratch (a cell has at most 6 neighbours) */
const rcvO = new Int32Array(8);
const rcvE = new Int32Array(8);
const rcvF = new Float64Array(8);

/**
 * The sheet pass (after fluxPass, before any water moves: it reads the step's starting levels like the pipes do).
 * Sends each sheet's flow into its receivers' dV, collects sleeping receivers into the fed list (as fluxPass does),
 * writes the sheet's velocity, wakes higher sleeping wet neighbours out of level, and puts level / dry sheets to sleep.
 * Returns the volume sunk into the sea (negative: a sink).
 */
function sheetPass(
  sheets: Int32Array, ns: number, nbrStart: Int32Array, nbr: Int32Array, rev: Int32Array, K: Float64Array, surf: Float32Array,
  water: Float64Array, A: Float64Array, flux: Float64Array, ocean: Uint8Array, act: Uint8Array, quiet: Uint8Array, dV: Float64Array,
  fed: Int32Array, tx: Float32Array, ty: Float32Array, tz: Float32Array, flowX: Float32Array, flowY: Float32Array,
  flowZ: Float32Array, mainRcv: Int32Array, vmul: number, dtTicks: number,
): number {
  let sunk = 0;
  let nf = fedCount;
  const invH0 = 1 / H0;
  // time-lapse: one sheet step stands for dtTicks / HYDRO_CADENCE steps (the films' zero-inertia flux is a rate: it
  // scales with the step; ~1 % of a level difference per step at these depths leaves a wide stability margin)
  const m = dtTicks / HYDRO_CADENCE, invM = 1 / m;
  for (let i = 0; i < ns; i++) {
    const c = sheets[i];
    const w = water[c];
    const bc = surf[c];
    const Hc = bc + w;
    const e0 = nbrStart[c], e1 = nbrStart[c + 1];
    let nr = 0, total = 0, level = true;
    // what flows in along each edge (the neighbours' per-step outflow toward this cell: pipes this step, sheets their
    // latest) — the velocity counts it, as the pipes' does (round 2: a sheet's velocity counted its outflow only, half
    // the pipes' through a channel, and the rivers they feed lost their inflow term: a monsoon carved ~38 % less)
    let ix = 0, iy = 0, iz = 0;
    if (w > DRY) {
      // the common receiver lies on lower ground (its bed below this one): the depth across the edge is the film itself,
      // so the friction term and the level tolerance are the cell's own (one division per cell, not per edge)
      const kw = (w / (FR0 + FR1 / (1 + w * invH0))) * m;
      const epsW = LEVEL_EPS + LEVEL_EPS_DEPTH * w;
      for (let e = e0; e < e1; e++) {
        const o = nbr[e];
        flux[e] = 0;
        const bo = surf[o];
        const Ho = bo + water[o];
        const dh = Hc - Ho;
        if (dh > 0) {
          let F: number;
          if (bo <= bc) {
            if (dh > epsW) level = false;
            F = K[e] * kw * dh;
          } else {
            // a step up to the receiver's bed: only the water above it crosses
            const d = Hc - bo;
            if (d <= DRY) continue;
            if (dh > LEVEL_EPS + LEVEL_EPS_DEPTH * d) level = false;
            F = ((K[e] * d * dh) / (FR0 + FR1 / (1 + d * invH0))) * m;
          }
          rcvO[nr] = o; rcvE[nr] = e; rcvF[nr] = F; nr++;
          total += F;
        } else if (dh < 0) {
          // a higher neighbour: asleep, it may need waking; awake, what it sends here is this cell's inflow (only a higher
          // cell sends downhill — the inflow read skips the rest: scattered reads were the cost of this pass)
          if (act[o] === 0) wakeHigher(o, -dh, bc, bo, Ho, water[o], act, quiet);
          else {
            const fin = flux[rev[e]];
            if (fin > 0) { ix += fin * tx[e]; iy += fin * ty[e]; iz += fin * tz[e]; }
          }
        }
      }
    } else {
      // within the retention film: sends nothing; still wakes a higher sleeping wet neighbour out of level
      for (let e = e0; e < e1; e++) {
        flux[e] = 0;
        const o = nbr[e];
        if (act[o] !== 0) continue;
        const bo = surf[o];
        const Ho = bo + water[o];
        if (Ho > Hc) wakeHigher(o, Ho - Hc, bc, bo, Ho, water[o], act, quiet);
      }
    }
    if (nr === 0) {
      // nothing lower: dry, or a hollow / level ground holding its film — asleep. An inflow already sent to it this
      // step makes it a fed cell (applyFed wakes it if the gift leaves it out of level); later senders feed it as usual
      if (dV[c] > 0) { act[c] = 4; fed[nf++] = c; } else act[c] = 0;
      flowX[c] = 0; flowY[c] = 0; flowZ[c] = 0;
      mainRcv[c] = -1;
      continue;
    }
    const inflow = dV[c];
    const V = w * A[c];
    const k = total > V ? V / total : 1;
    let qx = 0, qy = 0, qz = 0, out = 0, best = -1, bf = 0;
    const fromLand = ocean[c] === 0;
    for (let j = 0; j < nr; j++) {
      const fl = rcvF[j] * k;
      const o = rcvO[j], e = rcvE[j];
      // the edge's outflow per plain step, as the pipes keep it: their neighbours' momentum and velocity read it, and
      // it is this cell's momentum if it deepens into the pipes
      flux[e] = fl * invM;
      out += fl;
      qx += fl * tx[e]; qy += fl * ty[e]; qz += fl * tz[e];
      if (fl > bf) { bf = fl; best = o; }
      if (fromLand && ocean[o] !== 0) { sunk += fl; continue; }
      dV[o] += fl;
      const a = act[o];
      if (a === 0 || a === 4) {
        if (a === 0) fed[nf++] = o;
        const wr = water[o] > 0.075 ? water[o] : 0.075;
        if (fl > QUIET_REL * A[o] * wr * m) { act[o] = 2; quiet[o] = 0; } else if (a === 0) act[o] = 4;
      }
    }
    dV[c] -= out;
    mainRcv[c] = best;
    if (level) {
      // level with every wet neighbour (only drops within the level tolerance): the film rests — it sends this step's
      // trickle and sleeps (as a fed cell when something flowed in this step, see above); a sleeper holds no flux
      if (inflow > 0) { act[c] = 4; fed[nf++] = c; } else act[c] = 0;
      for (let j = 0; j < nr; j++) flux[rcvE[j]] = 0;
      flowX[c] = 0; flowY[c] = 0; flowZ[c] = 0;
      continue;
    }
    // net flux along the edge tangents per column depth, per tick (finishActive's velocity: outflow − inflow)
    const kv = vmul / (w > 0.05 ? w : 0.05) / HYDRO_CADENCE;
    flowX[c] = (qx * invM - ix) * kv; flowY[c] = (qy * invM - iy) * kv; flowZ[c] = (qz * invM - iz) * kv;
  }
  fedCount = nf;
  return -sunk;
}

/** wake sleeping neighbour o, higher than a sheet by `rise`, if it is wet and out of level across the edge (the pipes'
 * finishActive rule: only an awake cell sends, and o has to send water this way) */
function wakeHigher(o: number, rise: number, bc: number, bo: number, Ho: number, wo: number, act: Uint8Array, quiet: Uint8Array): void {
  if (wo <= DRY) return;
  const d = Ho - (bc > bo ? bc : bo);
  if (d > DRY && rise > LEVEL_EPS + LEVEL_EPS_DEPTH * (d < LEVEL_EPS_MAXD ? d : LEVEL_EPS_MAXD)) { act[o] = 1; quiet[o] = 0; }
}

/** apply the sheets' dV (a sheet put to sleep this step is applied here too; a fed one already was, dV is 0 then); a
 * sheet that ran dry this step sleeps (as the pipes' finishActive does: nothing left to send) */
function applySheets(
  sheets: Int32Array, ns: number, water: Float64Array, A: Float64Array, dV: Float64Array, act: Uint8Array,
  flowX: Float32Array, flowY: Float32Array, flowZ: Float32Array, nbrStart: Int32Array, flux: Float64Array,
): void {
  for (let i = 0; i < ns; i++) {
    const c = sheets[i];
    const dv = dV[c];
    if (dv !== 0) {
      dV[c] = 0;
      const w = water[c] + dv / A[c];
      water[c] = w < 0 ? 0 : w;
    }
    if (act[c] === SHEET && water[c] <= DRY) {
      act[c] = 0; flowX[c] = 0; flowY[c] = 0; flowZ[c] = 0;
      const e1 = nbrStart[c + 1];
      for (let e = nbrStart[c]; e < e1; e++) flux[e] = 0;
    }
  }
}

/** sheet wash: a fast sheet (> 2 cm, > 1.5 m/s) carries loose ground to its main receiver, like the pipes' erosion */
function sheetErosion(p: Planet, sheets: Int32Array, ns: number, mainRcv: Int32Array, steps: number): number {
  const f = p.f;
  const water = f.water, fx = f.flowX, fy = f.flowY, fz = f.flowZ;
  const k = p.cfg.erosion * steps;
  let eroded = 0;
  for (let i = 0; i < ns; i++) {
    const c = sheets[i];
    if (water[c] <= 0.02) continue;
    const r = mainRcv[c];
    if (r < 0) continue;
    const sp = Math.sqrt(fx[c] * fx[c] + fy[c] * fy[c] + fz[c] * fz[c]);
    if (sp > 1.5) { const m = erodeTo(p, c, r, sp, k); if (m > eroded) eroded = m; }
  }
  return eroded;
}

/** velocity field, erosion, waking level-mismatched sleepers, and putting quiet cells to sleep; returns the largest
 * single-cell ground change of this step's erosion (m, 0 = none).
 *
 * The level test of an edge has two uses: it keeps a cell awake (only matters when the cell is otherwise quiet) and it
 * wakes a SLEEPING neighbour that is out of level. A flowing cell therefore tests only its sleeping neighbours — inside
 * a river or a rain sheet every neighbour is awake and the test is skipped — while a quiet candidate tests every edge
 * until one is out of level. Same decisions as testing every edge, in the same order. */
function finishActive(p: Planet, list: Int32Array, n: number, maxOutA: Float64Array, kf: number): number {
  const f = p.f, s = p.s, g = p.grid, geo = p.geo, cfg = p.cfg;
  const surf = f.surface, water = f.water, flux = s.flux, act = s.hAct, quiet = s.hQuiet, A = p.cellArea, rev = g.rev;
  const nbrStart = g.nbrStart, nbr = g.nbr, tx = geo.tx, ty = geo.ty, tz = geo.tz;
  const flowX = f.flowX, flowY = f.flowY, flowZ = f.flowZ;
  const lastDv = p.scratch.lastDv;
  const vmul = 1 / (3 * (p.edgeM / Math.sqrt(3)));
  const ocean = s.ocean;
  // a time-lapse step of kf plain steps (hydroStep): per-step thresholds, the step's duration and erosion scale with it
  const erosion = cfg.erosion * kf, quietDv = QUIET * kf, quietRel = QUIET_REL * kf, stepTicks = HYDRO_CADENCE * kf;
  let eroded = 0;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    if (act[c] !== 1) continue;
    const w = water[c];
    const bc = surf[c];
    const Hc = bc + w;
    const sea = ocean[c];
    const e0 = nbrStart[c], e1 = nbrStart[c + 1];
    const maxOut = maxOutA[c];
    // quiet candidate: no real outflow (relative to the column: deep water moves much volume for a hair of slope) and
    // no real change; it sleeps if it is also level with every wet neighbour
    const ldv = lastDv[c];
    const dv = ldv < 0 ? -ldv : ldv;
    const cand = dv < quietDv && maxOut < quietRel * A[c] * (w > 0.075 ? w : 0.075);
    let level = true;
    for (let e = e0; e < e1; e++) {
      const o = nbr[e];
      if (act[o] !== 0 && (!cand || !level)) continue;
      const so = surf[o];
      const wo = water[o];
      const Ho = so + wo;
      // the sea does not wait for land running off into it (that water joins the reservoir), and no cell waits for an
      // awake higher neighbour: that one sends its water by itself (a sleeper receives, and wakes when the gift leaves
      // it out of level)
      if (Ho > Hc && (act[o] !== 0 || (sea && !ocean[o]))) continue;
      const bed = bc > so ? bc : so;
      const top = Hc > Ho ? Hc : Ho;
      const dep = top - bed;
      if (dep > DRY && (Hc >= Ho ? w : wo) > DRY) {
        // compared with the level tolerance of the water across this edge
        const dl = Hc > Ho ? Hc - Ho : Ho - Hc;
        if (dl > LEVEL_EPS + LEVEL_EPS_DEPTH * (dep < LEVEL_EPS_MAXD ? dep : LEVEL_EPS_MAXD)) {
          level = false;
          // wake a sleeping neighbour that stands HIGHER: it has to send water this way and only an awake cell sends.
          // A lower sleeper needs nothing: this cell's own outflow reaches it, and the moves wake it if the inflow is
          // real (fluxPass) or if it ends out of level (applyFed). Waking every lower out-of-level neighbour kept the
          // dry banks of every flow and hundreds of sea cells under shore runoff stepping for nothing (runoff into
          // the open sea joins the reservoir directly).
          if (!act[o] && Ho > Hc) { act[o] = 1; quiet[o] = 0; }
        }
      }
    }
    // velocity: net outflow along the edge tangents per column depth (the renderer's flow field; erosion reads it)
    let qx = 0, qy = 0, qz = 0;
    for (let e = e0; e < e1; e++) {
      const net = flux[e] - flux[rev[e]];
      qx += net * tx[e]; qy += net * ty[e]; qz += net * tz[e];
    }
    const dd = w > 0.05 ? w : 0.05;
    const k = vmul / dd / stepTicks;
    const vx = qx * k, vy = qy * k, vz = qz * k;
    flowX[c] = vx; flowY[c] = vy; flowZ[c] = vz;
    // erosion: fast water lifts loose ground and drops it one cell downstream (rivers cut, deltas grow)
    if (erosion > 0 && w > 0.02 && !sea) {
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > 1.5) { const m = erode(p, c, sp, erosion); if (m > eroded) eroded = m; }
    }
    // a cell within the retention film sends nothing (fluxPass moves water only out of wet cells) and receives
    // without being awake: it sleeps at once (its sleeping-neighbour checks above have run)
    if (w <= DRY || (cand && level && ++quiet[c] >= QUIET_STEPS)) {
      act[c] = 0;
      quiet[c] = 0;
      for (let e = e0; e < e1; e++) flux[e] = 0;
      flowX[c] = 0; flowY[c] = 0; flowZ[c] = 0;
    } else if (!(cand && level)) quiet[c] = 0;
  }
  return eroded;
}

/** move loose material from c to its main downstream neighbour; returns the depth moved (m, 0 = nothing) */
function erode(p: Planet, c: number, speed: number, k: number): number {
  const g = p.grid, flux = p.s.flux;
  let best = -1, bf = 0;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (flux[e] > bf) { bf = flux[e]; best = g.nbr[e]; }
  if (best < 0) return 0;
  return erodeTo(p, c, best, speed, k);
}

/** move loose material from c to `best` (its main receiver) at flow speed `speed`; returns the depth moved */
function erodeTo(p: Planet, c: number, best: number, speed: number, k: number): number {
  const f = p.f;
  const cap = 0.00004 * (speed - 1.5) * k;
  let m = 0;
  if (f.sand[c] > 0) {
    m = Math.min(f.sand[c], cap);
    f.sand[c] -= m; f.sand[best] += m;
  } else if (f.soil[c] > 0) {
    m = Math.min(f.soil[c], cap * 0.6);
    f.soil[c] -= m; f.soil[best] += m * 0.5; f.sand[best] += m * 0.5;
  } else if (f.ash[c] > 0) {
    m = Math.min(f.ash[c], cap);
    f.ash[c] -= m; f.ash[best] += m;
  } else if (speed > 6) {
    m = cap * 0.05; // bedrock cuts slowly: canyons over many days
    f.rock[c] -= m; f.sand[best] += m;
  }
  if (m > 0) {
    p.updSurface(c); p.updSurface(best);
    // sediment carried into the sea displaces sea water (push 2 round 2): the sea is a reservoir, so the displaced water
    // leaves it as an accounted sink and the mean-level relaxation spreads it back. A delta that raised the sea surface
    // over itself instead kept the open sea awake at every river mouth in a downpour (hundreds of cells, all monsoon)
    if (p.s.ocean[best] !== 0) {
      const w = f.water[best], d = w < m ? w : m;
      f.water[best] = w - d;
      p.hydro.sourced -= d * p.cellArea[best];
    }
  }
  return m;
}

// ───────────────────────────── slow pass: aquifer, seepage, salinity ─────────────────────────────

interface SeepCache { list: Int32Array; count: number; dirty: boolean }
const seepCache = new WeakMap<Planet, SeepCache>();

function seepCells(p: Planet): SeepCache {
  let r = seepCache.get(p);
  if (!r) { r = { list: new Int32Array(p.count), count: 0, dirty: true }; seepCache.set(p, r); }
  if (r.dirty) {
    let k = 0;
    for (let c = 0; c < p.count; c++) if (p.s.seep[c] > 0) r.list[k++] = c;
    r.count = k;
    r.dirty = false;
  }
  return r;
}

export const HYDRO_SLOW_CADENCE = 720;

/** Every 720 ticks: groundwater creeps downhill, saturated ground seeps (springs), salt follows the sea. */
export function hydroSlowStep(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid;
  const N = p.count;
  const freeze = p.st.liquid.freeze;
  for (let c = 0; c < N; c++) {
    if (s.ocean[c]) { f.aquifer[c] = 0; continue; }
    const aq = f.aquifer[c];
    if (aq <= 0.01 || f.temperature[c] < freeze) continue;
    let lo = -1, lh = f.surface[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (f.surface[o] < lh) { lh = f.surface[o]; lo = o; }
    }
    if (lo < 0) continue;
    const drop = f.surface[c] - lh;
    const m = aq * 0.25 * Math.min(1, drop / 15 + 0.1);
    f.aquifer[c] -= m;
    if (s.ocean[lo]) continue; // groundwater reaching the sea is lost to it
    f.aquifer[lo] += m;
  }
  for (let c = 0; c < N; c++) {
    if (s.ocean[c]) { s.seep[c] = 0; continue; }
    const cap = 1.2 + 2.5 * Math.min(1, f.soil[c] + f.sand[c]);
    const ex = f.aquifer[c] - cap;
    // seep the excess over the next slow period (per hydrology step)
    s.seep[c] = ex > 0 && f.temperature[c] > freeze ? (ex * 0.6) / (HYDRO_SLOW_CADENCE / HYDRO_CADENCE) : 0;
    // salinity: the sea is salt, rain leaches land, drying closed basins concentrate it
    if (s.ocean[c]) f.salinity[c] = 1;
    else if (f.water[c] > 0.05) {
      let mx = 0;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (s.ocean[o] && f.salinity[o] > mx) mx = f.salinity[o]; }
      f.salinity[c] = Math.max(f.salinity[c] * 0.98, mx * 0.7);
    } else if (f.salinity[c] > 0) f.salinity[c] *= f.precip[c] > 0 || f.moisture[c] > 0.5 ? 0.9 : 0.995;
  }
  for (let c = 0; c < N; c++) if (s.ocean[c]) f.salinity[c] = 1;
  const sc = seepCache.get(p);
  if (sc) sc.dirty = true;
  p.bump('aquifer');
  p.bump('salinity');
}

// ───────────────────────────── init + player tools ─────────────────────────────

/**
 * After generation + climate: fill the sea, fill lakes where the climate is wet, lay rivers along the drainage with
 * perennial springs at their heads, and wake everything that should be flowing.
 */
export function initHydrology(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid;
  const N = p.count;
  computeOcean(p, p.st.seaLevel);
  p.hydro.seaNow = p.st.seaLevel;
  fillOceanTo(p, p.st.seaLevel);
  const airy = p.airy;
  const acc = p.genAcc;
  const freeze = p.st.liquid.freeze;
  if (airy && p.hydro.oceanCells > 0 && acc) {
    // lakes: closed depressions in wet, unfrozen climates
    const filled = priorityFlood(g, f.surface, p.st.seaLevel);
    for (let c = 0; c < N; c++) {
      if (s.ocean[c]) continue;
      const depth = filled[c] - f.surface[c];
      if (depth > 0.6 && f.moisture[c] > 0.35 && f.temperature[c] > freeze - 2) {
        f.water[c] = depth;
        activateCell(p, c);
      }
    }
    // rivers along strong drainage (in cells), with springs where they start
    let accHi = 0;
    for (let c = 0; c < N; c++) if (!s.ocean[c] && acc[c] > accHi) accHi = acc[c];
    const thr = Math.max(40, N / 700);
    const isRiver = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      if (s.ocean[c] || f.water[c] > 0.5 || acc[c] < thr) continue;
      if (f.temperature[c] < freeze - 4 && f.moisture[c] < 0.5) continue;
      isRiver[c] = 1;
    }
    let sid = 0;
    for (let c = 0; c < N; c++) {
      if (!isRiver[c]) continue;
      // a modest starting depth: the springs and the climate set the real discharge within the first hours
      const d = Math.min(1.2, 0.2 + 0.25 * Math.log(acc[c] / thr + 1));
      // carve the channel so the river sits in its bed
      const cut = d * 0.8;
      const fromSoil = Math.min(f.soil[c], cut);
      f.soil[c] -= fromSoil;
      f.rock[c] -= cut - fromSoil;
      p.updSurface(c);
      f.water[c] = d;
      activateCell(p, c);
      // a head: no upstream river neighbour drains into it
      let upstream = false;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (isRiver[o] && acc[o] < acc[c]) { upstream = true; break; }
      }
      if (!upstream) {
        const rate = 3.5 * Math.min(4, acc[c] / thr) * (p.edgeM / 52) ** 2;
        p.springs.push({ id: ++sid, cell: c, rate, life: -1 });
      }
    }
    u.ids.reserve(`spring.p${p.id}`, sid);
  }
  p.genAcc = null;
  p.bump('water');
  p.bump('surface');
}

/** Add (or remove, negative) a water volume over a disc with smooth falloff. Returns the volume actually moved. */
export function addWater(p: Planet, pos: ArrayLike<number>, radiusM: number, volume: number): number {
  const cells = p.cellsNear(pos, radiusM);
  const P = p.grid.pos;
  const ang = Math.max(radiusM / p.st.radius, p.grid.meanEdgeAngle * 0.5);
  let wsum = 0;
  const weights: number[] = [];
  for (const c of cells) {
    const d = Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
    const w = Math.max(0.05, 1 - d * d) * p.cellArea[c];
    weights.push(w);
    wsum += w;
  }
  let moved = 0;
  if (volume >= 0) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const v = (volume * weights[i]) / wsum;
      p.f.water[c] += v / p.cellArea[c];
      moved += v;
      activateCell(p, c);
    }
  } else {
    let want = -volume;
    // remove proportionally to what is there
    let avail = 0;
    for (const c of cells) avail += p.f.water[c] * p.cellArea[c];
    const frac = avail > 0 ? Math.min(1, want / avail) : 0;
    for (const c of cells) {
      const v = p.f.water[c] * p.cellArea[c] * frac;
      p.f.water[c] -= v / p.cellArea[c];
      if (p.f.water[c] < 1e-9) p.f.water[c] = 0;
      moved -= v;
      activateCell(p, c);
    }
    want += moved;
  }
  p.hydro.sourced += moved;
  p.bump('water');
  return moved;
}

/**
 * A water impulse with momentum: raise a mound of `height` metres over `radiusM` and push it outward (or along `dir`)
 * at `speed` (m per step; default: the local wave speed). Floods, tsunamis, dam bursts. Returns the volume added.
 */
export function waterImpulse(p: Planet, pos: ArrayLike<number>, radiusM: number, height: number, dir: ArrayLike<number> | null = null, speed = -1): number {
  const cells = p.cellsNear(pos, radiusM).slice();
  const P = p.grid.pos, g = p.grid, geo = p.geo, f = p.f, flux = p.s.flux;
  const ang = Math.max(radiusM / p.st.radius, p.grid.meanEdgeAngle * 0.5);
  const G = gain(p);
  let added = 0;
  for (const c of cells) {
    const dt = Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
    const k = Math.exp(-dt * dt * 2.5);
    const dh = height * k;
    f.water[c] += dh;
    added += dh * p.cellArea[c];
  }
  for (const c of cells) {
    const d = f.water[c];
    if (d <= DRY) continue;
    const v = speed > 0 ? speed : Math.sqrt(G * Math.min(d, DCAP));
    // outward direction: along dir, or away from the centre
    let ox: number, oy: number, oz: number;
    if (dir) { ox = dir[0]; oy = dir[1]; oz = dir[2]; }
    else { ox = P[c * 3] - pos[0]; oy = P[c * 3 + 1] - pos[1]; oz = P[c * 3 + 2] - pos[2]; }
    const ol = Math.hypot(ox, oy, oz);
    if (ol < 1e-9) continue;
    ox /= ol; oy /= ol; oz /= ol;
    const dt = Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
    const k = Math.exp(-dt * dt * 2.5);
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const al = geo.tx[e] * ox + geo.ty[e] * oy + geo.tz[e] * oz;
      if (al <= 0) continue;
      flux[e] = Math.max(flux[e], al * v * k * geo.width[e] * p.st.radius * Math.min(d, DCAP) * 0.5);
    }
    activateCell(p, c);
    p.s.hAct[c] = 1; // momentum lives in the pipes (a thin fringe drops back to a sheet at the next split)
  }
  p.hydro.sourced += added;
  p.bump('water');
  return added;
}

/** Drain every drop in a disc (a sink). Returns the volume removed. */
export function drainWater(p: Planet, pos: ArrayLike<number>, radiusM: number): number {
  let removed = 0;
  for (const c of p.cellsNear(pos, radiusM)) {
    removed += p.f.water[c] * p.cellArea[c];
    p.f.water[c] = 0;
    for (let e = p.grid.nbrStart[c]; e < p.grid.nbrStart[c + 1]; e++) p.s.flux[e] = 0;
    activateCell(p, c);
  }
  p.hydro.sourced -= removed;
  p.bump('water');
  return removed;
}

/** total volume in motion bookkeeping: water volume minus all explicit sources/sinks since creation */
export function conservedVolume(p: Planet): number {
  return p.waterVolume() - p.hydro.sourced;
}
