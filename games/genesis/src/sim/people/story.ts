// GENESIS — the peoples' side of the chronicle (CONTRACT.md §13, events.json): template lookup, deterministic variant
// choice, placeholder substitution, and the settlement's own memory of its stories (which later feeds taboos and the
// inspector). "The secret of bronze died with Hesh of Aru."

import type { EntityRef } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from './state.ts';
import { hash32, hashStr } from '../core/rng.ts';

export type Vars = Record<string, string | number | undefined>;

/** find a template by id, falling back to its parent id ('discovery.accident.x' -> 'discovery.accident') */
function template(u: Universe, id: string) {
  let k = id;
  for (;;) {
    const t = u.content.events.find(k);
    if (t) return t;
    const i = k.lastIndexOf('.');
    if (i < 0) return undefined;
    k = k.slice(0, i);
  }
}

export function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined ? m : String(v);
  });
}

/** append a chronicle entry from a template; also remembered as a story of `st` */
export function tell(u: Universe, p: Planet, id: string, vars: Vars, st?: Settlement | null, refs?: EntityRef[], weightOverride?: number): string {
  const t = template(u, id);
  let text: string;
  let kind = 'people';
  let weight = 1;
  if (t) {
    const variant = t.text[hash32(u.tick, st ? st.id : 0, hashStr(id)) % t.text.length];
    text = fill(variant, vars);
    kind = t.kind;
    weight = t.weight;
  } else text = fill(String(vars.text ?? id), vars);
  if (weightOverride !== undefined) weight = weightOverride;
  text = text.charAt(0).toUpperCase() + text.slice(1);
  u.chronicleAdd(p, kind, text, weight, refs);
  if (st) remember(st, u.tick, kind, text, weight);
  return text;
}

/** a settlement remembers a story (most recent 16; heavier stories outlive lighter ones) */
export function remember(st: Settlement, tick: number, kind: string, text: string, weight: number): void {
  const l = st.culture.stories;
  l.push({ tick, kind, text, weight });
  if (l.length > 16) {
    // drop the lightest, oldest story
    let k = 0;
    for (let i = 1; i < l.length; i++) if (l[i].weight < l[k].weight || (l[i].weight === l[k].weight && l[i].tick < l[k].tick)) k = i;
    l.splice(k, 1);
  }
}
