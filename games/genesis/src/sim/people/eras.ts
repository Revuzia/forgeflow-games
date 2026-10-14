// GENESIS — LIVING HISTORY (LIVING.md §5.2): eras that read right, and their pace.
//
//   label   the era INDEX stays as it is (knowledge.ts computeEra, saved); a settlement's era LABEL comes from what it
//           can really do: "stone age", "fire-keepers", "first farmers" (agriculture without pottery or metal),
//           "potters", "copper age" (copper smelting), "bronze age" (bronze), "iron age" (iron smelting), then the
//           classical age, the middle ages, the age of gunpowder, of steam, the electric and the space age by index.
//           A town never reads "bronze age" without copper or bronze smelting, nor "stone age" with farming or pottery.
//   pace    a people works out the ideas of the next era only after DWELL years in its present one (the era clock: the
//           tick each era index was first reached, kept per settlement and handed down to daughter towns), and builds
//           on an idea only once it has PRACTISED it: known for PRACTICE years of its era or made PRACTICE_USES times
//           (the LAND ledger's crafts). Both gate invention — experiments, and accidents of everyday life (a fire on
//           clay, spilled seed, green stones in the fire); wonders (star iron fallen from the sky, a miracle, a comet,
//           an eclipse, lightning in the dunes) and everything learned from others (teaching, watching, talk, trade,
//           books, the god) are not gated: diffusion and the god's gifts are how a people outruns its own pace.
//           Calibrated on the census (8 seeds × 50 game years, `_harness/scratch/living/history/census.ts`) against the
//           §1.5 timeline: fire 1–6, agriculture 3–12, pottery 6–18, copper 20–40, bronze 30–55, writing 35–65, iron
//           50–85 ... first orbit 170–230.
//   advance `settlement.advance` (and `settlement.teach { era }`): the god force-teaches a town everything up to and
//           including the next era (its groundwork first), unwilling or not.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { CRecipe } from '../recipes/recipes.ts';
import { ERAS } from '../content.ts';
import { capitalOf, histOf, type HistState } from './politics.ts';
import { tell } from './story.ts';
import { settlementRef, vars } from './util.ts';

/** years a settlement must have held era e before the ideas of era e + 1 become its own to find (index = e) */
export const DWELL = [0, 2, 14, 22, 10, 18, 14, 24, 12, 12, 0];
/** years an idea of era e must be known before it can be built on — or PRACTICE_USES crafts of it */
export const PRACTICE = [0, 0.5, 1, 3, 3, 3, 3, 2, 2, 1.5, 1.5];
export const PRACTICE_USES = 24;
/** triggers that are wonders, not everyday life: they open an idea whatever the era clock says */
export const WONDERS = new Set(['meteor-iron', 'miracle', 'miracle-heal', 'miracle-forest', 'fireball', 'comet', 'eclipse', 'lightning-dune', 'flare']);

/** the tick a settlement reached its present era index (made now if it was never written) */
export function eraSince(x: PCtx, st: Settlement, h: HistState = histOf(x, st)): number {
  const key = String(st.era);
  let t = h.eraAt[key];
  if (t === undefined) { t = x.tick; h.eraAt[key] = t; }
  return t;
}

/** an idea the settlement knows has been practised enough to build on */
export function practised(x: PCtx, st: Settlement, k: number, h: HistState = histOf(x, st)): boolean {
  const r = x.rt.list[k];
  if (!r) return true;
  const since = h.since[r.id];
  if (since === undefined || since < 0) return true;
  if (x.tick - since >= PRACTICE[Math.min(PRACTICE.length - 1, r.era)] * x.year) return true;
  // made often enough (the LAND ledger keeps the crafts of the last 40 years)
  let n = 0;
  for (const row of st.land?.ledger ?? []) { n += row.crafts[r.id] ?? 0; if (n >= PRACTICE_USES) return true; }
  return false;
}

/**
 * May this settlement work out recipe r on its own (an experiment, or an accident with this trigger)? The era clock and
 * practice above; a wonder opens the next era's ideas at once (never beyond it).
 */
export function inventable(x: PCtx, st: Settlement, r: CRecipe, trigger?: string): boolean {
  const h = histOf(x, st);
  const cur = st.era;
  if (r.era > cur) {
    if (trigger !== undefined && WONDERS.has(trigger)) { if (r.era > cur + 1) return false; }
    else {
      // the years in the present era must cover the dwell of every era between (a people stuck in an era it cannot
      // complete still moves on, slowly)
      let need = 0;
      for (let e = cur; e < r.era; e++) need += DWELL[Math.min(DWELL.length - 1, e)];
      if (x.tick - eraSince(x, st, h) < need * x.year) return false;
    }
  }
  if (trigger !== undefined && WONDERS.has(trigger)) return true;
  for (const q of r.preList) if (!practised(x, st, q, h)) return false;
  return true;
}

/** a settlement learned recipe k just now (knowledge.ts learn): its practice clock starts */
export function noteLearned(x: PCtx, st: Settlement, k: number): void {
  const h = histOf(x, st);
  const id = x.rt.list[k]?.id;
  if (id) h.since[id] = x.tick;
  eraSince(x, st, h);
}

// ───────────────────────────── labels ─────────────────────────────

const LATE: Record<number, string> = { 5: 'classical age', 6: 'middle ages', 7: 'age of gunpowder', 8: 'age of steam', 9: 'electric age', 10: 'space age' };

/** the era label of a settlement from what it can do */
export function eraLabel(x: PCtx, st: Settlement): string {
  const has = (id: string) => { const k = x.rt.byId.get(id); return k !== undefined && st.library.includes(k); };
  const metal = has('iron-smelting') ? 'iron age' : has('bronze') ? 'bronze age' : has('copper-smelting') ? 'copper age' : '';
  if (st.era >= 5 && LATE[Math.min(10, st.era)] && metal) return LATE[Math.min(10, st.era)];
  if (metal) return metal;
  if (has('pottery')) return 'potters';
  if (has('agriculture')) return 'first farmers';
  if (has('fire-keeping')) return 'fire-keepers';
  return 'stone age';
}

/** daily (politics.ts historyDaily): the era clock and the label; a new label is told once */
export function syncEra(x: PCtx, st: Settlement, h: HistState): void {
  eraSince(x, st, h);
  const label = eraLabel(x, st);
  if (label === h.label) return;
  const first = h.label === '';
  h.label = label;
  // (the first label is where a town starts; later ones are its history — each told once a settlement)
  const key = `label:${label}`;
  if (first || st.firsts[key] !== undefined) { st.firsts[key] ??= x.tick; return; }
  st.firsts[key] = x.tick;
  tell(x.u, x.p, 'era.label', vars(x, st, -1, { label }), st, [settlementRef(x, st)], 2);
}

/** for views: the label, made if this settlement has none yet (a read: never changes the era clock's record) */
export function labelOf(x: PCtx, st: Settlement): string {
  return st.hist?.label || eraLabel(x, st);
}

/** the settlement view's history fields (snapshot.ts): its era label; a daughter's grievance against its capital */
export function historyView(x: PCtx, st: Settlement): { eraLabel?: string; grievance?: number } {
  if (st.band) return {};
  const out: { eraLabel?: string; grievance?: number } = { eraLabel: labelOf(x, st) };
  if (st.fallen < 0 && st.hist && capitalOf(x, st)) out.grievance = st.hist.grievance;
  return out;
}

/** inspector / query: the era clock of a settlement — when it reached its era, and when the next era's ideas open to it */
export function eraClock(x: PCtx, st: Settlement): { era: string; label: string; since: number; nextOpens: number | null } {
  const since = st.hist?.eraAt[String(st.era)] ?? st.founded;
  const dwell = DWELL[Math.min(DWELL.length - 1, st.era)];
  return { era: ERAS[st.era], label: labelOf(x, st), since, nextOpens: st.era >= ERAS.length - 1 ? null : since + Math.round(dwell * x.year) };
}

/** the recipes the god teaches to advance a town to era `target` (all it may learn up to it, ascending) */
export function advanceList(x: PCtx, st: Settlement, target: number): number[] {
  const out: number[] = [];
  for (const r of x.rt.list) {
    if (r.era > target || r.base <= 0) continue;
    if (r.species && !r.species.includes(st.species)) continue;
    if (st.library.includes(r.idx)) continue;
    out.push(r.idx);
  }
  return out;
}

export { ERAS };
