// GENESIS — ARC §6.7: the UI and render lanes' stub for the arc's views. `__GENESIS__.arc.stub(kind, data)` stores a
// piece of view data; every snapshot that reaches the client afterwards carries it, as if the sim had sent it. The sim's
// own value is overridden while a stub is set; `stub(kind, null)` clears it. Kept as a no-op path once stage C is green.
//
//   stub('hearts', [{ settlement, heart?, defiant?, covenant? }, ...] | { signs: number | Record<agentId, HeartSign> })
//   stub('towers', TowerView[] | { planet, towers })          -> PlanetSnap.towers (the first planet unless named)
//   stub('covenant', { planet?, covenant?, covenantOffer? })  -> PlanetSnap.covenant / covenantOffer
//   stub('age', { planet?, age?, epithet? })                  -> PlanetSnap.age / epithet
//   stub('events', SimEvent[] | { events?, chronicle? })      -> appended ONCE to the next snapshot's events / chronicle
//                                                                (stage B: `defy`, `defy.answered` before the sim emits them;
//                                                                a missing `tick` takes the snapshot's)

import type { Snapshot, PlanetSnap, SettlementView, TowerView, SimEvent, ChronicleEntry } from '../sim/types.ts';

export type ArcStubKind = 'hearts' | 'towers' | 'covenant' | 'age' | 'events';
type TownStub = { settlement: number; heart?: SettlementView['heart']; defiant?: SettlementView['defiant']; covenant?: SettlementView['covenant'] };

interface Stubs {
  towns: Map<number, TownStub> | null;
  signs: number | Record<string, number> | null;
  towers: { planet: number | null; towers: TowerView[] } | null;
  covenant: { planet: number | null; covenant?: PlanetSnap['covenant']; covenantOffer?: PlanetSnap['covenantOffer'] } | null;
  age: { planet: number | null; age?: PlanetSnap['age']; epithet?: string } | null;
  /** one-shot: delivered with the next snapshot, then gone */
  events: { events: Partial<SimEvent>[]; chronicle: Partial<ChronicleEntry>[] } | null;
}
const S: Stubs = { towns: null, signs: null, towers: null, covenant: null, age: null, events: null };

const planetOf = (d: unknown): number | null => (d && typeof d === 'object' && typeof (d as { planet?: unknown }).planet === 'number' ? (d as { planet: number }).planet : null);

export function arcStub(kind: ArcStubKind, data: unknown): void {
  switch (kind) {
    case 'hearts': {
      if (data == null) { S.towns = null; S.signs = null; return; }
      if (Array.isArray(data)) {
        S.towns = new Map();
        for (const t of data as TownStub[]) if (t && typeof t.settlement === 'number') S.towns.set(t.settlement, t);
      } else if (typeof data === 'object') {
        const o = data as { signs?: number | Record<string, number>; towns?: TownStub[] };
        if (o.signs !== undefined) S.signs = o.signs;
        if (Array.isArray(o.towns)) arcStub('hearts', o.towns);
      }
      return;
    }
    case 'towers':
      S.towers = data == null ? null : Array.isArray(data) ? { planet: null, towers: data as TowerView[] }
        : { planet: planetOf(data), towers: ((data as { towers?: TowerView[] }).towers ?? []) };
      return;
    case 'covenant': S.covenant = data == null ? null : { planet: planetOf(data), ...(data as object) }; return;
    case 'age': S.age = data == null ? null : { planet: planetOf(data), ...(data as object) }; return;
    case 'events': {
      if (data == null) { S.events = null; return; }
      const o = (Array.isArray(data) ? { events: data } : data) as { events?: Partial<SimEvent>[]; chronicle?: Partial<ChronicleEntry>[] };
      S.events ??= { events: [], chronicle: [] };
      S.events.events.push(...(o.events ?? []));
      S.events.chronicle.push(...(o.chronicle ?? []));
      return;
    }
  }
}

export function arcStubActive(): boolean {
  return !!(S.towns || S.signs != null || S.towers || S.covenant || S.age || S.events);
}

/** patches a snapshot in place (called by the sim client before the WorldView sees it) */
export function applyArcStub(snap: Snapshot): void {
  if (!arcStubActive() || !snap?.planets?.length) return;
  if (S.events) {
    const tick = Math.floor(snap.tick ?? 0);
    for (const e of S.events.events) (snap.events ??= []).push({ ...e, t: String(e.t ?? ''), tick: e.tick ?? tick } as SimEvent);
    for (const c of S.events.chronicle) (snap.chronicle ??= []).push({ year: 1, day: 1, weight: 1, kind: 'god', text: '', planet: snap.planets[0].id, ...c, tick: c.tick ?? tick } as ChronicleEntry);
    S.events = null;
  }
  const first = snap.planets[0].id;
  const on = (p: PlanetSnap, want: number | null) => p.id === (want ?? first);
  for (const p of snap.planets) {
    if (S.towns && p.settlements) {
      for (const sv of p.settlements) {
        const t = S.towns.get(sv.id);
        if (!t) continue;
        if ('heart' in t) sv.heart = t.heart;
        if ('defiant' in t) sv.defiant = t.defiant;
        if ('covenant' in t) sv.covenant = t.covenant;
      }
    }
    if (S.signs != null && p.agents) {
      const a = p.agents, h = new Uint8Array(a.count);
      if (typeof S.signs === 'number') h.fill(S.signs);
      else for (let k = 0; k < a.count; k++) h[k] = S.signs[String(a.id[k])] ?? 0;
      a.heart = h;
    }
    if (S.towers && on(p, S.towers.planet)) p.towers = S.towers.towers;
    if (S.covenant && on(p, S.covenant.planet)) {
      if ('covenant' in S.covenant) p.covenant = S.covenant.covenant ?? null;
      if ('covenantOffer' in S.covenant) p.covenantOffer = S.covenant.covenantOffer ?? null;
    }
    if (S.age && on(p, S.age.planet)) {
      if ('age' in S.age) p.age = S.age.age ?? null;
      if ('epithet' in S.age) p.epithet = S.age.epithet;
    }
  }
}
