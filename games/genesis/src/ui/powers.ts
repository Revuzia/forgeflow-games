// GENESIS — the power catalogue as the UI sees it (CONTRACT.md §11.1, §16): every power of powers.json (base + mods +
// what the god invented at runtime), with live enum values, loaded from the sim (query 'powers'). The palette, the
// radial menu, the tool card, gesture casting and the help card are generated from it, so a power added as data shows
// up everywhere with no UI change.
//
// Also here: how a power is used (its target → what a click / drag means), the parameters a tool card shows, defaults
// for parameters the data leaves open, and the readable summary of a resolved command (the "do this" preview).

import type { Command } from '../sim/types.ts';
import { BASE_PACK } from '../data/index.ts';
import { fmtDist, fmtNum, fmtTicks } from './dom.ts';

export interface ParamSpec {
  type: 'number' | 'int' | 'pos' | 'entity' | 'enum' | 'boolean' | 'string' | 'any' | 'vec3' | string;
  min?: number;
  max?: number;
  default?: unknown;
  desc?: string;
  unit?: string;
  target?: string;
  values?: string[] | string;
  entity?: string[];
  required?: boolean;
  /** the command's own type for this parameter (query 'commands'): 'any' takes an entity object, 'int' an id */
  cmdType?: string;
}

export type PowerTarget = 'region' | 'point' | 'line' | 'settlement' | 'agent' | 'entity' | 'planet' | 'none';

export interface Power {
  id: string;
  name: string;
  category: string;
  icon: string;
  ring: number;
  gesture: string | null;
  command: string;
  params: Record<string, unknown>;
  schema: Record<string, ParamSpec>;
  target: PowerTarget;
  synonyms: string[];
  desc: string;
  cost?: number;
  cooldown?: number;
}

/** radial / palette order of categories (CONTRACT §16.3, + Laws) */
export const CATEGORIES = ['Shape', 'Water', 'Sky', 'Life', 'Peoples', 'Ideas', 'Fire', 'Disasters', 'Hand', 'Creature', 'Worlds', 'Time', 'Laws'];

/** registries by name for enum values when the sim cannot be asked (the lookdev world) */
function baseRegistry(name: string): string[] {
  const pack = BASE_PACK as unknown as Record<string, { id: string }[] | undefined>;
  const alias: Record<string, string> = { recipes: 'recipes', planetkinds: 'planetkinds', species: 'species', weather: 'weather', plants: 'plants', biomes: 'biomes', animals: 'animals', diseases: 'diseases', items: 'items', disasters: 'disasters', creatures: 'creatures', stars: 'stars', ships: 'ships', buildings: 'buildings' };
  const list = pack[alias[name] ?? name];
  return Array.isArray(list) ? list.map((x) => x.id) : [];
}

function normalizePower(raw: Record<string, unknown>): Power {
  const schema: Record<string, ParamSpec> = {};
  for (const [k, v] of Object.entries((raw.schema ?? {}) as Record<string, ParamSpec>)) {
    const s = { ...v };
    if (typeof s.values === 'string') s.values = baseRegistry(s.values);
    schema[k] = s;
  }
  return {
    id: String(raw.id), name: String(raw.name ?? raw.id), category: String(raw.category ?? 'Laws'), icon: String(raw.icon ?? ''),
    ring: Number(raw.ring ?? 1), gesture: (raw.gesture as string | null) ?? null, command: String(raw.command),
    params: (raw.params ?? {}) as Record<string, unknown>, schema, target: (raw.target ?? 'none') as PowerTarget,
    synonyms: Array.isArray(raw.synonyms) ? (raw.synonyms as string[]) : [], desc: String(raw.desc ?? ''),
    cost: typeof raw.cost === 'number' ? raw.cost : undefined, cooldown: typeof raw.cooldown === 'number' ? raw.cooldown : undefined,
  };
}

export class PowerBook {
  list: Power[] = [];
  byId = new Map<string, Power>();
  byCategory = new Map<string, Power[]>();
  /** bumped whenever the list changes (UI caches rebuild) */
  version = 0;

  constructor() {
    this.set(((BASE_PACK.powers ?? []) as unknown as Record<string, unknown>[]).map(normalizePower));
  }

  /** take the sim's catalogue (query 'powers': base + mods + inventions, enum values resolved) */
  setFromSim(raw: unknown): boolean {
    if (!Array.isArray(raw) || !raw.length) return false;
    this.set((raw as Record<string, unknown>[]).filter((p) => p && typeof p.id === 'string' && typeof p.command === 'string').map((p) => {
      const pw = normalizePower(p);
      // the sim resolved registry names to live ids already; keep them
      for (const [k, s] of Object.entries((p.schema ?? {}) as Record<string, ParamSpec>)) if (Array.isArray(s.values)) pw.schema[k].values = s.values;
      return pw;
    }));
    return true;
  }

  /** the commands' own schemas (query 'commands'): which parameters each power's command REQUIRES, and their types */
  private commands = new Map<string, Record<string, { type?: string; required?: boolean; values?: string[]; unit?: string }>>();
  /** what each command does, in the registry's words ("Teach a settlement an idea") */
  private commandDesc = new Map<string, string>();

  setCommands(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    const list = (raw as { k: string; desc?: string; params?: Record<string, { type?: string; required?: boolean; values?: string[] }> }[]).filter((c) => c && typeof c.k === 'string');
    this.commands = new Map(list.map((c) => [c.k, c.params ?? {}]));
    this.commandDesc = new Map(list.filter((c) => typeof c.desc === 'string').map((c) => [c.k, c.desc!]));
    this.mergeCommands();
    this.version++;
  }

  /** a command's parameter schema from the registry (units, enum values), or null */
  commandParam(command: string, param: string): { type?: string; values?: string[]; unit?: string } | null {
    return this.commands.get(command)?.[param] ?? null;
  }

  /** what a command does, in the registry's words (a tooltip), or '' */
  commandDescription(k: string): string { return this.commandDesc.get(k) ?? ''; }

  /** a human name for a command kind: the power that casts it, else the kind's verb ('settlement.teach' → 'Teach') */
  commandName(k: string): string {
    const p = this.list.find((x) => x.command === k);
    if (p) return p.name;
    const last = k.split('.').pop() ?? k;
    const t = last.replace(/-/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** the values an enum parameter of a command takes (from the sim's own command schema), or null before it is known */
  enumOf(command: string, param: string): string[] | null {
    const v = this.commands.get(command)?.[param]?.values;
    return Array.isArray(v) && v.length ? v.slice() : null;
  }

  private mergeCommands(): void {
    if (!this.commands.size) return;
    for (const p of this.list) {
      const cs = this.commands.get(p.command);
      if (!cs) continue;
      for (const [k, s] of Object.entries(p.schema)) {
        const c = cs[k];
        if (!c) continue;
        s.cmdType = c.type;
        // a parameter the command requires and the power does not fix is the player's to give
        if (c.required && p.params[k] === undefined) s.required = true;
      }
    }
  }

  private set(list: Power[]): void {
    this.list = list;
    this.byId = new Map(list.map((p) => [p.id, p]));
    this.byCategory = new Map();
    for (const c of CATEGORIES) this.byCategory.set(c, []);
    for (const p of list) {
      if (!this.byCategory.has(p.category)) this.byCategory.set(p.category, []);
      this.byCategory.get(p.category)!.push(p);
    }
    for (const l of this.byCategory.values()) l.sort((a, b) => a.ring - b.ring || a.name.localeCompare(b.name));
    this.mergeCommands();
    this.version++;
  }

  get(id: string): Power | undefined { return this.byId.get(id); }

  /** categories that have powers, in radial order (mods may add their own at the end) */
  categories(): string[] {
    const out = CATEGORIES.filter((c) => (this.byCategory.get(c)?.length ?? 0) > 0);
    for (const c of this.byCategory.keys()) if (!out.includes(c) && this.byCategory.get(c)!.length) out.push(c);
    return out;
  }

  /** powers cast by a gesture shape */
  gestures(): Map<string, Power> {
    const m = new Map<string, Power>();
    for (const p of this.list) if (p.gesture && !m.has(p.gesture)) m.set(p.gesture, p);
    return m;
  }

  /** the power a command was cast as (best match of its fixed params), for previews */
  powerOf(cmd: Command): Power | undefined {
    let best: Power | undefined, bs = -1e9;
    for (const p of this.list) {
      if (p.command !== cmd.k) continue;
      let s = 0;
      for (const [k, v] of Object.entries(p.params)) {
        if (cmd[k] === undefined) continue;
        s += cmd[k] === v ? 2 : -3;
      }
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  }
}

// ───────────────────────────── how a power is used ─────────────────────────────

/** what a pointer does with this power armed */
export type ToolMode =
  | 'brush'     // a region: click to cast, drag to paint (repeated dabs)
  | 'front'     // weather: drag paints a front of systems along the stroke
  | 'once'      // a region / point cast once per click (miracles, a disaster)
  | 'aim'       // a point, drag sets a direction (`toward`)
  | 'line'      // press at A, release at B (`to`)
  | 'settlement' // click a settlement (and, for pairs, a second one)
  | 'agent'     // click a person
  | 'entity'    // click a thing of the kinds it takes (disaster, creature, ship, a held thing)
  | 'move'      // an entity (from the selection) and a destination click (`to` / `pos`)
  | 'world'     // acts on the world under the camera: click anywhere on it or press Cast
  | 'instant';  // no place at all: Cast

const PAINT = /^(terrain\.(raise|lower|flatten|smooth|noise|paint-material|pave)|water\.(add|remove|drain)|life\.(plant|forest|paint-biome|pin-biome|kill|heal|cull|breed|cure|tame|bless|curse)|fire\.(ignite|extinguish))$/;

export function toolMode(p: Power): ToolMode {
  const s = p.schema;
  const toSpec = s.to;
  if (p.command === 'weather.paint' || p.command === 'content.weather') return 'front';
  // moving a thing is a thing and a destination (its `to` is a place, not the far end of a line): with the thing
  // chosen — the selection, the inspector's own — one click says where
  if ((p.command === 'disaster.move' || p.command === 'settlement.move' || p.command === 'creature.move' || p.command === 'possess.move' || p.command === 'agent.move' || p.command === 'possess.act')) return 'move';
  if (toSpec && toSpec.target === 'line') return 'line';
  if (p.target === 'line') return 'line';
  switch (p.target) {
    case 'region':
      if (PAINT.test(p.command)) return 'brush';
      return s.toward ? 'aim' : 'once';
    case 'point':
      return s.toward ? 'aim' : s.pos ? 'once' : 'instant';
    case 'settlement': return 'settlement';
    case 'agent': return 'agent';
    case 'entity': return 'entity';
    case 'planet': return 'world';
    default: return s.pos ? 'once' : 'instant';
  }
}

/** does the tool need a place on the ground */
export function needsGround(m: ToolMode): boolean {
  return m === 'brush' || m === 'front' || m === 'once' || m === 'aim' || m === 'line';
}

/** the parameter a brush size drives (radius in metres), if any */
export function radiusParam(p: Power): string | null {
  const r = p.schema.radius;
  return r && (r.type === 'number' || r.type === 'int') ? 'radius' : null;
}

/** the parameter brush strength drives: the first "how much" number of the schema */
const STRENGTH_KEYS = ['strength', 'intensity', 'power', 'depth', 'height', 'density', 'amount', 'factor', 'share', 'volume', 'rate', 'count', 'speed', 'delta', 'scale'];
export function strengthParam(p: Power): string | null {
  for (const k of STRENGTH_KEYS) {
    const s = p.schema[k];
    if (s && (s.type === 'number' || s.type === 'int') && s.min !== undefined && s.max !== undefined) return k;
  }
  return null;
}

/** parameters the tool card shows (places and ids are given by the pointer, not typed) */
export function cardParams(p: Power): [string, ParamSpec][] {
  return Object.entries(p.schema).filter(([k, s]) => {
    if (s.type === 'pos' || s.type === 'vec3') return false;
    if (k === 'radius') return false; // the brush
    if (s.type === 'entity') return false; // picked in the world (or the selection)
    return true;
  });
}

/** a sensible starting value for a parameter the data leaves open */
export function defaultValue(k: string, s: ParamSpec): unknown {
  if (s.default !== undefined) return s.default;
  switch (s.type) {
    case 'number': case 'int': {
      if (s.min !== undefined && s.max !== undefined) {
        // a quarter of the way up a log range for wide ranges, else the middle
        const lo = s.min, hi = s.max;
        if (lo >= 0 && hi / Math.max(lo, 1e-3) > 50) return roundNice(lo + (hi - lo) * 0.02 + (lo === 0 ? Math.min(hi, 10) * 0.5 : 0));
        return roundNice((lo + hi) / 2);
      }
      return s.min ?? 0;
    }
    case 'boolean': return false;
    case 'enum': return Array.isArray(s.values) && s.values.length ? s.values[0] : '';
    case 'string': return '';
    default: return undefined;
  }
}

function roundNice(v: number): number {
  if (Math.abs(v) >= 100) return Math.round(v);
  if (Math.abs(v) >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

/**
 * Is this parameter a FILTER on the thing the power acts on rather than a value to give? An enum the data leaves open
 * on a power that also picks an entity (which kind of disaster to move, which kind of thing to grab) is: left unset it
 * means "the one picked", and its list's first value would aim the power at the wrong thing.
 */
export function isSelector(p: Power, k: string): boolean {
  const s = p.schema[k];
  if (!s || s.type !== 'enum' || s.default !== undefined || s.required || p.params[k] !== undefined) return false;
  return Object.values(p.schema).some((x) => x.type === 'entity');
}

/** is a parameter required and not yet given */
export function missingRequired(p: Power, values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, s] of Object.entries(p.schema)) {
    if (!s.required) continue;
    if (s.type === 'pos' || s.type === 'entity') continue;
    if (values[k] === undefined || values[k] === '') out.push(k);
  }
  return out;
}

/** a parameter's label: its key, spaced ("temperatureOffset" → "temperature offset") */
export function paramLabel(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
}

/** a parameter value as people read it */
export function fmtParam(k: string, v: unknown, s?: ParamSpec, dayHours = 24): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    const unit = s?.unit ?? '';
    if (k === 'radius' || unit === 'm') return fmtDist(v);
    if (k === 'duration' || unit === 'ticks') return fmtTicks(v, dayHours);
    if (unit === 'h') return `${fmtNum(v)} h`;
    if (unit === '°' || k === 'degrees') return `${fmtNum(v)}°`;
    return `${fmtNum(v)}${unit && unit !== 'tick' ? ` ${unit}` : ''}`;
  }
  if (Array.isArray(v)) return v.length === 3 && v.every((x) => typeof x === 'number') ? 'a place' : v.join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string') return `${o.kind} ${o.id ?? ''}`.trim();
    return JSON.stringify(v).slice(0, 40);
  }
  return String(v).replace(/-/g, ' ');
}

// ───────────────────────────── the command a cast sends ─────────────────────────────

/** where a cast lands and what it was aimed at */
export interface Place {
  hit?: { planet: number; dir: ArrayLike<number> } | null;
  to?: { planet: number; dir: ArrayLike<number> } | null;
  toward?: { planet: number; dir: ArrayLike<number> } | null;
  /** picked things by parameter key (an id, or an entity { kind, id } for the hand) */
  refs?: Record<string, unknown>;
  planet?: number;
}

/** the schema key that takes an entity of `kind` ("settlement", "agent", "planet" …) */
export function entityKey(p: Power, kind: string): string | null {
  for (const [k, s] of Object.entries(p.schema)) if (s.type === 'entity' && (s.entity ?? []).includes(kind)) return k;
  return null;
}

/**
 * The Command a power sends: its fixed params, the values set on its card (only keys its schema declares — the sim
 * refuses unknown ones), the brush radius, the world, the place(s) and the picked things. A world verb with a `world`
 * parameter acts on the world it was cast on.
 */
export function buildCommand(p: Power, values: Record<string, unknown>, place: Place, brushRadius: number | null, fallbackPlanet: number): Command {
  const c: Command = { k: p.command, ...p.params };
  for (const [k, s] of Object.entries(p.schema)) {
    if (s.type === 'pos' || s.type === 'entity' || s.type === 'vec3') continue;
    const v = values[k];
    if (v !== undefined && v !== '') c[k] = v;
  }
  const r = p.schema.radius;
  if (r && brushRadius !== null) c.radius = Math.min(r.max ?? 20000, Math.max(r.min ?? 1, Math.round(brushRadius)));
  const planet = place.hit?.planet ?? place.planet ?? fallbackPlanet;
  c.planet = planet;
  if (place.hit && (p.schema.pos !== undefined || (p.target !== 'planet' && p.target !== 'none'))) c.pos = [place.hit.dir[0], place.hit.dir[1], place.hit.dir[2]];
  if (place.to) { const d = [place.to.dir[0], place.to.dir[1], place.to.dir[2]]; if (p.schema.to) c.to = d; else c.pos = d; }
  if (place.toward && p.schema.toward) c.toward = [place.toward.dir[0], place.toward.dir[1], place.toward.dir[2]];
  for (const [k, v] of Object.entries(place.refs ?? {})) c[k] = v;
  const wk = entityKey(p, 'planet');
  if (wk && c[wk] === undefined && (p.target === 'planet' || toolMode(p) === 'world')) c[wk] = planet;
  return c;
}
