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
  /** @deprecated LIVING §3.6: the old drawn shapes; the recogniser reads `sigil` (kept only so old mods load) */
  gesture: string | null;
  /** the sigil that casts it (LIVING §3.6: an original one-stroke glyph id — drop, anvil, fork …), or null */
  sigil: string | null;
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
// (LIVING.md §3.5 / §7 H4: the creature is gone; its place on the radial is the Signs — prophets, omens, sacred places, answered prayers)
export const CATEGORIES = ['Shape', 'Water', 'Sky', 'Life', 'Peoples', 'Ideas', 'Fire', 'Disasters', 'Hand', 'Signs', 'Worlds', 'Time', 'Laws'];

/**
 * the names the interface shows for a category (LIVING §3.6, hook H7): the data keeps its ids ('Hand'), the player reads
 * "Touch" — the god's presence as light and weather, never a hand
 */
const CATEGORY_LABEL: Record<string, string> = { Hand: 'Touch' };
export function categoryLabel(c: string): string { return CATEGORY_LABEL[c] ?? c; }
/** a category id from what the player typed or read ("touch" → 'Hand'), or null */
export function categoryFromLabel(word: string): string | null {
  const w = word.trim().toLowerCase();
  for (const c of CATEGORIES) if (c.toLowerCase() === w || categoryLabel(c).toLowerCase() === w) return c;
  return null;
}

/** registries by name for enum values when the sim cannot be asked (the lookdev world) */
function baseRegistry(name: string): string[] {
  const pack = BASE_PACK as unknown as Record<string, { id: string }[] | undefined>;
  const alias: Record<string, string> = { recipes: 'recipes', planetkinds: 'planetkinds', species: 'species', weather: 'weather', plants: 'plants', biomes: 'biomes', animals: 'animals', diseases: 'diseases', items: 'items', disasters: 'disasters', stars: 'stars', ships: 'ships', buildings: 'buildings', ores: 'ores', materials: 'materials' };
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
    ring: Number(raw.ring ?? 1), gesture: (raw.gesture as string | null) ?? null, sigil: typeof raw.sigil === 'string' && raw.sigil ? raw.sigil : null,
    command: String(raw.command),
    params: (raw.params ?? {}) as Record<string, unknown>, schema, target: (raw.target ?? 'none') as PowerTarget,
    synonyms: Array.isArray(raw.synonyms) ? (raw.synonyms as string[]) : [], desc: String(raw.desc ?? ''),
    cost: typeof raw.cost === 'number' ? raw.cost : undefined, cooldown: typeof raw.cooldown === 'number' ? raw.cooldown : undefined,
  };
}

/**
 * Powers the interface offers for commands the sim registers but powers.json does not list yet (LIVING §4.1–4.2, hook
 * H12): seeding a vein of ore with a brush, and inventing a material or a plant (their dialogs: src/ui/invent.ts).
 * Added only when no power of the data already casts the command.
 */
export const CLIENT_POWERS: Record<string, unknown>[] = [
  {
    id: 'seed-vein', name: 'Seed a vein', category: 'Shape', icon: 'ore', ring: 1, command: 'terrain.seed-ore', target: 'region',
    params: {},
    schema: {
      ore: { type: 'enum', values: 'ores', required: true, desc: 'what lies in the vein' },
      pos: { type: 'pos', target: 'point', desc: 'where' },
      radius: { type: 'number', min: 20, max: 5000, default: 120, unit: 'm', target: 'region' },
      richness: { type: 'number', min: 0.05, max: 1, default: 0.7, desc: 'how rich the vein is' },
    },
    synonyms: ['seed a vein', 'ore vein', 'put ore in the ground', 'deposit', 'lode', 'mine'],
    desc: 'Lay a vein of ore in the ground where you click: miners find it, smiths want it.',
  },
  {
    id: 'invent-material', name: 'Invent a material', category: 'Ideas', icon: 'artifact', ring: 1, command: 'content.material', target: 'none',
    params: {},
    schema: {
      name: { type: 'string', required: true },
      kind: { type: 'enum', values: ['metal', 'stone', 'mineral', 'gem', 'wood', 'fibre'] },
      traits: { type: 'any', desc: 'light, hard, warm, glowing, flexible, beautiful …' },
      uses: { type: 'any', desc: 'building, tools, weapons, luxury' },
      settlement: { type: 'entity', entity: ['settlement'] },
    },
    synonyms: ['new material', 'invent a metal', 'create a metal', 'a new stone', 'mithril'],
    desc: 'A new metal, stone, gem, mineral, wood or fibre — with veins or groves to find, crafts that use it and people who want it.',
  },
  {
    id: 'invent-plant', name: 'Invent a plant', category: 'Life', icon: 'sprout', ring: 1, command: 'content.plant', target: 'none',
    params: {},
    schema: {
      name: { type: 'string', required: true },
      type: { type: 'enum', values: ['tree', 'shrub', 'grass', 'crop'], default: 'shrub' },
      like: { type: 'enum', values: 'plants', desc: 'the plant it is like (its climate)' },
      pos: { type: 'pos', target: 'point', desc: 'where it grows' },
    },
    synonyms: ['new plant', 'new crop', 'invent a crop', 'grow a new plant'],
    desc: 'A new plant or crop with what it gives: it grows where you point (a crop waits to be sown).',
  },
];

/** disasters.json's own reach, strength and life per kind: what the sim uses for a value the card leaves unset */
interface DisasterDefaults { id: string; radius?: number; intensity?: number; life?: [number, number] }
const BASE_DISASTERS = new Map(((BASE_PACK.disasters ?? []) as unknown as DisasterDefaults[]).map((d) => [d.id, d]));

/** the list with the client powers whose command no power of the data casts (their registries: live ids when known) */
function withClientPowers(list: Power[], live: Map<string, string[]> = new Map()): Power[] {
  const have = new Set(list.map((p) => p.command));
  const ids = new Set(list.map((p) => p.id));
  const out = [...list];
  for (const raw of CLIENT_POWERS) {
    if (have.has(String(raw.command)) || ids.has(String(raw.id))) continue;
    const p = normalizePower(raw);
    for (const [k, s] of Object.entries(raw.schema as Record<string, ParamSpec>)) if (typeof s.values === 'string' && live.get(s.values)?.length) p.schema[k].values = live.get(s.values)!.slice();
    out.push(p);
  }
  return out;
}

// ───────────────────────────── wrath (LIVING §3.7) ─────────────────────────────

/** the wrath law's default (god/wrath.ts WRATH_DEFAULT): survivable */
export const WRATH_DEFAULT = 0.3;

/** a harmful cast's own wrath on the tool card (the sim's disaster.spawn / miracle schemas carry it) */
const WRATH_SPEC: ParamSpec = { type: 'number', min: 0, max: 1, desc: 'how hard it falls: gentle … survivable (the law) … apocalyptic' };

/**
 * A wrath in the words the free text uses for it (gentle / small 0.1, the law 0.3, great 0.6, huge 0.85, apocalyptic 1):
 * the tool card, the "do this" preview and the god's window all say it this way.
 */
export function wrathWord(w: number): string {
  if (w >= 0.93) return 'apocalyptic';
  if (w >= 0.73) return 'huge';
  if (w >= 0.45) return 'great';
  if (w >= 0.2) return 'survivable';
  return 'gentle';
}

/** what a wrath does to the people under it, in a line (the slider's caption) */
export function wrathMeans(w: number): string {
  if (w >= 0.93) return 'nothing is spared: a town can fall to one blow';
  if (w >= 0.73) return 'few escape what it strikes';
  if (w >= 0.45) return 'many die where it strikes; the rest remember';
  if (w >= 0.2) return 'they scare and kill, but most live: warnings come first';
  return 'it frightens more than it kills';
}

export class PowerBook {
  list: Power[] = [];
  byId = new Map<string, Power>();
  byCategory = new Map<string, Power[]>();
  /** bumped whenever the list changes (UI caches rebuild) */
  version = 0;

  constructor() {
    this.set(withClientPowers(((BASE_PACK.powers ?? []) as unknown as Record<string, unknown>[]).map(normalizePower)));
  }

  /** take the sim's catalogue (query 'powers': base + mods + inventions, enum values resolved) */
  setFromSim(raw: unknown): boolean {
    if (!Array.isArray(raw) || !raw.length) return false;
    this.set(withClientPowers((raw as Record<string, unknown>[]).filter((p) => p && typeof p.id === 'string' && typeof p.command === 'string').map((p) => {
      const pw = normalizePower(p);
      // the sim resolved registry names to live ids already; keep them
      for (const [k, s] of Object.entries((p.schema ?? {}) as Record<string, ParamSpec>)) if (Array.isArray(s.values)) pw.schema[k].values = s.values;
      return pw;
    }), this.liveValues));
    return true;
  }

  /** live enum values the sim reported for the client powers' registries (ores, plants: the god's inventions included) */
  private liveValues = new Map<string, string[]>();
  /** the disaster kinds' own defaults (query 'disaster-kinds': base + mods) */
  private disasters = new Map<string, DisasterDefaults>(BASE_DISASTERS);

  /** the sim's disaster kinds (their reach, strength and life: what a value left unset becomes) */
  setDisasterKinds(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const d of raw as DisasterDefaults[]) if (d && typeof d.id === 'string') this.disasters.set(d.id, d);
  }

  /** a registry's live ids (query 'ores', 'plants' …): the client powers' pickers list them */
  setRegistry(name: string, ids: string[]): void {
    if (!ids.length) return;
    this.liveValues.set(name, ids);
    let changed = false;
    for (const p of this.list) {
      const def = CLIENT_POWERS.find((c) => c.id === p.id);
      if (!def) continue;
      for (const [k, s] of Object.entries(def.schema as Record<string, ParamSpec>)) if (s.values === name) { p.schema[k].values = ids.slice(); changed = true; }
    }
    if (changed) this.version++;
  }

  /**
   * The value the sim will use for a parameter the card leaves unset, when it is known here: the data's own default,
   * or — for a disaster — its kind's reach and strength (disasters.json). Undefined: the sim decides (a disaster's life
   * from its range, a count from the place), and the card says "its own".
   */
  defaultOf(p: Power, k: string): unknown {
    const s = p.schema[k];
    if (!s) return undefined;
    if (s.default !== undefined) return s.default;
    // a harmful cast left without its own wrath falls with the world's (the law god.wrath, LIVING §3.7)
    if (k === 'wrath') return this.wrathLaw;
    const d = p.command === 'disaster.spawn' && typeof p.params.kind === 'string' ? this.disasters.get(p.params.kind) : undefined;
    if (d) {
      if (k === 'radius' && typeof d.radius === 'number') return d.radius;
      if (k === 'intensity') return typeof d.intensity === 'number' ? d.intensity : 1;
      if (k === 'scale') return 1;
    }
    return undefined;
  }

  /** a disaster kind's life range (ticks), for the card's words ("its own: 3–6 h"), or null */
  lifeOf(p: Power): [number, number] | null {
    const d = p.command === 'disaster.spawn' && typeof p.params.kind === 'string' ? this.disasters.get(p.params.kind) : undefined;
    return d && Array.isArray(d.life) && d.life.length === 2 ? [Number(d.life[0]), Number(d.life[1])] : null;
  }

  /** the wrath law now (Snapshot.wrath; 0.3 until the world says): what a harmful cast left alone falls with */
  wrathLaw = WRATH_DEFAULT;

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
      // a harmful command takes its own wrath (LIVING §3.7): the card offers it on every power that casts one, left at
      // the world's law until the player moves it
      if (cs.wrath && !p.schema.wrath && p.params.wrath === undefined) p.schema.wrath = { ...WRATH_SPEC };
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

  /** powers cast by a sigil (LIVING §3.6: the `sigil` field; the old drawn shapes are gone) */
  sigils(): Map<string, Power> {
    const m = new Map<string, Power>();
    for (const p of this.list) if (p.sigil && !m.has(p.sigil)) m.set(p.sigil, p);
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
  | 'entity'    // click a thing of the kinds it takes (disaster, ship, a person, a held thing)
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
  if ((p.command === 'disaster.move' || p.command === 'settlement.move' || p.command === 'possess.move' || p.command === 'agent.move' || p.command === 'possess.act')) return 'move';
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

/**
 * The value a parameter starts at: the data's own default, or nothing. A value the data leaves open is NOT made up
 * here: it stays unset, so the sim takes its own (a tornado lives its kind's 3–6 hours, an introduction brings what the
 * command brings) — the old guess of "2 % up a wide range" sent tornadoes of 139 days and 20 001 strangers (audit).
 */
export function defaultValue(k: string, s: ParamSpec): unknown {
  void k;
  return s.default;
}

/**
 * Where a slider stands for a value left unset (the card shows "its own" there; nothing is sent until it is moved):
 * the known default, else 1 in a range that holds it (a factor), else the low end of a wide range, else the middle.
 */
export function sliderStart(s: ParamSpec, known: unknown): number {
  if (typeof known === 'number' && Number.isFinite(known)) return known;
  const lo = s.min ?? 0, hi = s.max ?? 1;
  if (lo <= 1 && hi >= 1 && (s.unit === '×' || hi / Math.max(lo, 1e-3) > 50)) return 1;
  if (lo >= 0 && hi / Math.max(lo, 1e-3) > 50) return lo;
  return (lo + hi) / 2;
}

/**
 * The values a cast of a power sends, before the place and the things picked: what the player set (remembered), the
 * power's own fixed params, what the world suggests (`prefill`), the data's defaults — and nothing else. Pure (tests).
 */
export function castValues(p: Power, remembered: Record<string, unknown>, prefill: (k: string, s: ParamSpec) => unknown = () => undefined): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(p.schema)) {
    if (s.type === 'pos' || s.type === 'entity' || s.type === 'vec3') continue;
    // (the brush radius is the brush's: buildCommand sends it)
    if (k === 'radius' && (s.type === 'number' || s.type === 'int')) continue;
    const d = remembered[k] ?? (p.params[k] !== undefined ? p.params[k] : prefill(k, s) ?? (isSelector(p, k) ? undefined : defaultValue(k, s)));
    if (d !== undefined && d !== '') v[k] = d;
  }
  return v;
}

/** the world as a setter power starts from (the current day, gravity, star …) */
export interface WorldNow { dayHours: number; yearDays: number; axialTilt: number; gravity: number; magnetism: number; luminosity: number; starKind?: string }

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * What the world itself suggests for a value: a power that SETS something of the world starts from what it is now (the
 * length of the day, gravity, the star's brightness and kind), so a cast left untouched changes nothing by surprise.
 */
export function worldPrefill(p: Power, k: string, w: WorldNow | null): unknown {
  if (!w) return undefined;
  switch (p.command) {
    case 'time.day-length': return k === 'hours' ? r1(w.dayHours) : undefined;
    case 'time.year-length': return k === 'days' ? r1(w.yearDays) : undefined;
    case 'time.axial-tilt': return k === 'degrees' ? Math.round((w.axialTilt * 180) / Math.PI) : undefined;
    case 'time.set-hour': return k === 'hour' ? Math.round(w.dayHours / 2) : undefined;
    case 'time.step': return k === 'hours' ? 1 : undefined;
    case 'time.rewind': return k === 'hoursAgo' ? 1 : undefined;
    case 'planet.set':
      if (k === 'gravity') return r1(w.gravity);
      if (k === 'magnetism') return r2(w.magnetism);
      if (k === 'spin') return r1(w.dayHours);
      // (a step warmer: the offset is added to the climate)
      if (k === 'temperatureOffset') return 5;
      return undefined;
    case 'star.set':
      if (k === 'luminosity') return r2(w.luminosity);
      if (k === 'kind') return w.starKind;
      return undefined;
    default: return undefined;
  }
}

/** "its own: 3–6 h" — what an unset parameter will be, in words (the card's value line) */
export function autoWords(book: PowerBook, p: Power, k: string, dayHours = 24): string {
  const known = book.defaultOf(p, k);
  if (k === 'wrath') return `the world's: ${wrathWord(book.wrathLaw)} · ${book.wrathLaw.toFixed(2)}`;
  if (k === 'duration') {
    const life = book.lifeOf(p);
    if (life) {
      const a = fmtTicks(life[0], dayHours), b = fmtTicks(life[1], dayHours);
      const ua = a.replace(/^[\d.]+ /, ''), ub = b.replace(/^[\d.]+ /, '');
      return `its own: ${life[0] === life[1] ? a : ua === ub || `${ua}s` === ub ? `${a.split(' ')[0]}–${b}` : `${a}–${b}`}`;
    }
  }
  if (known !== undefined) return `its own: ${fmtParam(k, known, p.schema[k], dayHours)}`;
  return 'its own';
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
    if (k === 'wrath') return `${wrathWord(v)} · ${v.toFixed(2)}`;
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

/**
 * The sim's `ores` query → the rows the renderer's ore palette takes (hook H12): every deposit kind in content order
 * (base pack, mods, then the god's inventions), its id and colour as they come, so oreType i + 1 crops out in row i's
 * colour and a vein of an invented material shows its own.
 */
export function oreRows(ores: unknown): { id?: string; color?: string }[] {
  if (!Array.isArray(ores)) return [];
  return ores.map((o) => {
    const r = (o && typeof o === 'object' ? o : {}) as { id?: unknown; color?: unknown };
    return { id: typeof r.id === 'string' ? r.id : undefined, color: typeof r.color === 'string' ? r.color : undefined };
  });
}
