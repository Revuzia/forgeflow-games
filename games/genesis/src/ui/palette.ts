// GENESIS — the command palette (CONTRACT.md §16.2; `/`, Ctrl+K, gamepad Y): fuzzy search over every power (name,
// synonyms, category, description), every law of the world (the parameter registry, query 'params'), every named
// thing (worlds, settlements, people, creatures, live disasters and weather, ships) and every UI action (from the
// keybind registry). Enter arms a power's tool (or casts it when it needs no place), opens a law, selects a thing,
// runs an action; Shift+Enter casts a power at the cursor at once. Whatever is typed can always be done in words: the
// last row hands it to the "do this" field (CONTRACT §1: if a power is missing, the freeform field still reaches it).
// Prefixes narrow the search: ">" actions, "@" places and beings, "#" laws, "!" powers.
//
// "Here" is the ground under the cursor when the palette opened (the camera's point when the cursor was elsewhere): a
// pin marks it on the world while the palette is open and the rows name it ("⇧↵ at Aru"), so a cast never lands on a
// place the player cannot see. Shift+Enter casts there ONCE and leaves the armed tool as it was. The hovered row
// becomes the selection only after a real pointer move (rows rebuilt under a resting cursor must not steal it from
// what the keyboard chose), and never within 150 ms of a keystroke.

import type { EntityRef } from '../sim/types.ts';
import type { GroundHit, UiHost } from './host.ts';
import type { Catalog, LawRow } from './catalog.ts';
import type { Power } from './powers.ts';
import { toolMode, missingRequired } from './powers.ts';
import { ACTIONS } from './keybinds.ts';
import { fuzzyAny, highlight } from './fuzzy.ts';
import { h, clear, fmtNum } from './dom.ts';
import { icon, categoryIcon } from './icons.ts';
import { store } from './dom.ts';
import { placeWords } from './words.ts';

export interface PaletteDeps {
  /** arm a power as the current tool (its card opens) */
  arm(p: Power): void;
  /** cast a power once at a place (the palette's "here"), leaving the armed tool as it was */
  castNow(p: Power, here: GroundHit | null): void;
  /** open the laws of the world at one law */
  openLaw(path: string): void;
  /** open the "do this" field with text */
  freeform(text: string): void;
  /** fly to a thing (and select it) */
  goTo(ref: EntityRef, select: boolean): void;
  catalog: Catalog;
}

type RowKind = 'power' | 'law' | 'thing' | 'action' | 'words' | 'cat';

interface Row {
  kind: RowKind;
  title: string;
  titleHtml?: string;
  sub: string;
  iconHtml: string;
  badge?: string;
  hint?: string;
  /** what Shift+Enter would do, in words ("⇧↵ at Aru") */
  shiftHint?: string;
  score: number;
  run(shift: boolean): void;
}

const RECENT_KEY = 'genesis.palette.recent';

export class Palette {
  readonly root: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  private foot: HTMLDivElement;
  private host: UiHost;
  private deps: PaletteDeps;
  private rows: Row[] = [];
  private sel = 0;
  /** the ground the palette's casts land on (the cursor's point when it opened) and its pin on the world */
  here: GroundHit | null = null;
  readonly pin: HTMLDivElement;
  private pinLabel: HTMLDivElement;
  private hereText = '';
  /** hover selection guard: the pointer position last seen over the list, and the time before which hover is ignored */
  private lastPointer: [number, number] | null = null;
  private hoverOkAt = 0;
  onClose: (() => void) | null = null;
  private people: { id: number; name: string; role: string; settlement: number; planet: number }[] = [];
  private fetchedAt = -1e9;
  private recent: string[] = store.get<string[]>(RECENT_KEY, []);

  constructor(parent: HTMLElement, worldLayer: HTMLElement, host: UiHost, deps: PaletteDeps) {
    this.host = host;
    this.deps = deps;
    this.pinLabel = h('div', { class: 'gn-herepin-l', text: 'here' });
    this.pin = h('div', { class: 'gn-herepin' }, this.pinLabel, h('div', { class: 'gn-herepin-p' }));
    this.pin.hidden = true;
    worldLayer.appendChild(this.pin);
    this.input = h('input', { class: 'gn-pal-input', type: 'text', placeholder: 'What will you do?  — a power, a law, a place, a person…', spellcheck: 'false', autocomplete: 'off', aria: { label: 'Search powers, laws, places and actions' } }) as HTMLInputElement;
    this.list = h('div', { class: 'gn-pal-list', role: 'listbox' });
    this.foot = h('div', { class: 'gn-pal-foot' });
    this.root = h('div', { class: 'gn-panel gn-pal', role: 'dialog', aria: { label: 'Command palette' } },
      h('div', { class: 'gn-pal-bar' }, h('span', { class: 'gn-pal-glass', html: icon('search') }), this.input, h('kbd', { class: 'gn-pal-esc', text: 'Esc' })),
      this.list, this.foot);
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.input.addEventListener('input', () => { this.sel = 0; this.hoverOkAt = performance.now() + 150; this.refresh(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    // hover chooses a row only after the pointer really moved over the list (see the header)
    this.list.addEventListener('pointermove', (e) => {
      const moved = !this.lastPointer || Math.abs(e.clientX - this.lastPointer[0]) + Math.abs(e.clientY - this.lastPointer[1]) > 0.5;
      this.lastPointer = [e.clientX, e.clientY];
      if (!moved || performance.now() < this.hoverOkAt) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>('.gn-pal-row');
      const i = row ? Number(row.dataset.i) : -1;
      if (i >= 0 && i !== this.sel) { this.sel = i; this.mark(false); }
    });
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  /**
   * open with a query; `pointer` is where the mouse rests now (a row drawn under it is not chosen until it moves) and
   * `here` the ground the palette's casts land on
   */
  open(query = '', opts: { pointer?: [number, number] | null; here?: GroundHit | null } = {}): void {
    if (this.root.hidden) this.host.sound('ui.open');
    this.root.hidden = false;
    this.lastPointer = opts.pointer ? [opts.pointer[0], opts.pointer[1]] : null;
    this.hoverOkAt = performance.now() + 150;
    this.here = opts.here ?? null;
    this.hereText = this.here ? placeWords(this.host.view, this.here.planet, this.here.dir).text : '';
    this.input.value = query;
    this.sel = 0;
    // a new opening starts at the top (the last session's choice is not carried over)
    this.rows = [];
    this.lastQuery = '\u0000';
    this.refresh();
    this.input.focus();
    this.input.select();
    // the world's people, fresh at most every 8 s (the laws come from the shared catalog)
    const planet = this.host.primary();
    this.deps.catalog.laws(planet);
    if (performance.now() - this.fetchedAt > 8000 && this.host.source === 'worker') {
      this.fetchedAt = performance.now();
      void this.host.query('agents', { planet, limit: 1500 }).then((d) => {
        if (Array.isArray(d)) {
          this.people = (d as { id: number; name: string; role: string; settlement: number }[]).map((a) => ({ ...a, planet }));
          for (const a of this.people) this.deps.catalog.teach({ kind: 'agent', id: a.id, planet }, { name: a.name, role: a.role });
          if (this.isOpen) this.refresh();
        }
      });
    }
  }

  close(): void {
    if (this.root.hidden) return;
    this.host.sound('ui.close');
    this.root.hidden = true;
    this.pin.hidden = true;
    this.input.blur();
    this.onClose?.();
  }

  /** the "here" pin on the world (every frame while open) */
  frame(): void {
    if (!this.isOpen || !this.here) { this.pin.hidden = true; return; }
    const s = this.host.screenOf(this.here.planet, this.here.dir, 1);
    if (!s) { this.pin.hidden = true; return; }
    this.pin.hidden = false;
    const t = this.hereText.replace(/^at /, '') || 'here';
    if (this.pinLabel.textContent !== t) this.pinLabel.textContent = t;
    this.pin.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px) translate(-50%, -100%)`;
  }

  private get laws(): LawRow[] { return this.deps.catalog.laws(this.host.primary()); }

  /** the rows for the current query (also used by tests through the shell) */
  refresh(): void {
    const raw = this.input.value;
    let q = raw.trim();
    let scope: RowKind | 'all' = 'all';
    if (q.startsWith('>')) { scope = 'action'; q = q.slice(1).trim(); }
    else if (q.startsWith('@')) { scope = 'thing'; q = q.slice(1).trim(); }
    else if (q.startsWith('#')) { scope = 'law'; q = q.slice(1).trim(); }
    else if (q.startsWith('!')) { scope = 'power'; q = q.slice(1).trim(); }
    const rows: Row[] = [];
    if (scope === 'all' || scope === 'power') this.powerRows(q, rows, scope === 'power');
    if (scope === 'all' || scope === 'law') this.lawRows(q, rows, scope === 'law');
    if (scope === 'all' || scope === 'thing') this.thingRows(q, rows, scope === 'thing');
    if (scope === 'all' || scope === 'action') this.actionRows(q, rows, scope === 'action');
    rows.sort((a, b) => b.score - a.score);
    const out = rows.slice(0, q ? 40 : 60);
    // the row the keyboard chose stays chosen when rows arrive late (the laws, the people) and re-rank the list
    const was = this.rows[this.sel];
    const keep = was && raw === this.lastQuery ? out.findIndex((r) => r.kind === was.kind && r.title === was.title && r.sub === was.sub) : -1;
    if (raw.trim() && scope === 'all') {
      out.push({
        kind: 'words', title: `Do this: “${raw.trim()}”`, sub: 'In words — anything not in a list, the world will try', iconHtml: icon('words'), score: -1e9,
        run: () => { this.close(); this.deps.freeform(raw.trim()); },
      });
    }
    if (!raw.trim()) {
      // with nothing typed, the palette is also a map of what can be done: every kind of power, to browse (the arrows,
      // the D-pad and A work here as on any row)
      for (const c of this.host.powers.categories()) {
        out.push({
          kind: 'cat', title: c, sub: `${this.host.powers.byCategory.get(c)?.length ?? 0} powers`, iconHtml: categoryIcon(c), score: -1e8,
          run: () => { this.input.value = `!${c.toLowerCase()} `; this.sel = 0; this.refresh(); this.input.focus(); },
        });
      }
      // …and every action a key can do (the camera, time, the windows), for a gamepad or a mouse that has no keys
      out.push({
        kind: 'cat', title: 'Actions', sub: 'the camera, time, the windows — everything a key does', iconHtml: icon('menu'), score: -1e8,
        run: () => { this.input.value = '> '; this.sel = 0; this.refresh(); this.input.focus(); },
      });
      // …and the laws of this world
      out.push({
        kind: 'cat', title: 'Laws of the world', sub: 'gravity, the day, the air, the sea …', iconHtml: icon('law'), score: -1e8,
        run: () => { this.input.value = '# '; this.sel = 0; this.refresh(); this.input.focus(); },
      });
    }
    this.rows = out;
    this.sel = keep >= 0 ? keep : Math.min(this.sel, Math.max(0, out.length - 1));
    this.render();
  }

  private powerRows(q: string, rows: Row[], only: boolean): void {
    const restraint = this.host.view.restraint;
    for (const p of this.host.powers.list) {
      let score = 0, titleHtml: string | undefined, via: string | null = null;
      if (q) {
        const m = fuzzyAny(q, p.name, [...p.synonyms, `${p.category} ${p.name}`, p.desc], 0.78);
        if (!m) continue;
        score = m.score + 6;
        via = m.via;
        if (!m.via) titleHtml = highlight(p.name, m.at);
      } else {
        const ri = this.recent.indexOf(`power:${p.id}`);
        if (ri < 0 && !only) continue;
        score = ri >= 0 ? 1000 - ri : -p.ring;
      }
      const mode = toolMode(p);
      const cost = restraint && p.cost ? ` · ${p.cost} worship` : '';
      const subVia = via && via !== p.desc && !via.startsWith(p.category) ? `“${via}” · ` : '';
      const placed = mode !== 'instant' && mode !== 'world';
      const world = this.host.view.planet(this.here?.planet ?? this.host.primary())?.name ?? 'this world';
      rows.push({
        kind: 'power', title: p.name, titleHtml, sub: `${subVia}${p.desc || p.category}${cost}`, iconHtml: icon(p.icon, p.category), badge: p.category,
        hint: mode === 'instant' ? 'cast' : 'arm',
        shiftHint: placed ? (this.hereText ? `⇧↵ ${this.hereText}` : '⇧↵ no place') : mode === 'world' ? `⇧↵ on ${world}` : '',
        score,
        run: (shift) => {
          this.remember(`power:${p.id}`);
          const here = this.here;
          this.close();
          if (shift || (mode === 'instant' && !missingRequired(p, p.params).length)) this.deps.castNow(p, here); else this.deps.arm(p);
        },
      });
    }
  }

  private lawRows(q: string, rows: Row[], only: boolean): void {
    for (const l of this.laws) {
      let score = 0, titleHtml: string | undefined;
      if (q) {
        const m = fuzzyAny(q, l.label, [l.path, l.desc], 0.75);
        if (!m) continue;
        score = m.score;
        if (!m.via) titleHtml = highlight(l.label, m.at);
      } else if (!only) continue;
      const v = typeof l.value === 'number' ? fmtNum(l.value) : String(l.value);
      rows.push({
        kind: 'law', title: l.label, titleHtml, sub: `${l.path} · now ${v}${l.unit && typeof l.value === 'number' ? ` ${l.unit}` : ''} — ${l.desc}`, iconHtml: icon('law'), badge: 'Law', hint: 'open', score,
        run: () => { this.remember(`law:${l.path}`); this.close(); this.deps.openLaw(l.path); },
      });
    }
  }

  private thingRows(q: string, rows: Row[], only: boolean): void {
    const v = this.host.view;
    const add = (title: string, sub: string, ic: string, ref: EntityRef, base = 0, alts: string[] = []) => {
      let score = base, titleHtml: string | undefined;
      if (q) {
        const m = fuzzyAny(q, title, alts, 0.7);
        if (!m) return;
        score += m.score;
        if (!m.via) titleHtml = highlight(title, m.at);
      } else if (!only) return;
      rows.push({
        kind: 'thing', title, titleHtml, sub, iconHtml: icon(ic), badge: ref.kind === 'agent' ? 'Person' : ref.kind.charAt(0).toUpperCase() + ref.kind.slice(1), hint: 'select', score,
        run: (shift) => { this.close(); this.deps.goTo(ref, !shift); },
      });
    };
    for (const pv of v.planets) {
      let pop = 0;
      for (const n of pv.population) pop += n;
      const kind = pv.params.orbit.parent >= 0 ? 'moon' : 'world';
      // a world: fly there (selecting it opens its laws)
      if (!q || fuzzyAny(q, pv.name, [pv.params.kind, kind])) {
        const m = q ? fuzzyAny(q, pv.name, [pv.params.kind, kind]) : null;
        if (q || only) rows.push({
          kind: 'thing', title: pv.name, titleHtml: m && !m.via ? highlight(pv.name, m.at) : undefined, sub: `${kind} · ${pv.params.kind}${pop ? ` · ${fmtNum(pop)} living` : ''}`, iconHtml: icon(kind === 'moon' ? 'moon' : 'world'), badge: 'World', hint: 'fly',
          score: (m?.score ?? 0) + 4, run: (shift) => { this.close(); this.host.flyTo(pv.id); if (!shift) this.host.select({ kind: 'planet', id: pv.id, planet: pv.id }); },
        });
      }
      for (const s of pv.settlements) {
        if (s.flags & 2) continue;
        add(s.name, `${s.flags & 1 ? 'a band' : `${s.era} age`} · ${s.population} souls · ${pv.name}`, 'found', { kind: 'settlement', id: s.id, planet: pv.id }, 3, [s.polityName ?? '']);
      }
      for (const d of pv.disasters) add(d.kind.replace(/-/g, ' '), `a live disaster on ${pv.name}${d.frozen ? ' · frozen' : ''}`, `d-${d.kind}`, { kind: 'disaster', id: d.id, planet: pv.id }, 2);
      for (const w of pv.weather) add(w.kind.replace(/-/g, ' '), `weather on ${pv.name}${w.pinned ? ' · held' : ''}`, 'cloud', { kind: 'weather', id: w.id, planet: pv.id }, -2);
    }
    for (const c of v.creatures) add(c.name, `creature · ${c.body} · ${c.activity}`, 'creature', { kind: 'creature', id: c.id, planet: c.planet }, 3);
    for (const s of v.ships) add(`${s.kind.replace(/-/g, ' ')} #${s.id}`, `ship · ${s.phase}${s.crew ? ` · ${s.crew} aboard` : ''}`, 'w-rocket', { kind: 'ship', id: s.id, planet: s.planet }, 1);
    if (q.length >= 2) for (const a of this.people) {
      const pv = v.planet(a.planet);
      const st = pv?.settlements.find((s) => s.id === a.settlement);
      add(a.name, `${a.role}${st ? ` of ${st.name}` : ''}`, 'people', { kind: 'agent', id: a.id, planet: a.planet }, -3);
    }
  }

  private actionRows(q: string, rows: Row[], only: boolean): void {
    for (const a of ACTIONS) {
      if (a.hold || a.modifier) continue;
      let score = -2, titleHtml: string | undefined;
      if (q) {
        const m = fuzzyAny(q, a.label, [a.group, a.id], 0.7);
        if (!m) continue;
        score += m.score;
        if (!m.via) titleHtml = highlight(a.label, m.at);
      } else if (!only) {
        if (!this.recent.includes(`action:${a.id}`)) continue;
        score = 900 - this.recent.indexOf(`action:${a.id}`);
      }
      const k = this.host.keybinds.hint(a.id);
      rows.push({
        kind: 'action', title: a.label, titleHtml, sub: a.group, iconHtml: icon(ACTION_ICON[a.group] ?? 'menu'), badge: k || 'Action', hint: 'run', score,
        run: () => { this.remember(`action:${a.id}`); this.close(); this.host.action(a.id); },
      });
    }
  }

  private remember(key: string): void {
    this.recent = [key, ...this.recent.filter((k) => k !== key)].slice(0, 12);
    store.set(RECENT_KEY, this.recent);
  }

  private lastQuery = '';

  private render(): void {
    const q = this.input.value;
    const keep = q === this.lastQuery ? this.list.scrollTop : 0;
    this.lastQuery = q;
    clear(this.list);
    if (!this.rows.length) {
      this.list.append(h('div', { class: 'gn-pal-empty' }, h('div', { class: 'gn-pal-empty-t', text: 'Begin typing.' }),
        h('div', { text: 'Powers, laws of the world, places, people, creatures, disasters, actions — or anything at all, in words.' })));
    }
    let lastKind = '';
    this.rows.forEach((r, i) => {
      if (!this.input.value.trim() && r.kind !== lastKind) {
        this.list.append(h('div', { class: 'gn-pal-group', text: r.kind === 'power' ? 'Recent powers' : r.kind === 'action' ? 'Recent actions' : r.kind === 'cat' ? 'Browse' : r.kind }));
        lastKind = r.kind;
      }
      const row = h('div', { class: `gn-pal-row gn-pal-${r.kind}${i === this.sel ? ' gn-pal-on' : ''}`, role: 'option', aria: { selected: String(i === this.sel) }, data: { i: String(i) } },
        h('span', { class: 'gn-pal-ico', html: r.iconHtml }),
        h('span', { class: 'gn-pal-text' }, h('span', { class: 'gn-pal-title', html: r.titleHtml ?? escapeText(r.title) }), h('span', { class: 'gn-pal-sub', text: r.sub })),
        r.badge ? h('span', { class: 'gn-pal-badge', text: r.badge }) : null,
        h('span', { class: 'gn-pal-hint' }, h('span', { text: r.hint ?? '' }), r.shiftHint ? h('small', { text: r.shiftHint }) : null));
      row.addEventListener('click', (e) => r.run(e.shiftKey));
      this.list.append(row);
    });
    this.list.scrollTop = keep;
    this.foot.innerHTML = '';
    this.foot.append(
      h('span', {}, h('kbd', { text: '↑↓' }), ' choose'), h('span', {}, h('kbd', { text: 'Enter' }), ' arm / open'),
      h('span', {}, h('kbd', { text: '⇧ Enter' }), ` cast once ${this.hereText || 'at the camera\'s point'}`),
      h('span', { class: 'gn-pal-pfx' }, h('kbd', { text: '!' }), ' powers ', h('kbd', { text: '#' }), ' laws ', h('kbd', { text: '@' }), ' places ', h('kbd', { text: '>' }), ' actions'));
  }

  private mark(scroll = true): void {
    const kids = this.list.querySelectorAll('.gn-pal-row');
    kids.forEach((k, i) => { k.classList.toggle('gn-pal-on', i === this.sel); k.setAttribute('aria-selected', String(i === this.sel)); });
    if (scroll) (kids[this.sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  /** move the selection (keyboard / gamepad) */
  move(d: number): void {
    if (!this.rows.length) return;
    this.sel = (this.sel + d + this.rows.length) % this.rows.length;
    // the keyboard chose: a list scrolled under a resting cursor must not take it back
    this.hoverOkAt = performance.now() + 150;
    this.mark();
  }

  /** run the selected row */
  accept(shift = false): void {
    this.rows[this.sel]?.run(shift);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') { this.move(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { this.move(-1); e.preventDefault(); }
    else if (e.key === 'PageDown') { this.move(8); e.preventDefault(); }
    else if (e.key === 'PageUp') { this.move(-8); e.preventDefault(); }
    else if (e.key === 'Enter') { this.accept(e.shiftKey); e.preventDefault(); }
    else if (e.key === 'Escape') { this.close(); e.preventDefault(); }
    e.stopPropagation();
  }

  /** the current rows as text (test surface) */
  rowsText(): { kind: string; title: string; sub: string; selected?: boolean }[] {
    return this.rows.map((r, i) => ({ kind: r.kind, title: r.title, sub: r.sub, ...(i === this.sel ? { selected: true } : {}) }));
  }

  /** the selected row's index (test surface) */
  get selected(): number { return this.sel; }

  setQuery(q: string): void { this.input.value = q; this.sel = 0; this.refresh(); }
}

const ACTION_ICON: Record<string, string> = { Camera: 'eye', Time: 'hourglass', Powers: 'radial', Hand: 'open-hand', Windows: 'menu' };

function escapeText(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}
