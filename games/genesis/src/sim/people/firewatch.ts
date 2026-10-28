// GENESIS — LIVING PACE (LIVING.md §1.4 rule 3): a fire seen is a fire learned.
//
// The oldest real route to fire: a people that sees the land burn — a lightning fire on the plain, a wildfire in the
// hills — sends someone brave to carry a burning brand home. A settlement within FIRE_SEEN_M of a burning cell gets the
// `wildfire` accident (people/knowledge.ts accident: fire-keeping and cooking may be learned; st.recent.wildfire makes
// the brand a flame to light a hearth from for three days: people/fire.ts fireSourceNear). Until the living-world
// program only fire inside the settlement's own flow cells counted: 2 of 8 peoples left alone knew fire-keeping by year 8.
//
// The burning cells of a planet are gathered once per tick in which a settlement asks (a pure function of the fire
// field at that tick) and each settlement looks for the nearest within reach. Nothing here is state: a load recomputes
// the same list. (fix r1 #0: it used to be kept for the whole game hour, filled by the first settlement to ask; a game
// loaded mid-hour refilled it later from a fire field that had moved on, and the staggered settlements after the save
// point saw other fires than in the continuous run — the hashes parted. Settlements step hourly with a stagger, so a
// tick's list serves the few that share it.)

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { Planet } from '../world/planet.ts';
import { collectFlags } from '../core/activeset.ts';

/** a fire within this many metres is seen (from a 3 km world's hills, the smoke of a fire 2 km off is plain to see) */
export const FIRE_SEEN_M = 2000;
/** a cell burns visibly above this fire intensity */
const VISIBLE = 0.08;

interface Burning {
  tick: number;
  cells: Int32Array;
  n: number;
}
const byPlanet = new WeakMap<Planet, Burning>();

/** the burning cells of planet p at this tick */
function burning(x: PCtx): Burning {
  const p = x.p;
  let b = byPlanet.get(p);
  if (!b) { b = { tick: -1, cells: new Int32Array(p.count), n: 0 }; byPlanet.set(p, b); }
  if (b.tick === x.tick) return b;
  b.tick = x.tick;
  b.n = 0;
  const n = collectFlags(p.s.fAct, b.cells, p.count);
  const f = p.f.fire;
  for (let i = 0; i < n; i++) { const c = b.cells[i]; if (f[c] > VISIBLE) b.cells[b.n++] = c; }
  return b;
}

/** the nearest burning cell within FIRE_SEEN_M of settlement st (-1 none) */
export function fireSeen(x: PCtx, st: Settlement): number {
  const b = burning(x);
  if (b.n === 0) return -1;
  const P = x.p.grid.pos;
  const cosR = Math.cos(FIRE_SEEN_M / x.p.st.radius);
  let best = -1, bd = cosR;
  for (let i = 0; i < b.n; i++) {
    const c = b.cells[i];
    const d = P[c * 3] * st.pos[0] + P[c * 3 + 1] * st.pos[1] + P[c * 3 + 2] * st.pos[2];
    if (d >= bd) { bd = d; best = c; }
  }
  return best;
}
