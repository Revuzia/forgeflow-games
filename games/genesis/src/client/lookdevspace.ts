// GENESIS — lookdev SPACE: fabricated ships and world events for the render-dev world (`?source=lookdev`), so the
// ships, launches, transfers, landings, cracked worlds, falling moons and new worlds can be built and photographed
// without the sim (CONTRACT.md §12, §15.7). It serves the same ShipViews, PlanetParams.ring, planets that come and go,
// disasters and SimEvents the sim does, from the sim's OWN flight formulas (space/transit.ts: the pad, the climb
// bending east, the great-circle orbit at its period, the Bezier transfer to the target's predicted place with the
// ship's own bow, the descent), so what the renderer draws here is what it will draw for the sim.
//
// Commands (LookdevBackend.cmd → here first):
//   ship.launch / lookdev.ship  { kind, era?, from?, to?, pos?, dest?, start? (phase), progress? (0..1), fail? (phase),
//                                 failAt? (0..1), heading? } → a mission on its own clock; created: [{ kind: 'ship', id }]
//   lookdev.ship.clear          every fabricated ship gone
//   world.crack                 { world } → a debris ring (params.ring), two moonlets, 'world.cracked'
//   world.erase                 { world } → alive = false for a snapshot, then gone; 'world.erased'
//   world.moon-fall             { world, moon?, ticks? } → the moon spirals in (Kepler: its month shortens), a
//                               'moon-fall' disaster on the host, then 'impact' (data.kind 'moon-fall') and the moon is gone
//   world.birth                 { kind?, distance? (AU), name? } → a new world on its orbit
// Missions add their launchpad / airship mast / star gate to the home world's buildings (beside the most advanced town).

import type {
  BuildingBlock, Command, CommandResult, DisasterView, FieldName, OrbitParams, PlanetSnap, ShipView, SimEvent, UnitVec,
} from '../sim/types.ts';
import { getGrid } from '../sim/grid/icogrid.ts';
import { hashFloat } from '../sim/core/rng.ts';
import { slerp as vslerp, tangentBasis } from '../sim/core/vec3.ts';
import { BASE_PACK } from '../data/index.ts';
import { bodyQuat, orbitOffset, orbitPlaneQuat, qAxis, qMul, qRotate, qRotateInv, spinAt, type D3, type DQ } from './orbits.ts';
import { buildingIndex, materialIndex } from '../render/life/catalog.ts';
import { ASCENT_TICKS, DAY, DESCENT_TICKS, ORBIT_PERIOD, PAD_TICKS } from '../sim/space/transit.ts';

type Fields = Partial<Record<FieldName, Float32Array>>;

export interface SpacePlanet { snap: PlanetSnap; fields: Fields; dirty: Set<FieldName> }

/** what lookdev.ts lends this module */
export interface SpaceHost {
  planets(): SpacePlanet[];
  /** make a planet ('moon' | 'barren' | 'terran' | 'desert') and add it to the system */
  addPlanet(kind: string, id: number, name: string, seed: number, n: number, radius: number, orbit: OrbitParams): void;
  removePlanet(id: number): void;
  /** the home world's full building block (the life fabricator's) */
  baseBuildings(planet: number): BuildingBlock | null;
}

interface KindDef { id: string; class: string; altitude: number; orbitHours: number; days: [number, number] }
const KINDS = new Map<string, KindDef>((((BASE_PACK as unknown as { ships?: KindDef[] }).ships) ?? []).map((k) => [k.id, k]));
const ASCENT_ARC = 0.35;
const PHASES = ['building', 'fuelling', 'boarding', 'pad', 'ascent', 'orbit', 'transfer', 'descent', 'landed'] as const;

interface Mission {
  id: number;
  kind: string;
  cls: string;
  era?: string;
  from: number;
  to: number;
  padPos: D3;
  dest: D3;
  altitude: number;
  /** phase timeline: start ticks (absolute) per phase; Infinity = never reached */
  t: Record<string, number>;
  len: Record<string, number>;
  orbitA: D3;
  orbitB: D3;
  bez: D3[] | null;
  fail: string | null;
  failAt: number;
  lostAt: { planet: number; pos: D3; alt: number; sys: D3 } | null;
  heading: number;
  crew: number;
  lastPhase: string;
}

function norm3(v: D3): D3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
function rotY(v: ArrayLike<number>, a: number): D3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
const smooth = (f: number) => { const t = Math.max(0, Math.min(1, f)); return t * t * (3 - 2 * t); };
function bezier(P: D3[], f: number): D3 {
  const g = 1 - f;
  const a = g * g * g, b = 3 * g * g * f, c = 3 * g * f * f, d = f * f * f;
  return [0, 1, 2].map((k) => a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k]) as D3;
}

export class LookdevSpace {
  private host: SpaceHost;
  private missions: Mission[] = [];
  private nextId = 1001;
  private events: SimEvent[] = [];
  /** extra buildings per planet (pads, masts, gates) and a version for re-sending */
  private extras = new Map<number, { type: number; mat: number; pos: D3; rot: number; scale: number; settlement: number }[]>();
  private extrasVersion = 0;
  private sentVersion = new Map<number, number>();
  /** worlds being erased: snapshots sent with alive = false (removed after two) */
  private erasing = new Map<number, number>();
  private falls: { moon: number; host: number; t0: number; life: number; a0: number; T0: number; id: number }[] = [];
  private nextPlanet = 40;
  private tick = 0;
  private padCache = new Map<string, D3>();

  constructor(host: SpaceHost) { this.host = host; }

  private planet(id: number): SpacePlanet | undefined { return this.host.planets().find((p) => p.snap.id === id); }

  // ── frames (the lookdev planets turn by spin + 2π t / day at the snapshot's own spin) ──

  private center(id: number, tick: number, out: D3 = [0, 0, 0]): D3 {
    const p = this.planet(id);
    if (!p) { out[0] = out[1] = out[2] = 0; return out; }
    orbitOffset(p.snap.params.orbit, tick, out);
    const par = p.snap.params.orbit.parent;
    if (par >= 0) { const c = this.center(par, tick); out[0] += c[0]; out[1] += c[1]; out[2] += c[2]; }
    return out;
  }
  private spin(id: number, tick: number): number {
    const p = this.planet(id)!;
    return spinAt(p.snap.params, this.tick, tick);
  }
  private quat(id: number, tick: number): DQ {
    const p = this.planet(id)!;
    return bodyQuat(p.snap.params, this.spin(id, tick));
  }
  private eqQuat(id: number): DQ {
    const p = this.planet(id)!;
    const q = orbitPlaneQuat(p.snap.params.orbit);
    return qMul(q, qAxis(1, 0, 0, p.snap.params.axialTilt));
  }
  private bodyToSys(id: number, tick: number, dir: ArrayLike<number>, r: number): D3 {
    const c = this.center(id, tick);
    const v = qRotate(this.quat(id, tick), [dir[0] * r, dir[1] * r, dir[2] * r]);
    return [c[0] + v[0], c[1] + v[1], c[2] + v[2]];
  }
  private sysToBody(id: number, tick: number, sys: ArrayLike<number>): { dir: D3; r: number } {
    const c = this.center(id, tick);
    const d: D3 = [sys[0] - c[0], sys[1] - c[1], sys[2] - c[2]];
    const r = Math.hypot(d[0], d[1], d[2]) || 1;
    const b = qRotateInv(this.quat(id, tick), [d[0] / r, d[1] / r, d[2] / r]);
    return { dir: norm3(b), r };
  }
  private radius(id: number): number { return this.planet(id)?.snap.params.radius ?? 3000; }

  // ── sites ──

  /** a flat dry place for a pad: beside the most advanced town on the home world, else the flattest dry land */
  private site(planet: number, near: D3 | null, minD: number, maxD: number, salt: number): D3 {
    const key = `${planet}|${near ? near.map((x) => x.toFixed(4)).join(',') : '-'}|${minD}|${maxD}|${salt}`;
    const hit = this.padCache.get(key);
    if (hit) return hit;
    const p = this.planet(planet);
    if (!p) return [0, 1, 0];
    const g = getGrid(p.snap.gridN);
    const R = p.snap.params.radius;
    const S = p.fields.surface, W = p.fields.water, T = p.fields.tree;
    const B = this.host.baseBuildings(planet);
    let best = -1, bs = -Infinity;
    for (let c = 0; c < g.count; c++) {
      const x = g.pos[c * 3], y = g.pos[c * 3 + 1], z = g.pos[c * 3 + 2];
      if (near) {
        const d = Math.acos(Math.min(1, x * near[0] + y * near[1] + z * near[2])) * R;
        if (d < minD || d > maxD) continue;
      }
      if (W && W[c] > 0.02) continue;
      if (Math.abs(y) > 0.75) continue;
      // flatness: the largest height step to a neighbour
      let step = 0;
      let wetNear = false;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (S) step = Math.max(step, Math.abs(S[o] - S[c]));
        if (W && W[o] > 0.02) wetNear = true;
      }
      if (wetNear) continue;
      let score = -step * 2 - (T ? T[c] * 30 : 0) + hashFloat(c, salt) * 2;
      if (S && p.snap.params.seaLevel !== undefined && S[c] < p.snap.params.seaLevel + 3) score -= 20;
      // keep clear of the town's buildings
      if (B) {
        let close = Infinity;
        for (let i = 0; i < B.count; i++) {
          const d = Math.acos(Math.min(1, B.pos[i * 3] * x + B.pos[i * 3 + 1] * y + B.pos[i * 3 + 2] * z)) * R;
          if (d < close) close = d;
        }
        if (close < 45) continue;
      }
      if (score > bs) { bs = score; best = c; }
    }
    const out: D3 = best >= 0 ? [g.pos[best * 3], g.pos[best * 3 + 1], g.pos[best * 3 + 2]] : [0, 1, 0];
    this.padCache.set(key, out);
    return out;
  }

  /** the most advanced settlement on a world (its position), for the pad */
  private townOf(planet: number): D3 | null {
    const p = this.planet(planet);
    const st = p?.snap.settlements ?? [];
    const rank = ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'];
    let best: { pos: UnitVec; r: number } | null = null;
    for (const s of st) { const r = rank.indexOf(s.era); if (!best || r > best.r) best = { pos: s.pos, r }; }
    return best ? [best.pos[0], best.pos[1], best.pos[2]] : null;
  }

  private nearestSettlement(planet: number, pos: D3): number {
    const st = this.planet(planet)?.snap.settlements ?? [];
    let best = -1, bd = Infinity;
    for (const s of st) { const d = Math.acos(Math.min(1, s.pos[0] * pos[0] + s.pos[1] * pos[1] + s.pos[2] * pos[2])); if (d < bd) { bd = d; best = s.id; } }
    return best;
  }

  private addBuilding(planet: number, kind: string, pos: D3, rot: number): void {
    const type = buildingIndex(kind);
    if (type < 0) return;
    const list = this.extras.get(planet) ?? [];
    if (list.some((b) => Math.abs(b.pos[0] - pos[0]) + Math.abs(b.pos[1] - pos[1]) + Math.abs(b.pos[2] - pos[2]) < 1e-6)) return;
    list.push({ type, mat: materialIndex(kind === 'star-gate' ? 'steel' : 'concrete'), pos, rot, scale: 1, settlement: this.nearestSettlement(planet, pos) });
    this.extras.set(planet, list);
    this.extrasVersion++;
  }

  // ── missions ──

  private transferTicks(m: Mission, t0: number): number {
    const def = KINDS.get(m.kind);
    const a = this.center(m.from, t0), b = this.center(m.to, t0);
    const au = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1.5e6;
    const k = Math.max(0, Math.min(1, (au - 0.15) / 2.5));
    const days = def ? def.days[0] + (def.days[1] - def.days[0]) * k : 3;
    return Math.max(30, Math.round(days * DAY));
  }

  /** set up the phase timeline so that `now` falls at (start, progress) */
  private plan(m: Mission, now: number, start: string, progress: number): void {
    const def = KINDS.get(m.kind);
    const air = m.cls === 'air', gate = m.cls === 'gate', orbitOnly = m.cls === 'orbit', sea = m.cls === 'sea';
    const len: Record<string, number> = {
      building: 600, fuelling: 240, boarding: 60, pad: gate ? 30 : PAD_TICKS, ascent: air ? 30 : ASCENT_TICKS,
      orbit: orbitOnly ? Infinity : Math.max(30, (def?.orbitHours ?? 2) * 60), transfer: 0, descent: DESCENT_TICKS, landed: Infinity,
    };
    if (gate) { len.ascent = 0; len.orbit = 0; len.descent = 0; len.transfer = 3; }
    if (air) { len.orbit = 0; }
    if (sea) { for (const k of PHASES) len[k] = 0; len.transfer = Infinity; }
    // the transfer's length depends on where the worlds are when it starts: two passes
    let T = air ? Math.max(40, Math.round((def?.days[0] ?? 0.4) * DAY)) : gate ? 3 : 3 * DAY;
    const order = PHASES as readonly string[];
    for (let pass = 0; pass < 3; pass++) {
      len.transfer = sea ? Infinity : orbitOnly ? 0 : T;
      const t: Record<string, number> = {};
      // the phases before `start` ended before now
      let acc = now - progress * (Number.isFinite(len[start]) ? len[start] : 0);
      const si = order.indexOf(start);
      for (let i = si - 1; i >= 0; i--) { acc -= len[order[i]]; }
      let tt = acc;
      for (const k of order) { t[k] = tt; tt += Number.isFinite(len[k]) ? len[k] : 0; if (!Number.isFinite(len[k])) tt = Infinity; }
      m.t = t; m.len = len;
      if (!air && !gate && !orbitOnly && !sea) T = this.transferTicks(m, t.transfer);
    }
    // orbit plane at the end of the climb, the transfer curve at its start
    if (!sea && !gate) {
      const tEnd = m.t.orbit;
      const end = rotY(m.padPos, ASCENT_ARC);
      const A = norm3(rotY(end, Number.isFinite(tEnd) ? this.spin(m.from, tEnd) : 0));
      m.orbitA = A;
      m.orbitB = norm3([A[2], 0, -A[0]]);
      if (!air && !orbitOnly) this.planTransfer(m);
    }
  }

  private orbitAt(m: Mission, t: number): { sys: D3; body: D3 } {
    const th = (2 * Math.PI * (t - m.t.orbit)) / ORBIT_PERIOD;
    const c = Math.cos(th), s = Math.sin(th);
    const e: D3 = [m.orbitA[0] * c + m.orbitB[0] * s, m.orbitA[1] * c + m.orbitB[1] * s, m.orbitA[2] * c + m.orbitB[2] * s];
    const r = this.radius(m.from) + m.altitude;
    const cen = this.center(m.from, t);
    const v = qRotate(this.eqQuat(m.from), e);
    return { sys: [cen[0] + v[0] * r, cen[1] + v[1] * r, cen[2] + v[2] * r], body: rotY(e, -this.spin(m.from, t)) };
  }

  private planTransfer(m: Mission): void {
    const t0 = m.t.transfer, T = m.len.transfer, t1 = t0 + T;
    const p0 = this.orbitAt(m, t0).sys;
    const p3 = this.bodyToSys(m.to, t1, m.dest, this.radius(m.to) + m.altitude);
    const vel = (id: number, t: number): D3 => { const a = this.center(id, t - 30), b = this.center(id, t + 30); return [(b[0] - a[0]) / 60, (b[1] - a[1]) / 60, (b[2] - a[2]) / 60]; };
    const v0 = vel(m.from, t0), v1 = vel(m.to, t1);
    const k = T / 3;
    const bow = (hashFloat(m.id, 0xb0e) - 0.5) * 0.06 * Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    m.bez = [p0, [p0[0] + v0[0] * k, p0[1] + v0[1] * k + bow, p0[2] + v0[2] * k], [p3[0] - v1[0] * k, p3[1] - v1[1] * k + bow, p3[2] - v1[2] * k], p3];
  }

  private phaseAt(m: Mission, t: number): { phase: string; f: number } {
    let ph = 'building';
    for (const k of PHASES) if (t >= m.t[k] && m.len[k] !== 0) ph = k;
    if (m.cls === 'sea') ph = 'transfer';
    const L = m.len[ph];
    const f = Number.isFinite(L) && L > 0 ? Math.max(0, Math.min(1, (t - m.t[ph]) / L)) : 0;
    if (m.fail && (PHASES as readonly string[]).indexOf(ph) > (PHASES as readonly string[]).indexOf(m.fail) || (m.fail === ph && f >= m.failAt)) return { phase: 'lost', f: 0 };
    return { phase: ph, f };
  }

  /** where the ship is at tick t (space/transit.ts shipWhere, on the lookdev worlds) */
  private where(m: Mission, t: number): { planet: number; pos: D3; alt: number; sys: D3; phase: string; f: number } {
    const { phase, f } = this.phaseAt(m, t);
    const out = { planet: m.from, pos: [...m.padPos] as D3, alt: 0, sys: [0, 0, 0] as D3, phase, f };
    const onBody = (id: number, dir: D3, alt: number) => { out.planet = id; out.pos = dir; out.alt = alt; out.sys = this.bodyToSys(id, t, dir, this.radius(id) + alt); };
    const near = () => {
      out.planet = -1; out.pos = [...out.sys] as D3; out.alt = 0;
      let best = Infinity;
      for (const id of [m.from, m.to]) {
        if (!this.planet(id)) continue;
        const b = this.sysToBody(id, t, out.sys);
        if (b.r < this.radius(id) * 8 && b.r < best) { best = b.r; out.planet = id; out.pos = b.dir; out.alt = b.r - this.radius(id); }
      }
    };
    const A = m.altitude;
    switch (phase) {
      case 'building': case 'fuelling': case 'boarding': case 'pad': onBody(m.from, m.padPos, 0); break;
      case 'ascent':
        if (m.cls === 'air') onBody(m.from, m.padPos, A * smooth(f));
        else onBody(m.from, norm3(rotY(m.padPos, ASCENT_ARC * f * f)), A * Math.pow(f, 1.4));
        break;
      case 'orbit': { const o = this.orbitAt(m, t); out.planet = m.from; out.pos = o.body; out.alt = A; out.sys = o.sys; break; }
      case 'transfer':
        if (m.cls === 'sea') {
          // a vessel under sail: along a great circle from its start, slowly
          const ang = (t - m.t.transfer) * 0.02 / this.radius(m.from);
          const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
          tangentBasis(e, n, m.padPos);
          const h = m.heading;
          const dir: D3 = [n[0] * Math.cos(h) + e[0] * Math.sin(h), n[1] * Math.cos(h) + e[1] * Math.sin(h), n[2] * Math.cos(h) + e[2] * Math.sin(h)];
          const p: D3 = norm3([m.padPos[0] * Math.cos(ang) + dir[0] * Math.sin(ang), m.padPos[1] * Math.cos(ang) + dir[1] * Math.sin(ang), m.padPos[2] * Math.cos(ang) + dir[2] * Math.sin(ang)]);
          onBody(m.from, p, 0);
          break;
        }
        if (m.cls === 'air') { onBody(m.from, norm3(vslerp([0, 0, 0], m.padPos, m.dest, smooth(f))), A); break; }
        if (m.cls === 'gate' || !m.bez) {
          const a = this.bodyToSys(m.from, t, m.padPos, this.radius(m.from) + 2), b = this.bodyToSys(m.to, t, m.dest, this.radius(m.to) + 2);
          out.sys = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
          near();
          break;
        }
        out.sys = bezier(m.bez, f);
        near();
        break;
      case 'descent': onBody(m.cls === 'air' ? m.from : m.to, m.dest, A * Math.pow(1 - f, 1.3)); break;
      case 'landed': onBody(m.cls === 'air' ? m.from : m.to, m.dest, 0); break;
      case 'lost': {
        if (!m.lostAt) {
          const before = { ...m, fail: null } as Mission;
          const tf = Math.min(t, (m.t[m.fail ?? 'ascent'] ?? t) + (m.len[m.fail ?? 'ascent'] ?? 0) * m.failAt);
          const w = this.where(before, tf);
          m.lostAt = { planet: w.planet, pos: w.pos, alt: w.alt, sys: w.sys };
        }
        const la = m.lostAt;
        if (la.planet >= 0 && this.planet(la.planet)) onBody(la.planet, la.pos, la.alt);
        else { out.sys = [...la.sys] as D3; out.planet = -1; out.pos = [...la.sys] as D3; }
        break;
      }
    }
    return out;
  }

  private shipView(m: Mission, t: number): ShipView {
    const w = this.where(m, t);
    let heading = 0;
    if (w.planet >= 0) {
      const n = this.where(m, t + 2);
      if (n.planet === w.planet) {
        const e: D3 = [0, 0, 0], no: D3 = [0, 0, 0];
        tangentBasis(e, no, w.pos);
        const d: D3 = [n.pos[0] - w.pos[0], n.pos[1] - w.pos[1], n.pos[2] - w.pos[2]];
        const de = d[0] * e[0] + d[1] * e[1] + d[2] * e[2], dn = d[0] * no[0] + d[1] * no[1] + d[2] * no[2];
        if (Math.abs(de) + Math.abs(dn) > 1e-12) heading = Math.atan2(de, dn);
      }
      if (m.cls === 'sea') heading = m.heading;
    }
    const progress = w.phase === 'lost' ? 0 : Math.round(w.f * 1000) / 1000;
    const v: ShipView = {
      id: m.id, kind: m.kind, owner: -1, species: 0, phase: w.phase, planet: w.planet, pos: w.pos, alt: Math.round(w.alt * 100) / 100,
      sysPos: w.sys, heading, crew: m.crew, from: m.from, to: m.to, progress,
    };
    if (m.era) v.era = m.era;
    return v;
  }

  // ── commands ──

  cmd(c: Command, tick: number): CommandResult | null {
    this.tick = tick;
    switch (c.k) {
      case 'ship.launch': case 'lookdev.ship': return this.launch(c, tick);
      case 'lookdev.ship.clear': this.missions = []; return { ok: true, msg: 'Every fabricated ship is gone.' };
      case 'world.crack': return this.crack(Number(c.world ?? c.planet ?? 0), tick);
      case 'world.erase': return this.erase(Number(c.world ?? c.planet ?? 0), tick);
      case 'world.moon-fall': return this.moonFall(Number(c.world ?? c.planet ?? 0), typeof c.moon === 'number' ? c.moon : -1, Number(c.ticks ?? 4320), tick);
      case 'world.birth': return this.birth(String(c.kind ?? 'terran'), Number(c.distance ?? 1.9), typeof c.name === 'string' ? c.name : '', tick);
    }
    return null;
  }

  private launch(c: Command, tick: number): CommandResult {
    const kind = String(c.kind ?? 'rocket');
    const def = KINDS.get(kind);
    const cls = def?.class ?? (kind === 'raft' || kind === 'boat' || kind === 'sailship' ? 'sea' : 'interplanetary');
    const from = Number(c.from ?? 0);
    const fp = this.planet(from);
    if (!fp) return { ok: false, msg: `lookdev: no world ${from}` };
    const to = cls === 'interplanetary' || cls === 'gate' ? Number(c.to ?? (this.host.planets().find((p) => p.snap.id !== from && p.snap.params.orbit.parent < 0 && p.snap.params.kind !== 'barren')?.snap.id ?? from)) : from;
    const id = typeof c.id === 'number' ? c.id : this.nextId++;
    this.missions = this.missions.filter((m) => m.id !== id);
    const town = this.townOf(from);
    let pad: D3;
    if (Array.isArray(c.pos)) pad = norm3([Number(c.pos[0]), Number(c.pos[1]), Number(c.pos[2])]);
    else if (cls === 'sea') pad = this.seaSite(from, town);
    else pad = this.site(from, town, cls === 'air' ? 110 : 190, cls === 'air' ? 320 : 520, kind.length);
    let dest: D3;
    if (Array.isArray(c.dest)) dest = norm3([Number(c.dest[0]), Number(c.dest[1]), Number(c.dest[2])]);
    else if (cls === 'air') {
      // a crossing over the world: some 1–2 km away
      const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
      tangentBasis(e, n, pad);
      const ang = 1600 / fp.snap.params.radius;
      dest = norm3([pad[0] + e[0] * ang, pad[1] + e[1] * ang * 0.4, pad[2] + e[2] * ang]);
    } else dest = this.site(to, this.townOf(to), 0, 1e9, 7);
    const m: Mission = {
      id, kind, cls, era: typeof c.era === 'string' ? c.era : undefined, from, to, padPos: pad, dest, altitude: def?.altitude ?? 0,
      t: {}, len: {}, orbitA: [1, 0, 0], orbitB: [0, 0, 1], bez: null, fail: typeof c.fail === 'string' ? c.fail : null,
      failAt: Number(c.failAt ?? 0.5), lostAt: null, heading: Number(c.heading ?? 1.2), crew: Number(c.crew ?? (kind === 'orbiter' ? 0 : 6)), lastPhase: '',
    };
    const start = typeof c.start === 'string' ? c.start : cls === 'sea' ? 'transfer' : 'pad';
    this.plan(m, tick, start, Math.max(0, Math.min(0.999, Number(c.progress ?? 0))));
    this.missions.push(m);
    if (cls !== 'sea') {
      const yaw = hashFloat(id, 17) * Math.PI * 2;
      this.addBuilding(from, cls === 'air' ? 'airship-mast' : cls === 'gate' ? 'star-gate' : 'launchpad', pad, yaw);
      if (cls === 'gate' && this.planet(to)) this.addBuilding(to, 'star-gate', dest, yaw);
    }
    return { ok: true, msg: `A ${kind} (lookdev) at ${start} ${Math.round(Number(c.progress ?? 0) * 100)} %.`, created: [{ kind: 'ship', id, planet: from }], tick };
  }

  /** a stretch of open water near the coast for a sailing vessel */
  private seaSite(planet: number, near: D3 | null): D3 {
    const p = this.planet(planet);
    if (!p) return [0, 1, 0];
    const g = getGrid(p.snap.gridN);
    const W = p.fields.water;
    const R = p.snap.params.radius;
    let best = -1, bs = -Infinity;
    for (let c = 0; c < g.count; c++) {
      if (!W || W[c] < 4) continue;
      const x = g.pos[c * 3], y = g.pos[c * 3 + 1], z = g.pos[c * 3 + 2];
      if (Math.abs(y) > 0.7) continue;
      const d = near ? Math.acos(Math.min(1, x * near[0] + y * near[1] + z * near[2])) * R : 0;
      // open but near the coast: deep water a few hundred metres off shore
      const score = -Math.abs(d - 380) / 100 + Math.min(1, W[c] / 20);
      if (score > bs) { bs = score; best = c; }
    }
    return best >= 0 ? [g.pos[best * 3], g.pos[best * 3 + 1], g.pos[best * 3 + 2]] : [0, 1, 0];
  }

  private crack(id: number, tick: number): CommandResult {
    const p = this.planet(id);
    if (!p) return { ok: false, msg: 'There is no such world.' };
    const R = p.snap.params.radius;
    const ring = p.snap.params.ring ?? { inner: R * 1.6, outer: R * 2.4, density: 0 };
    p.snap.params.ring = { inner: Math.min(ring.inner, R * 1.6), outer: Math.max(ring.outer, R * 2.4), density: Math.min(1, ring.density + 0.6) };
    p.snap.params.atmosphere.dust = (p.snap.params.atmosphere.dust ?? 0) + 0.25;
    if (p.snap.params.orbit.parent < 0) {
      for (let k = 0; k < 2; k++) {
        const mid = this.nextPlanet++;
        const a = R * (3.3 + 1.1 * k);
        const period = Math.round(240 * Math.pow(a / (R * 3.3), 1.5));
        this.host.addPlanet('moon', mid, `${p.snap.name} shard ${k + 1}`, 900 + mid, 12, 300 + 300 * k, { parent: id, a, e: 0.02, inc: 0.05 + 0.04 * k, phase0: 1.3 + 2.4 * k, period, node: 0.7 * k });
      }
    }
    this.events.push({ t: 'world.cracked', tick, planet: id, a: 0, b: 0, data: { moonlets: 2, ring: p.snap.params.ring } });
    return { ok: true, msg: `${p.snap.name} cracks (lookdev): a debris ring and two moonlets.`, tick };
  }

  private erase(id: number, tick: number): CommandResult {
    const p = this.planet(id);
    if (!p) return { ok: false, msg: 'There is no such world.' };
    this.erasing.set(id, 0);
    for (const q of this.host.planets()) if (q.snap.params.orbit.parent === id) this.erasing.set(q.snap.id, 0);
    this.events.push({ t: 'world.erased', tick, planet: id, a: 0 });
    return { ok: true, msg: `${p.snap.name} is gone (lookdev).`, tick };
  }

  private moonFall(host: number, moonId: number, life: number, tick: number): CommandResult {
    const h = this.planet(host);
    const moon = moonId >= 0 ? this.planet(moonId) : this.host.planets().find((q) => q.snap.params.orbit.parent === host);
    if (!h || !moon) return { ok: false, msg: 'No moon to drop.' };
    const o = moon.snap.params.orbit;
    this.falls.push({ moon: moon.snap.id, host, t0: tick, life: Math.max(60, life), a0: o.a, T0: o.period, id: 7000 + moon.snap.id });
    return { ok: true, msg: `${moon.snap.name} begins to fall toward ${h.snap.name} (lookdev).`, created: [{ kind: 'disaster', id: 7000 + moon.snap.id, planet: host }], tick };
  }

  private birth(kind: string, au: number, name: string, tick: number): CommandResult {
    const id = this.nextPlanet++;
    const a = Math.max(0.2, au) * 1.5e6;
    const period = Math.round(17280 * Math.pow(a / 1.5e6, 1.5));
    // put it where the camera can see it soon: ahead of the home world on its orbit
    const home = this.host.planets().find((p) => p.snap.params.orbit.parent < 0);
    const M = home ? home.snap.params.orbit.phase0 + (2 * Math.PI * tick) / home.snap.params.orbit.period : 0;
    const phase0 = M + 0.35 - (2 * Math.PI * tick) / period;
    this.host.addPlanet(kind, id, name || 'Nova', 4242 + id, kind === 'terran' ? 32 : 24, 1800 + 600 * hashFloat(id, 3), { parent: -1, a, e: 0.02, inc: 0.02, phase0, period, node: 0.4 });
    this.events.push({ t: 'world.born', tick, planet: id });
    return { ok: true, msg: `A new world is born (lookdev).`, created: [{ kind: 'planet', id }], tick };
  }

  // ── per snapshot ──

  /** ships, events, world changes and extra buildings for this snapshot (after the planets' own snapshots) */
  snapshot(tick: number, planets: PlanetSnap[]): { ships: ShipView[]; events: SimEvent[] } {
    this.tick = tick;
    // falling moons: the orbit shrinks toward a grazing one (faster at the end), the month by Kepler, no jump
    for (const f of this.falls.slice()) {
      const moon = this.planet(f.moon);
      const host = this.planet(f.host);
      const prog = Math.max(0, Math.min(1, (tick - f.t0) / f.life));
      if (!moon || !host) { this.falls = this.falls.filter((q) => q !== f); continue; }
      const o = moon.snap.params.orbit;
      const aEnd = host.snap.params.radius * 1.2 + moon.snap.params.radius;
      const a = f.a0 + (aEnd - f.a0) * prog * prog;
      const M = o.phase0 + (2 * Math.PI * tick) / o.period;
      o.a = a;
      o.period = Math.max(30, f.T0 * Math.pow(a / f.a0, 1.5));
      o.phase0 = M - (2 * Math.PI * tick) / o.period;
      const hs = planets.find((q) => q.id === f.host);
      // where it will strike: under the moon now
      const mc = this.center(f.moon, tick), hc = this.center(f.host, tick);
      const b = qRotateInv(this.quat(f.host, tick), norm3([mc[0] - hc[0], mc[1] - hc[1], mc[2] - hc[2]]));
      const dv: DisasterView = { id: f.id, kind: 'moon-fall', planet: f.host, pos: b, radius: 900, intensity: 1, progress: prog, frozen: false, params: { moonAlt: Math.round(a - host.snap.params.radius), alt: 60000 * (1 - prog), size: moon.snap.params.radius } };
      if (hs) hs.disasters = [...(hs.disasters ?? []).filter((d) => d.id !== f.id), dv];
      if (prog >= 1) {
        this.events.push({ t: 'impact', tick, planet: f.host, pos: b, a: 900, b: 1, data: { kind: 'moon-fall' } });
        this.falls = this.falls.filter((q) => q !== f);
        this.host.removePlanet(f.moon);
        if (hs) hs.disasters = (hs.disasters ?? []).filter((d) => d.id !== f.id);
      }
    }
    // erased worlds: one snapshot with alive = false, then gone
    for (const [id, sent] of [...this.erasing]) {
      const ps = planets.find((q) => q.id === id);
      if (ps) ps.alive = false;
      if (sent >= 1) { this.erasing.delete(id); this.host.removePlanet(id); } else this.erasing.set(id, sent + 1);
    }
    // extra buildings (pads, masts, gates), merged into the planet's block when they changed
    for (const ps of planets) {
      const ex = this.extras.get(ps.id);
      if (!ex || !ex.length) continue;
      const v = this.extrasVersion;
      if (!ps.buildings && this.sentVersion.get(ps.id) === v) continue;
      const base = ps.buildings ?? this.host.baseBuildings(ps.id);
      ps.buildings = mergeBlock(base, ex);
      this.sentVersion.set(ps.id, v);
    }
    const ships: ShipView[] = [];
    for (const m of this.missions) {
      const v = this.shipView(m, tick);
      if (v.phase !== m.lastPhase) {
        if (v.phase === 'ascent') this.events.push({ t: 'launch', tick, planet: m.from, pos: m.padPos, ref: { kind: 'ship', id: m.id } });
        if (v.phase === 'landed' && m.lastPhase) this.events.push({ t: 'arrival', tick, planet: m.to, pos: m.dest, ref: { kind: 'ship', id: m.id } });
        m.lastPhase = v.phase;
      }
      ships.push(v);
    }
    const events = this.events;
    this.events = [];
    return { ships, events };
  }
}

function mergeBlock(base: BuildingBlock | null, extra: { type: number; mat: number; pos: D3; rot: number; scale: number; settlement: number }[]): BuildingBlock {
  const n0 = base?.count ?? 0;
  const n = n0 + extra.length;
  const B: BuildingBlock = {
    count: n, id: new Uint32Array(n), type: new Uint16Array(n), material: new Uint8Array(n), style: new Uint8Array(n), pos: new Float32Array(n * 3),
    rot: new Float32Array(n), scale: new Float32Array(n), progress: new Float32Array(n), flags: new Uint16Array(n), light: new Uint16Array(n),
    settlement: new Int32Array(n), damage: new Float32Array(n),
  };
  if (base) {
    B.id.set(base.id.subarray(0, n0)); B.type.set(base.type.subarray(0, n0)); B.material.set(base.material.subarray(0, n0)); B.style.set(base.style.subarray(0, n0));
    B.pos.set(base.pos.subarray(0, n0 * 3)); B.rot.set(base.rot.subarray(0, n0)); B.scale.set(base.scale.subarray(0, n0)); B.progress.set(base.progress.subarray(0, n0));
    B.flags.set(base.flags.subarray(0, n0)); B.light.set(base.light.subarray(0, n0)); B.settlement.set(base.settlement.subarray(0, n0)); B.damage.set(base.damage.subarray(0, n0));
  }
  extra.forEach((e, k) => {
    const i = n0 + k;
    B.id[i] = 900000 + k; B.type[i] = e.type; B.material[i] = e.mat; B.style[i] = 0;
    B.pos[i * 3] = e.pos[0]; B.pos[i * 3 + 1] = e.pos[1]; B.pos[i * 3 + 2] = e.pos[2];
    B.rot[i] = e.rot; B.scale[i] = e.scale; B.progress[i] = 1; B.flags[i] = 0;
    // electric lamps on the pad and the mast
    B.light[i] = 4 * 256 + Math.round(0.8 * 255);
    B.settlement[i] = e.settlement; B.damage[i] = 0;
  });
  return B;
}
