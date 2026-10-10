// GENESIS — the inspector (CONTRACT.md §16.6, §1.6 "inspector biographies"): click anything and read it, and act on it.
// A dark glass card on the right that exists only while something is selected:
//   person     biography: name, people, age, role, what they are doing, family, health, mood, needs, skills, traits,
//              knowledge, memories, faith
//   settlement population, era, rule, neighbours, people, belief, library, stores, buildings, stories, language
//   building · herd · cell (fields, biome, plants, ore) · species (a people: body, needs, lands)
//   disaster   kind, strength, reach, life — with Cancel, Scale, Move, Freeze
//   weather    kind, strength, reach, drift — Clear, paint more
//   creature   body, alignment, hunger, energy, desires, miracles learned, leash — Reward, Punish, Leash, Mode, Teach,
//              Grow, Rename, Release
//   ship       kind, phase, crew, route, log — Recall, Destroy
//   world      the laws of the world: every registered parameter, editable live (set <path> <value>)
// Every card ends with the powers that act on that kind of thing (generated from powers.json): a click arms the power
// with the selection (the tool card then offers "Cast on …").
//
// Data comes from sim.query ('agent', 'settlement', 'building', 'herds', 'cell', 'species', 'disaster', 'creature',
// 'ship', 'params', 'planet'); the card re-asks every ~1.2 s while open. A person who dies while selected keeps their
// card, marked as such.

import type { EntityRef, CommandResult, Command } from '../sim/types.ts';
import type { InspectRef } from './host.ts';
import type { Power, PowerBook } from './powers.ts';
import { h, cap, clear, fmtNum, fmtDist, fmtTicks, fmtLatLon } from './dom.ts';
import { icon } from './icons.ts';
import { slider, toggle } from './panel.ts';

export interface InspectorDeps {
  query(q: string, args: Record<string, unknown>): Promise<unknown>;
  cmd(c: Command): Promise<CommandResult>;
  /** calendar date of a tick on a planet ("Year 2, day 7") */
  date(planet: number, tick: number): string;
  /** select something else (a link in the card) */
  select(ref: InspectRef | null): void;
  /** fly the camera to the selected thing / keep it in view */
  lookAt(ref: EntityRef): void;
  follow(ref: EntityRef | null): void;
  isFollowing(ref: EntityRef): boolean;
  powers: PowerBook;
  /** arm a power with the selection (and preset values) */
  arm(p: Power, preset?: Record<string, unknown>): void;
  /** live views of disasters / weather / ships / creatures (the mirror) */
  live(ref: InspectRef): Record<string, unknown> | null;
  planetName(id: number): string;
  dayHours(planet: number): number;
  /** an action's key as people read it (titles follow rebinding) */
  hint?(id: string): string;
}

type Rec = Record<string, unknown>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}`;

const NEED_LABEL: Record<string, string> = {
  food: 'Food', water: 'Water', warmth: 'Warmth', rest: 'Rest', safety: 'Safety', belonging: 'Belonging', status: 'Standing',
  curiosity: 'Curiosity', faith: 'Faith', methane: 'Methane', wetness: 'Wetness', hive: 'Hive',
};
const TRAIT_WORDS: Record<string, [string, string]> = {
  curiosity: ['incurious', 'curious'], boldness: ['timid', 'bold'], sociability: ['solitary', 'sociable'], piety: ['sceptical', 'pious'],
  aggression: ['gentle', 'fierce'], diligence: ['idle', 'diligent'], conservatism: ['open to new ways', 'set in the old ways'],
};
const KIND_LABEL: Record<string, string> = {
  agent: 'Person', animal: 'Herd', building: 'Building', settlement: 'Settlement', cell: 'Place', species: 'A people', disaster: 'Disaster',
  weather: 'Weather', creature: 'Creature', ship: 'Ship', planet: 'World',
};
/** which power-entity kinds a selection kind answers to (a herd is picked as an animal) */
const POWER_KIND: Record<string, string> = { agent: 'agent', settlement: 'settlement', disaster: 'disaster', creature: 'creature', ship: 'ship', planet: 'planet', animal: 'animal', building: 'building' };

/** groups of the laws of the world, by path prefix */
const LAW_GROUPS: [RegExp, string][] = [
  [/^planet\.atmosphere\./, 'The air'], [/^(planet|orbit)\./, 'The world'], [/^star\./, 'The star'], [/^(climate|weather)\./, 'Climate and weather'],
  [/^(hydro|fire|vegetation|terrain)\./, 'Nature\'s pace'], [/^species\./, 'The peoples'], [/^(disasters|world)\./, 'Disasters'],
  [/^(belief|creature|hand|rivals|restraint|miracles)\./, 'The god'], [/^space\./, 'Ships and space'], [/^sim\./, 'The simulation'],
];

export class Inspector {
  readonly root: HTMLDivElement;
  private deps: InspectorDeps;
  private head: HTMLDivElement;
  private body: HTMLDivElement;
  private ref: InspectRef | null = null;
  private data: Rec | null = null;
  private gone = false;
  private lastAsk = -1e9;
  private asking = false;
  private gen = 0;
  private followBtn: HTMLButtonElement;
  private lookBtn: HTMLButtonElement;
  /** laws card: the path to scroll to, and edits in flight (the card does not re-render under the slider) */
  private lawFocus: string | null = null;
  private editing = 0;
  /** a press inside the card is under way (a re-render now would eat the click): the fresh record waits */
  private pressing = false;
  private stale = false;

  constructor(parent: HTMLElement, deps: InspectorDeps) {
    this.deps = deps;
    this.root = el('div', 'gn-panel gn-insp');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inspector');
    this.root.hidden = true;
    const bar = el('div', 'gn-insp-bar');
    this.head = el('div', 'gn-insp-head');
    const tools = el('div', 'gn-insp-tools');
    this.lookBtn = el('button', 'gn-btn gn-insp-tool', 'Look');
    this.lookBtn.type = 'button';
    this.lookBtn.addEventListener('mouseenter', () => { const k = this.deps.hint?.('cam.look'); this.lookBtn.title = `Fly the camera here${k ? ` (${k})` : ''}`; });
    this.lookBtn.addEventListener('click', () => { const r = this.entity(); if (r) this.deps.lookAt(r); });
    this.followBtn = el('button', 'gn-btn gn-insp-tool', 'Follow');
    this.followBtn.type = 'button';
    this.followBtn.addEventListener('mouseenter', () => { const k = this.deps.hint?.('cam.follow'); this.followBtn.title = `Keep the camera on them${k ? ` (${k})` : ''}`; });
    this.followBtn.addEventListener('click', () => {
      const r = this.entity();
      if (!r) return;
      this.deps.follow(this.deps.isFollowing(r) ? null : r);
      this.syncFollow();
    });
    const close = el('button', 'gn-btn gn-insp-close');
    close.type = 'button';
    close.addEventListener('mouseenter', () => { const k = this.deps.hint?.('tool.cancel'); close.title = `Close${k ? ` (${k})` : ''}`; });
    close.setAttribute('aria-label', 'Close the inspector');
    close.innerHTML = icon('close');
    close.addEventListener('click', () => this.deps.select(null));
    tools.append(this.lookBtn, this.followBtn, close);
    bar.append(this.head, tools);
    this.body = el('div', 'gn-insp-body');
    this.root.append(bar, this.body);
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.root.addEventListener('pointerdown', () => { this.pressing = true; }, true);
    const up = () => { this.pressing = false; };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    parent.appendChild(this.root);
  }

  get selected(): InspectRef | null { return this.ref; }
  get isOpen(): boolean { return !this.root.hidden; }

  /** the selection as an entity the camera can look at / follow (a species or a cell cannot be followed) */
  private entity(): EntityRef | null {
    const r = this.ref;
    if (!r || r.kind === 'species') return null;
    return r as EntityRef;
  }

  /** open the card on a thing (null closes it); a law path focuses the laws card on it */
  open(ref: InspectRef | null, lawPath?: string): void {
    this.gen++;
    this.ref = ref;
    this.data = null;
    this.gone = false;
    this.asking = false;
    this.lawFocus = lawPath ?? null;
    if (!ref) { this.root.hidden = true; return; }
    this.root.hidden = false;
    this.root.classList.toggle('gn-insp-wide', ref.kind === 'planet');
    clear(this.head);
    this.head.append(el('div', 'gn-insp-kind', KIND_LABEL[ref.kind] ?? cap(ref.kind)), el('div', 'gn-insp-name', '…'));
    clear(this.body);
    this.body.append(el('div', 'gn-insp-wait', 'Asking the world…'));
    const followable = ref.kind === 'agent' || ref.kind === 'animal' || ref.kind === 'creature' || ref.kind === 'disaster' || ref.kind === 'ship' || ref.kind === 'weather';
    this.followBtn.hidden = !followable;
    this.lookBtn.hidden = ref.kind === 'species';
    this.syncFollow();
    this.lastAsk = -1e9;
    this.tick(performance.now());
  }

  private syncFollow(): void {
    const r = this.entity();
    this.followBtn.classList.toggle('gn-on', !!r && this.deps.isFollowing(r));
  }

  /** refresh while open (call every frame; it asks the sim at most every ~1.2 s, the laws every 3 s) */
  tick(now: number): void {
    const ref = this.ref;
    if (!ref || this.asking || this.gone) return;
    if (this.stale && !this.busy()) { this.stale = false; this.render(); }
    const every = ref.kind === 'planet' ? 3000 : ref.kind === 'species' || ref.kind === 'cell' ? 4000 : 1200;
    if (now - this.lastAsk < every || this.editing > 0 && now - this.editing < 2500) return;
    this.lastAsk = now;
    this.asking = true;
    const gen = this.gen;
    void this.ask(ref).then((rec) => {
      if (gen !== this.gen) return;
      this.asking = false;
      if (rec && rec.lookdev) {
        clear(this.head);
        this.header(KIND_LABEL[ref.kind] ?? cap(ref.kind), `A ${ref.kind === 'agent' ? 'figure' : ref.kind} of the lookdev world`, '');
        clear(this.body);
        this.body.append(el('div', 'gn-insp-wait', 'This world is fabricated for the look: nobody here has a story. Run the living simulation (source=worker) to meet its people.'));
        this.gone = true;
        return;
      }
      if (!rec) {
        if (this.data) { this.gone = true; this.render(); }
        else { clear(this.body); this.body.append(el('div', 'gn-insp-wait', ref.kind === 'agent' ? 'No one by that name lives now.' : 'Nothing is there any more.')); }
        return;
      }
      this.data = rec;
      if (this.busy()) { this.stale = true; return; }
      this.render();
    }).catch(() => { if (gen === this.gen) this.asking = false; });
  }

  /** the player is in the middle of using the card: a press, an open list, a name being typed */
  private busy(): boolean {
    if (this.pressing) return true;
    const a = document.activeElement;
    return !!a && this.root.contains(a) && (a instanceof HTMLSelectElement || (a instanceof HTMLInputElement && a.type !== 'range' && a.type !== 'checkbox'));
  }

  private async ask(ref: InspectRef): Promise<Rec | null> {
    const planet = ref.planet;
    const q = this.deps.query;
    const obj = (d: unknown): Rec | null => (d && typeof d === 'object' && !Array.isArray(d) ? d as Rec : null);
    switch (ref.kind) {
      case 'animal': {
        const d = await q('herds', { planet });
        if (d && typeof d === 'object' && (d as Rec).lookdev) return d as Rec;
        return Array.isArray(d) ? ((d as Rec[]).find((x) => x.id === ref.id) ?? null) : null;
      }
      case 'cell': return obj(await q('cell', { planet, cell: ref.id }));
      case 'species': return obj(await q('species', { planet, id: (ref as { key?: string }).key ?? '' }));
      case 'disaster': {
        const live = this.deps.live(ref);
        const d = obj(await q('disaster', { id: ref.id }));
        return d ? { ...d, live } : live;
      }
      case 'weather': return this.deps.live(ref);
      case 'creature': {
        const d = obj(await q('creature', { id: ref.id }));
        return d ? { ...d, live: this.deps.live(ref) } : null;
      }
      case 'ship': return obj(await q('ship', { id: ref.id }));
      case 'planet': {
        const [laws, info] = await Promise.all([q('params', { planet: ref.id }), q('planet', { planet: ref.id })]);
        if (laws && typeof laws === 'object' && (laws as Rec).lookdev) return laws as Rec;
        return { laws: Array.isArray(laws) ? laws : [], info: obj(info) };
      }
      default: return obj(await q(ref.kind, { id: ref.id, planet }));
    }
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private render(): void {
    const ref = this.ref, d = this.data;
    if (!ref || !d) return;
    const scroll = this.body.scrollTop;
    // the keyboard / gamepad focus survives the refresh: the same control (by its place in the card) is focused again
    const focusables = () => Array.from(this.root.querySelectorAll<HTMLElement>('button, select, input'));
    const fa = document.activeElement as HTMLElement | null;
    const fi = fa && this.body.contains(fa) ? focusables().indexOf(fa) : -1;
    clear(this.body);
    clear(this.head);
    switch (ref.kind) {
      case 'agent': this.agent(ref as EntityRef, d); break;
      case 'building': this.building(ref as EntityRef, d); break;
      case 'settlement': this.settlement(ref as EntityRef, d); break;
      case 'animal': this.herd(d); break;
      case 'cell': this.cell(ref as EntityRef, d); break;
      case 'species': this.species(d); break;
      case 'disaster': this.disaster(ref as EntityRef, d); break;
      case 'weather': this.weather(ref as EntityRef, d); break;
      case 'creature': this.creature(ref as EntityRef, d); break;
      case 'ship': this.ship(ref as EntityRef, d); break;
      case 'planet': this.planet(ref as EntityRef, d); break;
      default: this.head.append(el('div', 'gn-insp-name', cap(ref.kind)));
    }
    // a disaster's card has its own controls (cancel, scale, move, freeze): the powers row would repeat them
    if (ref.kind !== 'planet' && ref.kind !== 'disaster' && !this.gone) this.powerRow(ref);
    if (ref.kind === 'planet' && this.lawFocus) {
      const row = this.body.querySelector(`[data-law="${CSS.escape(this.lawFocus)}"]`);
      if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('gn-flash'); this.lawFocus = null; return; }
    }
    this.body.scrollTop = scroll;
    if (fi >= 0) focusables()[fi]?.focus({ preventScroll: true });
    this.syncFollow();
  }

  private header(kind: string, name: string, sub: string): void {
    this.head.append(el('div', 'gn-insp-kind', kind), el('div', 'gn-insp-name', name));
    if (sub) this.head.append(el('div', 'gn-insp-sub', sub));
  }

  private section(title: string, extra?: string, parent: HTMLElement = this.body): HTMLDivElement {
    const s = el('div', 'gn-insp-sec');
    const hh = el('div', 'gn-insp-sec-h', title);
    if (extra) hh.append(el('span', 'gn-insp-sec-x', extra));
    s.append(hh);
    parent.append(s);
    return s;
  }

  private bar(parent: HTMLElement, label: string, v: number, tone = '', valueText?: string): void {
    const row = el('div', 'gn-insp-bar-row');
    const l = el('span', 'gn-insp-bar-l', label);
    const track = el('span', 'gn-insp-track');
    const fill = el('span', `gn-insp-fill ${tone}`);
    fill.style.width = `${pct(v)}%`;
    if (!tone && v < 0.25) fill.classList.add('gn-low');
    track.append(fill);
    row.append(l, track, el('span', 'gn-insp-bar-v', valueText ?? pct(v)));
    parent.append(row);
  }

  private kv(parent: HTMLElement, k: string, v: string | HTMLElement): void {
    const row = el('div', 'gn-insp-kv');
    row.append(el('span', 'gn-insp-k', k));
    const val = el('span', 'gn-insp-v');
    if (typeof v === 'string') val.textContent = v; else val.append(v);
    row.append(val);
    parent.append(row);
  }

  private link(text: string, ref: InspectRef): HTMLButtonElement {
    const a = el('button', 'gn-insp-link', text);
    a.type = 'button';
    a.addEventListener('click', () => this.deps.select(ref));
    return a;
  }

  private chips(parent: HTMLElement, items: string[], max = 18, cls = ''): void {
    const wrap = el('div', 'gn-insp-chips');
    for (const it of items.slice(0, max)) wrap.append(el('span', `gn-chip ${cls}`, it));
    if (items.length > max) wrap.append(el('span', 'gn-chip gn-chip-more', `+${items.length - max}`));
    if (!items.length) wrap.append(el('span', 'gn-insp-none', 'none'));
    parent.append(wrap);
  }

  /** a row of act buttons (Cancel, Freeze, …) */
  private acts(parent: HTMLElement, list: { label: string; icon: string; title?: string; run: () => void; on?: boolean }[]): void {
    const wrap = el('div', 'gn-insp-acts');
    for (const a of list) {
      const b = h('button', { class: `gn-btn gn-insp-act${a.on ? ' gn-on' : ''}`, title: a.title ?? a.label }, h('span', { html: icon(a.icon) }), a.label);
      b.addEventListener('click', () => a.run());
      wrap.append(b);
    }
    parent.append(wrap);
  }

  private async act(c: Command): Promise<void> {
    await this.deps.cmd(c);
    this.lastAsk = -1e9; // refresh at once
  }

  /** the powers that act on this kind of thing: a click arms the power with the selection */
  private powerRow(ref: InspectRef): void {
    const kind = POWER_KIND[ref.kind];
    if (!kind) return;
    const list = this.deps.powers.list.filter((p) => Object.values(p.schema).some((s) => s.type === 'entity' && (s.entity ?? []).includes(kind)));
    // a cell: the place powers
    if (!list.length) return;
    const sec = this.section('Powers', `${list.length}`);
    const wrap = el('div', 'gn-insp-pows');
    for (const p of list) {
      const b = h('button', { class: 'gn-insp-pow', title: `${p.name} — ${p.desc}`, html: icon(p.icon, p.category) });
      b.addEventListener('click', () => this.deps.arm(p));
      wrap.append(b);
    }
    sec.append(wrap);
  }

  // ───────────────────────────── kinds ─────────────────────────────

  private agent(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? 0;
    const sex = str(d.sex);
    const age = num(d.age);
    const role = str(d.role);
    const caste = str(d.caste);
    const sp = str(d.speciesName, str(d.species));
    const ageText = age < 1 ? 'an infant' : `${age < 10 ? age.toFixed(1) : Math.floor(age)} years`;
    const sub = [cap(sp), sex, ageText, caste ? `${caste} caste` : role && role !== 'none' ? role : ''].filter(Boolean).join(' · ');
    this.header(this.gone ? 'Person · died' : 'Person', str(d.name, 'Someone'), sub);
    const st = d.settlement as Rec | null;
    const now = el('div', 'gn-insp-doing');
    if (this.gone) now.textContent = 'Has died. This is how the world remembers them.';
    else {
      now.append(document.createTextNode(cap(str(d.doing, 'resting'))));
      if (st) { now.append(document.createTextNode(st.band ? ', with ' : ' · ')); now.append(this.link(str(st.name), { kind: 'settlement', id: num(st.id), planet })); }
    }
    this.body.append(now);
    const flags: string[] = [];
    if (d.sick && !this.gone) flags.push(`sick: ${str(d.sick)}`);
    const master = Array.isArray(d.master) ? (d.master as string[]) : [];
    if (master.length) flags.push(`master of ${master.join(', ')}`);
    if (num(d.flags) & 16) flags.push('disciple of the god');
    if (num(d.flags) & 32) flags.push('possessed by the god');
    if (num(d.flags) & 8) flags.push('leader');
    if (flags.length) this.chips(this.body, flags, 6, 'gn-chip-flag');
    if (typeof d.species === 'string') {
      const spl = el('div', 'gn-insp-line');
      spl.append(document.createTextNode('Of the '), this.link(sp || str(d.species), { kind: 'species', id: 0, planet, key: str(d.species) }));
      this.body.append(spl);
    }
    // the dead have no health, mood or needs left to show: their card is a biography
    if (!this.gone) {
      const vit = this.section('Body and mind');
      this.bar(vit, 'Health', num(d.health), 'gn-health');
      this.bar(vit, 'Mood', num(d.mood), 'gn-mood');
    }
    const needs = (d.needs ?? {}) as Record<string, number>;
    const nk = this.gone ? [] : Object.keys(needs);
    if (nk.length) {
      const sec = this.section('Needs', 'met');
      const grid = el('div', 'gn-insp-grid');
      for (const k of nk) this.bar(grid, NEED_LABEL[k] ?? cap(k), num(needs[k]));
      sec.append(grid);
    }
    const faith = (d.faith ?? null) as Rec | null;
    if (faith) {
      const sec = this.section('Toward the god');
      this.bar(sec, 'Love', num(faith.love), 'gn-love');
      this.bar(sec, 'Fear', num(faith.fear), 'gn-fear');
    }
    const skills = Object.entries((d.skills ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (skills.length) {
      const sec = this.section('Skills');
      for (const [k, v] of skills) this.bar(sec, cap(k) + (v >= 0.7 ? ' ★' : ''), v, 'gn-skill');
    }
    const traits = Object.entries((d.traits ?? {}) as Record<string, number>)
      .filter(([k, v]) => TRAIT_WORDS[k] && Math.abs(v - 0.5) > 0.15)
      .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
      .map(([k, v]) => TRAIT_WORDS[k][v > 0.5 ? 1 : 0]);
    if (traits.length) { const sec = this.section('Nature'); this.chips(sec, traits.slice(0, 5), 5, 'gn-chip-trait'); }
    const know = Array.isArray(d.knowledge) ? (d.knowledge as string[]) : [];
    const ks = this.section('Knows', `${know.length}`);
    this.chips(ks, know, 16);
    const fam = (d.family ?? {}) as Rec;
    const kids = Array.isArray(fam.children) ? (fam.children as string[]) : [];
    if (fam.mother || fam.father || fam.partner || kids.length) {
      const sec = this.section('Family');
      if (fam.partner) this.kv(sec, 'Partner', str(fam.partner));
      if (fam.mother || fam.father) this.kv(sec, 'Parents', [fam.mother, fam.father].filter(Boolean).map((x) => str(x)).join(' and '));
      if (kids.length) this.kv(sec, kids.length === 1 ? 'Child' : 'Children', kids.join(', '));
    }
    const inv = Array.isArray(d.inventory) ? (d.inventory as Rec[]) : [];
    if (inv.length || d.tool || d.wearing) {
      const sec = this.section('Carries');
      if (d.tool) this.kv(sec, 'Tool', str(d.tool));
      if (d.wearing) this.kv(sec, 'Wears', str(d.wearing));
      if (inv.length) this.kv(sec, 'Pack', inv.map((x) => `${str(x.item)}${num(x.qty) > 1.05 ? ` ×${Math.round(num(x.qty))}` : ''}`).join(', '));
    }
    const mem = Array.isArray(d.memories) ? (d.memories as Rec[]) : [];
    if (mem.length) {
      const sec = this.section('Remembers');
      const list = el('ol', 'gn-insp-mem');
      // the same memory again and again (eight gifts from the sky) is one line: the latest date and how often
      const byText = new Map<string, { tick: number; n: number; text: string }>();
      for (const m of mem) {
        const text = cap(str(m.text));
        const g = byText.get(text);
        if (g) { g.n++; g.tick = Math.max(g.tick, num(m.tick)); } else byText.set(text, { tick: num(m.tick), n: 1, text });
      }
      for (const g of [...byText.values()].sort((a, b) => b.tick - a.tick)) {
        const li = el('li');
        const t = el('span', 'gn-insp-mem-t', g.text);
        if (g.n > 1) t.append(el('span', 'gn-insp-mem-n', ` ×${g.n}`));
        li.append(el('span', 'gn-insp-mem-d', this.deps.date(planet, g.tick)), t);
        list.append(li);
      }
      sec.append(list);
    }
  }

  private building(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? 0;
    const name = str(d.name, 'A building');
    const mat = str(d.material);
    const fn = str(d.function);
    this.header(this.gone ? 'Building · gone' : 'Building', name, [mat ? cap(mat.replace(/-/g, ' ')) : '', fn && fn !== name.toLowerCase() ? fn : ''].filter(Boolean).join(' · '));
    const where = el('div', 'gn-insp-doing');
    const sid = num(d.settlement, -1);
    if (sid >= 0 && d.settlementName) { where.append(document.createTextNode('Of ')); where.append(this.link(str(d.settlementName), { kind: 'settlement', id: sid, planet })); }
    else where.textContent = 'No one claims it.';
    this.body.append(where);
    const sec = this.section('State');
    const progress = num(d.progress, 1);
    if (progress < 0.999) this.bar(sec, 'Built', progress, 'gn-skill');
    this.bar(sec, 'Sound', 1 - num(d.damage), 'gn-health');
    const flags = num(d.flags);
    const st: string[] = [];
    if (flags & 1) st.push('burning');
    if (flags & 2) st.push('in ruins');
    if (flags & 4) st.push('abandoned');
    if (flags & 8) st.push('sacred');
    if (d.lit) st.push('a fire burns');
    if (st.length) this.chips(sec, st, 6, 'gn-chip-flag');
    if (num(d.occupants) > 0) this.kv(sec, 'Inside', `${num(d.occupants)} ${num(d.occupants) === 1 ? 'person' : 'people'}`);
    const books = Array.isArray(d.books) ? (d.books as string[]).filter(Boolean) : [];
    if (books.length) { const b = this.section('Written here', `${books.length}`); this.chips(b, books, 16, 'gn-chip-book'); }
    this.acts(this.body, [
      { label: 'Lift it', icon: 'grab', title: 'Take it in the hand (small buildings)', run: () => void this.act({ k: 'hand.grab', planet, target: { kind: 'building', id: ref.id } }) },
      { label: 'Mend', icon: 'stroke', title: 'Smooth its cracks (stroke)', run: () => void this.act({ k: 'hand.stroke', planet, target: { kind: 'building', id: ref.id } }) },
      { label: 'Crack', icon: 'slap', title: 'Strike its walls (slap)', run: () => void this.act({ k: 'hand.slap', planet, target: { kind: 'building', id: ref.id } }) },
    ]);
  }

  private settlement(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? 0;
    const pop = num(d.population);
    const coh = (d.cohort ?? {}) as Rec;
    const cohort = num(coh.children) + num(coh.adults) + num(coh.elders);
    const sp = str(d.speciesName, str(d.species));
    const era = str(d.era);
    this.header(d.fallen ? 'Settlement · fallen' : d.band ? 'Band' : 'Settlement', str(d.name, 'A settlement'),
      [cap(sp), era ? `${era} age` : '', `${pop} ${pop === 1 ? 'soul' : 'souls'}`].filter(Boolean).join(' · '));
    const line = el('div', 'gn-insp-doing');
    const f = d.founded as Rec | null;
    const feature = str(d.feature);
    line.textContent = d.band ? 'Wandering, looking for a place to live.'
      : `${f ? `Founded in year ${num(f.year)}, day ${num(f.day)}` : 'Founded before memory'}${feature && feature !== 'plain' ? `, by the ${feature}` : ''}.`;
    this.body.append(line);
    if (typeof d.species === 'string') {
      const spl = el('div', 'gn-insp-line');
      spl.append(document.createTextNode('A people: '), this.link(sp || str(d.species), { kind: 'species', id: 0, planet, key: str(d.species) }));
      this.body.append(spl);
    }
    const badges: string[] = [];
    if (d.age === 'golden') badges.push('a golden age');
    if (d.age === 'dark') badges.push('a dark age');
    if (d.epidemic) badges.push(`plague: ${str(d.epidemic)}`);
    if (d.besieged) badges.push('under siege');
    const rel = Array.isArray(d.relations) ? (d.relations as Rec[]) : [];
    if (rel.some((r) => r.atWar)) badges.push('at war');
    if (badges.length) this.chips(this.body, badges, 6, 'gn-chip-flag');
    const lead = d.leader as Rec | null;
    const pol = d.polity as Rec | null;
    if (lead || (pol && pol.name)) {
      const g = this.section('Rule');
      if (lead) {
        const who = el('span');
        if (lead.title) who.append(document.createTextNode(`${cap(str(lead.title))} `));
        who.append(this.link(str(lead.name), { kind: 'agent', id: num(lead.id), planet }));
        this.kv(g, 'Led by', who);
      }
      if (pol && pol.name) this.kv(g, 'Realm', str(pol.name));
      const fac = Array.isArray(d.factions) ? (d.factions as Rec[]) : [];
      if (fac.length) this.chips(g, fac.sort((a, b) => num(b.share) - num(a.share)).map((x) => `${str(x.kind)} ${Math.round(num(x.share) * 100)}%`), 6, 'gn-chip-role');
    }
    if (rel.length) {
      const g = this.section('Neighbours');
      for (const r of rel.slice(0, 6)) {
        const op = num(r.opinion);
        const mood = r.atWar ? 'at war' : op > 0.4 ? 'friends' : op < -0.4 ? 'hostile' : op < -0.1 ? 'wary' : 'at peace';
        this.kv(g, str(r.name, 'a people'), `${mood}${num(r.trade) > 0.05 ? ' · trading' : ''}`);
      }
    }
    const sec = this.section('People');
    this.kv(sec, 'Living', cohort > 0 ? `${num(d.agents)} named, ${Math.round(cohort)} more` : `${num(d.agents)}`);
    const fd = num(d.foodDays, -1);
    if (fd >= 0) this.kv(sec, 'Food stored', fd >= 30 ? 'plenty' : `${fd.toFixed(1)} days`);
    const stats = (d.stats ?? {}) as Rec;
    if (num(stats.births) || num(stats.deaths)) this.kv(sec, 'Born / died', `${num(stats.births)} / ${num(stats.deaths)}`);
    if (d.crop) this.kv(sec, 'Fields of', `${str(d.crop).toLowerCase()}${num(d.fields) ? ` (${num(d.fields)})` : ''}`);
    const roles = Object.entries((d.roles ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
    if (roles.length) this.chips(sec, roles, 10, 'gn-chip-role');
    if (typeof d.belief === 'number') {
      const g = this.section('Toward the god');
      this.bar(g, 'Belief', num(d.belief), 'gn-love');
      this.bar(g, 'Fear', num(d.fear), 'gn-fear');
    }
    const lib = Array.isArray(d.library) ? (d.library as string[]) : [];
    const written = new Set(Array.isArray(d.written) ? (d.written as string[]) : []);
    const secrets = new Set(Array.isArray(d.secrets) ? (d.secrets as string[]) : []);
    const ls = this.section('Knowledge', `${lib.length}${written.size ? ` · ${written.size} written` : ''}`);
    const wrap = el('div', 'gn-insp-chips');
    for (const k of lib.slice(0, 28)) wrap.append(el('span', `gn-chip${written.has(k) ? ' gn-chip-book' : ''}${secrets.has(k) ? ' gn-chip-secret' : ''}`, k));
    if (lib.length > 28) wrap.append(el('span', 'gn-chip gn-chip-more', `+${lib.length - 28}`));
    ls.append(wrap);
    const stores = Object.entries((d.stores ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
    if (stores.length) {
      const s = this.section('Stores');
      this.chips(s, stores.map(([k, v]) => `${k} ${v >= 10 ? Math.round(v) : v.toFixed(1)}`), 14, 'gn-chip-store');
    }
    const bl = Array.isArray(d.buildings) ? (d.buildings as Rec[]) : [];
    if (bl.length) {
      const s = this.section('Buildings', `${bl.length}`);
      const count = new Map<string, { n: number; id: number; rising: number }>();
      for (const b of bl) {
        const k = str(b.type);
        const c = count.get(k) ?? { n: 0, id: num(b.id), rising: 0 };
        c.n++;
        if (num(b.progress, 1) < 0.999) c.rising++;
        count.set(k, c);
      }
      const wrapB = el('div', 'gn-insp-chips');
      for (const [k, c] of count) {
        const a = this.link(`${k}${c.n > 1 ? ` ×${c.n}` : ''}${c.rising ? ' (rising)' : ''}`, { kind: 'building', id: c.id, planet });
        a.classList.add('gn-chip');
        wrapB.append(a);
      }
      s.append(wrapB);
    }
    const stories = Array.isArray(d.stories) ? (d.stories as string[]) : [];
    if (stories.length) {
      const s = this.section('Stories they tell');
      const list = el('ul', 'gn-insp-stories');
      for (const t of stories.slice(-5).reverse()) list.append(el('li', '', t));
      s.append(list);
    }
    const lang = d.language as Rec | null;
    if (lang && Array.isArray(lang.sample)) {
      const s = this.section('Their tongue');
      s.append(el('div', 'gn-insp-lang', (lang.sample as string[]).join(' · ')));
    }
  }

  private herd(d: Rec): void {
    const n = num(d.count);
    this.header('Herd', str(d.name, 'Animals'), `${Math.max(1, Math.round(n))} ${n >= 1.5 ? 'animals' : 'animal'} · ${str(d.state, 'grazing')}`);
    const sec = this.section('State');
    this.bar(sec, 'Fed', 1 - num(d.hunger), 'gn-health');
    this.kv(sec, 'Kept by', num(d.owner, -1) >= 0 ? 'people (domestic)' : 'no one (wild)');
    if (d.sick) this.kv(sec, 'Sick with', str(d.sick));
    if (d.migrating) this.kv(sec, 'Moving', 'migrating');
    if (d.invasive) this.chips(sec, ['invasive'], 2, 'gn-chip-flag');
  }

  private cell(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? num(d.planet);
    const biome = d.biome as Rec | null;
    const f = (d.fields ?? {}) as Record<string, number>;
    this.header('Place', biome ? str(biome.name) : 'Ground', `${fmtLatLon((d.pos as number[]) ?? [0, 1, 0])} · ${fmtDist(num(d.altitude))} ${num(d.altitude) >= 0 ? 'above' : 'below'} the sea`);
    const now = el('div', 'gn-insp-doing');
    const temp = num(f.temperature);
    now.textContent = `${temp.toFixed(1)} °C now, ${num(d.tempMean).toFixed(1)} °C through the year${num(f.water) > 0.05 ? `, under ${fmtDist(num(f.water))} of water` : ''}${d.precipKind && d.precipKind !== 'none' ? `, ${str(d.precipKind)} falling` : ''}.`;
    this.body.append(now);
    const g = this.section('Ground');
    this.bar(g, 'Moisture', num(f.moisture), 'gn-mood');
    this.bar(g, 'Fertility', num(f.fertility), 'gn-health');
    if (num(f.salinity) > 0.01) this.bar(g, 'Salt', num(f.salinity), '');
    for (const [k, label] of [['soil', 'Soil'], ['sand', 'Sand'], ['snow', 'Snow'], ['ice', 'Ice'], ['ash', 'Ash'], ['lava', 'Lava']] as const) if (num(f[k]) > 0.01) this.kv(g, label, fmtDist(num(f[k])).replace(' m', ` m`));
    const v = this.section('Life');
    this.bar(v, 'Grass', num(f.grass), 'gn-health');
    this.bar(v, 'Shrubs', num(f.shrub), 'gn-health');
    this.bar(v, 'Trees', num(f.tree), 'gn-health');
    if (num(f.crop) > 0) this.bar(v, 'Crops', num(f.crop), 'gn-skill');
    const sp = (d.species ?? {}) as Record<string, string | null>;
    const names = Object.entries(sp).filter(([, x]) => !!x).map(([k, x]) => `${x} (${k})`);
    if (names.length) this.chips(v, names, 6);
    const hz: string[] = [];
    if (num(f.fire) > 0) hz.push('burning');
    if (num(f.pollution) > 0.02) hz.push(`pollution ${pct(num(f.pollution))}%`);
    if (num(f.radiation) > 0.02) hz.push(`radiation ${pct(num(f.radiation))}%`);
    if (num(f.blight) > 0.02) hz.push('blight');
    if (d.pinnedBiome) hz.push(`pinned: ${str(d.pinnedBiome)}`);
    if (hz.length) this.chips(this.body, hz, 6, 'gn-chip-flag');
    const ore = d.ore as Rec | null;
    if (ore) { const o = this.section('Under the ground'); this.bar(o, str(ore.name), num(ore.richness), 'gn-skill'); }
    const w = this.section('Air');
    this.bar(w, 'Humidity', num(f.humidity), 'gn-mood');
    this.bar(w, 'Cloud', num(f.cloud), '');
    const wind = Math.hypot(num(f.windX), num(f.windY), num(f.windZ));
    this.kv(w, 'Wind', `${wind.toFixed(1)} m/s`);
    this.acts(this.body, [
      { label: 'Laws of this world', icon: 'law', run: () => this.deps.select({ kind: 'planet', id: planet, planet }) },
    ]);
  }

  private species(d: Rec): void {
    if (Array.isArray(d) || !d.id) { this.header('Peoples', 'The peoples', ''); return; }
    const body = str(d.body ?? d.bodyPlan, '');
    this.header('A people', str(d.name, str(d.id)), [body, d.breathes ? `breathes ${str(d.breathes)}` : '', `${fmtNum(num(d.population))} living`].filter(Boolean).join(' · '));
    if (typeof d.desc === 'string') this.body.append(el('div', 'gn-insp-doing', str(d.desc)));
    const s = this.section('Body');
    for (const [k, label] of [['lifespan', 'Lifespan (years)'], ['size', 'Size'], ['speed', 'Speed'], ['fertility', 'Fertility']] as const) if (typeof d[k] === 'number') this.kv(s, label, fmtNum(num(d[k])));
    const temp = d.temperature as Rec | undefined;
    if (temp && typeof temp === 'object') this.kv(s, 'Bears', `${num(temp.min, num(temp.lo)).toFixed(0)} … ${num(temp.max, num(temp.hi)).toFixed(0)} °C`);
    if (d.habitat) this.kv(s, 'Lives', Array.isArray(d.habitat) ? (d.habitat as string[]).join(', ') : str(d.habitat));
    if (d.diet) this.kv(s, 'Eats', Array.isArray(d.diet) ? (d.diet as string[]).join(', ') : str(d.diet));
    const sts = Array.isArray(d.settlements) ? (d.settlements as Rec[]) : [];
    if (sts.length) {
      const g = this.section('Their towns', `${sts.length}`);
      const wrap = el('div', 'gn-insp-chips');
      for (const x of sts.slice(0, 20)) { const a = this.link(str(x.name), { kind: 'settlement', id: num(x.id), planet: this.ref?.planet }); a.classList.add('gn-chip'); wrap.append(a); }
      g.append(wrap);
    }
  }

  private disaster(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? num(d.planet);
    const live = (d.live ?? d) as Rec;
    const kind = str(d.kind, str(live.kind));
    const name = str(d.name, cap(kind.replace(/-/g, ' ')));
    const life = num(d.life, -1), age = num(d.age);
    const frozen = !!(live.frozen ?? d.frozen);
    this.header(this.gone ? 'Disaster · over' : 'Disaster', name, [
      d.god === 0 ? 'your doing' : num(d.god, -1) > 0 ? 'a rival\'s doing' : 'nature', frozen ? 'frozen' : '', str(d.cause) && d.cause !== 'god' && d.cause !== 'nature' ? str(d.cause) : '',
    ].filter(Boolean).join(' · '));
    const def = d.def as Rec | undefined;
    if (def?.desc) this.body.append(el('div', 'gn-insp-doing', str(def.desc)));
    const s = this.section('Now');
    this.kv(s, 'Reach', fmtDist(num(live.radius, num(d.radius))));
    this.bar(s, 'Strength', Math.min(1, num(live.intensity, num(d.intensity)) / 2), 'gn-fear', fmtNum(num(live.intensity, num(d.intensity))));
    if (life > 0) {
      this.bar(s, 'Spent', Math.min(1, age / life), '', `${Math.round(Math.min(1, age / life) * 100)}%`);
      this.kv(s, 'Left', fmtTicks(Math.max(0, life - age), this.deps.dayHours(planet)));
    } else this.kv(s, 'Lasts', 'until stopped');
    if (num(d.scale, 1) !== 1) this.kv(s, 'Scaled', `×${fmtNum(num(d.scale, 1))}`);
    if (num(d.dead) || num(d.ruined)) this.kv(s, 'Toll', `${fmtNum(num(d.dead))} dead · ${fmtNum(num(d.ruined))} buildings ruined`);
    if (this.gone) return;
    const ctl = this.section('Control it');
    this.acts(ctl, [
      { label: 'Cancel', icon: 'stop', title: 'End it now (its planet-wide changes are undone)', run: () => void this.act({ k: 'disaster.cancel', planet, id: ref.id }) },
      { label: frozen ? 'Thaw' : 'Freeze', icon: 'freeze', on: frozen, title: 'Hold it still in time, or let it go on', run: () => void this.act({ k: 'disaster.freeze', planet, id: ref.id, on: !frozen }) },
      { label: 'Move', icon: 'move-d', title: 'Then click where it should go', run: () => { const p = this.deps.powers.get('move-disaster'); if (p) this.deps.arm(p, { id: ref.id }); } },
    ]);
    const sc = el('div', 'gn-insp-scale');
    let factor = 1;
    sc.append(el('span', 'gn-insp-k', 'Scale'), slider({ min: 0.1, max: 10, step: 0.05, value: 1, log: true, fmt: (v) => `×${fmtNum(v)}`, on: (v) => { factor = v; } }));
    const apply = h('button', { class: 'gn-btn gn-insp-act', text: 'Apply' });
    apply.addEventListener('click', () => void this.act({ k: 'disaster.scale', planet, id: ref.id, factor }));
    sc.append(apply);
    ctl.append(sc);
    this.acts(ctl, [
      { label: '× ½', icon: 'minus', title: 'Half as strong', run: () => void this.act({ k: 'disaster.scale', planet, id: ref.id, factor: 0.5 }) },
      { label: '× 2', icon: 'plus', title: 'Twice as strong', run: () => void this.act({ k: 'disaster.scale', planet, id: ref.id, factor: 2 }) },
    ]);
  }

  private weather(ref: EntityRef, d: Rec): void {
    const planet = ref.planet ?? num(d.planet);
    const kind = str(d.kind);
    this.header('Weather', cap(kind.replace(/-/g, ' ')), [d.pinned ? 'held in place' : 'drifting with the wind', this.deps.planetName(planet)].join(' · '));
    const s = this.section('Now');
    this.kv(s, 'Reach', fmtDist(num(d.radius)));
    this.bar(s, 'Strength', Math.min(1, num(d.intensity) / 2), 'gn-mood', fmtNum(num(d.intensity)));
    const vel = (d.vel as number[] | undefined) ?? [0, 0, 0];
    const R = 3000;
    this.kv(s, 'Drift', `${(Math.hypot(vel[0], vel[1], vel[2]) * R * 60).toFixed(0)} m per hour`);
    const pos = d.pos as number[] | undefined;
    this.acts(this.body, [
      { label: 'Clear it', icon: 'sun-clear', title: 'Clear the weather here', run: () => void this.act({ k: 'weather.clear', planet, ...(pos ? { pos } : {}), radius: Math.max(50, num(d.radius)) }) },
      { label: 'More of it', icon: 'new-weather', title: 'Paint more of this weather', run: () => { const p = this.deps.powers.list.find((x) => x.command === 'weather.paint' && x.params.kind === kind); if (p) this.deps.arm(p); } },
    ]);
  }

  private creature(ref: EntityRef, d: Rec): void {
    const planet = num(d.planet, ref.planet ?? 0);
    const al = num(d.alignment);
    const leash = d.leash as Rec | null;
    this.header('Creature', str(d.name, 'Creature'), [cap(str(d.template)), al > 0.35 ? 'kind' : al < -0.35 ? 'cruel' : 'unsure', `${num(d.height, 0) ? fmtDist(num(d.height)) : ''}`].filter(Boolean).join(' · '));
    this.body.append(el('div', 'gn-insp-doing', cap(str(d.activity, 'idle'))));
    const s = this.section('Body and mind');
    this.bar(s, 'Kindness', (al + 1) / 2, al >= 0 ? 'gn-love' : 'gn-fear', al.toFixed(2));
    this.bar(s, 'Fed', 1 - num(d.hunger), 'gn-health');
    this.bar(s, 'Energy', num(d.energy), 'gn-mood');
    this.bar(s, 'Grown', num(d.growth), 'gn-skill');
    this.bar(s, 'Trust', num(d.trust), 'gn-love');
    const desires = Object.entries((d.desires ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
    if (desires.length) {
      const g = this.section('What it wants', 'learned by reward and punishment');
      for (const [k, v] of desires.slice(0, 9)) this.bar(g, cap(k.replace(/-/g, ' ')), v, 'gn-skill');
    }
    const mir = Object.entries((d.miracles ?? {}) as Record<string, number>).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]);
    const m = this.section('Miracles it knows', mir.length ? `${mir.length}` : 'none yet');
    for (const [k, v] of mir) this.bar(m, cap(k), v, 'gn-love');
    const lk = this.section('Leash');
    this.kv(lk, 'Held', leash ? `${str(leash.mode)} · ${num(leash.settlement, -1) >= 0 ? 'to a town' : 'to a place'}` : 'free');
    // controls
    const id = ref.id;
    const ctl = this.section('Teach it');
    this.acts(ctl, [
      { label: 'Reward', icon: 'treat', title: 'What it just did, it will do more (stroke)', run: () => void this.act({ k: 'creature.reward', planet, id }) },
      { label: 'Punish', icon: 'stick', title: 'What it just did, it will do less (slap)', run: () => void this.act({ k: 'creature.punish', planet, id }) },
      { label: 'Leash', icon: 'leash', title: 'Click a town or a place to leash it to', run: () => { const p = this.deps.powers.get('leash'); if (p) this.deps.arm(p, { mode: str(leash?.mode, 'tend'), ...(p.schema.id?.type === 'entity' ? { id } : {}) }); } },
      { label: 'Unleash', icon: 'unleash', run: () => void this.act({ k: 'creature.unleash', planet, id }) },
      { label: 'Go there', icon: 'go', title: 'Then click where it should go', run: () => { const p = this.deps.powers.get('creature-go'); if (p) this.deps.arm(p, p.schema.id?.type === 'entity' ? { id } : {}); } },
    ]);
    const modes = this.deps.powers.enumOf('creature.set-mode', 'mode') ?? ['tend', 'defend', 'impress', 'terrify', 'explore'];
    const modeSel = h('select', { class: 'gn-select' }) as HTMLSelectElement;
    for (const x of modes) modeSel.append(h('option', { value: x, text: x }));
    modeSel.value = str(leash?.mode, 'tend');
    modeSel.addEventListener('change', () => void this.act({ k: 'creature.set-mode', planet, id, mode: modeSel.value }));
    const teachSel = h('select', { class: 'gn-select' }) as HTMLSelectElement;
    for (const x of this.deps.powers.enumOf('creature.teach-by-example', 'miracle') ?? ['water', 'food', 'heal', 'forest', 'storm', 'fire', 'fireball', 'shield', 'lightning', 'wood', 'fertility', 'calm', 'teach', 'meteor']) teachSel.append(h('option', { value: x, text: x }));
    const teachBtn = h('button', { class: 'gn-btn gn-insp-act', text: 'Show it' });
    teachBtn.addEventListener('click', () => void this.act({ k: 'creature.teach-by-example', planet, id, miracle: teachSel.value }));
    ctl.append(h('div', { class: 'gn-insp-form' }, h('span', { class: 'gn-insp-k', text: 'Mode' }), modeSel), h('div', { class: 'gn-insp-form' }, h('span', { class: 'gn-insp-k', text: 'Miracle' }), teachSel, teachBtn));
    const nameIn = h('input', { class: 'gn-text', type: 'text', placeholder: 'a new name', spellcheck: 'false' }) as HTMLInputElement;
    nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && nameIn.value.trim()) void this.act({ k: 'creature.rename', planet, id, to: nameIn.value.trim() }); });
    ctl.append(h('div', { class: 'gn-insp-form' }, h('span', { class: 'gn-insp-k', text: 'Name' }), nameIn));
    this.acts(ctl, [
      { label: 'Grow', icon: 'grow', run: () => void this.act({ k: 'creature.grow', planet, id, amount: 0.25 }) },
      { label: 'Shrink', icon: 'minus', run: () => void this.act({ k: 'creature.grow', planet, id, amount: -0.25 }) },
      { label: 'Lift', icon: 'grab', title: 'Take it in the hand (if it trusts you)', run: () => void this.act({ k: 'hand.grab', planet, target: { kind: 'creature', id } }) },
      { label: 'Release', icon: 'free', title: 'Let it go free for ever', run: () => void this.act({ k: 'creature.release', planet, id }) },
    ]);
  }

  private ship(ref: EntityRef, d: Rec): void {
    const phase = str(d.phase);
    this.header(phase === 'lost' ? 'Ship · lost' : 'Ship', str(d.name, str(d.kindName, 'A ship')), [str(d.kindName), str(d.ownerName) ? `of ${str(d.ownerName)}` : '', phase].filter(Boolean).join(' · '));
    if (d.why) this.body.append(el('div', 'gn-insp-doing', cap(str(d.why))));
    const s = this.section('Voyage');
    this.kv(s, 'Bound for', str(d.toName, '—'));
    this.kv(s, 'Purpose', str(d.purpose, '—'));
    this.kv(s, 'Aboard', `${num(d.crew)}${num(d.born) ? ` (${num(d.born)} born on the way)` : ''}`);
    if (num(d.daysLeft) > 0) this.kv(s, 'Arrives in', `${fmtNum(num(d.daysLeft))} days`);
    this.bar(s, 'Soundness', Math.min(1, num(d.reliability, 1)), 'gn-health');
    if (num(d.dead)) this.kv(s, 'Lost', `${num(d.dead)}`);
    const crew = Array.isArray(d.crewList) ? (d.crewList as Rec[]) : [];
    if (crew.length) { const c = this.section('Crew', `${crew.length}`); this.chips(c, crew.map((m) => `${str(m.name)}${m.sick ? ` (${str(m.sick)})` : ''}`), 16); }
    const log = Array.isArray(d.log) ? (d.log as unknown[]).map((x) => (typeof x === 'string' ? x : str((x as Rec).text, JSON.stringify(x)))) : [];
    if (log.length) { const l = this.section('Log'); const list = el('ul', 'gn-insp-stories'); for (const t of log.slice(-6).reverse()) list.append(el('li', '', t)); l.append(list); }
    if (phase === 'lost' || phase === 'done') return;
    this.acts(this.body, [
      { label: 'Recall', icon: 'w-recall', title: 'Call the ship home', run: () => void this.act({ k: 'ship.cancel', ship: ref.id }) },
      { label: 'Destroy', icon: 'w-smite-ship', title: 'Strike the ship from the sky', run: () => void this.act({ k: 'ship.destroy', ship: ref.id }) },
    ]);
  }

  /** the laws of the world: every registered parameter, editable */
  private planet(ref: EntityRef, d: Rec): void {
    const info = (d.info ?? {}) as Rec;
    const laws = (d.laws ?? []) as Rec[];
    const stats = (info.stats ?? {}) as Rec;
    const params = (info.params ?? {}) as Rec;
    this.header('World', str(info.name, this.deps.planetName(ref.id)), `${str(info.kind)} · ${fmtDist(num(info.radius))} radius · laws of this world`);
    if (info.stats) {
      const s = this.section('Now');
      this.kv(s, 'Mean temperature', `${num(stats.meanTemperature).toFixed(1)} °C (${num(stats.minTemperature).toFixed(0)} … ${num(stats.maxTemperature).toFixed(0)})`);
      this.bar(s, 'Green', num(stats.vegetationCover), 'gn-health');
      this.kv(s, 'Weather systems', `${num(stats.weatherSystems)}`);
      if (num(stats.fires)) this.kv(s, 'Burning cells', `${num(stats.fires)}`);
      const atm = (params.atmosphere ?? {}) as Rec;
      this.kv(s, 'Air', num(atm.pressure) > 0.01 ? `${fmtNum(num(atm.pressure))} atm` : 'none');
    }
    const groups = new Map<string, Rec[]>();
    for (const l of laws) {
      const path = str(l.path);
      const g = LAW_GROUPS.find(([re]) => re.test(path))?.[1] ?? 'Other laws';
      const list = groups.get(g) ?? [];
      list.push(l);
      groups.set(g, list);
    }
    for (const [title, list] of groups) {
      const sec = this.section(title, `${list.length}`);
      for (const l of list) sec.append(this.lawRow(ref.id, l));
    }
  }

  private lawRow(planet: number, l: Rec): HTMLDivElement {
    const path = str(l.path), kind = str(l.kind), unit = str(l.unit);
    const row = h('div', { class: 'gn-law', data: { law: path }, title: `${path} — ${str(l.desc)}` });
    row.append(h('div', { class: 'gn-law-l' }, h('span', { text: str(l.label, path) }), h('small', { text: path })));
    const set = (value: unknown) => { this.editing = performance.now(); void this.deps.cmd({ k: 'set', path, value, planet }); };
    let ctl: HTMLElement;
    if (kind === 'number') {
      const v = num(l.value), lo = num(l.min, Math.min(0, v)), hi = num(l.max, Math.max(1, v * 4 || 1));
      const log = lo > 0 && hi / lo > 300;
      ctl = slider({ min: lo, max: hi, step: (hi - lo) / 1000, value: v, log, fmt: (x) => `${fmtNum(x)}${unit && unit !== '0..1' && unit !== 'fraction' ? ` ${unit}` : ''}`, on: (x) => { this.editing = performance.now(); clearTimeout((row as unknown as { t?: number }).t); (row as unknown as { t?: ReturnType<typeof setTimeout> }).t = setTimeout(() => set(x), 180); } });
    } else if (kind === 'boolean') ctl = toggle(!!l.value, (x) => set(x), str(l.label));
    else if (kind === 'enum') {
      const s = h('select', { class: 'gn-select' }) as HTMLSelectElement;
      for (const x of (Array.isArray(l.values) ? l.values : []) as string[]) s.append(h('option', { value: x, text: x }));
      s.value = String(l.value ?? '');
      s.addEventListener('change', () => set(s.value));
      ctl = s;
    } else {
      const inp = h('input', { class: 'gn-text', type: 'text', value: String(l.value ?? '') }) as HTMLInputElement;
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') set(inp.value); });
      ctl = inp;
    }
    row.append(h('div', { class: 'gn-law-c' }, ctl));
    return row;
  }
}
