// GENESIS — shelter from storms, and getting out of a disaster's way (LIVING.md §3.7).
//
// Storm severity per place (0..1) comes from the weather over it — rain and hail, wind, lightning, snow driven by the
// wind, dust and ash, a planet-wide storm — and the hard cold. In a storm, outdoor work is worth (1 − severity) of
// itself, and SHELTER (TASK.shelter) is worth severity × 2.4: home if it is near, else the nearest standing building,
// else the lee of trees, else they crouch where they are. (Before: awake adults never went in — 0.000 inside in every
// weather — and outdoor work barely dropped: 0.808 clear, 0.776 under a blizzard.)
//
// An EVACUATION order (god/precursors.ts: a volcano's warning, a meteor's streak, the sea drawing back) sends every member
// of the settlement inside the danger radius out past it — away from the danger's centre, uphill where water threatens —
// to wait there (TASK.evacuate) with the food and water they can carry until the order is lifted.
//
// The god layer calls these from its decision hook (people/hooks.ts godHooks.relation, god/relationship.ts).

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import { AgentFlag } from '../types.ts';
import { TASK } from './defs.ts';
import { distM, spotInCell } from './world.ts';
import { foodDays, storeTake } from './store.ts';
import { cellPos3, frame, moveBy, norm, tangent } from '../god/util.ts';

const _p = [0, 0, 0];

// ───────────────────────────── storm severity ─────────────────────────────

const PRECIP_CODE: Record<string, number> = { none: 0, rain: 1, snow: 2, hail: 3, ash: 4, acid: 5, blood: 6, sand: 7 };

/** how hard the weather presses on people at point pos (0 calm .. 1 a storm nobody should be out in) */
export function stormSeverity(x: PCtx, pos: ArrayLike<number>, cell: number): number {
  const p = x.p;
  const list = x.c.weather.list;
  let sev = 0;
  const one = (k: number, I: number, falloff: number): number => {
    const w = list[k];
    if (!w) return 0;
    const code = PRECIP_CODE[w.precipType] ?? 0;
    let v = 0;
    v = Math.max(v, (w.precip * I) / 28);
    v = Math.max(v, (w.wind * I - 7) / 18);
    if (w.lightning > 0) v = Math.max(v, 0.3 + 0.03 * w.lightning * I);
    if (code === 3) v = Math.max(v, 0.6 * I);
    if (code === 4 || code === 5 || code === 7) v = Math.max(v, 0.45 * I);
    if (code === 2 && w.wind * I > 12) v = Math.max(v, 0.5 * I);
    return Math.min(1, v) * falloff;
  };
  for (const w of p.weather) {
    const d = distM(p, w.pos, pos);
    if (d > w.radius) continue;
    sev = Math.max(sev, one(w.kind, w.intensity, Math.sqrt(1 - d / Math.max(1, w.radius))));
  }
  if (p.st.globalWeather) {
    const k = x.c.weather.idx(p.st.globalWeather);
    if (k >= 0) sev = Math.max(sev, one(k, 1, 1));
  }
  // the hard cold: a body outside at −25 °C and below wants a roof — a drag on outdoor work (at most 0.3), never enough
  // to break it off (stormBreaks): the cold peoples' own warmth need does the rest (needs.ts)
  const t = p.f.temperature[cell];
  if (t < -25) sev = Math.max(sev, Math.min(0.3, (-25 - t) / 30 + 0.1));
  return sev < 0.02 ? 0 : Math.round(sev * 1000) / 1000;
}

// ───────────────────────────── shelter ─────────────────────────────

/** outdoor utilities a storm lowers (indices into decide.ts's candidate table) */
export const OUTDOOR = ['work', 'bandGather', 'wander', 'curious', 'court', 'bathe', 'store'] as const;

/** the shelter task: home if near, else the nearest standing building, else the lee of trees, else where they stand */
export function planShelter(x: PCtx, s: number, st: Settlement | undefined, sev: number): TaskSpec {
  const A = x.A;
  const work = 30 + Math.round(30 * sev);
  A.posAt(s, x.tick, _p);
  // already under a roof: stay
  if (A.inside[s] >= 0) {
    const b = x.ps.building(A.inside[s]);
    if (b && b.progress >= 1 && !(b.flags & 2)) return { kind: TASK.shelter, goal: null, goalCell: A.cell[s], work, target: b.id };
  }
  let best = -1, bd = 400;
  const home = x.ps.building(A.home[s]);
  if (home && home.progress >= 1 && !(home.flags & 2)) {
    const d = distM(x.p, _p, home.pos);
    if (d < 400) { best = home.id; bd = d * 0.6; }
  }
  if (st) {
    for (const b of x.ps.of(st.id)) {
      if (b.progress < 1 || b.flags & 2 || b.id === best) continue;
      const def = x.c.buildings.list[b.type];
      if (!def || def.footprint < 1) continue;
      const d = distM(x.p, _p, b.pos);
      if (d < bd) { bd = d; best = b.id; }
    }
  }
  if (best >= 0) {
    const b = x.ps.building(best)!;
    return { kind: TASK.shelter, goal: [b.pos[0], b.pos[1], b.pos[2]], goalCell: b.cell, work, target: b.id };
  }
  // the lee of trees within 150 m
  let tc = -1, td = 150;
  for (const c of x.p.cellsNear(_p, 150)) {
    if (x.p.f.tree[c] < 0.4 || x.p.f.water[c] > 0.3) continue;
    const q = cellPos3(x.p, c);
    const d = distM(x.p, _p, q);
    if (d < td || (d === td && c < tc)) { td = d; tc = c; }
  }
  if (tc >= 0) return { kind: TASK.shelter, goal: spotInCell(x.p, tc, A.id[s], 0x5e1, [0, 0, 0]), goalCell: tc, work, target: -1 };
  return { kind: TASK.shelter, goal: null, goalCell: A.cell[s], work, target: -1 };
}

// ───────────────────────────── evacuation ─────────────────────────────

export interface Evacuation {
  pos: ArrayLike<number>;
  radius: number;
  until: number;
  disaster: number;
}

/** water threatens (a tsunami, a flood): the people make for high ground */
function wet(x: PCtx, e: Evacuation): boolean {
  const d = x.u.god.disasters.find((q) => q.id === e.disaster);
  return !!d && (d.kind === 'tsunami' || d.kind === 'flood' || d.kind === 'hurricane');
}

/**
 * The evacuation task for agent s, or null when it is already safe (and has nothing to wait for). Inside the danger
 * radius: walk out past it, away from the centre (uphill for water), carrying food; outside: wait it out there.
 */
export function planEvacuate(x: PCtx, s: number, st: Settlement | undefined, e: Evacuation, tired = false): TaskSpec | null {
  const A = x.A;
  A.posAt(s, x.tick, _p);
  const d = distM(x.p, _p, e.pos);
  const left = e.until - x.tick;
  if (left <= 0) return null;
  // provisions for the wait (a unit of food a day of it, up to 3, from the store; water skins: perf/pace.ts provisioned)
  if (st && A.trip[s] < e.until) {
    A.trip[s] = e.until;
    const want = Math.min(3, Math.max(1, Math.ceil(left / x.day)));
    const food = x.info[A.species[s]].foods.find((it) => (st.store[it] ?? 0) >= want);
    if (food !== undefined && foodDays(x, st) > 0 && A.carried(s, food) < want) {
      const got = storeTake(st, food, want - A.carried(s, food));
      const left = got > 0 ? A.give(s, food, got) : 0;
      if (left > 0) st.store[food] = (st.store[food] ?? 0) + left;
    }
  }
  if (d > e.radius) {
    // safe: sleep out there when it is time (not at home, under the danger), else wait a while and decide again (the
    // order may be lifted)
    if (tired) return { kind: TASK.sleep, goal: null, goalCell: A.cell[s], work: Math.max(30, Math.min(480, left)), target: -1 };
    return { kind: TASK.evacuate, goal: null, goalCell: A.cell[s], work: Math.min(90, Math.max(10, left)), target: e.disaster };
  }
  // out along the line from the danger through where they stand (the settlement's own line when on top of it)
  let dir = tangent(e.pos, [_p[0] - e.pos[0], _p[1] - e.pos[1], _p[2] - e.pos[2]]);
  if (Math.hypot(dir[0], dir[1], dir[2]) < 1e-9) dir = frame(e.pos).north;
  dir = norm(dir);
  // (the order's radius is the danger radius + 100 m already: precursors.ts)
  const out = e.radius + 20 + 30 * ((A.id[s] * 2654435761) % 1000) / 1000;
  let goal = moveBy(e.pos, dir, out, x.p.st.radius);
  if (wet(x, e)) {
    // high ground: the highest dry cell within 200 m of that point, beyond the radius
    let bc = x.p.cellAt(goal), bh = -Infinity;
    for (const c of x.p.cellsNear(goal, 200)) {
      if (x.p.f.water[c] > 0.1) continue;
      const q = cellPos3(x.p, c);
      if (distM(x.p, q, e.pos) <= e.radius) continue;
      const h = x.p.f.surface[c];
      if (h > bh || (h === bh && c < bc)) { bh = h; bc = c; }
    }
    goal = spotInCell(x.p, bc, A.id[s], 0xe7ac, [0, 0, 0]) as [number, number, number];
  }
  return { kind: TASK.evacuate, goal, goalCell: x.p.cellAt(goal), work: Math.min(120, Math.max(20, left)), target: e.disaster };
}

/** outdoor work a storm breaks off (task kinds) */
const BREAKS = new Set<number>([TASK.forage, TASK.chop, TASK.quarry, TASK.dig, TASK.mine, TASK.fish, TASK.hunt, TASK.farm, TASK.herd, TASK.build, TASK.repair, TASK.haul, TASK.wander, TASK.explore, TASK.court, TASK.bathe, TASK.play, TASK.chore, TASK.cutIce]);

/** severity at which people out in it break off outdoor work and run for shelter */
export const STORM_BREAK = 0.4;

/**
 * Every few ticks per settlement under weather: members out at outdoor work where the storm is at STORM_BREAK or worse
 * stop (interrupt) and decide again — the shelter task then wins (the decision hook). Before, a storm only weighed on
 * the next decision, and a forager four hours into a day trip foraged on through the hail.
 */
export function stormBreaks(x: PCtx, st: Settlement, interrupt: (x: PCtx, s: number) => void): number {
  const p = x.p;
  if (!p.st.globalWeather) {
    let near = false;
    for (const w of p.weather) if (distM(p, w.pos, st.pos) < w.radius + st.territory + 3000) { near = true; break; }
    if (!near) return 0;
  }
  const A = x.A;
  let n = 0;
  for (const s of x.ps.members.get(st.id) ?? []) {
    if (!BREAKS.has(A.task[s]) || A.inside[s] >= 0 || A.boat[s] >= 0 || A.mission[s]) continue;
    A.posAt(s, x.tick, _p);
    if (stormSeverity(x, _p, A.cell[s]) < STORM_BREAK) continue;
    interrupt(x, s);
    n++;
  }
  return n;
}

/** is agent s out of a storm (under a roof) */
export function sheltered(x: PCtx, s: number): boolean {
  return x.A.inside[s] >= 0 || (x.A.flags[s] & AgentFlag.sleepingIndoors) !== 0;
}
