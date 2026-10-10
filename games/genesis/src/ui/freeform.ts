// GENESIS — the "do this" field (CONTRACT.md §16.4, §11.6; Enter or `;`): say anything; the sim's deterministic
// parser reads it (sim.parse) and the preview shows what it will do before it is done — one line per resolved act, in
// the player's words, never the command's: "→ Teach · pottery · at Aru", "→ Gift · 50 bread · at Aru", "→ Gravity ·
// to 4 m/s²", "→ Rewind time · 1 h ago". Enter does it, ↑/↓ walk the history, examples are one click away.
// "here" is the point under the cursor when the field opened (sent to the sim as the `focus` the parser reads), shown
// as a pin on the ground while the field is open. A missing power is never a dead end (CONTRACT §1): when the words
// resolve to nothing, the preview offers the nearest powers and laws as chips (one click arms the power or opens the
// law) and "Do it" waits; the parser's full list of what it can do is one toggle away.

import type { Command, CommandResult } from '../sim/types.ts';
import type { GroundHit, UiHost } from './host.ts';
import type { Power } from './powers.ts';
import type { Catalog, LawRow } from './catalog.ts';
import { fmtParam, paramLabel } from './powers.ts';
import { h, clear, fmtNum, store } from './dom.ts';
import { icon } from './icons.ts';
import { placeWords, fmtDuration } from './words.ts';
import { fuzzy } from './fuzzy.ts';

const HISTORY_KEY = 'genesis.freeform.history';

/** examples shown when the field is empty: the breadth of what words can do */
const EXAMPLES = [
  'make it rain here for two days',
  'raise a mountain range here',
  'a meteor on {town}',
  'teach {town} pottery',
  'introduce chocolate to {town}',
  'set gravity to 4',
  'freeze the sun at noon',
  'rain frogs over {town}',
  'send wolves here',
  'make the people of {town} live twice as long',
  'start a war between {town} and {town2}',
  'a tornado heading for {town}',
  'invent telepathy',
  'how many people live in {town}?',
  'clear the skies everywhere',
  'turn the star red',
];

/** words that say nothing about which power is meant */
const STOP = new Set(('a an the of in on at to for it its that this these those everyone everybody all them they me my your their our i you we he she ' +
  'please here there and or with into onto be is are was were make makes made let lets do does give some any every can could would should will now ' +
  'just very more less so then than from by up down out over under again people').split(' '));

/** what people say → the words the powers and laws use */
const THESAURUS: Record<string, string[]> = {
  immortal: ['lifespan', 'live longer'], immortality: ['lifespan'], forever: ['lifespan'], eternal: ['lifespan'], die: ['lifespan', 'kill'], age: ['lifespan', 'age'],
  older: ['age', 'lifespan'], younger: ['age'], undo: ['rewind'], revert: ['rewind'], back: ['rewind'], oops: ['rewind'], past: ['rewind', 'change the past'],
  ocean: ['sea level', 'ocean', 'flood'], sea: ['sea level'], seas: ['sea level'], water: ['water', 'rain'], wet: ['rain', 'water'], dry: ['drought', 'drain'],
  hot: ['warmth', 'heat'], warmer: ['warmth'], colder: ['warmth', 'cold'], cold: ['cold', 'snow'], heavy: ['gravity'], light: ['gravity', 'brightness'],
  sun: ['star', 'sun'], dark: ['eclipse', 'brightness'], night: ['set the hour', 'day length'], day: ['day length', 'set the hour'], moon: ['moon'],
  kill: ['kill', 'cull', 'smite'], destroy: ['erase', 'raze', 'destroy'], erase: ['erase'], smite: ['lightning', 'kill'], bless: ['bless', 'heal'],
  sick: ['plague', 'heal', 'cure'], cure: ['cure', 'heal'], food: ['food', 'gift'], hungry: ['food'], smart: ['inspire', 'teach'], clever: ['inspire', 'teach'],
  learn: ['teach'], know: ['teach'], forget: ['forget', 'silence'], fight: ['war'], peace: ['peace'], love: ['bless', 'calm'], fear: ['lightning', 'slap'],
  grow: ['grow', 'forest', 'fertility'], trees: ['forest'], green: ['plant', 'forest'], fire: ['fire', 'ignite'], burn: ['fire', 'ignite'],
  bigger: ['scale', 'grow'], smaller: ['scale', 'shrink'], faster: ['speed'], slower: ['speed'], storm: ['storm', 'thunderstorm'],
};

interface Suggestion { label: string; sub: string; icon: string; run(): void }

export interface FreeformDeps {
  /** arm a power (a suggestion chip) */
  arm(p: Power): void;
  /** open the laws of the world at a law */
  openLaw(path: string): void;
  catalog: Catalog;
}

export class Freeform {
  readonly root: HTMLDivElement;
  readonly pin: HTMLDivElement;
  private host: UiHost;
  private deps: FreeformDeps;
  private input: HTMLInputElement;
  private go: HTMLButtonElement;
  private preview: HTMLDivElement;
  private examples: HTMLDivElement;
  private status: HTMLDivElement;
  private history: string[] = store.get<string[]>(HISTORY_KEY, []);
  private hi = -1;
  private draft = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;
  /** the cursor's ground point when the field opened: "here" */
  here: GroundHit | null = null;
  private busy = false;
  /** the last preview resolved to nothing: Enter does not send it */
  private unresolved = false;
  private showAll = false;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, worldLayer: HTMLElement, host: UiHost, deps: FreeformDeps) {
    this.host = host;
    this.deps = deps;
    this.input = h('input', { class: 'gn-ff-input', type: 'text', placeholder: 'Do this… say anything: “rain blood on Aru for three days”, “introduce chocolate”, “set gravity to 3”', spellcheck: 'false', autocomplete: 'off', aria: { label: 'Do this — in words' } }) as HTMLInputElement;
    this.preview = h('div', { class: 'gn-ff-preview', aria: { live: 'polite' } });
    this.examples = h('div', { class: 'gn-ff-examples' });
    this.status = h('div', { class: 'gn-ff-status' });
    this.go = h('button', { class: 'gn-btn gn-ff-go', title: 'Do it (Enter in the field)', text: 'Do it' });
    this.go.addEventListener('click', () => void this.execute());
    this.root = h('div', { class: 'gn-panel gn-ff', role: 'dialog', aria: { label: 'Do this' } },
      h('div', { class: 'gn-ff-bar' }, h('span', { class: 'gn-ff-mark', html: icon('words') }), this.input, this.go),
      this.preview, this.examples, this.status);
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.pin = h('div', { class: 'gn-herepin' }, h('div', { class: 'gn-herepin-l', text: 'here' }), h('div', { class: 'gn-herepin-p' }));
    this.pin.hidden = true;
    worldLayer.appendChild(this.pin);
    this.input.addEventListener('input', () => { this.hi = -1; this.schedule(); this.renderExamples(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(text = '', here: GroundHit | null = null): void {
    this.here = here;
    this.root.hidden = false;
    this.input.value = text;
    this.hi = -1;
    this.status.textContent = '';
    this.status.classList.remove('gn-warn');
    this.unresolved = false;
    this.go.disabled = false;
    clear(this.preview);
    this.renderExamples();
    this.input.focus();
    // the laws, for units and names in the preview
    this.deps.catalog.laws(here?.planet ?? this.host.primary());
    // "here" for the parser: the point under the cursor (a logged focus, like the camera's own)
    if (here) void this.host.cmd({ k: 'focus', planet: here.planet, pos: here.dir }, { quiet: true });
    if (text) this.schedule(0);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.pin.hidden = true;
    this.input.blur();
    if (this.timer) clearTimeout(this.timer);
    this.gen++;
    this.onClose?.();
  }

  /** place the "here" pin on screen (called every frame while open) */
  frame(): void {
    if (!this.isOpen || !this.here) { this.pin.hidden = true; return; }
    const s = this.host.screenOf(this.here.planet, this.here.dir, 1);
    if (!s) { this.pin.hidden = true; return; }
    this.pin.hidden = false;
    this.pin.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px) translate(-50%, -100%)`;
  }

  private schedule(ms = 140): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.parse(), ms);
  }

  private async parse(): Promise<void> {
    const text = this.input.value.trim();
    const gen = ++this.gen;
    if (!text) { clear(this.preview); this.unresolved = false; this.go.disabled = false; return; }
    if (this.host.source !== 'worker') { this.renderPreview({ ok: false, msg: 'This is the lookdev world: nothing here listens. Run the living simulation to be obeyed.' }, text); return; }
    const r = await this.host.parse(text);
    if (gen !== this.gen) return;
    this.renderPreview(r, text);
  }

  private renderPreview(r: CommandResult, text: string): void {
    clear(this.preview);
    const resolved = r.resolved ?? [];
    for (const c of resolved) this.preview.append(this.line(c));
    this.unresolved = !resolved.length && !r.ok;
    this.go.disabled = this.unresolved;
    if (this.unresolved) { this.renderFallback(r, text); return; }
    // the parser's own words: an answer, a question back (its "→ rain · 2 days" summary is the lines above)
    if (r.msg && !resolved.length) this.preview.append(h('div', { class: 'gn-ff-msg', text: r.msg }));
    else if (r.msg && !r.ok) this.preview.append(h('div', { class: 'gn-ff-msg gn-warn', text: r.msg }));
    else if (r.msg && resolved.length && !r.msg.trim().startsWith('→')) this.preview.append(h('div', { class: 'gn-ff-why', text: r.msg }));
    if (!resolved.length && r.ok && !r.msg) this.preview.append(h('div', { class: 'gn-ff-msg', text: 'Nothing to do.' }));
  }

  /** nothing resolved: the nearest powers and laws as chips, the parser's long answer behind a toggle */
  private renderFallback(r: CommandResult, text: string): void {
    const msg = r.msg ?? '';
    const cut = msg.search(/\s*(Here is what I can do|I can:)/);
    const lead = (cut > 0 ? msg.slice(0, cut) : msg.length > 140 ? '' : msg).replace(/\s*—?\s*did you mean[^?]*\?/i, '.').replace(/\.\.$/, '.').trim();
    this.preview.append(h('div', { class: 'gn-ff-msg gn-warn', text: lead || 'I am not sure what that asks for.' }));
    const sug = this.suggest(text, msg);
    if (sug.length) {
      const wrap = h('div', { class: 'gn-ff-sugg' }, h('span', { class: 'gn-ff-sugg-h', text: 'Nearest:' }));
      for (const s of sug) {
        const b = h('button', { class: 'gn-ff-sug', title: s.sub }, h('span', { class: 'gn-ff-sug-i', html: icon(s.icon) }), h('span', { text: s.label }), s.sub ? h('small', { text: s.sub }) : null);
        b.addEventListener('click', () => s.run());
        wrap.append(b);
      }
      this.preview.append(wrap);
    }
    if (msg.length > lead.length + 10) {
      const all = h('div', { class: 'gn-ff-all', text: msg });
      all.hidden = !this.showAll;
      const tg = h('button', { class: 'gn-btn gn-ff-toggle', text: this.showAll ? 'Hide what I can do' : 'What can I do?', aria: { expanded: String(this.showAll) } });
      tg.addEventListener('click', () => { this.showAll = !this.showAll; all.hidden = !this.showAll; tg.textContent = this.showAll ? 'Hide what I can do' : 'What can I do?'; tg.setAttribute('aria-expanded', String(this.showAll)); });
      this.preview.append(tg, all);
    }
  }

  /** up to five powers, laws or phrasings nearest to words that resolved to nothing */
  suggest(text: string, msg = ''): Suggestion[] {
    const out: (Suggestion & { score: number })[] = [];
    // the parser's own "did you mean …" phrasings first
    const words0 = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
    // the names of places and people say where, not what
    const names = new Set<string>();
    for (const pv of this.host.view.planets) for (const s of pv.settlements) for (const w of s.name.toLowerCase().split(/\s+/)) names.add(w);
    // the parser's own "did you mean …" phrasings (not the words of a town's name), below a strong match of our own
    const dm = /did you mean ([^?]+)\?/i.exec(msg);
    if (dm) for (const m of dm[1].matchAll(/["“]([^"”]+)["”]/g)) {
      const phrase = m[1].trim();
      if (phrase.length < 3 || names.has(phrase.toLowerCase())) continue;
      out.push({ label: `“${phrase}”`, sub: 'say it this way', icon: 'words', score: 15 - out.length * 0.1, run: () => { this.setText(phrase); this.input.focus(); } });
    }
    const words: { w: string; weight: number }[] = [];
    for (const w of words0) {
      if (names.has(w)) continue;
      words.push({ w, weight: 1 });
      for (const t of THESAURUS[w] ?? []) words.push({ w: t, weight: 1.3 });
    }
    if (!words.length) return out.slice(0, 5);
    const score = (texts: string[]): number => {
      let total = 0;
      for (const { w, weight } of words) {
        let best = 0;
        for (const t of texts) {
          const lt = t.toLowerCase();
          if (!lt) continue;
          if (lt === w) best = Math.max(best, 30);
          else if (new RegExp(`\\b${w.replace(/[^a-z0-9 ]/g, '')}`).test(lt)) best = Math.max(best, w.includes(' ') ? 26 : 20);
          else if (lt.includes(w)) best = Math.max(best, 10);
          else if (w.length >= 5) { const f = fuzzy(w, t); if (f && f.score >= w.length * 11) best = Math.max(best, 6); }
        }
        total += best * weight;
      }
      return total;
    };
    for (const p of this.host.powers.list) {
      const s = score([p.name, ...p.synonyms, p.category]) + score([p.desc]) * 0.4;
      if (s >= 18) out.push({ label: p.name, sub: p.category, icon: p.icon || 'cast', score: s, run: () => { this.close(); this.deps.arm(p); } });
    }
    const planet = this.here?.planet ?? this.host.primary();
    const seen = new Set<string>();
    for (const l of this.deps.catalog.laws(planet)) {
      const s = score([l.label, l.path.replace(/[.-]/g, ' ')]) + score([l.desc]) * 0.4;
      if (s < 18) continue;
      // one law per kind across the peoples ("lifespan" of each species): the first, named for what it is
      const key = l.path.replace(/^species\.[^.]+\./, 'species.*.');
      if (seen.has(key) && key !== l.path) continue;
      seen.add(key);
      out.push({ label: lawName(l), sub: `law · now ${lawValue(l)}`, icon: 'law', score: s + 2, run: () => { this.close(); this.deps.openLaw(l.path); } });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 5);
  }

  /** one resolved act: its power, then its parameters as chips in the player's words */
  private line(c: Command): HTMLDivElement {
    const book = this.host.powers;
    const pw = book.powerOf(c);
    const planet = typeof c.planet === 'number' ? c.planet : this.here?.planet ?? this.host.primary();
    const pv = this.host.view.planet(planet);
    const dayH = pv?.params.dayHours ?? 24;
    let name = pw?.name ?? book.commandName(c.k);
    const chips: string[] = [];
    // where: one chip, named by the nearest town
    let placeName: string | null = null;
    const where = (key: 'pos' | 'to' | 'toward', v: unknown): string | null => {
      if (!Array.isArray(v) || v.length !== 3) return null;
      const p = placeWords(this.host.view, planet, v as number[], this.here);
      if (p.name) placeName = p.name;
      if (key === 'pos') return p.text;
      if (p.kind === 'here') return key === 'to' ? 'to here' : 'toward here';
      return `${key === 'to' ? 'to' : 'toward'} ${p.bare}`;
    };
    if (c.k === 'set' && typeof c.path === 'string') {
      // a law: its name and the new value in its unit
      const law = this.deps.catalog.law(planet, c.path);
      name = law ? lawName(law) : cap(paramLabel(c.path.split('.').pop() ?? c.path));
      const unit = law?.unit && law.unit !== '0..1' && law.unit !== 'fraction' ? ` ${law.unit}` : '';
      chips.push(`to ${typeof c.value === 'number' ? fmtNum(c.value) : String(c.value)}${typeof c.value === 'number' ? unit : ''}`);
      if (law && typeof law.value === 'number') chips.push(`now ${fmtNum(law.value)}${unit}`);
    }
    for (const k of ['pos', 'to', 'toward'] as const) { const t = where(k, c[k]); if (t) chips.push(t); }
    for (const [k, v] of Object.entries(c)) {
      if (k === 'k' || k === 'god' || k === 'pos' || k === 'to' || k === 'toward') continue;
      if (c.k === 'set' && (k === 'path' || k === 'value')) continue;
      if (pw && pw.params[k] !== undefined && pw.params[k] === v) continue; // fixed by the power itself (its kind)
      if (k === 'planet') { const w = this.host.view.planet(Number(v)); if (w && w.id !== this.host.primary()) chips.push(`on ${w.name}`); continue; }
      if (k === 'everywhere' && v === true) { chips.push('everywhere'); continue; }
      if ((k === 'settlement' || k === 'other') && typeof v === 'number') {
        const sn = this.settlementName(v);
        if (sn && sn === placeName) continue; // the place chip names it already
        chips.push(k === 'other' ? `and ${sn ?? 'another town'}` : sn ?? 'a settlement');
        continue;
      }
      if (k === 'cmd' && v && typeof v === 'object') { chips.push(`→ ${book.commandName((v as Command).k)}`); continue; }
      if (k === 'items') { const t = itemsText(v); if (t) chips.push(t); continue; }
      if (/Ago$/.test(k) && typeof v === 'number') {
        const min = k === 'ticksAgo' ? v : k === 'hoursAgo' ? v * 60 : v * dayH * 60;
        chips.push(`${fmtDuration(min, dayH)} ago`);
        continue;
      }
      const ent = this.entityName(c.k, k, v, planet, pw);
      if (ent !== undefined) { if (ent) chips.push(ent); continue; }
      const s = pw?.schema[k];
      const val = k === 'ticks' && typeof v === 'number' ? fmtDuration(v, dayH) : fmtParam(k, v, s, dayH);
      if (!val) continue;
      if (k === 'kind' || k === 'species' || k === 'knowledge' || k === 'item' || k === 'idea' || k === 'substance' || k === 'disease' || k === 'animal' || k === 'crop') {
        // a kind the power's own name already says ("Meteor · meteor")
        if (name.toLowerCase().includes(val.toLowerCase())) continue;
        chips.push(val);
        continue;
      }
      if (k === 'duration') { chips.push(`for ${val}`); continue; }
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) continue; // never raw JSON
      chips.push(`${paramLabel(k)} ${val}`);
    }
    return h('div', { class: 'gn-ff-line', title: book.commandDescription(c.k) },
      h('span', { class: 'gn-ff-arrow', text: '→' }),
      h('span', { class: 'gn-ff-ico', html: icon(pw?.icon ?? (c.k === 'set' ? 'law' : 'words'), pw?.category) }),
      h('span', { class: 'gn-ff-name', text: name }),
      ...chips.map((t) => h('span', { class: 'gn-ff-chip', text: t })));
  }

  /** an id parameter as a name (undefined: not an entity parameter; '' : nothing worth showing) */
  private entityName(kind: string, k: string, v: unknown, planet: number, pw?: Power): string | undefined {
    const ref = typeof v === 'object' && v && typeof (v as { id?: unknown }).id === 'number' ? v as { kind?: string; id: number } : null;
    const id = typeof v === 'number' ? v : ref?.id;
    if (id === undefined) return undefined;
    const s = pw?.schema[k];
    let ek = ref?.kind ?? (s?.type === 'entity' ? s.entity?.[0] : undefined);
    if (!ek && (k === 'id' || k === 'target' || k === 'ship' || k === 'creature' || k === 'agent')) {
      const pre = kind.split('.')[0];
      ek = k === 'ship' ? 'ship' : k === 'creature' ? 'creature' : k === 'agent' ? 'agent'
        : pre === 'disaster' ? 'disaster' : pre === 'creature' ? 'creature' : pre === 'agent' || pre === 'possess' || pre === 'disciple' ? 'agent' : pre === 'ship' ? 'ship' : pre === 'world' ? 'planet' : undefined;
    }
    if (!ek) return undefined;
    const n = this.deps.catalog.nameOf({ kind: ek, id, planet });
    if (n) return n;
    return ek === 'agent' ? 'someone' : `the ${ek}`;
  }

  private settlementName(id: number): string | null {
    for (const pv of this.host.view.planets) { const s = pv.settlements.find((q) => q.id === id); if (s) return s.name; }
    return null;
  }

  private renderExamples(): void {
    clear(this.examples);
    if (this.input.value.trim()) { this.examples.hidden = true; return; }
    this.examples.hidden = false;
    const towns: string[] = [];
    for (const pv of this.host.view.planets) for (const s of pv.settlements) if (!(s.flags & 2) && towns.length < 4) towns.push(s.name);
    const t1 = towns[0] ?? 'the coast', t2 = towns[1] ?? towns[0] ?? 'the hills';
    const recent = this.history.slice(0, 4);
    if (recent.length) {
      this.examples.append(h('div', { class: 'gn-ff-ex-h', text: 'Said before' }));
      for (const r of recent) this.examples.append(this.exampleChip(r, true));
    }
    this.examples.append(h('div', { class: 'gn-ff-ex-h', text: 'For example' }));
    const wrap = h('div', { class: 'gn-ff-ex-wrap' });
    for (const ex of EXAMPLES) wrap.append(this.exampleChip(ex.replace('{town}', t1).replace('{town2}', t2), false));
    this.examples.append(wrap);
  }

  private exampleChip(text: string, past: boolean): HTMLButtonElement {
    const b = h('button', { class: `gn-ff-ex${past ? ' gn-past' : ''}`, text });
    b.addEventListener('click', () => { this.input.value = text; this.input.focus(); this.renderExamples(); this.schedule(0); });
    return b;
  }

  /** do what the words say */
  async execute(): Promise<CommandResult | null> {
    const text = this.input.value.trim();
    if (!text || this.busy) return null;
    if (this.unresolved) {
      // nothing to send: point at the chips instead
      this.status.textContent = 'Those words do not reach a power yet — pick one of the nearest above, or say it another way.';
      this.status.classList.add('gn-warn');
      return { ok: false, msg: this.status.textContent };
    }
    this.busy = true;
    this.history = [text, ...this.history.filter((x) => x !== text)].slice(0, 50);
    store.set(HISTORY_KEY, this.history);
    try {
      if (this.here) await this.host.cmd({ k: 'focus', planet: this.here.planet, pos: this.here.dir }, { quiet: true });
      const r = await this.host.cmd({ k: 'freeform', text });
      if (r.ok) {
        // what it made can be looked at: the first creature / disaster / settlement it created
        const made = r.created?.find((e) => e.kind === 'disaster' || e.kind === 'creature' || e.kind === 'settlement' || e.kind === 'ship');
        if (made) this.host.select({ ...made, planet: made.planet ?? this.host.primary() });
        this.close();
      } else {
        this.status.textContent = r.msg ?? 'That could not be done.';
        this.status.classList.add('gn-warn');
      }
      return r;
    } finally {
      this.busy = false;
    }
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); void this.execute(); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.history.length) return;
      e.preventDefault();
      if (this.hi < 0) this.draft = this.input.value;
      this.hi = Math.max(-1, Math.min(this.history.length - 1, this.hi + (e.key === 'ArrowUp' ? 1 : -1)));
      this.input.value = this.hi < 0 ? this.draft : this.history[this.hi];
      this.renderExamples();
      this.schedule(0);
    }
  }

  setText(t: string): void { this.input.value = t; this.renderExamples(); this.schedule(0); }
  get text(): string { return this.input.value; }
  /** test surface: the preview as text lines */
  previewText(): string[] {
    return Array.from(this.preview.children).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
}

function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** "plains-folk lifespan" → "Lifespan of the plains folk" */
function lawName(l: LawRow): string {
  const m = /^species\.([^.]+)\.(.+)$/.exec(l.path);
  if (m) return `${cap(paramLabel(m[2]))} of the ${m[1].replace(/-/g, ' ')}`;
  return cap(l.label || paramLabel(l.path.split('.').pop() ?? l.path));
}

function lawValue(l: LawRow): string {
  const unit = l.unit && l.unit !== '0..1' && l.unit !== 'fraction' ? ` ${l.unit}` : '';
  return typeof l.value === 'number' ? `${fmtNum(l.value)}${unit}` : String(l.value);
}

/** { bread: 50 } or [{ item: 'bread', qty: 50 }] → "50 bread" */
function itemsText(v: unknown): string {
  const parts: string[] = [];
  if (Array.isArray(v)) {
    for (const x of v) if (x && typeof x === 'object') { const o = x as { item?: unknown; qty?: unknown }; parts.push(`${fmtNum(Number(o.qty ?? 1))} ${String(o.item ?? 'things').replace(/-/g, ' ')}`); }
  } else if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) parts.push(`${fmtNum(Number(n))} ${k.replace(/-/g, ' ')}`);
  }
  return parts.join(', ');
}
