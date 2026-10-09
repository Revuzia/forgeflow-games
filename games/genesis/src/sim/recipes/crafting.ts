// GENESIS — crafting (CONTRACT.md §8.4, §9): running a recipe in its place context. The crafter has walked to the
// workplace the settlement's job list named (a hearth, a kiln, a furnace, a shipyard, the shore...); at the end of the
// work the inputs come out of the store, fuel is burned for hot work, a novice may waste the batch, masters make more,
// the output goes into the store, the skill grows, onlookers may learn by watching, and a written product (tablets,
// books) records a piece of the settlement's knowledge in a library.

import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import { hashFloat } from '../core/rng.ts';
import { NS } from '../people/defs.ts';
import { storeAdd, storeAny, storeTake, storeTakeAny } from '../people/store.ts';
import { fuelItems } from '../people/context.ts';
import { observe } from '../people/knowledge.ts';
import { practise } from '../people/lifecycle.ts';
import { BuildingFlag } from '../types.ts';

export interface CraftResult {
  ok: boolean;
  made: number;
  why?: string;
}

/** burn fuel for a hot recipe; false if the store has none */
export function burnFuel(x: PCtx, st: Settlement, units: number): boolean {
  let left = units;
  for (const it of fuelItems(x)) {
    if (left <= 0) break;
    const val = x.c.items.list[it].fuel ?? 1;
    const need = Math.ceil(left / val);
    const got = storeTake(st, it, need);
    left -= got * val;
  }
  return left <= 0.0001;
}

/** run recipe k by agent s for settlement st at `cell` */
export function craft(x: PCtx, s: number, st: Settlement, k: number, cell: number): CraftResult {
  const A = x.A;
  const r = x.rt.list[k];
  if (!r || !A.knows(s, k)) return { ok: false, made: 0, why: 'unknown' };
  for (const io of r.inputs) if (storeAny(st, io.items) < io.qty) return { ok: false, made: 0, why: 'inputs' };
  for (const tl of r.tools) if (!(A.tool[s] >= 0 && tl.includes(A.tool[s])) && storeAny(st, tl) < 1) return { ok: false, made: 0, why: 'tools' };
  if (r.hot && r.heat >= 300) {
    // fuel for the fire: more for long, hot work
    const units = Math.max(1, Math.round((r.time / 200) * (r.heat / 900)));
    if (!burnFuel(x, st, units)) return { ok: false, made: 0, why: 'fuel' };
  }
  for (const io of r.inputs) storeTakeAny(st, io.items, io.qty);
  const skill = A.skills[s * NS + r.skill];
  practise(x, s, r.skill, 0.03 + r.difficulty * 0.03);
  // a novice can spoil the batch
  if (hashFloat(A.id[s], k, x.tick, 0xc4a5) < r.difficulty * (1 - skill) * 0.55) {
    observe(x, s, k, cell);
    return { ok: false, made: 0, why: 'spoiled' };
  }
  // masters make more
  const mastery = skill > 0.7 ? 1 + ((skill - 0.7) / 0.3) * 0.5 : 1;
  let made = 0;
  for (const [it, q] of r.outItems) {
    let n = q * mastery;
    const whole = Math.floor(n);
    n = whole + (hashFloat(A.id[s], it, x.tick, 0xc4a6) < n - whole ? 1 : 0);
    storeAdd(x, st, it, n);
    made += n;
  }
  if (r.writes) writeBook(x, st, s);
  observe(x, s, k, cell);
  return { ok: true, made };
}

/**
 * Record one piece of the settlement's knowledge in writing: the least-known unwritten recipe (by how few members know
 * it, then difficulty) goes into the library (else any standing building).
 */
export function writeBook(x: PCtx, st: Settlement, s: number): number {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  let best = -1, bv = -1;
  for (const k of st.library) {
    if (st.written.includes(k)) continue;
    if (!A.knows(s, k)) continue; // a scribe writes what they know
    let knowers = 0;
    for (const m of members) if (A.knows(m, k)) knowers++;
    const v = (1 / (1 + knowers)) * 2 + x.rt.list[k].teach;
    if (v > bv) { bv = v; best = k; }
  }
  if (best < 0) return -1;
  let lib = x.ps.of(st.id).find((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].function === 'library');
  if (!lib) lib = x.ps.of(st.id).find((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].provides.includes('shelter'));
  if (!lib) return -1;
  if (!lib.books.includes(best)) {
    lib.books.push(best);
    lib.books.sort((a, b) => a - b);
  }
  if (!st.written.includes(best)) { st.written.push(best); st.written.sort((a, b) => a - b); }
  x.ps.version++;
  return best;
}
