// GENESIS — sacred places, shrines, pilgrimage and real sacred animals (LIVING.md §3.4.5, §3.4.7).
//
// A SACRED PLACE is a cell with a kind — spring, grove, mountain or site — made by `place.sacred { pos, kind? }`, by a
// prophet (the spring, the oldest grove, the highest peak within 2 km), by a great omen (a lightning-struck tree, a
// crater where nobody died) or by a martyr's death. Shrines rise there. At festivals and after hardship 10–30 % of the
// adults walk to the nearest sacred place within a day's walk and pray (faith +0.05, belonging); pilgrims of different
// towns meet there (contact, trade). Harming a sacred place unforetold — burning the grove, drying the spring, flattening
// the peak — is read as punishment: fear +0.3, trust −0.25.
//
// A SACRED ANIMAL — a REAL, life-size species, never a giant — is revered by a settlement (at most one): from its stories
// (people/culture.ts: the animal that fed them through a famine), from a prophet's reading of an animal omen, or by
// `settlement.sacred { settlement, animal }`. Hunting it is taboo there (culture.ts sacredAnimal, the hunters' check). The
// god culling it: trust −0.2, fear +0.2; the god multiplying or sparing it: trust +0.1.

import type { CommandRegistry } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement, Building } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { SacredPlace, V3 } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { MEMK, TASK } from '../people/defs.ts';
import { BELONG, NEED_N } from '../people/needs.ts';
import { chooseMaterial, styleOf } from '../people/buildings.ts';
import { meet } from '../people/culture.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { distM, spotInCell } from '../people/world.ts';
import { animalDef } from '../life/herds.ts';
import { cellPos3, fail, nearestSettlement, ok, placeName } from './util.ts';
import { moveSettlement, relOf, relStat, srel } from './regard.ts';
import { godAct } from './belief.ts';

export const PLACE_KINDS = ['spring', 'grove', 'mountain', 'site'] as const;

const _p = [0, 0, 0];

// ───────────────────────────── places ─────────────────────────────

/** what a place is now (the harm check compares it with what it was when it became sacred) */
function stateOf(p: Planet, kind: string, cell: number): number {
  switch (kind) {
    case 'spring': return p.springs.some((s) => s.cell === cell) || p.f.water[cell] > 0.05 ? 1 : 0;
    case 'grove': return Math.round(p.f.tree[cell] * 1000) / 1000;
    case 'mountain': return Math.round(p.f.surface[cell]);
    default: return 0;
  }
}

/** the kind a cell would be sacred as (water: a spring, trees: a grove, a height: a mountain, else a site) */
function kindAt(p: Planet, cell: number): string {
  if (p.springs.some((s) => s.cell === cell) || (p.f.water[cell] > 0.05 && p.f.water[cell] < 2 && !p.s.ocean[cell])) return 'spring';
  if (p.f.tree[cell] >= 0.4) return 'grove';
  if (p.f.surface[cell] - p.st.seaLevel > 400) return 'mountain';
  return 'site';
}

/** the nearest sacred place within `radius` of pos (null none) */
export function sacredNear(u: Universe, p: Planet, pos: ArrayLike<number>, radius: number): SacredPlace | null {
  let best: SacredPlace | null = null, bd = radius;
  for (const pl of u.god.rel?.places ?? []) {
    if (pl.planet !== p.id) continue;
    const d = distM(p, pl.pos, pos);
    if (d <= bd) { bd = d; best = pl; }
  }
  return best;
}

/**
 * Make a place sacred: at `pos` (the god's choice, a martyr's death, an omen), or — pos null — the settlement's natural
 * holy place within 2 km: a spring, else the oldest grove, else the highest peak. Returns it (or the one already there).
 */
export function addSacredPlace(u: Universe, p: Planet, st: Settlement | null, pos: ArrayLike<number> | null, by: string, kind?: string): SacredPlace | null {
  const R = relOf(u);
  let cell: number;
  let k: string;
  if (pos) {
    cell = p.cellAt(pos);
    k = kind ?? (by === 'martyr' ? 'site' : kindAt(p, cell));
  } else {
    if (!st) return null;
    const near = p.cellsNear(st.pos, 2000);
    const spring = p.springs.filter((s) => near.includes(s.cell)).sort((a, b) => a.cell - b.cell)[0];
    let best = -1, bv = -Infinity;
    if (spring) { best = spring.cell; k = 'spring'; }
    else {
      for (const c of near) { const v = p.f.tree[c] >= 0.6 ? p.f.tree[c] : -1; if (v > bv || (v === bv && c < best)) { bv = v; best = c; } }
      k = 'grove';
      if (best < 0 || bv < 0.6) {
        bv = -Infinity;
        for (const c of near) { if (p.f.water[c] > 0.1) continue; const v = p.f.surface[c]; if (v > bv || (v === bv && c < best)) { bv = v; best = c; } }
        k = 'mountain';
      }
    }
    if (best < 0) return null;
    cell = best;
  }
  const there = R.places.find((q) => q.planet === p.id && q.cell === cell);
  if (there) return there;
  const at = cellPos3(p, cell);
  const keeper = st ?? nearestSettlement(p, at, 3000);
  const pl: SacredPlace = { id: R.next++, planet: p.id, cell, pos: pos ? [pos[0], pos[1], pos[2]] : at, kind: k!, settlement: keeper?.id ?? -1, since: u.tick, by, was: stateOf(p, k!, cell) };
  R.places.push(pl);
  relStat(u, 'sacred.places');
  if (keeper && p.people) {
    const x = makeCtx(u, p);
    if (!keeper.culture.sacred.includes(`place:${cell}`)) keeper.culture.sacred.push(`place:${cell}`);
    tell(u, p, 'sacred.place', vars(x, keeper, -1, { place: placeWord(pl) }), keeper, [settlementRef(x, keeper)], 2);
  }
  u.emit({ t: 'sacred.place', planet: p.id, pos: [...pl.pos], data: { id: pl.id, kind: pl.kind, settlement: pl.settlement, by } });
  return pl;
}

function placeWord(pl: SacredPlace): string {
  return pl.kind === 'site' ? (pl.by === 'martyr' ? 'martyr\'s grave' : 'holy place') : pl.kind;
}

/** a shrine at a sacred place: a site the settlement builds (marked sacred) */
export function foundShrine(x: PCtx, st: Settlement, place: SacredPlace): Building | null {
  const t = x.c.buildings.idx('shrine');
  if (t < 0) return null;
  const mat = chooseMaterial(x, st, t);
  if (mat < 0) return null;
  const id = x.u.ids.alloc('building');
  const at = spotInCell(x.p, place.cell, id, 0x5a1, [0, 0, 0]);
  const b: Building = {
    id, type: t, material: mat, style: styleOf(st), pos: [at[0], at[1], at[2]], cell: place.cell, rot: Math.round(hashFloat(id, 0x5a2) * 6283) / 1000,
    scale: 1, progress: 0, delivered: 0, damage: 0, settlement: st.id, flags: BuildingFlag.sacred, books: [], built: -1, fuel: 0, occupants: 0, household: -1,
  };
  x.ps.addBuilding(b);
  st.sites.push(id);
  relStat(x.u, 'shrines');
  return b;
}

// ───────────────────────────── the hour: pilgrims, harm to the holy ─────────────────────────────

/**
 * Hourly per world: pilgrims at a sacred place pray there (faith, belonging; pilgrims of different towns meet), and
 * a sacred place harmed is read as punishment where it was not foretold.
 */
export function sacredHourly(u: Universe, p: Planet): void {
  const R = u.god.rel;
  if (!R || !R.places.length || !p.people) return;
  const x = makeCtx(u, p);
  const A = x.A;
  // pilgrims arrived
  const at = new Map<number, Set<number>>();
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s] || A.task[s] !== TASK.pilgrimage || A.phase[s] !== 1) continue;
    const pl = R.places.find((q) => q.id === A.tTarget[s]);
    if (!pl) continue;
    let done = false;
    for (let m = 0; m < 8; m++) if (A.memKind[s * 8 + m] === MEMK.pilgrimage && A.memA[s * 8 + m] === pl.id && u.tick - A.memTick[s * 8 + m] < 2 * x.day) done = true;
    if (!done) {
      A.remember(s, MEMK.pilgrimage, u.tick, pl.id);
      A.faith[s * 4] = Math.min(1, A.faith[s * 4] + 0.05);
      A.needs[s * NEED_N + BELONG] = Math.min(1, A.needs[s * NEED_N + BELONG] + 0.3);
      relStat(u, 'pilgrims');
    }
    let set = at.get(pl.id);
    if (!set) at.set(pl.id, (set = new Set()));
    set.add(A.settlement[s]);
  }
  for (const set of at.values()) {
    const ids = [...set].filter((v) => v >= 0).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) meet(x, x.ps.settlement(ids[i]), x.ps.settlement(ids[j]));
  }
  // harm to a sacred place
  for (const pl of R.places) {
    if (pl.planet !== p.id) continue;
    const now = stateOf(p, pl.kind, pl.cell);
    const harmed = pl.kind === 'spring' ? pl.was > 0 && now === 0 : pl.kind === 'grove' ? now < pl.was * 0.3 && pl.was > 0.2 : pl.kind === 'mountain' ? pl.was - now > 30 : false;
    if (!harmed) continue;
    pl.was = now;
    const st = x.ps.settlement(pl.settlement);
    if (!st || st.fallen >= 0) continue;
    const foretold = R.prophecies.some((q) => q.planet === p.id && q.settlement === st.id && q.kind === 'harm' && q.from <= u.tick && u.tick <= q.until);
    if (!foretold) moveSettlement(x, st, { fear: 0.3, trust: -0.25 });
    relStat(u, 'sacred.harmed');
    tell(u, p, 'sacred.harmed', vars(x, st, -1, { place: placeWord(pl) }), st, [settlementRef(x, st)], 2);
  }
}

/** twice a year and after a hardship has passed, a settlement goes on pilgrimage (rel.since.pilgrim: the season ends) */
export function pilgrimageDaily(u: Universe, p: Planet, st: Settlement): void {
  const R = u.god.rel;
  if (!R || !R.places.some((q) => q.planet === p.id) || st.band) return;
  const r = srel(u, p.id, st.id);
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  const cal = p.calendar(u.tick);
  const yd = Math.max(2, Math.round(p.st.orbit.period / day));
  const feast = cal.day === Math.max(1, Math.round(yd * 0.3)) || cal.day === Math.max(2, Math.round(yd * 0.8));
  const hard = r.since.hard ?? 0;
  const relief = (r.since.wasHard ?? 0) >= 0.8 && hard < 0.3;
  r.since.wasHard = hard;
  if (!feast && !relief) return;
  if ((r.since.pilgrim ?? -1) > u.tick) return;
  r.since.pilgrim = u.tick + day;
  r.since.pilgrimFrom = u.tick;
  r.since.pilgrimShare = Math.round((0.1 + 0.2 * hashFloat(st.id, u.tick, 0x9119)) * 1000) / 1000;
}

/** a pilgrim's walk (null: not this person, or nothing near): god/relationship.ts asks by day during a season */
export function pilgrimTask(x: PCtx, s: number, st: Settlement, night: boolean, pressing: number): TaskSpec | null {
  const u = x.u;
  const r = u.god.rel?.st[`${x.p.id}:${st.id}`];
  if (!r || night || pressing >= 1 || (r.since.pilgrim ?? -1) <= x.tick) return null;
  const A = x.A;
  if (A.flags[s] & AgentFlag.child) return null;
  const from = r.since.pilgrimFrom ?? 0;
  if (hashFloat(A.id[s], from, 0x9112) >= (r.since.pilgrimShare ?? 0.2)) return null;
  for (let m = 0; m < 8; m++) if (A.memKind[s * 8 + m] === MEMK.pilgrimage && A.memTick[s * 8 + m] >= from) return null;
  A.posAt(s, x.tick, _p);
  // the nearest sacred place within a day's walk (half a day out, half back: ~1.4 km at 2 m a minute)
  const pl = sacredNear(u, x.p, _p, 1400);
  if (!pl) return null;
  return { kind: TASK.pilgrimage, goal: spotInCell(x.p, pl.cell, A.id[s], 0x9113, [0, 0, 0]), goalCell: pl.cell, work: 60, target: pl.id };
}

// ───────────────────────────── sacred animals ─────────────────────────────

/** the animal a settlement reveres (animal id, '' none) */
export function sacredAnimalOf(st: Settlement): string {
  const t = st.culture.sacred.find((q) => q.startsWith('animal:'));
  return t ? t.slice(7) : '';
}

/** make `animal` (a content animal id, real) sacred to a settlement (replacing any other: at most one) */
export function revere(x: PCtx, st: Settlement, animal: string, why: 'god' | 'omen'): void {
  st.culture.sacred = st.culture.sacred.filter((q) => !q.startsWith('animal:'));
  st.culture.sacred.push(`animal:${animal}`);
  srel(x.u, x.p.id, st.id).animal = animal;
  const def = x.c.animals.find(animal);
  tell(x.u, x.p, why === 'god' ? 'sacred.animal.god' : 'sacred.animal.omen', vars(x, st, -1, { animal: (def?.name ?? animal).toLowerCase() }), st, [settlementRef(x, st)], 2);
  x.u.emit({ t: 'sacred.animal', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, animal } });
}

/** the god culled (or multiplied) a sacred species near a town that reveres it */
export function sacredAnimalAct(x: PCtx, species: number, pos: ArrayLike<number>, radius: number, culled: boolean): void {
  const def = animalDef(x, species);
  if (!def) return;
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || sacredAnimalOf(st) !== def.id) continue;
    if (distM(x.p, st.pos, pos) > radius + st.territory + 1500) continue;
    moveSettlement(x, st, culled ? { trust: -0.2, fear: 0.2 } : { trust: 0.1 });
    relStat(x.u, culled ? 'sacred.culled' : 'sacred.spared');
  }
}

// ───────────────────────────── commands ─────────────────────────────

export function registerSacredCommands(r: CommandRegistry): void {
  r.register('place.sacred', ({ u, p }, a) => {
    const pos = a.pos as V3 | null;
    if (!pos) return fail('Hallow where? Point at a spring, a grove, a peak.');
    const st = nearestSettlement(p, pos, 3000);
    const kind = typeof a.kind === 'string' ? a.kind : undefined;
    const pl = addSacredPlace(u, p, st, pos, 'god', kind);
    if (!pl) return fail('That place cannot be made sacred.');
    godAct(u, p, pos, 300, { wonder: 0.25 }, 0);
    return ok(`The ${placeWord(pl)} ${placeName(p, pos)} is sacred now${st ? `; ${st.name} will keep it` : ''}.`);
  }, { desc: 'Make a spring, a grove, a peak or a site sacred', category: 'Signs', params: { pos: { type: 'pos', required: true }, kind: { type: 'enum', values: [...PLACE_KINDS] } } });

  r.register('settlement.sacred', ({ u, p }, a) => {
    if (!p.people) return fail('There is nobody here to revere it.');
    const x = makeCtx(u, p);
    const st = typeof a.settlement === 'number' ? x.ps.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0) return fail('Which town? Name a settlement ("make the deer sacred to Aru").');
    const id = String(a.animal);
    const def = x.c.animals.find(id);
    if (!def) return fail(`There is no animal called '${id}' in this world.`);
    revere(x, st, def.id, 'god');
    godAct(u, p, st.pos, st.territory + 200, { wonder: 0.2 }, 0);
    return ok(`The ${def.name.toLowerCase()} is sacred to ${st.name}: none there will hunt it.`);
  }, { desc: 'Make a real animal sacred to a town (hunting it is taboo there)', category: 'Signs', params: { settlement: { type: 'int', required: true, min: 0 }, animal: { type: 'enum', values: (u: Universe) => u.content.animals.ids(), required: true } } });
}

/** query 'sacred': every sacred place, and each settlement's sacred animal */
export function sacredQuery(u: Universe): Record<string, unknown> {
  const animals: { planet: number; settlement: number; name: string; animal: string }[] = [];
  for (const p of u.planets) for (const st of p.people?.settlements ?? []) {
    const a = sacredAnimalOf(st);
    if (a && st.fallen < 0) animals.push({ planet: p.id, settlement: st.id, name: st.name, animal: a });
  }
  return { places: (u.god.rel?.places ?? []).map((q) => ({ ...q })), animals };
}

