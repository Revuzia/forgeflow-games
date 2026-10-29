// GENESIS — buildings (CONTRACT.md §8.5, §9, §15.6): siting, material choice, construction by hauled materials and
// labour, completion, heat sources, decay and repair, burning through fire.ts (buildings are fuel; a burning cell
// damages what stands in it; books burn), and ruins.
//
// Material: builders take, in the building type's preference order (the species' style first), the first material
// the settlement KNOWS how to build with and has enough of in its store; if none is affordable, the known material
// whose items are most available — and gatherers are asked for it. The renderer draws the material actually chosen.

import type { PCtx } from './ctx.ts';
import type { Building, Settlement } from './state.ts';
import type { Planet } from '../world/planet.ts';
import { BuildingFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { igniteCell } from '../fields/fire.ts';
import { offsetPoint, distM, isLand, spotInCell } from './world.ts';
import { storeAdd, storeHas, storeTake } from './store.ts';
import { availability } from './resources.ts';
import { checkLoss, recomputeWritten } from './knowledge.ts';
import { tell } from './story.ts';
import { lightNewHearth } from './fire.ts';
import { emitSt, settlementRef, vars } from './util.ts';

/** is building type `t` buildable by settlement st (knowledge + species) */
export function canBuild(x: PCtx, st: Settlement, t: number): boolean {
  const def = x.c.buildings.list[t];
  if (def.species && !def.species.includes(x.c.species.list[st.species].id)) return false;
  const r = x.rt.buildingRecipe[t];
  return r >= 0 && st.library.includes(r);
}

/** materials of a building type in this people's preference order */
function materialOrder(x: PCtx, st: Settlement, t: number): number[] {
  const def = x.c.buildings.list[t];
  const mats = def.materials.map((m) => x.c.materials.idx(m)).filter((m) => m >= 0);
  const style = x.info[st.species].styleMats;
  // stable: styled materials first in the species' order, then the rest in the building's order
  return [...mats.filter((m) => style.includes(m)).sort((a, b) => style.indexOf(a) - style.indexOf(b)), ...mats.filter((m) => !style.includes(m))];
}

function materialKnown(x: PCtx, st: Settlement, m: number): boolean {
  const k = x.c.materials.list[m].knowledge;
  if (!k) return true;
  const r = x.rt.byId.get(k);
  return r !== undefined && st.library.includes(r);
}

/** units of material m the store can pay for right now */
function affordable(x: PCtx, st: Settlement, m: number): number {
  let n = Infinity;
  for (const io of x.c.materials.list[m].items) {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    if (it < 0) continue;
    n = Math.min(n, storeHas(st, it) / io.qty);
  }
  return n === Infinity ? 0 : Math.floor(n);
}

/**
 * How easily the settlement gets material m (0 = cannot): every item must be in store, gatherable around it (scored by
 * the best cell's availability), or made by a recipe it knows.
 */
function ease(x: PCtx, st: Settlement, m: number, cost: number): number {
  let e = 1;
  for (const io of x.c.materials.list[m].items) {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    if (it < 0) return 0;
    const need = io.qty * cost;
    const have = storeHas(st, it);
    if (have >= need) continue;
    let v = have / need;
    const cells = st.res?.items[String(it)];
    if (cells && cells.length) v = Math.max(v, 0.15 + availability(x, it, cells[0]));
    if ((x.rt.producers[it] ?? []).some((k) => st.library.includes(k))) v = Math.max(v, 0.35);
    e = Math.min(e, v);
  }
  return e;
}

/** choose a material for building type t (or -1 if the settlement knows none of them) */
export function chooseMaterial(x: PCtx, st: Settlement, t: number): number {
  const def = x.c.buildings.list[t];
  const order = materialOrder(x, st, t).filter((m) => materialKnown(x, st, m));
  if (!order.length) return -1;
  // what they have now, else what they can get (in preference order), else what they have most of
  for (const m of order) if (affordable(x, st, m) >= def.cost) return m;
  // the easiest to get, preference breaking near-ties
  let bestE = -1, pick = -1;
  order.forEach((m, rank) => {
    const e = ease(x, st, m, def.cost);
    if (e <= 0.05) return;
    const v = e - rank * 0.06;
    if (v > bestE) { bestE = v; pick = m; }
  });
  if (pick >= 0) return pick;
  let best = order[0], bv = -1;
  for (const m of order) {
    const v = affordable(x, st, m) / Math.max(1, def.cost);
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

/** the material a god-raised building is made of: what the builders would choose, else the first the building allows
 * (the god may build in a stone they cannot yet work) */
export function godMaterial(x: PCtx, st: Settlement, t: number): number {
  const m = chooseMaterial(x, st, t);
  if (m >= 0) return m;
  const order = materialOrder(x, st, t);
  return order.length ? order[0] : 0;
}

/**
 * Can the settlement still get what site b lacks? Every item of its material must be in store for the rest of the
 * work, or growing / lying within reach, or made by a recipe it knows.
 */
export function siteObtainable(x: PCtx, st: Settlement, b: Building): boolean {
  const def = x.c.buildings.list[b.type];
  const left = Math.max(0, def.cost - b.delivered);
  if (left <= 0) return true;
  for (const io of x.c.materials.list[b.material].items) {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    if (it < 0) return false;
    if (storeHas(st, it) >= io.qty * left) continue;
    if ((st.res?.items[String(it)]?.length ?? 0) > 0) continue;
    if ((x.rt.producers[it] ?? []).some((k) => st.library.includes(k))) continue;
    return false;
  }
  return true;
}

/**
 * A site whose material can no longer be had (the reeds it was begun in died off, the trees were cut) is begun again in
 * one that can — what was delivered goes back to the store — or, when nothing they know of can be had, given up. Sites
 * stalled this way used to block all building for years: the material was never chosen again, nobody fetched it, and
 * two open sites stopped any new one (a coastal village had a hearth and two bare hut frames for twelve years).
 * Returns true if the site still stands (revised or not).
 */
export function reviseSite(x: PCtx, st: Settlement, b: Building): boolean {
  if (b.progress >= 1) return true;
  // (fix r4 #12) a frame that burned or fell before it was finished is no longer a site: it held one of the two open
  // slots for ever (seed 20261008's Maaver: a ruined mudbrick house among its sites from year 37 to 50, 6 beds for 20-28)
  if (b.flags & BuildingFlag.ruined) {
    const k = st.sites.indexOf(b.id);
    if (k >= 0) st.sites.splice(k, 1);
    x.ps.version++;
    return false;
  }
  // (LIVING integration, 2026-10-20 — the default meteor on seed 1's town: its crater filled, the town's heart moved to
  // dry ground, and for a week nothing rose. One site stood 7 m under the new lake; the other, a house begun in mudbrick
  // that no one was making, waited with 30 bricks, 20 stone blocks and 27 timber in the store — 'obtainable' because
  // the recipe was known. A site under water is given up; a site nothing has reached yet takes a material the store can
  // pay for now)
  if (x.p.f.water[b.cell] > 0.6) {
    for (const [it, q] of materialItems(x, b.material)) storeAdd(x, st, it, q * b.delivered);
    removeBuilding(x, b);
    return false;
  }
  if (b.delivered === 0 && b.progress === 0) {
    const def = x.c.buildings.list[b.type];
    if (affordable(x, st, b.material) < def.cost) {
      const m = chooseMaterial(x, st, b.type);
      if (m >= 0 && m !== b.material && affordable(x, st, m) >= def.cost) { b.material = m; x.ps.version++; return true; }
    }
  }
  if (b.fed === undefined) b.fed = x.tick;
  else if (x.tick - b.fed > SITE_STALL_DAYS * x.day && stalled(x, st, b)) return false;
  if (siteObtainable(x, st, b)) return true;
  const prev = b.material, delivered = b.delivered;
  const m = chooseMaterial(x, st, b.type);
  if (m >= 0 && m !== prev) {
    b.material = m;
    b.delivered = 0;
    if (siteObtainable(x, st, b)) {
      for (const [it, q] of materialItems(x, prev)) storeAdd(x, st, it, q * delivered);
      b.progress = 0;
      x.ps.version++;
      return true;
    }
    b.material = prev;
    b.delivered = delivered;
  }
  // nothing they know of can be had: the site is given up (what was delivered goes back to the store)
  for (const [it, q] of materialItems(x, b.material)) storeAdd(x, st, it, q * b.delivered);
  removeBuilding(x, b);
  return false;
}

/** (fix r4 #12) days a site may go without material or work before it is begun again in what is at hand */
export const SITE_STALL_DAYS = 12;

/**
 * (fix r4 #12) A site that took no material and no work for SITE_STALL_DAYS while its material was 'obtainable' only by
 * a craft nobody practised (seed 1's Ukuneis: two mudbrick houses at nothing delivered for years, 12 beds for 24-28; seed
 * 20261008's Maaver: a mudbrick house at 4 of 10 from year 38 to 50) is begun again in a material the store can pay for
 * now, else one whose every item is in store or grows within reach (wattle, timber, thatch...) — what was delivered goes
 * back to the store — or, when there is none and nothing was delivered, given up so that a new site can be planned. When
 * the rest is in the store already the builders are only late, and a site with material in it and nothing else at hand
 * keeps it (giving it up only sent the same bricks to a new frame — Ukuneis, fix4/sites): the clock starts again.
 * Returns true when the site was given up.
 */
function stalled(x: PCtx, st: Settlement, b: Building): boolean {
  const def = x.c.buildings.list[b.type];
  if (affordable(x, st, b.material) >= def.cost - b.delivered) { b.fed = x.tick; return false; }
  const order = materialOrder(x, st, b.type).filter((m) => m !== b.material && materialKnown(x, st, m));
  const atHand = (m: number) => x.c.materials.list[m].items.every((io) => {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    return it >= 0 && (storeHas(st, it) >= io.qty * def.cost || (st.res?.items[String(it)]?.length ?? 0) > 0);
  });
  let pick = -1;
  for (const m of order) if (affordable(x, st, m) >= def.cost) { pick = m; break; }
  if (pick < 0) for (const m of order) if (atHand(m)) { pick = m; break; }
  if (pick < 0 && b.delivered > 0) { b.fed = x.tick; return false; }
  for (const [it, q] of materialItems(x, b.material)) storeAdd(x, st, it, q * b.delivered);
  if (pick < 0) { removeBuilding(x, b); return true; }
  b.material = pick;
  b.delivered = 0;
  b.progress = 0;
  b.fed = x.tick;
  x.ps.version++;
  return false;
}

/** item indices (and qty per unit) a material unit costs */
export function materialItems(x: PCtx, m: number): [number, number][] {
  return x.c.materials.list[m].items.map((io) => [io.item ? x.c.items.idx(io.item) : -1, io.qty] as [number, number]).filter(([i]) => i >= 0);
}

/** take up to `units` material units for building b from the store; returns units taken */
export function takeMaterial(x: PCtx, st: Settlement, b: Building, units: number): number {
  const items = materialItems(x, b.material);
  let n = units;
  for (const [it, q] of items) n = Math.min(n, Math.floor(storeHas(st, it) / q));
  if (n <= 0) return 0;
  for (const [it, q] of items) storeTake(st, it, n * q);
  return n;
}

const GOLDEN = 2.399963229728653;

/**
 * A site for a building of type t near the settlement centre: a spiral of candidate spots, the first on dry, gentle
 * land, off the fields, clear of other buildings. Docks look along the shore; mines on the ore; walls ring the village.
 */
export function findSite(x: PCtx, st: Settlement, t: number): { pos: [number, number, number]; cell: number; rot: number } | null {
  const p = x.p;
  const def = x.c.buildings.list[t];
  const R = p.st.radius;
  const mine = x.ps.of(st.id).filter((b) => !(b.flags & BuildingFlag.ruined));
  let centre: number[] = st.pos;
  const fn = def.function;
  if ((fn === 'dock' || fn === 'shipyard' || def.provides.includes('dock')) && st.res) {
    const c = st.res.fish[0] ?? st.res.water[0];
    if (c !== undefined) {
      const P = p.grid.pos;
      centre = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
      // the shore: the dry neighbour of that water nearest home, a little way out from its centre towards the water
      // (on a coarse grid a water cell is wider than the spiral; the dock stands at the edge, not in the middle)
      let best = -1, bd = Infinity;
      for (let e = p.grid.nbrStart[c]; e < p.grid.nbrStart[c + 1]; e++) {
        const o = p.grid.nbr[e];
        if (!isLand(p, o) || p.f.water[o] > 0.15) continue;
        const d = distM(p, st.pos, [P[o * 3], P[o * 3 + 1], P[o * 3 + 2]]);
        if (d < bd) { bd = d; best = o; }
      }
      if (best >= 0) {
        const vx = P[best * 3] * 0.7 + P[c * 3] * 0.3, vy = P[best * 3 + 1] * 0.7 + P[c * 3 + 1] * 0.3, vz = P[best * 3 + 2] * 0.7 + P[c * 3 + 2] * 0.3;
        const l = Math.hypot(vx, vy, vz) || 1;
        centre = [vx / l, vy / l, vz / l];
      }
    }
  }
  if (fn === 'mine' && st.res) {
    for (const key of Object.keys(st.res.items)) {
      const it = x.c.items.list[Number(key)];
      if (it && it.tags.includes('ore') && st.res.items[key].length) {
        const c = st.res.items[key][0];
        centre = [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];
        break;
      }
    }
  }
  const wall = fn === 'wall';
  // (SIM phase 4) a launchpad, a star gate or an airship mast stands out past the houses: in a crowded town the inner
  // spiral never found room for a 20 m pad
  const outskirts = fn === 'launchpad' || fn === 'gate' || fn === 'airfield';
  let coreR = 10;
  for (const b of mine) coreR = Math.max(coreR, distM(p, st.pos, b.pos) + x.c.buildings.list[b.type].footprint);
  const out: number[] = [0, 0, 0];
  const n0 = mine.length;
  for (let k = 0; k < 90; k++) {
    let r: number, a: number;
    const jitter = hashFloat(st.id, t, k, 0x517e);
    if (wall) {
      const seg = mine.filter((b) => b.type === t).length + k;
      a = seg * (Math.PI * 2 / 14) + st.id;
      r = coreR + 6 + def.footprint;
    } else if (outskirts) {
      a = k * GOLDEN + st.id * 0.53 + jitter;
      r = coreR + def.footprint + 12 + 6 * Math.sqrt(k);
    } else if (centre !== st.pos) {
      a = k * GOLDEN + jitter;
      r = 4 + def.footprint + 3 * Math.sqrt(k);
    } else {
      const i = n0 + k;
      a = i * GOLDEN + st.id * 0.37 + jitter * 0.6;
      r = 3 + def.footprint * 0.5 + 4.2 * Math.sqrt(i + 1) + (fn === 'pen' ? 20 : 0) + jitter * 2;
    }
    offsetPoint(centre, r, a, R, out);
    const cell = p.cellAt(out);
    if (!isLand(p, cell) || p.f.water[cell] > 0.15) continue;
    if (p.f.lava[cell] > 0 || p.f.fire[cell] > 0.1) continue;
    if (fn !== 'mine' && (p.f.crop[cell] > 0.05 || st.fields.includes(cell))) continue;
    // slope at the cell
    let steep = 0;
    const g = p.grid;
    for (let e = g.nbrStart[cell]; e < g.nbrStart[cell + 1]; e++) steep = Math.max(steep, Math.abs(p.f.surface[g.nbr[e]] - p.f.surface[cell]));
    if (steep / p.edgeM > 0.55) continue;
    let clear = true;
    for (const b of x.ps.buildings) {
      if (Math.abs(b.pos[0] - out[0]) + Math.abs(b.pos[1] - out[1]) + Math.abs(b.pos[2] - out[2]) > 0.05) continue;
      const need = x.c.buildings.list[b.type].footprint + def.footprint + 1.5;
      if (distM(p, b.pos, out) < need) { clear = false; break; }
    }
    if (!clear) continue;
    return { pos: [out[0], out[1], out[2]], cell, rot: facing(out, st.pos) };
  }
  // (LIVING LAND §2.5: the spiral's 90 places start at the n-th for a town of n buildings — when the places it skipped
  // (water, fields) have pushed its buildings out ahead of it, every one of them is taken: a town of 76 buildings found
  // room for no house in years (_harness/scratch/living/land/live/whynosite.ts). Then the edge of the town: the free dry
  // cells around it, ring by ring, a few spots in each.)
  if (wall || outskirts || fn === 'mine' || centre !== st.pos) return null;
  return edgeSite(x, st, t);
}

/** a place for building type t at the edge of st: the dry, free, unfarmed cells around its centre, nearest ring first
 * (cells in index order), six spots in each; null if none within four rings */
function edgeSite(x: PCtx, st: Settlement, t: number): { pos: [number, number, number]; cell: number; rot: number } | null {
  const p = x.p, g = p.grid;
  const def = x.c.buildings.list[t];
  const seen = new Set<number>([st.cell]);
  let ring = [st.cell];
  const out: number[] = [0, 0, 0];
  for (let d = 0; d <= 4; d++) {
    for (const cell of ring) {
      if (!isLand(p, cell) || p.f.water[cell] > 0.15 || p.f.lava[cell] > 0 || p.f.fire[cell] > 0.1) continue;
      if (p.f.crop[cell] > 0.05 || st.fields.includes(cell)) continue;
      let steep = 0;
      for (let e = g.nbrStart[cell]; e < g.nbrStart[cell + 1]; e++) steep = Math.max(steep, Math.abs(p.f.surface[g.nbr[e]] - p.f.surface[cell]));
      if (steep / p.edgeM > 0.55) continue;
      for (let k = 0; k < 6; k++) {
        spotInCell(p, cell, st.id * 64 + t, 0x5e1 + k, out);
        if (p.cellAt(out) !== cell) continue;
        let clear = true;
        for (const b of x.ps.buildings) {
          if (Math.abs(b.pos[0] - out[0]) + Math.abs(b.pos[1] - out[1]) + Math.abs(b.pos[2] - out[2]) > 0.05) continue;
          if (distM(p, b.pos, out) < x.c.buildings.list[b.type].footprint + def.footprint + 1.5) { clear = false; break; }
        }
        if (clear) return { pos: [out[0], out[1], out[2]], cell, rot: facing(out, st.pos) };
      }
    }
    const next: number[] = [];
    for (const c of ring) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); next.push(o); } }
    next.sort((a, b) => a - b);
    ring = next;
  }
  return null;
}

/** yaw (0 = north, + toward east) of a building at pos facing point `to` */
function facing(pos: ArrayLike<number>, to: ArrayLike<number>): number {
  let ex = pos[2], ez = -pos[0];
  let el = Math.hypot(ex, ez);
  if (el < 1e-9) { ex = 1; ez = 0; el = 1; }
  ex /= el; ez /= el;
  const nx = pos[1] * ez, ny = pos[2] * ex - pos[0] * ez, nz = -pos[1] * ex;
  const dx = to[0] - pos[0], dy = to[1] - pos[1], dz = to[2] - pos[2];
  const de = dx * ex + dz * ez, dn = dx * nx + dy * ny + dz * nz;
  if (Math.abs(de) + Math.abs(dn) < 1e-12) return 0;
  return Math.atan2(de, dn);
}

/** culture style variant 0..7 */
export function styleOf(st: Settlement): number {
  return ((st.langSeed >>> 5) & 3) + (st.culture.alignment < -0.25 ? 4 : 0);
}

/** place a construction site; returns the building (progress 0) or null */
export function planBuilding(x: PCtx, st: Settlement, t: number, complete = false, matOverride = -1): Building | null {
  const mat = matOverride >= 0 ? matOverride : chooseMaterial(x, st, t);
  if (mat < 0) return null;
  const site = findSite(x, st, t);
  if (!site) return null;
  const def = x.c.buildings.list[t];
  // a ruin where the new building goes is cleared first (the builders take it down; it no longer stands under the new
  // house as a heap drawn through its floor)
  const g = x.p.grid;
  const gone: Building[] = [];
  for (const c of [site.cell, ...Array.from(g.nbr.subarray(g.nbrStart[site.cell], g.nbrStart[site.cell + 1]))]) {
    for (const bid of x.ps.bByCell.get(c)) {
      const o = x.ps.building(bid);
      if (!o || !(o.flags & BuildingFlag.ruined) || gone.includes(o)) continue;
      if (distM(x.p, site.pos, o.pos) < x.c.buildings.list[o.type].footprint * 0.7 + def.footprint * 0.7) gone.push(o);
    }
  }
  for (const o of gone) removeBuilding(x, o);
  const id = x.u.ids.alloc('building');
  const b: Building = {
    id, type: t, material: mat, style: styleOf(st), pos: site.pos, cell: site.cell, rot: Math.round(site.rot * 1000) / 1000,
    scale: Math.round((0.92 + 0.16 * hashFloat(id, 0x5ca1)) * 1000) / 1000,
    progress: complete ? 1 : 0, delivered: complete ? def.cost : 0, damage: 0, settlement: st.id,
    flags: 0, books: [], built: complete ? x.tick : -1, fuel: 0, occupants: 0, household: -1,
  };
  if (!complete) b.fed = x.tick;
  x.ps.addBuilding(b);
  if (!complete) st.sites.push(id);
  else onComplete(x, st, b, true);
  return b;
}

/** labour on a site: progress limited by delivered materials */
export function workOn(x: PCtx, st: Settlement, b: Building, ticks: number, skill: number): boolean {
  const def = x.c.buildings.list[b.type];
  const cap = def.cost > 0 ? b.delivered / def.cost : 1;
  if (b.progress >= cap) return false;
  b.progress = Math.min(cap, Math.round((b.progress + (ticks / def.work) * (0.55 + 0.9 * skill)) * 10000) / 10000);
  if (b.progress >= 1) { b.progress = 1; onComplete(x, st, b, false); }
  x.ps.version++;
  return true;
}

function onComplete(x: PCtx, st: Settlement, b: Building, silent: boolean): void {
  b.built = x.tick;
  const i = st.sites.indexOf(b.id);
  if (i >= 0) st.sites.splice(i, 1);
  const def = x.c.buildings.list[b.type];
  if (def.function === 'hearth' || def.provides.includes('hearth')) {
    // a new hearth catches only from a flame at hand (a scenario's established village is lit)
    b.fuel = Math.max(b.fuel, silent ? 600 : lightNewHearth(x, st, 600));
    if (b.fuel > 0) b.flags |= BuildingFlag.lit;
  }
  if (!silent && st.firsts[def.id] === undefined) {
    st.firsts[def.id] = x.tick;
    // the first of a kind for this settlement; chronicle only the notable ones
    // a port is born of its boats: the first dock of a shore boats keep leaving from gets its own line
    if (def.function === 'dock' && (st.boatUse ?? 0) >= 2) tell(x.u, x.p, 'port', vars(x, st, -1, {}), st, [{ kind: 'building', id: b.id, planet: x.p.id }, settlementRef(x, st)], 1);
    else if (def.cost >= 8 || def.function !== 'shelter') tell(x.u, x.p, 'first.building', vars(x, st, -1, { building: def.name.toLowerCase() }), st, [{ kind: 'building', id: b.id, planet: x.p.id }, settlementRef(x, st)], 0);
  }
  emitSt(x, st, { t: 'built', a: b.type, text: def.name, ref: { kind: 'building', id: b.id, planet: x.p.id }, data: { settlement: st.id, building: def.id } });
  x.ps.version++;
}

/** remove a building entirely (rubble cleared) */
export function removeBuilding(x: PCtx, b: Building): void {
  const i = x.ps.bIndex.get(b.id);
  if (i === undefined) return;
  x.ps.buildings.splice(i, 1);
  x.ps.reindexBuildings();
  for (const st of x.ps.settlements) {
    const k = st.sites.indexOf(b.id);
    if (k >= 0) st.sites.splice(k, 1);
  }
  x.ps.version++;
}

/** daily wear: weather and time; damage beyond repair leaves a ruin */
export function decayBuildings(x: PCtx, st: Settlement): void {
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
    const def = x.c.buildings.list[b.type];
    const mat = x.c.materials.list[b.material];
    b.damage = Math.min(1, Math.round((b.damage + def.decay / Math.max(0.3, mat?.strength ?? 1)) * 10000) / 10000);
    if (b.damage >= 1) ruin(x, st, b, 'decay');
    // hearths burn down without tending
  }
}

/** a building becomes a ruin (fire, decay, a quake...) */
export function ruin(x: PCtx, st: Settlement | undefined, b: Building, why: string): void {
  if (b.flags & BuildingFlag.ruined) return;
  b.flags |= BuildingFlag.ruined;
  b.flags &= ~(BuildingFlag.burning | BuildingFlag.occupied | BuildingFlag.working | BuildingFlag.lit);
  b.damage = 1;
  b.fuel = 0;
  // (fix r4 #12) an unfinished frame that is ruined is no longer one of the town's open sites
  if (b.progress < 1) for (const o of x.ps.settlements) { const k = o.sites.indexOf(b.id); if (k >= 0) o.sites.splice(k, 1); }
  const lost = b.books.slice();
  b.books = [];
  x.ps.version++;
  x.u.emit({ t: 'collapsed', planet: x.p.id, pos: [b.pos[0], b.pos[1], b.pos[2]], a: b.type, text: why, ref: { kind: 'building', id: b.id, planet: x.p.id } });
  if (st && lost.length) {
    // the books are gone: unless someone alive still knows it (or other books hold it), it is lost
    recomputeWritten(x, st);
    for (const k of lost) if (!st.written.includes(k)) checkLoss(x, st, k, -1, why === 'fire' ? 'burned' : 'death');
  }
}

// ───────────────────────────── fire ─────────────────────────────

/** fire.ts fuel hook: buildings are fuel for the cell they stand in */
export function buildingFuel(p: Planet, c: number): number {
  const ps = p.people;
  if (!ps) return 0;
  const ids = ps.bByCell.get(c);
  if (!ids.length) return 0;
  let fuel = 0;
  const content = ps.contentRef;
  if (!content) return 0;
  for (let i = 0; i < ids.length; i++) {
    const b = ps.building(ids[i]);
    if (!b || b.flags & BuildingFlag.ruined) continue;
    const mat = content.materials.list[b.material];
    const def = content.buildings.list[b.type];
    fuel += (mat?.flammability ?? 0.5) * (def.footprint / 5) * 0.5 * (1 - b.damage) * Math.max(0.2, b.progress);
  }
  return fuel;
}

/** every fire cadence: buildings in burning cells take damage and may fall; returns buildings ruined */
export function burnBuildings(x: PCtx): number {
  const f = x.p.f;
  let ruined = 0;
  const bySt = new Map<number, number>();
  for (const b of x.ps.buildings) {
    if (b.flags & BuildingFlag.ruined) continue;
    const fi = f.fire[b.cell];
    if (fi <= 0.04) {
      if (b.flags & BuildingFlag.burning) { b.flags &= ~BuildingFlag.burning; x.ps.version++; }
      continue;
    }
    const mat = x.c.materials.list[b.material];
    const flam = mat?.flammability ?? 0.5;
    if (flam <= 0.01) continue;
    if (!(b.flags & BuildingFlag.burning)) { b.flags |= BuildingFlag.burning; x.ps.version++; }
    b.damage = Math.min(1, Math.round((b.damage + fi * flam * 0.05) * 10000) / 10000);
    if (b.damage >= 1) {
      const st = x.ps.settlement(b.settlement);
      ruin(x, st, b, 'fire');
      ruined++;
      bySt.set(b.settlement, (bySt.get(b.settlement) ?? 0) + 1);
    }
  }
  for (const [sid, n] of [...bySt.entries()].sort((a, b) => a[0] - b[0])) {
    const st = x.ps.settlement(sid);
    if (!st || st.fallen >= 0) continue;
    st.recent.burned = x.tick;
    st.recent.burnedCount = (st.recent.burnedCount ?? 0) + n;
  }
  return ruined;
}

/** an untended hearth in a thatched village sometimes sets it alight (rare; a story and maybe a taboo follow) */
export function hearthAccidents(x: PCtx, st: Settlement): void {
  for (const b of x.ps.of(st.id)) {
    if (b.fuel <= 0 || b.progress < 1) continue;
    const def = x.c.buildings.list[b.type];
    if (def.function !== 'hearth') continue;
    if (hashFloat(b.id, x.tick, 0x4ea7) < 0.0015 && x.p.f.water[b.cell] < 0.02) {
      igniteCell(x.u, x.p, b.cell, 0.45, 'hearth');
    }
  }
}

/** night light of a building: kind (1 hearth, 2 oil, 3 gas, 4 electric) and level, packed for BuildingBlock.light */
export function lightOf(x: PCtx, st: Settlement | undefined, b: Building): number {
  if (b.progress < 1 || b.flags & BuildingFlag.ruined || !st || st.fallen >= 0) return 0;
  const def = x.c.buildings.list[b.type];
  let level = def.light;
  if (level <= 0) return 0;
  let kind = 1;
  const has = (id: string) => { const k = x.rt.byId.get(id); return k !== undefined && st.library.includes(k); };
  if (has('electricity')) kind = 4;
  else if (has('kerosene-lamps')) kind = 3;
  else if (has('pottery') && st.era >= 3) kind = 2;
  if (def.function === 'hearth') { kind = 1; if (b.fuel <= 0) level = 0; }
  // hearth-age dwellings glow only from a fire somebody keeps: a people without fire huddles in the dark (§16.1)
  else if (kind === 1) level *= st.nightLight > 0 ? 0.6 : 0;
  return kind * 256 + Math.round(Math.min(1, level) * 255);
}

/** deterministic per-building salt (render variety) */
export function buildingSeed(b: Building): number {
  return hash32(b.id, b.type, 0xb17d);
}
