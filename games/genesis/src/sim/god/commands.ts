// GENESIS — the command registry (CONTRACT.md §11.1): register(kind, handler, schema) + dispatch.
//
// Everything the player does is a Command { k, ...params }. The registry validates parameters against the schema
// (types, ranges, enums from content, positions given as `pos` unit vector, `lat`/`lon` degrees, a `cell` index or the
// camera focus), then runs the handler, which returns a CommandResult with a human-readable message. powers.json, the
// palette, the radial menu and the freeform parser (phase 3) are generated from this registry, so a new power is data
// plus — if needed — one handler.
//
// Phase-1 kinds: terrain.* brushes, water.*, weather.*, time.*, planet.atmosphere / add-air / remove-air, star.set,
// planet.set, life.plant / forest / paint-biome / pin-biome, fire.ignite / extinguish, set (any parameter), focus,
// freeform (minimal parser until phase 3). Phase 2 (people/commands.ts): life.spawn-people / spawn-animal, agent.*,
// idea.teach, settlement.gift / introduce / withdraw / rename / found / raze.

import type { Command, CommandResult, EntityRef, UnitVec } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { fromLatLon } from '../core/vec3.ts';
import { brush, MATERIALS, type BrushKind } from '../fields/terrain.ts';
import { addWater, drainWater, waterImpulse } from '../fields/hydrology.ts';
import { clearWeather, paintWeather, setGlobalWeather } from '../fields/weather.ts';
import { extinguishArea, igniteArea } from '../fields/fire.ts';
import { forestArea, plantArea } from '../fields/vegetation.ts';
import { resetClimateMemory } from '../fields/climate.ts';
import { paintBiome, pinBiome } from '../fields/biomes.ts';
import { anchorSpin, coerceParam, findParam, fmt, noteAir, setHour } from './params.ts';
import { setStarKind, setStarLuminosity } from '../world/star.ts';
import { AU } from '../world/orbits.ts';
import { suggest } from '../content.ts';
import { registerPeopleCommands, focusHook } from '../people/commands.ts';

export type ParamType = 'number' | 'int' | 'string' | 'boolean' | 'pos' | 'vec3' | 'enum' | 'any';

export interface ParamSchema {
  type: ParamType;
  required?: boolean;
  min?: number;
  max?: number;
  default?: unknown;
  /** enum choices: static list or from content */
  values?: readonly string[] | ((u: Universe) => string[]);
  desc?: string;
}

export interface CommandSchema {
  desc: string;
  /** UI grouping for palettes (Shape, Water, Sky, Life, Fire, Time, Worlds, Meta) */
  category: string;
  params: Record<string, ParamSchema>;
}

export interface CmdCtx {
  u: Universe;
  p: Planet;
  cmd: Command;
}

/** validated, coerced arguments (positions resolved to unit vectors) */
export type Args = Record<string, unknown> & { pos?: UnitVec | null };

export type Handler = (ctx: CmdCtx, a: Args) => CommandResult;

interface Entry {
  kind: string;
  handler: Handler;
  schema: CommandSchema;
}

export class CommandRegistry {
  private entries = new Map<string, Entry>();

  register(kind: string, handler: Handler, schema: CommandSchema): void {
    this.entries.set(kind, { kind, handler, schema });
  }

  has(kind: string): boolean {
    return this.entries.has(kind);
  }

  kinds(): string[] {
    return [...this.entries.keys()];
  }

  schema(kind: string): CommandSchema | undefined {
    return this.entries.get(kind)?.schema;
  }

  /** check a command without running it */
  validate(u: Universe, cmd: Command): { ok: true; args: Args; p: Planet } | { ok: false; msg: string } {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.k !== 'string') return { ok: false, msg: 'A command needs a kind ("k").' };
    const e = this.entries.get(cmd.k);
    if (!e) {
      const hint = suggest(cmd.k, this.kinds());
      return { ok: false, msg: `I do not know how to '${cmd.k}'.${hint ? ` Did you mean '${hint}'?` : ''}` };
    }
    const p = u.planetFor(cmd.planet);
    if (!p) return { ok: false, msg: typeof cmd.planet === 'number' ? `There is no world #${cmd.planet}.` : 'There is no world to act on.' };
    if (!p.alive) return { ok: false, msg: `${p.name} is gone.` };
    const args: Args = {};
    for (const [name, sc] of Object.entries(e.schema.params)) {
      const r = coerce(u, p, cmd, name, sc);
      if (!r.ok) return { ok: false, msg: `${cmd.k}: ${r.msg}` };
      if (r.v !== undefined) args[name] = r.v;
    }
    return { ok: true, args, p };
  }

  /** validate and run */
  dispatch(u: Universe, cmd: Command): CommandResult {
    const v = this.validate(u, cmd);
    if (!v.ok) return { ok: false, msg: v.msg, tick: u.tick };
    const e = this.entries.get(cmd.k)!;
    let res: CommandResult;
    try {
      res = e.handler({ u, p: v.p, cmd }, v.args);
    } catch (err) {
      res = { ok: false, msg: `${cmd.k} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    res.tick = u.tick;
    if (res.ok) u.emit({ t: 'command', planet: v.p.id, text: res.msg, data: { k: cmd.k } });
    return res;
  }
}

function coerce(u: Universe, p: Planet, cmd: Command, name: string, sc: ParamSchema): { ok: true; v: unknown } | { ok: false; msg: string } {
  if (sc.type === 'pos') {
    const pos = resolvePos(u, p, cmd, name);
    if (pos === undefined) {
      if (sc.required) return { ok: false, msg: `needs a place (${name}: a unit vector, or lat/lon in degrees).` };
      return { ok: true, v: null };
    }
    if (pos === null) return { ok: false, msg: `'${name}' is not a valid place.` };
    return { ok: true, v: pos };
  }
  let raw = cmd[name];
  if (raw === undefined || raw === null) {
    if (sc.required && sc.default === undefined) return { ok: false, msg: `'${name}' is required${sc.desc ? ` (${sc.desc})` : ''}.` };
    return { ok: true, v: raw === null && sc.type !== 'number' ? null : sc.default };
  }
  switch (sc.type) {
    case 'number':
    case 'int': {
      let x = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(x)) return { ok: false, msg: `'${name}' must be a number.` };
      if (sc.type === 'int') x = Math.round(x);
      if (sc.min !== undefined && x < sc.min) return { ok: false, msg: `'${name}' must be at least ${sc.min} (got ${fmt(x)}).` };
      if (sc.max !== undefined && x > sc.max) return { ok: false, msg: `'${name}' must be at most ${sc.max} (got ${fmt(x)}).` };
      return { ok: true, v: x };
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { ok: true, v: raw };
      if (raw === 'true' || raw === 'on' || raw === 1) return { ok: true, v: true };
      if (raw === 'false' || raw === 'off' || raw === 0) return { ok: true, v: false };
      return { ok: false, msg: `'${name}' must be true or false.` };
    case 'string':
      return { ok: true, v: String(raw) };
    case 'enum': {
      const vals = typeof sc.values === 'function' ? sc.values(u) : sc.values ?? [];
      const s = String(raw);
      const hit = vals.find((x) => x.toLowerCase() === s.toLowerCase());
      if (!hit) {
        const hint = suggest(s, [...vals]);
        return { ok: false, msg: `'${s}' is not a known ${name}${hint ? ` — did you mean '${hint}'?` : ` (one of: ${vals.slice(0, 12).join(', ')}${vals.length > 12 ? ', …' : ''})`}.` };
      }
      return { ok: true, v: hit };
    }
    case 'vec3': {
      if (!Array.isArray(raw) || raw.length !== 3 || raw.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return { ok: false, msg: `'${name}' must be [x, y, z].` };
      return { ok: true, v: [raw[0], raw[1], raw[2]] };
    }
    default:
      return { ok: true, v: raw };
  }
}

/** a place from `name` (unit vector), lat/lon (degrees), a cell index, or the camera focus; undefined = none given */
function resolvePos(u: Universe, p: Planet, cmd: Command, name: string): UnitVec | null | undefined {
  const raw = cmd[name];
  if (Array.isArray(raw)) {
    if (raw.length !== 3 || raw.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
    const l = Math.hypot(raw[0], raw[1], raw[2]);
    if (l < 1e-9) return null;
    return [raw[0] / l, raw[1] / l, raw[2] / l];
  }
  if (name === 'pos') {
    if (typeof cmd.lat === 'number' && typeof cmd.lon === 'number') {
      const v: UnitVec = [0, 0, 0];
      fromLatLon(v, (cmd.lat * Math.PI) / 180, (cmd.lon * Math.PI) / 180);
      return v;
    }
    if (typeof cmd.cell === 'number' && cmd.cell >= 0 && cmd.cell < p.count) {
      const c = Math.floor(cmd.cell);
      return [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];
    }
    if (u.focus && u.focus.planet === p.id) return [...u.focus.pos] as UnitVec;
  }
  return raw === undefined ? undefined : null;
}

// ───────────────────────────── phase-1 commands ─────────────────────────────

const R_DEFAULT = 250;
const pos = (required = true): ParamSchema => ({ type: 'pos', required, desc: 'where (unit vector or lat/lon)' });
const radius = (def = R_DEFAULT): ParamSchema => ({ type: 'number', min: 1, max: 20000, default: def, desc: 'radius in metres' });
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

function ok(msg: string, created?: EntityRef[]): CommandResult {
  const r: CommandResult = { ok: true, msg };
  if (created) r.created = created;
  return r;
}
function fail(msg: string): CommandResult {
  return { ok: false, msg };
}

function where(p: Planet, pos: UnitVec | null | undefined): string {
  if (!pos) return `on ${p.name}`;
  const lat = (Math.asin(Math.max(-1, Math.min(1, pos[1]))) * 180) / Math.PI;
  const lon = (Math.atan2(pos[0], pos[2]) * 180) / Math.PI;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `at ${Math.abs(lat).toFixed(0)}°${ns} ${Math.abs(lon).toFixed(0)}°${ew}`;
}

function airPhrase(p: Planet): string {
  const P = p.st.atmosphere.pressure;
  return P < 0.02 ? 'no air' : P < 0.3 ? 'thin air' : P < 2 ? 'breathable thickness' : 'a heavy, crushing sky';
}

export function buildRegistry(): CommandRegistry {
  const r = new CommandRegistry();

  // terrain brushes. Each has its own strength schema because the palette / radial UI builds its sliders from it and
  // the numbers mean different things: metres for raise / lower / noise, a 0..1 blend for flatten / smooth, a depth
  // multiplier for craters (1 = a natural crater of that size). brush() additionally caps any single height change at
  // 0.3 × the planet radius and keeps the ground within ±0.5 × radius of the datum.
  const brushKinds: [BrushKind, string, ParamSchema][] = [
    ['raise', 'Raise the land', { type: 'number', min: 0, max: 1000, default: 15, desc: 'metres at the centre' }],
    ['lower', 'Lower the land', { type: 'number', min: 0, max: 1000, default: 15, desc: 'metres at the centre' }],
    ['flatten', 'Flatten the land', { type: 'number', min: 0, max: 1, default: 0.8, desc: 'blend toward the level, 0..1' }],
    ['smooth', 'Smooth the land', { type: 'number', min: 0, max: 1, default: 0.8, desc: 'blend toward the neighbours, 0..1' }],
    ['noise', 'Roughen the land', { type: 'number', min: 0, max: 500, default: 20, desc: 'relief amplitude in metres' }],
    ['crater', 'Blast a crater', { type: 'number', min: 0.05, max: 5, default: 1, desc: 'depth multiplier (1 = natural)' }],
  ];
  for (const [kind, desc, strength] of brushKinds) {
    r.register(`terrain.${kind}`, ({ u, p }, a) => {
      const n = brush(u, p, kind, a.pos!, a.radius as number, a.strength as number, { height: a.height as number | undefined, frequency: a.frequency as number | undefined });
      return ok(`${desc.replace(/^(\w)/, (m) => m)} ${where(p, a.pos)} (${n} cells).`);
    }, {
      desc, category: 'Shape',
      params: {
        pos: pos(), radius: radius(), strength,
        ...(kind === 'flatten' ? { height: { type: 'number', min: -2000, max: 2000, desc: 'target height (m); default: the ground at the centre' } as ParamSchema } : {}),
        ...(kind === 'noise' ? { frequency: { type: 'number', min: 0.1, max: 50, desc: 'bumps per radius' } as ParamSchema } : {}),
      },
    });
  }
  r.register('terrain.mountain-range', ({ u, p }, a) => {
    const to = (a.to as UnitVec | null) ?? null;
    const n = brush(u, p, 'mountain-range', a.pos!, a.radius as number, a.height as number, { to: to ?? a.pos! });
    return ok(`A mountain range rises ${where(p, a.pos)} (${n} cells).`);
  }, {
    desc: 'Raise a mountain range along a line', category: 'Shape',
    params: { pos: pos(), to: { type: 'pos', desc: 'end of the range' }, radius: radius(220), height: { type: 'number', min: 1, max: 1000, default: 260 } },
  });
  r.register('terrain.dig-sea', ({ u, p }, a) => {
    const n = brush(u, p, 'dig-sea', a.pos!, a.radius as number, a.depth as number, { depth: a.depth as number });
    const depth = Math.min(a.depth as number, 0.3 * p.st.radius);
    return ok(`A sea is dug ${where(p, a.pos)}, ${fmt(depth)} m deep (${n} cells).`);
  }, { desc: 'Dig a sea basin', category: 'Shape', params: { pos: pos(), radius: radius(500), depth: { type: 'number', min: 1, max: 1000, default: 40 } } });
  r.register('terrain.river', ({ u, p }, a) => {
    if (!a.to && p.s.ocean[p.cellAt(a.pos!)]) return fail('That place already lies in the sea: start a river on higher ground.');
    const n = brush(u, p, 'river', a.pos!, a.radius as number, a.depth as number, { to: (a.to as UnitVec | null) ?? undefined });
    return ok(`A river bed is carved ${where(p, a.pos)} (${n} cells) and a spring wells up at its head.`);
  }, { desc: 'Carve a river path', category: 'Water', params: { pos: pos(), to: { type: 'pos' }, radius: radius(60), depth: { type: 'number', min: 0.2, max: 50, default: 2.5 } } });
  r.register('terrain.paint-material', ({ u, p }, a) => {
    const n = brush(u, p, 'paint-material', a.pos!, a.radius as number, a.depth as number, { material: a.material as (typeof MATERIALS)[number] });
    return ok(`${a.material} ${(a.depth as number) >= 0 ? 'laid' : 'stripped'} ${where(p, a.pos)} (${n} cells).`);
  }, {
    desc: 'Paint a material layer', category: 'Shape',
    params: { pos: pos(), radius: radius(), material: { type: 'enum', values: MATERIALS, default: 'soil' }, depth: { type: 'number', min: -100, max: 500, default: 0.5 } },
  });

  // water
  r.register('water.add', ({ p }, a) => {
    const R = a.radius as number;
    const vol = (a.volume as number | undefined) ?? (a.depth as number) * Math.PI * R * R;
    const v = addWater(p, a.pos!, R, vol);
    return ok(`Water pours ${where(p, a.pos)} (${fmt(v)} m³).`);
  }, { desc: 'Pour water', category: 'Water', params: { pos: pos(), radius: radius(), volume: { type: 'number', min: 0, max: 1e12 }, depth: { type: 'number', min: 0, max: 1000, default: 2 } } });
  r.register('water.remove', ({ p }, a) => {
    const R = a.radius as number;
    const vol = (a.volume as number | undefined) ?? 1e15;
    const v = addWater(p, a.pos!, R, -vol);
    return ok(`Water is taken up ${where(p, a.pos)} (${fmt(-v)} m³).`);
  }, { desc: 'Take water away', category: 'Water', params: { pos: pos(), radius: radius(), volume: { type: 'number', min: 0, max: 1e15 } } });
  r.register('water.drain', ({ p }, a) => {
    const v = drainWater(p, a.pos!, a.radius as number);
    return ok(`The ground drinks ${fmt(v)} m³ ${where(p, a.pos)}.`);
  }, { desc: 'Drain all water in a region', category: 'Water', params: { pos: pos(), radius: radius() } });
  r.register('water.rain', ({ u, p }, a) => {
    if (!p.airy) return fail(`${p.name} has no air: rain cannot fall. Add air first.`);
    const I = a.intensity as number;
    const kind = I >= 2 ? 'monsoon' : I >= 1.3 ? 'storm' : 'rain';
    const w = paintWeather(u, p, kind, a.pos!, a.radius as number, a.duration as number, Math.min(1.5, I), false);
    return w ? ok(`Rain gathers ${where(p, a.pos)}.`, [{ kind: 'weather', id: w.id, planet: p.id }]) : fail('No rain kind is defined.');
  }, { desc: 'Make it rain', category: 'Water', params: { pos: pos(), radius: radius(600), duration: { type: 'number', min: 10, max: 1e6, default: 720 }, intensity: { type: 'number', min: 0.1, max: 3, default: 1 } } });
  r.register('water.flood', ({ p }, a) => {
    const v = waterImpulse(p, a.pos!, a.radius as number, a.height as number, null, -1);
    return ok(`A flood bursts out ${where(p, a.pos)} (${fmt(v)} m³).`);
  }, { desc: 'Flood a region', category: 'Water', params: { pos: pos(), radius: radius(300), height: { type: 'number', min: 0.1, max: 200, default: 4 } } });
  r.register('water.tsunami', ({ p }, a) => {
    let dir: UnitVec | null = null;
    if (a.toward) {
      const t = a.toward as UnitVec, c = a.pos!;
      const d = t[0] * c[0] + t[1] * c[1] + t[2] * c[2];
      dir = [t[0] - c[0] * d, t[1] - c[1] * d, t[2] - c[2] * d];
    } else if (a.dir) dir = a.dir as UnitVec;
    const v = waterImpulse(p, a.pos!, a.radius as number, a.height as number, dir, -1);
    return ok(`A wall of water rises ${where(p, a.pos)} and runs ${dir ? 'toward the shore' : 'outward'} (${fmt(v)} m³).`);
  }, {
    desc: 'Raise a tsunami', category: 'Water',
    params: { pos: pos(), radius: radius(350), height: { type: 'number', min: 0.5, max: 300, default: 12 }, toward: { type: 'pos' }, dir: { type: 'vec3' } },
  });
  r.register('water.sea-level', ({ p }, a) => {
    const before = p.st.seaLevel;
    let v = a.value as number | undefined;
    if (v === undefined) v = before + ((a.delta as number | undefined) ?? 0);
    p.st.seaLevel = Math.max(-5000, Math.min(5000, v));
    const up = p.st.seaLevel > before;
    if (p.st.seaLevel === before) return ok(`The sea stays at ${fmt(before)} m.`);
    return ok(`The seas ${up ? 'rise' : 'fall'} toward ${fmt(p.st.seaLevel)} m.`);
  }, { desc: 'Set the sea level', category: 'Water', params: { value: { type: 'number', min: -5000, max: 5000 }, delta: { type: 'number', min: -5000, max: 5000 } } });
  r.register('water.spring', ({ u, p }, a) => {
    const c = p.cellAt(a.pos!);
    const id = u.ids.alloc('spring');
    const rate = (a.rate as number) * 2; // m³ per tick -> per hydrology step
    p.springs.push({ id, cell: c, rate, life: (a.duration as number) > 0 ? Math.round(a.duration as number) : -1 });
    return ok(`A spring wells up ${where(p, a.pos)}.`);
  }, { desc: 'Open a spring', category: 'Water', params: { pos: pos(), rate: { type: 'number', min: 0.1, max: 1e6, default: 40, desc: 'm³ per tick' }, duration: { type: 'number', min: -1, max: 1e9, default: -1 } } });

  // weather
  const kinds = (u: Universe) => u.content.weather.ids();
  r.register('weather.paint', ({ u, p }, a) => {
    if (!p.airy && a.kind !== 'no-atmosphere') return fail(`${p.name} has no air: weather needs an atmosphere.`);
    const w = paintWeather(u, p, a.kind as string, a.pos!, a.radius as number, a.duration as number, a.intensity as number, a.pinned as boolean);
    if (!w) return fail(`Unknown weather '${a.kind}'.`);
    return ok(`${u.content.weather.get(a.kind as string).name} ${where(p, a.pos)}${a.pinned ? ', held there' : ''}.`, [{ kind: 'weather', id: w.id, planet: p.id }]);
  }, {
    desc: 'Paint weather onto a region', category: 'Sky',
    params: {
      kind: { type: 'enum', values: kinds, required: true }, pos: pos(), radius: radius(700),
      duration: { type: 'number', min: -1, max: 1e9, default: 720 }, intensity: { type: 'number', min: 0, max: 3, default: 1 },
      pinned: { type: 'boolean', default: false },
    },
  });
  r.register('weather.global', ({ u, p }, a) => {
    const k = (a.kind as string | null) ?? null;
    const kind = k === 'none' ? null : k;
    if (kind && !p.airy && kind !== 'no-atmosphere') return fail(`${p.name} has no air for weather.`);
    setGlobalWeather(u, p, kind);
    return ok(kind ? `${u.content.weather.get(kind).name} over all of ${p.name}.` : `${p.name}'s weather is its own again.`);
  }, { desc: 'One weather over the whole world', category: 'Sky', params: { kind: { type: 'enum', values: (u) => ['none', ...kinds(u)], default: null } } });
  r.register('weather.clear', ({ u, p }, a) => {
    // `pos` falls back to the camera focus like every place, so "everywhere" must be asked for explicitly (or no place
    // can be resolved at all, e.g. from a script with no focus)
    const all = a.everywhere === true || !a.pos;
    const n = clearWeather(u, p, all ? null : a.pos!, a.radius as number);
    const sys = `${n} weather system${n === 1 ? '' : 's'} dispersed`;
    if (all) {
      const g = p.st.globalWeather;
      if (g) setGlobalWeather(u, p, null);
      const gName = g ? u.content.weather.find(g)?.name.toLowerCase() ?? g : null;
      if (!n && !gName) return ok(`The skies over ${p.name} are already clear.`);
      return ok(`The skies clear over all of ${p.name}${gName ? `: the planet-wide ${gName} lifts` : ''}${n ? `${gName ? ' and' : ':'} ${sys}` : ''}.`);
    }
    return ok(n ? `The skies clear ${where(p, a.pos)} (${sys}).` : `No weather system is centred within ${fmt(a.radius as number)} m ${where(p, a.pos)}.${p.st.globalWeather ? ' (The planet-wide weather stays: clear everywhere to lift it.)' : ''}`);
  }, {
    desc: 'Clear the weather', category: 'Sky',
    params: { pos: pos(false), radius: radius(1500), everywhere: { type: 'boolean', default: false, desc: 'clear every system and the planet-wide weather' } },
  });
  r.register('weather.pin-season', ({ p }, a) => {
    const s = a.season as string | null;
    const i = s ? SEASONS.indexOf(s) : -1;
    p.st.seasonPinned = i >= 0 ? i : null;
    return ok(i >= 0 ? `It will be ${SEASONS[i]} on ${p.name} until you release it.` : `The seasons turn again on ${p.name}.`);
  }, { desc: 'Hold a season', category: 'Sky', params: { season: { type: 'enum', values: ['none', ...SEASONS], default: null } } });

  // time
  r.register('time.set-hour', ({ u, p }, a) => {
    const h = a.hour as number;
    if (h > p.st.dayHours) return fail(`A day on ${p.name} has only ${fmt(p.st.dayHours)} hours.`);
    setHour(u, p, h);
    return ok(`The sun stands at ${fmt(h)}:00 over the meridian of ${p.name}.`);
  }, { desc: 'Move the sun to an hour', category: 'Time', params: { hour: { type: 'number', min: 0, max: 2000, required: true } } });
  r.register('time.day-length', ({ u, p }, a) => {
    anchorSpin(u, p);
    p.st.dayHours = a.hours as number;
    return ok(`A day on ${p.name} now lasts ${fmt(a.hours as number)} hours.`);
  }, { desc: 'Change the length of the day', category: 'Time', params: { hours: { type: 'number', min: 1, max: 2000, required: true } } });
  r.register('time.freeze-sun', ({ u, p }, a) => {
    anchorSpin(u, p);
    p.st.sunFrozen = a.on as boolean;
    if (p.st.sunFrozen) u.chronicleAdd(p, 'god', 'The sun stood still in the sky.', 2);
    return ok(p.st.sunFrozen ? 'The sun stands still.' : 'The sun moves again.');
  }, { desc: 'Stop (or restart) the sun', category: 'Time', params: { on: { type: 'boolean', default: true } } });
  r.register('time.year-length', ({ u, p }, a) => {
    const d = findParam('planet.yearDays')!;
    return ok(d.set(u, p, a.days as number));
  }, { desc: 'Change the length of the year', category: 'Time', params: { days: { type: 'number', min: 0.5, max: 2000, required: true } } });
  r.register('time.axial-tilt', ({ p }, a) => {
    p.st.axialTilt = ((a.degrees as number) * Math.PI) / 180;
    resetClimateMemory(p);
    return ok(`${p.name}'s axis now leans ${fmt(a.degrees as number)}°${(a.degrees as number) < 1 ? ': no more seasons' : ''}.`);
  }, { desc: 'Tilt the axis (seasons)', category: 'Time', params: { degrees: { type: 'number', min: 0, max: 180, required: true } } });

  // atmosphere
  const atmosphere = (u: Universe, p: Planet, a: Args): CommandResult => {
    const at = p.st.atmosphere;
    const before = at.pressure;
    const action = (a.action as string) ?? 'set';
    if (action === 'add-air') {
      const amt = (a.amount as number | undefined) ?? 1;
      // mix in an Earth-like air by partial pressure
      const P0 = at.pressure, P1 = P0 + amt;
      const mix = (cur: number, add: number) => (P1 > 0 ? (cur * P0 + add * amt) / P1 : 0);
      at.n2 = mix(at.n2, 0.78); at.o2 = mix(at.o2, 0.21); at.co2 = mix(at.co2, 0.0006); at.methane = mix(at.methane, 0);
      at.toxicity = P1 > 0 ? (at.toxicity * P0) / P1 : 0;
      at.pressure = P1;
    } else if (action === 'remove-air') {
      const amt = (a.amount as number | undefined) ?? at.pressure;
      at.pressure = Math.max(0, at.pressure - amt);
    }
    for (const k of ['pressure', 'o2', 'co2', 'n2', 'methane', 'dust', 'toxicity'] as const) {
      const v = a[k];
      if (typeof v === 'number') at[k] = v;
    }
    if (a.tint !== undefined) at.tint = a.tint === null ? null : (a.tint as [number, number, number]);
    // a world given (or stripped of) air has a new climate: the memory of the old one is no guide
    if (Math.abs(at.pressure - before) > Math.max(0.05, before * 0.25)) resetClimateMemory(p);
    noteAir(u, p, before);
    const verb = at.pressure > before ? 'thickens' : at.pressure < before ? 'thins' : 'changes';
    return ok(`The air of ${p.name} ${verb}: ${fmt(at.pressure)} atm, ${airPhrase(p)}.`);
  };
  const airParams: Record<string, ParamSchema> = {
    action: { type: 'enum', values: ['set', 'add-air', 'remove-air'], default: 'set' },
    amount: { type: 'number', min: 0, max: 100 },
    pressure: { type: 'number', min: 0, max: 100 }, o2: { type: 'number', min: 0, max: 1 }, co2: { type: 'number', min: 0, max: 1 },
    n2: { type: 'number', min: 0, max: 1 }, methane: { type: 'number', min: 0, max: 1 }, dust: { type: 'number', min: 0, max: 10 },
    toxicity: { type: 'number', min: 0, max: 1 }, tint: { type: 'any' },
  };
  r.register('planet.atmosphere', ({ u, p }, a) => atmosphere(u, p, a), { desc: 'Change the air', category: 'Worlds', params: airParams });
  r.register('planet.add-air', ({ u, p }, a) => atmosphere(u, p, { ...a, action: 'add-air' }), { desc: 'Breathe air onto the world', category: 'Worlds', params: { amount: { type: 'number', min: 0, max: 100, default: 1 } } });
  r.register('planet.remove-air', ({ u, p }, a) => atmosphere(u, p, { ...a, action: 'remove-air' }), { desc: 'Strip the air away', category: 'Worlds', params: { amount: { type: 'number', min: 0, max: 100 } } });

  // star + planet
  r.register('star.set', ({ u }, a) => {
    const msgs: string[] = [];
    if (a.kind) {
      setStarKind(u.star, u.content, a.kind as string);
      msgs.push(`The star becomes a ${u.content.stars.get(u.star.def).name.toLowerCase()}.`);
      u.chronicleAdd(null, 'god', `The star was remade: it burns as a ${u.content.stars.get(u.star.def).name.toLowerCase()} now.`, 3);
    }
    if (typeof a.luminosity === 'number') {
      const before = u.star.luminosity;
      setStarLuminosity(u.star, a.luminosity);
      msgs.push(a.luminosity > before ? 'The star burns brighter.' : a.luminosity < before ? 'The star dims.' : 'The star holds steady.');
    }
    if (typeof a.activity === 'number') { u.star.activity = a.activity; msgs.push('The star stirs.'); }
    return msgs.length ? ok(msgs.join(' ')) : fail('star.set needs a kind, luminosity or activity.');
  }, {
    desc: 'Change the star', category: 'Worlds',
    params: { kind: { type: 'enum', values: (u) => u.content.stars.ids() }, luminosity: { type: 'number', min: 0, max: 10000 }, activity: { type: 'number', min: 0, max: 1 } },
  });
  r.register('planet.set', ({ u, p }, a) => {
    const msgs: string[] = [];
    if (typeof a.gravity === 'number') { p.st.gravity = a.gravity; msgs.push(`gravity ${fmt(a.gravity)} m/s²`); }
    if (typeof a.magnetism === 'number') { p.st.magnetism = a.magnetism; msgs.push(`magnetic field ${fmt(a.magnetism)}×`); }
    if (typeof a.distance === 'number') {
      p.st.orbit.a = p.st.orbit.parent >= 0 ? a.distance * AU * 0.01 : a.distance * AU;
      msgs.push(`orbit ${fmt(a.distance)} AU`);
    }
    if (typeof a.spin === 'number') { anchorSpin(u, p); p.st.dayHours = a.spin; msgs.push(`day ${fmt(a.spin)} h`); }
    if (typeof a.cloudiness === 'number') { p.st.cloudiness = a.cloudiness; msgs.push(`cloudiness ${fmt(a.cloudiness)}`); }
    if (typeof a.temperatureOffset === 'number') { p.st.climateOffset = a.temperatureOffset; msgs.push(`temperature ${a.temperatureOffset >= 0 ? '+' : ''}${fmt(a.temperatureOffset)} °C`); }
    if (typeof a.seaLevel === 'number') { p.st.seaLevel = a.seaLevel; msgs.push(`sea level ${fmt(a.seaLevel)} m`); }
    if (typeof a.eccentricity === 'number') { p.st.orbit.e = a.eccentricity; msgs.push(`eccentricity ${fmt(a.eccentricity)}`); }
    // moved, spun or warmed: the climate memory starts again
    if (typeof a.distance === 'number' || typeof a.spin === 'number' || typeof a.temperatureOffset === 'number' || typeof a.eccentricity === 'number') resetClimateMemory(p);
    return msgs.length ? ok(`${p.name}: ${msgs.join(', ')}.`) : fail('planet.set needs at least one of gravity, magnetism, distance, spin, cloudiness, temperatureOffset, seaLevel.');
  }, {
    desc: 'Change the world itself', category: 'Worlds',
    params: {
      gravity: { type: 'number', min: 0, max: 50 }, magnetism: { type: 'number', min: 0, max: 5 }, distance: { type: 'number', min: 0.05, max: 40 },
      spin: { type: 'number', min: 1, max: 2000 }, cloudiness: { type: 'number', min: 0, max: 1 }, temperatureOffset: { type: 'number', min: -150, max: 150 },
      seaLevel: { type: 'number', min: -5000, max: 5000 }, eccentricity: { type: 'number', min: 0, max: 0.9 },
    },
  });

  // life
  r.register('life.plant', ({ u, p }, a) => {
    const sp = u.content.plants.idx(a.species as string);
    const n = plantArea(u, p, sp, a.pos!, a.radius as number, a.density as number);
    const name = u.content.plants.list[sp].name.toLowerCase();
    if (!n) return fail(`Nowhere ${where(p, a.pos)} can hold ${name}.`);
    const doomed = p.st.atmosphere.pressure < 0.05 ? ' Without air it will not last.' : '';
    return ok(`${u.content.plants.list[sp].name} planted ${where(p, a.pos)} (${n} cells).${doomed}`);
  }, {
    desc: 'Plant a species', category: 'Life',
    params: { species: { type: 'enum', values: (u) => u.content.plants.ids(), required: true }, pos: pos(), radius: radius(150), density: { type: 'number', min: 0.01, max: 1, default: 0.6 } },
  });
  r.register('life.forest', ({ u, p }, a) => {
    const sp = a.species ? u.content.plants.idx(a.species as string) : -1;
    if (sp >= 0 && u.content.plants.list[sp].type !== 'tree') return fail(`${a.species} is not a tree.`);
    const n = forestArea(u, p, a.pos!, a.radius as number, a.density as number, sp);
    return n ? ok(`A forest springs up ${where(p, a.pos)} (${n} cells).`) : fail('There is no dry land there for a forest.');
  }, {
    desc: 'Grow a forest', category: 'Life',
    params: { pos: pos(), radius: radius(300), density: { type: 'number', min: 0.05, max: 1, default: 0.85 }, species: { type: 'enum', values: (u) => u.content.plants.ids() } },
  });
  const paintBiomeHandler: Handler = ({ u, p }, a) => {
    const b = u.content.biomes.idx(a.biome as string);
    const n = paintBiome(u, p, b, a.pos!, a.radius as number, a.pinned as boolean);
    return ok(`${u.content.biomes.list[b].name} painted ${where(p, a.pos)} (${n} cells)${a.pinned ? ', pinned' : ''}.`);
  };
  const paintBiomeSchema: CommandSchema = {
    desc: 'Paint a biome', category: 'Life',
    params: { biome: { type: 'enum', values: (u) => u.content.biomes.ids(), required: true }, pos: pos(), radius: radius(400), pinned: { type: 'boolean', default: false } },
  };
  r.register('life.paint-biome', paintBiomeHandler, paintBiomeSchema);
  r.register('terrain.paint-biome', paintBiomeHandler, paintBiomeSchema);
  const pinHandler: Handler = ({ u, p }, a) => {
    const n = pinBiome(u, p, a.pos!, a.radius as number, a.on as boolean);
    return ok(a.on ? `The land ${where(p, a.pos)} will keep its nature (${n} cells).` : `The land ${where(p, a.pos)} follows its climate again.`);
  };
  const pinSchema: CommandSchema = { desc: 'Pin (or release) the biome of a region', category: 'Life', params: { pos: pos(), radius: radius(400), on: { type: 'boolean', default: true } } };
  r.register('life.pin-biome', pinHandler, pinSchema);
  r.register('terrain.pin-biome', pinHandler, pinSchema);

  // fire
  r.register('fire.ignite', ({ u, p }, a) => {
    const n = igniteArea(u, p, a.pos!, a.radius as number, a.strength as number);
    if (!n) return fail(p.st.atmosphere.pressure * p.st.atmosphere.o2 < 0.04 ? `Nothing burns without oxygen on ${p.name}.` : `Nothing ${where(p, a.pos)} will burn.`);
    return ok(`Fire takes hold ${where(p, a.pos)} (${n} cells).`);
  }, { desc: 'Set fire', category: 'Fire', params: { pos: pos(), radius: radius(60), strength: { type: 'number', min: 0.05, max: 1, default: 0.8 } } });
  r.register('fire.extinguish', ({ u, p }, a) => {
    const n = extinguishArea(u, p, a.pos!, a.radius as number);
    return ok(n ? `The flames die ${where(p, a.pos)} (${n} cells).` : 'There is no fire there.');
  }, { desc: 'Put out fires', category: 'Fire', params: { pos: pos(), radius: radius(300) } });

  // meta
  r.register('set', ({ u, p }, a) => {
    const d = findParam(a.path as string);
    if (!d) return fail(`There is no law called '${a.path}'. Try one of: planet.gravity, planet.dayHours, star.luminosity, climate.offset, …`);
    const v = coerceParam(u, d, a.value);
    if (!v.ok) return fail(v.msg);
    return ok(d.set(u, p, v.v));
  }, { desc: 'Set any law of the world by path', category: 'Meta', params: { path: { type: 'string', required: true }, value: { type: 'any', required: true } } });
  r.register('focus', ({ u, p }, a) => {
    if (a.pos) u.focus = { planet: p.id, pos: a.pos };
    else u.focus = { planet: p.id, pos: u.focus && u.focus.planet === p.id ? u.focus.pos : [0, 0, 1] };
    // cohort members near the camera become individuals (CONTRACT §8.7); deterministic: focus is a logged command
    focusHook(u, p, u.focus.pos);
    return { ok: true };
  }, { desc: 'The camera dwells here', category: 'Meta', params: { pos: { type: 'pos' } } });

  registerPeopleCommands(r);
  return r;
}
