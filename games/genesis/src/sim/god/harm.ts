// GENESIS — what disasters, thrown things and wrathful gods do to the living and the built (CONTRACT.md §11.3): hurt
// and kill people (by distance and severity), scatter and kill herds, wreck buildings by their material's strength,
// strip crops and trees. Shields (the shield miracle) keep everything inside them safe. Every function returns tallies
// so the chronicle can say what happened ("12 dead, 9 buildings in ruins").

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { BuildingFlag, AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, MEMK } from '../people/defs.ts';
import { die } from '../people/lifecycle.ts';
import { interrupt } from '../people/people.ts';
import { ruin } from '../people/buildings.ts';
import { distM } from '../people/world.ts';
import { herdPos, reindexHerds } from '../life/herds.ts';
import { hashFloat } from '../core/rng.ts';

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
export function hurtPeople(u: Universe, p: Planet, pos: ArrayLike<number>, radius: number, severity: number, cause: number = DEATH.disaster, o: { flat?: boolean; chance?: number; salt?: number; fear?: number } = {}): HurtResult {
  const out = { hurt: 0, dead: 0 };
  if (!p.people || p.people.agents.count === 0 || severity <= 0) return out;
  const x = makeCtx(u, p);
  const A = x.A;
  const harmK = u.god.lawAt('disasters.harm', p.id);
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    A.posAt(s, u.tick, _pt);
    const d = distM(p, _pt, pos);
    if (d > radius) continue;
    if (o.chance !== undefined && o.chance < 1 && hash01(A.id[s], u.tick, o.salt ?? 0x4a7) >= o.chance) continue;
    if (shielded(u, p, _pt)) continue;
    const k = severity * harmK * (o.flat ? 1 : (1 - d / Math.max(1, radius)) * 1.4);
    if (k <= 0.005) continue;
    A.health[s] -= k;
    A.fear[s * 4] = Math.min(1, A.fear[s * 4] + (o.fear ?? 0.15) * Math.min(1, severity));
    A.remember(s, MEMK.injured, u.tick, 0);
    out.hurt++;
    if (A.health[s] <= 0) { die(x, s, cause); out.dead++; }
    else if (!(A.flags[s] & AgentFlag.possessed) && !u.god.isHeld('agent', A.id[s])) interrupt(x, s);
  }
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
  for (const b of x.ps.buildings.slice()) {
    if (b.flags & BuildingFlag.ruined) continue;
    const d = distM(p, b.pos, pos);
    if (d > radius) continue;
    if (shielded(u, p, b.pos)) continue;
    const mat = x.c.materials.list[b.material];
    const str = Math.max(0.3, mat?.strength ?? 1);
    const k = severity * harmK * (o.flat ? 1 : (1 - d / Math.max(1, radius)) * 1.5) / Math.pow(str, o.byStrength ?? 1);
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
