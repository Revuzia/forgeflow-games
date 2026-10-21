// GENESIS — what disasters, thrown things and wrathful gods do to the living and the built (CONTRACT.md §11.3): hurt
// and kill people (by distance and severity), scatter and kill herds, wreck buildings by their material's strength,
// strip crops and trees. Wards (the ward sigil) keep everything inside them safe. Every function returns tallies so the
// chronicle can say what happened ("12 dead, 9 buildings in ruins").
//
// LIVING §3.7: harm the GOD sends falls as hard as its wrath allows — severity × L(w), reach × R(w) (god/wrath.ts; the
// wrath of the act in progress). Nature's harm keeps its own law. A death by the god's act makes the act harm to every
// witness of it (god/regard.ts noteDeath), and the survivors see their dead.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { BuildingFlag, AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, MEMK, TASK } from '../people/defs.ts';
import { die } from '../people/lifecycle.ts';
import { interrupt } from '../people/people.ts';
import { ruin } from '../people/buildings.ts';
import { distM } from '../people/world.ts';
import { herdPos, reindexHerds } from '../life/herds.ts';
import { hashFloat } from '../core/rng.ts';
import { harmScale } from './wrath.ts';
import { currentAct, noteDeath } from './regard.ts';
import { witness } from '../people/culture.ts';

/** is a point inside a live shield on this planet */
export function shielded(u: Universe, p: Planet, pos: ArrayLike<number>): boolean {
  const sh = u.god.shields;
  if (!sh.length) return false;
  for (const s of sh) if (s.planet === p.id && s.until > u.tick && distM(p, s.pos, pos) <= s.radius) return true;
  return false;
}

export interface HurtResult {
  hurt: number;
  dead: number;
}

const _pt = [0, 0, 0];

/**
 * Hurt people within `radius` of pos: severity 1 kills at the centre (falling off with distance; `flat` = the same
 * everywhere inside), frightens them and breaks off what they were doing. `chance` < 1 hits only some (a plague of
 * collapses, not a blast).
 */
export function hurtPeople(u: Universe, p: Planet, pos: ArrayLike<number>, radius: number, severity: number, cause: number = DEATH.disaster, o: { flat?: boolean; chance?: number; salt?: number; fear?: number; max?: number; mortal?: { k0: number; gain: number; cap: number; road?: ReadonlySet<number> } } = {}): HurtResult {
  const out = { hurt: 0, dead: 0 };
  if (!p.people || p.people.agents.count === 0 || severity <= 0) return out;
  const x = makeCtx(u, p);
  const A = x.A;
  const harmK = u.god.lawAt('disasters.harm', p.id);
  // the god's wrath (null: nature's harm, its own law alone)
  const ws = harmScale();
  const R = radius * ws.R;
  const sev = severity * ws.L;
  // (o.max: at most that many people, the nearest first — a bolt strikes one to three, not everyone within 30 m: LIVING
  // §3.7; ties by id, so it is the same people on every machine)
  let only: Set<number> | null = null;
  if (o.max !== undefined) {
    const near: [number, number][] = [];
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s]) continue;
      A.posAt(s, u.tick, _pt);
      const d = distM(p, _pt, pos);
      if (d <= R) near.push([d, s]);
    }
    near.sort((a, b) => a[0] - b[0] || A.id[a[1]] - A.id[b[1]]);
    only = new Set(near.slice(0, Math.max(0, o.max)).map((e) => e[1]));
  }
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s] || (only && !only.has(s))) continue;
    A.posAt(s, u.tick, _pt);
    const d = distM(p, _pt, pos);
    if (d > R) continue;
    if (o.chance !== undefined && o.chance < 1 && hash01(A.id[s], u.tick, o.salt ?? 0x4a7) >= o.chance) continue;
    if (shielded(u, p, _pt)) continue;
    const k = sev * harmK * (o.flat ? 1 : (1 - d / Math.max(1, R)) * 1.4);
    if (k <= 0.005) continue;
    A.health[s] -= k;
    // (o.mortal: caught on the road — one fleeing in the open when the blast comes (out of the danger on the god's
    // warning, or running from it) is thrown and struck, and a blow k kills them with chance (k − k0) × gain, at most
    // `cap` (most are thrown down and hurt, not killed), beside the sure death of a blow past what the body has left; the
    // draw is the person's own, stateless. LIVING §3.7 second pass: the warned town of the default meteor was 30–300 m
    // out on the roads when it burst, under a blast that peaked at 0.76, and nobody died of it. Those at home or at work
    // take the blow as before — the full-wrath stone, which gives no warning, is today's. `road`: who was on the road
    // when the act began — onRoad — since the blow's first part breaks off what everyone near it was doing)
    if (o.mortal && A.health[s] > 0 && k > o.mortal.k0 && (o.mortal.road ? o.mortal.road.has(s) : onRoadNow(A.task[s])) && hash01(A.id[s], u.tick, (o.salt ?? 0) ^ 0x3a7a) < Math.min(o.mortal.cap, (k - o.mortal.k0) * o.mortal.gain)) A.health[s] = 0;
    // (the god's harm frightens through its witnesses' reading, god/regard.ts; nature's frightens the hurt themselves —
    // as the god's only to those who believe it acts)
    if (ws.w === null && A.faith[s * 4] > 0.3) A.fear[s * 4] = Math.min(1, A.fear[s * 4] + (o.fear ?? 0.15) * Math.min(1, severity) * 0.5);
    A.remember(s, MEMK.injured, u.tick, 0);
    out.hurt++;
    if (A.health[s] <= 0) { noteDeath(p, A.settlement[s]); die(x, s, cause); out.dead++; }
    else if (!(A.flags[s] & AgentFlag.possessed) && !u.god.isHeld('agent', A.id[s])) interrupt(x, s);
  }
  // the survivors see their dead: a killing act is harm to all who saw it (LIVING §3.1)
  const act = currentAct();
  if (out.dead > 0 && act && !act.natural) witness(p, pos, R * 1.5 + 150, 'harm', Math.min(1, 0.3 + 0.05 * out.dead), act.god);
  return out;
}

const onRoadNow = (task: number): boolean => task === TASK.evacuate || task === TASK.flee;

/** the people of planet p on the road now: out of a danger on the god's warning, or running from one (slots) */
export function onRoad(p: Planet): Set<number> {
  const out = new Set<number>();
  const A = p.people?.agents;
  if (!A) return out;
  for (let s = 0; s < A.hi; s++) if (A.alive[s] && onRoadNow(A.task[s])) out.add(s);
  return out;
}

/**
 * Damage buildings within radius (severity 1 ruins an average building at the centre); `byStrength` scales the damage
 * by the material (a quake fells mudbrick before stone). Returns how many fell.
 */
export function wreckBuildings(u: Universe, p: Planet, pos: ArrayLike<number>, radius: number, severity: number, why: string, o: { flat?: boolean; byStrength?: number } = {}): number {
  if (!p.people || !p.people.buildings.length || severity <= 0) return 0;
  const x = makeCtx(u, p);
  let n = 0;
  const harmK = u.god.lawAt('disasters.harm', p.id);
  const ws = harmScale();
  const R = radius * ws.R;
  for (const b of x.ps.buildings.slice()) {
    if (b.flags & BuildingFlag.ruined) continue;
    const d = distM(p, b.pos, pos);
    if (d > R) continue;
    if (shielded(u, p, b.pos)) continue;
    const mat = x.c.materials.list[b.material];
    const str = Math.max(0.3, mat?.strength ?? 1);
    const k = severity * ws.B * harmK * (o.flat ? 1 : (1 - d / Math.max(1, R)) * 1.5) / Math.pow(str, o.byStrength ?? 1);
    if (k <= 0.002) continue;
    b.damage = Math.min(1, Math.round((b.damage + k) * 10000) / 10000);
    x.ps.version++;
    if (b.damage >= 1) { ruin(x, x.ps.settlement(b.settlement), b, why); n++; }
  }
  return n;
}

/** kill a share of the animals in herds within radius (falling off with distance); returns head count killed */
export function hurtHerds(u: Universe, p: Planet, pos: ArrayLike<number>, radius: number, share: number): number {
  const ps = p.people;
  if (!ps || !ps.herds.length || share <= 0) return 0;
  const x = makeCtx(u, p);
  let n = 0;
  for (const h of ps.herds) {
    herdPos(h, u.tick, _pt);
    const d = distM(p, _pt, pos);
    if (d > radius || shielded(u, p, _pt)) continue;
    const k = Math.min(1, share * (1 - d / Math.max(1, radius)) * 1.3);
    const lost = Math.round(h.count * k * 1000) / 1000;
    if (lost <= 0) continue;
    h.count = Math.round((h.count - lost) * 1000) / 1000;
    h.state = 2; // they flee
    h.scared = u.tick;
    n += lost;
  }
  const before = ps.herds.length;
  ps.herds = ps.herds.filter((h) => h.count >= 0.5);
  if (ps.herds.length !== before) reindexHerds(x);
  ps.version++;
  return Math.round(n);
}

/** strip crops / trees / shrubs / grass in a disc (k 0..1 at the centre); returns cells touched */
export function stripPlants(p: Planet, pos: ArrayLike<number>, radius: number, k: { crop?: number; tree?: number; shrub?: number; grass?: number }, burnt = 0): number {
  const f = p.f;
  const cells = p.cellsNear(pos, radius).slice();
  for (const c of cells) {
    const d = Math.min(1, distM(p, [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]], pos) / Math.max(1, radius));
    const w = 1 - d * d;
    if (k.crop) f.crop[c] = Math.max(0, f.crop[c] * (1 - k.crop * w));
    if (k.tree) f.tree[c] = Math.max(0, f.tree[c] * (1 - k.tree * w));
    if (k.shrub) f.shrub[c] = Math.max(0, f.shrub[c] * (1 - k.shrub * w));
    if (k.grass) f.grass[c] = Math.max(0, f.grass[c] * (1 - k.grass * w));
    if (burnt) f.burnt[c] = Math.max(f.burnt[c], burnt * w);
  }
  if (cells.length) {
    if (k.crop) p.bump('crop');
    if (k.tree) p.bump('tree');
    if (k.shrub) p.bump('shrub');
    if (k.grass) p.bump('grass');
    if (burnt) p.bump('burnt');
    p.vegDirty = true;
  }
  return cells.length;
}

/** stateless 0..1 */
export function hash01(a: number, b: number, c: number): number {
  return hashFloat(a, b, c, 0x6a11);
}

export { DEATH };
