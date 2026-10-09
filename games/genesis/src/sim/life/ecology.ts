// GENESIS — ecology (CONTRACT.md §10): herds and packs living off the planet's fields and each other.
//
//   hourly  grazers crop the vegetation fields (grass / shrub / tree / crop by their diet) and fill up or go hungry;
//           hunters stalk prey herds nearby, kill with a sigmoid (type III) response — a few animals always find
//           cover, and a fed pack rests — and feed by the meat of the kill; everyone breeds when fed (logistic within
//           the herd), starves when not, flees from hunting predators, follows its migration goal, or wanders to
//           better pasture; big herds split, so a species spreads; animals carry disease among themselves and to
//           people (rats and the plague); domestic herds go out to pasture by day and back to the pen at night, eat
//           fodder from the store when the grass is gone, and breed up to what the pens hold.
//   daily   herds merge, choose seasonal migration goals (toward a better place for the coming season), drift apart
//           from their kind when isolated — a herd cut off for years becomes a NEW species, named for its new home
//           and chronicled — and a species with no herd left on the world is EXTINCT (chronicled); animal plagues
//           break out in crowds and burn out.
//
// Every roll is a stateless hash of (herd id, tick, salt): results never depend on iteration order beyond the herd
// array's own (insertion) order, which is saved.

import type { PCtx } from '../people/ctx.ts';
import type { Herd } from '../people/state.ts';
import type { AnimalDef } from '../content.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { animalBase, animalDef, animalIdx, forage, grazer, habitatFit, herdPos, hunter, reindexHerds, spawnHerd, speciesCount } from './herds.ts';
import { offsetPoint, distM, sunElevation, cellPos } from '../people/world.ts';
import { seasonTemps } from '../people/settlement.ts';
import { DEATH } from '../people/defs.ts';
import { die } from '../people/lifecycle.ts';
import { tell } from '../people/story.ts';
import { itemIdx } from '../people/resources.ts';
import { storeHas, storeTake } from '../people/store.ts';
import { seedDisease } from './disease.ts';
import { packColor } from '../people/ctx.ts';

/** wild herds a planet keeps track of at most (splits stop beyond) */
export const MAX_HERDS = 220;
/** isolation that lets a herd become its own species: no herd of its kind within this many metres for ISO_DAYS */
export const ISO_RANGE_M = 3200;
export const ISO_DAYS = 36;

const _p = [0, 0, 0];
const _q = [0, 0, 0];
const _byCell = new Map<number, Herd[]>();

function massOf(a: AnimalDef): number {
  return a.mass ?? 60 * a.size * a.size * a.size;
}

// ───────────────────────────── hourly ─────────────────────────────

/** hourly: every herd eats, breeds or starves, sickens, and moves */
export function ecoStep(x: PCtx): void {
  const p = x.p;
  const herds = x.ps.herds;
  if (!herds.length) return;
  const yearH = Math.max(24, x.year / 60);
  // where everyone is (local encounters read the cell index)
  _byCell.clear();
  for (const h of herds) {
    if (h.count < 0.5) continue;
    herdPos(h, x.tick, _p);
    h.cell = p.cellAt(_p);
    let l = _byCell.get(h.cell);
    if (!l) _byCell.set(h.cell, (l = []));
    l.push(h);
  }
  const n = herds.length;
  for (let i = 0; i < n; i++) {
    const h = herds[i];
    if (h.count < 0.5) continue;
    const a = animalDef(x, h.species);
    const c = h.cell;
    const fit = habitatFit(x, h.species, c);
    const t = p.f.temperature[c];
    h.envT = (h.envT ?? t) + (t - (h.envT ?? t)) * 0.01;
    // feeding
    if (h.owner >= 0) feedDomestic(x, h, a, c);
    else if (grazer(a)) h.hunger = clamp01(h.hunger + (0.45 - graze(x, h, a, c)) * 0.1);
    else if (hunter(a)) huntPrey(x, h, a, c);
    else if (a.kind === 'scavenger') h.hunger = clamp01(h.hunger + (carrionNear(x, h) || fit > 0.45 ? -0.04 : 0.015));
    // fish, birds of the air: the place feeds them — as many as it can carry (a cell's water or sky holds so much life;
    // shoals beyond it go hungry, breed no more and split off to emptier water)
    else h.hunger = clamp01(h.hunger + (fit > 0.3 && placeLoad(x, h) <= PLACE_K * fit ? -0.05 : 0.03));
    // breeding and starving
    breed(x, h, a, fit, yearH);
    // sickness
    if ((h.sick ?? -1) >= 0) animalSickness(x, h);
    h.count = Math.round(h.count * 1000) / 1000;
    if (h.count < 0.5) continue;
    // move when the leg is done
    if (x.tick >= h.t1) move(x, h, a, fit);
  }
  splitHerds(x);
  if (herds.some((h) => h.count < 0.5)) {
    x.ps.herds = herds.filter((h) => h.count >= 0.5);
    reindexHerds(x);
    x.ps.version++;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** crop the fields of cell c by the herd's diet; returns intake / need (0..1) */
function graze(x: PCtx, h: Herd, a: AnimalDef, c: number): number {
  const f = x.p.f;
  const need = Math.min(0.3, 0.0009 * Math.pow(a.size, 0.75) * h.count);
  if (need <= 0) return 1;
  let got = 0;
  for (const d of a.diet) {
    const arr = d === 'grass' ? f.grass : d === 'shrub' ? f.shrub : d === 'tree' ? f.tree : d === 'crop' || d === 'grain' ? f.crop : null;
    if (!arr) continue;
    // browse and graze down to the stubble, never the roots (the land always comes back), and never strip a cell bare
    // in one hour (a herd moves on long before)
    const k = d === 'tree' ? 0.25 : 1;
    const floor = d === 'tree' ? 0.2 : d === 'crop' ? 0.02 : 0.06;
    const take = Math.min(Math.max(0, arr[c] - floor) * 0.5, (need - got) * k);
    if (take <= 0) continue;
    arr[c] -= take;
    got += take / k;
    if (got >= need) break;
  }
  return Math.min(1, got / need);
}

/** a fed predator pack rests; a hungry one kills prey in reach (type III: scattered prey hides, a herd is found) */
function huntPrey(x: PCtx, h: Herd, a: AnimalDef, c: number): void {
  // a pack needs a kill every few days (a deer feeds four wolves for most of a week)
  h.hunger = clamp01(h.hunger + 0.007);
  if (h.hunger < 0.25) return;
  const g = x.p.grid;
  const maxSize = a.size * (1 + h.count * 0.5);
  let best: Herd | null = null, bv = 0;
  const look = (cell: number) => {
    const l = _byCell.get(cell);
    if (!l) return;
    for (const o of l) {
      // the last few of a herd always find cover (prey refuge: no herd is hunted out)
      if (o === h || o.count < 2.5) continue;
      const b = animalDef(x, o.species);
      if (!(grazer(b) && b.kind !== 'insect') || b.size > maxSize || b.habitat === 'air') continue;
      if (b.habitat !== a.habitat && !(a.habitat === 'land' && b.habitat === 'land')) continue;
      // the most meat for the chase; penned livestock is guarded
      const v = Math.min(o.count, 6) * massOf(b) * (o.owner >= 0 ? 0.4 : 1);
      if (v > bv) { bv = v; best = o; }
    }
  };
  // a pack covers ground within the hour: prey two cells off is in reach of the chase
  look(c);
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    look(o);
    for (let e2 = g.nbrStart[o]; e2 < g.nbrStart[o + 1]; e2++) if (g.nbr[e2] !== c) look(g.nbr[e2]);
  }
  if (best) {
    const prey: Herd = best;
    const b = animalDef(x, prey.species);
    const m = prey.count;
    const p = 0.3 * (m * m / (m * m + 16)) * (1 - b.flee * 0.5) * Math.min(1.6, 0.4 + h.count * 0.2) * (prey.owner >= 0 ? 0.5 : 1);
    prey.scared = x.tick;
    if (hashFloat(h.id, prey.id, x.tick, 0x9e7) < p) {
      // a big pack on small prey takes several
      const kills = Math.max(1, Math.min(Math.floor(m * 0.3), Math.floor((massOf(a) * h.count) / (massOf(b) * 4)), Math.floor(m - 2)));
      prey.count = Math.max(0, prey.count - kills);
      h.hunger = clamp01(h.hunger - Math.min(0.9, (kills * massOf(b)) / (h.count * massOf(a) * 0.9)));
      if (prey.owner >= 0) x.u.emit({ t: 'livestock.killed', planet: x.p.id, a: prey.species, data: { herd: prey.id, by: h.species, settlement: prey.owner } });
    }
  }
  // omnivores fall back on berries and roots
  if (h.hunger > 0.6 && a.diet.some((d) => d !== 'meat')) h.hunger = clamp01(h.hunger - graze(x, h, a, c) * 0.05);
  // hungry and dangerous: people at night are prey too
  if (a.danger >= 0.4 && h.hunger > 0.6) attackPeople(x, h, a);
}

/** carrion: predators nearby leave kills */
function carrionNear(x: PCtx, h: Herd): boolean {
  const P = x.p.grid.pos;
  const reach = Math.cos((4 * x.p.edgeM) / x.p.st.radius);
  for (const o of x.ps.herds) {
    if (o === h || o.count < 1) continue;
    const b = animalDef(x, o.species);
    if (b.kind !== 'predator') continue;
    if (P[o.cell * 3] * P[h.cell * 3] + P[o.cell * 3 + 1] * P[h.cell * 3 + 1] + P[o.cell * 3 + 2] * P[h.cell * 3 + 2] >= reach) return true;
  }
  return false;
}

/** a hungry dangerous predator may maul someone in its cell */
function attackPeople(x: PCtx, h: Herd, a: AnimalDef): void {
  if (!x.ps.buckets.any(h.cell)) return;
  const victims: number[] = [];
  x.ps.agentsIn(h.cell, victims);
  if (!victims.length) return;
  const v = victims[hash32(h.id, x.tick) % victims.length];
  if (hashFloat(h.id, x.A.id[v], x.tick, 0xa77) > a.danger * 0.08) return;
  x.A.health[v] -= 0.3 + a.danger * 0.4;
  x.A.flags[v] |= 64; // sick (wounded)
  h.hunger = clamp01(h.hunger - 0.4);
  x.u.emit({ t: 'attack', planet: x.p.id, a: h.species, ref: { kind: 'agent', id: x.A.id[v], planet: x.p.id }, data: { herd: h.id } });
  if (x.A.health[v] <= 0) die(x, v, DEATH.predator);
}

/** births when fed (logistic within the herd), deaths when starving or out of place */
function breed(x: PCtx, h: Herd, a: AnimalDef, fit: number, yearH: number): void {
  // packs raise young only when well fed (their numbers follow the game, a little behind)
  const fedLine = hunter(a) ? 0.25 : 0.35;
  if (h.hunger < fedLine && fit > 0.25) {
    let k = (a.breed / yearH) * (1 - h.hunger / fedLine);
    // a herd fills up to twice its usual size, then stops (the rest live in daughter herds)
    const K = Math.max(2, a.herd[1] * 2);
    k *= Math.max(0, 1 - h.count / K);
    if ((h.inv ?? -1) > x.tick) k *= 1.6;
    if (h.owner >= 0) k *= 1.2;
    h.count += h.count * k;
  }
  if (h.hunger > 0.8) h.count -= h.count * (hunter(a) ? 0.003 : 0.005) * ((h.hunger - 0.8) / 0.2);
  if (fit <= 0) h.count -= h.count * 0.006;
}

/** sick animals die a little and pass it on; zoonoses reach people of the land they roam */
function animalSickness(x: PCtx, h: Herd): void {
  const d = h.sick ?? -1;
  if (d < 0) return;
  const def = x.c.diseases.list[d];
  if (!def) { h.sick = -1; return; }
  h.count -= h.count * def.mortality * 0.05;
  const g = x.p.grid;
  const pass = (cell: number) => {
    const l = _byCell.get(cell);
    if (!l) return;
    for (const o of l) if (o !== h && (o.sick ?? -1) < 0 && hashFloat(h.id, o.id, x.tick, 0x5c1) < def.contagion * 0.4) o.sick = d;
  };
  pass(h.cell);
  for (let e = g.nbrStart[h.cell]; e < g.nbrStart[h.cell + 1]; e++) pass(g.nbr[e]);
  // to people: a sick herd on a settlement's land (rats in the granary, a sick flock)
  if (def.transmission === 'animal') {
    const sid = x.p.f.territory[h.cell];
    if (sid >= 0 && hashFloat(h.id, x.tick, 0x200) < 0.04) {
      const st = x.ps.settlement(sid);
      if (st && st.fallen < 0 && seedDisease(x, st, d, 1, `the ${plural(animalDef(x, h.species).name.toLowerCase())}`) > 0) h.scared = x.tick;
    }
  }
}

// ───────────────────────────── movement ─────────────────────────────

/**
 * One hop from cell c toward unit vector `to` over cells the species can live on: the neighbour that gets closest, or
 * — stuck against a shore or a range — a sidestep along it (any livable neighbour, by a roll), so herds work round
 * obstacles instead of pacing at them.
 */
function hopToward(x: PCtx, sp: number, c: number, to: ArrayLike<number>, salt = 0): number {
  const g = x.p.grid, P = g.pos;
  const here = P[c * 3] * to[0] + P[c * 3 + 1] * to[1] + P[c * 3 + 2] * to[2];
  let best = c, bd = here, side = c, sv = -Infinity;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    if (habitatFit(x, sp, o) <= 0) continue;
    const d = P[o * 3] * to[0] + P[o * 3 + 1] * to[1] + P[o * 3 + 2] * to[2];
    if (d > bd) { bd = d; best = o; }
    const v = d + hashFloat(o, salt, x.tick, 0x51de) * 0.02;
    if (v > sv) { sv = v; side = o; }
  }
  return best !== c ? best : side;
}

/** start a leg to cell `to` at a speed factor (1 = an easy walk) */
function leg(x: PCtx, h: Herd, a: AnimalDef, to: number, pace: number, state: number): void {
  const P = x.p.grid.pos;
  herdPos(h, x.tick, _p);
  const end: [number, number, number] = [0, 0, 0];
  offsetPoint([P[to * 3], P[to * 3 + 1], P[to * 3 + 2]], 8 * hashFloat(h.id, x.tick, 0x3e6), hashFloat(h.id, x.tick, 0x3e7) * 6.283, x.p.st.radius, end);
  const dist = distM(x.p, _p, end);
  const v = 0.25 * Math.max(0.2, a.speed) * pace;
  h.from = [_p[0], _p[1], _p[2]];
  h.to = end;
  h.t0 = x.tick;
  h.t1 = x.tick + Math.max(10, Math.round(dist / Math.max(0.02, v)));
  h.state = state;
}

function move(x: PCtx, h: Herd, a: AnimalDef, fit: number): void {
  const g = x.p.grid, P = g.pos;
  const c = h.cell;
  if (h.owner >= 0) { moveDomestic(x, h, a); return; }
  // flee a hunting pack close by
  if (grazer(a) && h.scared >= 0 && x.tick - h.scared < 90) {
    const threat = hunterNear(x, h, a);
    if (threat) {
      let best = c, bd = 2;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (habitatFit(x, h.species, o) <= 0) continue;
        const d = P[o * 3] * P[threat.cell * 3] + P[o * 3 + 1] * P[threat.cell * 3 + 1] + P[o * 3 + 2] * P[threat.cell * 3 + 2];
        if (d < bd) { bd = d; best = o; }
      }
      if (best !== c) {
        const far = hopToward(x, h.species, best, cellPos(x.p, best, _q).map((v, k) => v * 2 - P[threat.cell * 3 + k]));
        leg(x, h, a, far !== best ? far : best, 1.3, 2);
        return;
      }
    }
  }
  // a hungry pack goes where the prey is
  if (hunter(a) && h.hunger > 0.3) {
    const prey = preyNear(x, h, a);
    if (prey) {
      herdPos(prey, x.tick, _q);
      let to = hopToward(x, h.species, c, _q, h.id);
      to = hopToward(x, h.species, to, _q, h.id + 1);
      to = hopToward(x, h.species, to, _q, h.id + 2);
      if (to !== c) { leg(x, h, a, to, 1.3, 1); return; }
    }
  }
  // the season's migration
  if ((h.goal ?? -1) >= 0) {
    const goal = h.goal!;
    if (goal === c || adjacent(x, goal, c)) h.goal = -1;
    else {
      cellPos(x.p, goal, _q);
      let to = hopToward(x, h.species, c, _q);
      to = hopToward(x, h.species, to, _q);
      if (to !== c) { leg(x, h, a, to, 0.8, 1); return; }
      h.goal = -1;
    }
  }
  // graze on, or rest where it is good
  if (h.hunger < 0.5 && fit > 0.3 && hashFloat(h.id, x.tick, 0x3e4) > 0.25) { h.state = 0; return; }
  let best = c, bv = fit + 0.05;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    const v = habitatFit(x, h.species, o) + hashFloat(h.id, o, x.tick, 0x3e5) * 0.15 - crowdAt(o, h) * 0.1;
    if (v > bv) { bv = v; best = o; }
  }
  if (best === c) { h.state = 3; return; }
  leg(x, h, a, best, 0.45, 1);
}

function adjacent(x: PCtx, a: number, b: number): boolean {
  const g = x.p.grid;
  for (let e = g.nbrStart[a]; e < g.nbrStart[a + 1]; e++) if (g.nbr[e] === b) return true;
  return false;
}

/** carrying capacity of one cell for the kinds the place feeds (count × size^0.75 units) */
const PLACE_K = 90;

/** the place-fed life in herd h's cell (h included) */
function placeLoad(x: PCtx, h: Herd): number {
  const l = _byCell.get(h.cell);
  if (!l) return 0;
  const a = animalDef(x, h.species);
  let n = 0;
  for (const o of l) {
    const b = animalDef(x, o.species);
    if (o.owner >= 0 || grazer(b) || hunter(b) || b.kind === 'scavenger' || (b.habitat === 'air') !== (a.habitat === 'air')) continue;
    n += o.count * Math.pow(b.size, 0.75);
  }
  return n;
}

function crowdAt(c: number, self: Herd): number {
  const l = _byCell.get(c);
  if (!l) return 0;
  let n = 0;
  for (const o of l) if (o !== self) n++;
  return n;
}

/** a hunting pack within two cells that could take this herd */
function hunterNear(x: PCtx, h: Herd, a: AnimalDef): Herd | null {
  const P = x.p.grid.pos;
  const reach = Math.cos((2.5 * x.p.edgeM) / x.p.st.radius);
  const hc = h.cell;
  for (const o of x.ps.herds) {
    if (o === h || o.count < 1 || o.owner >= 0) continue;
    const b = animalDef(x, o.species);
    if (!hunter(b) || o.hunger < 0.25 || a.size > b.size * (1 + o.count * 0.5)) continue;
    if (P[o.cell * 3] * P[hc * 3] + P[o.cell * 3 + 1] * P[hc * 3 + 1] + P[o.cell * 3 + 2] * P[hc * 3 + 2] >= reach) return o;
  }
  return null;
}

/** the nearest prey herd within the pack's range */
function preyNear(x: PCtx, h: Herd, a: AnimalDef): Herd | null {
  const P = x.p.grid.pos;
  // the hungrier, the further the pack ranges for a scent; a starving pack roams wherever game is left
  const reach = h.hunger > 0.6 ? -1.01 : Math.cos(Math.min(Math.PI, ((5 + 35 * h.hunger) * Math.min(x.p.edgeM, 60)) / x.p.st.radius));
  const maxSize = a.size * (1 + h.count * 0.5);
  const hc = h.cell;
  let best: Herd | null = null, bd = reach;
  for (const o of x.ps.herds) {
    if (o === h || o.count < 1) continue;
    const b = animalDef(x, o.species);
    if (!grazer(b) || b.kind === 'insect' || b.size > maxSize || b.habitat === 'air' || o.count < 2.5) continue;
    const d = P[o.cell * 3] * P[hc * 3] + P[o.cell * 3 + 1] * P[hc * 3 + 1] + P[o.cell * 3 + 2] * P[hc * 3 + 2];
    if (d > bd) { bd = d; best = o; }
  }
  return best;
}

// ───────────────────────────── livestock ─────────────────────────────

/** domestic herds graze their pasture, or eat fodder from the store */
function feedDomestic(x: PCtx, h: Herd, a: AnimalDef, c: number): void {
  if (!grazer(a)) { h.hunger = clamp01(h.hunger - 0.03); return; } // dogs live off the settlement
  let intake = graze(x, h, a, c);
  if (intake < 0.6) {
    const st = x.ps.settlement(h.owner);
    if (st) {
      // fodder: grain, roots, hay from the store (a little per head)
      const want = (0.6 - intake) * h.count * 0.004 * Math.max(0.3, a.size);
      for (const id of ['grain', 'roots', 'reeds']) {
        const it = itemIdx(x, id);
        if (it < 0 || storeHas(st, it) <= 0.01) continue;
        const got = storeTake(st, it, want);
        intake += (got / Math.max(1e-6, want)) * (0.6 - intake);
        break;
      }
    }
  }
  h.hunger = clamp01(h.hunger + (0.45 - intake) * 0.1);
}

/** livestock: out to pasture by day, into the pen at night; the pens hold so many */
function moveDomestic(x: PCtx, h: Herd, a: AnimalDef): void {
  const st = x.ps.settlement(h.owner);
  if (!st || st.fallen >= 0) { h.owner = -1; h.state = 0; return; }
  const pens = x.ps.of(st.id).filter((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'pen');
  const pen = pens[0];
  // more animals than the pens hold: the herders keep the best and the rest are slaughtered (herd() in work.ts) or
  // run off to live wild
  const cap = 8 + pens.length * 10;
  if (h.count > cap * 1.5 && a.domestic) h.count = cap * 1.5;
  herdPos(h, x.tick, _p);
  const ctr = pen ? pen.pos : st.pos;
  const night = sunElevation(x.u, x.p, x.tick, ctr) < 0;
  let to: number;
  // out to pasture needs the know-how; without it the beasts stay by the pen and eat fodder
  const k = x.rt.byId.get('pasture');
  const pasture = k !== undefined && st.library.includes(k);
  if (night || !grazer(a) || !st.flow || (!pasture && pen)) to = pen ? pen.cell : st.cell;
  else {
    // the day's pasture: the grassiest of a few territory cells off the fields
    const cells = st.flow.cells;
    to = pen ? pen.cell : st.cell;
    let bv = forage(x, a, to) + 0.05;
    for (let k = 0; k < 6; k++) {
      const cc = cells[hash32(h.id, Math.floor(x.tick / 720), k, 0x9a5) % cells.length];
      if (x.p.f.crop[cc] > 0.02 || st.fields.includes(cc) || x.p.f.water[cc] > 0.3) continue;
      if (distM(x.p, cellPos(x.p, cc, _q), st.pos) > 260) continue;
      const v = forage(x, a, cc);
      if (v > bv) { bv = v; to = cc; }
    }
  }
  const P = x.p.grid.pos;
  const end: [number, number, number] = [0, 0, 0];
  const base = to === (pen ? pen.cell : -1) && pen ? pen.pos : [P[to * 3], P[to * 3 + 1], P[to * 3 + 2]];
  offsetPoint(base, 3 + 5 * hashFloat(h.id, x.tick, 0x9e9), hashFloat(h.id, x.tick, 0x9ea) * 6.283, x.p.st.radius, end);
  const dist = distM(x.p, _p, end);
  h.from = [_p[0], _p[1], _p[2]];
  h.to = end;
  h.t0 = x.tick;
  h.t1 = x.tick + Math.max(40, Math.round(dist / (0.25 * Math.max(0.2, a.speed) * 0.5)));
  h.state = pen && (night || to === pen.cell) ? 4 : 0;
}

// ───────────────────────────── splits ─────────────────────────────

function splitHerds(x: PCtx): void {
  const herds = x.ps.herds;
  if (herds.length >= MAX_HERDS) return;
  // (a lineage shares one cap: daughter species count against their root's, or every speciation added a fresh cap)
  const perSpecies = new Map<number, number>();
  for (const h of herds) { const b = animalBase(x, h.species); perSpecies.set(b, (perSpecies.get(b) ?? 0) + 1); }
  const cap = Math.max(6, Math.floor(MAX_HERDS / 8));
  const n = herds.length;
  for (let i = 0; i < n && herds.length < MAX_HERDS; i++) {
    const h = herds[i];
    if (h.owner >= 0 || h.count < 2) continue;
    const a = animalDef(x, h.species);
    const root = animalBase(x, h.species);
    if (h.count <= a.herd[1] * 1.6 || (perSpecies.get(root) ?? 0) >= cap) continue;
    // half walk off to the best neighbouring ground
    const g = x.p.grid;
    let best = -1, bv = 0.15;
    for (let e = g.nbrStart[h.cell]; e < g.nbrStart[h.cell + 1]; e++) {
      const o = g.nbr[e];
      const v = habitatFit(x, h.species, o) + hashFloat(h.id, o, x.tick, 0x5b1) * 0.1;
      if (v > bv) { bv = v; best = o; }
    }
    if (best < 0) continue;
    const half = Math.floor(h.count / 2);
    h.count = Math.round((h.count - half) * 1000) / 1000;
    const d = spawnHerd(x, h.species, best, half);
    perSpecies.set(root, (perSpecies.get(root) ?? 0) + 1);
    d.hunger = h.hunger;
    d.iso = h.iso;
    d.drift = h.drift;
    d.envT = h.envT;
    d.sick = h.sick;
    d.inv = h.inv;
    perSpecies.set(h.species, (perSpecies.get(h.species) ?? 0) + 1);
  }
}

// ───────────────────────────── daily ─────────────────────────────

export function ecoDaily(x: PCtx): void {
  const herds = x.ps.herds;
  mergeHerds(x);
  migrationGoals(x);
  isolationAndSpeciation(x);
  animalOutbreaks(x);
  // populations: peaks, extinctions
  const count = new Map<number, number>();
  for (const h of herds) count.set(h.species, (count.get(h.species) ?? 0) + h.count);
  for (const [sp, v] of [...count.entries()].sort((a, b) => a[0] - b[0])) {
    const key = String(sp);
    if (x.ps.eco.seen[key] === undefined) x.ps.eco.seen[key] = x.tick;
    if (v > (x.ps.eco.peak[key] ?? 0)) x.ps.eco.peak[key] = Math.round(v);
  }
  for (const key of Object.keys(x.ps.eco.seen).sort((a, b) => Number(a) - Number(b))) {
    const sp = Number(key);
    if ((count.get(sp) ?? 0) > 0 || x.ps.eco.extinct[key] !== undefined) continue;
    x.ps.eco.extinct[key] = x.tick;
    const a = animalDef(x, sp);
    if (a.domestic) continue; // livestock that died out is a settlement's loss, not the world's
    if (x.ps.eco.became?.[key] !== undefined) continue; // the last of them became another species
    tell(x.u, x.p, 'extinction', { animal: plural(a.name), planet: x.p.name }, null, undefined, 2);
    x.u.emit({ t: 'extinction', planet: x.p.id, a: sp, text: a.name, data: { species: a.id } });
  }
}

/** small herds of one kind in one cell join up */
function mergeHerds(x: PCtx): void {
  const herds = x.ps.herds;
  let merged = false;
  for (let i = 0; i < herds.length; i++) {
    const h = herds[i];
    if (h.count < 0.5 || h.owner >= 0) continue;
    const a = animalDef(x, h.species);
    if (h.count >= a.herd[0]) continue;
    for (let j = i + 1; j < herds.length; j++) {
      const o = herds[j];
      if (o.count < 0.5 || o.owner >= 0 || o.species !== h.species || o.cell !== h.cell) continue;
      if (h.count + o.count > a.herd[1] * 1.5) continue;
      h.count += o.count;
      h.hunger = Math.min(h.hunger, o.hunger);
      h.iso = Math.min(h.iso ?? 0, o.iso ?? 0);
      h.drift = Math.min(h.drift ?? 0, o.drift ?? 0);
      o.count = 0;
      merged = true;
      break;
    }
  }
  if (merged) {
    x.ps.herds = herds.filter((h) => h.count >= 0.5);
    reindexHerds(x);
    x.ps.version++;
  }
}

/** grazers whose ground will not carry them through the coming season walk to one that will */
function migrationGoals(x: PCtx): void {
  const p = x.p;
  for (const h of x.ps.herds) {
    if (h.owner >= 0 || h.count < 1) continue;
    const a = animalDef(x, h.species);
    if (!grazer(a) || a.habitat !== 'land' || a.swarm) continue;
    const [, lo, hi] = a.temp;
    // the coming months, by the sun's swing
    const ahead = seasonTemps(x, h.cell).ahead;
    const fit = habitatFit(x, h.species, h.cell);
    const comfort = (t: number) => (t < lo ? -(lo - t) / 8 : t > hi ? -(t - hi) / 8 : 0.4);
    const here = fit + comfort(ahead);
    if (here > 0.55 && (h.goal ?? -1) < 0) continue;
    herdPos(h, x.tick, _p);
    const cells = p.cellsNear(_p, 900);
    let best = -1, bv = here + 0.15;
    for (let i = hash32(h.id, x.tick, 0x316) % 3; i < cells.length; i += 3) {
      const c = cells[i];
      const f2 = habitatFit(x, h.species, c);
      if (f2 <= 0.1) continue;
      const ahead2 = seasonTemps(x, c).ahead;
      const v = f2 + comfort(ahead2) - distM(p, _p, cellPos(p, c, _q)) / 3000;
      if (v > bv) { bv = v; best = c; }
    }
    h.goal = best;
  }
}

/** herds cut off from their kind drift apart; after years alone they become a new species */
function isolationAndSpeciation(x: PCtx): void {
  const herds = x.ps.herds;
  const P = x.p.grid.pos;
  const reach = Math.cos(ISO_RANGE_M / x.p.st.radius);
  const airReach = Math.cos(Math.min(Math.PI, (ISO_RANGE_M * 5) / x.p.st.radius));
  for (const h of herds) {
    if (h.owner >= 0 || h.count < 2) continue;
    const a = animalDef(x, h.species);
    if (a.domestic || a.swarm) continue;
    // one connected ocean is one population (whale lineages were renamed every three years, each rename chronicled
    // with an extinction); fliers meet their kin over far greater distances than walkers
    const sea = a.habitat === 'sea';
    const r = a.habitat === 'air' ? airReach : reach;
    let kin = false;
    for (const o of herds) {
      if (o === h || o.species !== h.species || o.count < 1) continue;
      if ((o.iso ?? 0) > 0 && o.owner < 0 && sameGroup(x, h, o)) continue; // its own offshoots do not end its isolation
      if (sea || P[o.cell * 3] * P[h.cell * 3] + P[o.cell * 3 + 1] * P[h.cell * 3 + 1] + P[o.cell * 3 + 2] * P[h.cell * 3 + 2] >= r) { kin = true; break; }
    }
    if (kin) {
      h.iso = Math.max(0, (h.iso ?? 0) - 2);
      h.drift = Math.max(0, (h.drift ?? 0) - 0.05);
      continue;
    }
    h.iso = (h.iso ?? 0) + 1;
    // directional selection: the further its home is from what its kind is made for, the faster it changes
    const mid = (a.temp[1] + a.temp[2]) / 2;
    const env = Math.min(1.5, Math.abs((h.envT ?? mid) - mid) / 12);
    h.drift = (h.drift ?? 0) + ((1 + env) / ISO_DAYS) * 0.6;
    if (h.iso >= ISO_DAYS && h.drift >= 1 && hashFloat(h.id, x.tick, 0x5be) < 0.25) speciate(x, h);
  }
}

/** two isolated herds that split from one another (both cut off from the rest, within the range) count as one group */
function sameGroup(x: PCtx, a: Herd, b: Herd): boolean {
  return Math.abs((a.iso ?? 0) - (b.iso ?? 0)) <= 3;
}

const PREFIX_COLD = ['Snow', 'Frost', 'Woolly', 'Pale'];
const PREFIX_HOT = ['Dune', 'Desert', 'Sun', 'Red'];
const PREFIX_SEA = ['Deep', 'Blue', 'Grey', 'Silver', 'Long-finned'];
const PREFIX_FRESH = ['River', 'Lake', 'Silver', 'Speckled', 'Reed'];
const PREFIX_AIR = ['Cloud', 'High', 'Wind', 'Broad-winged'];
const PREFIX_COLD_AIR = ['Snow', 'Pale', 'Frost'];
const PREFIX_HOT_AIR = ['Sun', 'Red', 'Dust'];
const PREFIX_BIOME: Record<string, string[]> = {
  forest: ['Forest', 'Shade'], rainforest: ['Jungle', 'Canopy'], taiga: ['Pine', 'Taiga'], tundra: ['Tundra', 'Moss'],
  mountain: ['Highland', 'Crag'], wetland: ['Marsh', 'Reed'], grassland: ['Plains', 'Grass'], steppe: ['Steppe', 'Wind'],
  savanna: ['Thorn', 'Savanna'], scrub: ['Scrub', 'Brush'], desert: ['Dune', 'Sand'], coast: ['Shore', 'Island'], ice: ['Ice', 'Glacier'],
  ocean: ['Deep', 'Blue'], reef: ['Reef', 'Coral'],
};

/** a new species from herd h, adapted to where it lives; chronicled */
export function speciate(x: PCtx, h: Herd): number {
  const parent = animalDef(x, h.species);
  const base = animalBase(x, h.species);
  const f = x.p.f;
  const envT = h.envT ?? f.temperature[h.cell];
  const [mn, lo, hi, mx] = parent.temp;
  const mid = (lo + hi) / 2;
  const shift = Math.round((envT - mid) * 0.5);
  const cold = envT < lo + 3, hot = envT > hi - 3;
  const biome = x.c.biomes.list[f.biome[h.cell]]?.id ?? 'grassland';
  const roll = hashFloat(h.id, x.tick, 0x5bf);
  // names by habitat: water kinds take water words (never a 'Woolly whale' or a 'Dune fish'), fliers sky words
  const words = parent.habitat === 'sea' ? PREFIX_SEA : parent.habitat === 'water' ? PREFIX_FRESH
    : parent.habitat === 'air' ? (cold ? PREFIX_COLD_AIR : hot ? PREFIX_HOT_AIR : PREFIX_AIR)
      : cold ? PREFIX_COLD : hot ? PREFIX_HOT : PREFIX_BIOME[biome] ?? ['Lesser', 'Greater'];
  let prefix = words[hash32(h.id, x.tick, 0x5c0) % words.length];
  const rootName = x.c.animals.list[base]?.name ?? parent.name;
  let name = `${prefix} ${rootName.toLowerCase()}`;
  // unique among the species of this world
  for (let k = 0; animalIdx(x, slug(name)) >= 0 || x.c.animals.list.some((a) => a.name === name) || x.ps.species.some((d) => d.def.name === name); k++) {
    prefix = `${['Little', 'Great', 'Long-legged', 'Short-tailed', 'Striped', 'Spotted'][k % 6]} ${prefix.toLowerCase()}`;
    name = `${prefix} ${rootName.toLowerCase()}`;
  }
  const size = Math.round(parent.size * (cold ? 1.12 : hot ? 0.88 : roll < 0.5 ? 0.9 : 1.1) * 1000) / 1000;
  const tint = (hex: string) => shade(hex, cold ? 0.3 : hot ? 0.15 : biome === 'forest' || biome === 'rainforest' ? -0.2 : 0.08 * (roll - 0.5));
  const def: AnimalDef = {
    ...parent,
    id: slug(name),
    name: name.charAt(0).toUpperCase() + name.slice(1),
    size,
    mass: Math.round(massOf(parent) * Math.pow(size / parent.size, 3)),
    temp: [mn + shift, lo + shift, hi + shift, mx + shift],
    biomes: parent.biomes.includes(biome) ? parent.biomes.slice() : [...parent.biomes, biome],
    breed: Math.round(parent.breed * (0.9 + 0.25 * hashFloat(h.id, 0x5c2)) * 1000) / 1000,
    speed: Math.round(parent.speed * (0.95 + 0.13 * hashFloat(h.id, 0x5c3)) * 1000) / 1000,
    colors: parent.colors.map(tint),
    domestic: false,
  };
  const idx = x.c.animals.size + x.ps.species.length;
  x.ps.species.push({ idx, def, base, parent: h.species, born: x.tick });
  const from = h.species;
  // its kin left on this world, if any, stay what they were
  const others = x.ps.herds.some((o) => o !== h && o.species === from && o.count >= 0.5);
  if (!others) (x.ps.eco.became ??= {})[String(from)] = idx;
  for (const o of x.ps.herds) if (o.species === from && o !== h && o.owner < 0 && (o.iso ?? 0) > 0 && sameGroup(x, o, h)) { o.species = idx; o.iso = 0; o.drift = 0; }
  h.species = idx;
  h.iso = 0;
  h.drift = 0;
  x.ps.eco.seen[String(idx)] = x.tick;
  const years = Math.max(1, Math.round(ISO_DAYS / Math.max(1, x.year / x.day)));
  const place = biome === 'ocean' || biome === 'reef' ? 'waters' : biome;
  tell(x.u, x.p, 'speciation', { parent: plural(parent.name), animal: plural(def.name), place, planet: x.p.name, years }, null, undefined, 2);
  herdPos(h, x.tick, _p);
  x.u.emit({ t: 'speciation', planet: x.p.id, pos: [_p[0], _p[1], _p[2]], a: idx, text: def.name, data: { species: def.id, parent: parent.id, base: x.c.animals.list[base]?.id } });
  x.ps.version++;
  return idx;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** lighten (k > 0) or darken (k < 0) a #rrggbb colour */
function shade(hex: string, k: number): string {
  const v = packColor(hex);
  const ch = (s: number) => {
    const c = (v >> s) & 255;
    const o = k >= 0 ? c + (255 - c) * k : c * (1 + k);
    return Math.max(0, Math.min(255, Math.round(o))).toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** 'deer' -> 'deer', 'Wild boar' -> 'wild boar', 'Wolf' -> 'wolves' (chronicle plurals) */
export function plural(name: string): string {
  const n = name.toLowerCase();
  if (/(deer|sheep|bison|fish|shoal|swarm|cattle|aurochs)$/.test(n)) return n;
  if (/wolf$/.test(n)) return n.replace(/wolf$/, 'wolves');
  if (/(s|x|ch|sh)$/.test(n)) return `${n}es`;
  if (/[^aeiou]y$/.test(n)) return `${n.slice(0, -1)}ies`;
  return `${n}s`;
}

/** crowds of animals in warm wet country sometimes sicken (the animal-borne plagues) */
function animalOutbreaks(x: PCtx): void {
  const zoo = x.c.diseases.list.map((d, i) => (d.transmission === 'animal' ? i : -1)).filter((i) => i >= 0);
  for (const h of x.ps.herds) {
    if ((h.sick ?? -1) >= 0) {
      // the sickness burns out
      if (hashFloat(h.id, x.tick, 0x5c4) < 0.18) h.sick = -1;
      continue;
    }
    if (!zoo.length) continue;
    const a = animalDef(x, h.species);
    if (h.count < a.herd[1] * 1.2 || x.p.f.temperature[h.cell] < 8) continue;
    const pests = a.diet.includes('grain') || a.id === 'rat';
    const p = (pests ? 0.02 : 0.002) * (x.p.f.moisture[h.cell] > 0.5 ? 1.5 : 1);
    if (hashFloat(h.id, x.tick, 0x5c5) < p) h.sick = zoo[hash32(h.id, x.tick) % zoo.length];
  }
}

// ───────────────────────────── invasive species (ships, the god's hand) ─────────────────────────────

/**
 * Bring a species to a new land: a herd that breeds fast for a few years and has no enemies yet (rats off the boats,
 * goats on an island, the player's rabbits). Returns the herd, or null where it cannot live.
 */
export function introduceSpecies(x: PCtx, sp: number, cell: number, count: number, why: string): Herd | null {
  if (habitatFit(x, sp, cell) <= 0) return null;
  const known = x.ps.eco.seen[String(sp)] !== undefined && x.ps.eco.extinct[String(sp)] === undefined;
  const h = spawnHerd(x, sp, cell, count);
  h.inv = x.tick + 3 * x.year;
  if (!known) {
    const a = animalDef(x, sp);
    tell(x.u, x.p, 'invasive', { animal: plural(a.name), planet: x.p.name, cause: why }, null, undefined, 1);
  }
  return h;
}

/** hook for other systems (ships arriving, disasters spawning swarms): species by id at a position */
export function invasiveHook(u: Universe, p: Planet, species: string, pos: ArrayLike<number>, count: number, why = 'with the ships'): number {
  if (!p.people) return -1;
  const x = makeCtx(u, p);
  const sp = animalIdx(x, species);
  if (sp < 0) return -1;
  const h = introduceSpecies(x, sp, p.cellAt(pos), count, why);
  return h ? h.id : -1;
}

/** total head count of a species on this world */
export function populationOf(x: PCtx, sp: number): number {
  let n = 0;
  for (const h of x.ps.herds) if (h.species === sp) n += h.count;
  return n;
}

export { speciesCount };
