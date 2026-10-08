// GENESIS — the parameter registry (CONTRACT.md §11.7): every tunable sim number by path, with range, unit, getter and
// setter. `set <path> <value>` (command and freeform fallback) and the "Laws of this world" inspector use it; later
// phases append entries (species.<id>.fertility, ...) with registerParam().
//
// Setters keep time continuous: changing the day length re-anchors the spin so the sun does not jump; changing the
// year length re-anchors the orbital phase so the season does not jump.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { meanAnomaly, spinAt, AU, spinForHour } from '../world/orbits.ts';
import { setStarKind, setStarLuminosity } from '../world/star.ts';
import { setGlobalWeather } from '../fields/weather.ts';

export type ParamKind = 'number' | 'boolean' | 'enum' | 'string';

export interface ParamDef {
  path: string;
  label: string;
  unit: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  /** enum choices (static or from content) */
  values?: (u: Universe) => string[];
  /** extra words the freeform parser may match */
  aliases?: string[];
  desc: string;
  get(u: Universe, p: Planet): number | boolean | string | null;
  /** apply a validated value; return a human-readable outcome */
  set(u: Universe, p: Planet, v: number | boolean | string | null): string;
}

const DEG = Math.PI / 180;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** re-anchor the spin at the current tick (call before changing dayHours / freezing) */
export function anchorSpin(u: Universe, p: Planet): void {
  const st = p.st;
  st.spin0 = spinAt(st.spin0, st.spinTick0, st.dayHours, st.sunFrozen, u.tick);
  st.spinTick0 = u.tick;
}

/** set the local hour at longitude 0 (the sun moves; everything that reads the sun follows) */
export function setHour(u: Universe, p: Planet, hour: number): void {
  const sun = u.sun(p, u.tick);
  const h24 = (hour / p.st.dayHours) * 24;
  p.st.spin0 = spinForHour(h24, sun.lon);
  p.st.spinTick0 = u.tick;
}

function atmo(key: 'pressure' | 'o2' | 'co2' | 'n2' | 'methane' | 'dust' | 'toxicity', label: string, unit: string, max: number, desc: string): ParamDef {
  return {
    path: `planet.atmosphere.${key}`, label, unit, kind: 'number', min: 0, max, desc, aliases: [key],
    get: (_u, p) => p.st.atmosphere[key],
    set: (u, p, v) => {
      const before = p.st.atmosphere.pressure;
      p.st.atmosphere[key] = Number(v);
      if (key === 'pressure') noteAir(u, p, before);
      return `${label} is now ${fmt(Number(v))}${unit ? ' ' + unit : ''}.`;
    },
  };
}

/** chronicle air arriving / leaving (shared with the atmosphere command) */
export function noteAir(u: Universe, p: Planet, before: number): void {
  const after = p.st.atmosphere.pressure;
  if (before < 0.02 && after >= 0.02) {
    if (p.firsts.air === undefined) {
      p.firsts.air = u.tick;
      u.chronicleAdd(p, 'god', 'Air came to the world.', 3);
    } else u.chronicleAdd(p, 'god', 'Air returned to the world.', 2);
  } else if (before >= 0.02 && after < 0.02) {
    u.chronicleAdd(p, 'god', 'The air bled away into the dark, and the sky went black.', 3);
  }
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 0.1 ? v.toFixed(2) : v.toPrecision(2);
}

function cfgNum(path: string, key: 'rainScale' | 'evaporation' | 'infiltration' | 'erosion' | 'fireSpread' | 'vegGrowth' | 'sandTransport' | 'lavaCooling' | 'weatherSpawn', label: string, max: number, desc: string): ParamDef {
  return {
    path, label, unit: '×', kind: 'number', min: 0, max, desc,
    get: (_u, p) => p.cfg[key],
    set: (_u, p, v) => { p.cfg[key] = Number(v); return `${label}: ${fmt(Number(v))}×.`; },
  };
}

export const PARAMS: ParamDef[] = [
  { path: 'planet.gravity', label: 'Gravity', unit: 'm/s²', kind: 'number', min: 0, max: 50, aliases: ['gravity'], desc: 'Surface gravity.',
    get: (_u, p) => p.st.gravity, set: (_u, p, v) => { p.st.gravity = Number(v); return `Gravity is now ${fmt(Number(v))} m/s².`; } },
  { path: 'planet.dayHours', label: 'Day length', unit: 'h', kind: 'number', min: 1, max: 2000, aliases: ['day length', 'day', 'rotation'], desc: 'Hours per rotation.',
    get: (_u, p) => p.st.dayHours,
    set: (u, p, v) => { anchorSpin(u, p); p.st.dayHours = Number(v); return `A day now lasts ${fmt(Number(v))} hours.`; } },
  { path: 'planet.axialTilt', label: 'Axial tilt', unit: '°', kind: 'number', min: 0, max: 180, aliases: ['tilt', 'obliquity'], desc: 'Tilt of the spin axis: the strength of the seasons.',
    get: (_u, p) => p.st.axialTilt / DEG,
    set: (_u, p, v) => { p.st.axialTilt = Number(v) * DEG; return `The axis leans ${fmt(Number(v))}°.`; } },
  { path: 'planet.yearDays', label: 'Year length', unit: 'days', kind: 'number', min: 0.5, max: 2000, aliases: ['year length', 'year'], desc: 'Days per orbit.',
    get: (_u, p) => p.st.orbit.period / (p.st.dayHours * 60),
    set: (u, p, v) => {
      const M = meanAnomaly(p.st.orbit, u.tick);
      p.st.orbit.period = Math.max(60, Number(v) * p.st.dayHours * 60);
      p.st.orbit.phase0 = M - (2 * Math.PI * u.tick) / p.st.orbit.period;
      return `A year now lasts ${fmt(Number(v))} days.`;
    } },
  { path: 'planet.seaLevel', label: 'Sea level', unit: 'm', kind: 'number', min: -3000, max: 3000, aliases: ['sea level', 'sea'], desc: 'Target level the seas relax toward.',
    get: (_u, p) => p.st.seaLevel,
    set: (_u, p, v) => { p.st.seaLevel = Number(v); return `The seas move toward ${fmt(Number(v))} m.`; } },
  { path: 'planet.magnetism', label: 'Magnetic field', unit: '×', kind: 'number', min: 0, max: 5, aliases: ['magnetism', 'magnetic field'], desc: 'Shield against the star; drives auroras.',
    get: (_u, p) => p.st.magnetism, set: (_u, p, v) => { p.st.magnetism = Number(v); return `The magnetic field is ${fmt(Number(v))}×.`; } },
  atmo('pressure', 'Air pressure', 'atm', 100, 'Surface pressure (0 = airless).'),
  atmo('o2', 'Oxygen', 'fraction', 1, 'Oxygen share of the air (fire needs it).'),
  atmo('co2', 'Carbon dioxide', 'fraction', 1, 'CO₂ share: greenhouse warming, plant food.'),
  atmo('n2', 'Nitrogen', 'fraction', 1, 'Nitrogen share of the air.'),
  atmo('methane', 'Methane', 'fraction', 1, 'Methane share: a strong greenhouse gas.'),
  atmo('dust', 'Aerosols', 'optical depth', 10, 'Dust and ash in the sky: dims the sun (impact winter).'),
  atmo('toxicity', 'Toxicity', '0..1', 1, 'Poison in the air (kills plants above 0.6).'),
  { path: 'planet.cloudiness', label: 'Cloudiness', unit: '0..1', kind: 'number', min: 0, max: 1, aliases: ['clouds'], desc: 'Global cloud bias.',
    get: (_u, p) => p.st.cloudiness, set: (_u, p, v) => { p.st.cloudiness = Number(v); return `Cloudiness ${fmt(Number(v))}.`; } },
  { path: 'planet.sunFrozen', label: 'Sun frozen', unit: '', kind: 'boolean', aliases: ['freeze sun', 'sun stands still'], desc: 'Stops the rotation: the sun stands still.',
    get: (_u, p) => p.st.sunFrozen,
    set: (u, p, v) => { anchorSpin(u, p); p.st.sunFrozen = !!v; return v ? 'The sun stands still.' : 'The sun moves again.'; } },
  { path: 'planet.seasonPinned', label: 'Pinned season', unit: '', kind: 'enum', values: () => ['none', ...SEASONS], aliases: ['season'], desc: 'Holds the sun at one season.',
    get: (_u, p) => (p.st.seasonPinned == null ? 'none' : SEASONS[p.st.seasonPinned]),
    set: (_u, p, v) => {
      const i = SEASONS.indexOf(String(v));
      p.st.seasonPinned = i >= 0 ? i : null;
      return i >= 0 ? `It will be ${SEASONS[i]} until you say otherwise.` : 'The seasons turn again.';
    } },
  { path: 'planet.hour', label: 'Hour at longitude 0', unit: 'h', kind: 'number', min: 0, max: 2000, aliases: ['hour', 'time of day'], desc: 'Moves the sun.',
    get: (u, p) => { const pp = p.paramsAt(u.tick, u.sun(p, u.tick).lon); return pp.hourAtLon0; },
    set: (u, p, v) => { setHour(u, p, Number(v)); return `The sun stands at hour ${fmt(Number(v))}.`; } },
  { path: 'star.luminosity', label: 'Star brightness', unit: '× sun', kind: 'number', min: 0, max: 10000, aliases: ['luminosity', 'brightness', 'star brightness'], desc: 'Light output of the star.',
    get: (u) => u.star.luminosity,
    set: (u, _p, v) => { const before = u.star.luminosity; setStarLuminosity(u.star, Number(v)); return Number(v) > before ? 'The star burns brighter.' : Number(v) < before ? 'The star dims.' : 'The star is unchanged.'; } },
  { path: 'star.kind', label: 'Star kind', unit: '', kind: 'enum', values: (u) => u.content.stars.ids(), aliases: ['star', 'star kind', 'spectral class'], desc: 'The kind of star (O B A F G K M, giants, dwarfs, black hole...).',
    get: (u) => u.star.def,
    set: (u, _p, v) => { setStarKind(u.star, u.content, String(v)); return `The star becomes a ${u.content.stars.get(u.star.def).name.toLowerCase()}.`; } },
  { path: 'star.activity', label: 'Star activity', unit: '0..1', kind: 'number', min: 0, max: 1, aliases: ['activity', 'flares'], desc: 'Flares and auroras.',
    get: (u) => u.star.activity, set: (u, _p, v) => { u.star.activity = Number(v); return `Star activity ${fmt(Number(v))}.`; } },
  { path: 'orbit.distance', label: 'Orbit distance', unit: 'AU', kind: 'number', min: 0.05, max: 40, aliases: ['distance', 'orbit'], desc: 'Distance from the star (1 AU = the home orbit).',
    get: (_u, p) => p.st.orbit.a / (p.st.orbit.parent >= 0 ? 1 : AU),
    set: (_u, p, v) => {
      if (p.st.orbit.parent >= 0) { p.st.orbit.a = Number(v) * AU * 0.01; return 'The moon swings to a new orbit.'; }
      p.st.orbit.a = Number(v) * AU;
      return `The world now circles the star at ${fmt(Number(v))} AU.`;
    } },
  { path: 'orbit.eccentricity', label: 'Orbit eccentricity', unit: '', kind: 'number', min: 0, max: 0.9, aliases: ['eccentricity'], desc: 'How oval the orbit is.',
    get: (_u, p) => p.st.orbit.e, set: (_u, p, v) => { p.st.orbit.e = Number(v); return `Eccentricity ${fmt(Number(v))}.`; } },
  { path: 'climate.offset', label: 'Temperature offset', unit: '°C', kind: 'number', min: -150, max: 150, aliases: ['temperature', 'temperature offset', 'warmth'], desc: 'Warms or cools the whole world.',
    get: (_u, p) => p.st.climateOffset, set: (_u, p, v) => { p.st.climateOffset = Number(v); return `The world is ${Number(v) >= 0 ? 'warmed' : 'cooled'} by ${fmt(Math.abs(Number(v)))} °C.`; } },
  { path: 'climate.freeze', label: 'Freezing and melting', unit: '', kind: 'boolean', desc: 'Snow and ice melt and freeze with temperature.',
    get: (_u, p) => p.cfg.freeze, set: (_u, p, v) => { p.cfg.freeze = !!v; return v ? 'Water freezes and thaws.' : 'Ice and snow hold where they are.'; } },
  { path: 'weather.global', label: 'Planet-wide weather', unit: '', kind: 'enum', values: (u) => ['none', ...u.content.weather.ids()], aliases: ['global weather', 'weather'], desc: 'One weather everywhere.',
    get: (_u, p) => p.st.globalWeather ?? 'none',
    set: (u, p, v) => { setGlobalWeather(u, p, v === 'none' || v === null ? null : String(v)); return p.st.globalWeather ? `${u.content.weather.get(p.st.globalWeather).name} everywhere.` : 'The weather is its own again.'; } },
  cfgNum('weather.spawn', 'weatherSpawn', 'Weather activity', 10, 'How often weather systems form on their own.'),
  cfgNum('hydro.rainScale', 'rainScale', 'Rain strength', 20, 'How much rain reaches the ground.'),
  cfgNum('hydro.evaporation', 'evaporation', 'Evaporation', 10, 'How fast standing water evaporates or boils.'),
  cfgNum('hydro.infiltration', 'infiltration', 'Infiltration', 10, 'How fast water soaks into the ground.'),
  cfgNum('hydro.erosion', 'erosion', 'Erosion', 10, 'How fast running water carves the land.'),
  { path: 'hydro.oceanRelax', label: 'Sea level holds', unit: '', kind: 'boolean', desc: 'The seas relax toward the sea level.',
    get: (_u, p) => p.cfg.oceanRelax, set: (_u, p, v) => { p.cfg.oceanRelax = !!v; return v ? 'The seas keep their level.' : 'The seas are left to themselves.'; } },
  cfgNum('fire.spread', 'fireSpread', 'Fire spread', 10, 'How readily fire spreads.'),
  cfgNum('vegetation.growth', 'vegGrowth', 'Plant growth', 10, 'How fast plants grow and spread.'),
  cfgNum('terrain.sandTransport', 'sandTransport', 'Sand drift', 10, 'How far the wind carries sand.'),
  cfgNum('terrain.lavaCooling', 'lavaCooling', 'Lava cooling', 10, 'How fast lava turns to rock.'),
  { path: 'sim.maxAgents', label: 'Individual cap', unit: 'agents', kind: 'number', min: 0, max: 20000, desc: 'People simulated individually per planet (beyond: cohorts).',
    get: (u) => u.settings.maxAgents, set: (u, _p, v) => { u.settings.maxAgents = Math.round(Number(v)); return `Up to ${u.settings.maxAgents} individuals per world.`; } },
  { path: 'sim.restraint', label: 'Restraint', unit: '', kind: 'boolean', desc: 'Worship costs and cooldowns for god powers.',
    get: (u) => u.settings.restraint, set: (u, _p, v) => { u.settings.restraint = !!v; return v ? 'Restraint: your powers now cost worship.' : 'Omnipotence restored.'; } },
];

const byPath = new Map<string, ParamDef>();
for (const d of PARAMS) byPath.set(d.path, d);

/** add a parameter (later phases: species.<id>.*, ...) */
export function registerParam(d: ParamDef): void {
  const i = PARAMS.findIndex((x) => x.path === d.path);
  if (i >= 0) PARAMS[i] = d;
  else PARAMS.push(d);
  byPath.set(d.path, d);
}

/** exact path, a path suffix ('gravity' -> planet.gravity) or an alias */
export function findParam(path: string): ParamDef | undefined {
  const k = path.trim().toLowerCase();
  const exact = byPath.get(path.trim());
  if (exact) return exact;
  for (const d of PARAMS) if (d.path.toLowerCase() === k) return d;
  for (const d of PARAMS) if (d.path.toLowerCase().endsWith('.' + k)) return d;
  for (const d of PARAMS) if (d.aliases?.some((a) => a.toLowerCase() === k)) return d;
  for (const d of PARAMS) if (d.label.toLowerCase() === k) return d;
  return undefined;
}

/** validate + coerce a value for a parameter; returns [value] or an error message */
export function coerceParam(u: Universe, d: ParamDef, raw: unknown): { ok: true; v: number | boolean | string | null } | { ok: false; msg: string } {
  if (d.kind === 'number') {
    let x = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
    if (!Number.isFinite(x)) return { ok: false, msg: `${d.label} needs a number${d.unit ? ' (' + d.unit + ')' : ''}.` };
    if (d.min !== undefined && x < d.min) return { ok: false, msg: `${d.label} must be at least ${d.min}${d.unit ? ' ' + d.unit : ''}.` };
    if (d.max !== undefined && x > d.max) return { ok: false, msg: `${d.label} must be at most ${d.max}${d.unit ? ' ' + d.unit : ''}.` };
    if (Object.is(x, -0)) x = 0;
    return { ok: true, v: x };
  }
  if (d.kind === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, v: raw };
    const s = String(raw).toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(s)) return { ok: true, v: true };
    if (['false', 'off', 'no', '0'].includes(s)) return { ok: true, v: false };
    return { ok: false, msg: `${d.label} is on or off.` };
  }
  if (d.kind === 'enum') {
    const vals = d.values ? d.values(u) : [];
    const s = raw === null ? 'none' : String(raw);
    const hit = vals.find((x) => x.toLowerCase() === s.toLowerCase());
    if (!hit) return { ok: false, msg: `${d.label} must be one of: ${vals.join(', ')}.` };
    return { ok: true, v: hit };
  }
  return { ok: true, v: raw === null ? null : String(raw) };
}

/** the registry with current values for a planet (inspector "Laws of this world") */
export function listParams(u: Universe, p: Planet): { path: string; label: string; unit: string; kind: ParamKind; min?: number; max?: number; values?: string[]; value: unknown; desc: string }[] {
  return PARAMS.map((d) => ({
    path: d.path, label: d.label, unit: d.unit, kind: d.kind, min: d.min, max: d.max,
    values: d.values ? d.values(u) : undefined, value: d.get(u, p), desc: d.desc,
  }));
}
