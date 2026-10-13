// GENESIS — danger before needs (CONTRACT.md §8.2–8.3): how hard a wildfire or lava presses on a cell, and where to run.
//
// Fire used to be one constant in the utility table (flee = 4) checked only underfoot and only when a task ended, while a
// parched body's drink utility reaches ~7.4 — and the fire step hurt and interrupted people from fire 0.1 while flight
// began at 0.15. So thirsty villagers stood in their burning village drinking, interrupted every few ticks, and people
// beside the flames did not move until they were in them. Now (decide.ts, people.ts fireCheck):
//   * standing in fire (> FIRE_HERE) or lava: flight is the ONLY candidate; drinking waits for a safe cell;
//   * beside a cell burning hard (> FIRE_NEAR): flight outranks every need (utility 8+; a drink tops out ~7.4);
//   * the fire step interrupts people in burning cells and beside hard-burning ones, mid-task, at the same thresholds;
//   * flight picks a safe cell (not burning, no hard-burning neighbour) AWAY from the local fire, within 6 rings and not
//     past the front, upwind and onto burnt-out ground where it can, with a one-step escape gradient when nothing safe is
//     in reach; the route is searched live (not the settlement's pre-built flow field); drinking places that burn are
//     skipped;
//   * a fire front outruns a walk 12-50x: people fleeing sprint (FLEE_SPRINT), burns grow with the intensity above
//     FIRE_BURN rather than starting at full strength, and a flight whose goal catches fire turns elsewhere.

import type { Planet } from '../world/planet.ts';
import { stepFactor } from './world.ts';

/** fire intensity at which a cell counts as burning for the people standing in it */
export const FIRE_HERE = 0.05;
/** a neighbour burning this hard puts the people beside it in danger */
export const FIRE_NEAR = 0.25;
/** fleeing people run: a cell (50-150 m) is crossed before the flames finish it, where a walk was overrun (the front
 * moves 1 cell per 5-15 ticks, 12-50x a walk) */
export const FLEE_SPRINT = 4;
/** burns begin above this intensity and grow with it (people.ts fireCheck: health −= (fire − FIRE_BURN) × FIRE_HURT per
 * fire step): a cell that has just caught scorches, a full blaze (1.0) kills in ~25 fire steps (~125 ticks) */
export const FIRE_BURN = 0.2;
export const FIRE_HURT = 0.05;

/** 1 + intensity when the cell burns (2 for lava), 0.5 × the hottest neighbour when one burns hard, else 0 */
export function fireDanger(p: Planet, c: number): number {
  const f = p.f;
  if (f.lava[c] > 0.01) return 2;
  if (f.fire[c] > FIRE_HERE) return 1 + f.fire[c];
  const g = p.grid;
  let m = 0;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    const v = f.lava[o] > 0.01 ? 1 : f.fire[o];
    if (v > m) m = v;
  }
  return m > FIRE_NEAR ? 0.5 * m : 0;
}

/** how hot cell c is to stand in: its fire intensity, 2 for lava */
export function heat(p: Planet, c: number): number {
  return p.f.lava[c] > 0.01 ? 2 : p.f.fire[c];
}

/**
 * A flight's goal has caught fire since it was chosen (`chosen`: its heat then, ×1000, kept in the task's data): run
 * somewhere else. A fleeing person was never re-checked, so a band committed to a 2-hour leg into a cell the front
 * reached 9 ticks later stood in it at 0.9 for the whole leg; a fallback goal (already smouldering) re-plans only as it
 * flares, so flight does not thrash every fire step.
 */
export function fleeGoalAlight(p: Planet, goal: number, chosen: number): boolean {
  if (goal < 0) return false;
  const h = heat(p, goal);
  return h > FIRE_HERE && h > chosen / 1000 + 0.1;
}

/** the terrain's toll on a step c -> o and back (slope, wading, snow, sand — the flames left out: fleeTarget weighs
 * those itself); Infinity where a walker cannot go or cannot get back */
function terrainToll(p: Planet, c: number, o: number): number {
  const burn = (q: number): number => (p.f.lava[q] > 0.01 || p.f.fire[q] > 0.3 ? 6 : 1);
  return Math.max(stepFactor(p, c, o, 0, false) / burn(o), stepFactor(p, o, c, 0, false) / burn(c));
}
/** a step a fleeing body can take in time, and climb back from: a crater or a cliff is a trap, not a refuge (scorched
 * and unburnable, a meteor's crater drew a whole town onto its floor, 4 days' climb from water) */
const TOLL_MAX = 3;

/** no fire, no lava, solid ground */
function safeGround(p: Planet, c: number): boolean {
  return p.f.fire[c] <= 0.02 && p.f.lava[c] <= 0.01 && p.f.water[c] < 0.6;
}

const _seen = new Map<number, number>();

/**
 * Where to run from cell c0: the best safe cell within `rings`, scored by distance from the local fire's centre minus a
 * little of the distance walked (so people run AWAY from the flames, not through them to a nearer gap), preferring
 * cells with no hard-burning neighbour. Falls back to the least-burning neighbour. -1 if c0 is safe and nothing better.
 */
export function fleeTarget(p: Planet, c0: number, rings = 6): number {
  const g = p.grid, P = g.pos, f = p.f;
  // the fire's centre around c0 (intensity-weighted, 3 rings)
  _seen.clear();
  _seen.set(c0, 0);
  let fr = [c0];
  let fx = 0, fy = 0, fz = 0, fw = 0;
  const all: number[] = [];
  // the way out runs through nothing hotter than where they stand (beside the fire: nothing past FIRE_NEAR), so a
  // refuge on the far side of the front is out of reach — the fire's centre still counts every cell it covers
  const pass = Math.max(FIRE_NEAR, heat(p, c0));
  for (let d = 1; d <= rings; d++) {
    const nf: number[] = [];
    for (const c of fr) {
      if (c !== c0 && heat(p, c) > pass) continue;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (_seen.has(o)) continue;
        if (terrainToll(p, c, o) > TOLL_MAX) continue;
        _seen.set(o, d);
        nf.push(o);
      }
    }
    nf.sort((a, b) => a - b);
    for (const o of nf) {
      all.push(o);
      if (d <= 3) {
        const w = f.fire[o] + (f.lava[o] > 0.01 ? 1 : 0);
        if (w > 0.02) { fx += P[o * 3] * w; fy += P[o * 3 + 1] * w; fz += P[o * 3 + 2] * w; fw += w; }
      }
    }
    fr = nf;
  }
  const own = f.fire[c0] + (f.lava[c0] > 0.01 ? 1 : 0);
  if (own > 0.02) { fx += P[c0 * 3] * own; fy += P[c0 * 3 + 1] * own; fz += P[c0 * 3 + 2] * own; fw += own; }
  // distance from the fire's centre in cell steps (sqrt(1 − cos θ) ≈ θ/√2, linear in distance; 0 with no fire around)
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  const step = g.meanEdgeAngle * Math.SQRT1_2;
  const awayOf = (c: number): number => (fw > 0 ? Math.sqrt(Math.max(0, 1 - (P[c * 3] * fx + P[c * 3 + 1] * fy + P[c * 3 + 2] * fz) / fl)) / step : 0);
  const a0 = awayOf(c0);
  // the nearest clear cell that lies away from the flames: each ring walked costs 1.5, each cell farther from the fire's
  // centre than where they stand gains 1, a clear cell (no hard-burning neighbour) outranks any merely unburnt one, and a
  // cell nearer the fire than they are is a last resort (running through the fire to a gap on the far side kills)
  // the wind at c0: fire runs downwind fast and upwind barely (fields/fire.ts), so flight upwind outlasts the front
  const wx = f.windX[c0], wy = f.windY[c0], wz = f.windZ[c0];
  const ws = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const px = P[c0 * 3], py = P[c0 * 3 + 1], pz = P[c0 * 3 + 2];
  let best = -1, bv = -Infinity;
  for (const o of all) {
    if (!safeGround(p, o)) continue;
    const clear = fireDanger(p, o) === 0;
    const d = _seen.get(o)!;
    const gain = awayOf(o) - a0;
    // burnt-out ground (no flames, its fuel gone) cannot burn again: the safest refuge — worth under two rings' walk
    // (a refuge a cell farther is a leg of 50-150 m more, and the front crosses a cell in 5-15 ticks)
    const burntOut = f.burnt[o] > 0.5 && f.fire[o] <= 0.02 ? 2.5 : 0;
    // upwind of where they stand (−1 downwind .. +1 upwind), in a wind worth the name
    let up = 0;
    if (ws > 2) {
      const dx = P[o * 3] - px, dy = P[o * 3 + 1] - py, dz = P[o * 3 + 2] - pz;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      up = -(dx * wx + dy * wy + dz * wz) / (dl * ws);
    }
    // (upwind breaks ties between cells as near: worth less than a ring)
    const v = (clear ? 100 : 0) + (gain >= 0 ? 50 : 0) + gain + burntOut + up * 1.2 * Math.min(1, ws / 8) - d * 1.5;
    if (v > bv) { bv = v; best = o; }
  }
  if (best >= 0) return best;
  // nothing safe in reach: one step down the gradient (the least-burning neighbour)
  let m = Infinity;
  for (let e = g.nbrStart[c0]; e < g.nbrStart[c0 + 1]; e++) {
    const o = g.nbr[e];
    if (f.water[o] >= 0.6 || terrainToll(p, c0, o) === Infinity) continue;
    const v = f.fire[o] + (f.lava[o] > 0.01 ? 2 : 0);
    if (v < m) { m = v; best = o; }
  }
  return best >= 0 && m < own ? best : -1;
}
