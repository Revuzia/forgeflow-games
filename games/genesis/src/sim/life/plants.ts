// GENESIS — plant disease (CONTRACT.md §10 "Blight spreads in crops/forests (moisture + monoculture)"): the `blight`
// field 0..1 on the cells where it is active. Blight breaks out where one crop or one kind of tree covers the land
// wall to wall and the ground is wet; it grows with damp and warmth, withers its host (fields fail within days, forests
// thin over weeks) and jumps to neighbouring cells of the same host species. Crop rotation (recipe effect 'blight')
// keeps fields healthier. vegetation.ts lets the field fade by itself where nothing feeds it.
//
//   hourly  active cells: grow, damage the host, spread (the active list is saved, ascending)
//   daily   outbreaks: settlements' monoculture fields, and a sample of dense single-species forests

import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { tell } from '../people/story.ts';
import { accident, libraryEffect } from '../people/knowledge.ts';
import { settlementRef, vars } from '../people/util.ts';

/** blight multiplier from what a settlement knows (crop rotation, ...) */
function rotation(x: PCtx, st: Settlement | undefined): number {
  if (!st) return 1;
  return libraryEffect(x, st, 'blight');
}

/** the host of a cell: 3 = crop, 2 = tree, -1 none; and its species */
function host(x: PCtx, c: number): { type: number; sp: number; cover: number } {
  const f = x.p.f;
  if (f.crop[c] > 0.03 && f.cropSpecies[c] >= 0) return { type: 3, sp: f.cropSpecies[c], cover: f.crop[c] };
  if (f.tree[c] > 0.2 && f.treeSpecies[c] >= 0) return { type: 2, sp: f.treeSpecies[c], cover: f.tree[c] };
  return { type: -1, sp: -1, cover: 0 };
}

/** cells with active blight at most (a blight that big has made its point) */
const MAX_ACTIVE = 500;

function warmth(t: number): number {
  return t < 2 ? 0 : t < 12 ? (t - 2) / 10 : t < 30 ? 1 : Math.max(0, 1 - (t - 30) / 10);
}

function addActive(x: PCtx, c: number): void {
  const l = x.ps.blight;
  let lo = 0, hi = l.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < c) lo = m + 1; else hi = m; }
  if (l[lo] !== c) l.splice(lo, 0, c);
}

/** hourly: active blight grows with damp and warmth, withers its host, spreads to the same host next door */
export function blightStep(x: PCtx): void {
  const l = x.ps.blight;
  if (!l.length) return;
  const f = x.p.f, g = x.p.grid;
  const B = f.blight;
  let touched = false;
  const spread: number[] = [];
  const keep: number[] = [];
  for (const c of l) {
    const hst = host(x, c);
    const st = f.territory[c] >= 0 ? x.ps.settlement(f.territory[c]) : undefined;
    if (hst.type < 0) {
      B[c] = Math.max(0, B[c] - 0.05);
    } else {
      const moist = Math.min(1, f.moisture[c] + (f.precip[c] > 0.5 ? 0.3 : 0));
      // fields are soft; a forest fights back (it only loses ground where it is wet and warm, and recovers elsewhere)
      const grow = 0.045 * moist * warmth(f.temperature[c]) * Math.min(1, hst.cover * 1.5) * rotation(x, st) - (hst.type === 2 ? 0.022 : 0);
      B[c] = Math.max(0, Math.min(1, B[c] + grow));
      // the host withers
      if (hst.type === 3) f.crop[c] = Math.max(0, f.crop[c] - B[c] * 0.035);
      else f.tree[c] = Math.max(0, f.tree[c] - B[c] * 0.003);
      touched = true;
      // spores on the wind and the rain: the same species next door
      if (B[c] > 0.15 && l.length < MAX_ACTIVE) {
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
          const o = g.nbr[e];
          if (B[o] >= 0.08) continue;
          const ho = host(x, o);
          if (ho.type < 0 || (ho.type === 2 && x.p.f.tree[o] < 0.5)) continue;
          const same = ho.type === hst.type && ho.sp === hst.sp ? 1 : 0.15;
          const k = hst.type === 3 ? 0.12 : 0.05;
          if (hashFloat(c, o, x.tick, 0xb119) < B[c] * k * same * Math.min(1, f.moisture[o] * 1.5)) spread.push(o);
        }
      }
    }
    if (B[c] > 0.01) keep.push(c); else B[c] = 0;
  }
  x.ps.blight = keep;
  for (const o of spread) { if (B[o] < 0.08) B[o] = 0.08; addActive(x, o); }
  if (touched || spread.length) { x.p.bump('blight'); x.p.bump('crop'); }
}

/** start blight at cell c */
export function blightAt(x: PCtx, c: number, level = 0.15): void {
  const B = x.p.f.blight;
  B[c] = Math.max(B[c], level);
  addActive(x, c);
  x.p.bump('blight');
}

/** daily: outbreaks in monoculture fields and dense single-species forests */
export function blightDaily(x: PCtx): void {
  const f = x.p.f, g = x.p.grid;
  // fields: one crop wall to wall, wet ground
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || st.band || st.fields.length < 3) continue;
    let same = 0, moist = 0, sick = 0;
    for (const c of st.fields) {
      if (f.cropSpecies[c] === st.crop) same++;
      moist += f.moisture[c];
      if (f.blight[c] > 0.05) sick++;
    }
    if (sick) continue;
    const mono = (same / st.fields.length) * Math.min(1, st.fields.length / 8);
    const wet = moist / st.fields.length;
    const p = 0.03 * mono * Math.max(0, wet - 0.25) * 2 * rotation(x, st);
    if (hashFloat(st.id, x.tick, 0xb11a) >= p) continue;
    const c = st.fields[hash32(st.id, x.tick, 0xb11b) % st.fields.length];
    blightAt(x, c, 0.2);
    const crop = x.c.plants.list[st.crop]?.name.toLowerCase() ?? 'crops';
    tell(x.u, x.p, 'blight', vars(x, st, -1, { crop }), st, [settlementRef(x, st)]);
    x.u.emit({ t: 'blight', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { crop } });
    accident(x, st, 'blight', c);
  }
  // forests: a sample of cells; a stand of one tree species on wet ground may sicken
  const N = x.p.count;
  for (let k = 0; k < 48; k++) {
    const c = hash32(x.tick, x.p.seed, k, 0xb11c) % N;
    if (f.tree[c] < 0.6 || f.moisture[c] < 0.55 || f.blight[c] > 0) continue;
    const sp = f.treeSpecies[c];
    let mono = 0, deg = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { deg++; const o = g.nbr[e]; if (f.treeSpecies[o] === sp && f.tree[o] > 0.5) mono++; }
    if (mono < deg - 1) continue;
    if (hashFloat(c, x.tick, 0xb11d) < 0.02 && x.ps.blight.length < MAX_ACTIVE) blightAt(x, c, 0.12);
  }
}

/** share of a settlement's fields that are blighted (famine warnings, inspector) */
export function blightedShare(x: PCtx, st: Settlement): number {
  if (!st.fields.length) return 0;
  let n = 0;
  for (const c of st.fields) if (x.p.f.blight[c] > 0.1) n++;
  return n / st.fields.length;
}
