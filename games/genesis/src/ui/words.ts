// GENESIS — places, durations and the sim's terse words as people read them (CONTRACT.md §1.6 "toasts that say what
// happened and why"; §16). DOM-free (tests/ui-logic.test.ts).
//
//   placeWords(view, planet, u)    a point on a world → "at Aru" / "near Aru" / "2 km west of Aru" / "12°N 34°E"
//   humanize(view, planet, text)   a result line from the sim → the same line with coordinates turned into places
//                                  ("Rain gathers at 4°N 177°E." → "Rain gathers near Aru."), durations in minutes into
//                                  hours, and the stray "the agent" into a name when one is known
//   stripYear(text)                "Year 4. Meteor shower over Selene" → "Meteor shower over Selene" (the header dates it)
//   fmtDuration(minutes)           "45 min" / "4 h" / "1.5 days"

import type { UnitVec } from '../sim/types.ts';

/** the little of the client mirror these helpers read (WorldView satisfies it) */
export interface WordsView {
  planet(id: number): { id: number; name?: string; grid?: { count: number }; params: { radius: number; dayHours?: number }; settlements: readonly { id: number; name: string; pos: ArrayLike<number>; flags: number }[] } | undefined;
}

const D2R = Math.PI / 180;

/** latitude / longitude (degrees) → body-frame unit vector (the inverse of fmtLatLon: lon = atan2(x, z)) */
export function unitOf(latDeg: number, lonDeg: number): UnitVec {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

export function latLonText(u: ArrayLike<number>): string {
  const lat = (Math.asin(Math.max(-1, Math.min(1, u[1]))) * 180) / Math.PI;
  const lon = (Math.atan2(u[0], u[2]) * 180) / Math.PI;
  return `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** the eight compass words, clockwise from north */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** the compass direction of `u` seen from `from` (both unit vectors on one sphere) */
export function bearingWord(from: ArrayLike<number>, u: ArrayLike<number>): string {
  const lat = Math.asin(Math.max(-1, Math.min(1, from[1])));
  const lon = Math.atan2(from[0], from[2]);
  const east = [Math.cos(lon), 0, -Math.sin(lon)];
  const north = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)];
  const v = [u[0] - from[0], u[1] - from[1], u[2] - from[2]];
  const b = Math.atan2(v[0] * east[0] + v[1] * east[1] + v[2] * east[2], v[0] * north[0] + v[1] * north[1] + v[2] * north[2]);
  const i = Math.round(((b / (Math.PI * 2)) * 8 + 8)) % 8;
  return COMPASS[i];
}

export interface Place {
  /** 'here' (the player's own point), 'at' / 'near' / 'off' a settlement, or bare coordinates */
  kind: 'here' | 'at' | 'near' | 'off' | 'coords';
  /** the settlement named, when there is one */
  name: string | null;
  /** distance to it (m) */
  dist: number;
  /** "at Aru", "near Aru", "2 km west of Aru", "here", "12°N 34°E" */
  text: string;
  /** the bare place without a preposition: "Aru", "2 km west of Aru", "here", "12°N 34°E" */
  bare: string;
}

function km(m: number): string {
  return m >= 950 ? `${(m / 1000).toFixed(m >= 9500 ? 0 : 1).replace(/\.0$/, '')} km` : `${Math.round(m / 50) * 50} m`;
}

/**
 * A point on a world in words, by the nearest living settlement: within a town's reach "at Aru", a little out "near
 * Aru", farther "2 km west of Aru"; on a world nobody lives on yet, its coordinates. `here` (the player's own point)
 * reads as "here".
 */
export function placeWords(view: WordsView, planet: number, u: ArrayLike<number>, here?: { planet: number; dir: ArrayLike<number> } | null): Place {
  const l = Math.hypot(u[0], u[1], u[2]) || 1;
  const n = [u[0] / l, u[1] / l, u[2] / l];
  const isHere = !!here && here.planet === planet && n[0] * here.dir[0] + n[1] * here.dir[1] + n[2] * here.dir[2] > Math.cos(0.004);
  const pv = view.planet(planet);
  let best: { name: string; pos: ArrayLike<number> } | null = null, bd = Infinity;
  if (pv) {
    const R = pv.params.radius;
    for (const s of pv.settlements) {
      if (s.flags & 2) continue; // fallen
      const d = Math.acos(Math.max(-1, Math.min(1, s.pos[0] * n[0] + s.pos[1] * n[1] + s.pos[2] * n[2]))) * R;
      if (d < bd) { bd = d; best = s; }
    }
  }
  // "here" on a town is the town (its name says more than "here")
  if (isHere && (!best || bd >= 400)) return { kind: 'here', name: null, dist: 0, text: 'here', bare: 'here' };
  if (!best) { const t = latLonText(n); return { kind: 'coords', name: null, dist: Infinity, text: `at ${t}`, bare: t }; }
  if (bd < 400) return { kind: 'at', name: best.name, dist: bd, text: `at ${best.name}`, bare: best.name };
  if (bd < 1200) return { kind: 'near', name: best.name, dist: bd, text: `near ${best.name}`, bare: best.name };
  const bare = `${km(bd)} ${bearingWord(best.pos, n)} of ${best.name}`;
  return { kind: 'off', name: best.name, dist: bd, text: bare, bare };
}

/** minutes → "45 min" / "4 h" / "1.5 days" (a day of `dayHours`) */
export function fmtDuration(min: number, dayHours = 24): string {
  if (!Number.isFinite(min)) return 'for ever';
  const day = dayHours * 60;
  if (min >= day * 1.5) return `${Number((min / day).toFixed(min >= day * 10 ? 0 : 1))} days`;
  if (min >= 60) return `${Number((min / 60).toFixed(min >= 600 ? 0 : 1))} h`;
  return `${Math.round(min)} min`;
}

/** "Year 4. Meteor shower…" → "Meteor shower…" (when a header already dates it) */
export function stripYear(text: string): string {
  const t = text.replace(/^Year \d+[.,:]\s+/, '');
  return t === text ? text : t.charAt(0).toUpperCase() + t.slice(1);
}

const COORD = /\b(?:(at|over|near|on|by|around|to|toward|towards)\s+)?(\d+(?:\.\d+)?)°\s?([NS])[ ,]+(\d+(?:\.\d+)?)°\s?([EW])\b/g;

/**
 * A line from the sim for people: coordinates become places, minutes become hours, "the agent" becomes a name when the
 * caller knows it ("You hurl the agent (16 m/s)." → "You hurl Kek (16 m/s).").
 */
export function humanize(view: WordsView, planet: number, text: string, opts: { name?: string | null; dayHours?: number } = {}): string {
  let t = text.replace(COORD, (_m, prep: string | undefined, la: string, ns: string, lo: string, ew: string) => {
    const u = unitOf(Number(la) * (ns === 'S' ? -1 : 1), Number(lo) * (ew === 'W' ? -1 : 1));
    const p = placeWords(view, planet, u);
    const pr = (prep ?? '').toLowerCase();
    if (p.kind === 'coords') {
      // nobody lives there yet: the world's name says where ("Meadow grass planted on Cinder"); a heading keeps its
      // coordinates (they are where it goes)
      const wn = view.planet(planet)?.name;
      return wn && pr && pr !== 'to' && pr !== 'toward' && pr !== 'towards' ? `${pr === 'over' ? 'over' : 'on'} ${wn}` : _m;
    }
    if (pr === 'to' || pr === 'toward' || pr === 'towards') return `${pr} ${p.bare}`;
    if (p.kind === 'off') return p.bare;
    // "over Aru" keeps its preposition when the place is the town itself; a little way out it is "near"
    if (pr === 'over' || pr === 'on') return p.kind === 'at' ? `${pr} ${p.bare}` : p.text;
    return p.text;
  });
  t = t.replace(/\((\d+(?:\.\d+)?) minutes?\)/g, (_m, n: string) => `(${fmtDuration(Number(n), opts.dayHours ?? 24)})`);
  t = t.replace(/\b(\d+(?:\.\d+)?) minutes\b/g, (m, n: string) => (Number(n) >= 60 ? fmtDuration(Number(n), opts.dayHours ?? 24) : m));
  // the sim's "138.89 days" / "2.333 hours": a number people say
  t = t.replace(/\b(\d+\.\d+) (days|hours)\b/g, (_m, n: string, u: string) => { const v = Number(n); return `${v >= 10 ? Math.round(v) : Number(v.toFixed(1))} ${u}`; });
  // "(31047 cells)": the world's own grid → an area people know
  const pv = view.planet(planet);
  if (pv?.grid && pv.grid.count > 0) {
    const cellM2 = (4 * Math.PI * pv.params.radius * pv.params.radius) / pv.grid.count;
    t = t.replace(/\b(\d[\d,]*) cells\b/g, (_m, n: string) => areaText(Number(n.replace(/,/g, '')) * cellM2));
  }
  if (opts.name) t = t.replace(/\bthe agent\b/g, opts.name).replace(/\bThe agent\b/g, opts.name);
  else t = t.replace(/\bthe agent\b/g, 'them').replace(/\bThe agent\b/g, 'They');
  return t;
}

/** square metres → "about 3 km²" / "40 ha" (a hectare is a field; a square kilometre a town's land) */
export function areaText(m2: number): string {
  if (!(m2 > 0)) return 'a little ground';
  if (m2 < 1e4) return `${Math.max(10, Math.round(m2 / 100) * 100).toLocaleString('en-US')} m²`;
  if (m2 < 1e6) return `${Math.round(m2 / 1e4)} ha`;
  const k = m2 / 1e6;
  return `${k >= 100 ? Math.round(k / 10) * 10 : k >= 10 ? Math.round(k) : Number(k.toFixed(1))} km²`.replace(/^(\d{4,})/, (d) => Number(d).toLocaleString('en-US'));
}

/** how many died / were ruined according to a result line ("44 killed", "3 dead", "12 buildings ruined") */
export function tollOf(text: string): { dead: number; ruined: number } {
  let dead = 0, ruined = 0;
  for (const m of text.matchAll(/(\d[\d,]*)\s+(?:people\s+|souls\s+)?(killed|dead|died|perish(?:ed)?|drowned|burned)/gi)) dead = Math.max(dead, Number(m[1].replace(/,/g, '')));
  for (const m of text.matchAll(/(\d[\d,]*)\s+(?:buildings?|houses?|homes?)\s+(?:ruined|destroyed|razed|flattened|burned)/gi)) ruined = Math.max(ruined, Number(m[1].replace(/,/g, '')));
  if (!dead && /\b(strike|struck) .* down\b|\bkills? (him|her|them)\b/i.test(text)) dead = 1;
  return { dead, ruined };
}
