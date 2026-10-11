// GENESIS — a new world (CONTRACT.md §16.1 "Esc → scenario menu", §16.10 "new world (scenario picker with seed)"; F3,
// the game menu, Esc during the opening): the scenarios — the barren world (the opening), two worlds, two worlds at the
// age of rockets, a living system, the sandbox — your own system (the star, how many worlds, what kind each is, who lives
// where and at what age), or a saved world; a seed (a fresh random one each time the menu opens, shown, editable); and
// the mod packs of your library to make it with. Beginning reloads the page into the new world (a fresh simulation):
// the world being left is autosaved first when autosave is on.
//
// Your own system is a scenario written as data (a content pack with one scenario, customScenarioPack) — the same
// builder makes it as every other scenario, so its peoples are placed, its climates spun up and its herds set loose by
// the sim's own rules. Each kind of world is placed where the tested scenarios keep it (a jungle at 0.9 AU, an ice world
// at 2.1 AU, a methane world at 3 AU …) and the star's light is matched by distance and greenhouse, so a red dwarf's
// worlds are as livable as a yellow star's — only the light differs.

import type { ContentPack, ScenarioDef, StarDef, SpeciesDef, PlanetKindDef } from '../sim/content.ts';
import { BASE_PACK } from '../data/index.ts';
import type { UiHost } from './host.ts';
import type { ModLibrary, PackEntry } from './mods.ts';
import { packSummary } from './mods.ts';
import { Panel } from './panel.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export interface WorldSlot { kind: string; species: string; era: string }
export interface CustomSpec { star: string; worlds: WorldSlot[] }

export const ERAS_OFFERED = ['stone', 'bronze', 'iron', 'classical', 'medieval', 'steam', 'electric'] as const;
const ERA_WORDS: Record<string, string> = { stone: 'Stone age', bronze: 'Bronze age', iron: 'Iron age', classical: 'Classical age', medieval: 'Middle ages', steam: 'Age of steam', electric: 'Electric age' };

/** where each kind of world sits in the tested scenarios (AU at a yellow star, its year, its overrides) */
const KIND_SLOT: Record<string, { a: number; yearDays: number; overrides: Record<string, unknown>; name: string; moon?: boolean }> = {
  terran: { a: 1.0, yearDays: 12, overrides: {}, name: 'Gaia', moon: true },
  ocean: { a: 1.08, yearDays: 13.4, overrides: { n: 48 }, name: 'Thalassa', moon: true },
  jungle: { a: 0.9, yearDays: 10.3, overrides: { n: 44, climateOffset: -14 }, name: 'Verdance' },
  desert: { a: 1.3, yearDays: 17, overrides: { n: 48, climateOffset: 16 }, name: 'Rust' },
  ice: { a: 2.1, yearDays: 33, overrides: { n: 40, climateOffset: 85 }, name: 'Rime' },
  methane: { a: 3.0, yearDays: 48, overrides: { n: 40, climateOffset: -80 }, name: 'Murk' },
  volcanic: { a: 0.55, yearDays: 5, overrides: { n: 40 }, name: 'Cinder' },
  barren: { a: 0.75, yearDays: 7.8, overrides: { n: 40 }, name: 'Ash' },
};
const MOON = { name: 'Selene', kind: 'moon', orbit: { a: 21000, e: 0.03, inc: 5, node: 23, phase0: 126, periodDays: 2 } };
const PEOPLE_COUNT: Record<string, number> = { 'plains-folk': 40, 'coastal-folk': 50, hive: 60, 'cold-folk': 40, 'methane-drifters': 50 };

/** the kinds of world a people lives well on (mod species: from what they breathe and the warmth they bear) */
export function homeKinds(s: SpeciesDef | undefined): string[] {
  if (!s) return ['terran'];
  const known: Record<string, string[]> = {
    'plains-folk': ['terran', 'jungle', 'ocean'], 'coastal-folk': ['terran', 'ocean', 'jungle'], hive: ['desert', 'terran'], 'cold-folk': ['ice'], 'methane-drifters': ['methane'],
  };
  if (known[s.id]) return known[s.id];
  const t = (s as unknown as { temp?: number[]; breathes?: string }).temp ?? [-10, 5, 30, 45];
  if ((s as unknown as { breathes?: string }).breathes === 'methane') return ['methane'];
  if (t[3] < 15) return ['ice'];
  if (t[0] > 0) return ['desert'];
  return ['terran', 'jungle', 'ocean'];
}

export function encodeWorlds(ws: WorldSlot[]): string {
  return ws.map((w) => `${w.kind}:${w.species}:${w.species ? w.era : ''}`).join(',');
}

export function decodeWorlds(s: string): WorldSlot[] {
  return s.split(',').filter(Boolean).slice(0, 8).map((part) => {
    const [kind, species = '', era = ''] = part.split(':');
    return { kind: kind || 'terran', species, era: era || 'stone' };
  });
}

function hashText(s: string): string {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x.toString(36);
}

/**
 * Your own system as a content pack with one scenario (and its star). Deterministic: the same spec makes the same pack
 * with the same id, so a save of it finds it again. Each kind of world stands where the tested scenarios keep it, moved
 * in toward a dim star and out from a bright one (×√L, within 0.35–1.6×: a red dwarf's worlds huddle close under a
 * big red sun, a blue star's stand far out under a small white one — and the system still fits the system view), and
 * the pack's star is the chosen kind (its colour, size and temper) shining exactly as bright as that distance needs: every
 * world gets the light it has in the tested scenarios, so its climate — and its people — are the tested ones. Each kind
 * keeps the year it has there too (a red dwarf's worlds do not race through three-day years).
 */
export function customScenarioPack(spec: CustomSpec, stars: StarDef[] = (BASE_PACK.stars ?? []) as StarDef[], kinds: PlanetKindDef[] = (BASE_PACK.planetkinds ?? []) as PlanetKindDef[]): ContentPack {
  const star = stars.find((s) => s.id === spec.star) ?? stars.find((s) => s.id === 'G') ?? stars[0];
  const L = Math.max(1e-4, star?.luminosity ?? 1);
  const k = Math.max(0.35, Math.min(1.6, Math.sqrt(L)));
  const id = `custom-${hashText(`${star?.id ?? 'G'}|${encodeWorlds(spec.worlds)}`)}`;
  const used = new Map<string, number>();
  let moonGiven = false;
  const planets = spec.worlds.map((w, i) => {
    const slot = KIND_SLOT[w.kind] ?? { a: 1.6 + 0.4 * i, yearDays: 20, overrides: { n: 40 }, name: (kinds.find((q) => q.id === w.kind)?.name ?? w.kind).split(' ')[0] };
    const dup = used.get(w.kind) ?? 0;
    used.set(w.kind, dup + 1);
    const overrides: Record<string, unknown> = { ...slot.overrides };
    // the first world is the home world: its kind's own (finer) grid; the others a lighter one
    if (i === 0) delete overrides.n;
    else if (overrides.n === undefined) overrides.n = 40;
    const a = Math.round(slot.a * k * (1 + 0.13 * dup) * 1000) / 1000;
    const def: Record<string, unknown> = {
      name: dup ? `${slot.name} ${['II', 'III', 'IV', 'V', 'VI', 'VII'][dup - 1] ?? dup + 1}` : slot.name,
      kind: w.kind,
      orbit: { a, e: 0.012 + 0.008 * i, inc: Math.round(i * 0.9 * 10) / 10, node: (i * 67) % 360, phase0: Math.round((50 + i * 137.5) % 360), yearDays: Math.round(slot.yearDays * Math.pow(1 + 0.13 * dup, 1.5) * 10) / 10 },
    };
    if (Object.keys(overrides).length) def.overrides = overrides;
    if (slot.moon && !moonGiven) { def.moons = [MOON]; moonGiven = true; }
    return def;
  });
  const peoples = spec.worlds.flatMap((w, i) => (w.species ? [{ phase: 4, species: w.species, planet: i, count: PEOPLE_COUNT[w.species] ?? 40, era: w.era || 'stone' }] : []));
  const names = planets.map((p) => p.name as string);
  // the chosen kind of star, as bright as its worlds' distances need (flux at a·k is the tested flux at a)
  const sun = { ...(star ?? { id: 'G', name: 'Yellow star', kind: 'G', temperature: 5750, radius: 11000, activity: 0.15 }), id: `${id}-star`, luminosity: Math.round(k * k * 1e4) / 1e4 } as StarDef;
  const scenario = {
    id, name: 'Your own system',
    description: `${star?.name ?? 'A star'} and ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}.`,
    star: sun.id, starName: 'Aster', focus: 0, startHour: 9.5, peoples, planets,
  } as unknown as ScenarioDef;
  return { id, name: 'Your own system', version: '1', stars: [sun], scenarios: [scenario] };
}

/** the address of a new world (the page reloads into it); keeps the quality and dev switches, drops the rest */
export function newWorldUrl(o: { scenario: string; seed: number; custom?: CustomSpec | null; mods: string[] }, search = location.search): string {
  const old = new URLSearchParams(search);
  const p = new URLSearchParams();
  for (const k of ['quality', 'dev', 'source']) { const v = old.get(k); if (v !== null) p.set(k, v); }
  p.set('scenario', o.scenario);
  p.set('seed', String(Math.max(0, Math.floor(o.seed)) >>> 0));
  if (o.scenario === 'custom' && o.custom) { p.set('star', o.custom.star); p.set('worlds', encodeWorlds(o.custom.worlds)); }
  if (o.mods.length) p.set('mods', o.mods.join(','));
  return `?${p.toString()}`;
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  try { crypto.getRandomValues(a); } catch { a[0] = Math.floor(Math.random() * 4294967295); }
  return a[0] % 1000000000;
}

// ───────────────────────────── the panel ─────────────────────────────

export interface NewWorldDeps {
  host: UiHost;
  library: ModLibrary;
  /** leave for a new world (the App keeps the current one first when autosave is on) */
  begin(url: string): Promise<void>;
  openSaves(): void;
  /** the world now ('barren', seed): the opening's Esc offers to stay */
  world(): { scenario: string; seed: number };
  dev: boolean;
}

interface Card { id: string; name: string; desc: string; icon: string }

const CARDS: Card[] = [
  { id: 'barren', name: 'Barren world', desc: 'One airless rock under a young star, and everything still to do. The opening: breathe, pour, sow — and someone to see it.', icon: 'moon' },
  { id: 'twoworlds', name: 'Two worlds', desc: 'Plains folk in their stone age on a green world, a hive on a warm desert one — and the sky between them.', icon: 'world' },
  { id: 'twoworlds-late', name: 'Two worlds: the age of rockets', desc: 'Both peoples grown into their electric age. Gaia\'s launchpad stands ready; Rust is a light in its telescopes.', icon: 'w-rocket' },
  { id: 'system', name: 'Living system', desc: 'Six worlds and a moon, several peoples at different ages — one at the edge of rockets.', icon: 'orbit' },
  { id: 'sandbox', name: 'Sandbox', desc: 'A temperate world with seas, mountains and rivers, nothing alive yet. Shape it as you like.', icon: 'mountain' },
  { id: 'custom', name: 'Your own system', desc: 'Choose the star, how many worlds and what kind, and who lives where.', icon: 'star' },
];

export class NewWorld {
  readonly panel: Panel;
  private deps: NewWorldDeps;
  private choice = 'barren';
  private seedIn: HTMLInputElement;
  private cardsEl: HTMLDivElement;
  private customEl: HTMLDivElement;
  private modsEl: HTMLDivElement;
  private beginBtn: HTMLButtonElement;
  private noteEl: HTMLDivElement;
  private spec: CustomSpec = { star: 'G', worlds: [{ kind: 'terran', species: 'plains-folk', era: 'stone' }, { kind: 'desert', species: 'hive', era: 'stone' }] };
  private lib: PackEntry[] = [];
  private ticked = new Set<string>();
  private fromOpening = false;
  private leaving = false;

  constructor(parent: HTMLElement, deps: NewWorldDeps) {
    this.deps = deps;
    this.panel = new Panel(parent, { name: 'newworld', title: 'Begin a world', subtitle: 'which world will you make?', icon: 'new-world', place: 'wide', veil: true });
    this.cardsEl = h('div', { class: 'gn-nw-cards', role: 'listbox', aria: { label: 'Worlds' } });
    this.seedIn = h('input', { class: 'gn-text gn-seed', type: 'text', inputmode: 'numeric', spellcheck: 'false', aria: { label: 'Seed' } }) as HTMLInputElement;
    this.seedIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void this.begin(); });
    const dice = h('button', { class: 'gn-btn gn-nw-dice', title: 'Another random seed', aria: { label: 'Another random seed' }, html: icon('dice'), on: { click: () => { this.seedIn.value = String(randomSeed()); deps.host.sound('ui.tick'); } } });
    this.customEl = h('div', { class: 'gn-nw-custom' });
    this.modsEl = h('div', { class: 'gn-nw-mods' });
    this.noteEl = h('div', { class: 'gn-set-note gn-nw-note' });
    this.beginBtn = h('button', { class: 'gn-btn gn-btn-gold gn-nw-begin', text: 'Begin', on: { click: () => void this.begin() } }) as HTMLButtonElement;
    const seedRow = h('div', { class: 'gn-nw-seed' },
      h('label', { class: 'gn-field-l', text: 'Seed' }), this.seedIn, dice,
      h('span', { class: 'gn-set-note', text: 'The same seed and the same acts make the same world.' }));
    this.panel.body.append(this.cardsEl, this.customEl, h('div', { class: 'gn-nw-foot' }, seedRow, this.modsEl, h('div', { class: 'gn-nw-go' }, this.noteEl, this.beginBtn)));
    this.panel.onOpen = () => void this.refresh();
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  /** open (from the opening: the barren card means "stay here") */
  open(o: { fromOpening?: boolean; scenario?: string } = {}): void {
    this.fromOpening = !!o.fromOpening;
    this.choice = o.scenario ?? (this.fromOpening ? 'barren' : this.deps.world().scenario === 'custom' ? 'custom' : CARDS.some((c) => c.id === this.deps.world().scenario) ? this.deps.world().scenario : 'barren');
    this.seedIn.value = String(randomSeed());
    this.panel.setTitle(this.fromOpening ? 'Another world?' : 'Begin a world', this.fromOpening ? 'stay with this one, or choose another' : 'which world will you make?');
    this.panel.open();
  }
  close(): void { this.panel.close(); }

  private async refresh(): Promise<void> {
    try { this.lib = await this.deps.library.list(); } catch { this.lib = []; }
    this.ticked = new Set(this.lib.filter((e) => e.include).map((e) => e.id));
    this.render();
    (this.cardsEl.querySelector('.gn-on') as HTMLElement | null)?.focus();
  }

  /** content the menu offers: the base, with the ticked packs' stars, kinds of world, peoples and scenarios */
  private offered(): { stars: StarDef[]; kinds: PlanetKindDef[]; species: SpeciesDef[]; scenarios: ScenarioDef[] } {
    const packs = [BASE_PACK, ...this.lib.filter((e) => this.ticked.has(e.id)).map((e) => e.json)];
    const merge = <T extends { id: string }>(key: string): T[] => {
      const m = new Map<string, T>();
      for (const p of packs) for (const x of ((p as Record<string, unknown>)[key] as T[] | undefined) ?? []) if (x && typeof x.id === 'string') m.set(x.id, x);
      return [...m.values()];
    };
    return { stars: merge<StarDef>('stars'), kinds: merge<PlanetKindDef>('planetkinds').filter((k) => k.id !== 'moon'), species: merge<SpeciesDef>('species'), scenarios: merge<ScenarioDef>('scenarios') };
  }

  private cards(): Card[] {
    const o = this.offered();
    const extra = o.scenarios.filter((s) => !CARDS.some((c) => c.id === s.id) && s.id !== 'lookdev').map((s) => ({ id: s.id, name: s.name, desc: (s as unknown as { description?: string }).description ?? 'A scenario from a mod pack.', icon: 'mods' }));
    const dev = this.deps.dev ? [{ id: 'lookdev', name: 'Lookdev', desc: 'The render lane\'s test world: forests, rivers, a town and a city.', icon: 'eye' }] : [];
    return [...CARDS, ...extra, ...dev];
  }

  private render(): void {
    const host = this.deps.host;
    clear(this.cardsEl);
    const here = this.deps.world().scenario;
    for (const c of this.cards()) {
      const stay = this.fromOpening && c.id === here;
      const b = h('button', { class: `gn-nw-card${c.id === this.choice ? ' gn-on' : ''}`, role: 'option', aria: { selected: String(c.id === this.choice) }, data: { id: c.id } },
        h('span', { class: 'gn-nw-ic', html: icon(c.icon) }),
        h('span', { class: 'gn-nw-ct' }, h('span', { class: 'gn-nw-name', text: c.name }), h('small', { text: stay ? 'You are here: stay, and go on as you were.' : c.desc })));
      b.addEventListener('click', () => { this.choice = c.id; host.sound('ui.tick'); this.render(); });
      b.addEventListener('dblclick', () => { this.choice = c.id; void this.begin(); });
      this.cardsEl.append(b);
    }
    const load = h('button', { class: 'gn-nw-card gn-nw-load' }, h('span', { class: 'gn-nw-ic', html: icon('save') }),
      h('span', { class: 'gn-nw-ct' }, h('span', { class: 'gn-nw-name', text: 'A saved world' }), h('small', { text: 'Return to a kept moment, or import a file.' })));
    load.addEventListener('click', () => { this.close(); this.deps.openSaves(); });
    this.cardsEl.append(load);
    this.renderCustom();
    this.renderMods();
    const stay = this.fromOpening && this.choice === here;
    this.beginBtn.textContent = this.leaving ? 'Keeping this world…' : stay ? 'Stay' : 'Begin';
    this.beginBtn.disabled = this.leaving;
    this.noteEl.textContent = stay ? '' : here && host.source === 'worker' && host.prefs.value.game.autosaveMinutes > 0 ? 'This world is kept as the autosave before you leave it.' : '';
  }

  private renderCustom(): void {
    clear(this.customEl);
    this.customEl.hidden = this.choice !== 'custom';
    if (this.choice !== 'custom') return;
    const o = this.offered();
    const sp = this.spec;
    const sel = (opts: { value: string; label: string }[], v: string, on: (x: string) => void, label: string) => {
      const s = h('select', { class: 'gn-select', aria: { label } }) as HTMLSelectElement;
      for (const x of opts) s.append(h('option', { value: x.value, text: x.label }));
      s.value = v;
      s.addEventListener('change', () => { on(s.value); this.deps.host.sound('ui.tick'); this.render(); });
      s.addEventListener('keydown', (e) => e.stopPropagation());
      return s;
    };
    const starSel = sel(o.stars.map((s) => ({ value: s.id, label: `${s.name}${s.id.length <= 2 ? ` (${s.id})` : ''}` })), sp.star, (v) => { sp.star = v; }, 'Star');
    const count = h('div', { class: 'gn-nw-count' },
      h('button', { class: 'gn-btn', text: '−', title: 'One world fewer', aria: { label: 'One world fewer' }, disabled: sp.worlds.length <= 1, on: { click: () => { if (sp.worlds.length > 1) { sp.worlds.pop(); this.render(); } } } }),
      h('span', { class: 'gn-nw-n', text: `${sp.worlds.length} world${sp.worlds.length > 1 ? 's' : ''}` }),
      h('button', { class: 'gn-btn', text: '+', title: 'One world more', aria: { label: 'One world more' }, disabled: sp.worlds.length >= 6, on: { click: () => { if (sp.worlds.length < 6) { sp.worlds.push({ kind: ['ice', 'methane', 'volcanic', 'jungle', 'ocean', 'barren'][sp.worlds.length % 6], species: '', era: 'stone' }); this.render(); } } } }));
    const lum = o.stars.find((s) => s.id === sp.star)?.luminosity ?? 1;
    this.customEl.append(h('div', { class: 'gn-nw-row' }, h('label', { class: 'gn-field-l', text: 'The star' }), starSel,
      h('span', { class: 'gn-set-note', text: lum > 10 ? 'A fierce light: its worlds stand far out.' : lum < 0.1 ? 'A dim light: its worlds huddle close.' : 'Its worlds stand where its light is kind.' }), count));
    const pack = customScenarioPack(sp, o.stars, o.kinds);
    const planets = ((pack.scenarios?.[0] as unknown as { planets: { name: string; orbit: { a: number } }[] }).planets);
    sp.worlds.forEach((w, i) => {
      const kindSel = sel(o.kinds.map((k) => ({ value: k.id, label: k.name })), w.kind, (v) => { w.kind = v; }, `World ${i + 1}: kind`);
      const spSel = sel([{ value: '', label: 'Nobody yet' }, ...o.species.map((s) => ({ value: s.id, label: s.name }))], w.species, (v) => {
        w.species = v;
        // a people chosen for an empty world: the world becomes one they can live on, unless the player already chose
        const fit = homeKinds(o.species.find((s) => s.id === v));
        if (v && !fit.includes(w.kind) && i > 0) w.kind = fit[0];
      }, `World ${i + 1}: who lives there`);
      const eraSel = sel(ERAS_OFFERED.map((e) => ({ value: e, label: ERA_WORDS[e] })), w.era, (v) => { w.era = v; }, `World ${i + 1}: their age`);
      eraSel.disabled = !w.species;
      const fit = w.species ? homeKinds(o.species.find((s) => s.id === w.species)) : null;
      const warn = fit && !fit.includes(w.kind)
        ? h('div', { class: 'gn-nw-warn' }, h('span', { html: icon('help') }),
          `${o.species.find((s) => s.id === w.species)?.name ?? w.species} would not live long on a ${(o.kinds.find((k) => k.id === w.kind)?.name ?? w.kind).toLowerCase()}. `,
          h('button', { class: 'gn-linkbtn', text: `Make it a ${(o.kinds.find((k) => k.id === fit[0])?.name ?? fit[0]).toLowerCase()}`, on: { click: () => { w.kind = fit[0]; this.render(); } } }))
        : null;
      const p = planets[i];
      this.customEl.append(h('div', { class: 'gn-nw-world' },
        h('div', { class: 'gn-nw-wname' }, h('span', { class: 'gn-nw-wn', text: p?.name ?? `World ${i + 1}` }), h('small', { text: i === 0 ? `home · ${p?.orbit.a.toFixed(2)} AU` : `${p?.orbit.a.toFixed(2)} AU` })),
        kindSel, spSel, eraSel, warn));
    });
  }

  private renderMods(): void {
    clear(this.modsEl);
    if (!this.lib.length) {
      this.modsEl.append(h('span', { class: 'gn-set-note', text: `Mod packs: none in your library yet (Mods, ${this.deps.host.keybinds.hint('ui.mods') || 'F8'}).` }));
      return;
    }
    this.modsEl.append(h('span', { class: 'gn-field-l', text: 'Mod packs' }));
    for (const e of this.lib) {
      const on = this.ticked.has(e.id);
      const b = h('button', { class: `gn-nw-mod${on ? ' gn-on' : ''}`, role: 'checkbox', aria: { checked: String(on) }, title: `${e.id}${e.version ? ` ${e.version}` : ''} · ${packSummary(e.json)}` },
        h('span', { class: 'gn-nw-box', html: on ? icon('check') : '' }), e.name);
      b.addEventListener('click', () => {
        if (this.ticked.has(e.id)) this.ticked.delete(e.id); else this.ticked.add(e.id);
        e.include = this.ticked.has(e.id);
        void this.deps.library.put(e).catch(() => { /* the choice lasts this menu */ });
        this.deps.host.sound('ui.toggle');
        this.render();
      });
      this.modsEl.append(b);
    }
  }

  /** begin the chosen world (or stay, from the opening) */
  async begin(): Promise<void> {
    if (this.leaving) return;
    const w = this.deps.world();
    if (this.fromOpening && this.choice === w.scenario) { this.close(); return; }
    const seed = Number(this.seedIn.value.replace(/[^\d]/g, '')) || randomSeed();
    const url = newWorldUrl({ scenario: this.choice, seed, custom: this.choice === 'custom' ? this.spec : null, mods: [...this.ticked] });
    this.leaving = true;
    this.render();
    try { await this.deps.begin(url); } finally { this.leaving = false; if (this.isOpen) this.render(); }
  }

  /** test surface */
  state(): { choice: string; seed: string; custom: CustomSpec; ticked: string[] } {
    return { choice: this.choice, seed: this.seedIn.value, custom: JSON.parse(JSON.stringify(this.spec)) as CustomSpec, ticked: [...this.ticked] };
  }
  choose(id: string): void { this.choice = id; this.render(); }
  setSpec(s: Partial<CustomSpec>): void { if (s.star) this.spec.star = s.star; if (s.worlds) this.spec.worlds = s.worlds.map((w) => ({ ...w })); this.render(); }
}
