// GENESIS — the people and their god, as the interface shows them (LIVING.md §3; hooks H2–H5, H9):
//   * the words: faith, fear, trust and loyalty read as what the people feel ("they believe, and they are wary"), the
//     world's regard as a band (feared · awed · trusted), a prayer as what it asks for and what answers it, a prophecy
//     as what the prophet tells the town, an omen as what the people see;
//   * The god (a window on the left, the HUD's regard card opens it): the world's regard and its four values, the
//     wrath law as a slider ("survivable by default"), the open prayers with one-click answers, the prophets (their
//     credibility, open prophecies, persecution) with Foretell / Abandon, the signs lately seen and "Send a sign", the
//     sacred places and animals, each settlement's regard, and the rival gods by their epithets;
//   * Send a sign (a small window): the omen catalogue — what each is and how a trusting town and a fearful one read
//     it — over a settlement, or armed as a power to place it by hand;
//   * the foretell form (the inspector's prophet card and this window): what the prophet says, and within how many days;
//   * prayer marks: from orbit, where the settlements' names do not show, a small lamp over each praying town (a click
//     selects it; its card answers). Closer in, the name itself carries the lamp (src/ui/hud.ts). The god's marks on the
//     world itself — a prophet's thread of light, the Called, sacred places — are light drawn by the render lane
//     (src/render/signs/signs.ts), never icons.
// Plain DOM; data from the WorldView mirror (SettlementView.regard / .prayers / .prophet / .sacred, Snapshot.regard /
// .wrath) and the sim's queries 'prophets', 'sacred', 'omens', 'gods' (asked every few seconds while a window shows them).

import type { Command, CommandResult, EntityRef, SettlementView, UnitVec } from '../sim/types.ts';
import type { WorldView, PlanetView } from '../client/worldview.ts';
import type { Vector2 } from 'three';
import { qRotate } from '../client/orbits.ts';
import { Panel, slider } from './panel.ts';
import { h, clear, cap, fmtNum, fmtTicks } from './dom.ts';
import { icon } from './icons.ts';
import { wrathWord, wrathMeans, WRATH_DEFAULT } from './powers.ts';

// ───────────────────────────── words ─────────────────────────────

export type Meter = 'faith' | 'fear' | 'trust' | 'loyalty';
export const METERS: Meter[] = ['faith', 'fear', 'trust', 'loyalty'];
export const METER_LABEL: Record<Meter, string> = { faith: 'Faith', fear: 'Fear', trust: 'Trust', loyalty: 'Loyalty' };
/** what each value is (LIVING §3.1), for titles */
export const METER_DESC: Record<Meter, string> = {
  faith: 'that you are real and that you act',
  fear: 'dread of your power',
  trust: 'that you mean them well',
  loyalty: 'whose word they follow, whose shrine they keep',
};
const METER_WORDS: Record<Meter, string[]> = {
  faith: ['doubt you', 'half believe', 'believe', 'are sure of you', 'live by you'],
  fear: ['unafraid', 'wary', 'afraid', 'in dread', 'terrified'],
  trust: ['expect nothing of you', 'unsure of you', 'hopeful', 'trust you', 'trust you wholly'],
  loyalty: ['their own', 'drifting', 'partly yours', 'loyal', 'devoted'],
};

/** a value 0..1 in words ("believe", "wary", "loyal") */
export function meterWord(m: Meter, v: number): string {
  const i = v < 0.15 ? 0 : v < 0.35 ? 1 : v < 0.6 ? 2 : v < 0.85 ? 3 : 4;
  return METER_WORDS[m][i];
}

export type RegardBand = 'feared' | 'awed' | 'trusted';
/** the world's regard −1 … +1 as its band (LIVING §3.1: feared < −0.33 ≤ awed ≤ 0.33 < trusted) */
export function regardBand(r: number): RegardBand {
  return r < -0.33 ? 'feared' : r > 0.33 ? 'trusted' : 'awed';
}

/** the band the card shows: the regard's, or 'unseen' while they hardly believe the god is there at all */
export function bandOf(r: number, m: RegardSum | null): RegardBand | 'unseen' {
  return !m || m.faith < 0.15 ? 'unseen' : regardBand(r);
}

/** how they hold the god, in a sentence ("They hold you in awe: they believe, and they are wary.") */
export function regardSentence(r: number, m: RegardSum | null): string {
  if (!m || !m.towns) return 'No one lives yet to hold you in any way.';
  if (m.faith < 0.15) return 'They hardly believe you are there. Show yourself: a sign, an answered prayer.';
  const lead = regardBand(r) === 'feared' ? 'They fear you' : regardBand(r) === 'trusted' ? 'They trust you' : 'They hold you in awe';
  return `${lead}: they ${meterWord('faith', m.faith)}, and they are ${meterWord('fear', m.fear)}.`;
}

export interface RegardSum { faith: number; fear: number; trust: number; loyalty: number; towns: number; people: number }

/** the people's four values, population-weighted over the living settlements (of one world, or every world) */
export function regardOf(view: WorldView, planet?: number): RegardSum | null {
  const sum: RegardSum = { faith: 0, fear: 0, trust: 0, loyalty: 0, towns: 0, people: 0 };
  for (const pv of view.planets) {
    if (planet !== undefined && pv.id !== planet) continue;
    for (const s of pv.settlements) {
      if (s.flags & 2 || !s.regard) continue;
      const n = Math.max(1, s.population);
      for (const m of METERS) sum[m] += s.regard[m] * n;
      sum.people += n;
      sum.towns++;
    }
  }
  if (!sum.towns) return null;
  for (const m of METERS) sum[m] /= sum.people;
  return sum;
}

/** the world's regard −1 … +1: the sim's own (Snapshot.regard), else trust − fear of the believers here */
export function regardValue(view: WorldView, m: RegardSum | null): number {
  if (typeof view.regard === 'number') return view.regard;
  return m ? Math.max(-1, Math.min(1, m.trust - m.fear)) : 0;
}

export const PRAYER_WORDS: Record<string, string> = { food: 'food', rain: 'rain', healing: 'healing', warmth: 'warmth', protection: 'protection', rebuilding: 'help to rebuild' };
/** what answers each prayer (LIVING §3.3), for the Answer button's title */
export const PRAYER_ANSWERS: Record<string, string> = {
  food: 'plenty, a gift of food, fertile fields or game sent near',
  rain: 'rain or a storm over their land, or the Sigil of Rain',
  healing: 'mending, a cure, the plague ended',
  warmth: 'kindling, clear and calm weather, warmth',
  protection: 'a ward, stillness, the danger stopped or moved away',
  rebuilding: 'timber, a gift of wood or stone, buildings raised',
};

export interface OpenPrayer { planet: number; settlement: number; name: string; pos: UnitVec; id: number; kind: string; since: number; until: number; urgency: number }

/** every open prayer (of one world, or all), the most pressing first */
export function openPrayers(view: WorldView, planet?: number): OpenPrayer[] {
  const out: OpenPrayer[] = [];
  for (const pv of view.planets) {
    if (planet !== undefined && pv.id !== planet) continue;
    for (const s of pv.settlements) {
      if (s.flags & 2 || !s.prayers?.length) continue;
      for (const p of s.prayers) out.push({ planet: pv.id, settlement: s.id, name: s.name, pos: s.pos, id: p.id, kind: p.kind, since: p.since, until: p.until, urgency: p.urgency });
    }
  }
  return out.sort((a, b) => b.urgency - a.urgency || a.until - b.until);
}

/** the command that answers a prayer (the sim performs the fitting act: LIVING §3.3) */
export function answerCommand(p: { planet: number; settlement: number; id?: number }): Command {
  return p.id !== undefined ? { k: 'prayer.answer', settlement: p.settlement, prayer: p.id, planet: p.planet } : { k: 'prayer.answer', settlement: p.settlement, planet: p.planet };
}

/** "1 day 4 h left" (or "ending" when its window has closed and the sim has not lapsed it yet) */
export function timeLeft(view: WorldView, planet: number, until: number): string {
  const left = until - view.renderTick;
  if (left <= 0) return 'ending';
  return `${fmtTicks(left, view.planet(planet)?.params.dayHours ?? 24)} left`;
}

/** what a prophet may foretell (prophet.foretell `what`), in the words the town hears */
export const FORETELL: { id: string; label: string; says: string }[] = [
  { id: 'rain', label: 'Rain', says: 'rain will come' },
  { id: 'food', label: 'Plenty', says: 'plenty will come' },
  { id: 'healing', label: 'Healing', says: 'the sick will mend' },
  { id: 'warmth', label: 'Warmth', says: 'warmth will come' },
  { id: 'protection', label: 'Protection', says: 'they will be kept safe' },
  { id: 'rebuilding', label: 'Rebuilding', says: 'their homes will rise again' },
  { id: 'harm', label: 'Harm', says: 'harm will come' },
  { id: 'sign', label: 'A sign', says: 'a sign will be seen' },
];
export function foretellSays(kind: string): string { return FORETELL.find((f) => f.id === kind)?.says ?? kind; }

/** the omens (god.omen kinds, LIVING §3.4.4): their names and what the people see */
export const OMEN_NAMES: Record<string, string> = {
  eclipse: 'Eclipse', comet: 'Comet', flood: 'A sparing flood', rainbow: 'Rainbow', lightning: 'Lightning on one thing', aurora: 'Aurora',
  'red-rain': 'Red rain', 'still-sun': 'The sun stands still', 'sacred-animal': 'The sacred animal comes', spring: 'A spring rises',
};
export const OMEN_SEEN: Record<string, string> = {
  eclipse: 'the sun goes dark at noon', comet: 'a comet crosses their sky', flood: 'the waters rise and spare them',
  rainbow: 'a rainbow stands over them', lightning: 'lightning strikes one thing beside them and spares the rest',
  aurora: 'curtains of light in the night sky', 'red-rain': 'rain falls red with dust', 'still-sun': 'the sun stops in the sky for an hour',
  'sacred-animal': 'the animal they revere comes near', spring: 'a spring rises near the town',
};
const OMEN_ICON: Record<string, string> = {
  eclipse: 'd-eclipse', comet: 'd-comet', flood: 'flood', rainbow: 'rainbow', lightning: 'lightning', aurora: 'aurora', 'red-rain': 'blood',
  'still-sun': 'sun-stop', 'sacred-animal': 'new-beast', spring: 'spring',
};

/** a sacred place's kind in words */
export const PLACE_WORDS: Record<string, string> = { spring: 'a spring', grove: 'a grove', mountain: 'a peak', site: 'a holy place' };

/** a rival god's name with its epithet ("Vael the Undertow"): the `gods` query's title */
export interface GodRow { id: number; name: string; title?: string; temperament?: string; worship?: number; alive?: boolean; kind?: string; color?: number; called?: number }
export function godTitle(g: GodRow): string { return g.title && g.title !== 'You' ? g.title : g.name; }

// ───────────────────────────── the sim's lists, as given ─────────────────────────────

export interface ProphecyRow { id: number; kind: string; until: number; from?: number; by?: string; settlement?: number; planet?: number }
export interface ProphetRow {
  agent: number; planet: number; settlement: number; name: string; settlementName?: string; credibility: number; how?: string;
  confirmed?: boolean; fulfilled?: number; failed?: number; persecution?: number; abandoned?: boolean; listened?: boolean;
  silencedUntil?: number; journey?: unknown; prophecies?: ProphecyRow[];
}
export interface SacredPlaceRow { id: number; planet: number; cell: number; pos: UnitVec; kind: string; settlement: number; by?: string }
export interface SacredAnimalRow { planet: number; settlement: number; name: string; animal: string }
export interface OmenRow { kind: string; planet: number; pos?: UnitVec; tick: number; settlements?: number[]; seen?: number }
export interface OmenReading { trusted?: string; feared?: string; faith?: number; fear?: number; trust?: number }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);

/** a prophet's standing in words: listened to, doubted, silenced, exiled, turned from */
export function prophetState(p: ProphetRow, tick: number): string[] {
  const out: string[] = [];
  if (p.abandoned) out.push('the god turned from them');
  if ((p.silencedUntil ?? 0) > tick) out.push('silenced');
  const stage = p.persecution ?? 0;
  if (stage >= 2) out.push(stage >= 3 ? 'hunted' : 'exiled');
  else if (stage >= 1 && !((p.silencedUntil ?? 0) > tick)) out.push('persecuted');
  if (p.listened === false) out.push('no one listens');
  if (p.journey) out.push('carrying the word abroad');
  if (p.how === 'rose' && !p.confirmed) out.push('unconfirmed');
  return out;
}

// ───────────────────────────── the foretell form ─────────────────────────────

/**
 * "Foretell [rain] within [2 days] — Speak": the god commits itself through a prophet (prophet.foretell). Then make it
 * true inside the window: the prophet's credibility and the town's faith follow.
 */
export function foretellForm(o: { agent: number; planet: number; name: string; cmd(c: Command): Promise<CommandResult>; done?(): void }): HTMLDivElement {
  const what = h('select', { class: 'gn-select', aria: { label: 'What the prophet foretells' } }) as HTMLSelectElement;
  for (const f of FORETELL) what.append(h('option', { value: f.id, text: f.label }));
  const days = h('select', { class: 'gn-select gn-fore-days', aria: { label: 'Within how many days' } }) as HTMLSelectElement;
  for (let d = 1; d <= 5; d++) days.append(h('option', { value: String(d), text: d === 1 ? 'within a day' : `within ${d} days` }));
  days.value = '2';
  const says = h('div', { class: 'gn-fore-says' });
  const sync = () => { says.textContent = `${o.name} will tell their town: “${cap(foretellSays(what.value))} ${Number(days.value) === 1 ? 'before tomorrow' : `within ${days.value} days`}.” Then make it true.`; };
  what.addEventListener('change', sync);
  days.addEventListener('change', sync);
  for (const s of [what, days]) s.addEventListener('keydown', (e) => e.stopPropagation());
  sync();
  const go = h('button', { class: 'gn-btn gn-primary', text: 'Speak through them' });
  go.addEventListener('click', () => {
    go.disabled = true;
    void o.cmd({ k: 'prophet.foretell', agent: o.agent, what: what.value, days: Number(days.value), planet: o.planet }).finally(() => { go.disabled = false; o.done?.(); });
  });
  return h('div', { class: 'gn-fore' }, h('div', { class: 'gn-fore-row' }, what, days, go), says);
}

// ───────────────────────────── a meter row ─────────────────────────────

/** "Faith ▮▮▮▯ believe": a labelled bar with its word (title: what the value is) */
export function meterRow(m: Meter, v: number, compact = false): HTMLDivElement {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return h('div', { class: `gn-meter gn-meter-${m}${compact ? ' gn-meter-c' : ''}`, title: `${METER_LABEL[m]}: ${METER_DESC[m]} — ${pct}%` },
    h('span', { class: 'gn-meter-l', text: METER_LABEL[m] }),
    h('span', { class: 'gn-meter-track' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'gn-meter-w', text: compact ? `${pct}` : meterWord(m, v) }));
}

/** the feared … trusted gauge: a track with a mark at the regard and the band's word */
export function regardGauge(r: number): HTMLDivElement {
  const x = Math.round((Math.max(-1, Math.min(1, r)) + 1) * 50);
  const band = regardBand(r);
  return h('div', { class: `gn-regard gn-regard-${band}`, title: `How the people see you: ${band} (${r >= 0 ? '+' : ''}${r.toFixed(2)}, from −1 feared to +1 trusted). The Touch's light follows it.` },
    h('span', { class: 'gn-regard-end', text: 'feared' }),
    h('span', { class: 'gn-regard-track' }, h('i', { class: 'gn-regard-mark', style: `left:${x}%` })),
    h('span', { class: 'gn-regard-end', text: 'trusted' }));
}

// ───────────────────────────── Send a sign ─────────────────────────────

export interface SignDeps {
  view(): WorldView;
  primary(): number;
  query(q: string, args: Record<string, unknown>): Promise<unknown>;
  cmd(c: Command): Promise<CommandResult>;
  /** arm a power by id with preset values (the omen placed by hand) */
  arm(id: string, preset?: Record<string, unknown>): boolean;
  /** the settlement the player means now: the selected one, else the one nearest where the camera looks */
  target(): { planet: number; id: number } | null;
}

/** the omen catalogue as a picker: over which settlement, which sign (or let the world choose) */
export class SignPicker {
  readonly panel: Panel;
  private deps: SignDeps;
  private over: HTMLSelectElement;
  private grid: HTMLDivElement;
  private note: HTMLDivElement;
  private readings: Record<string, OmenReading> = {};
  private kinds: string[] = Object.keys(OMEN_NAMES);
  /** the last sign sent (test surface) */
  last: string | null = null;

  constructor(parent: HTMLElement, deps: SignDeps) {
    this.deps = deps;
    this.panel = new Panel(parent, { name: 'signs', title: 'Send a sign', subtitle: 'a wonder the people will read', icon: 'sign', place: 'center' });
    this.over = h('select', { class: 'gn-select', aria: { label: 'Over which settlement' } }) as HTMLSelectElement;
    this.over.addEventListener('keydown', (e) => e.stopPropagation());
    this.over.addEventListener('change', () => this.renderGrid());
    this.grid = h('div', { class: 'gn-sign-grid' });
    this.note = h('div', { class: 'gn-sign-note' });
    this.panel.body.append(
      h('div', { class: 'gn-sign-over' }, h('span', { text: 'Over' }), this.over),
      this.grid, this.note);
    this.panel.onOpen = () => void this.load();
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  close(): void { this.panel.close(); }

  /** open over a settlement (or the one the player means) */
  open(target?: { planet: number; id: number } | null): void {
    this.fillOver(target ?? this.deps.target());
    if (this.panel.isOpen) this.panel.raise(); else this.panel.open();
    this.renderGrid();
  }

  private fillOver(t: { planet: number; id: number } | null): void {
    const view = this.deps.view();
    const planet = t?.planet ?? this.deps.primary();
    clear(this.over);
    const pv = view.planet(planet);
    const towns = (pv?.settlements ?? []).filter((s) => !(s.flags & 2)).sort((a, b) => b.population - a.population);
    for (const s of towns) this.over.append(h('option', { value: `${pv!.id}:${s.id}`, text: `${s.name} (${s.population})` }));
    this.over.append(h('option', { value: 'place', text: 'a place I choose on the world' }));
    this.over.value = t && towns.some((s) => s.id === t.id) ? `${planet}:${t.id}` : towns.length ? `${pv!.id}:${towns[0].id}` : 'place';
  }

  private async load(): Promise<void> {
    try {
      const o = await this.deps.query('omens', { planet: this.deps.primary() }) as { catalogue?: Record<string, OmenReading>; kinds?: string[] } | null;
      if (o?.catalogue) this.readings = o.catalogue;
      if (Array.isArray(o?.kinds) && o!.kinds.length) this.kinds = o!.kinds.slice();
    } catch { /* the names alone */ }
    if (this.panel.isOpen) this.renderGrid();
  }

  /** how the town chosen would read each sign: by whether it trusts you more than it fears you */
  private trusting(): boolean | null {
    const v = this.over.value;
    if (v === 'place') return null;
    const [planet, id] = v.split(':').map(Number);
    const s = this.deps.view().planet(planet)?.settlements.find((q) => q.id === id);
    return s?.regard ? s.regard.trust >= s.regard.fear : null;
  }

  private renderGrid(): void {
    clear(this.grid);
    const trusting = this.trusting();
    const any = h('button', { class: 'gn-sign gn-sign-any', data: { kind: '' } },
      h('span', { class: 'gn-sign-i', html: icon('sign') }),
      h('span', { class: 'gn-sign-t' }, h('b', { text: 'Let the world choose' }), h('small', { text: 'the sign that fits this world and this town' })));
    any.addEventListener('click', () => void this.send(undefined));
    // (fix r2 #19: god.omen { warning } — the world chooses a sign that warns, never one they would read as a promise)
    const warn = h('button', { class: 'gn-sign gn-sign-any gn-sign-warn', data: { kind: 'warning' }, title: 'A sign that warns of what is coming: the world chooses it, and never a rainbow (they read that as a promise)' },
      h('span', { class: 'gn-sign-i', html: icon('storm') }),
      h('span', { class: 'gn-sign-t' }, h('b', { text: 'A sign of warning' }), h('small', { text: 'one that warns, never a promise: the world chooses' })));
    warn.addEventListener('click', () => void this.send(undefined, true));
    this.grid.append(any, warn);
    for (const k of this.kinds) {
      const r = this.readings[k] ?? {};
      const read = trusting === null ? `trusting: ${r.trusted ?? '…'} · fearful: ${r.feared ?? '…'}` : `they will read ${trusting ? r.trusted ?? 'favour' : r.feared ?? 'anger'}`;
      const b = h('button', { class: 'gn-sign', data: { kind: k }, title: `${OMEN_SEEN[k] ?? k}. Where they trust you: ${r.trusted ?? '—'}. Where they fear you: ${r.feared ?? '—'}.` },
        h('span', { class: 'gn-sign-i', html: icon(OMEN_ICON[k] ?? 'sign') }),
        h('span', { class: 'gn-sign-t' }, h('b', { text: OMEN_NAMES[k] ?? cap(k.replace(/-/g, ' ')) }), h('small', { text: cap(OMEN_SEEN[k] ?? '') }), h('small', { class: 'gn-sign-read', text: read })));
      b.addEventListener('click', () => void this.send(k));
      this.grid.append(b);
    }
    this.note.textContent = this.over.value === 'place'
      ? 'Choose a sign, then click the world where it should be seen.'
      : 'A sign is a wonder with no harm: faith rises, and the people read it by how they hold you. A prophet reads it to them.';
  }

  /** send the sign over the chosen town, or arm it to be placed; `warning`: the world chooses one that warns */
  async send(kind: string | undefined, warning = false): Promise<void> {
    const v = this.over.value;
    this.last = kind ?? (warning ? 'warning' : 'any');
    if (v === 'place') {
      this.panel.close();
      // (the card's warning toggle is set either way, so a remembered warning never rides on a plain sign)
      this.deps.arm('omen', kind ? { kind, warning: false } : { warning });
      return;
    }
    const [planet, id] = v.split(':').map(Number);
    this.panel.close();
    await this.deps.cmd(kind ? { k: 'god.omen', settlement: id, kind, planet } : warning ? { k: 'god.omen', settlement: id, warning: true, planet } : { k: 'god.omen', settlement: id, planet });
  }

  /** test surface */
  state(): { open: boolean; over: string; kinds: string[]; last: string | null } {
    return { open: this.isOpen, over: this.over.value, kinds: Array.from(this.grid.querySelectorAll<HTMLElement>('.gn-sign')).map((b) => b.dataset.kind ?? ''), last: this.last };
  }
}

// ───────────────────────────── The god (the window) ─────────────────────────────

export interface GodDeps {
  view(): WorldView;
  primary(): number;
  query(q: string, args: Record<string, unknown>): Promise<unknown>;
  cmd(c: Command): Promise<CommandResult>;
  select(ref: EntityRef): void;
  lookAt(planet: number, pos: ArrayLike<number>): void;
  arm(id: string, preset?: Record<string, unknown>): boolean;
  openSigns(target?: { planet: number; id: number } | null): void;
  /** the rival gods (the shell asks the sim now and then) */
  gods(): GodRow[];
  hint(id: string): string;
}

type Section = 'regard' | 'wrath' | 'prayers' | 'prophets' | 'signs' | 'sacred' | 'towns' | 'rivals';

export class GodPanel {
  readonly panel: Panel;
  private deps: GodDeps;
  private secs = new Map<Section, { el: HTMLDivElement; key: string }>();
  private prophets: ProphetRow[] = [];
  private places: SacredPlaceRow[] = [];
  private animals: SacredAnimalRow[] = [];
  private omens: OmenRow[] = [];
  private askedAt = -1e9;
  private asking = false;
  private renderedAt = -1e9;
  private pressing = false;
  /** the wrath slider's value being set (it is not redrawn under the player's hand) */
  private wrathAt = -1e9;
  private wrathSend: ReturnType<typeof setTimeout> | null = null;
  /** an open foretell form (by prophet) */
  private foretelling = -1;

  constructor(parent: HTMLElement, deps: GodDeps) {
    this.deps = deps;
    this.panel = new Panel(parent, { name: 'god', title: 'The god', subtitle: 'how the people hold you', icon: 'regard', place: 'left' });
    for (const s of ['regard', 'wrath', 'prayers', 'prophets', 'signs', 'sacred', 'towns', 'rivals'] as Section[]) {
      const el = h('div', { class: `gn-god-sec gn-god-${s}`, data: { sec: s } });
      this.secs.set(s, { el, key: '' });
      this.panel.body.append(el);
    }
    this.panel.root.addEventListener('pointerdown', () => { this.pressing = true; }, true);
    window.addEventListener('pointerup', () => { this.pressing = false; }, true);
    this.panel.onOpen = () => { this.askedAt = -1e9; for (const s of this.secs.values()) s.key = ''; this.frame(true); };
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(focus?: Section): void {
    if (this.panel.isOpen) this.panel.raise(); else this.panel.open();
    if (focus) {
      const el = this.secs.get(focus)?.el;
      if (el) { el.scrollIntoView({ block: 'start' }); el.classList.remove('gn-flash'); void el.offsetWidth; el.classList.add('gn-flash'); }
    }
  }
  close(): void { this.panel.close(); }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  /** every frame while open: the lists asked for every ~2.5 s, the sections redrawn when what they show changed */
  frame(force = false): void {
    if (!this.panel.isOpen) return;
    const now = performance.now();
    if (!this.asking && now - this.askedAt > 2500) void this.ask();
    if (!force && now - this.renderedAt < 400) return;
    // (a press inside the window, a list open, a slider under the hand: the window waits)
    if (!force && (this.pressing || this.busyField())) return;
    this.renderedAt = now;
    this.render();
  }

  private busyField(): boolean {
    const a = document.activeElement;
    return !!a && this.panel.root.contains(a) && (a instanceof HTMLSelectElement || (a instanceof HTMLInputElement && a.type !== 'checkbox'));
  }

  private async ask(): Promise<void> {
    this.asking = true;
    this.askedAt = performance.now();
    const planet = this.deps.primary();
    try {
      const [pr, sa, om] = await Promise.all([
        this.deps.query('prophets', { planet }).catch(() => null),
        this.deps.query('sacred', { planet }).catch(() => null),
        this.deps.query('omens', { planet }).catch(() => null),
      ]);
      this.prophets = arr<ProphetRow>(pr).filter((p) => p.planet === undefined || p.planet === planet);
      const s = (sa ?? {}) as { places?: unknown; animals?: unknown };
      this.places = arr<SacredPlaceRow>(s.places);
      this.animals = arr<SacredAnimalRow>(s.animals);
      this.omens = arr<OmenRow>((om as { recent?: unknown } | null)?.recent).slice(-6).reverse();
    } finally {
      this.asking = false;
    }
  }

  private put(s: Section, key: string, build: (el: HTMLDivElement) => void): void {
    const rec = this.secs.get(s)!;
    if (rec.key === key) return;
    rec.key = key;
    clear(rec.el);
    build(rec.el);
  }

  private head(el: HTMLElement, title: string, extra = '', ic = ''): void {
    el.append(h('div', { class: 'gn-god-h' }, ic ? h('span', { class: 'gn-god-hi', html: icon(ic) }) : null, h('span', { text: title }), extra ? h('small', { text: extra }) : null));
  }

  private render(): void {
    const view = this.deps.view();
    const planet = this.deps.primary();
    const pv = view.planet(planet);
    const tick = Math.floor(view.renderTick);
    const m = regardOf(view, planet);
    const r = regardValue(view, m);
    // ── the world's regard ──
    this.put('regard', `${r.toFixed(2)}|${m ? METERS.map((k) => Math.round(m[k] * 100)).join(',') : '-'}|${m?.towns ?? 0}|${Math.round(view.worship[0] ?? 0)}`, (el) => {
      el.append(
        h('div', { class: 'gn-god-band' },
          h('b', { class: `gn-band-${bandOf(r, m)}`, text: cap(bandOf(r, m)) }),
          h('span', { class: 'gn-god-wor', title: 'Worship: what their prayers, rites and fear give you; miracles draw on it for strength' }, h('span', { html: icon('worship') }), `${fmtNum(Math.round(view.worship[0] ?? 0))} worship`)),
        regardGauge(r),
        h('p', { class: 'gn-god-say', text: regardSentence(r, m) }));
      if (m) { const g = h('div', { class: 'gn-meters' }); for (const k of METERS) g.append(meterRow(k, m[k])); el.append(g); }
    });
    // ── wrath ──
    const w = view.wrath ?? WRATH_DEFAULT;
    if (performance.now() - this.wrathAt > 1500) this.put('wrath', `${w.toFixed(2)}`, (el) => {
      this.head(el, 'Wrath', 'how hard your harm falls', 'wrath');
      const word = h('b', { class: 'gn-wrath-word', text: cap(wrathWord(w)) });
      const means = h('div', { class: 'gn-wrath-means', text: wrathMeans(w) });
      const sl = slider({
        min: 0, max: 1, step: 0.05, value: w, fmt: (x) => x.toFixed(2),
        on: (x) => {
          this.wrathAt = performance.now();
          word.textContent = cap(wrathWord(x));
          means.textContent = wrathMeans(x);
          if (this.wrathSend) clearTimeout(this.wrathSend);
          this.wrathSend = setTimeout(() => { this.wrathSend = null; void this.deps.cmd({ k: 'set', path: 'god.wrath', value: Math.round(x * 100) / 100 }); }, 220);
        },
      });
      sl.classList.add('gn-wrath-slider');
      const inp = sl.querySelector('input');
      if (inp) inp.setAttribute('aria-label', 'Wrath');
      el.append(h('div', { class: 'gn-wrath-row' }, word, sl), means,
        h('div', { class: 'gn-god-dim', text: 'The default, 0.3, is survivable: they scare and kill, but most live, and warnings come first. Size words in "do this" set one act\'s wrath ("a gentle storm", "a huge meteor").' }));
    });
    // ── prayers ──
    const prayers = openPrayers(view, planet);
    this.put('prayers', prayers.map((p) => `${p.settlement}:${p.id}:${Math.round(p.urgency * 10)}:${Math.round((p.until - tick) / 120)}`).join('|') || 'none', (el) => {
      this.head(el, 'Prayers', prayers.length ? `${prayers.length} open` : 'none open', 'prayer');
      if (!prayers.length) { el.append(h('p', { class: 'gn-god-dim', text: 'No one is praying to you now. Hardship moves them to pray: hunger, drought, sickness, cold, danger, ruin.' })); return; }
      const list = h('div', { class: 'gn-god-list' });
      for (const p of prayers.slice(0, 8)) {
        const ans = h('button', { class: 'gn-btn gn-primary gn-god-answer', title: `Answer it: ${PRAYER_ANSWERS[p.kind] ?? 'the fitting act'} over ${p.name}`, text: 'Answer' });
        ans.addEventListener('click', () => { ans.disabled = true; void this.deps.cmd(answerCommand(p)).finally(() => { this.askedAt = -1e9; }); });
        const look = h('button', { class: 'gn-btn gn-god-look', title: `Select ${p.name}`, html: icon('eye'), aria: { label: `Select ${p.name}` } });
        look.addEventListener('click', () => this.deps.select({ kind: 'settlement', id: p.settlement, planet: p.planet }));
        list.append(h('div', { class: 'gn-god-row gn-prayer', data: { settlement: String(p.settlement), prayer: String(p.id) } },
          h('span', { class: 'gn-prayer-i', html: icon('prayer'), style: `opacity:${(0.55 + 0.45 * p.urgency).toFixed(2)}` }),
          h('span', { class: 'gn-god-t' }, h('b', { text: `${p.name} prays for ${PRAYER_WORDS[p.kind] ?? p.kind}` }), h('small', { text: `${timeLeft(view, p.planet, p.until)} · ${p.urgency >= 0.75 ? 'desperate' : p.urgency >= 0.45 ? 'pressing' : 'quiet'}` })),
          look, ans));
      }
      if (prayers.length > 8) list.append(h('div', { class: 'gn-god-dim', text: `and ${prayers.length - 8} more` }));
      el.append(list);
    });
    // ── prophets ──
    const pkey = this.prophets.map((p) => `${p.agent}:${Math.round(p.credibility * 100)}:${(p.prophecies ?? []).map((q) => `${q.id}`).join('.')}:${prophetState(p, tick).join('.')}`).join('|') + `|f${this.foretelling}`;
    this.put('prophets', pkey || 'none', (el) => {
      this.head(el, 'Prophets', this.prophets.length ? `${this.prophets.length}` : 'none', 'prophet');
      if (!this.prophets.length) {
        el.append(h('p', { class: 'gn-god-dim', text: 'You have no prophet. Choose a grown person and make them yours: they preach, read your signs to the town and foretell what you will do — then you make it true. The pious may also rise on their own after a wonder.' }));
        const b = h('button', { class: 'gn-btn', html: `${icon('prophet')}<span>Make a prophet…</span>` });
        b.addEventListener('click', () => this.deps.arm('prophet-call'));
        el.append(h('div', { class: 'gn-god-acts' }, b));
        return;
      }
      for (const p of this.prophets) {
        const card = h('div', { class: 'gn-god-prophet', data: { agent: String(p.agent) } });
        const name = h('button', { class: 'gn-insp-link', text: p.name, title: `Select ${p.name}` });
        name.addEventListener('click', () => this.deps.select({ kind: 'agent', id: p.agent, planet: p.planet ?? planet }));
        const cred = Math.round(p.credibility * 100);
        card.append(
          h('div', { class: 'gn-god-pl' }, name, h('small', { text: ` of ${p.settlementName ?? 'their town'}${p.how === 'rose' ? ' · rose on their own' : ''}` })),
          h('div', { class: 'gn-meter gn-meter-cred', title: `Credibility: how far the people believe what ${p.name} says — ${cred}%. A prophecy fulfilled raises it; one failed lowers it.` },
            h('span', { class: 'gn-meter-l', text: 'Believed' }), h('span', { class: 'gn-meter-track' }, h('i', { style: `width:${cred}%` })), h('span', { class: 'gn-meter-w', text: `${cred}%` })));
        const st = prophetState(p, tick);
        if (st.length) card.append(h('div', { class: 'gn-insp-chips' }, ...st.map((x) => h('span', { class: 'gn-chip gn-chip-flag', text: x }))));
        const open = (p.prophecies ?? []).filter((q) => q.until > tick);
        for (const q of open) card.append(h('div', { class: 'gn-god-proph' }, h('span', { text: `“${cap(foretellSays(q.kind))}”` }), h('small', { text: ` ${timeLeft(view, planet, q.until)}${q.by === 'prophet' ? ' · their own word' : ' · your word'}` })));
        if ((p.fulfilled ?? 0) + (p.failed ?? 0) > 0) card.append(h('div', { class: 'gn-god-dim', text: `${p.fulfilled ?? 0} fulfilled · ${p.failed ?? 0} failed` }));
        const fore = h('button', { class: 'gn-btn', html: `${icon('words')}<span>Foretell…</span>`, title: 'Speak through them: say what you will do, then do it' });
        fore.addEventListener('click', () => { this.foretelling = this.foretelling === p.agent ? -1 : p.agent; this.secs.get('prophets')!.key = ''; this.render(); });
        const ab = h('button', { class: 'gn-btn', html: `${icon('withdraw')}<span>Abandon</span>`, title: `Turn from ${p.name}: their word loses its weight` });
        ab.addEventListener('click', () => void this.deps.cmd({ k: 'prophet.abandon', agent: p.agent, planet: p.planet ?? planet }).finally(() => { this.askedAt = -1e9; }));
        card.append(h('div', { class: 'gn-god-acts' }, fore, p.abandoned ? null : ab));
        if (this.foretelling === p.agent) card.append(foretellForm({ agent: p.agent, planet: p.planet ?? planet, name: p.name, cmd: (c) => this.deps.cmd(c), done: () => { this.foretelling = -1; this.askedAt = -1e9; } }));
        el.append(card);
      }
    });
    // ── signs ──
    this.put('signs', this.omens.map((o) => `${o.kind}:${o.tick}`).join('|') || 'none', (el) => {
      this.head(el, 'Signs', 'wonders they read', 'sign');
      const send = h('button', { class: 'gn-btn gn-primary', html: `${icon('sign')}<span>Send a sign…</span>` });
      const k = this.deps.hint('ui.signs');
      send.title = `The omen catalogue${k ? ` (${k})` : ''}`;
      send.addEventListener('click', () => this.deps.openSigns(null));
      el.append(h('div', { class: 'gn-god-acts' }, send));
      if (!this.omens.length) { el.append(h('p', { class: 'gn-god-dim', text: 'No sign has been seen lately.' })); return; }
      const list = h('div', { class: 'gn-god-list' });
      for (const o of this.omens) {
        const towns = (o.settlements ?? []).map((id) => pv?.settlements.find((s) => s.id === id)?.name).filter(Boolean) as string[];
        list.append(h('div', { class: 'gn-god-row' }, h('span', { class: 'gn-god-t' }, h('b', { text: OMEN_NAMES[o.kind] ?? cap(o.kind) }), h('small', { text: `${towns.length ? `over ${towns.join(', ')}` : 'seen by no town'}${o.seen ? ` · ${o.seen} saw it` : ''} · ${fmtTicks(Math.max(0, tick - o.tick), pv?.params.dayHours ?? 24)} ago` }))));
      }
      el.append(list);
    });
    // ── sacred ──
    this.put('sacred', `${this.places.map((p) => `${p.id}:${p.settlement}`).join('|')}#${this.animals.map((a) => `${a.settlement}:${a.animal}`).join('|')}`, (el) => {
      this.head(el, 'Sacred', `${this.places.length} ${this.places.length === 1 ? 'place' : 'places'}`, 'sacred');
      const list = h('div', { class: 'gn-god-list' });
      for (const p of this.places.slice(0, 8)) {
        const keeper = pv?.settlements.find((s) => s.id === p.settlement)?.name;
        const look = h('button', { class: 'gn-btn gn-god-look', html: icon('eye'), title: 'Look there', aria: { label: 'Look there' } });
        look.addEventListener('click', () => { this.deps.lookAt(p.planet ?? planet, p.pos); this.deps.select({ kind: 'cell', id: p.cell, planet: p.planet ?? planet }); });
        list.append(h('div', { class: 'gn-god-row' }, h('span', { class: 'gn-god-t' }, h('b', { text: cap(PLACE_WORDS[p.kind] ?? p.kind) }), h('small', { text: keeper ? `kept by ${keeper}` : 'no town keeps it' })), look));
      }
      for (const a of this.animals) list.append(h('div', { class: 'gn-god-row' }, h('span', { class: 'gn-god-t' }, h('b', { text: `${a.name} reveres the ${a.animal.replace(/-/g, ' ')}` }), h('small', { text: 'none there will hunt it' }))));
      if (!this.places.length && !this.animals.length) list.append(h('p', { class: 'gn-god-dim', text: 'Nothing is holy yet. Hallow a spring, a grove or a peak; prophets and great omens make places holy too.' }));
      el.append(list);
      const hal = h('button', { class: 'gn-btn', html: `${icon('sacred')}<span>Hallow a place…</span>` });
      hal.addEventListener('click', () => this.deps.arm('sacred-place'));
      const ani = h('button', { class: 'gn-btn', html: `${icon('new-beast')}<span>A sacred animal…</span>` });
      ani.addEventListener('click', () => this.deps.arm('sacred-animal'));
      el.append(h('div', { class: 'gn-god-acts' }, hal, ani));
    });
    // ── each settlement ──
    const towns = (pv?.settlements ?? []).filter((s) => !(s.flags & 2) && s.regard).sort((a, b) => b.population - a.population);
    this.put('towns', towns.map((s) => `${s.id}:${METERS.map((k) => Math.round(s.regard![k] * 20)).join('')}`).join('|') || 'none', (el) => {
      this.head(el, 'Their towns', towns.length ? `${towns.length}` : '', 'people');
      if (!towns.length) { el.append(h('p', { class: 'gn-god-dim', text: 'No settlement on this world yet.' })); return; }
      const table = h('div', { class: 'gn-god-towns' });
      table.append(h('div', { class: 'gn-god-trow gn-god-thead' }, h('span', { text: '' }), ...METERS.map((k) => h('span', { text: METER_LABEL[k], title: METER_DESC[k] }))));
      for (const s of towns.slice(0, 12)) {
        const nm = h('button', { class: 'gn-insp-link', text: s.name, title: `${s.name}: ${s.population} · ${s.eraLabel ?? `${s.era} age`}` });
        nm.addEventListener('click', () => this.deps.select({ kind: 'settlement', id: s.id, planet }));
        table.append(h('div', { class: 'gn-god-trow' }, nm, ...METERS.map((k) => {
          const v = s.regard![k];
          return h('span', { class: `gn-god-cell gn-meter-${k}`, title: `${METER_LABEL[k]}: they ${k === 'fear' ? `are ${meterWord(k, v)}` : meterWord(k, v)} (${Math.round(v * 100)}%)` }, h('i', { style: `width:${Math.round(v * 100)}%` }));
        })));
      }
      if (towns.length > 12) table.append(h('div', { class: 'gn-god-dim', text: `and ${towns.length - 12} more` }));
      el.append(table);
    });
    // ── rival gods ──
    const rivals = this.deps.gods().filter((g) => g.id !== 0 && g.alive !== false);
    this.put('rivals', rivals.map((g) => `${g.id}:${Math.round(g.worship ?? 0)}`).join('|') || 'none', (el) => {
      if (!rivals.length) return;
      this.head(el, 'Rival gods', `${rivals.length}`, 'rival');
      const list = h('div', { class: 'gn-god-list' });
      for (const g of rivals) list.append(h('div', { class: 'gn-god-row' }, h('span', { class: 'gn-god-t' }, h('b', { text: godTitle(g) }), h('small', { text: `${g.temperament ? `${g.temperament} · ` : ''}${fmtNum(Math.round(g.worship ?? 0))} worship` }))));
      el.append(list);
    });
  }

  /** test surface */
  state(): { open: boolean; prayers: number; prophets: string[]; wrath: string; sections: string[] } {
    const w = this.secs.get('wrath')?.el.querySelector('.gn-wrath-word')?.textContent ?? '';
    return {
      open: this.isOpen, prayers: this.panel.root.querySelectorAll('.gn-prayer').length, prophets: this.prophets.map((p) => p.name), wrath: w,
      sections: Array.from(this.secs.entries()).filter(([, s]) => s.el.childElementCount > 0).map(([k]) => k),
    };
  }
}

// ───────────────────────────── prayer marks from orbit ─────────────────────────────

export interface MarksFrame {
  view: WorldView;
  pv: PlanetView | undefined;
  /** the camera (system frame) and its height above the ground */
  cam: ArrayLike<number>;
  altitude: number;
  systemView: boolean;
  project(sys: ArrayLike<number>, out: Vector2): Vector2 | null;
  v2: Vector2;
  groundRadius(planet: number, u: ArrayLike<number>): number;
  /** the settlement names show at this height (they carry their own lamp) */
  labelsShown: boolean;
}

/** a small lamp over each praying town seen from high up (a click selects the town: its card answers) */
export class PrayerMarks {
  readonly root: HTMLDivElement;
  private els = new Map<string, HTMLDivElement>();

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'gn-markers gn-lmarks' });
    parent.appendChild(this.root);
  }

  update(f: MarksFrame): void {
    const seen = new Set<string>();
    const pv = f.pv;
    if (pv && !f.systemView && !f.labelsShown) {
      const R = pv.params.radius;
      const rel = [f.cam[0] - pv.center[0], f.cam[1] - pv.center[1], f.cam[2] - pv.center[2]];
      const eye = Math.hypot(rel[0], rel[1], rel[2]);
      for (const s of pv.settlements) {
        if (s.flags & 2 || !s.prayers?.length) continue;
        const g = f.groundRadius(pv.id, s.pos) + 30;
        const w = qRotate(pv.quat, [s.pos[0] * g, s.pos[1] * g, s.pos[2] * g]);
        const sys = [pv.center[0] + w[0], pv.center[1] + w[1], pv.center[2] + w[2]];
        // behind the limb: farther than the horizon
        const d = Math.hypot(sys[0] - f.cam[0], sys[1] - f.cam[1], sys[2] - f.cam[2]);
        if (d > Math.sqrt(Math.max(0, eye * eye - R * R)) + 200) continue;
        const p = f.project(sys, f.v2);
        if (!p || p.x < -20 || p.y < -20 || p.x > window.innerWidth + 20 || p.y > window.innerHeight + 20) continue;
        const key = `${pv.id}:${s.id}`;
        seen.add(key);
        let el = this.els.get(key);
        if (!el) {
          el = h('div', { class: 'gn-lmark gn-lmark-prayer', data: { kind: 'settlement', id: String(s.id), planet: String(pv.id) }, html: icon('prayer') });
          this.els.set(key, el);
          this.root.append(el);
        }
        const top = s.prayers.reduce((a, b) => (b.urgency > a.urgency ? b : a), s.prayers[0]);
        el.title = `${s.name} prays for ${s.prayers.map((q) => PRAYER_WORDS[q.kind] ?? q.kind).join(' and ')} — click to see it`;
        el.style.setProperty('--u', top.urgency.toFixed(2));
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    for (const [k, el] of this.els) if (!seen.has(k)) { el.remove(); this.els.delete(k); }
  }

  /** test surface: the towns marked now */
  marked(): string[] { return [...this.els.keys()]; }
}

/** a settlement view's prophet and sacred marks for its label (the name's own small signs) */
export function labelSigns(s: SettlementView): { prayer: number; prophet: boolean; sacred: boolean } {
  const prayer = s.prayers?.length ? Math.max(...s.prayers.map((p) => p.urgency)) : -1;
  return { prayer, prophet: !!s.prophet, sacred: !!(s.sacred && (s.sacred.places > 0 || s.sacred.animal)) };
}
