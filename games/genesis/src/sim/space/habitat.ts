// GENESIS — air and warmth a body can live in (CONTRACT.md §12: "a methane people cannot breathe O2 without suits").
// A species breathes its gas (o2 / methane / none); a world's air either carries it or it does not. People in a sealed
// pressure suit (worn gear tagged 'suit') or within reach of a standing habitat dome of their settlement live inside
// their own air and temperature: the peoples' needs (people/needs.ts) ask here only when the world itself would kill.

import type { PCtx } from '../people/ctx.ts';
import type { AtmosphereParams } from '../types.ts';
import type { Content, SpeciesDef } from '../content.ts';
import type { Building } from '../people/state.ts';

/** can a body of this species breathe this air (its gas, not poisoned) */
export function breathable(sp: SpeciesDef, a: AtmosphereParams): boolean {
  if (a.toxicity > 0.5) return false;
  if (sp.breathes === 'o2') return a.pressure * a.o2 >= 0.05;
  if (sp.breathes === 'methane') return a.pressure * a.methane >= 0.005 && !(a.pressure * a.o2 > 0.05 && a.pressure * a.methane < 0.02);
  return true;
}

const suitCache = new WeakMap<Content, Uint8Array>();

/** items that seal a body in its own air (tag 'suit'), per content */
export function suitItems(c: Content): Uint8Array {
  let t = suitCache.get(c);
  if (!t) {
    t = new Uint8Array(c.items.size);
    c.items.list.forEach((it, i) => { if (it.tags.includes('suit')) t![i] = 1; });
    suitCache.set(c, t);
  }
  return t;
}

/** metres from a dome within which its sealed walkways and airlocks reach */
const DOME_REACH = 160;

/**
 * Does a settlement's building list hold any habitat building at all (finished or not). Keyed on the list object,
 * which the peoples state replaces whenever buildings come or go (people/state.ts `of`): a pure function of the list,
 * so a loaded game answers exactly as the live one. Whether a dome is FINISHED is read live below.
 */
const anyDome = new WeakMap<readonly Building[], boolean>();
function hasDome(x: PCtx, list: readonly Building[]): boolean {
  let v = anyDome.get(list);
  if (v === undefined) {
    v = list.some((b) => x.c.buildings.list[b.type]?.provides.includes('habitat') ?? false);
    anyDome.set(list, v);
  }
  return v;
}

/**
 * Is agent s sealed from the world's air and weather now: a suit on, or standing within a habitat dome's reach. Only
 * asked when the air would kill or the cold / heat is past bearing (a cheap path for everyone else).
 */
export function sealed(x: PCtx, s: number): boolean {
  const A = x.A;
  const g = A.gear[s];
  if (g >= 0 && suitItems(x.c)[g]) return true;
  const st = x.ps.settlement(A.settlement[s]);
  if (!st || st.band) return false;
  const list = x.ps.of(st.id);
  if (!hasDome(x, list)) return false;
  // (read live, never cached: a dome finished a minute ago shelters now, in a loaded game exactly as in the live one)
  const P = x.p.grid.pos;
  const c = A.cell[s];
  const R = x.p.st.radius;
  for (const b of list) {
    if (b.progress < 1 || b.flags & 2 || b.damage >= 0.8) continue;
    if (!x.c.buildings.list[b.type].provides.includes('habitat')) continue;
    const dot = P[c * 3] * b.pos[0] + P[c * 3 + 1] * b.pos[1] + P[c * 3 + 2] * b.pos[2];
    if (Math.acos(Math.max(-1, Math.min(1, dot))) * R <= DOME_REACH) return true;
  }
  return false;
}
