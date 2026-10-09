// GENESIS — shaping powers the phase-1 brushes lacked (CONTRACT.md §11.1): paving (a region, or a road laid along the
// easiest way between two places) and the wind (the god sets it blowing from a quarter, over a region or the world).
//
// Paved cells hold road = 1 exactly: traffic wear only approaches 1 (people/roads.ts), so a cell at 1 is the god's road
// and does not fade when nobody walks it. The renderer picks the surface (dirt, cobble, paved) from the local era.
//
// The wind is a god-held state (GodState.winds), not a field rule: after each climate pass recomputes the prevailing
// wind (fields/climate.ts, hourly), windStep adds the god's wind on top of it — the base wind the weather systems drift
// on and the wind field that fire, sand and the weather overlay read — until it expires.

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { V3 } from './state.ts';
import { findPath } from '../grid/pathfind.ts';
import { isLand } from '../people/world.ts';
import { bearingDir, cellPos3, fail, ok, placeName, r3 } from './util.ts';
import { distM } from '../people/world.ts';
import { godAct } from './belief.ts';
import { actor } from './util.ts';

const aPos = (required = false): ParamSchema => ({ type: 'pos', required, desc: 'where (unit vector or lat/lon)' });

/** a god-held wind on one world (GodState.winds) */
export interface WindState {
  id: number;
  planet: number;
  /** where it blows FROM, degrees clockwise from north (meteorological) */
  from: number;
  /** m/s added to the prevailing wind */
  strength: number;
  /** centre and radius (m); radius <= 0 = the whole world */
  pos: V3 | null;
  radius: number;
  /** tick it dies (-1 = until changed) */
  until: number;
}

/** the winds laid on top of a world's base wind since its last climate pass, and the probe that tells a new pass */
export interface WindsOn {
  list: WindState[];
  probe: number;
}

/** compass words -> bearing (degrees from north) */
export const BEARINGS: Record<string, number> = { north: 0, northeast: 45, 'north-east': 45, east: 90, southeast: 135, 'south-east': 135, south: 180, southwest: 225, 'south-west': 225, west: 270, northwest: 315, 'north-west': 315 };

function bearingOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return ((v % 360) + 360) % 360;
  if (typeof v === 'string') { const b = BEARINGS[v.toLowerCase()]; if (b !== undefined) return b; const n = Number(v); if (Number.isFinite(n)) return ((n % 360) + 360) % 360; }
  return null;
}

/** lay a road on cells: road = 1 (the god's road; traffic never wears a cell quite to 1) */
export function pave(p: Planet, cells: Iterable<number>): number {
  const r = p.f.road;
  let n = 0;
  for (const c of cells) {
    if (!isLand(p, c) || p.f.water[c] > 0.3) continue;
    if (r[c] !== 1) { r[c] = 1; n++; }
  }
  if (n) { p.bump('road'); if (p.people) p.people.roadDirty = true; }
  return n;
}

/** the probe of a world's base wind: a few cells (a third of the way in, and each wind's centre) summed */
function probeOf(p: Planet, ws: WindState[]): number {
  const b = p.s.baseWindX, c = p.s.baseWindZ;
  let v = b[Math.floor(p.count / 3)] + c[Math.floor((p.count * 2) / 3)];
  for (const w of ws) if (w.pos) { const q = p.cellAt(w.pos); v += b[q] * 0.5 + c[q] * 0.25; }
  return v;
}

/** add (sign +1) or take away (-1) the winds' push from the base wind and the wind field */
function layWinds(p: Planet, ws: WindState[], sign: number): void {
  const s = p.s, f = p.f;
  const P = p.grid.pos;
  const pt: V3 = [0, 0, 0];
  for (let c = 0; c < p.count; c++) {
    pt[0] = P[c * 3]; pt[1] = P[c * 3 + 1]; pt[2] = P[c * 3 + 2];
    let bx = 0, by = 0, bz = 0;
    for (const w of ws) {
      let k = 1;
      if (w.pos && w.radius > 0) {
        const d = distM(p, pt, w.pos);
        if (d > w.radius * 1.5) continue;
        k = d <= w.radius ? 1 : 1 - (d - w.radius) / (w.radius * 0.5);
      }
      // it blows FROM `from`: toward the opposite bearing
      const dir = bearingDir(pt, ((w.from + 180) * Math.PI) / 180);
      const m = w.strength * k * sign;
      bx += dir[0] * m; by += dir[1] * m; bz += dir[2] * m;
    }
    if (bx === 0 && by === 0 && bz === 0) continue;
    s.baseWindX[c] += bx; s.baseWindY[c] += by; s.baseWindZ[c] += bz;
    f.windX[c] += bx; f.windY[c] += by; f.windZ[c] += bz;
  }
  p.bump('windX'); p.bump('windY'); p.bump('windZ');
}

function sameWinds(a: WindState[], b: WindState[]): boolean {
  return a.length === b.length && a.every((w, i) => w.id === b[i].id && w.strength === b[i].strength && w.from === b[i].from);
}

/**
 * Every tick (cheap when nothing changed): keep the god's winds laid on top of the prevailing wind. A climate pass
 * recomputes the base wind from scratch (the probe changes): the winds are laid on again. A wind added, changed or gone
 * between passes: the old push is taken away and the new one laid on. Expired winds are dropped.
 */
export function windStep(u: Universe): void {
  const g = u.god;
  if (!g.winds.length && !Object.keys(g.windsOn).length) return;
  if (g.winds.length) g.winds = g.winds.filter((w) => (w.until < 0 || w.until > u.tick) && !!u.planet(w.planet)?.alive);
  for (const p of u.planets) {
    const key = String(p.id);
    const on = g.windsOn[key];
    const ws = p.alive ? g.winds.filter((w) => w.planet === p.id) : [];
    if (!ws.length && !on) continue;
    if (!p.alive) { delete g.windsOn[key]; continue; }
    const fresh = !on || on.probe !== probeOf(p, on.list);
    if (!fresh && sameWinds(on!.list, ws)) continue;
    if (!fresh) layWinds(p, on!.list, -1);
    if (ws.length) {
      layWinds(p, ws, 1);
      g.windsOn[key] = { list: JSON.parse(JSON.stringify(ws)) as WindState[], probe: probeOf(p, ws) };
    } else delete g.windsOn[key];
  }
}

export function registerShapingCommands(r: CommandRegistry): void {
  r.register('terrain.pave', ({ u, p, cmd }, a) => {
    const from = a.pos!;
    let n = 0;
    let what: string;
    if (a.to) {
      const c0 = p.cellAt(from), c1 = p.cellAt(a.to as V3);
      const path: number[] = [];
      // (the way may wade through shallows: the road itself is laid only on dry land, a ford left where it crosses)
      const reached = findPath(p, c0, c1, { swim: 0.4, fly: false, maxExpand: 40000 }, path);
      const cells = new Set<number>([c0, ...path]);
      // a road wider than one cell takes the neighbours of its line too
      if ((a.width as number) > 1) {
        const g = p.grid;
        for (const c of [...cells]) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) cells.add(g.nbr[e]);
      }
      n = pave(p, [...cells].sort((q, w) => q - w));
      const len = Math.round(distM(p, from, a.to as V3));
      what = reached ? `A road is laid from ${placeName(p, from).replace(/^(on|near) /, '')} to ${placeName(p, a.to as V3).replace(/^(on|near) /, '')} (${n} cells, ~${len} m)` : `A road is laid ${placeName(p, from)} toward ${placeName(p, a.to as V3)} as far as the land allows (${n} cells)`;
    } else {
      // (at least the cell itself and its ring: a radius under a cell's width would pave nothing)
      const cells = new Set<number>(p.cellsNear(from, Math.max(a.radius as number, p.edgeM * 0.6)));
      const c0 = p.cellAt(from);
      cells.add(c0);
      if ((a.radius as number) >= p.edgeM * 0.5) { const g = p.grid; for (let e = g.nbrStart[c0]; e < g.nbrStart[c0 + 1]; e++) cells.add(g.nbr[e]); }
      n = pave(p, [...cells].sort((q, w) => q - w));
      what = `The ground is paved ${placeName(p, from)} (${n} cells)`;
    }
    if (!n) return fail(`There is no dry land ${placeName(p, from)} to pave (or it is paved already).`);
    godAct(u, p, from, 300, { wonder: 0.2, help: 0.15 }, actor(cmd));
    return ok(`${what}.`);
  }, {
    desc: 'Pave the ground of a region, or lay a road between two places', category: 'Shape',
    params: { pos: aPos(true), to: { type: 'pos', desc: 'lay a road from pos to here' }, radius: { type: 'number', min: 1, max: 20000, default: 120 }, width: { type: 'int', min: 1, max: 3, default: 1 } },
  });

  r.register('weather.wind', ({ u, p, cmd }, a) => {
    if (!p.airy) return fail(`${p.name} has no air: no wind can blow.`);
    const from = bearingOf(a.from);
    if (from === null) return fail('Blow from where? Give a quarter ("from the east") or a bearing in degrees.');
    const strength = a.strength as number;
    const g = u.god;
    const local = a.everywhere !== true && !!a.pos && a.radius !== undefined;
    // a new wind over the same place replaces the old one there
    g.winds = g.winds.filter((w) => !(w.planet === p.id && (local ? w.pos && distM(p, w.pos, a.pos!) < (a.radius as number) : !w.pos)));
    if (strength > 0) {
      const dur = a.duration as number;
      g.winds.push({ id: u.ids.alloc('wind'), planet: p.id, from, strength, pos: local ? [a.pos![0], a.pos![1], a.pos![2]] : null, radius: local ? (a.radius as number) : 0, until: dur < 0 ? -1 : u.tick + Math.round(dur) });
    }
    windStep(u);
    const quarter = Object.entries(BEARINGS).find(([k, b]) => b === Math.round(from / 45) * 45 % 360 && !k.includes('-'))?.[0] ?? `${r3(from)}°`;
    if (strength <= 0) return ok(`The god's wind over ${local ? placeName(p, a.pos!) : p.name} falls still; the winds are the world's own again.`);
    godAct(u, p, a.pos ?? null, 2000, { wonder: 0.15 }, actor(cmd));
    return ok(`A ${strength >= 20 ? 'gale' : strength >= 10 ? 'strong wind' : 'wind'} blows from the ${quarter} ${local ? placeName(p, a.pos!) : `over all of ${p.name}`} (${r3(strength)} m/s${(a.duration as number) < 0 ? ', until you change it' : ''}).`);
  }, {
    desc: 'Set the wind blowing from a quarter (over a region, or the whole world)', category: 'Sky',
    params: {
      from: { type: 'any', required: true, desc: 'where it blows from: north, east, ... or degrees from north' }, strength: { type: 'number', min: 0, max: 80, default: 12, desc: 'm/s' },
      duration: { type: 'number', min: -1, max: 1e7, default: 4320, desc: 'ticks (-1 = until changed)' }, pos: aPos(), radius: { type: 'number', min: 50, max: 20000 }, everywhere: { type: 'boolean', default: true },
    },
  });
  void cellPos3;
}
