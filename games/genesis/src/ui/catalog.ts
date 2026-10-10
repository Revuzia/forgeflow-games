// GENESIS — what the interface knows by name (CONTRACT.md §16): the laws of each world (the parameter registry, query
// 'params': path, label, unit, range, value) and the names of the things the player touches (people, herds, buildings,
// creatures, disasters, ships, settlements). Panels ask synchronously and get what is known now (or null); a miss asks
// the sim in the background, so the next frame's hint, badge or toast has the name. Shared by the palette, the "do
// this" field, the hand and the toasts so each name is asked for once.

import type { EntityRef } from '../sim/types.ts';
import type { UiHost } from './host.ts';

export interface LawRow { path: string; label: string; unit: string; kind: string; value: unknown; desc: string; min?: number; max?: number; values?: string[] }

/** a person as the hand's hint and badge name them */
export interface Who { name: string; role: string }

const NAME_TTL = 60000;
const LAW_TTL = 8000;

export class Catalog {
  private host: UiHost;
  private names = new Map<string, { who: Who | null; at: number; asking: boolean }>();
  private lawsBy = new Map<number, { list: LawRow[]; at: number; asking: boolean }>();
  /** told when a law list arrives (panels that show laws re-render) */
  onLaws: (() => void) | null = null;

  constructor(host: UiHost) { this.host = host; }

  /** the laws of a world as last known (asks again when older than 8 s) */
  laws(planet: number): LawRow[] {
    const now = performance.now();
    let rec = this.lawsBy.get(planet);
    if (!rec) { rec = { list: [], at: -1e9, asking: false }; this.lawsBy.set(planet, rec); }
    if (!rec.asking && now - rec.at > LAW_TTL && this.host.source === 'worker') {
      rec.asking = true;
      const r = rec;
      void this.host.query('params', { planet }).then((d) => {
        r.asking = false;
        r.at = performance.now();
        if (Array.isArray(d)) { r.list = d as LawRow[]; this.onLaws?.(); }
      }).catch(() => { r.asking = false; r.at = performance.now(); });
    }
    return rec.list;
  }

  /** one law by path (null while unknown) */
  law(planet: number, path: string): LawRow | null {
    return this.laws(planet).find((l) => l.path === path) ?? null;
  }

  /** a thing's name, now if known (else null, and it is asked for) */
  nameOf(ref: { kind: string; id: number; planet?: number } | null): string | null {
    return this.whoOf(ref)?.name ?? null;
  }

  /** a thing's name and what it is ("Kek", "child"; "Red deer", "herd of 8") */
  whoOf(ref: { kind: string; id: number; planet?: number } | null): Who | null {
    if (!ref) return null;
    const v = this.host.view;
    const planet = ref.planet ?? this.host.primary();
    // what the mirror already has
    switch (ref.kind) {
      case 'settlement': for (const pv of v.planets) { const s = pv.settlements.find((q) => q.id === ref.id); if (s) return { name: s.name, role: s.flags & 1 ? 'a band' : `${s.era} age` }; } return null;
      case 'creature': { const c = v.creatures.find((q) => q.id === ref.id); return c ? { name: c.name, role: `${c.body}` } : null; }
      case 'disaster': for (const pv of v.planets) { const d = pv.disasters.find((q) => q.id === ref.id); if (d) return { name: `the ${d.kind.replace(/-/g, ' ')}`, role: 'disaster' }; } return null;
      case 'weather': for (const pv of v.planets) { const w = pv.weather.find((q) => q.id === ref.id); if (w) return { name: `the ${w.kind.replace(/-/g, ' ')}`, role: 'weather' }; } return null;
      case 'ship': { const s = v.ships.find((q) => q.id === ref.id); return s ? { name: `the ${s.kind.replace(/-/g, ' ')}`, role: 'ship' } : null; }
      case 'planet': { const p = v.planet(ref.id); return p ? { name: p.name, role: 'world' } : null; }
    }
    const key = `${ref.kind}:${planet}:${ref.id}`;
    const now = performance.now();
    const rec = this.names.get(key);
    if (rec && (rec.asking || now - rec.at < NAME_TTL)) return rec.who;
    if (this.host.source !== 'worker') return null;
    const r = rec ?? { who: null, at: now, asking: true };
    r.asking = true;
    this.names.set(key, r);
    const done = (who: Who | null) => { r.who = who ?? r.who; r.asking = false; r.at = performance.now(); };
    const q = this.host.query;
    const obj = (d: unknown) => (d && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : null);
    if (ref.kind === 'agent') {
      void q.call(this.host, 'agent', { id: ref.id, planet }).then((d) => {
        const a = obj(d);
        if (!a || typeof a.name !== 'string') { done(null); return; }
        const age = typeof a.age === 'number' ? a.age : 30;
        const role = typeof a.role === 'string' && a.role !== 'none' ? a.role : '';
        done({ name: a.name, role: age < 13 ? (age < 2 ? 'baby' : 'child') : role || (typeof a.speciesName === 'string' ? a.speciesName.toLowerCase() : 'grown') });
      }).catch(() => done(null));
    } else if (ref.kind === 'animal') {
      void q.call(this.host, 'herds', { planet }).then((d) => {
        const h = Array.isArray(d) ? (d as Record<string, unknown>[]).find((x) => x.id === ref.id) : null;
        done(h && typeof h.name === 'string' ? { name: h.name, role: `herd of ${Math.max(1, Math.round(Number(h.count ?? 1)))}` } : null);
      }).catch(() => done(null));
    } else if (ref.kind === 'building') {
      void q.call(this.host, 'building', { id: ref.id, planet }).then((d) => {
        const b = obj(d);
        done(b && typeof b.name === 'string' ? { name: b.name.toLowerCase().startsWith('the ') ? b.name : `the ${b.name.toLowerCase()}`, role: String(b.settlementName ?? '') } : null);
      }).catch(() => done(null));
    } else done(null);
    return r.who;
  }

  /** remember a name the caller learned some other way (the palette's people list) */
  teach(ref: { kind: string; id: number; planet?: number }, who: Who): void {
    this.names.set(`${ref.kind}:${ref.planet ?? this.host.primary()}:${ref.id}`, { who, at: performance.now(), asking: false });
  }

  /** a short name for the hand's hint ("Kek, child") */
  label(ref: EntityRef | null): string | null {
    const w = this.whoOf(ref);
    if (!w) return null;
    return w.role && ref?.kind === 'agent' ? `${w.name}, ${w.role}` : w.name;
  }
}
