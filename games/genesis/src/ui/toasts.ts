// GENESIS — toasts (CONTRACT.md §16.1 "small toasts bottom-left", §1.6 "toasts that say what happened and why"):
// what the sim's peoples just did, in the chronicle's own words where it has them.
//
// Sources, consumed once per frame from the WorldView mirror:
//   * SimEvents (view.pendingEvents): discovery, birth, death, settlement.founded / .split / .fallen, refusal, loss,
//     plague. Births and deaths come in BURSTS (a winter, a plague, a baby boom), so they are gathered per settlement
//     over a short window into one line ("3 children born in Aru", "4 died in Aru — cold, hunger"). Discoveries that
//     arrive together are gathered the same way.
//   * Chronicle entries (view.chronicle): the readable story of an event ("Grain spilled around the camp at Aru grew
//     again the next season…"). An event takes the text of the chronicle entry written at the same tick about the
//     same thing; chronicle entries that no event claimed are shown when they matter (weight ≥ 2, or a first
//     building / first child: the milestones of a young settlement).
// A toast with a place is a button: clicking it flies the camera there. At most five are shown; a flood (1000×)
// collapses into a "+N more" line rather than scrolling the screen. A toast may carry one action (the "Undo" offered
// after a cast that killed many). Words for people: coordinates become the nearest town ("near Aru"), minutes become
// hours, and a line that starts "Year 4." loses it when the header already dates it — and the header's date is the
// chronicle entry's own. Plain DOM; styles in styles.css (.gn-toast*).

import type { ChronicleEntry, EntityRef, SimEvent, UnitVec } from '../sim/types.ts';
import type { WorldView } from '../client/worldview.ts';
import { stripYear } from './words.ts';

export type ToastKind = 'discovery' | 'birth' | 'death' | 'founding' | 'refusal' | 'loss' | 'fall' | 'plague' | 'god' | 'nature' | 'war' | 'peace' | 'info' | 'warn';

export interface ToastSpec {
  kind?: ToastKind;
  /** small caps line above the text (what kind of news, and where) */
  title?: string;
  text: string;
  /** a place to fly to when the toast is clicked */
  at?: { planet: number; pos: UnitVec } | null;
  /** a thing to select (inspect) when the toast is clicked: a disaster, a creature, a ship */
  select?: EntityRef | null;
  /** date line ("Year 2 · day 7") */
  date?: string;
  ms?: number;
  /** one action button on the toast ("Undo") */
  action?: ToastAction | null;
  /** the sim tick the news is from (a rewind past it takes the toast back); news from the sim is stamped by itself */
  tick?: number;
  /** the world the news is about (coordinates in the text are named by its towns) */
  planet?: number;
}

export interface ToastAction { label: string; title?: string; run(): void }

export interface ToastActions {
  lookAt(planet: number, pos: UnitVec): void;
  /** select (inspect) a thing a toast names */
  select?(ref: EntityRef): void;
}

const ICONS: Record<ToastKind, string> = {
  discovery: '<path d="M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7l-3.7 2.4 1.1-4.3L2 6l4.4-.3z"/>',
  birth: '<path d="M8 14.5V8.2M8 8.2C8 5 5.6 3.3 2.6 3.6 2.6 6.6 4.8 8.4 8 8.2zM8 9.6c0-2.9 2.2-4.7 5.4-4.4 0 3-2.3 4.6-5.4 4.4z"/>',
  death: '<path d="M8 2v12M4.5 5.5h7"/>',
  founding: '<path d="M2.5 13.5h11M3.8 13.5V7.6L8 3.6l4.2 4v5.9M6.6 13.5v-3.2h2.8v3.2"/>',
  refusal: '<circle cx="8" cy="8" r="5.6"/><path d="M4 12L12 4"/>',
  loss: '<path d="M3.5 3h6.8l2.2 2.2V13H3.5zM6 7.5l4 3.5M10 7.5L6 11"/>',
  fall: '<path d="M2.5 13.5h11M4 13.5V9l2-1.4V13.5M8.5 13.5V6.2l2 1.5v5.8M6.8 5.2l1.2-2 1 1.4"/>',
  plague: '<path d="M8 2.2c2 3 4 5.1 4 7.3a4 4 0 0 1-8 0c0-2.2 2-4.3 4-7.3z"/><circle cx="8" cy="10" r="1.2"/>',
  god: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M3.8 12.2l2-2M10.2 5.8l2-2"/>',
  nature: '<path d="M1.8 10c2-2.4 4-2.4 6.2 0s4.2 2.4 6.2 0M1.8 6.6c2-2.4 4-2.4 6.2 0s4.2 2.4 6.2 0"/>',
  war: '<path d="M3 3l10 10M13 3L3 13M3 3v2.4M3 3h2.4M13 3v2.4M13 3h-2.4"/>',
  peace: '<path d="M2.5 9.5l3-3 2 1.2 2-1.7 4 3.3M5.5 6.5l2.8 3.2M8.5 8l1.8 1.9"/>',
  info: '<circle cx="8" cy="8" r="5.6"/><path d="M8 7.2v4M8 4.8v.4"/>',
  warn: '<path d="M8 2.2l6 10.6H2zM8 6.6v3M8 11.2v.3"/>',
};

const BURST_MS = 3200;
/** what stays on screen when too much happens at once: losses and refusals over discoveries over births and weather */
const PRIORITY: Partial<Record<ToastKind, number>> = {
  // the answer to what the player just did (god, warn) outranks any news
  god: 4, warn: 4, loss: 3, fall: 3, war: 3, refusal: 3, plague: 3, discovery: 2, founding: 2, peace: 2, birth: 1, death: 1, info: 1, nature: 0,
};
const MAX_SHOWN = 4;

interface Burst {
  planet: number;
  settlement: number;
  births: number;
  deaths: number;
  names: string[];
  causes: Map<string, number>;
  discoveries: string[];
  /** a birth was the settlement's first child (its chronicle line was claimed) */
  firstChild: boolean;
  pos: UnitVec | null;
  firstTick: number;
  at: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

/** "rope making, spears and hide working" */
function listText(items: string[], max = 4): string {
  const l = items.slice(0, max);
  if (items.length > max) l.push(`${items.length - max} more`);
  if (l.length <= 1) return l[0] ?? '';
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

function lower(s: string): string {
  return /^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export class Toasts {
  readonly root: HTMLDivElement;
  readonly actions: ToastActions;
  private chronicleSeen = 0;
  /** chronicle entries not yet shown or claimed, kept for a moment so an event of the same tick can claim them */
  private pendingChron: { e: ChronicleEntry; at: number }[] = [];
  /** the tick of the event or entry being shown from pump() (stamps its toast) */
  private curTick: number | null = null;
  /** after an undo: news from past this tick that was already on its way is dropped until the rewind arrives */
  private forgetTick = -1;
  private forgetUntil = 0;
  private bursts = new Map<string, Burst>();
  private recent: number[] = [];
  /** toasts on screen by their words (repeats count up instead of stacking) */
  private showing = new Map<string, { box: HTMLElement; n: number; countEl: HTMLElement; ms: number; timer: ReturnType<typeof setTimeout> }>();
  private overflow = 0;
  private overflowEl: HTMLDivElement | null = null;
  /** muted while the boot / a load replays history */
  enabled = true;
  /** the opening is on: the worlds' firsts are its whispers, not toasts */
  muteMilestones = false;
  /** lifetime of news toasts (ms); screenshots of a software-rendered page raise it (__GENESIS__.toastLife) */
  life = 7800;
  /** words for people (the shell's: coordinates → places, minutes → hours) */
  words: ((text: string, planet: number | undefined) => string) | null = null;

  constructor(parent: HTMLElement, actions: ToastActions) {
    this.actions = actions;
    this.root = el('div', 'gn-toasts');
    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-live', 'polite');
    parent.appendChild(this.root);
  }

  /** show one toast now */
  show(t: ToastSpec): void {
    const now = performance.now();
    const planet = t.planet ?? t.at?.planet ?? t.select?.planet;
    let words = this.words ? this.words(t.text, planet) : t.text;
    if (t.date) words = stripYear(words);
    t = { ...t, text: words };
    // the same words again while the first is still up (a brush stroke's dabs, a held key): one toast that counts
    const key = `${t.kind ?? 'info'}|${t.title ?? ''}|${t.text}`;
    const same = this.showing.get(key);
    if (same && same.box.isConnected && !same.box.classList.contains('gn-out')) {
      same.n++;
      same.countEl.textContent = `×${same.n}`;
      same.countEl.hidden = false;
      clearTimeout(same.timer);
      same.timer = this.expire(same.box, same.ms, key);
      return;
    }
    const kind = t.kind ?? 'info';
    // a flood of news: more than 6 in 2 s → count the rest into one line (the answer to the player's own act always shows)
    const own = kind === 'god' || kind === 'warn' || kind === 'info';
    this.recent = this.recent.filter((x) => now - x < 2000);
    if (!own && this.recent.length >= 6) { this.bumpOverflow(); return; }
    if (!own) this.recent.push(now);
    const clickable = !!t.at || (!!t.select && !!this.actions.select);
    // a clickable toast is a div with a button's role (it may hold its own action button: buttons do not nest)
    const box = el('div', `gn-panel gn-toast gn-t-${kind}${clickable ? ' gn-toast-go' : ''}`) as HTMLElement;
    if (clickable) {
      box.setAttribute('role', 'button');
      box.tabIndex = 0;
      box.title = t.select ? 'Inspect' : 'Look there';
      const at = t.at, sel = t.select;
      const go = () => {
        if (sel && this.actions.select) this.actions.select(sel);
        if (at) this.actions.lookAt(at.planet, at.pos);
      };
      box.addEventListener('click', go);
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    }
    const icon = el('span', 'gn-t-icon');
    icon.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[kind]}</svg>`;
    const body = el('div', 'gn-t-body');
    if (t.title || t.date) {
      const head = el('div', 'gn-t-title');
      const ti = el('span');
      ti.textContent = t.title ?? '';
      head.appendChild(ti);
      if (t.date) { const d = el('span', 'gn-t-date'); d.textContent = t.date; head.appendChild(d); }
      body.appendChild(head);
    }
    const tx = el('div', 'gn-t-text');
    tx.textContent = t.text;
    const countEl = el('span', 'gn-t-count');
    countEl.hidden = true;
    tx.appendChild(countEl);
    body.appendChild(tx);
    if (t.action) {
      const a = t.action;
      const b = el('button', 'gn-btn gn-t-act');
      b.type = 'button';
      b.textContent = a.label;
      if (a.title) b.title = a.title;
      b.addEventListener('click', (e) => { e.stopPropagation(); b.disabled = true; a.run(); box.classList.add('gn-out'); setTimeout(() => box.remove(), 520); });
      body.appendChild(b);
    }
    box.append(icon, body);
    box.dataset.pri = String(PRIORITY[kind] ?? 1);
    const tk = t.tick ?? this.curTick;
    if (tk !== null && tk !== undefined) box.dataset.tick = String(tk);
    this.root.appendChild(box);
    this.trim();
    // an action needs time to be taken
    const ms = Math.max(t.ms ?? (kind === 'info' || kind === 'warn' ? 5200 : this.life), this.life > 7800 ? this.life : 0, t.action ? 12000 : 0);
    this.showing.set(key, { box, n: 1, countEl, ms, timer: this.expire(box, ms, key) });
  }

  /** fade a toast out after ms */
  private expire(box: HTMLElement, ms: number, key: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      box.classList.add('gn-out');
      setTimeout(() => box.remove(), 520);
      if (this.showing.get(key)?.box === box) this.showing.delete(key);
    }, ms);
  }

  private bumpOverflow(): void {
    this.overflow++;
    if (!this.overflowEl || !this.overflowEl.isConnected) {
      this.overflowEl = el('div', 'gn-panel gn-toast gn-t-more');
      this.overflowEl.dataset.pri = '4';
      this.root.appendChild(this.overflowEl);
      const node = this.overflowEl;
      setTimeout(() => { node.classList.add('gn-out'); setTimeout(() => node.remove(), 520); this.overflow = 0; }, 4000);
    }
    this.overflowEl.textContent = `+${this.overflow} more — the chronicle has them all`;
    this.trim();
  }

  /** keep the column short: when it overflows, the least important (then the oldest) news goes first */
  private trim(): void {
    while (this.root.children.length > MAX_SHOWN) {
      let worst: Element | null = null, wp = Infinity;
      for (const c of Array.from(this.root.children)) {
        const p = Number((c as HTMLElement).dataset.pri ?? 1);
        if (p < wp) { wp = p; worst = c; }
      }
      (worst ?? this.root.firstElementChild)?.remove();
    }
  }

  /** the world the camera is on: news from elsewhere names its world */
  private primary = -1;

  /** consume new events and chronicle entries from the mirror (call once per frame) */
  pump(view: WorldView, now: number, primary = -1): void {
    this.primary = primary;
    const evs = view.pendingEvents.splice(0);
    // the mirror keeps the last 4000 entries: follow its tail
    if (this.chronicleSeen > view.chronicle.length) this.chronicleSeen = view.chronicle.length;
    for (let i = this.chronicleSeen; i < view.chronicle.length; i++) this.pendingChron.push({ e: view.chronicle[i], at: now });
    this.chronicleSeen = view.chronicle.length;
    if (!this.enabled) { this.pendingChron.length = 0; this.bursts.clear(); return; }
    if (this.forgetTick >= 0 && now > this.forgetUntil) this.forgetTick = -1;
    for (const e of evs) {
      // the world ran back: what was told of the undone time is taken back (its toasts, its news still waiting)
      if (e.t === 'rewind') { this.dropAfter(typeof e.a === 'number' ? e.a : e.tick); this.forgetTick = -1; }
      else if (this.forgetTick >= 0 && e.tick > this.forgetTick) continue;
      this.curTick = e.tick;
      try { this.onEvent(view, e, now); } finally { this.curTick = null; }
    }
    // bursts whose window closed
    for (const [k, b] of this.bursts) if (now - b.at > BURST_MS) { this.bursts.delete(k); this.flushBurst(view, b); }
    // chronicle entries nobody claimed within ~half a second: the milestones are toasts of their own
    for (let i = this.pendingChron.length - 1; i >= 0; i--) {
      const c = this.pendingChron[i];
      if (now - c.at < 500) continue;
      this.pendingChron.splice(i, 1);
      const e = c.e;
      const milestone = e.weight >= 2 || (e.kind === 'founding' && e.weight >= 1);
      if (!milestone || e.kind === 'death') continue;
      // (during the opening the world's firsts — air, the first sea, green — are whispered, not toasted)
      if (this.muteMilestones && (e.kind === 'nature' || e.kind === 'world' || e.kind === 'milestone')) continue;
      if (this.forgetTick >= 0 && e.tick > this.forgetTick) continue;
      this.show({ tick: e.tick, kind: kindOfChronicle(e.kind), title: titleOfChronicle(e.kind, view, e.planet), text: e.text, date: `Year ${e.year} · day ${e.day}`, at: this.placeOf(view, e), planet: e.planet });
    }
  }

  /**
   * An undo: the world goes back to `tick`. The news of the time after it is taken back — the toasts on screen from
   * it, and what is still on its way (until the rewind itself arrives, or a few seconds).
   */
  forget(tick: number): void {
    this.forgetTick = tick;
    this.forgetUntil = performance.now() + 4000;
    this.dropAfter(tick);
  }

  private dropAfter(tick: number): void {
    this.pendingChron = this.pendingChron.filter((c) => c.e.tick <= tick);
    for (const c of Array.from(this.root.children) as HTMLElement[]) {
      const tk = c.dataset.tick;
      if (tk === undefined || Number(tk) <= tick || c.classList.contains('gn-out')) continue;
      c.classList.add('gn-out');
      setTimeout(() => c.remove(), 520);
    }
    for (const [k, v] of this.showing) if (!v.box.isConnected || v.box.classList.contains('gn-out')) this.showing.delete(k);
  }

  /** the chronicle entry written at this tick about this thing (removed from the pending list) */
  private claim(tick: number, match: (c: ChronicleEntry) => boolean): ChronicleEntry | null {
    for (let i = 0; i < this.pendingChron.length; i++) {
      const c = this.pendingChron[i].e;
      if (c.tick === tick && match(c)) { this.pendingChron.splice(i, 1); return c; }
    }
    return null;
  }

  private placeOf(view: WorldView, e: ChronicleEntry): { planet: number; pos: UnitVec } | null {
    const pv = view.planet(e.planet);
    if (!pv || !e.refs) return null;
    for (const r of e.refs) {
      if (r.kind === 'settlement') {
        const s = pv.settlements.find((q) => q.id === r.id);
        if (s) return { planet: pv.id, pos: s.pos };
      }
    }
    return null;
  }

  private settlementName(view: WorldView, planet: number | undefined, id: unknown): string {
    const pv = view.planet(planet ?? -1);
    const s = pv?.settlements.find((q) => q.id === id);
    return s ? s.name : 'a band';
  }

  /** "Aru", or "Aru, on Rust" when the news comes from a world the camera is not on */
  private where(view: WorldView, planet: number, id: unknown): string {
    const name = this.settlementName(view, planet, id);
    if (this.primary < 0 || planet === this.primary) return name;
    const w = view.planet(planet)?.name;
    return w ? `${name}, ${w}` : name;
  }

  private onEvent(view: WorldView, e: SimEvent, now: number): void {
    const planet = e.planet ?? -1;
    const at = e.pos ? { planet, pos: e.pos } : null;
    const data = e.data ?? {};
    let sid = typeof data.settlement === 'number' ? data.settlement : e.ref?.kind === 'settlement' ? e.ref.id : -1;
    // an event about a person names their settlement through the movers block
    if (sid < 0 && e.ref?.kind === 'agent') {
      const A = view.planet(planet)?.agents;
      if (A) for (let i = 0; i < A.count; i++) if (A.id[i] === e.ref.id) { sid = A.group[i]; break; }
    }
    const where = this.settlementName(view, planet, sid);
    const place = this.where(view, planet, sid);
    const date = dateOf(view, planet, e.tick);
    switch (e.t) {
      case 'birth':
      case 'death': {
        const b = this.burst(planet, sid, e, now);
        if (e.t === 'birth') b.births++;
        else {
          b.deaths++;
          if (typeof data.name === 'string') b.names.push(data.name);
          const cause = typeof data.cause === 'string' ? data.cause : e.text ?? 'unknown';
          b.causes.set(cause, (b.causes.get(cause) ?? 0) + 1);
          // a named death's chronicle line ("Hesh of Aru died (old age)") is claimed by the burst
          this.claim(e.tick, (c) => c.kind === 'death');
        }
        if (e.t === 'birth' && this.claim(e.tick, (c) => c.kind === 'founding' && c.refs?.some((r) => r.kind === 'agent' && r.id === e.ref?.id) === true)) b.firstChild = true;
        return;
      }
      case 'discovery': {
        const what = lower(e.text ?? String(data.knowledge ?? 'something'));
        const c = this.claim(e.tick, (q) => (q.kind === 'discovery' || q.kind === 'god') && q.refs?.some((r) => r.kind === 'agent' && r.id === e.ref?.id) === true)
          ?? this.claim(e.tick, (q) => (q.kind === 'discovery' || q.kind === 'god') && mentions(q.text, what));
        // the first discovery of a settlement in a while gets its own story; more arriving on its heels (a band that
        // just learned to experiment, 1000×) are gathered into one line when the window closes
        const last = this.lastDiscovery.get(`${planet}:${sid}`) ?? -1e9;
        if (now - last < BURST_MS) { this.burst(planet, sid, e, now).discoveries.push(what); return; }
        this.lastDiscovery.set(`${planet}:${sid}`, now);
        this.show({ kind: 'discovery', title: `Discovery · ${place}`, text: c ? c.text : `${where} learned ${what}${HOW[String(data.how)] ?? ''}.`, date: dateFrom(c, date), at });
        return;
      }
      case 'settlement.founded': {
        const c = this.claim(e.tick, (q) => (q.kind === 'founding' || q.kind === 'diaspora') && mentions(q.text, e.text ?? where));
        this.show({ kind: 'founding', title: `Founded · ${e.text ?? where}`, text: c ? c.text : `${e.text ?? 'A new settlement'} was founded.`, date: dateFrom(c, date), at });
        return;
      }
      case 'settlement.split': {
        const c = this.claim(e.tick, (q) => (q.kind === 'diaspora' || q.kind === 'founding' || q.kind === 'split') && mentions(q.text, where));
        this.show({ kind: 'founding', title: `Split · ${place}`, text: c ? c.text : `${e.a ?? 'Some'} people left ${where} to found a new home.`, date: dateFrom(c, date), at });
        return;
      }
      case 'settlement.fallen': {
        const c = this.claim(e.tick, (q) => (q.kind === 'fall' || q.kind === 'diaspora') && mentions(q.text, e.text ?? where));
        this.show({ kind: 'fall', title: `Fallen · ${e.text ?? where}`, text: c ? c.text : `${e.text ?? where} has fallen${data.cause ? ` (${String(data.cause)})` : ''}.`, date: dateFrom(c, date), at });
        return;
      }
      case 'refusal': {
        const what = lower(String(data.knowledge ?? e.text ?? 'the gift')).replace(/-/g, ' ');
        const c = this.claim(e.tick, (q) => q.kind === 'god' && mentions(q.text, what));
        // a whole people refuses at once (one event per person): one toast per gift and reason
        const rk = `${planet}:${what}:${String(data.reason ?? '')}`;
        if (now - (this.lastRefusal.get(rk) ?? -1e9) < BURST_MS) return;
        this.lastRefusal.set(rk, now);
        this.show({ kind: 'refusal', title: `Refused · ${where === 'a band' ? 'the god\'s gift' : place}`, text: c ? c.text : `They refused ${what}: ${String(data.reason ?? e.text ?? 'they would not')}.`, date: dateFrom(c, date), at });
        return;
      }
      case 'loss': {
        const c = this.claim(e.tick, (q) => (q.kind === 'loss' || q.kind === 'god') && mentions(q.text, lower(e.text ?? '')));
        this.show({ kind: 'loss', title: `Lost · ${place}`, text: c ? c.text : `${where} lost ${lower(e.text ?? 'something')}.`, date: dateFrom(c, date), at });
        return;
      }
      case 'plague': {
        const c = this.claim(e.tick, (q) => q.kind === 'plague' && mentions(q.text, lower(e.text ?? '')));
        this.show({ kind: 'plague', title: `Plague · ${place}`, text: c ? c.text : `${e.text ?? 'A sickness'} broke out in ${where}.`, date: dateFrom(c, date), at });
        return;
      }
      case 'milestone': {
        // the opening says the worlds' firsts itself, in its whispers
        if (this.muteMilestones) return;
        // the worlds' firsts (air, the first rain, the first sea, green, people, fire, night): the god's own news
        const c = this.claim(e.tick, (q) => q.kind === 'god' || q.kind === 'world' || q.kind === 'milestone');
        this.show({ kind: 'god', title: `${titleOfChronicle('world', view, planet).replace('The worlds', 'A first')}`, text: c ? c.text : e.text ?? 'Something new under the sun.', date: dateFrom(c, date), at, planet });
        return;
      }
      case 'disaster': {
        // nature's (or a rival's) disasters announce themselves; the god's own are answered by the command's toast
        const god = typeof data.god === 'number' ? data.god : -1;
        if (god === 0) return;
        const ref = e.ref ? { ...e.ref, planet } : null;
        const c = this.claim(e.tick, (q) => q.kind === 'disaster');
        this.show({ kind: 'warn', title: `${god > 0 ? 'A rival\'s wrath' : 'Nature'} · ${view.planet(planet)?.name ?? ''}`, text: c ? c.text : `${e.text ?? 'A disaster'} has begun${god > 0 ? ', sent by a rival god' : ''}. Click to see it.`, date: dateFrom(c, date), at, select: ref, planet });
        return;
      }
      case 'creature.learned': {
        const ref = e.ref ? { ...e.ref, planet } : null;
        this.show({ kind: 'god', title: 'The creature learns', text: `It watched your hand and learned the ${String(data.miracle ?? e.text ?? 'miracle')} miracle.`, date, at, select: ref });
        return;
      }
      case 'rival.act': {
        const name = typeof data.name === 'string' ? data.name : 'A rival god';
        const rk = `rival:${name}:${String(data.k ?? '')}`;
        if (now - (this.lastRefusal.get(rk) ?? -1e9) < BURST_MS * 4) return;
        this.lastRefusal.set(rk, now);
        this.show({ kind: 'god', title: `${name} acts`, text: e.text ?? `${name} worked a wonder for their faithful.`, date, at });
        return;
      }
      default:
    }
  }

  /** when each refusal (world, gift, reason) was last shown */
  private lastRefusal = new Map<string, number>();
  /** when each settlement's last discovery toast was shown (performance clock) */
  private lastDiscovery = new Map<string, number>();

  private burst(planet: number, sid: number, e: SimEvent, now: number): Burst {
    const key = `${planet}:${sid}`;
    let b = this.bursts.get(key);
    if (!b) {
      b = { planet, settlement: sid, births: 0, deaths: 0, names: [], causes: new Map(), discoveries: [], firstChild: false, pos: e.pos ?? null, firstTick: e.tick, at: now };
      this.bursts.set(key, b);
    }
    if (!b.pos && e.pos) b.pos = e.pos;
    return b;
  }

  private flushBurst(view: WorldView, b: Burst): void {
    const where = this.settlementName(view, b.planet, b.settlement);
    const place = this.where(view, b.planet, b.settlement);
    const pv = view.planet(b.planet);
    const s = pv?.settlements.find((q) => q.id === b.settlement);
    const at = s ? { planet: b.planet, pos: s.pos } : b.pos ? { planet: b.planet, pos: b.pos } : null;
    const date = dateOf(view, b.planet, b.firstTick);
    if (b.discoveries.length) {
      this.show({ kind: 'discovery', title: `Discoveries · ${place}`, text: `${where} worked out ${listText(b.discoveries)}.`, date, at });
    }
    if (b.births) {
      const first = b.firstChild ? ' The first child of the new home.' : '';
      this.show({ kind: 'birth', title: `${b.births === 1 ? 'Birth' : 'Births'} · ${place}`, text: `${b.births === 1 ? 'A child was' : `${b.births} children were`} born in ${where}.${first}`, date, at });
    }
    if (b.deaths) {
      const causes = [...b.causes.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
      const text = b.deaths === 1 && b.names.length
        ? `${b.names[0]} of ${where} died (${causes[0] ?? 'unknown'}).`
        : `${b.deaths} died in ${where} — ${listText(causes, 3)}.`;
      this.show({ kind: 'death', title: `${b.deaths === 1 ? 'Death' : 'Deaths'} · ${place}`, text, date, at });
    }
  }
}

/** a chronicle line is about this thing (several stories can be told in one tick: a god act and its refusal) */
function mentions(text: string, what: string): boolean {
  return !what || text.toLowerCase().includes(what.toLowerCase());
}

/** how a discovery came about, as words */
const HOW: Record<string, string> = {
  god: ', a gift of the god', experiment: ' by trying', accident: ' by chance', observation: ' by watching others', taught: ', taught by a master',
  artifact: ' from a strange thing they found',
};

/** a toast's date: the chronicle entry's own when one tells the story (its world's calendar), else the event's */
function dateFrom(c: ChronicleEntry | null, fallback: string | undefined): string | undefined {
  return c ? `Year ${c.year} · day ${c.day}` : fallback;
}

function dateOf(view: WorldView, planet: number, tick: number): string | undefined {
  const pv = view.planet(planet);
  if (!pv) return undefined;
  const c = view.calendar(pv, tick);
  return `Year ${c.year} · day ${c.day}`;
}

function kindOfChronicle(k: string): ToastKind {
  switch (k) {
    case 'discovery': return 'discovery';
    case 'founding': case 'diaspora': case 'golden-age': case 'split': case 'era': case 'people': case 'polity': case 'culture': return 'founding';
    case 'loss': return 'loss';
    case 'fall': case 'dark-age': case 'world': return 'fall';
    case 'plague': return 'plague';
    case 'god': return 'god';
    case 'nature': case 'extinction': case 'speciation': case 'ecology': return 'nature';
    case 'war': case 'crime': return 'war';
    case 'treaty': case 'trade': case 'contact': case 'gift': return 'peace';
    case 'orbit': return 'discovery';
    case 'disaster': case 'hardship': return 'warn';
    default: return 'info';
  }
}

function titleOfChronicle(k: string, view: WorldView, planet: number): string {
  const world = view.planet(planet)?.name ?? '';
  const label: Record<string, string> = {
    discovery: 'Discovery', founding: 'Milestone', diaspora: 'Diaspora', 'golden-age': 'A new age', loss: 'Lost', fall: 'Fall',
    plague: 'Plague', god: 'The god', nature: 'The world', disaster: 'Disaster', 'dark-age': 'Dark age', people: 'The peoples', hardship: 'Hardship',
    war: 'War', treaty: 'Treaty', trade: 'Trade', contact: 'Contact', gift: 'Gift', crime: 'Crime', extinction: 'Extinction',
    speciation: 'New species', ecology: 'Life', culture: 'Custom', polity: 'Realm', split: 'Schism', era: 'A new age', world: 'The worlds', orbit: 'The sky',
  };
  return `${label[k] ?? 'Chronicle'}${world ? ` · ${world}` : ''}`;
}
