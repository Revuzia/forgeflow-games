// GENESIS — small helpers shared by the peoples modules: an agent's display name, chronicle variables for a settlement
// or an agent, entity refs, and emitting people events with positions.

import type { EntityRef, SimEvent } from '../types.ts';
import { AgentFlag } from '../types.ts';
import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { personalName } from './names.ts';
import type { Vars } from './story.ts';

const _p = [0, 0, 0];

export function agentName(x: PCtx, s: number): string {
  const A = x.A;
  const custom = x.ps.names[String(A.id[s])];
  if (custom) return custom;
  const st = x.ps.settlement(A.settlement[s]);
  return personalName(x.c, A.species[s], st ? st.langSeed : 0, A.name[s]);
}

export function settlementLabel(st: Settlement | undefined | null): string {
  if (!st) return 'the wilds';
  return st.band ? `the band of ${st.name}` : st.name;
}

/** chronicle variables for an agent in a settlement */
export function vars(x: PCtx, st: Settlement | null | undefined, s = -1, extra: Vars = {}): Vars {
  const sp = st ? x.c.species.list[st.species] : s >= 0 ? x.c.species.list[x.A.species[s]] : undefined;
  const v: Vars = {
    people: sp ? sp.plural.replace(/^the /, '') : 'people',
    adj: sp?.adjective ?? '',
    settlement: settlementLabel(st ?? null),
    ...extra,
  };
  if (s >= 0) {
    v.agent = agentName(x, s);
    const hive = sp?.body === 'hexapod-hive';
    const female = (x.A.flags[s] & AgentFlag.female) !== 0;
    v.pron = hive ? 'it' : female ? 'her' : 'him';
    v.pron2 = hive ? 'its' : female ? 'her' : 'his';
  }
  return v;
}

export function agentRef(x: PCtx, s: number): EntityRef {
  return { kind: 'agent', id: x.A.id[s], planet: x.p.id };
}

export function settlementRef(x: PCtx, st: Settlement): EntityRef {
  return { kind: 'settlement', id: st.id, planet: x.p.id };
}

/** emit a people event at an agent's position */
export function emitAt(x: PCtx, s: number, e: Omit<SimEvent, 'tick' | 'planet' | 'pos'>): void {
  x.A.posAt(s, x.tick, _p);
  x.u.emit({ ...e, planet: x.p.id, pos: [_p[0], _p[1], _p[2]] });
}

/** emit a people event at a settlement */
export function emitSt(x: PCtx, st: Settlement, e: Omit<SimEvent, 'tick' | 'planet' | 'pos'>): void {
  x.u.emit({ ...e, planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: e.ref ?? settlementRef(x, st) });
}

/** a recipe's display name, lower-cased for running text ("bronze", "the wheel") */
export function kName(x: PCtx, k: number): string {
  const r = x.rt.list[k];
  if (!r) return 'something';
  const n = r.name;
  return /^[A-Z][a-z]/.test(n) && !/^[A-Z][a-z]+ [A-Z]/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
}
